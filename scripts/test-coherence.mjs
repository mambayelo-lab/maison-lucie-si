// Intégrité référentielle entre les applications de Maison Lucie, hors erreurs volontaires documentées.
// Taille démo : contrôle exhaustif. Taille scale : contrôle par échantillon (rangs tirés au hasard, graine fixe).
import assert from "node:assert/strict";
import { SIZES, TABLES, LAKE_FEEDS, lakeRow, product, supplier, orderLine, siteCode, STORY_SKUS } from "../lib/multisource-gen.js";

const norm = s => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const refIndex = ref => { const s = STORY_SKUS.findIndex(x => x[0] === ref); if (s >= 0) return s + 1; const m = /^ML-(\d{7})$/.exec(ref); return m ? Number(m[1]) : -1; };

function check(size, sample) {
  const z = SIZES[size];
  const rows = t => {
    const n = TABLES[t].count(z);
    if (!sample || n <= sample) return Array.from({ length: n }, (_, i) => TABLES[t].row(z, i));
    let seed = 7; const out = [];
    for (let k = 0; k < sample; k++) { seed = (seed * 1103515245 + 12345) % 2147483648; out.push(TABLES[t].row(z, seed % n)); }
    return out;
  };
  // Référentiels : produits (index → EAN, référence), fournisseurs, sites.
  const productByIndex = i => (i >= 1 && i <= z.products ? product(z, i - 1) : null);
  const pimEan = ean => { const m = /^376(\d{9})\d$/.exec(ean); if (!m) return false; const p = productByIndex(Number(m[1])); return !!p && (p.ean === ean || product(z, Number(m[1]) - 1).ean === ean || productByIndex(Number(m[1]) + 1)?.ean === ean); };
  const pimRef = ref => { const i = refIndex(norm(ref).startsWith("ML") ? `ML-${norm(ref).slice(2)}` : STORY_SKUS.find(s => norm(s[0]) === norm(ref))?.[0] ?? ""); return i > 0 && i <= z.products; };
  const nSup = TABLES.sap_suppliers.count(z);
  const lifnrOk = l => { const i = Number(l) - 100000; return i >= 1 && i <= nSup; };
  const sites = new Set(Array.from({ length: z.sites }, (_, k) => norm(siteCode(k))));
  const supplierTax = new Set(); for (let i = 0; i < Math.min(nSup, 6000); i++) { const s = supplier(z, i); for (const v of [s.VATRegistration, s.DUNS, s.TaxNumber1]) if (v) supplierTax.add(norm(v)); }
  const issues = [];
  const expect = (ok, msg) => { if (!ok) issues.push(msg); };

  for (const p of rows("sap_purchase_orders")) { expect(pimRef(p.Material), `PO ${p.PurchaseOrder} : article ${p.Material}`); expect(lifnrOk(p.Supplier), `PO ${p.PurchaseOrder} : fournisseur ${p.Supplier}`); }
  for (const s of rows("tms_shipments")) {
    expect(Number(s.PurchaseOrderRef.slice(3)) - 4500000000 <= TABLES.sap_purchase_orders.count(z), `TMS ${s.ShipmentId} : commande ${s.PurchaseOrderRef}`);
    expect(pimEan(s.ItemId.slice(1)), `TMS ${s.ShipmentId} : article ${s.ItemId}`);
    expect(sites.has(norm(s.DestinationFacility)), `TMS ${s.ShipmentId} : site ${s.DestinationFacility}`);
  }
  for (const s of rows("wms_stock")) { if (!s.ItemId.startsWith("0399")) expect(pimEan(s.ItemId.slice(1)), `WMS : article ${s.ItemId}`); if (s.FacilityId !== "WHXXX") expect(sites.has(norm(s.FacilityId)), `WMS : site ${s.FacilityId}`); }
  for (const o of rows("oms_order_lines")) { expect(pimRef(o.ProductRef), `OMS ${o.OrderLineId} : article ${o.ProductRef}`); expect(sites.has(norm(o.FulfillmentSite)), `OMS ${o.OrderLineId} : site`); }
  for (const m of rows("wms_movements")) {
    const ol = orderLine(z, Number(m.OrderLineId.slice(3)) - 1);
    expect(ol.OrderLineId === m.OrderLineId && norm(ol.FulfillmentSite) === norm(m.FacilityId) && ol.Quantity === m.Quantity, `Mouvement ${m.MovementId} ≠ commande ${m.OrderLineId}`);
    expect(pimEan(m.ItemId.slice(1)), `Mouvement ${m.MovementId} : article`);
  }
  for (const d of rows("tms_deliveries")) { const n = Number(d.OrderId.slice(3)) * 3; expect(n <= z.omsLines + 3, `Livraison ${d.DeliveryId} : commande ${d.OrderId}`); }
  for (const f of rows("aps_forecasts")) { if (!/^ML-9/.test(f.Material)) expect(pimRef(f.Material), `APS ${f.ForecastId} : article ${f.Material}`); expect(sites.has(norm(f.Site)), `APS : site`); }
  for (const s of rows("srm_suppliers")) { expect(supplierTax.has(norm(s.TaxId)) || nSup > 6000, `SRM ${s.SrmId} : identifiant ${s.TaxId}`); }
  for (const q of rows("qms_nonconformities")) { if (!q.Ean.startsWith("399")) expect(pimEan(q.Ean), `QMS ${q.NcId} : article ${q.Ean}`); }
  for (const s of rows("lake_sales")) { expect(pimEan(s.Ean), `Lac : article ${s.Ean}`); expect(sites.has(norm(s.StoreCode)), `Lac : magasin ${s.StoreCode}`); }
  // Flux du lac : mêmes identifiants que l'application d'origine, décalés d'un jour.
  for (const feed of Object.keys(LAKE_FEEDS)) {
    const src = TABLES[LAKE_FEEDS[feed].from], n = src.count(z), step = Math.max(1, Math.floor(n / 500));
    for (let i = 0; i < n; i += step) {
      const r = lakeRow(feed, z, i), o = src.row(z, i);
      if (!r) continue;
      const { _source, _ingestedAt, ...copy } = r;
      assert.deepEqual(copy, o, `lac.${feed} rang ${i}`);
      const wm = String(o[src.watermark]);
      expect(Date.parse(_ingestedAt.replace(" ", "T") + "Z") - Date.parse((wm.length === 10 ? `${wm}T00:00:00` : wm.replace(" ", "T")) + "Z") === 86400e3, `lac.${feed} : décalage J-1`);
    }
  }
  return issues;
}

for (const [size, sample] of [["demo", 0], ["scale", 3000]]) {
  const issues = check(size, sample);
  assert.deepEqual(issues.slice(0, 10), [], `${size} : ${issues.length} rupture(s) d'intégrité`);
  console.log(`  ok cohérence inter-applications (${size}${sample ? `, échantillon de ${sample} lignes par table` : ", exhaustif"})`);
}

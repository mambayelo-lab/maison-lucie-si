// Tests du SI multi-sources (taille démo) : contrats OData/REST/lake et erreurs volontaires.
import assert from "node:assert/strict";
import { odata, restPage, lakeAggregate, parseODataFilter, DATASET, DELIBERATE_ERRORS, catalog } from "../lib/multisource-api.js";
import handler from "../api/sources/[source].js";

let n = 0; const ok = (name, fn) => { fn(); n++; console.log(`  ok ${name}`); };

ok("OData $filter/$select/$top/pagination", () => {
  const r = odata("A_Supplier", { $filter: "Country eq 'FR'", $select: "Supplier,SupplierName", $top: "5", $inlinecount: "allpages" }, "/x");
  assert.equal(r.status, 200);
  assert.equal(r.body.d.results.length, 5);
  assert.deepEqual(Object.keys(r.body.d.results[0]), ["Supplier", "SupplierName"]);
  assert.ok(Number(r.body.d.__count) > 5);
  assert.match(r.body.d.__next, /\$skip=5/);
  const all = []; let skip = 0;
  for (;;) { const p = odata("A_Supplier", { $top: "20", $skip: String(skip) }, "/x"); all.push(...p.body.d.results); if (!p.body.d.__next) { assert.ok(p.body.d.__delta); break; } skip += 20; }
  assert.equal(all.length, DATASET.counts.sap_suppliers);
});
ok("OData delta (!deltatoken) et datetime", () => {
  const since = "2026-09-20T00:00:00Z";
  const a = odata("A_PurchaseOrderItem", { $filter: `LastChangeDateTime gt datetime'2026-09-20T00:00:00'`, $top: "5000" }).body.d.results;
  const b = odata("A_PurchaseOrderItem", { "!deltatoken": since, $top: "5000" }).body.d.results;
  assert.ok(a.length > 0 && a.length < DATASET.counts.sap_purchase_orders);
  assert.equal(a.length, b.length);
  assert.throws(() => parseODataFilter("substringof('x', Name)"));
});
ok("REST PIM curseur + updatedAfter", () => {
  const p1 = restPage("pim", "products", { limit: "500" });
  assert.equal(p1.body.items.length, 500); assert.equal(p1.body.nextCursor, "500");
  const inc = restPage("pim", "products", { updatedAfter: "2026-09-27T00:00:00Z", limit: "2000" });
  assert.ok(inc.body.total > 0 && inc.body.total < DATASET.counts.pim_products);
});
ok("Manhattan page/size + fenêtre temporelle", () => {
  const r = restPage("manhattan", "inventory", { page: "1", size: "1000" });
  assert.equal(r.body.header.page, 1); assert.equal(r.body.data.length, 1000); assert.equal(r.body.header.totalCount, 3600);
  const w = restPage("tms", "shipments", { from: "2026-09-20", to: "2026-09-25" });
  assert.ok(w.body.total > 0 && w.body.total < 800);
  // Paysage : 9 applications, chacune avec son rôle et ses clés.
  assert.deepEqual(Object.keys(catalog().sources), ["sap", "pim", "manhattan", "tms", "aps", "srm", "qms", "oms", "hr", "lake"]);
  assert.ok(restPage("aps", "forecasts", { limit: "5" }).body.items[0].Week);
  assert.ok(restPage("srm", "suppliers", { limit: "5" }).body.items[0].SrmId);
  assert.ok(restPage("qms", "nonconformities", { limit: "5" }).body.items[0].NcId);
});
ok("Lake : agrégat poussé à la source", () => {
  const r = lakeAggregate({ groupBy: "month" });
  assert.equal(r.body.items.reduce((s, x) => s + x.lines, 0), DATASET.counts.lake_sales);
  assert.equal(lakeAggregate({ groupBy: "CustomerId" }).status, 400);
});
ok("Erreurs volontaires présentes et documentées", () => {
  const t = DATASET.tables;
  assert.equal(t.sap_suppliers.filter(s => /SAS$/.test(s.SupplierName) && s.SupplierName === s.SupplierName.toUpperCase()).length, 3);
  assert.equal(t.pim_products.filter(p => p.supplierTaxId.startsWith("FR99")).length, 6);
  assert.ok(t.wms_stock.some(s => s.FacilityId === "WHXXX"));
  assert.ok(t.pim_products.every(p => /^\d{13}$/.test(p.ean)));
  assert.ok(t.wms_stock.every(s => /^\d{14}$/.test(s.ItemId)));
  assert.equal(DELIBERATE_ERRORS.length, 16);
  assert.ok(catalog().sources.sap.endpoints[0].includes("A_Supplier"));
});
ok("Récit démo : SUP-001 et CLASP-AURORA", () => {
  const t = DATASET.tables;
  const tess = t.sap_suppliers.find(s => s.LegacySupplierId === "SUP-001");
  assert.equal(tess.SupplierName, "Tessitura Milano");
  const clasp = t.pim_products.find(p => p.internalRef === "CLASP-AURORA");
  const out = t.wms_stock.filter(s => s.ItemId === "0" + clasp.ean && s.OnHand - s.Allocated < s.SafetyStock);
  assert.ok(out.length >= 1);
  const late = t.tms_shipments.filter(s => s.OriginName === "Tessitura Milano" && (s.ActualDate ?? "2026-09-28") > s.ExpectedDate);
  assert.ok(late.length >= 1);
});

// Handler HTTP (auth passerelle obligatoire).
const call = async (query, token = "lucie_aura_gateway_demo_token") => {
  let status = 0, body; const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; }, status(c) { status = c; return this; }, json(b) { body = b; return this; }, send(b) { body = b; return this; }, end() { return this; } };
  await handler({ method: "GET", headers: token ? { authorization: `Bearer ${token}` } : {}, query }, res);
  return { status, body };
};
assert.equal((await call({ source: "sap", entity: "A_Supplier" }, null)).status, 401);
assert.equal((await call({ source: "sap", entity: "A_Supplier", $top: "2" })).body.d.results.length, 2);
assert.match((await call({ source: "oms", resource: "order-lines", format: "csv" })).body, /^OrderLineId,/);
assert.equal((await call({ source: "index" }, null)).status, 200);
console.log(`  ok handler HTTP\n${n + 1} tests multi-sources OK`);

// Taille scale à la volée : millions de lignes, pages déterministes.
{
  const { scalePage, scaleCounts } = await import("../lib/multisource-api.js");
  const c = scaleCounts();
  assert.equal(c.lake_sales, 50_000_000); assert.equal(c.oms_order_lines, 10_000_000); assert.equal(c.pim_products, 1_000_000);
  const a = scalePage("pim", "products", { cursor: "999000", limit: "1000" });
  assert.equal(a.body.items.length, 1000); assert.equal(a.body.items[0].productId, "PIM-0999001"); assert.equal(a.body.nextCursor, null);
  const b = scalePage("pim", "products", { cursor: "999000", limit: "1000" });
  assert.deepEqual(a.body, b.body);
  const s = scalePage("sap", "A_Supplier", { $top: "2", $skip: "10" }, "/x");
  assert.equal(s.body.d.results[0].Supplier, "0000100011"); assert.match(s.body.d.__next, /\$skip=12/);
  assert.equal(scalePage("lake", "sales", { from: "2026-01-01" }).status, 400);
  const t0 = Date.now(); scalePage("lake", "sales", { cursor: "49990000", limit: "5000" }); assert.ok(Date.now() - t0 < 500);
  console.log("  ok taille scale à la volée");
}
{
  const { odataMetadata } = await import("../lib/multisource-api.js");
  const x = odataMetadata();
  assert.match(x, /<EntitySet Name="A_Supplier"/); assert.match(x, /Property Name="LastChangeDateTime" Type="Edm.DateTime"/);
  console.log("  ok $metadata OData");
}
{
  // Chaque ressource de chaque application existe aussi en taille scale.
  const { scalePage, SOURCES } = await import("../lib/multisource-api.js");
  const { EXTENSION_RESOURCES } = await import("../lib/si-extensions.js");
  for (const [src, def] of Object.entries(SOURCES)) for (const name of Object.keys(def.entities ?? def.resources)) {
    // Tables standard ajoutées (résilience, pandémie, détroits, qualité) : taille démo seulement, refus explicite en scale.
    if (EXTENSION_RESOURCES[src]?.[name]) { assert.equal(scalePage(src, name, {}).body.error.code, "DEMO_SIZE_ONLY"); continue; }
    const r = scalePage(src, name, src === "sap" ? { $top: "2" } : { limit: "2", size: "2" });
    assert.equal(r.status, 200, `${src}/${name}`);
  }
  console.log("  ok toutes les ressources en taille scale");
}

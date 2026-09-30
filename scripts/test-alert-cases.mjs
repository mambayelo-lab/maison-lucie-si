// Cas reproductibles des 8 alertes de résilience d'Aura Supply : chaque règle est
// recalculée ici, indépendamment d'Aura, sur les tables standard du SI, et doit
// se déclencher au moins une fois (seuils par défaut d'Aura).
import assert from "node:assert/strict";
import { DATASET } from "../lib/multisource-api.js";

const T = DATASET.tables, AS_OF = DATASET.asOf, DAY = 86400e3;
const ASIA = new Set(["CN", "IN"]), CHOKE = /^(EGSUZ|EGPSD|YEADE|DJJIB|OMSOH)$/;
const country = new Map(T.sap_suppliers.map(s => [s.Supplier, s.Country]));
const refOfEan = new Map(T.pim_products.map(p => [p.ean, p.internalRef]));
const ref = gtin => refOfEan.get(String(gtin).replace(/^0/, ""));
const avail = new Map(); for (const w of T.wms_stock) { const r = ref(w.ItemId); if (r) avail.set(r, (avail.get(r) ?? 0) + Math.max(0, w.OnHand - w.Allocated)); }
// TTS au sens d'Aura : (disponible + en transit) / demande journalière.
const onHandOnly = new Map(avail);
for (const s of T.tms_shipments) if (!s.ActualDate) { const r = ref(s.ItemId); if (r) avail.set(r, (avail.get(r) ?? 0) + s.Quantity); }
const week = T.aps_forecasts.map(f => f.Week).sort()[0], daily = new Map();
for (const f of T.aps_forecasts) if (f.Week === week) daily.set(f.Material, (daily.get(f.Material) ?? 0) + f.ForecastQty / 7);
const tts = m => (daily.get(m) ? (avail.get(m) ?? 0) / daily.get(m) : undefined);
const sources = m => T.sap_purchasing_sources.filter(s => s.Material === m && !s.SourceOfSupplyIsBlocked);
const lead = (m, s) => T.sap_info_records.find(i => i.Material === m && i.Supplier === s)?.MaterialPlannedDeliveryDurn;
const ttr = m => { const src = sources(m), fixed = src.find(s => s.SupplierIsFixed), alt = src.find(s => !s.SupplierIsFixed); return alt ? lead(m, alt.Supplier) : (lead(m, fixed?.Supplier) ?? 0) + 60; };
const variance = xs => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length; };
const hits = {};
const ok = (id, name, list) => { assert.ok(list.length > 0, `${id} ne se déclenche pas`); hits[id] = list.length; console.log(`  ok ${id} ${name} : ${list.length} cas (ex. ${JSON.stringify(list[0])})`); };

ok("RES-UNIQUE", "fournisseur unique et TTR > TTS", [...new Set(T.sap_purchasing_sources.map(s => s.Material))].filter(m => sources(m).length === 1 && tts(m) !== undefined && ttr(m) > tts(m)).map(m => ({ m, tts: Math.round(tts(m)), ttr: ttr(m) })));
{
  const via = new Set(T.tms_shipment_stages.filter(s => CHOKE.test(s.DestinationLocation)).map(s => s.ShipmentId));
  const viaPo = new Set(T.tms_shipments.filter(s => via.has(s.ShipmentId)).map(s => s.PurchaseOrderRef.replace(/\D/g, "")));
  const open = T.sap_purchase_orders.filter(p => p.ScheduleLineDeliveryDate >= AS_OF);
  const value = p => p.OrderQuantity * (T.sap_info_records.find(i => i.Material === p.Material && i.Supplier === p.Supplier)?.NetPriceAmount ?? 0);
  const total = open.reduce((s, p) => s + value(p), 0), exposed = open.filter(p => ASIA.has(country.get(p.Supplier)) || viaPo.has(p.PurchaseOrder)).reduce((s, p) => s + value(p), 0);
  ok("RES-GEO", "part de la valeur d'achat exposée ≥ 20 %", exposed / total >= 0.2 ? [{ part: Math.round((exposed / total) * 100) }] : []);
}
ok("RES-SECU", "stock de sécurité MARC (jours) < TTR", T.sap_product_supply.filter(p => daily.get(p.Product) && p.SafetyStockQuantity / daily.get(p.Product) < ttr(p.Product)).map(p => ({ m: p.Product, jours: Math.round(p.SafetyStockQuantity / daily.get(p.Product)), ttr: ttr(p.Product) })));
{
  const hdr = new Map(T.sap_purchase_order_headers.map(h => [h.PurchaseOrder, h]));
  const by = new Map();
  for (const r of T.sap_material_documents.filter(r => Date.parse(r.PostingDate) >= Date.parse(AS_OF) - 28 * DAY)) {
    const h = hdr.get(r.PurchaseOrder), real = (Date.parse(r.PostingDate) - Date.parse(h.PurchaseOrderDate)) / DAY, plan = lead(r.Material, r.Supplier);
    const l = by.get(r.Supplier) ?? []; l.push(real / plan); by.set(r.Supplier, l);
  }
  ok("RES-DELAI", "délai réel > délai prévu + 20 % sur 4 semaines", [...by].filter(([, l]) => l.length >= 2 && l.reduce((a, b) => a + b, 0) / l.length > 1.2).map(([s, l]) => ({ s, ratio: Math.round((l.reduce((a, b) => a + b, 0) / l.length) * 100) / 100 })));
}
ok("RES-BULLWHIP", "variance des commandes / variance de la demande > 1,5", [...new Set(T.lake_demand_history.map(r => r.ProductRef))].map(sku => ({ sku, ratio: Math.round((variance(T.lake_purchase_history.filter(r => r.Material === sku).map(r => r.OrderedQty)) / variance(T.lake_demand_history.filter(r => r.ProductRef === sku).map(r => r.Quantity))) * 100) / 100 })).filter(x => x.ratio > 1.5));
ok("RES-FINANCE", "risque financier SRM en hausse de 15 points ou plus", [...new Set(T.srm_risk_assessments.map(r => r.ErpVendorId))].map(v => { const h = T.srm_risk_assessments.filter(r => r.ErpVendorId === v && r.RiskCategory === "FINANCIAL").sort((a, b) => (a.AssessedOn < b.AssessedOn ? -1 : 1)); return { v, de: h[0].Score, a: h.at(-1).Score }; }).filter(x => x.a - x.de >= 15));
{
  const lots = new Map(); for (const l of T.qms_inspection_lots) { const x = lots.get(l.Supplier) ?? { n: 0, r: 0 }; x.n++; if (l.InspectionLotUsageDecisionCode === "R") x.r++; lots.set(l.Supplier, x); }
  const rejects = [...lots].filter(([, x]) => x.n >= 3 && x.r / x.n >= 0.1).map(([s, x]) => ({ s, taux: Math.round((x.r / x.n) * 100) }));
  const certs = T.srm_certificates.filter(c => Date.parse(c.ValidTo) <= Date.parse(AS_OF) + 60 * DAY).map(c => ({ v: c.ErpVendorId, type: c.CertificateType, fin: c.ValidTo }));
  ok("RES-QUALITE", "lots refusés ≥ 10 % ou certificat échu sous 60 j", [...rejects, ...certs]);
}
{
  const open = T.tms_events.filter(e => ["CONGESTION", "STRIKE"].includes(e.EventCode) && (!e.EndDate || e.EndDate >= AS_OF) && e.EstimatedDelayDays >= 2);
  const cases = [];
  for (const e of open) for (const s of T.tms_shipments.filter(sh => !sh.ActualDate)) {
    const last = T.tms_shipment_stages.filter(st => st.ShipmentId === s.ShipmentId).at(-1);
    // Marchandise bloquée au port : couverture sur le seul stock disponible (le transit n'arrive pas).
    const r = ref(s.ItemId), t = r && daily.get(r) ? (onHandOnly.get(r) ?? 0) / daily.get(r) : undefined;
    if (last?.DestinationLocation === e.Location && t !== undefined && t <= 90) cases.push({ port: e.Location, attente: e.EstimatedDelayDays, expedition: s.ShipmentId, tts: Math.round(t) });
  }
  ok("RES-PORT", "attente au port ≥ 2 j et TTS hors transit ≤ 90 j", cases);
}
{
  // BFR : stock valorisé au coût standard (MBEW) au-delà de 90 jours de couverture.
  const cost = new Map(T.sap_product_valuation.map(v => [v.Product, v.StandardPrice]));
  const excess = [...onHandOnly].filter(([m]) => daily.get(m) && cost.get(m)).map(([m, q]) => ({ m, jours: Math.round(avail.get(m) / daily.get(m)), excedentEur: Math.round(Math.max(0, q - 90 * daily.get(m)) * cost.get(m)) })).filter(x => x.jours > 90);
  ok("RES-BFR", "stock au-delà de 90 jours de couverture", excess.sort((a, b) => b.excedentEur - a.excedentEur));
}
{
  // Rappel : lot refusé (QMS) déjà expédié (WMS) → clients exposés (OMS).
  const rejected = new Set(T.qms_inspection_lots.filter(l => l.InspectionLotUsageDecisionCode === "R").map(l => l.Batch));
  const lines = new Map(T.oms_order_lines.map(l => [l.OrderLineId, l]));
  const byLot = new Map();
  for (const d of T.wms_outbound_deliveries.filter(d => rejected.has(d.BatchNumber))) { const x = byLot.get(d.BatchNumber) ?? new Set(); x.add(lines.get(d.OrderLineId).CustomerId); byLot.set(d.BatchNumber, x); }
  ok("RES-RAPPEL", "lot refusé expédié à des clients", [...byLot].map(([lot, c]) => ({ lot, clients: c.size })));
}
{
  // Vigilance : fournisseur actif sans évaluation ESG, score ESG ≥ 70 ou certificat ISO 14001 / SA8000 échu.
  const active = new Set(T.sap_purchase_orders.map(p => p.Supplier));
  const esg = new Map(T.srm_risk_assessments.filter(r => r.RiskCategory === "ESG").map(r => [r.ErpVendorId, r.Score]));
  const certKo = new Set(T.srm_certificates.filter(c => ["ISO 14001", "SA8000"].includes(c.CertificateType) && c.Status === "EXPIRED").map(c => c.ErpVendorId));
  ok("RES-ESG", "évaluation ESG absente ou insuffisante", [...active].filter(v => !esg.has(v) || esg.get(v) >= 70 || certKo.has(v)).map(v => ({ v, esg: esg.get(v) ?? "absente" })));
}
assert.equal(Object.keys(hits).length, 11);
// Cas réglés à la main : chaque ligne calibrée porte _scenario = "illustratif" (et seulement elles).
const ill = t => T[t].filter(r => r._scenario === "illustratif");
assert.equal(ill("sap_purchasing_sources").length, 6, "source unique : 6 articles");
assert.equal(ill("sap_info_records").length, 6, "délai planifié allongé sur 6 articles");
assert.ok(ill("sap_material_documents").every(r => ["0000100003", "0000100006"].includes(r.Supplier)) && ill("sap_material_documents").length > 0, "dérive des délais");
assert.deepEqual(ill("tms_events").map(e => [e.EventCode, e.Location]), [["CONGESTION", "FRLEH"]], "port congestionné");
console.log("scénarios illustratifs marqués : source unique, dérive des délais, port congestionné");
console.log("test-alert-cases : 11 alertes déclenchées de façon reproductible");

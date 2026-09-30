// Tables standard ajoutées (résilience, pandémie, détroits, qualité) : cohérence avec
// les tables existantes, sémantique des champs standard et récit de démonstration.
import assert from "node:assert/strict";
import { DATASET, SOURCES } from "../lib/multisource-api.js";
import { EXTENSION_RESOURCES, SPIKE, WEEKS } from "../lib/si-extensions.js";

const T = DATASET.tables;
let n = 0; const ok = (name, fn) => { fn(); n++; console.log(`  ok ${name}`); };
const sap = new Set(T.sap_suppliers.map(s => s.Supplier)), refs = new Set(T.pim_products.map(p => p.internalRef));

ok("catalogue : 20 ressources ajoutées, source RH déclarée", () => {
  assert.equal(Object.values(EXTENSION_RESOURCES).reduce((s, r) => s + Object.keys(r).length, 0), 24);
  for (const [src, res] of Object.entries(EXTENSION_RESOURCES)) for (const [name, def] of Object.entries(res)) {
    assert.ok((SOURCES[src].entities ?? SOURCES[src].resources)[name], `${src}/${name}`);
    assert.ok(T[def.table].length > 0, def.table);
  }
  assert.match(SOURCES.hr.label, /SuccessFactors/);
});
ok("SAP : liste de sources (EORD) et fiches info-achat (EINA/EINE) cohérentes", () => {
  const src = T.sap_purchasing_sources, inf = T.sap_info_records;
  assert.ok(src.every(s => refs.has(s.Material) && sap.has(s.Supplier)));
  const mats = new Set(T.sap_purchase_orders.map(p => p.Material));
  for (const m of mats) assert.equal(src.filter(s => s.Material === m && s.SupplierIsFixed).length, 1, `une source fixe pour ${m}`);
  const withAlt = [...mats].filter(m => src.some(s => s.Material === m && !s.SupplierIsFixed)).length;
  assert.ok(withAlt / mats.size > 0.6 && withAlt < mats.size, "deux articles sur trois ont une alternative");
  for (const s of src) assert.ok(inf.some(i => i.Material === s.Material && i.Supplier === s.Supplier), "une fiche info-achat par source");
  assert.ok(inf.every(i => Number.isInteger(i.MaterialPlannedDeliveryDurn) && i.MaterialPlannedDeliveryDurn > 0 && i.NetPriceAmount > 0));
});
ok("SAP : délai MARC = délai de la source fixe ; coût standard < prix de vente PPR0", () => {
  for (const p of T.sap_product_supply) {
    const fixed = T.sap_purchasing_sources.find(s => s.Material === p.Product && s.SupplierIsFixed);
    assert.equal(p.PlannedDeliveryDurationInDays, T.sap_info_records.find(i => i.Material === p.Product && i.Supplier === fixed.Supplier).MaterialPlannedDeliveryDurn);
  }
  for (const v of T.sap_product_valuation) {
    const price = T.sap_sales_prices.find(c => c.Material === v.Product);
    assert.ok(v.StandardPrice < price.ConditionRateValue && price.ConditionType === "PPR0");
  }
  assert.ok(T.sap_sales_prices.every(c => T.pim_products.find(p => p.internalRef === c.Material).listPrice === c.ConditionRateValue));
});
ok("pandémie : pic de demande (OMS, lac) et amplification des commandes d'achat", () => {
  assert.equal(WEEKS.length, 52); assert.equal(WEEKS.at(-1).week, "2026-W39");
  const sku = "CLASP-AURORA", d = T.lake_demand_history.filter(r => r.ProductRef === sku), p = T.lake_purchase_history.filter(r => r.Material === sku);
  const hist = T.oms_order_history.filter(r => r.ProductRef === sku);
  for (const w of d) assert.equal(w.Quantity, hist.filter(h => WEEKS.find(x => x.week === w.Week) && h.OrderDate.slice(0, 10) === new Date(WEEKS.find(x => x.week === w.Week).monday + 2 * 86400e3).toISOString().slice(0, 10)).reduce((s, h) => s + h.Quantity, 0), `lac = somme OMS (${w.Week})`);
  const base = d.filter(w => !SPIKE[w.Week]).reduce((s, w) => s + w.Quantity, 0) / d.filter(w => !SPIKE[w.Week]).length;
  assert.ok(Math.max(...d.map(w => w.Quantity)) > 2.5 * base, "pic de demande");
  const cv = xs => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) / m; };
  for (const s of [...new Set(T.lake_demand_history.map(r => r.ProductRef))]) assert.ok(cv(T.lake_purchase_history.filter(r => r.Material === s).map(r => r.OrderedQty)) > cv(T.lake_demand_history.filter(r => r.ProductRef === s).map(r => r.Quantity)), `amplification ${s}`);
});
ok("RH : absentéisme du lac = absences EmployeeTime / effectif EmpJob, pic pendant la crise", () => {
  const loc = new Map(T.hr_emp_job.map(j => [j.userId, j.location]));
  for (const r of T.lake_absenteeism.filter((_, i) => i % 37 === 0)) {
    const monday = new Date(WEEKS.find(w => w.week === r.Week).monday).toISOString().slice(0, 10);
    assert.equal(r.AbsenceDays, T.hr_employee_time.filter(a => a.startDate === monday && loc.get(a.userId) === r.Site).reduce((s, a) => s + a.quantityInDays, 0));
    assert.equal(r.Headcount, T.hr_emp_job.filter(j => j.location === r.Site).length);
  }
  const avg = f => { const xs = T.lake_absenteeism.filter(f).map(r => r.AbsenteeismRate); return xs.reduce((a, b) => a + b, 0) / xs.length; };
  assert.ok(avg(r => SPIKE[r.Week]) > 2 * avg(r => !SPIKE[r.Week]));
  assert.ok(T.hr_employee_time.every(a => a.timeType === "SICK_LEAVE" && a.approvalStatus === "APPROVED"));
});
ok("détroits : lignes maritimes (UN/LOCODE), étapes, blocage de Suez et détours", () => {
  const locode = /^[A-Z]{2}[A-Z2-9]{3}$/;
  for (const r of T.tms_routes) for (const p of [r.OriginPort, r.DestinationPort, ...r.TransitPorts.split(";").filter(Boolean)]) assert.match(p, locode);
  assert.ok(T.tms_routes.some(r => r.TransitPorts.includes("EGSUZ")) && T.tms_routes.some(r => r.TransitPorts.includes("ZACPT")));
  const ships = new Set(T.tms_shipments.filter(s => s.TransportMode === "MARITIME").map(s => s.ShipmentId));
  assert.ok(T.tms_shipment_stages.every(s => ships.has(s.ShipmentId) && T.tms_routes.some(r => r.RouteId === s.RouteId)));
  assert.ok(T.tms_events.some(e => e.EventCode === "BLOCKED" && e.Location === "EGSUZ" && e.EndDate === null));
  const div = T.tms_events.filter(e => e.EventCode === "DIVERSION");
  assert.ok(div.length > 0 && div.every(e => ships.has(e.ShipmentId)));
});
ok("SRM et QMS : certificats, évaluations de risque (identifiant ERP), lots de contrôle", () => {
  for (const s of T.srm_suppliers) {
    const c = T.srm_certificates.filter(x => x.SrmId === s.SrmId);
    assert.equal(c.length, String(s.Certifications).split(";").filter(Boolean).length);
    assert.equal(c[0]?.ValidTo ?? s.CertificationExpiry, s.CertificationExpiry);
    assert.equal(T.srm_risk_assessments.find(r => r.SrmId === s.SrmId && r.RiskCategory === "OVERALL").Score, s.RiskScore);
  }
  assert.ok(T.srm_risk_assessments.every(r => sap.has(r.ErpVendorId)));
  assert.ok(T.srm_certificates.some(c => c.Status === "EXPIRED"));
  const pos = new Set(T.sap_purchase_orders.map(p => p.PurchaseOrder));
  assert.ok(T.qms_inspection_lots.every(l => pos.has(l.PurchaseOrder) && ["A", "R"].includes(l.InspectionLotUsageDecisionCode)));
  assert.ok(T.qms_inspection_lots.some(l => l.InspectionLotUsageDecisionCode === "R"));
});
ok("traçabilité de lot : réception (MSEG-CHARG) → lot de contrôle → livraison sortante WMS → commande client", () => {
  const batches = new Set(T.sap_material_documents.map(r => r.Batch));
  assert.ok(T.wms_outbound_deliveries.every(d => batches.has(d.BatchNumber)));
  const lines = new Map(T.oms_order_lines.map(l => [l.OrderLineId, l]));
  assert.ok(T.wms_outbound_deliveries.every(d => lines.get(d.OrderLineId)?.OrderId === d.OrderId && lines.get(d.OrderLineId).Quantity === d.ShippedQuantity));
  assert.ok(T.qms_inspection_lots.every(l => /^B\d{7}$/.test(l.Batch)));
});
console.log(`test-extensions : ${n} tests réussis`);

import { createService, json, route } from "../shared/http.mjs";

const sources = [
  { id: "erp", name: "Lucie ERP", baseUrl: "http://127.0.0.1:4101", metadata: "/metadata" },
  { id: "wms", name: "Lucie WMS", baseUrl: "http://127.0.0.1:4102", metadata: "/metadata" },
  { id: "tms", name: "Lucie TMS", baseUrl: "http://127.0.0.1:4103", metadata: "/metadata" },
  { id: "supplier-risk", name: "Lucie Supplier Risk", baseUrl: "http://127.0.0.1:4104", metadata: "/metadata" },
  { id: "file-hub", name: "Lucie Batch Hub", baseUrl: "http://127.0.0.1:4105", metadata: "/metadata" },
  { id: "event-broker", name: "Lucie Event Broker", baseUrl: "http://127.0.0.1:4100", metadata: "/topics" }
];

const ontology = {
  version: "1.0.0",
  objects: {
    Supplier: ["supplierId", "name", "country", "category", "criticality", "annualSpendEur", "singleSource"],
    SupplierRisk: ["supplierId", "financialRisk", "countryRisk", "qualityRisk", "capacityRisk", "overallRisk", "assessedAt"],
    PurchaseOrder: ["orderId", "supplierId", "sku", "quantity", "promisedDate", "status"],
    InventoryPosition: ["sku", "siteId", "onHand", "reserved", "available", "safetyStock", "dailyDemand", "daysOfCover", "updatedAt"],
    Shipment: ["shipmentId", "orderId", "carrier", "origin", "destination", "eta", "delayHours", "status"],
    SupplierPerformance: ["supplier_id", "period", "otif_pct", "defect_rate_pct", "lead_time_days", "confirmed_capacity_pct"],
    DemandForecast: ["sku", "site_id", "week", "forecast_qty", "confidence_pct"]
  },
  relations: [
    ["Supplier", "receives", "PurchaseOrder"], ["Supplier", "has", "SupplierRisk"], ["PurchaseOrder", "creates", "Shipment"],
    ["PurchaseOrder", "replenishes", "InventoryPosition"], ["Supplier", "measuredBy", "SupplierPerformance"], ["DemandForecast", "drives", "InventoryPosition"]
  ]
};

async function readJson(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }

createService({ name: "aura-lucie-gateway", port: 4191, routes: [
  route("GET", "/catalog", async ({ res }) => json(res, 200, { sources, auraContract: "1.0" })),
  route("GET", "/ontology/minimal", async ({ res }) => json(res, 200, ontology)),
  route("GET", "/metadata", async ({ res }) => {
    const results = await Promise.all(sources.map(async s => { try { return { sourceId: s.id, status: "AVAILABLE", metadata: await readJson(s.baseUrl + s.metadata) }; } catch (e) { return { sourceId: s.id, status: "UNAVAILABLE", error: String(e) }; } }));
    json(res, 200, { discoveredAt: new Date().toISOString(), sources: results });
  }),
  route("GET", "/snapshot/supply-chain", async ({ res }) => {
    const [suppliers, orders, inventory, shipments, risks, events] = await Promise.all([
      readJson("http://127.0.0.1:4101/api/suppliers"), readJson("http://127.0.0.1:4101/api/purchase-orders"),
      readJson("http://127.0.0.1:4102/api/inventory"), readJson("http://127.0.0.1:4103/api/shipments"),
      readJson("http://127.0.0.1:4104/api/risk-scores"), readJson("http://127.0.0.1:4100/events?since=0")
    ]);
    json(res, 200, { capturedAt: new Date().toISOString(), suppliers, purchaseOrders: orders, inventory, shipments, supplierRisks: risks, recentEvents: events.slice(-50) });
  }),
  route("GET", "/alerts", async ({ res }) => {
    const snapshot = await Promise.all([readJson("http://127.0.0.1:4102/api/inventory"), readJson("http://127.0.0.1:4103/api/shipments"), readJson("http://127.0.0.1:4104/api/risk-scores")]);
    const [inventory, shipments, risks] = snapshot;
    const alerts = [
      ...inventory.filter(x => x.available < x.safetyStock).map(x => ({ type: "STOCK_BELOW_SAFETY", severity: x.available < 0 ? "CRITICAL" : "MAJOR", object: { sku: x.sku, siteId: x.siteId }, facts: x, decisionNeed: "Transfer, replenish, allocate or accept shortage?" })),
      ...shipments.filter(x => x.delayHours > 24).map(x => ({ type: "CRITICAL_SHIPMENT_DELAY", severity: x.delayHours > 48 ? "CRITICAL" : "MAJOR", object: { shipmentId: x.shipmentId, orderId: x.orderId }, facts: x, decisionNeed: "Expedite, reroute, substitute or accept delay?" })),
      ...risks.filter(x => x.overallRisk >= 50).map(x => ({ type: "SUPPLIER_RISK_SPIKE", severity: x.overallRisk >= 70 ? "CRITICAL" : "MAJOR", object: { supplierId: x.supplierId }, facts: x, decisionNeed: "Secure, dual-source, replace or accept exposure?" }))
    ];
    json(res, 200, { evaluatedAt: new Date().toISOString(), alerts });
  })
] });

export const generatedAt = () => new Date().toISOString();

export const applications = [
  {
    id: "sap-s4",
    name: "Lucie ERP",
    marketReference: "SAP S/4HANA",
    role: "Suppliers, products and purchase orders",
    protocol: "REST / OData-like",
    baseUrl: "/api/data/sap-s4",
    auth: { type: "Basic Auth", username: "aura_demo", password: "LUCIE-DEMO-ONLY", tenant: "lumen-fr-100" },
    refresh: "On demand + every 15 min",
    status: "AVAILABLE",
    disclaimer: "Synthetic emulator; not affiliated with SAP. Credentials work only as demonstration metadata."
  },
  {
    id: "manhattan-wms",
    name: "Lucie WMS",
    marketReference: "Manhattan Active WM",
    role: "Inventory, reservations and safety stock",
    protocol: "REST + inventory events",
    baseUrl: "/api/data/manhattan-wms",
    auth: { type: "API Key", header: "x-api-key", apiKey: "lucie_wms_demo_key" },
    refresh: "Events + 5 min reconciliation",
    status: "AVAILABLE",
    disclaimer: "Synthetic emulator; not affiliated with Manhattan Associates."
  },
  {
    id: "blueyonder-tms",
    name: "Lucie TMS",
    marketReference: "Blue Yonder Transportation Management",
    role: "Shipments, ETA, carriers and disruptions",
    protocol: "REST + webhook",
    baseUrl: "/api/data/blueyonder-tms",
    auth: { type: "OAuth 2.0 Client Credentials", clientId: "aura-lucie-demo", clientSecret: "DEMO-NOT-A-SECRET", tokenUrl: "/api/token" },
    refresh: "Webhook + every 10 min",
    status: "AVAILABLE",
    disclaimer: "Synthetic emulator; not affiliated with Blue Yonder."
  },
  {
    id: "coupa-risk",
    name: "Lucie Supplier Risk",
    marketReference: "Coupa Supplier Risk",
    role: "Supplier financial, country, quality and capacity risk",
    protocol: "GraphQL-like query endpoint",
    baseUrl: "/api/data/coupa-risk",
    auth: { type: "Bearer token", token: "lucie_demo_bearer_token" },
    refresh: "Daily + event on material change",
    status: "AVAILABLE",
    disclaimer: "Synthetic emulator; not affiliated with Coupa."
  },
  {
    id: "snowflake-demand",
    name: "Lucie Demand Data Cloud",
    marketReference: "Snowflake",
    role: "Demand forecast, margin and sales history",
    protocol: "SQL API-like + CSV export",
    baseUrl: "/api/data/snowflake-demand",
    auth: { type: "Key pair", account: "lucie-demo.eu-west", warehouse: "AURA_DEMO_WH", role: "AURA_READER", privateKey: "DEMO-KEY-NOT-USABLE" },
    refresh: "Nightly batch",
    status: "AVAILABLE",
    disclaimer: "Synthetic emulator; not affiliated with Snowflake."
  },
  {
    id: "mulesoft-events",
    name: "Lucie Integration Hub",
    marketReference: "MuleSoft / Kafka patterns",
    role: "Business events and integration observability",
    protocol: "CloudEvents over HTTP",
    baseUrl: "/api/data/mulesoft-events",
    auth: { type: "Client ID enforcement", clientId: "aura-demo-client", clientSecret: "DEMO-ONLY" },
    refresh: "Near real time",
    status: "AVAILABLE",
    disclaimer: "Synthetic emulator inspired by common integration patterns; no vendor runtime is embedded."
  },
  {
    id: "rest-order-management",
    name: "Lucie Order API",
    marketReference: "Maison Lucie Order Management",
    role: "REST order orchestration",
    protocol: "REST API",
    baseUrl: "/api/data/rest-order-management",
    auth: { type: "Bearer token", token: "lucie_rest_demo_token" },
    refresh: "On demand",
    status: "AVAILABLE",
    disclaimer: "Synthetic REST API emulator."
  },
  {
    id: "kafka-stream",
    name: "Lucie Event Stream",
    marketReference: "Kafka-compatible event stream",
    role: "Publish and consume supply-chain events",
    protocol: "Kafka-compatible HTTP bridge",
    baseUrl: "/api/kafka",
    auth: { type: "Client ID enforcement", clientId: "aura-demo-client", clientSecret: "DEMO-ONLY" },
    refresh: "Near real time",
    status: "AVAILABLE",
    disclaimer: "HTTP bridge for a Kafka-shaped contract; no broker is embedded in Vercel."
  },
  {
    id: "legacy-soap",
    name: "Lucie Legacy ERP",
    marketReference: "SOAP ERP gateway",
    role: "Purchase-order interoperability",
    protocol: "SOAP 1.1",
    baseUrl: "/api/soap",
    auth: { type: "Basic Auth", username: "aura_demo", password: "LUCIE-DEMO-ONLY", tenant: "lumen-fr-100" },
    refresh: "On demand",
    status: "AVAILABLE",
    disclaimer: "Synthetic SOAP 1.1 emulator with WSDL discovery."
  },
  {
    id: "webhook-gateway",
    name: "Lucie Webhook Gateway",
    marketReference: "Webhook ingress",
    role: "Inbound business-event delivery",
    protocol: "Webhook over HTTPS",
    baseUrl: "/api/webhooks",
    auth: { type: "Client ID enforcement", clientId: "aura-demo-client", clientSecret: "DEMO-ONLY" },
    refresh: "Near real time",
    status: "AVAILABLE",
    disclaimer: "Synthetic webhook receiver with delivery persistence."
  }
];

export const datasets = {
  "sap-s4": {
    entity: "PurchaseOrder",
    records: [
      { purchaseOrderId: "PO-1042", supplierId: "SUP-001", supplier: "Tessitura Milano", sku: "BOX-PREMIUM", quantity: 2400, unitCost: 18.4, currency: "EUR", requestedDate: "2026-10-02", status: "RELEASED" },
      { purchaseOrderId: "PO-1043", supplierId: "SUP-003", supplier: "Shenzhen Atelier Components", sku: "CLASP-AURORA", quantity: 8000, unitCost: 3.2, currency: "EUR", requestedDate: "2026-10-01", status: "AT_RISK" },
      { purchaseOrderId: "PO-1044", supplierId: "SUP-002", supplier: "Maison Cuir du Nord", sku: "BAG-ORION", quantity: 750, unitCost: 42.8, currency: "EUR", requestedDate: "2026-10-08", status: "CONFIRMED" }
    ]
  },
  "manhattan-wms": {
    entity: "InventoryPosition",
    records: [
      { sku: "BOX-PREMIUM", siteId: "WH-PAR", onHand: 720, reserved: 430, available: 290, safetyStock: 600, dailyDemand: 160, daysOfCover: 1.8 },
      { sku: "BAG-ORION", siteId: "WH-LIL", onHand: 310, reserved: 80, available: 230, safetyStock: 250, dailyDemand: 36, daysOfCover: 6.4 },
      { sku: "CLASP-AURORA", siteId: "WH-PAR", onHand: 11200, reserved: 7100, available: 4100, safetyStock: 3500, dailyDemand: 520, daysOfCover: 7.9 }
    ]
  },
  "blueyonder-tms": {
    entity: "Shipment",
    records: [
      { shipmentId: "SHP-882", purchaseOrderId: "PO-1042", carrier: "EuroFreight", origin: "Milan", destination: "Paris", eta: "2026-10-03T08:00:00Z", delayHours: 36, status: "DELAYED" },
      { shipmentId: "SHP-883", purchaseOrderId: "PO-1043", carrier: "AsiaBridge", origin: "Shenzhen", destination: "Paris", eta: "2026-10-02T16:00:00Z", delayHours: 72, status: "CRITICAL" },
      { shipmentId: "SHP-884", purchaseOrderId: "PO-1044", carrier: "NordLog", origin: "Lille", destination: "Paris", eta: "2026-10-07T10:00:00Z", delayHours: 0, status: "ON_TIME" }
    ]
  },
  "coupa-risk": {
    entity: "SupplierRiskAssessment",
    records: [
      { supplierId: "SUP-001", supplier: "Tessitura Milano", financialRisk: 22, countryRisk: 18, qualityRisk: 14, capacityRisk: 88, overallRisk: 71, trend: "+19" },
      { supplierId: "SUP-002", supplier: "Maison Cuir du Nord", financialRisk: 12, countryRisk: 8, qualityRisk: 20, capacityRisk: 24, overallRisk: 18, trend: "-2" },
      { supplierId: "SUP-003", supplier: "Shenzhen Atelier Components", financialRisk: 48, countryRisk: 54, qualityRisk: 31, capacityRisk: 72, overallRisk: 57, trend: "+8" }
    ]
  },
  "snowflake-demand": {
    entity: "DemandForecast",
    records: [
      { sku: "BOX-PREMIUM", week: "2026-W40", baseline: 930, promoted: 1280, forecastConfidence: 0.73, grossMarginPct: 42 },
      { sku: "BAG-ORION", week: "2026-W40", baseline: 220, promoted: 245, forecastConfidence: 0.91, grossMarginPct: 58 },
      { sku: "CLASP-AURORA", week: "2026-W40", baseline: 3300, promoted: 4100, forecastConfidence: 0.68, grossMarginPct: 35 }
    ]
  },
  "mulesoft-events": {
    entity: "CloudEvent",
    records: [
      { id: "evt-9001", type: "shipment.delay.detected", source: "lucie-tms", subject: "SHP-883", time: "2026-09-25T08:14:00Z", severity: "critical" },
      { id: "evt-9002", type: "supplier.risk.changed", source: "lucie-risk", subject: "SUP-001", time: "2026-09-25T08:20:00Z", severity: "major" },
      { id: "evt-9003", type: "inventory.safety-stock.breached", source: "lucie-wms", subject: "BOX-PREMIUM@WH-PAR", time: "2026-09-25T08:31:00Z", severity: "major" }
    ]
  },
  "rest-order-management": {
    entity: "CustomerOrder",
    records: [
      { orderId: "ORD-7001", customer: "Maison Paris", sku: "BOX-PREMIUM", quantity: 120, status: "ALLOCATED", requestedDate: "2026-10-04" },
      { orderId: "ORD-7002", customer: "Maison Milan", sku: "BAG-ORION", quantity: 48, status: "PLANNED", requestedDate: "2026-10-08" },
      { orderId: "ORD-7003", customer: "Maison Lille", sku: "CLASP-AURORA", quantity: 320, status: "BACKORDERED", requestedDate: "2026-10-03" }
    ]
  },
  "kafka-stream": { entity: "KafkaMessage", records: [
    { offset: 0, topic: "lucie.supplychain.events", key: "SHP-883", value: { type: "shipment.delay.detected", severity: "critical" }, headers: { traceId: "tr-9001" }, publishedAt: "2026-09-25T08:14:00Z" },
    { offset: 1, topic: "lucie.supplychain.events", key: "SUP-001", value: { type: "supplier.risk.changed", severity: "major" }, headers: { traceId: "tr-9002" }, publishedAt: "2026-09-25T08:20:00Z" },
    { offset: 2, topic: "lucie.supplychain.events", key: "BOX-PREMIUM", value: { type: "inventory.cover.breached", severity: "major" }, headers: { traceId: "tr-9003" }, publishedAt: "2026-09-25T08:31:00Z" }
  ] },
  "legacy-soap": { entity: "SoapOperation", records: [
    { operation: "GetPurchaseOrders", wsdl: "/api/soap?wsdl", status: "AVAILABLE", lastCallAt: "2026-09-25T08:05:00Z" },
    { operation: "GetSuppliers", wsdl: "/api/soap?wsdl", status: "AVAILABLE", lastCallAt: "2026-09-25T08:08:00Z" },
    { operation: "UpdateDeliveryDate", wsdl: "/api/soap?wsdl", status: "AVAILABLE", lastCallAt: "2026-09-25T08:12:00Z" }
  ] },
  "webhook-gateway": { entity: "WebhookDelivery", records: [
    { deliveryId: "wh-3001", eventType: "shipment.updated", source: "lucie-tms", status: "DELIVERED", attempts: 1, deliveredAt: "2026-09-25T08:15:00Z" },
    { deliveryId: "wh-3002", eventType: "supplier.risk.changed", source: "lucie-risk", status: "DELIVERED", attempts: 1, deliveredAt: "2026-09-25T08:21:00Z" },
    { deliveryId: "wh-3003", eventType: "inventory.cover.breached", source: "lucie-wms", status: "RETRYING", attempts: 2, deliveredAt: null }
  ] },
  "webhook-inbox": { entity: "WebhookDelivery", records: [] }
};

export const ontology = {
  objects: ["Supplier", "Product", "PurchaseOrder", "InventoryPosition", "Shipment", "DemandForecast", "SupplierRiskAssessment"],
  relationships: [
    "Supplier fulfils PurchaseOrder",
    "PurchaseOrder procures Product",
    "Shipment transports PurchaseOrder",
    "InventoryPosition holds Product at Site",
    "DemandForecast predicts Product demand",
    "SupplierRiskAssessment evaluates Supplier"
  ],
  decisionSignals: ["supplier exposure", "stock coverage", "shipment delay", "forecast gap", "margin at risk"]
};

export function dataFor(id) {
  const app = applications.find(item => item.id === id);
  const data = datasets[id];
  return app && data ? { application: app, generatedAt: generatedAt(), ...data } : null;
}

export function resilienceAlerts() {
  return [
    { id: "ALT-001", severity: "CRITICAL", signal: "Supplier capacity risk spike", businessObject: "SUP-001", exposureEur: 1840000, decisionWindowHours: 24, decision: "Secure capacity, dual-source, substitute or accept exposure?", evidence: ["coupa-risk", "sap-s4"] },
    { id: "ALT-002", severity: "CRITICAL", signal: "Critical inbound shipment delay", businessObject: "SHP-883", exposureEur: 920000, decisionWindowHours: 8, decision: "Expedite, reroute, substitute or reallocate inventory?", evidence: ["blueyonder-tms", "sap-s4", "manhattan-wms"] },
    { id: "ALT-003", severity: "MAJOR", signal: "Safety stock breached", businessObject: "BOX-PREMIUM@WH-PAR", exposureEur: 410000, decisionWindowHours: 12, decision: "Transfer, replenish, allocate or accept shortage?", evidence: ["manhattan-wms", "snowflake-demand"] }
  ];
}

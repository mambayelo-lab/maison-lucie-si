export const generatedAt = () => new Date().toISOString();

export const applications = [
  {
    id: "sap-s4",
    name: "Lucie S/4 Core",
    marketReference: "SAP S/4HANA",
    role: "Suppliers, products and purchase orders",
    protocol: "REST / OData-like",
    baseUrl: "/api/data/sap-s4",
    auth: { type: "Basic Auth", username: "aura_demo", password: "LUCIE-DEMO-ONLY", tenant: "lucie-fr-100" },
    refresh: "On demand + every 15 min",
    status: "AVAILABLE",
    disclaimer: "Synthetic emulator; not affiliated with SAP. Credentials work only as demonstration metadata."
  },
  {
    id: "manhattan-wms",
    name: "Lucie Active Warehouse",
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
    name: "Lucie Luminate Transport",
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
    name: "Lucie SpendGuard",
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
    name: "Lucie Data Cloud",
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
    name: "Lucie Anypoint Hub",
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
    name: "Lucie Fusion Order Cloud",
    marketReference: "Oracle Fusion Cloud Order Management-inspired",
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
    name: "Lucie Confluent Stream",
    marketReference: "Confluent Cloud / Apache Kafka-inspired",
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
    name: "Lucie ECC Bridge",
    marketReference: "SAP ECC / SOAP-inspired",
    role: "Purchase-order interoperability",
    protocol: "SOAP 1.1",
    baseUrl: "/api/soap",
    auth: { type: "Basic Auth", username: "aura_demo", password: "LUCIE-DEMO-ONLY", tenant: "lucie-fr-100" },
    refresh: "On demand",
    status: "AVAILABLE",
    disclaimer: "Synthetic SOAP 1.1 emulator with WSDL discovery."
  },
  {
    id: "webhook-gateway",
    name: "Lucie Integration Webhooks",
    marketReference: "Boomi / MuleSoft webhook patterns",
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


const additionalRecords = {
  "sap-s4": [
    { purchaseOrderId: "PO-1045", supplierId: "SUP-004", supplier: "Nordic Packaging AB", sku: "PCH-NOVA", quantity: 5200, unitCost: 1.9, currency: "EUR", requestedDate: "2026-10-05", status: "CONFIRMED" },
    { purchaseOrderId: "PO-1046", supplierId: "SUP-005", supplier: "Porto Leather Works", sku: "BAG-LUNA", quantity: 980, unitCost: 36.7, currency: "EUR", requestedDate: "2026-10-11", status: "RELEASED" },
    { purchaseOrderId: "PO-1047", supplierId: "SUP-006", supplier: "Atlas Metalworks", sku: "BUCKLE-ATLAS", quantity: 12400, unitCost: 2.6, currency: "EUR", requestedDate: "2026-10-06", status: "AT_RISK" },
    { purchaseOrderId: "PO-1048", supplierId: "SUP-007", supplier: "Rhône Textile Lab", sku: "LINING-RIVE", quantity: 6400, unitCost: 4.1, currency: "EUR", requestedDate: "2026-10-14", status: "PLANNED" }
  ],
  "manhattan-wms": [
    { sku: "PCH-NOVA", siteId: "WH-LIL", onHand: 1600, reserved: 420, available: 1180, safetyStock: 900, dailyDemand: 130, daysOfCover: 9.1 },
    { sku: "BAG-LUNA", siteId: "WH-MIL", onHand: 410, reserved: 250, available: 160, safetyStock: 300, dailyDemand: 52, daysOfCover: 3.1 },
    { sku: "BUCKLE-ATLAS", siteId: "WH-PAR", onHand: 8900, reserved: 7600, available: 1300, safetyStock: 2600, dailyDemand: 740, daysOfCover: 1.8 },
    { sku: "LINING-RIVE", siteId: "WH-LYO", onHand: 4700, reserved: 900, available: 3800, safetyStock: 1800, dailyDemand: 290, daysOfCover: 13.1 }
  ],
  "blueyonder-tms": [
    { shipmentId: "SHP-885", purchaseOrderId: "PO-1045", carrier: "BalticRoad", origin: "Stockholm", destination: "Lille", eta: "2026-10-06T12:00:00Z", delayHours: 4, status: "ON_TIME" },
    { shipmentId: "SHP-886", purchaseOrderId: "PO-1046", carrier: "IberiaCargo", origin: "Porto", destination: "Paris", eta: "2026-10-10T19:00:00Z", delayHours: 18, status: "WATCH" },
    { shipmentId: "SHP-887", purchaseOrderId: "PO-1047", carrier: "AtlasMaritime", origin: "Tunis", destination: "Marseille", eta: "2026-10-08T06:00:00Z", delayHours: 54, status: "CRITICAL" },
    { shipmentId: "SHP-888", purchaseOrderId: "PO-1048", carrier: "RhôneExpress", origin: "Lyon", destination: "Lille", eta: "2026-10-13T09:00:00Z", delayHours: 0, status: "ON_TIME" }
  ],
  "coupa-risk": [
    { supplierId: "SUP-004", supplier: "Nordic Packaging AB", financialRisk: 16, countryRisk: 9, qualityRisk: 11, capacityRisk: 34, overallRisk: 24, trend: "+1" },
    { supplierId: "SUP-005", supplier: "Porto Leather Works", financialRisk: 28, countryRisk: 14, qualityRisk: 26, capacityRisk: 49, overallRisk: 38, trend: "+6" },
    { supplierId: "SUP-006", supplier: "Atlas Metalworks", financialRisk: 41, countryRisk: 63, qualityRisk: 29, capacityRisk: 81, overallRisk: 68, trend: "+14" },
    { supplierId: "SUP-007", supplier: "Rhône Textile Lab", financialRisk: 9, countryRisk: 7, qualityRisk: 13, capacityRisk: 18, overallRisk: 12, trend: "-3" }
  ],
  "snowflake-demand": [
    { sku: "PCH-NOVA", week: "2026-W40", baseline: 1180, promoted: 1260, forecastConfidence: 0.88, grossMarginPct: 49 },
    { sku: "BAG-LUNA", week: "2026-W40", baseline: 310, promoted: 520, forecastConfidence: 0.61, grossMarginPct: 51 },
    { sku: "BUCKLE-ATLAS", week: "2026-W40", baseline: 5600, promoted: 6900, forecastConfidence: 0.66, grossMarginPct: 33 },
    { sku: "LINING-RIVE", week: "2026-W40", baseline: 2450, promoted: 2380, forecastConfidence: 0.93, grossMarginPct: 46 }
  ],
  "mulesoft-events": [
    { id: "evt-9004", type: "purchase-order.risk.detected", source: "lucie-s4-core", subject: "PO-1047", time: "2026-09-26T06:10:00Z", severity: "major" },
    { id: "evt-9005", type: "forecast.bias.changed", source: "lucie-data-cloud", subject: "BAG-LUNA", time: "2026-09-26T06:18:00Z", severity: "major" },
    { id: "evt-9006", type: "inventory.cover.breached", source: "lucie-active-warehouse", subject: "BUCKLE-ATLAS@WH-PAR", time: "2026-09-26T06:24:00Z", severity: "critical" },
    { id: "evt-9007", type: "shipment.delay.detected", source: "lucie-luminate-transport", subject: "SHP-887", time: "2026-09-26T06:31:00Z", severity: "critical" }
  ],
  "rest-order-management": [
    { orderId: "ORD-7004", customer: "Maison Bruxelles", sku: "PCH-NOVA", quantity: 260, status: "ALLOCATED", requestedDate: "2026-10-06" },
    { orderId: "ORD-7005", customer: "Maison Montréal", sku: "BAG-LUNA", quantity: 76, status: "PLANNED", requestedDate: "2026-10-12" },
    { orderId: "ORD-7006", customer: "Maison Dakar", sku: "BUCKLE-ATLAS", quantity: 1200, status: "BACKORDERED", requestedDate: "2026-10-07" },
    { orderId: "ORD-7007", customer: "Maison Lyon", sku: "LINING-RIVE", quantity: 540, status: "ALLOCATED", requestedDate: "2026-10-13" }
  ],
  "kafka-stream": [
    { offset: 3, topic: "lucie.supplychain.events", key: "PO-1047", value: { type: "purchase-order.risk.detected", severity: "major" }, headers: { traceId: "tr-9004" }, publishedAt: "2026-09-26T06:10:00Z" },
    { offset: 4, topic: "lucie.supplychain.events", key: "BAG-LUNA", value: { type: "forecast.bias.changed", severity: "major" }, headers: { traceId: "tr-9005" }, publishedAt: "2026-09-26T06:18:00Z" },
    { offset: 5, topic: "lucie.supplychain.events", key: "BUCKLE-ATLAS", value: { type: "inventory.cover.breached", severity: "critical" }, headers: { traceId: "tr-9006" }, publishedAt: "2026-09-26T06:24:00Z" },
    { offset: 6, topic: "lucie.supplychain.events", key: "SHP-887", value: { type: "shipment.delay.detected", severity: "critical" }, headers: { traceId: "tr-9007" }, publishedAt: "2026-09-26T06:31:00Z" }
  ],
  "legacy-soap": [
    { operation: "GetMaterialAvailability", wsdl: "/api/soap?wsdl", status: "AVAILABLE", lastCallAt: "2026-09-26T06:02:00Z" },
    { operation: "GetInboundDeliveries", wsdl: "/api/soap?wsdl", status: "AVAILABLE", lastCallAt: "2026-09-26T06:04:00Z" },
    { operation: "GetVendorMaster", wsdl: "/api/soap?wsdl", status: "AVAILABLE", lastCallAt: "2026-09-26T06:06:00Z" },
    { operation: "ConfirmScheduleLine", wsdl: "/api/soap?wsdl", status: "AVAILABLE", lastCallAt: "2026-09-26T06:08:00Z" }
  ],
  "webhook-gateway": [
    { deliveryId: "wh-3004", eventType: "purchase-order.risk.detected", source: "lucie-s4-core", status: "DELIVERED", attempts: 1, deliveredAt: "2026-09-26T06:11:00Z" },
    { deliveryId: "wh-3005", eventType: "forecast.bias.changed", source: "lucie-data-cloud", status: "DELIVERED", attempts: 1, deliveredAt: "2026-09-26T06:19:00Z" },
    { deliveryId: "wh-3006", eventType: "inventory.cover.breached", source: "lucie-active-warehouse", status: "RETRYING", attempts: 2, deliveredAt: null },
    { deliveryId: "wh-3007", eventType: "shipment.delay.detected", source: "lucie-luminate-transport", status: "DELIVERED", attempts: 1, deliveredAt: "2026-09-26T06:32:00Z" }
  ]
};
for (const [appId, records] of Object.entries(additionalRecords)) {
  if (datasets[appId]) datasets[appId].records.push(...records);
}

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

import alertsHandler from "../api/alerts.js";
import catalogHandler from "../api/catalog.js";
import dataHandler from "../api/data/[app].js";
import eventsHandler from "../api/events.js";
import fileHandler from "../api/files/[name].js";
import healthHandler from "../api/health.js";
import kafkaHandler from "../api/kafka.js";
import soapHandler from "../api/soap.js";
import tokenHandler from "../api/token.js";
import webhookHandler from "../api/webhooks.js";
import graphqlHandler from "../api/graphql.js";
import batchHandler from "../api/batch.js";
import openapiHandler from "../api/openapi.js";

function responseMock() {
  return {
    statusCode: 200, headers: {}, payload: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = String(value); },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
    send(value) { this.payload = value; return this; },
    end() { return this; },
  };
}

async function invoke(handler, { method = "GET", query = {}, headers = {}, body, url } = {}) {
  const response = responseMock();
  await handler({ method, query, url, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), body }, response);
  return response;
}

function expect(condition, message) { if (!condition) throw new Error(message); }

const GATEWAY = { authorization: "Bearer lucie_aura_gateway_demo_token" };
const CLIENT = { "x-client-id": "aura-demo-client", "x-client-secret": "DEMO-ONLY" };
const ERP_AUTH = `Basic ${Buffer.from("aura_demo:LUCIE-DEMO-ONLY").toString("base64")}`;

const health = await invoke(healthHandler);
expect(health.statusCode === 200 && health.payload.status === "ok", "Health contract failed");

const catalog = await invoke(catalogHandler);
expect(catalog.statusCode === 200 && catalog.payload.applications.length >= 10, "Catalogue must expose the complete SI");
expect(catalog.payload.persistence, "Catalogue must report persistence mode");
expect(catalog.payload.applications.every(app => app.config), "Every application must expose its demo connection configuration");
expect(catalog.payload.applications.every(app => app.config.syntheticCredentials === true), "Credentials must be explicitly marked synthetic");

const noAuth = await invoke(dataHandler, { query: { app: "sap-s4" } });
expect(noAuth.statusCode === 401, "Source endpoint must enforce authentication");
const erp = await invoke(dataHandler, { query: { app: "sap-s4" }, headers: { authorization: ERP_AUTH, "x-lucie-tenant": "lucie-fr-100" } });
expect(erp.statusCode === 200 && erp.payload.records.length >= 1, "ERP authenticated contract failed");

const wms = await invoke(dataHandler, { query: { app: "manhattan-wms" }, headers: { "x-api-key": "lucie_wms_demo_key" } });
expect(wms.statusCode === 200, "WMS authenticated contract failed");
const originalRecords = wms.payload.records;
const changedRecords = originalRecords.map((row, index) => index === 0 ? { ...row, available: Number(row.available) + 7 } : row);
const patched = await invoke(dataHandler, { method: "PATCH", query: { app: "manhattan-wms" }, headers: { ...GATEWAY, "content-type": "application/json" }, body: { records: changedRecords } });
expect(patched.statusCode === 200, "Dataset PATCH failed");
const reread = await invoke(dataHandler, { query: { app: "manhattan-wms" }, headers: { "x-api-key": "lucie_wms_demo_key" } });
expect(reread.payload.records[0].available === changedRecords[0].available, "Patched SI value must be visible on the next read");
await invoke(dataHandler, { method: "PATCH", query: { app: "manhattan-wms" }, headers: { ...GATEWAY, "content-type": "application/json" }, body: { records: originalRecords } });

const changedKey = "lucie_wms_rotated_demo_key";
const configPatch = await invoke(catalogHandler, { method: "PATCH", headers: { ...GATEWAY, "content-type": "application/json" }, body: { appId: "manhattan-wms", patch: { auth: { apiKey: changedKey } } } });
expect(configPatch.statusCode === 200 && configPatch.payload.config.auth.apiKey === changedKey, "Connection configuration PATCH failed");
const oldKeyRead = await invoke(dataHandler, { query: { app: "manhattan-wms" }, headers: { "x-api-key": "lucie_wms_demo_key" } });
expect(oldKeyRead.statusCode === 401, "Old credential must stop working after rotation");
const newKeyRead = await invoke(dataHandler, { query: { app: "manhattan-wms" }, headers: { "x-api-key": changedKey } });
expect(newKeyRead.statusCode === 200, "Rotated credential must be used by the application API");
await invoke(catalogHandler, { method: "POST", headers: { ...GATEWAY, "content-type": "application/json" }, body: { appId: "manhattan-wms", action: "reset" } });

const token = await invoke(tokenHandler, { method: "POST", body: "grant_type=client_credentials&client_id=aura-lucie-demo&client_secret=DEMO-NOT-A-SECRET" });
expect(token.statusCode === 200 && token.payload.token_type === "Bearer", "OAuth token contract failed");
const tms = await invoke(dataHandler, { query: { app: "blueyonder-tms" }, headers: { authorization: `Bearer ${token.payload.access_token}` } });
expect(tms.statusCode === 200, "TMS authenticated contract failed");

const alerts = await invoke(alertsHandler, { headers: GATEWAY });
expect(alerts.statusCode === 200 && alerts.payload.alerts.length >= 1, "Alert contract failed");

const events = await invoke(eventsHandler, { headers: CLIENT });
expect(events.statusCode === 200 && JSON.parse(events.payload).every(item => item.specversion === "1.0"), "CloudEvents contract failed");

const kafka = await invoke(kafkaHandler, { headers: CLIENT, url: "/api/kafka" });
expect(kafka.statusCode === 200 && kafka.payload.protocol === "kafka-compatible-http", "Kafka-compatible flow failed");

const soap = await invoke(soapHandler, { method: "POST", headers: { authorization: ERP_AUTH, "x-lucie-tenant": "lucie-fr-100" }, body: "<GetPurchaseOrders/>" });
expect(soap.statusCode === 200 && String(soap.payload).includes("GetPurchaseOrdersResponse"), "SOAP flow failed");

const webhook = await invoke(webhookHandler, { method: "POST", headers: CLIENT, body: { event: "test.integration", payload: { ok: true } } });
expect(webhook.statusCode === 202 && webhook.payload.accepted === true, "Webhook flow failed");

const csv = await invoke(fileHandler, { query: { name: "demand-forecast.csv" }, headers: { "x-api-key": "lucie_files_demo_key" } });
expect(csv.statusCode === 200 && String(csv.payload).includes("forecast_qty"), "CSV contract failed");

const preflight = await invoke(dataHandler, { method: "OPTIONS", query: { app: "sap-s4" }, headers: { origin: "https://aura-decision-zen.vercel.app" } });
expect(preflight.statusCode === 204, "CORS preflight failed");

// ── Multi-protocole par application ─────────────────────────────────────
const TMS_TOKEN = token.payload.access_token;
const APP_AUTH = {
  "sap-s4": { authorization: ERP_AUTH, "x-lucie-tenant": "lucie-fr-100" },
  "manhattan-wms": { "x-api-key": "lucie_wms_demo_key" },
  "blueyonder-tms": { authorization: `Bearer ${TMS_TOKEN}` },
  "coupa-risk": { authorization: "Bearer lucie_demo_bearer_token" },
  "snowflake-demand": { authorization: "Bearer DEMO-KEY-NOT-USABLE", "x-lucie-account": "lucie-demo.eu-west", "x-lucie-warehouse": "AURA_DEMO_WH", "x-lucie-role": "AURA_READER" },
  "mulesoft-events": CLIENT,
  "rest-order-management": { authorization: "Bearer lucie_rest_demo_token" },
  "kafka-stream": CLIENT,
  "legacy-soap": { authorization: ERP_AUTH, "x-lucie-tenant": "lucie-fr-100" },
  "webhook-gateway": CLIENT,
};
expect(catalog.payload.applications.every(app => ["rest", "soap", "graphql", "events", "file", "batch"].every(p => app.protocols?.[p]?.url)), "Catalogue must publish every protocol per application");

// Données enrichies : seuils franchis ET valeurs normales ; ancres Aura inchangées.
const riskRows = (await invoke(dataHandler, { query: { app: "coupa-risk" }, headers: APP_AUTH["coupa-risk"] })).payload.records;
expect(riskRows.length >= 12 && riskRows.find(r => r.supplierId === "SUP-001").capacityRisk === 88 && riskRows.find(r => r.supplierId === "SUP-003").overallRisk === 57, "Risk anchors must be preserved");
expect(riskRows.some(r => r.capacityRisk >= 70) && riskRows.some(r => r.capacityRisk < 40) && riskRows.every(r => typeof r.geopoliticalRisk === "number"), "Risk data must mix critical and normal values");
const wmsRows = (await invoke(dataHandler, { query: { app: "manhattan-wms" }, headers: APP_AUTH["manhattan-wms"] })).payload.records;
expect(wmsRows.find(r => r.sku === "BAG-ORION").siteId === "WH-LIL" && wmsRows.some(r => r.daysOfCover < 3) && wmsRows.some(r => r.daysOfCover > 10), "Inventory cover must include low and healthy positions");
const tmsRows = (await invoke(dataHandler, { query: { app: "blueyonder-tms" }, headers: APP_AUTH["blueyonder-tms"] })).payload.records;
expect(tmsRows.find(r => r.shipmentId === "SHP-883").delayHours === 72 && tmsRows.some(r => r.delayHours === 0) && tmsRows.every(r => r.plannedEta), "Shipments must include delays, on-time lines and planned ETA");
const demandRows = (await invoke(dataHandler, { query: { app: "snowflake-demand" }, headers: APP_AUTH["snowflake-demand"] })).payload.records;
expect(demandRows.find(r => r.sku === "BOX-PREMIUM").week === "2026-W40" && demandRows.find(r => r.sku === "BOX-PREMIUM").promoted === 1280, "Forecast anchor must stay first");
const suppliers = await invoke(dataHandler, { query: { app: "sap-s4", table: "Supplier" }, headers: APP_AUTH["sap-s4"] });
expect(suppliers.statusCode === 200 && suppliers.payload.entity === "Supplier" && suppliers.payload.records.length >= 12 && new Set(suppliers.payload.records.map(s => s.country)).size >= 8, "Supplier master table must be exposed with varied countries");
const unknownTable = await invoke(dataHandler, { query: { app: "sap-s4", table: "Nope" }, headers: APP_AUTH["sap-s4"] });
expect(unknownTable.statusCode === 404, "Unknown table must return 404");

const summary = {};
for (const app of catalog.payload.applications) {
  const auth = APP_AUTH[app.id];
  const tables = app.tables;
  // SOAP
  const soapApp = await invoke(soapHandler, { method: "POST", query: { app: app.id }, headers: { ...auth, "content-type": "text/xml" }, body: `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetRecords><table>${tables[0]}</table><limit>3</limit></GetRecords></soap:Body></soap:Envelope>` });
  expect(soapApp.statusCode === 200 && String(soapApp.payload).includes("GetRecordsResponse") && String(soapApp.payload).includes(`<${tables[0]}>`), `SOAP GetRecords failed for ${app.id}`);
  const wsdlApp = await invoke(soapHandler, { query: { wsdl: "", app: app.id } });
  expect(wsdlApp.statusCode === 200 && String(wsdlApp.payload).includes("<definitions"), `WSDL failed for ${app.id}`);
  const soapDenied = await invoke(soapHandler, { method: "POST", query: { app: app.id }, headers: {}, body: "<GetRecords/>" });
  expect(soapDenied.statusCode === 401, `SOAP must enforce auth for ${app.id}`);
  // GraphQL
  const field = app.protocols.graphql.rootField;
  const gql = await invoke(graphqlHandler, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: { query: `{ ${field} { entity tables } }` } });
  const gqlBody = JSON.parse(gql.payload);
  expect(gql.statusCode === 200 && !gqlBody.errors && gqlBody.data[field].entity === tables[0], `GraphQL failed for ${app.id}`);
  const gqlDenied = JSON.parse((await invoke(graphqlHandler, { method: "POST", body: { query: `{ ${field} { entity } }` } })).payload);
  expect(gqlDenied.data[field] === null && gqlDenied.errors[0].extensions.code === "UNAUTHORIZED", `GraphQL must enforce auth for ${app.id}`);
  // Événements
  const topic = app.protocols.events.topics[0];
  const stream = await invoke(kafkaHandler, { query: { topic, offset: "1", limit: "2" }, headers: auth, url: `/api/kafka?topic=${topic}&offset=1&limit=2` });
  expect(stream.statusCode === 200 && stream.payload.offset === 1 && stream.payload.messages.length <= 2 && stream.payload.messages.every(m => m.value.specversion === "1.0"), `Event stream failed for ${app.id}`);
  const denied = await invoke(kafkaHandler, { query: { topic }, headers: {}, url: `/api/kafka?topic=${topic}` });
  expect(denied.statusCode === 401, `Event stream must enforce auth for ${app.id}`);
  // Fichier
  const file = await invoke(fileHandler, { query: { name: `${app.id}.csv` }, headers: auth });
  expect(file.statusCode === 200 && String(file.payload).split("\n").length >= 2, `CSV export failed for ${app.id}`);
  // Batch
  const job = await invoke(batchHandler, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: { app: app.id, format: "ndjson" } });
  expect(job.statusCode === 202 && job.payload.status === "SUCCEEDED", `Batch submit failed for ${app.id}`);
  const status = await invoke(batchHandler, { query: { job: job.payload.jobId }, headers: auth });
  expect(status.statusCode === 200 && status.payload.recordCount === job.payload.recordCount, `Batch status failed for ${app.id}`);
  const result = await invoke(batchHandler, { query: { job: job.payload.jobId, result: "1" }, headers: auth });
  const lines = String(result.payload).trim().split("\n").filter(Boolean);
  expect(result.statusCode === 200 && lines.length === job.payload.recordCount && lines.every(line => JSON.parse(line)), `Batch NDJSON result failed for ${app.id}`);
  const batchDenied = await invoke(batchHandler, { query: { job: job.payload.jobId }, headers: {} });
  expect(batchDenied.statusCode === 401, `Batch must enforce auth for ${app.id}`);
  summary[app.id] = { tables: tables.length, rows: job.payload.recordCount };
}

// GraphQL : filtres, introspection, SDL, erreurs.
const gqlFilter = JSON.parse((await invoke(graphqlHandler, { method: "POST", headers: GATEWAY, body: { query: "query($s: String) { coupaRisk { supplierRiskAssessments(supplierId: $s) { supplierId capacityRisk overallRisk } } blueyonderTms { disruptions(type: \"PORT_STRIKE\") { disruptionId impactedShipments } } }", variables: { s: "SUP-001" } } })).payload);
expect(gqlFilter.data.coupaRisk.supplierRiskAssessments[0].capacityRisk === 88 && gqlFilter.data.blueyonderTms.disruptions[0].disruptionId === "DIS-001", "GraphQL filters/variables failed");
const intro = JSON.parse((await invoke(graphqlHandler, { method: "POST", body: { query: "{ __schema { queryType { name } types { name kind } } __type(name: \"Shipment\") { fields { name type { name } } } }" } })).payload);
expect(intro.data.__schema.queryType.name === "Query" && intro.data.__type.fields.some(f => f.name === "delayHours" && f.type.name === "Int"), "GraphQL introspection failed");
const sdl = await invoke(graphqlHandler, { query: { sdl: "" }, url: "/api/graphql?sdl" });
expect(sdl.statusCode === 200 && String(sdl.payload).includes("type Query"), "GraphQL SDL failed");
const bad = await invoke(graphqlHandler, { method: "POST", body: { query: "{ sapS4 { " } });
expect(bad.statusCode === 400, "GraphQL syntax errors must return 400");

// SOAP historique + opérations nommées.
const soapNamed = await invoke(soapHandler, { method: "POST", headers: { authorization: `Bearer ${TMS_TOKEN}` }, body: "<GetShipments><limit>2</limit></GetShipments>" });
expect(soapNamed.statusCode === 200 && String(soapNamed.payload).includes("<Shipment>"), "SOAP named operation failed");
expect(String(soap.payload).includes("<orders><PurchaseOrder>"), "Legacy SOAP format must be preserved");

// Événements : topics, CloudEvents, publication.
const topics = await invoke(kafkaHandler, { query: { topics: "" }, headers: CLIENT, url: "/api/kafka?topics" });
expect(topics.statusCode === 200 && topics.payload.topics.length >= 15, "Topic listing failed");
const legacyTopic = await invoke(kafkaHandler, { headers: CLIENT, url: "/api/kafka?offset=2&limit=3", query: { offset: "2", limit: "3" } });
expect(legacyTopic.payload.messages.length === 3 && legacyTopic.payload.messages[0].offset === 2, "Legacy topic pagination failed");
const ce = await invoke(kafkaHandler, { headers: APP_AUTH["blueyonder-tms"], url: "/api/kafka?topic=lucie.blueyonder-tms.disruption&format=cloudevents", query: { topic: "lucie.blueyonder-tms.disruption", format: "cloudevents" } });
expect(ce.statusCode === 200 && JSON.parse(ce.payload).every(e => e.specversion === "1.0" && e.data.synthetic === true), "CloudEvents topic format failed");
const readOnly = await invoke(kafkaHandler, { method: "POST", headers: CLIENT, url: "/api/kafka?topic=lucie.sap-s4.supplier", query: { topic: "lucie.sap-s4.supplier" }, body: { key: "x" } });
expect(readOnly.statusCode === 403, "Application topics must be read-only");

// Fichiers : tables secondaires, index, CSV historiques enrichis.
const tableCsv = await invoke(fileHandler, { query: { name: "coupa-risk.SupplierScorecard.csv" }, headers: { "x-api-key": "lucie_files_demo_key" } });
expect(tableCsv.statusCode === 200 && String(tableCsv.payload).startsWith("supplierId,"), "Secondary table CSV failed");
const scorecard = await invoke(fileHandler, { query: { name: "supplier-scorecard.csv" }, headers: { "x-api-key": "lucie_files_demo_key" } });
expect(String(scorecard.payload).startsWith("supplier_id,period,otif_pct,defect_rate_pct,lead_time_days,confirmed_capacity_pct\nSUP-001,2026-09,91.2,1.4,18,84"), "Legacy scorecard CSV must keep its columns and head rows");
const csvDenied = await invoke(fileHandler, { query: { name: "sap-s4.csv" }, headers: { "x-api-key": "lucie_wms_demo_key" } });
expect(csvDenied.statusCode === 401, "Per-app CSV must enforce auth");

// Batch CSV filtré.
const csvJob = await invoke(batchHandler, { method: "POST", headers: APP_AUTH["sap-s4"], body: { app: "sap-s4", table: "PurchaseOrder", format: "csv", filter: { status: "AT_RISK" } } });
const csvResult = await invoke(batchHandler, { query: { job: csvJob.payload.jobId, result: "1" }, headers: APP_AUTH["sap-s4"] });
expect(csvJob.payload.recordCount >= 4 && String(csvResult.payload).split("\n").slice(1).filter(Boolean).every(line => line.includes("AT_RISK")), "Batch CSV filter failed");
const tampered = await invoke(batchHandler, { query: { job: csvJob.payload.jobId.replace(/.$/, c => c === "A" ? "B" : "A") }, headers: APP_AUTH["sap-s4"] });
expect(tampered.statusCode === 404, "Tampered job ids must be rejected");

const openapi = await invoke(openapiHandler);
expect(["/api/graphql", "/api/batch", "/api/soap", "/api/kafka"].every(path => openapi.payload.paths[path]), "OpenAPI must document every protocol");
const auraOrigin = await invoke(dataHandler, { method: "OPTIONS", query: { app: "sap-s4" }, headers: { origin: "https://aura-decider.vercel.app" } });
expect(auraOrigin.statusCode === 204 && auraOrigin.headers["access-control-allow-origin"] === "https://aura-decider.vercel.app", "aura-decider origin must be allowed");

console.log(JSON.stringify({ perApplication: summary }, null, 2));
console.log(JSON.stringify({
  status: "PASS",
  applications: catalog.payload.applications.length,
  persistence: catalog.payload.persistence,
  valuesPatchRoundTrip: true,
  credentialRotationRoundTrip: true,
  protocols: ["REST", "OAuth2", "CloudEvents", "Kafka-compatible", "SOAP", "GraphQL", "Batch", "Webhook", "CSV"],
}, null, 2));

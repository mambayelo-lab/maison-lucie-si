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

const GATEWAY = { authorization: "Bearer lumen_aura_gateway_demo_token" };
const CLIENT = { "x-client-id": "aura-demo-client", "x-client-secret": "DEMO-ONLY" };
const ERP_AUTH = `Basic ${Buffer.from("aura_demo:LUMEN-DEMO-ONLY").toString("base64")}`;

const health = await invoke(healthHandler);
expect(health.statusCode === 200 && health.payload.status === "ok", "Health contract failed");

const catalog = await invoke(catalogHandler);
expect(catalog.statusCode === 200 && catalog.payload.applications.length >= 10, "Catalogue must expose the complete SI");
expect(catalog.payload.persistence, "Catalogue must report persistence mode");
expect(catalog.payload.applications.every(app => app.config), "Every application must expose its demo connection configuration");
expect(catalog.payload.applications.every(app => app.config.syntheticCredentials === true), "Credentials must be explicitly marked synthetic");

const noAuth = await invoke(dataHandler, { query: { app: "sap-s4" } });
expect(noAuth.statusCode === 401, "Source endpoint must enforce authentication");
const erp = await invoke(dataHandler, { query: { app: "sap-s4" }, headers: { authorization: ERP_AUTH, "x-lumen-tenant": "lumen-fr-100" } });
expect(erp.statusCode === 200 && erp.payload.records.length >= 1, "ERP authenticated contract failed");

const wms = await invoke(dataHandler, { query: { app: "manhattan-wms" }, headers: { "x-api-key": "lumen_wms_demo_key" } });
expect(wms.statusCode === 200, "WMS authenticated contract failed");
const originalRecords = wms.payload.records;
const changedRecords = originalRecords.map((row, index) => index === 0 ? { ...row, available: Number(row.available) + 7 } : row);
const patched = await invoke(dataHandler, { method: "PATCH", query: { app: "manhattan-wms" }, headers: { ...GATEWAY, "content-type": "application/json" }, body: { records: changedRecords } });
expect(patched.statusCode === 200, "Dataset PATCH failed");
const reread = await invoke(dataHandler, { query: { app: "manhattan-wms" }, headers: { "x-api-key": "lumen_wms_demo_key" } });
expect(reread.payload.records[0].available === changedRecords[0].available, "Patched SI value must be visible on the next read");
await invoke(dataHandler, { method: "PATCH", query: { app: "manhattan-wms" }, headers: { ...GATEWAY, "content-type": "application/json" }, body: { records: originalRecords } });

const changedKey = "lumen_wms_rotated_demo_key";
const configPatch = await invoke(catalogHandler, { method: "PATCH", headers: { ...GATEWAY, "content-type": "application/json" }, body: { appId: "manhattan-wms", patch: { auth: { apiKey: changedKey } } } });
expect(configPatch.statusCode === 200 && configPatch.payload.config.auth.apiKey === changedKey, "Connection configuration PATCH failed");
const oldKeyRead = await invoke(dataHandler, { query: { app: "manhattan-wms" }, headers: { "x-api-key": "lumen_wms_demo_key" } });
expect(oldKeyRead.statusCode === 401, "Old credential must stop working after rotation");
const newKeyRead = await invoke(dataHandler, { query: { app: "manhattan-wms" }, headers: { "x-api-key": changedKey } });
expect(newKeyRead.statusCode === 200, "Rotated credential must be used by the application API");
await invoke(catalogHandler, { method: "POST", headers: { ...GATEWAY, "content-type": "application/json" }, body: { appId: "manhattan-wms", action: "reset" } });

const token = await invoke(tokenHandler, { method: "POST", body: "grant_type=client_credentials&client_id=aura-lumen-demo&client_secret=DEMO-NOT-A-SECRET" });
expect(token.statusCode === 200 && token.payload.token_type === "Bearer", "OAuth token contract failed");
const tms = await invoke(dataHandler, { query: { app: "blueyonder-tms" }, headers: { authorization: `Bearer ${token.payload.access_token}` } });
expect(tms.statusCode === 200, "TMS authenticated contract failed");

const alerts = await invoke(alertsHandler, { headers: GATEWAY });
expect(alerts.statusCode === 200 && alerts.payload.alerts.length >= 1, "Alert contract failed");

const events = await invoke(eventsHandler, { headers: CLIENT });
expect(events.statusCode === 200 && JSON.parse(events.payload).every(item => item.specversion === "1.0"), "CloudEvents contract failed");

const kafka = await invoke(kafkaHandler, { headers: CLIENT, url: "/api/kafka" });
expect(kafka.statusCode === 200 && kafka.payload.protocol === "kafka-compatible-http", "Kafka-compatible flow failed");

const soap = await invoke(soapHandler, { method: "POST", headers: { authorization: ERP_AUTH, "x-lumen-tenant": "lumen-fr-100" }, body: "<GetPurchaseOrders/>" });
expect(soap.statusCode === 200 && String(soap.payload).includes("GetPurchaseOrdersResponse"), "SOAP flow failed");

const webhook = await invoke(webhookHandler, { method: "POST", headers: CLIENT, body: { event: "test.integration", payload: { ok: true } } });
expect(webhook.statusCode === 202 && webhook.payload.accepted === true, "Webhook flow failed");

const csv = await invoke(fileHandler, { query: { name: "demand-forecast.csv" }, headers: { "x-api-key": "lumen_files_demo_key" } });
expect(csv.statusCode === 200 && String(csv.payload).includes("forecast_qty"), "CSV contract failed");

const preflight = await invoke(dataHandler, { method: "OPTIONS", query: { app: "sap-s4" }, headers: { origin: "https://aura-decision-zen.vercel.app" } });
expect(preflight.statusCode === 204, "CORS preflight failed");

console.log(JSON.stringify({
  status: "PASS",
  applications: catalog.payload.applications.length,
  persistence: catalog.payload.persistence,
  valuesPatchRoundTrip: true,
  credentialRotationRoundTrip: true,
  protocols: ["REST", "OAuth2", "CloudEvents", "Kafka-compatible", "SOAP", "Webhook", "CSV"],
}, null, 2));

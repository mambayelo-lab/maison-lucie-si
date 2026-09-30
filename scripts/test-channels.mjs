// Tests des canaux d'échange : pour chacune des 21 ressources des 9 applications,
// les lignes lues par chaque canal sont identiques à la lecture REST de référence.
// Lance le serveur local (routage Vercel, réécritures comprises) et l'arrête par PID.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { DuckDBInstance } from "@duckdb/node-api";
import { RESOURCES, allRows, columnsOf, recordTag, decodeFields, grpcEncodeRequest, overRate, parseSql, runSql, lakeTable, SqlError, cdcEvents, MAX_PAGE } from "../lib/channels.js";
import { edifact, x12, idoc, parseEdifact, parseX12, as2Mdn, mic } from "../lib/edi.js";
import { handleMessage } from "../lib/mcp.js";
import { camel, plural as pluralOf } from "../lib/access.js";

const PORT = 4391, BASE = `http://127.0.0.1:${PORT}`, AUTH = { Authorization: "Bearer lucie_aura_gateway_demo_token" };
const server = spawn(process.execPath, [new URL("./serve-vercel.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), LUCIE_RATE_LIMIT: "1000000" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((ok, ko) => { server.stdout.on("data", d => String(d).includes("http://") && ok()); server.on("exit", ko); });
let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`  ok ${name}`); };
const get = async (path, init = {}) => { const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...AUTH, ...(init.headers || {}) } }); if (r.status >= 400) throw new Error(`${path} → ${r.status} ${await r.text()}`); return r; };
const json = async (path, init) => (await get(path, init)).json();
const post = (path, body, type = "application/json") => json(path, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": type } });
const str = rows => rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)])));
const unxml = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
function xmlRows(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}>(.*?)</${tag}>`, "gs"))].map(m => Object.fromEntries([...m[1].matchAll(/<(\w+)(?: xsi:type="xsd:(\w+)">([^<]*)<\/\1>| xsi:nil="true"\/>)/g)].map(([, k, t, v]) => [k, t === undefined ? null : t === "long" || t === "int" || t === "decimal" ? Number(v) : t === "boolean" ? v === "true" : unxml(v)])));
}
async function drain(fetchPage) { const out = []; for (let off = 0; ;) { const { rows, next } = await fetchPage(off); out.push(...rows); if (next === null || next === undefined || !rows.length) return out; off = next; } }

try {
  await ok("index des canaux public", async () => { const r = await fetch(`${BASE}/channels`); const j = await r.json(); assert.ok(j.channels.mcp && j.channels.edifact && j.channels.grpcWeb); assert.equal(j.maxPageSize, 1000); });
  await ok("authentification exigée (401) et plafond de requêtes", async () => {
    assert.equal((await fetch(`${BASE}/odata/v4/pim/Products`)).status, 401);
    assert.equal((await fetch(`${BASE}/mcp`, { method: "POST", body: "{}" })).status, 401);
    const req = { headers: { "x-forwarded-for": "10.9.9.9" } }; const prev = process.env.LUCIE_RATE_LIMIT; delete process.env.LUCIE_RATE_LIMIT;
    let blocked = false; for (let i = 0; i < 130; i++) blocked = overRate(req, 120) || blocked; assert.ok(blocked); if (prev) process.env.LUCIE_RATE_LIMIT = prev;
  });

  for (const def of RESOURCES) {
    const ref = allRows(def), ALL = ref.length, id = `${def.source}/${def.resource}`;
    const typed = {
      rest: () => drain(async off => { const j = await json(`/api/sources/${def.source}?${def.source === "sap" ? `entity=${def.resource}&$top=1000&$skip=${off}` : def.source === "manhattan" ? `resource=${def.resource}&size=1000&page=${off / 1000}` : `resource=${def.resource}&limit=1000&cursor=${off}`}`); const rows = j.d?.results ?? j.data ?? j.items; return { rows, next: rows.length === 1000 ? off + 1000 : null }; }),
      odata4: () => drain(async off => { const j = await json(`/odata/v4/${def.source}/${def.entitySet}?$top=1000&$skip=${off}`); return { rows: j.value, next: j["@odata.nextLink"] ? off + 1000 : null }; }),
      graphql: () => drain(async off => { const cols = columnsOf(def).map(c => c.name).join(" "); const field = camel(pluralOf(def.typeName.charAt(0).toLowerCase() + def.typeName.slice(1))); const root = camel(`src-${def.source}`); const j = await post("/api/graphql", { query: `{ ${root} { ${field}(limit: 1000, offset: ${off}) { ${cols} } } }` }); if (j.errors) throw new Error(JSON.stringify(j.errors)); const rows = j.data[root][field]; return { rows, next: rows.length === 1000 ? off + 1000 : null }; }),
      soap: () => drain(async off => { const r = await get(`/api/soap?source=${def.source}`, { method: "POST", headers: { "Content-Type": "text/xml" }, body: `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetRecords><resource>${def.resource}</resource><limit>1000</limit><offset>${off}</offset></GetRecords></soap:Body></soap:Envelope>` }); const x = await r.text(); const next = /nextOffset="(\d+)"/.exec(x)?.[1]; return { rows: xmlRows(x, recordTag(def)), next: next ? Number(next) : null }; }),
      salesforce: () => { const cols = columnsOf(def).map(c => c.name).join(", "); let url = `/services/data/v60.0/query?q=${encodeURIComponent(`SELECT ${cols} FROM Lucie_${def.source[0].toUpperCase()}${def.source.slice(1)}_${def.entitySet}__c`)}`; return drain(async () => { const j = await json(url); url = j.nextRecordsUrl; return { rows: j.records.map(({ attributes, Id, ...r }) => r), next: j.done ? null : 1 }; }); },
      kafka: () => drain(async off => { const j = await json(`/api/kafka?topic=lucie.${def.source}.${def.resource}&offset=${off}&limit=1000`); return { rows: j.messages.map(m => m.value.data), next: j.hasMore ? j.nextOffset : null }; }),
      amqp: () => drain(async off => { const j = await post(`/api/queues/%2F/lucie.${def.source}.${def.resource}/get`, { count: 1000, ackmode: "ack_requeue_true", encoding: "auto", offset: off }); return { rows: j.map(m => JSON.parse(m.payload)), next: j.length && j.at(-1).message_count > 0 ? off + j.length : null }; }),
      cloudevents: () => drain(async off => { const r = await get(`/cloudevents/${def.source}/${def.resource}?offset=${off}&limit=1000`); const j = await r.json(); return { rows: j.map(e => e.data), next: Number(r.headers.get("x-next-offset")) < Number(r.headers.get("x-end-offset")) ? Number(r.headers.get("x-next-offset")) : null }; }),
      sftpJson: async () => (await json(`/sftp/get?path=/outbound/${def.source}/${def.resource}.json`)),
      sftpXml: async () => xmlRows(await (await get(`/sftp/get?path=/outbound/${def.source}/${def.resource}.xml`)).text(), recordTag(def)),
      esb: () => drain(async off => { const j = await json(`/esb/api/v1/route?to=${def.source}&resource=${def.resource}&offset=${off}&limit=1000`); return { rows: j.data, next: j.meta.pagination.nextOffset }; }),
      mcp: () => drain(async off => { const j = await post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "query", arguments: { source: def.source, resource: def.resource, limit: 1000, offset: off } } }); const s = j.result.structuredContent; return { rows: s.rows, next: s.nextOffset }; }),
    };
    await ok(`${id} (${ALL} lignes) : REST, OData v4, GraphQL, SOAP, Salesforce, Kafka, AMQP, CloudEvents, fichiers JSON/XML, ESB, MCP identiques`, async () => {
      for (const [name, read] of Object.entries(typed)) {
        const rows = await read();
        assert.deepEqual(rows, ref, `${id} via ${name}`);
      }
      const csv = await (await get(`/sftp/get?path=/outbound/${def.source}/${def.resource}.csv`)).text();
      const lines = csv.trim().split("\n"), head = lines[0].split(",");
      assert.equal(lines.length - 1, ALL, `${id} CSV`);
      assert.deepEqual(head, columnsOf(def).map(c => c.name));
    });
    await ok(`${id} : CDC Debezium rejoué = table ; MQ et gRPC-web (texte) identiques`, async () => {
      const events = await drain(async off => { const j = await json(`/cdc/${def.source}/${def.resource}?offset=${off}&limit=1000`); return { rows: j.messages, next: j.hasMore ? j.nextOffset : null }; });
      assert.deepEqual(events.map(m => [m.value.op, m.value.after]), cdcEvents(def).map(e => [e.op, e.after]));
      // Rejeu : r/c créent, u remplace ; clé = rang d'origine (les clés peuvent se répéter volontairement : EAN en double…).
      const replay = new Map();
      for (const e of cdcEvents(def)) { if (e.op === "u") assert.deepEqual(replay.get(e.i), e.before); replay.set(e.i, e.after); }
      assert.deepEqual([...replay.keys()].sort((a, b) => a - b).map(i => replay.get(i)), ref);
      // MQ : 3 messages (début, milieu, fin).
      for (const off of [0, Math.floor(ALL / 2), ALL - 1]) { const r = await get(`/ibmmq/rest/v2/messaging/qmgr/LUCIEQM/queue/LUCIE.${def.source.toUpperCase()}.${def.resource.toUpperCase()}/message?offset=${off}`); assert.deepEqual(await r.json(), ref[off]); }
      assert.equal((await fetch(`${BASE}/ibmmq/rest/v2/messaging/qmgr/LUCIEQM/queue/LUCIE.${def.source.toUpperCase()}.${def.resource.toUpperCase()}/message?offset=${ALL}`, { headers: AUTH })).status, 204);
      // gRPC-web : décodage protobuf à la main.
      const rows = await drain(async off => {
        const r = await get("/grpc/lucie.v1.RowService/ListRows", { method: "POST", headers: { "Content-Type": "application/grpc-web+proto" }, body: grpcEncodeRequest({ source: def.source, resource: def.resource, page_size: 1000, page_token: off ? String(off) : "" }) });
        const buf = Buffer.from(await r.arrayBuffer()), len = buf.readUInt32BE(1), msg = decodeFields(buf.subarray(5, 5 + len));
        assert.match(buf.subarray(10 + len).toString(), /grpc-status:0/);
        const out = msg.filter(f => f.no === 1).map(f => { const row = {}; for (const e of decodeFields(f.bytes)) { if (e.no === 1) { const kv = decodeFields(e.bytes); row[kv[0].bytes.toString()] = kv[1]?.bytes.toString() ?? ""; } else row[e.bytes.toString()] = ""; } return row; });
        const next = msg.find(f => f.no === 2); return { rows: out, next: next ? Number(next.bytes.toString()) : null };
      });
      assert.deepEqual(rows.map(r => Object.fromEntries(columnsOf(def).map(c => [c.name, r[c.name] ?? ""]))), str(ref));
    });
  }

  await ok("Parquet (dépôt SFTP) identique, lu par DuckDB", async () => {
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    for (const def of RESOURCES) {
      const r = await fetch(`${BASE}/sftp/get?path=/outbound/${def.source}/${def.resource}.parquet`, { headers: AUTH, redirect: "manual" });
      assert.equal(r.status, 302);
      const file = new URL(`..${r.headers.get("location")}`, import.meta.url).pathname;
      const rows = (await (await db.runAndReadAll(`SELECT * FROM read_parquet('${file}')`)).getRowObjectsJS()).map(o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])));
      assert.deepEqual(rows, allRows(def), `${def.source}/${def.resource} parquet`);
    }
  });
  await ok("SQL (lac) : SELECT * = table ; agrégat = calcul direct ; écriture refusée", async () => {
    for (const def of RESOURCES.filter(r => r.source === "lake")) {
      const rows = await drain(async off => { const j = await post("/sql", { sql: `SELECT * FROM lake.${def.resource.replace(/-/g, "_")} LIMIT 1000 OFFSET ${off}` }); return { rows: j.rows, next: j.rows.length === 1000 ? off + 1000 : null }; });
      assert.deepEqual(rows, allRows(def));
    }
    const j = await post("/sql", { sql: "SELECT StoreCode, COUNT(*) AS n, SUM(Quantity) AS q FROM lake.sales WHERE SaleDate >= '2026-09-01' GROUP BY StoreCode ORDER BY StoreCode" });
    const sales = allRows(lakeTable("sales")).filter(r => r.SaleDate >= "2026-09-01");
    assert.equal(j.rows.reduce((s, r) => s + r.n, 0), sales.length);
    assert.equal(j.rows.reduce((s, r) => s + r.q, 0), sales.reduce((s, r) => s + r.Quantity, 0));
    assert.throws(() => parseSql("DELETE FROM lake.sales"), SqlError);
    assert.throws(() => parseSql("SELECT * FROM a JOIN b"), SqlError);
    assert.throws(() => runSql(parseSql("SELECT nope FROM lake.sales"), lakeTable("sales")), SqlError);
    assert.equal((await fetch(`${BASE}/sql`, { method: "POST", headers: { ...AUTH, "Content-Type": "application/json" }, body: JSON.stringify({ sql: "DROP TABLE lake.sales" }) })).status, 400);
    assert.ok((await json(`/sql?q=${encodeURIComponent("SELECT * FROM lake.sales LIMIT 5000")}`)).rows.length <= MAX_PAGE);
  });
  await ok("Salesforce : jeton OAuth, describe, Bulk API 2.0 (CSV + Sforce-Locator)", async () => {
    const t = await (await fetch(`${BASE}/services/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials&client_id=aura&client_secret=lucie_aura_gateway_demo_token" })).json();
    assert.equal(t.token_type, "Bearer");
    const d = await json("/services/data/v60.0/sobjects/Lucie_Oms_OrderLines__c/describe");
    assert.ok(d.fields.some(f => f.name === "OrderLineId" && f.externalId));
    const job = await post("/services/data/v60.0/jobs/query", { operation: "query", query: "SELECT OrderLineId, Quantity FROM Lucie_Oms_OrderLines__c" });
    assert.equal((await json(`/services/data/v60.0/jobs/query/${job.id}`)).state, "JobComplete");
    const out = []; let loc = "";
    for (;;) { const r = await get(`/services/data/v60.0/jobs/query/${job.id}/results?maxRecords=1000${loc ? `&locator=${loc}` : ""}`); out.push(...(await r.text()).trim().split("\n").slice(1)); loc = r.headers.get("sforce-locator"); if (loc === "null") break; }
    assert.deepEqual(out, allRows(RESOURCES.find(r => r.source === "oms")).map(r => `${r.OrderLineId},${r.Quantity}`));
  });
  await ok("SAP : RFC_READ_TABLE, BAPI_PO_GETDETAIL1, BAPI_VENDOR_GETDETAIL, OData v2 ≡ OData v4", async () => {
    const sup = allRows(RESOURCES[0]);
    const j = await post("/sap/bc/rfc", { jsonrpc: "2.0", id: 1, method: "RFC_READ_TABLE", params: { QUERY_TABLE: "LFA1", DELIMITER: "|", FIELDS: columnsOf(RESOURCES[0]).map(c => ({ FIELDNAME: c.name })), ROWCOUNT: 1000 } });
    assert.deepEqual(j.result.DATA.map(d => d.WA), str(sup).map(r => Object.values(r).join("|")));
    const po = allRows(RESOURCES[1])[3];
    const b = await post("/sap/bc/rfc", { jsonrpc: "2.0", id: 2, method: "BAPI_PO_GETDETAIL1", params: { PURCHASEORDER: po.PurchaseOrder } });
    assert.equal(b.result.POITEM[0].MATERIAL, po.Material); assert.equal(b.result.POSCHEDULE[0].DELIVERY_DATE, po.ScheduleLineDeliveryDate);
    const v = await post("/sap/bc/rfc", { jsonrpc: "2.0", id: 3, method: "BAPI_VENDOR_GETDETAIL", params: { VENDORNO: sup[0].Supplier } });
    assert.equal(v.result.GENERALDETAIL.NAME, sup[0].SupplierName);
    assert.equal((await post("/sap/bc/rfc", { jsonrpc: "2.0", id: 4, method: "Z_UNKNOWN" })).error.code, -32601);
    const v2 = await json("/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_Supplier?$top=1000"), v4 = await json("/odata/v4/sap/A_Supplier?$top=1000");
    assert.deepEqual(v2.d.results, v4.value);
    assert.match(await (await get("/odata/v4/sap/$metadata")).text(), /Version="4.0"/);
  });
  await ok("EDIFACT D.96A : ORDERS, DESADV, INVOIC (enveloppe, comptes UNT/UNZ, champs = tables)", async () => {
    const po = allRows(RESOURCES[1]), sh = allRows(RESOURCES.find(r => r.source === "tms" && r.resource === "shipments"));
    for (const type of ["ORDERS", "DESADV", "INVOIC"]) {
      const text = await (await get(`/edi/edifact/${type}?limit=50&offset=10`)).text(), segs = parseEdifact(text);
      assert.equal(segs[0][0][0], "UNB"); assert.equal(segs.at(-1)[0][0], "UNZ"); assert.equal(Number(segs.at(-1)[1][0]), segs.filter(s => s[0][0] === "UNH").length);
      let count = 0; for (const s of segs) { if (s[0][0] === "UNH") count = 1; else if (s[0][0] === "UNT") assert.equal(Number(s[1][0]), count + 1); else count++; }
      const bgm = segs.filter(s => s[0][0] === "BGM").map(s => s[2][0]);
      if (type === "ORDERS") { assert.deepEqual(bgm, po.slice(10, 60).map(p => p.PurchaseOrder)); assert.deepEqual(segs.filter(s => s[0][0] === "QTY").map(s => Number(s[1][1])), po.slice(10, 60).map(p => p.OrderQuantity)); }
      if (type === "DESADV") { assert.deepEqual(bgm, sh.slice(10, 60).map(p => p.ShipmentId)); assert.deepEqual(segs.filter(s => s[0][0] === "NAD" && s[1][0] === "SU").map(s => s[4][0]), sh.slice(10, 60).map(p => p.OriginName)); }
      if (type === "INVOIC") assert.ok(bgm.every(b => /^INV\d{10}$/.test(b)));
    }
    assert.match(edifact("ORDERS", 0, 1).text, /^UNA:\+\.\? '\nUNB\+UNOC:3\+/);
  });
  await ok("X12 004010 : 850, 856, 810 (ISA de 106 caractères, SE/GE/IEA)", async () => {
    const po = allRows(RESOURCES[1]);
    for (const type of ["850", "856", "810"]) {
      const text = await (await get(`/edi/x12/${type}?limit=20`)).text();
      assert.equal(text.split("\n")[0].length, 106);
      const segs = parseX12(text);
      assert.equal(segs.at(-1)[0][0], "IEA"); assert.equal(Number(segs.find(s => s[0][0] === "GE")[1][0]), segs.filter(s => s[0][0] === "ST").length);
      let count = 0; for (const s of segs) { if (s[0][0] === "ST") count = 1; else if (s[0][0] === "SE") assert.equal(Number(s[1][0]), count + 1); else count++; }
      if (type === "850") assert.deepEqual(segs.filter(s => s[0][0] === "PO1").map(s => [Number(s[2][0]), s[7][0]]), po.slice(0, 20).map(p => [p.OrderQuantity, p.Material]));
    }
    assert.equal(x12("999"), null);
  });
  await ok("IDoc XML : ORDERS05, DESADV01, CREMAS05, MATMAS05 (EDI_DC40, segments réels)", async () => {
    const x = await (await get("/sap/idoc/ORDERS05?limit=5")).text();
    assert.equal((x.match(/<IDOC BEGIN="1">/g) || []).length, 5);
    assert.deepEqual([...x.matchAll(/<E1EDK01 SEGMENT="1"><CURCY>\w+<\/CURCY><BELNR>(\d+)<\/BELNR>/g)].map(m => m[1]), allRows(RESOURCES[1]).slice(0, 5).map(p => p.PurchaseOrder));
    for (const t of ["DESADV01", "CREMAS05", "MATMAS05"]) assert.match(idoc(t, 0, 1).text, new RegExp(`<IDOCTYP>${t}</IDOCTYP>`));
    assert.deepEqual([...idoc("CREMAS05", 0, 1000).text.matchAll(/<LIFNR>(\d+)<\/LIFNR>/g)].map(m => m[1]), allRows(RESOURCES[0]).map(s => s.Supplier));
  });
  await ok("AS2 : boîte d'envoi, en-têtes, MIC SHA-256 et MDN synchrone", async () => {
    const box = await json("/as2/outbox"); assert.equal(box.messages.length, 6);
    const r = await get("/as2/message/edifact-orders?limit=3"); const body = await r.text();
    assert.equal(r.headers.get("as2-from"), "MAISONLUCIE"); assert.equal(r.headers.get("x-lucie-content-mic"), mic(body));
    const mdn = await (await get("/as2", { method: "POST", headers: { "Content-Type": "application/EDIFACT", "Message-ID": "<t1@aura>", "AS2-From": "AURASUPPLY" }, body })).text();
    assert.match(mdn, /Disposition: automatic-action\/MDN-sent-automatically; processed/); assert.ok(mdn.includes(`Received-Content-MIC: ${mic(body)}`));
    assert.equal(as2Mdn({ messageId: "x", text: "garbage" }).ok, false);
  });
  await ok("MCP : initialize, tools/list, resources, kpi_series, alerts, erreurs JSON-RPC", async () => {
    const init = handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    assert.equal(init.result.protocolVersion, "2025-03-26");
    assert.equal(handleMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }).result.protocolVersion, "2025-06-18");
    assert.equal(handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
    assert.deepEqual(handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" }).result.tools.map(t => t.name), ["list_sources", "read_object", "query", "kpi_series", "alerts"]);
    assert.equal(handleMessage({ jsonrpc: "2.0", id: 4, method: "nope" }).error.code, -32601);
    assert.equal(handleMessage({ id: 5, method: "ping" }).error.code, -32600);
    const res = await post("/mcp", [{ jsonrpc: "2.0", id: 6, method: "resources/list" }, { jsonrpc: "2.0", id: 7, method: "resources/read", params: { uri: "lucie://ontology" } }]);
    assert.ok(res[0].result.resources.some(r => r.uri === "lucie://schema/sap")); assert.ok(JSON.parse(res[1].result.contents[0].text).domains.length >= 8);
    const k = await post("/mcp", { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "kpi_series", arguments: { kpi: "sales-by-month" } } });
    assert.equal(Math.round(k.result.structuredContent.series.reduce((s, p) => s + p.value, 0)), Math.round(allRows(lakeTable("sales")).reduce((s, r) => s + r.NetAmount, 0)));
    const a = await post("/mcp", { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "alerts", arguments: {} } });
    assert.ok(a.result.structuredContent.alerts.find(x => x.id === "SI-RETARD").count > 0);
    const o = await post("/mcp", { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "read_object", arguments: { source: "sap", resource: "A_Supplier", key: "0000100001" } } });
    assert.equal(o.result.structuredContent.object.SupplierName, "Tessitura Milano");
    const bad = await post("/mcp", { jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "query", arguments: { source: "pim", resource: "products", fields: ["nope"] } } });
    assert.equal(bad.result.isError, true);
    assert.equal((await fetch(`${BASE}/mcp`, { headers: AUTH })).status, 405);
    assert.equal((await fetch(`${BASE}/mcp`, { method: "POST", headers: { ...AUTH, Origin: "https://evil.example" }, body: "{}" })).status, 403);
    assert.equal((await fetch(`${BASE}/mcp`, { method: "POST", headers: { ...AUTH, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) })).status, 202);
  });
  await ok("Budget : pages plafonnées à 1 000, en-têtes de cache sur les lectures", async () => {
    const r = await get("/odata/v4/lake/Sales?$top=5000");
    assert.equal((await r.json()).value.length, 1000);
    assert.match(r.headers.get("cache-control"), /s-maxage=3600/);
    assert.equal((await json(`/api/kafka?topic=lucie.lake.sales&limit=1000`)).messages.length, 1000);
  });
  console.log(`test-channels : ${n} tests réussis`);
} finally {
  server.kill("SIGTERM"); // arrêt par PID (processus enfant), jamais pkill -f
}

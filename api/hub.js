import { randomUUID } from "node:crypto";
import { beginRequest, requestHeader, sendError } from "../lib/http-api.js";
import {
  CACHE_HEADER, GRPC_PROTO, LAKE_TABLES, MAX_PAGE, RESOURCES, SOURCE_IDS, SqlError, amqpGet, cdcPage, channelName, cloudEvent, columnsOf, esbFlow, ESB_FLOWS,
  findResource, grpcDecodeRequest, grpcEncodeResponse, lakeTable, mqBrowse, odata4, odata4Metadata, overRate, parquetPath, parseChannel, parseSql, readRows,
  renderFile, runSql, sfDescribe, sfObject, soql, sftpListing, sftpResolve, sqlTypeOf,
} from "../lib/channels.js";
import { AS2_DOCS, EDIFACT_TYPES, IDOC_TYPES, X12_TYPES, as2Message, as2Mdn, edifact, idoc, x12 } from "../lib/edi.js";
import { DEMO_CREDENTIALS } from "../lib/http-api.js";
import { DATASET } from "../lib/multisource-api.js";
import { mcpHandler } from "../lib/mcp-http.js";
import parquetManifest from "../public/sftp/manifest.json" with { type: "json" };

// Routeur unique des canaux d'échange (une seule fonction Vercel pour tous) :
// ch = odata4 | idoc | rfc | sf | amqp | mq | ce | cdc | edifact | x12 | as2 | sftp | sql | grpc | esb.
// Les URL publiques (réécritures vercel.json) reprennent la forme des produits
// réels : /odata/v4/…, /sap/idoc/…, /sap/bc/rfc, /services/data/v60.0/…,
// /api/queues/{vhost}/{queue}/get, /ibmmq/rest/v2/…, /sql, /sftp/…, /as2/…,
// /grpc/lucie.v1.RowService/ListRows, /esb/api/v1/{flux}.
// Budget : pages de 1 000 lignes au plus, cache CDN sur les lectures, 120 requêtes/min par client.

const PORTAL = "https://maison-lucie-si.vercel.app";
const int = (v, d) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Math.max(0, Math.trunc(Number(v))));
const page = (v, d = 100) => Math.min(MAX_PAGE, Math.max(1, int(v, d)));

/** Jeton passerelle en Bearer, ou mot de passe d'une authentification Basic (RabbitMQ, IBM MQ, SAP). */
function gatewayOk(request) {
  const token = process.env.LUCIE_GATEWAY_TOKEN || process.env.LUMEN_GATEWAY_TOKEN || DEMO_CREDENTIALS.gateway.token;
  const auth = String(requestHeader(request, "authorization") || "");
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim() === token;
  if (auth.startsWith("Basic ")) { try { return Buffer.from(auth.slice(6), "base64").toString("utf8").split(":").slice(1).join(":") === token; } catch { return false; } }
  return false;
}
function bodyOf(request) {
  const b = request.body;
  if (b && typeof b === "object" && !Buffer.isBuffer(b)) return b;
  const s = Buffer.isBuffer(b) ? b.toString("utf8") : String(b ?? "");
  try { return s ? JSON.parse(s) : {}; } catch { return { __raw: s }; }
}
const cached = response => response.setHeader("Cache-Control", CACHE_HEADER);
const text = (response, status, type, body) => { response.setHeader("Content-Type", type); return response.status(status).send(body); };

export default async function handler(request, response) {
  // Serveur MCP (/mcp) : même fonction, transport et contrôles propres (lib/mcp-http.js).
  if (String(request.query?.ch || "") === "mcp") return mcpHandler(request, response);
  const gate = beginRequest(request, response, ["GET", "POST", "HEAD"]);
  if (!gate.ok) return;
  const q = { ...(request.query || {}) };
  const ch = String(q.ch || "");
  delete q.ch;
  response.setHeader("X-Synthetic-Data", "true");
  if (overRate(request, 120)) { response.setHeader("Retry-After", "60"); return sendError(response, 429, "RATE_LIMITED", "Plafond de 120 requêtes par minute.", gate.requestId); }

  // Découverte publique (sans jeton) : liste des canaux.
  if (!ch || ch === "index") { cached(response); return response.status(200).json(channelIndex()); }
  if (ch === "sf" && String(q.path || "") === "oauth2/token") return sfToken(request, response);
  if (ch === "grpc" && request.method === "GET") { cached(response); return text(response, 200, "text/plain; charset=utf-8", GRPC_PROTO); }
  if (!gatewayOk(request)) {
    response.setHeader("WWW-Authenticate", ch === "amqp" || ch === "mq" || ch === "rfc" ? 'Basic realm="Maison Lucie"' : 'Bearer realm="Maison Lucie"');
    return sendError(response, 401, "UNAUTHORIZED", "Jeton passerelle requis (Authorization: Bearer … ; Basic accepté pour RabbitMQ, IBM MQ et RFC).", gate.requestId);
  }
  try {
    switch (ch) {
      case "odata4": return odata4Route(q, response);
      case "idoc": return docRoute(response, IDOC_TYPES, String(q.type || "").toUpperCase(), q, idoc, "application/xml; charset=utf-8");
      case "edifact": return docRoute(response, EDIFACT_TYPES, String(q.type || "").toUpperCase(), q, edifact, "application/EDIFACT");
      case "x12": return docRoute(response, X12_TYPES, String(q.type || ""), q, x12, "application/EDI-X12");
      case "rfc": return rfcRoute(request, response);
      case "sf": return sfRoute(request, q, response);
      case "amqp": return amqpRoute(request, q, response);
      case "mq": return mqRoute(q, response);
      case "ce": return ceRoute(q, response);
      case "cdc": return cdcRoute(q, response);
      case "as2": return as2Route(request, q, response);
      case "sftp": return sftpRoute(q, response);
      case "sql": return sqlRoute(request, q, response);
      case "grpc": return grpcRoute(request, response);
      case "esb": return esbRoute(q, response, requestHeader(request, "x-correlation-id") || gate.requestId);
    }
    return sendError(response, 404, "UNKNOWN_CHANNEL", `Canal inconnu : ${ch}`, gate.requestId, { channels: Object.keys(channelIndex().channels) });
  } catch (e) {
    if (e instanceof SqlError) return sendError(response, 400, "INVALID_QUERY", e.message, gate.requestId);
    throw e;
  }
}

export function channelIndex() {
  const ex = RESOURCES.find(r => r.source === "pim");
  return {
    synthetic: true, asOf: DATASET.asOf, maxPageSize: MAX_PAGE, auth: "Authorization: Bearer lucie_aura_gateway_demo_token (Basic <n'importe quel utilisateur>:<jeton> pour RabbitMQ, IBM MQ, RFC)",
    channels: {
      rest: { url: "/api/sources/{source}?resource={resource}", docs: "/api/sources/index" },
      odataV2: { url: "/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_Supplier", apps: ["sap"] },
      odataV4: { url: `/odata/v4/{source}/{EntitySet}?$filter=&$select=&$top=&$skip=&$count=true`, metadata: "/odata/v4/{source}/$metadata", example: `/odata/v4/pim/${ex.entitySet}?$top=5` },
      graphql: { url: "/api/graphql", sdl: "/api/graphql?sdl", example: "{ srcPim { products(limit: 5) { productId ean } } }" },
      soap: { url: "/api/soap?source={source}&resource={resource}", wsdl: "/api/soap?wsdl&source={source}", operation: "GetRecords" },
      sapIdoc: { url: "/sap/idoc/{ORDERS05|DESADV01|CREMAS05|MATMAS05}?offset=&limit=" },
      sapRfc: { url: "POST /sap/bc/rfc (JSON-RPC 2.0)", methods: ["RFC_PING", "RFC_SYSTEM_INFO", "RFC_READ_TABLE", "BAPI_PO_GETDETAIL1", "BAPI_VENDOR_GETDETAIL"] },
      salesforce: { token: "POST /services/oauth2/token (grant_type=client_credentials)", query: "/services/data/v60.0/query?q=SELECT+productId,ean+FROM+Lucie_Pim_Products__c", sobjects: "/services/data/v60.0/sobjects", bulk: "POST /services/data/v60.0/jobs/query" },
      kafka: { url: "/api/kafka?topic=lucie.{source}.{resource}&offset=&limit=", topics: "/api/kafka?topics" },
      amqp: { url: "POST /api/queues/%2F/lucie.{source}.{resource}/get {count, ackmode, encoding, offset}", queues: "/api/queues" },
      mq: { url: "GET /ibmmq/rest/v2/messaging/qmgr/LUCIEQM/queue/LUCIE.{SOURCE}.{RESOURCE}/message?offset=" },
      cloudevents: { url: "/cloudevents/{source}/{resource}?offset=&limit=" },
      webhooks: { url: "/api/webhooks", note: "Réception ; les livraisons sortantes sont simulées par /cloudevents (aucun appel sortant)." },
      cdc: { url: "/cdc/{source}/{resource}?offset=&limit=", format: "Debezium JSON (before/after/source/op/ts_ms)" },
      edifact: { url: "/edi/edifact/{ORDERS|DESADV|INVOIC}?offset=&limit=" },
      x12: { url: "/edi/x12/{850|856|810}?offset=&limit=" },
      as2: { outbox: "/as2/outbox", message: "/as2/message/{id}", receive: "POST /as2 (renvoie un MDN synchrone)" },
      sftp: { list: "/sftp/ls?path=/outbound/{source}", get: "/sftp/get?path=/outbound/{source}/{resource}.{csv|json|xml|parquet}" },
      sql: { url: "POST /sql {\"sql\": \"SELECT … FROM lake.sales …\"} ou GET /sql?q=", tables: "/sql?tables" },
      grpcWeb: { url: "POST /grpc/lucie.v1.RowService/ListRows (application/grpc-web+proto)", proto: "GET /grpc/lucie.v1.RowService/ListRows" },
      esb: { url: "/esb/api/v1/{flux}", flows: Object.keys(ESB_FLOWS), route: "/esb/api/v1/route?to={source}&resource={resource}" },
      mcp: { url: "POST /mcp (Streamable HTTP, JSON-RPC 2.0)" },
    },
    sources: SOURCE_IDS.map(id => ({ id, resources: RESOURCES.filter(r => r.source === id).map(r => ({ resource: r.resource, entitySet: r.entitySet, key: r.key, channel: channelName(r) })) })),
  };
}

// ── OData v4 ───────────────────────────────────────────────────────────────
function odata4Route(q, response) {
  const source = String(q.source || ""), path = String(q.path || "").replace(/^\/+|\/+$/g, "");
  if (!SOURCE_IDS.includes(source)) return response.status(404).json({ error: { code: "NotFound", message: `Service inconnu : ${source}` } });
  response.setHeader("OData-Version", "4.0");
  cached(response);
  const base = `/odata/v4/${source}`;
  if (!path) return response.status(200).json({ "@odata.context": `${base}/$metadata`, value: RESOURCES.filter(r => r.source === source).map(r => ({ name: r.entitySet, kind: "EntitySet", url: r.entitySet })) });
  if (path === "$metadata") return text(response, 200, "application/xml; charset=utf-8", odata4Metadata(source));
  const r = odata4(source, path, q, base);
  if (r.status !== 200) response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; odata.metadata=minimal; charset=utf-8");
  return response.status(r.status).send(JSON.stringify(r.body));
}

// ── Documents EDI / IDoc ─────────────────────────────────────────────────────
function docRoute(response, types, type, q, build, contentType) {
  if (!types[type]) return response.status(404).json({ error: { code: "UNKNOWN_DOCUMENT", message: `Type inconnu : ${type}`, types: Object.keys(types) } });
  const doc = build(type, int(q.offset, 0), page(q.limit));
  cached(response);
  response.setHeader("X-Document-Count", String(doc.count));
  response.setHeader("X-Total-Count", String(doc.total));
  if (doc.nextOffset !== null) response.setHeader("X-Next-Offset", String(doc.nextOffset));
  response.setHeader("X-Derived-From", types[type].source);
  return text(response, 200, contentType, doc.text);
}

// ── SAP RFC / BAPI simulés en JSON-RPC 2.0 ──────────────────────────────────
const RFC_TABLES = { A_Supplier: "sap/A_Supplier", LFA1: "sap/A_Supplier", A_PurchaseOrderItem: "sap/A_PurchaseOrderItem", EKPO: "sap/A_PurchaseOrderItem" };
function rfcCall(method, p) {
  const P = Object.fromEntries(Object.entries(p ?? {}).map(([k, v]) => [k.toUpperCase(), v]));
  switch (method) {
    case "RFC_PING": return {};
    case "RFC_SYSTEM_INFO": return { RFCSI_EXPORT: { RFCPROTO: "011", RFCCHARTYP: "4103", RFCINTTYP: "LIT", RFCFLOTYP: "IE3", RFCDEST: "LUCIES4H", RFCHOST: "maison-lucie-si", RFCSYSID: "LUC", RFCDATABS: "HDB", RFCSAPRL: "758", RFCMACH: "simulated", RFCOPSYS: "Linux", RFCTZONE: "0", RFCDAYST: "", RFCIPADDR: "", RFCKERNRL: "789" } };
    case "RFC_READ_TABLE": {
      const key = RFC_TABLES[P.QUERY_TABLE];
      if (!key) throw Object.assign(new Error("TABLE_NOT_AVAILABLE"), { rfc: "TABLE_NOT_AVAILABLE" });
      const def = findResource(...key.split("/")), cols = columnsOf(def);
      const wanted = (P.FIELDS ?? []).map(f => (typeof f === "string" ? f : f.FIELDNAME)).filter(Boolean);
      const fields = wanted.length ? wanted : cols.map(c => c.name);
      const unknown = fields.find(f => !cols.some(c => c.name === f));
      if (unknown) throw Object.assign(new Error(`FIELD_NOT_VALID: ${unknown}`), { rfc: "FIELD_NOT_VALID" });
      const where = (P.OPTIONS ?? []).map(o => (typeof o === "string" ? o : o.TEXT)).join(" ").trim();
      const sql = parseSql(`SELECT ${fields.join(", ")} FROM t${where ? ` WHERE ${where.replace(/\bEQ\b/g, "=").replace(/\bNE\b/g, "<>").replace(/\bGT\b/g, ">").replace(/\bGE\b/g, ">=").replace(/\bLT\b/g, "<").replace(/\bLE\b/g, "<=")}` : ""}`);
      const rowcount = Math.min(Number(P.ROWCOUNT) || MAX_PAGE, MAX_PAGE), skip = Number(P.ROWSKIPS) || 0;
      const r = runSql({ ...sql, offset: skip, limit: rowcount }, def);
      const delim = P.DELIMITER ?? "|";
      let off = 0;
      const FIELDS = fields.map(f => { const c = cols.find(x => x.name === f), len = c.type === "string" ? 60 : 20; const o = { FIELDNAME: f, OFFSET: String(off).padStart(6, "0"), LENGTH: String(len).padStart(6, "0"), TYPE: { integer: "I", decimal: "P", boolean: "C", date: "D", datetime: "C", string: "C" }[c.type], FIELDTEXT: f }; off += len + delim.length; return o; });
      return { FIELDS, DATA: r.rows.map(row => ({ WA: fields.map(f => (row[f] === null || row[f] === undefined ? "" : String(row[f]))).join(delim) })), X_TOTAL: r.total };
    }
    case "BAPI_PO_GETDETAIL1": {
      const def = findResource("sap", "A_PurchaseOrderItem"), items = readRows(def, { filters: [{ field: "PurchaseOrder", op: "eq", value: String(P.PURCHASEORDER ?? "") }], limit: MAX_PAGE }).rows;
      if (!items.length) return { RETURN: [{ TYPE: "E", ID: "06", NUMBER: "019", MESSAGE: `Purchasing document ${P.PURCHASEORDER} does not exist` }] };
      return { POHEADER: { PO_NUMBER: items[0].PurchaseOrder, VENDOR: items[0].Supplier, CURRENCY: items[0].DocumentCurrency }, POITEM: items.map(i => ({ PO_ITEM: i.PurchaseOrderItem, MATERIAL: i.Material, QUANTITY: i.OrderQuantity })), POSCHEDULE: items.map(i => ({ PO_ITEM: i.PurchaseOrderItem, SCHED_LINE: "0001", DELIVERY_DATE: i.ScheduleLineDeliveryDate, QUANTITY: i.OrderQuantity })), RETURN: [] };
    }
    case "BAPI_VENDOR_GETDETAIL": {
      const v = readRows(findResource("sap", "A_Supplier"), { filters: [{ field: "Supplier", op: "eq", value: String(P.VENDORNO ?? "") }], limit: 1 }).rows[0];
      if (!v) return { RETURN: { TYPE: "E", ID: "F2", NUMBER: "163", MESSAGE: `Vendor ${P.VENDORNO} does not exist` } };
      return { GENERALDETAIL: { VENDOR: v.Supplier, NAME: v.SupplierName, COUNTRY: v.Country, TAX_NO_1: v.TaxNumber1, VAT_REG_NO: v.VATRegistration }, RETURN: { TYPE: "", MESSAGE: "" } };
    }
  }
  throw Object.assign(new Error(`FU_NOT_FOUND: ${method}`), { rfc: "FU_NOT_FOUND", code: -32601 });
}
function rfcRoute(request, response) {
  if (request.method !== "POST") return response.status(200).json({ protocol: "sap-rfc-jsonrpc (simulé)", methods: ["RFC_PING", "RFC_SYSTEM_INFO", "RFC_READ_TABLE", "BAPI_PO_GETDETAIL1", "BAPI_VENDOR_GETDETAIL"], tables: Object.keys(RFC_TABLES), example: { jsonrpc: "2.0", id: 1, method: "RFC_READ_TABLE", params: { QUERY_TABLE: "LFA1", DELIMITER: "|", FIELDS: [{ FIELDNAME: "Supplier" }], OPTIONS: [{ TEXT: "Country = 'FR'" }], ROWCOUNT: 10 } } });
  const b = bodyOf(request);
  const one = m => {
    if (!m || m.jsonrpc !== "2.0" || typeof m.method !== "string") return { jsonrpc: "2.0", id: m?.id ?? null, error: { code: -32600, message: "Invalid Request" } };
    try { return { jsonrpc: "2.0", id: m.id ?? null, result: rfcCall(m.method, m.params) }; }
    catch (e) { return { jsonrpc: "2.0", id: m.id ?? null, error: { code: e.code ?? -32000, message: e.message, data: { exception: e.rfc ?? "SYSTEM_FAILURE" } } }; }
  };
  return response.status(200).json(Array.isArray(b) ? b.map(one) : one(b));
}

// ── Salesforce (façade REST + Bulk API 2.0) ──────────────────────────────────
function sfToken(request, response) {
  const b = bodyOf(request), form = typeof b.__raw === "string" ? Object.fromEntries(new URLSearchParams(b.__raw)) : b;
  const grant = form.grant_type ?? request.query?.grant_type;
  if (grant !== "client_credentials") return response.status(400).json({ error: "unsupported_grant_type", error_description: "grant_type=client_credentials attendu" });
  const token = process.env.LUCIE_GATEWAY_TOKEN || DEMO_CREDENTIALS.gateway.token;
  if (form.client_secret !== token) return response.status(400).json({ error: "invalid_client", error_description: "client_secret = jeton passerelle de démonstration" });
  return response.status(200).json({ access_token: token, instance_url: PORTAL, id: `${PORTAL}/id/00DLUCIE/005LUCIE`, token_type: "Bearer", issued_at: String(Date.parse(`${DATASET.asOf}T00:00:00Z`)), signature: "simulated" });
}
const JOBS = /^jobs\/query\/(750[A-Za-z0-9_-]+)(\/results)?$/;
function sfRoute(request, q, response) {
  const version = String(q.version || "v60.0"), path = String(q.path || "").replace(/^\/+|\/+$/g, "");
  const sfErr = (status, errorCode, message) => response.status(status).json([{ message, errorCode }]);
  if (path === "sobjects") { cached(response); return response.status(200).json({ encoding: "UTF-8", maxBatchSize: 200, sobjects: RESOURCES.map(d => ({ name: sfObject(d), label: `${d.source} · ${d.entitySet}`, custom: true, queryable: true, urls: { describe: `/services/data/${version}/sobjects/${sfObject(d)}/describe` } })) }); }
  let m;
  if ((m = /^sobjects\/([A-Za-z0-9_]+)\/describe$/.exec(path))) { const d = RESOURCES.find(x => sfObject(x) === m[1]); if (!d) return sfErr(404, "NOT_FOUND", `The requested resource does not exist`); cached(response); return response.status(200).json(sfDescribe(d, version)); }
  if (path === "query" || (m = /^query\/(01g[A-Za-z0-9_-]+)$/.exec(path))) {
    let soqlText = q.q, cursor = 0;
    if (m) { try { const dec = JSON.parse(Buffer.from(m[1].slice(3), "base64url").toString("utf8")); soqlText = dec.q; cursor = dec.c; } catch { return sfErr(400, "INVALID_QUERY_LOCATOR", "invalid query locator"); } }
    if (!soqlText) return sfErr(400, "MALFORMED_QUERY", "q requis");
    let r; try { r = soql(String(soqlText), version, cursor); } catch (e) { return sfErr(400, "MALFORMED_QUERY", e.message); }
    cached(response);
    return response.status(200).json({ totalSize: r.totalSize, done: r.done, ...(r.done ? {} : { nextRecordsUrl: `/services/data/${version}/query/01g${Buffer.from(JSON.stringify({ q: soqlText, c: r.nextCursor })).toString("base64url")}` }), records: r.records });
  }
  if (path === "jobs/query" && request.method === "POST") {
    const b = bodyOf(request);
    if (b.operation !== "query" || !b.query) return sfErr(400, "INVALIDJOB", "operation=query et query requis");
    try { soql(String(b.query), version, 0); } catch (e) { return sfErr(400, "INVALIDJOB", e.message); }
    const id = `750${Buffer.from(JSON.stringify({ q: b.query })).toString("base64url")}`;
    return response.status(200).json({ id, operation: "query", object: /from\s+(\w+)/i.exec(b.query)?.[1], createdById: "005LUCIE", createdDate: `${DATASET.asOf}T00:00:00.000+0000`, state: "UploadComplete", concurrencyMode: "Parallel", contentType: "CSV", apiVersion: Number(version.slice(1)), lineEnding: "LF", columnDelimiter: "COMMA" });
  }
  if ((m = JOBS.exec(path))) {
    let spec; try { spec = JSON.parse(Buffer.from(m[1].slice(3), "base64url").toString("utf8")); } catch { return sfErr(404, "NOT_FOUND", "job inconnu"); }
    if (!m[2]) { const all = soql(spec.q, version, 0); cached(response); return response.status(200).json({ id: m[1], operation: "query", state: "JobComplete", numberRecordsProcessed: all.totalSize, retries: 0, totalProcessingTime: 0, apiVersion: Number(version.slice(1)), contentType: "CSV" }); }
    // Résultats CSV paginés : Sforce-Locator + maxRecords (≤ 1 000).
    const cursor = int(q.locator, 0), maxRecords = page(q.maxRecords, MAX_PAGE);
    const pq = parseSql(spec.q), r = soql(spec.q, version, cursor, maxRecords);
    const cols = pq.columns.map(c => c.as);
    const cell = v => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = [cols.join(","), ...r.records.map(rec => cols.map(c => cell(rec[c])).join(","))].join("\n") + "\n";
    response.setHeader("Sforce-Locator", r.nextCursor === null ? "null" : String(r.nextCursor));
    response.setHeader("Sforce-NumberOfRecords", String(r.records.length));
    cached(response);
    return text(response, 200, "text/csv; charset=utf-8", csv);
  }
  if (path === "" || path === version) return response.status(200).json({ sobjects: `/services/data/${version}/sobjects`, query: `/services/data/${version}/query`, jobs: `/services/data/${version}/jobs/query` });
  return sfErr(404, "NOT_FOUND", "The requested resource does not exist");
}

// ── RabbitMQ (API HTTP de management) et IBM MQ (REST messaging) ─────────────
async function wait(ms) { if (ms > 0) await new Promise(r => setTimeout(r, Math.min(ms, 1000))); }
async function amqpRoute(request, q, response) {
  if (!q.queue) {
    cached(response);
    return response.status(200).json(RESOURCES.map(d => ({ name: channelName(d), vhost: "/", durable: true, auto_delete: false, messages: readRows(d, { limit: 0 }).total, consumers: 0, state: "running", arguments: { "x-queue-type": "classic" } })));
  }
  const def = parseChannel(q.queue);
  if (!def) return response.status(404).json({ error: "Object Not Found", reason: "Not Found" });
  if (request.method !== "POST") return response.status(200).json({ name: channelName(def), vhost: decodeURIComponent(String(q.vhost ?? "%2F")), durable: true, messages: readRows(def, { limit: 0 }).total });
  const b = bodyOf(request);
  if (!b.ackmode || !b.encoding) return response.status(400).json({ error: "bad_request", reason: "count, ackmode et encoding requis (API de management RabbitMQ)" });
  // Sans état : la position de lecture est portée par le client (offset), la file n'est jamais vidée.
  const offset = int(b.offset ?? q.offset, 0), msgs = amqpGet(def, offset, page(b.count, 1));
  if (!msgs.length) await wait(int(b.wait ?? q.wait, 0));
  return response.status(200).json(msgs);
}
async function mqRoute(q, response) {
  const def = parseChannel(String(q.queue || "").toLowerCase());
  if (!def) return response.status(404).json({ error: [{ type: "rest", msgId: "MQWB0009E", message: `MQWB0009E: Could not find the queue '${q.queue}' on queue manager '${q.qmgr}'.`, explanation: "Files : LUCIE.<SOURCE>.<RESSOURCE>", action: "Vérifier le nom de la file." }] });
  const m = mqBrowse(def, int(q.offset, 0));
  if (!m) { await wait(int(q.wait, 0)); return response.status(204).end(); }
  for (const [k, v] of Object.entries(m.headers)) response.setHeader(k, v);
  return response.status(200).send(m.body);
}

// ── CloudEvents, CDC ─────────────────────────────────────────────────────────
function resolveRes(q, response) {
  const def = findResource(String(q.source || ""), String(q.resource || ""));
  if (!def) { response.status(404).json({ error: { code: "UNKNOWN_RESOURCE", message: `Ressource inconnue : ${q.source}/${q.resource}` } }); return null; }
  return def;
}
function ceRoute(q, response) {
  const def = resolveRes(q, response); if (!def) return;
  const offset = int(q.offset, 0), r = readRows(def, { offset, limit: page(q.limit) });
  cached(response);
  response.setHeader("X-Next-Offset", String(offset + r.rows.length));
  response.setHeader("X-End-Offset", String(r.total));
  if (r.nextOffset !== null) response.setHeader("Link", `</cloudevents/${def.source}/${def.resource}?offset=${r.nextOffset}&limit=${r.limit}>; rel="next"`);
  return text(response, 200, "application/cloudevents-batch+json; charset=utf-8", JSON.stringify(r.rows.map((row, i) => cloudEvent(def, row, offset + i))));
}
function cdcRoute(q, response) {
  const def = resolveRes(q, response); if (!def) return;
  cached(response);
  return response.status(200).json(cdcPage(def, int(q.offset, 0), page(q.limit)));
}

// ── AS2 ──────────────────────────────────────────────────────────────────────
function as2Route(request, q, response) {
  const op = String(q.op || (request.method === "POST" ? "receive" : "outbox"));
  if (op === "outbox") return response.status(200).json({ as2From: "MAISONLUCIE", as2To: "AURASUPPLY", messages: Object.entries(AS2_DOCS).map(([id, d]) => ({ id, document: `${d.kind === "edifact" ? "EDIFACT" : "X12"} ${d.type}`, contentType: d.contentType, url: `/as2/message/${id}?offset=0&limit=100` })) });
  if (op === "message") {
    const msg = as2Message(String(q.id || ""), int(q.offset, 0), page(q.limit));
    if (!msg) return response.status(404).json({ error: { code: "UNKNOWN_MESSAGE", ids: Object.keys(AS2_DOCS) } });
    for (const [k, v] of Object.entries(msg.headers)) response.setHeader(k, v);
    if (msg.nextOffset !== null) response.setHeader("X-Next-Offset", String(msg.nextOffset));
    cached(response);
    return response.status(200).send(msg.text);
  }
  const b = request.body, payload = Buffer.isBuffer(b) ? b.toString("utf8") : typeof b === "string" ? b : b ? JSON.stringify(b) : "";
  const mdn = as2Mdn({ messageId: requestHeader(request, "message-id"), as2From: requestHeader(request, "as2-from"), text: payload });
  for (const [k, v] of Object.entries(mdn.headers)) response.setHeader(k, v);
  return text(response, 200, mdn.contentType, mdn.body);
}

// ── Dépôt SFTP simulé ────────────────────────────────────────────────────────
function sftpRoute(q, response) {
  const op = String(q.op || "ls");
  if (op === "ls") {
    const entries = sftpListing(String(q.path || "/"), parquetManifest.sizes ?? {});
    if (!entries) return response.status(404).json({ error: { code: "NO_SUCH_FILE", message: `Chemin inconnu : ${q.path}` } });
    cached(response);
    return response.status(200).json({ protocol: "sftp-simulated", path: String(q.path || "/"), entries, longnames: entries.map(e => `${e.permissions} 1 lucie lucie ${String(e.size ?? 0).padStart(9)} ${e.mtime.slice(0, 10)} ${e.name}`) });
  }
  const f = sftpResolve(String(q.path || ""));
  if (!f) return response.status(404).json({ error: { code: "NO_SUCH_FILE", message: `Fichier inconnu : ${q.path}` } });
  if (f.format === "parquet") { response.setHeader("Location", parquetPath(f.def)); response.setHeader("Cache-Control", CACHE_HEADER); return response.status(302).end(); }
  const file = renderFile(f.def, f.format);
  cached(response);
  response.setHeader("Content-Disposition", `attachment; filename="${f.def.resource}.${f.format}"`);
  return text(response, 200, file.type, file.body);
}

// ── SQL en lecture seule sur le data lake ────────────────────────────────────
function sqlRoute(request, q, response) {
  if (q.tables !== undefined) { cached(response); return response.status(200).json({ dialect: "sous-ensemble ANSI SQL, lecture seule", tables: LAKE_TABLES.map(t => ({ name: t.name, columns: columnsOf(t.def).map(c => ({ name: c.name, type: sqlTypeOf(c.type), nullable: c.nullable })), rows: readRows(t.def, { limit: 0 }).total })) }); }
  const b = request.method === "POST" ? bodyOf(request) : {};
  const sql = b.sql ?? q.q;
  if (!sql) return response.status(400).json({ error: { code: "MISSING_SQL", message: "Fournir {\"sql\": \"SELECT …\"} ou ?q=" } });
  const parsed = parseSql(String(sql));
  const def = lakeTable(parsed.table);
  if (!def) throw new SqlError(`Table inconnue : ${parsed.table} (tables : ${LAKE_TABLES.map(t => t.name).join(", ")})`);
  const t0 = Date.now(), r = runSql(parsed, def);
  const types = Object.fromEntries(columnsOf(def).map(c => [c.name, sqlTypeOf(c.type)]));
  if (request.method === "GET") cached(response);
  return response.status(200).json({ columns: r.columns.map(n => ({ name: n, type: types[n] ?? (r.rows.every(x => Number.isInteger(x[n])) ? "BIGINT" : typeof r.rows[0]?.[n] === "number" ? "DOUBLE" : "VARCHAR") })), rows: r.rows, rowCount: r.rows.length, total: r.total, nextOffset: r.nextOffset, elapsedMs: Date.now() - t0, synthetic: true });
}

// ── gRPC-web ─────────────────────────────────────────────────────────────────
function grpcRoute(request, response) {
  const req = grpcDecodeRequest(request.body);
  const def = findResource(String(req.source || ""), String(req.resource || ""));
  response.setHeader("Content-Type", "application/grpc-web+proto");
  response.setHeader("Access-Control-Expose-Headers", "grpc-status, grpc-message");
  if (!def) { response.setHeader("grpc-status", "5"); response.setHeader("grpc-message", "resource not found"); return response.status(200).send(Buffer.alloc(0)); }
  const r = readRows(def, { offset: int(req.page_token, 0), limit: page(req.page_size) });
  response.setHeader("grpc-status", "0");
  return response.status(200).send(grpcEncodeResponse(def, r));
}

// ── ESB / iPaaS ──────────────────────────────────────────────────────────────
function esbRoute(q, response, correlationId) {
  const flow = String(q.flow || "");
  if (!flow) return response.status(200).json({ product: "Lucie Integration Hub (style MuleSoft Anypoint / Boomi, simulé)", flows: Object.entries(ESB_FLOWS).map(([id, f]) => ({ id, url: `/esb/api/v1/${id}`, system: f.system })), route: "/esb/api/v1/route?to={source}&resource={resource}" });
  const r = esbFlow(flow, q, correlationId);
  for (const [k, v] of Object.entries(r.headers ?? {})) response.setHeader(k, v);
  return response.status(r.status).json(r.body);
}

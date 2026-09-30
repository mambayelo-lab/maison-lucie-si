// Serveur MCP (Model Context Protocol) du SI Maison Lucie — cœur JSON-RPC 2.0.
// Transport « Streamable HTTP » sans état (api/mcp.js) : chaque POST porte un
// message JSON-RPC et reçoit une réponse application/json ; pas de flux SSE
// (GET → 405, permis par la spécification), pas de session (pas de Mcp-Session-Id).
// Implémentation directe plutôt que @modelcontextprotocol/sdk : aucune dépendance
// ni état en mémoire, démarrage à froid minimal dans une fonction Vercel.
import { AS_OF, KPIS, MAX_PAGE, RESOURCES, SOURCE_IDS, columnsOf, findResource, kpiSeries, readRows, siAlerts } from "./channels.js";
import { SOURCES, DELIBERATE_ERRORS } from "./multisource-api.js";
import { ontology } from "./demo-data.js";

export const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_INFO = { name: "maison-lucie-si", title: "Maison Lucie — SI de démonstration", version: "1.3.0" };

const OPS = ["eq", "ne", "gt", "ge", "lt", "le", "in", "like", "null", "notnull"];
export const TOOLS = [
  { name: "list_sources", title: "Lister les sources", description: "Liste les 9 applications du SI Maison Lucie, leurs ressources, clés, champs de modification, colonnes typées et volumes.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } },
  { name: "read_object", title: "Lire un objet", description: "Lit un objet par sa clé (ex. source=sap, resource=A_Supplier, key=0000100001).", inputSchema: { type: "object", properties: { source: { type: "string", enum: SOURCE_IDS }, resource: { type: "string" }, key: { type: "string" } }, required: ["source", "resource", "key"], additionalProperties: false }, annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } },
  { name: "query", title: "Requête filtrée", description: `Lit une ressource avec filtres, projection, tri et pagination (${MAX_PAGE} lignes au plus par appel). Opérateurs : ${OPS.join(", ")}.`, inputSchema: { type: "object", properties: { source: { type: "string", enum: SOURCE_IDS }, resource: { type: "string" }, filters: { type: "array", items: { type: "object", properties: { field: { type: "string" }, op: { type: "string", enum: OPS }, value: {} }, required: ["field", "op"] } }, fields: { type: "array", items: { type: "string" } }, orderBy: { type: "object", properties: { field: { type: "string" }, desc: { type: "boolean" } }, required: ["field"] }, limit: { type: "integer", minimum: 1, maximum: MAX_PAGE, default: 100 }, offset: { type: "integer", minimum: 0, default: 0 } }, required: ["source", "resource"], additionalProperties: false }, annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } },
  { name: "kpi_series", title: "Séries d'indicateurs", description: `Série temporelle ou ventilée d'un indicateur calculé à la source. Indicateurs : ${Object.keys(KPIS).join(", ")}.`, inputSchema: { type: "object", properties: { kpi: { type: "string", enum: Object.keys(KPIS) } }, required: ["kpi"], additionalProperties: false }, annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } },
  { name: "alerts", title: "Alertes", description: "Alertes de résilience du SI (rupture, retard, certification, risque fournisseur), avec leur règle et un échantillon de preuve.", inputSchema: { type: "object", properties: { severity: { type: "string", enum: ["CRITICAL", "MAJOR"] } }, additionalProperties: false }, annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } },
];

export function catalogPayload() {
  return {
    asOf: AS_OF, synthetic: true,
    sources: SOURCE_IDS.map(id => ({ id, label: SOURCES[id].label, role: SOURCES[id].role, keys: SOURCES[id].keys,
      resources: RESOURCES.filter(r => r.source === id).map(r => ({ resource: r.resource, entitySet: r.entitySet, key: r.key, watermark: r.watermark, rows: readRows(r, { limit: 0 }).total, columns: columnsOf(r) })) })),
    deliberateErrors: DELIBERATE_ERRORS.map(e => ({ id: e.id, source: e.source, description: e.description })),
  };
}
export const RESOURCE_LIST = [
  { uri: "lucie://catalog", name: "catalog", title: "Catalogue des sources", description: "Applications, ressources, clés et colonnes typées.", mimeType: "application/json" },
  { uri: "lucie://ontology", name: "ontology", title: "Ontologie Supply", description: "Objets métier, maîtres par domaine et correspondance avec les ressources du SI.", mimeType: "application/json" },
  ...SOURCE_IDS.map(id => ({ uri: `lucie://schema/${id}`, name: `schema-${id}`, title: `Schéma ${SOURCES[id].label}`, description: `JSON Schema des ressources de ${id}.`, mimeType: "application/schema+json" })),
];
const JS = { integer: "integer", decimal: "number", boolean: "boolean", datetime: "string", date: "string", string: "string" };
export function schemaOf(source) {
  const defs = RESOURCES.filter(r => r.source === source);
  if (!defs.length) return null;
  return { $schema: "https://json-schema.org/draft/2020-12/schema", $id: `lucie://schema/${source}`, title: SOURCES[source].label,
    $defs: Object.fromEntries(defs.map(d => [d.entitySet, { type: "object", "x-key": d.key, "x-watermark": d.watermark, properties: Object.fromEntries(columnsOf(d).map(c => [c.name, { type: c.nullable ? [JS[c.type], "null"] : JS[c.type], ...(c.type === "date" ? { format: "date" } : c.type === "datetime" ? { "x-format": "YYYY-MM-DD HH:mm:ss (UTC)" } : {}) }])), required: [d.key] }])) };
}
export function ontologyPayload() {
  return { ...ontology, domains: [
    { object: "Fournisseur", master: "sap/A_Supplier", carriedBy: ["srm/suppliers (TaxId)", "qms/nonconformities (SupplierTaxId)", "pim/products (supplierTaxId)", "tms/shipments (OriginName)"] },
    { object: "Article", master: "pim/products", carriedBy: ["sap/A_PurchaseOrderItem (Material)", "manhattan/inventory (ItemId GTIN-14)", "oms/order-lines (ProductRef)", "aps/forecasts (Material)", "qms/nonconformities (Ean)", "lake/sales (Ean)"] },
    { object: "Site", master: "manhattan/facilities", carriedBy: ["oms/order-lines (FulfillmentSite)", "aps/forecasts (Site)", "lake/sales (StoreCode)"] },
    { object: "Stock", master: "manhattan/inventory", carriedBy: ["lake/stock (J-1)"] },
    { object: "Expédition", master: "tms/shipments", carriedBy: ["lake/transport (J-1)"] },
    { object: "Commande client", master: "oms/order-lines", carriedBy: ["manhattan/movements", "tms/deliveries", "lake/orders (J-1)"] },
    { object: "Prévision", master: "aps/forecasts", carriedBy: ["lake/forecasts (J-1)"] },
    { object: "Non-conformité", master: "qms/nonconformities", carriedBy: ["lake/quality (J-1)"] },
  ] };
}

class RpcError extends Error { constructor(code, message, data) { super(message); this.code = code; this.data = data; } }
const toolResult = (value, isError = false) => ({ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: Array.isArray(value) ? { items: value } : value, isError });

function callTool(name, args = {}) {
  const need = (...keys) => { const miss = keys.filter(k => args[k] === undefined || args[k] === ""); if (miss.length) throw new RpcError(-32602, `Paramètres manquants : ${miss.join(", ")}`); };
  switch (name) {
    case "list_sources": return toolResult(catalogPayload());
    case "read_object": {
      need("source", "resource", "key");
      const def = findResource(args.source, args.resource);
      if (!def) return toolResult({ error: `Ressource inconnue : ${args.source}/${args.resource}` }, true);
      const r = readRows(def, { filters: [{ field: def.key, op: "eq", value: String(args.key) }], limit: 1 });
      return r.rows.length ? toolResult({ source: def.source, resource: def.resource, key: def.key, object: r.rows[0] }) : toolResult({ error: `Aucun objet ${def.key} = ${args.key}` }, true);
    }
    case "query": {
      need("source", "resource");
      const def = findResource(args.source, args.resource);
      if (!def) return toolResult({ error: `Ressource inconnue : ${args.source}/${args.resource}` }, true);
      const known = new Set(columnsOf(def).map(c => c.name));
      const bad = [...(args.filters ?? []).map(f => f.field), ...(args.fields ?? []), ...(args.orderBy ? [args.orderBy.field] : [])].filter(f => !known.has(f));
      if (bad.length) return toolResult({ error: `Champs inconnus : ${bad.join(", ")}`, columns: [...known] }, true);
      if ((args.filters ?? []).some(f => !OPS.includes(f.op))) return toolResult({ error: `Opérateur inconnu (${OPS.join(", ")})` }, true);
      const r = readRows(def, { filters: args.filters ?? [], select: args.fields ?? null, orderBy: args.orderBy ?? null, offset: args.offset ?? 0, limit: Math.min(args.limit ?? 100, MAX_PAGE) });
      return toolResult({ source: def.source, resource: def.resource, total: r.total, offset: r.offset, nextOffset: r.nextOffset, rows: r.rows });
    }
    case "kpi_series": {
      need("kpi");
      const series = kpiSeries(args.kpi);
      return series ? toolResult({ kpi: args.kpi, ...KPIS[args.kpi], asOf: AS_OF, series }) : toolResult({ error: `Indicateur inconnu : ${args.kpi}`, kpis: Object.keys(KPIS) }, true);
    }
    case "alerts": return toolResult({ asOf: AS_OF, alerts: siAlerts().filter(a => !args.severity || a.severity === args.severity) });
  }
  throw new RpcError(-32602, `Outil inconnu : ${name}`);
}
function readResource(uri) {
  let value;
  if (uri === "lucie://catalog") value = catalogPayload();
  else if (uri === "lucie://ontology") value = ontologyPayload();
  else if (uri.startsWith("lucie://schema/")) value = schemaOf(uri.slice("lucie://schema/".length));
  if (!value) throw new RpcError(-32002, "Resource not found", { uri });
  return { contents: [{ uri, mimeType: RESOURCE_LIST.find(r => r.uri === uri)?.mimeType ?? "application/json", text: JSON.stringify(value) }] };
}

/** Traite un message JSON-RPC ; renvoie la réponse, ou null pour une notification / réponse. */
export function handleMessage(msg) {
  const isRequest = msg && typeof msg === "object" && typeof msg.method === "string" && msg.id !== undefined && msg.id !== null;
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") return { jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32600, message: "Invalid Request" } };
  if (!isRequest) return null; // notification (notifications/initialized…) ou réponse client
  const reply = result => ({ jsonrpc: "2.0", id: msg.id, result });
  try {
    const p = msg.params ?? {};
    switch (msg.method) {
      case "initialize": {
        const version = SUPPORTED_VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : SUPPORTED_VERSIONS[0];
        return reply({ protocolVersion: version, capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } }, serverInfo: SERVER_INFO,
          instructions: "SI de démonstration Maison Lucie (données synthétiques, déterministes). Commencer par list_sources, puis query (1 000 lignes au plus par appel) ; kpi_series et alerts sont calculés à la source." });
      }
      case "ping": return reply({});
      case "tools/list": return reply({ tools: TOOLS });
      case "tools/call": return reply(callTool(p.name, p.arguments ?? {}));
      case "resources/list": return reply({ resources: RESOURCE_LIST });
      case "resources/templates/list": return reply({ resourceTemplates: [{ uriTemplate: "lucie://schema/{source}", name: "schema", title: "Schéma d'une source", description: `source parmi ${SOURCE_IDS.join(", ")}`, mimeType: "application/schema+json" }] });
      case "resources/read": return reply(readResource(String(p.uri ?? "")));
      case "prompts/list": return reply({ prompts: [] });
      case "logging/setLevel": return reply({});
    }
    throw new RpcError(-32601, `Method not found: ${msg.method}`);
  } catch (e) {
    return { jsonrpc: "2.0", id: msg.id, error: { code: e instanceof RpcError ? e.code : -32603, message: e.message, ...(e.data ? { data: e.data } : {}) } };
  }
}

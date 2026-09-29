import { authenticateGateway, beginRequest, sendError, unauthorized } from "../../lib/http-api.js";
import { catalog, lakeAggregate, odata, odataMetadata, restPage, scalePage, SOURCES, toCsv, DATASET } from "../../lib/multisource-api.js";

// SI multi-sources : /api/sources/{index|sap|pim|manhattan|oms|lake}
// SAP est aussi exposé sous /sap/opu/odata/sap/<service>/<entité> (réécriture vercel.json).
// Plafond de requêtes scale par instance et par client : 60 par minute, au-delà 429.
const SCALE_RATE = 60, hits = new Map();
function overScaleRate(request) {
  const key = String(request.headers?.["x-forwarded-for"] || "local").split(",")[0].trim(), now = Date.now();
  const h = hits.get(key); if (!h || now - h.t > 60_000) { hits.set(key, { t: now, n: 1 }); if (hits.size > 5000) hits.clear(); return false; }
  return ++h.n > SCALE_RATE;
}

export default async function handler(request, response) {
  const gate = beginRequest(request, response, ["GET", "HEAD"]);
  if (!gate.ok) return;
  const q = { ...(request.query || {}) };
  const source = String(q.source || "index");
  delete q.source;
  response.setHeader("X-Synthetic-Data", "true");
  if (source === "index") return response.status(200).json(catalog());
  if (!SOURCES[source]) return sendError(response, 404, "UNKNOWN_SOURCE", `Source inconnue : ${source}`, gate.requestId);
  // Liens directs depuis la page d'accueil : jeton passerelle accepté aussi en paramètre (?token=).
  if (q.token) { request.headers = { ...(request.headers || {}), authorization: `Bearer ${q.token}` }; delete q.token; }
  if (!authenticateGateway(request)) return unauthorized(response, gate.requestId);
  if (q.size === "scale" || q.volume === "scale") {
    const name = source === "sap" ? String(q.entity || "") : String(q.resource || Object.keys(SOURCES[source].resources)[0]);
    const base = source === "sap" ? (name === "A_Supplier" ? "/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_Supplier" : `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/${name}`) : "";
    if (overScaleRate(request)) { response.setHeader("Retry-After", "60"); return sendError(response, 429, "RATE_LIMITED", "Plafond de 60 requêtes par minute en taille scale.", gate.requestId); }
    const r = scalePage(source, name, q, base);
    response.setHeader("X-Generated-On-The-Fly", "true");
    // Pages déterministes (graine fixe) : mises en cache par le CDN un jour.
    if (r.status === 200) response.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return response.status(r.status).json(r.body);
  }

  if (source === "sap") {
    const entity = String(q.entity || "");
    delete q.entity;
    const base = entity === "A_Supplier" ? "/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_Supplier" : `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/${entity}`;
    if (!entity) return response.status(200).json({ d: { EntitySets: Object.keys(SOURCES.sap.entities) } });
    if (entity === "$metadata") { response.setHeader("Content-Type", "application/xml; charset=utf-8"); return response.status(200).send(odataMetadata()); }
    const r = odata(entity, q, base);
    return response.status(r.status).json(r.body);
  }
  if (source === "lake" && q.aggregate) { const r = lakeAggregate(q); return response.status(r.status).json(r.body); }
  const resource = String(q.resource || Object.keys(SOURCES[source].resources)[0]);
  if (q.format === "csv") {
    const def = SOURCES[source].resources[resource];
    if (!def) return sendError(response, 404, "NOT_FOUND", `Ressource inconnue : ${resource}`, gate.requestId);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    return response.status(200).send(toCsv(DATASET.tables[def.table]));
  }
  const r = restPage(source, resource, q);
  return response.status(r.status).json(r.body);
}

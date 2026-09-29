import { authenticateGateway, beginRequest, sendError, unauthorized } from "../../lib/http-api.js";
import { catalog, lakeAggregate, odata, odataMetadata, restPage, scalePage, SOURCES, toCsv, DATASET } from "../../lib/multisource-api.js";

// SI multi-sources : /api/sources/{index|sap|pim|manhattan|oms|lake}
// SAP est aussi exposé sous /sap/opu/odata/sap/<service>/<entité> (réécriture vercel.json).
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
    const r = scalePage(source, name, q, base);
    response.setHeader("X-Generated-On-The-Fly", "true");
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

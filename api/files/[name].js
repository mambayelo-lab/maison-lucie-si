import { createHash } from "node:crypto";
import { authenticateFiles, authorizeApplication, beginRequest, requestHeader, sendError, unauthorized } from "../../lib/http-api.js";
import { readAllDatasets, readDataset } from "../../lib/persistence.js";
import { APP_IDS, resolveTable, tableNames, tableRecords, toCsv } from "../../lib/access.js";
import { legacyCsvFiles } from "../../lib/enrichment.js";
import { datasets as seedDatasets } from "../../lib/demo-data.js";

// Exports fichiers CSV :
// - historiques : demand-forecast.csv, supplier-scorecard.csv (X-API-Key "files", colonnes inchangées) ;
// - par application : <appId>.csv (table principale) et <appId>.<Table>.csv
//   (X-API-Key "files" OU identifiants REST de l'application OU jeton passerelle) ;
// - index.json : liste des fichiers disponibles.
const LEGACY = legacyCsvFiles(seedDatasets);

function sendCsv(request, response, name, content) {
  const etag = `"${createHash("sha256").update(content).digest("hex")}"`;
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", `inline; filename="${name}"`);
  response.setHeader("ETag", etag);
  response.setHeader("X-Record-Count", String(content.trim().split("\n").length - 1));
  response.setHeader("X-Synthetic-Data", "true");
  if (requestHeader(request, "if-none-match") === etag) return response.status(304).end();
  if (String(request.method).toUpperCase() === "HEAD") return response.status(200).end();
  return response.status(200).send(content);
}

export default async function handler(request, response) {
  const gate = beginRequest(request, response, ["GET", "HEAD"]);
  if (!gate.ok) return;
  const name = String(request.query?.name || "");
  const filesKey = authenticateFiles(request);

  if (name === "index.json" || name === "index") {
    if (!filesKey) return unauthorized(response, gate.requestId, "ApiKey");
    const all = await readAllDatasets();
    const files = [
      ...Object.keys(LEGACY).map(file => ({ name: file, url: `/api/files/${file}`, kind: "legacy" })),
      ...APP_IDS.flatMap(appId => tableNames(all[appId]).map((table, index) => ({ name: index === 0 ? `${appId}.csv` : `${appId}.${table}.csv`, url: `/api/files/${index === 0 ? `${appId}.csv` : `${appId}.${table}.csv`}`, appId, table }))),
    ];
    return response.status(200).json({ files, synthetic: true, requestId: gate.requestId });
  }

  if (LEGACY[name]) {
    if (!filesKey) return unauthorized(response, gate.requestId, "ApiKey");
    return sendCsv(request, response, name, LEGACY[name]);
  }

  const match = /^([a-z0-9-]+?)(?:\.([A-Za-z][A-Za-z0-9]*))?\.csv$/.exec(name);
  if (!match || !APP_IDS.includes(match[1])) return sendError(response, 404, "UNKNOWN_FILE", "Unknown Maison Lucie file export. GET /api/files/index.json lists them.", gate.requestId, { name });
  const [, appId, tableParam] = match;
  if (!filesKey && !(await authorizeApplication(request, appId))) return unauthorized(response, gate.requestId, "ApiKey");
  const dataset = await readDataset(appId);
  const table = resolveTable(dataset, tableParam);
  if (!table) return sendError(response, 404, "UNKNOWN_TABLE", "Unknown table for this application.", gate.requestId, { appId, table: tableParam, availableTables: tableNames(dataset) });
  return sendCsv(request, response, name, toCsv(tableRecords(dataset, table)));
}

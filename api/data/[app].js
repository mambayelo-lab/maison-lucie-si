import { applications, generatedAt } from "../../lib/demo-data.js";
import { persistenceMode, readDataset, validateRecords, writeDataset } from "../../lib/persistence.js";
import { resolveTable, tableNames, tableRecords } from "../../lib/access.js";
import { authenticateApplication, authenticateGateway, authSchemeFor, beginRequest, publicApplication, sendError, unauthorized } from "../../lib/http-api.js";

export default async function handler(request, response) {
  const gate = beginRequest(request, response, ["GET", "PATCH"]);
  if (!gate.ok) return;

  const appId = String(request.query?.app || "");
  const application = applications.find(item => item.id === appId);
  const dataset = await readDataset(appId);
  if (!application || !dataset) return sendError(response, 404, "UNKNOWN_APPLICATION", "Unknown Maison Lucie application.", gate.requestId, { appId });

  const requestedTable = request.query?.table ? String(request.query.table) : "";
  const table = resolveTable(dataset, requestedTable);
  if (!table) return sendError(response, 404, "UNKNOWN_TABLE", "Unknown table for this application.", gate.requestId, { appId, table: requestedTable, availableTables: tableNames(dataset) });
  const { tables, ...mainDataset } = dataset;

  if (request.method === "PATCH") {
    if (!authenticateGateway(request)) return unauthorized(response, gate.requestId);
    const records = request.body?.records;
    const invalid = validateRecords(records);
    if (invalid) return sendError(response, 400, "INVALID_RECORDS", invalid, gate.requestId);
    const next = table === dataset.entity ? { ...dataset, records } : { ...dataset, tables: { ...(tables || {}), [table]: records } };
    const saved = await writeDataset(appId, next);
    const { tables: _savedTables, ...savedMain } = saved;
    const view = table === dataset.entity ? savedMain : { ...savedMain, entity: table, records: saved.tables[table] };
    return response.status(200).json({ application: publicApplication(application), generatedAt: generatedAt(), ...view, availableTables: tableNames(saved), persistence: persistenceMode, lineage: { sourceId: appId, requestId: gate.requestId } });
  }

  const scheme = authSchemeFor(appId);
  if (!(await authenticateApplication(request, appId))) return unauthorized(response, gate.requestId, scheme);

  return response.status(200).json({
    application: publicApplication(application),
    ...(table === dataset.entity ? mainDataset : { ...mainDataset, entity: table, records: tableRecords(dataset, table) }),
    availableTables: tableNames(dataset),
    lineage: { sourceId: appId, environment: "Maison Lucie Demo", synthetic: true, requestId: gate.requestId },
  });
}

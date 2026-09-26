import { applications, generatedAt } from "../../lib/demo-data.js";
import { persistenceMode, readDataset, validateRecords, writeDataset } from "../../lib/persistence.js";
import { authenticateApplication, authenticateGateway, beginRequest, publicApplication, sendError, unauthorized } from "../../lib/http-api.js";

export default async function handler(request, response) {
  const gate = beginRequest(request, response, ["GET", "PATCH"]);
  if (!gate.ok) return;

  const appId = String(request.query?.app || "");
  const application = applications.find(item => item.id === appId);
  const dataset = await readDataset(appId);
  if (!application || !dataset) return sendError(response, 404, "UNKNOWN_APPLICATION", "Unknown Maison Lumen application.", gate.requestId, { appId });

  if (request.method === "PATCH") {
    if (!authenticateGateway(request)) return unauthorized(response, gate.requestId);
    const records = request.body?.records;
    const invalid = validateRecords(records);
    if (invalid) return sendError(response, 400, "INVALID_RECORDS", invalid, gate.requestId);
    const saved = await writeDataset(appId, { ...dataset, records });
    return response.status(200).json({ application: publicApplication(application), generatedAt: generatedAt(), ...saved, persistence: persistenceMode, lineage: { sourceId: appId, requestId: gate.requestId } });
  }

  const scheme = appId === "sap-s4" ? "Basic" : ["manhattan-wms", "mulesoft-events"].includes(appId) ? "ApiKey" : "Bearer";
  if (!(await authenticateApplication(request, appId))) return unauthorized(response, gate.requestId, scheme);

  return response.status(200).json({
    application: publicApplication(application),
    ...dataset,
    lineage: { sourceId: appId, environment: "Maison Lumen Demo", synthetic: true, requestId: gate.requestId },
  });
}

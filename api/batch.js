import { createHash } from "node:crypto";
import { authorizeApplication, beginRequest, sendError, unauthorized } from "../lib/http-api.js";
import { appendAudit, readDataset } from "../lib/persistence.js";
import { APP_IDS, applyFilter, resolveTable, tableNames, tableRecords, toCsv, toNdjson } from "../lib/access.js";

// Batch d'export (sans état serveur) :
// POST /api/batch {app, table?, format?: "ndjson"|"csv", filter?: {champ: valeur}}
//   → 202 {jobId, status: "SUCCEEDED", links}. Le jobId encode la demande
//   (base64url + empreinte), donc le statut et le résultat sont recalculables
//   par n'importe quelle instance serverless.
// GET /api/batch?job=<jobId>            → statut du job
// GET /api/batch?job=<jobId>&result=1   → résultat NDJSON ou CSV
// GET /api/batch                        → capacités (applications, tables, formats)
// Auth : identifiants REST de l'application ciblée (ou jeton passerelle), à chaque appel.

const FORMATS = { ndjson: "application/x-ndjson; charset=utf-8", csv: "text/csv; charset=utf-8" };
const digest = text => createHash("sha256").update(text).digest("base64url").slice(0, 12);

function encodeJob(spec) {
  const body = Buffer.from(JSON.stringify(spec)).toString("base64url");
  return `job_${body}.${digest(body)}`;
}
function decodeJob(jobId) {
  const match = /^job_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{12})$/.exec(String(jobId || ""));
  if (!match || digest(match[1]) !== match[2]) return null;
  try { return JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")); } catch { return null; }
}
function parseBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  try { return JSON.parse(String(request.body || "{}")); } catch { return null; }
}

async function run(spec) {
  const dataset = await readDataset(spec.app);
  const table = resolveTable(dataset, spec.table);
  if (!table) return { error: { status: 404, code: "UNKNOWN_TABLE", details: { app: spec.app, table: spec.table, availableTables: tableNames(dataset) } } };
  const rows = applyFilter(tableRecords(dataset, table), spec.filter);
  const content = spec.format === "csv" ? toCsv(rows) : toNdjson(rows);
  return { table, rows, content };
}

function describe(jobId, spec, result) {
  return {
    jobId, status: "SUCCEEDED", app: spec.app, table: result.table, format: spec.format, filter: spec.filter || {},
    submittedAt: spec.submittedAt, completedAt: spec.submittedAt, recordCount: result.rows.length,
    bytes: Buffer.byteLength(result.content), sha256: createHash("sha256").update(result.content).digest("hex"), synthetic: true,
    links: { status: `/api/batch?job=${jobId}`, result: `/api/batch?job=${jobId}&result=1` },
  };
}

export default async function handler(request, response) {
  const gate = beginRequest(request, response, ["GET", "POST"]);
  if (!gate.ok) return;
  const url = new URL(request.url || "/api/batch", "https://maison-lucie-si.vercel.app");
  const params = { ...Object.fromEntries(url.searchParams), ...(request.query || {}) };

  if (request.method === "POST") {
    const body = parseBody(request);
    if (!body) return sendError(response, 400, "INVALID_JSON", "Batch request must be JSON.", gate.requestId);
    const app = String(body.app || "");
    if (!APP_IDS.includes(app)) return sendError(response, 404, "UNKNOWN_APPLICATION", "Unknown Maison Lucie application.", gate.requestId, { app, applications: APP_IDS });
    const format = String(body.format || "ndjson").toLowerCase();
    if (!FORMATS[format]) return sendError(response, 400, "UNSUPPORTED_FORMAT", "format must be ndjson or csv.", gate.requestId);
    if (body.filter !== undefined && (typeof body.filter !== "object" || Array.isArray(body.filter) || body.filter === null)) return sendError(response, 400, "INVALID_FILTER", "filter must be an object of field equality conditions.", gate.requestId);
    if (!(await authorizeApplication(request, app))) return unauthorized(response, gate.requestId);
    const spec = { app, table: body.table ? String(body.table) : null, format, filter: body.filter || {}, submittedAt: new Date().toISOString() };
    const result = await run(spec);
    if (result.error) return sendError(response, result.error.status, result.error.code, "Unknown table for this application.", gate.requestId, result.error.details);
    const jobId = encodeJob({ ...spec, table: result.table });
    await appendAudit({ type: "batch.job.completed", appId: app, table: result.table, format, recordCount: result.rows.length, at: spec.submittedAt });
    response.setHeader("Location", `/api/batch?job=${jobId}`);
    return response.status(202).json({ ...describe(jobId, { ...spec, table: result.table }, result), requestId: gate.requestId });
  }

  if (!params.job) {
    return response.status(200).json({
      protocol: "batch-export", formats: Object.keys(FORMATS), synthetic: true,
      usage: { submit: "POST /api/batch {\"app\":\"sap-s4\",\"table\":\"PurchaseOrder\",\"format\":\"ndjson\",\"filter\":{\"status\":\"AT_RISK\"}}", status: "GET /api/batch?job={jobId}", result: "GET /api/batch?job={jobId}&result=1" },
      applications: await Promise.all(APP_IDS.map(async appId => ({ app: appId, tables: tableNames(await readDataset(appId)) }))),
      requestId: gate.requestId,
    });
  }
  const spec = decodeJob(params.job);
  if (!spec || !APP_IDS.includes(spec.app)) return sendError(response, 404, "UNKNOWN_JOB", "Unknown or tampered batch job id.", gate.requestId);
  if (!(await authorizeApplication(request, spec.app))) return unauthorized(response, gate.requestId);
  const result = await run(spec);
  if (result.error) return sendError(response, 410, "JOB_EXPIRED", "The table of this job no longer exists.", gate.requestId);
  if (params.result !== undefined && params.result !== "0") {
    response.setHeader("Content-Type", FORMATS[spec.format]);
    response.setHeader("Content-Disposition", `attachment; filename="${spec.app}.${result.table}.${spec.format}"`);
    response.setHeader("X-Record-Count", String(result.rows.length));
    response.setHeader("X-Synthetic-Data", "true");
    return response.status(200).send(result.content);
  }
  return response.status(200).json({ ...describe(params.job, spec, result), requestId: gate.requestId });
}

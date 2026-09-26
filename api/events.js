import { generatedAt } from "../lib/demo-data.js";
import { readDataset } from "../lib/persistence.js";
import { authenticateApplication, beginRequest, sendError, unauthorized } from "../lib/http-api.js";

function toCloudEvent(record) {
  return {
    specversion: "1.0",
    id: record.id,
    source: `/maison-lumen/${record.source}`,
    type: `com.maisonlumen.${record.type}`,
    subject: record.subject,
    time: record.time,
    datacontenttype: "application/json",
    data: { severity: record.severity, synthetic: true },
  };
}

export default async function handler(request, response) {
  const gate = beginRequest(request, response, ["GET"]);
  if (!gate.ok) return;
  if (!(await authenticateApplication(request, "mulesoft-events"))) return unauthorized(response, gate.requestId);

  const cursor = Number.parseInt(String(request.query?.cursor ?? "0"), 10);
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(request.query?.limit ?? "50"), 10) || 50));
  if (!Number.isInteger(cursor) || cursor < 0) return sendError(response, 400, "INVALID_CURSOR", "cursor must be a non-negative integer.", gate.requestId);
  if (request.query?.since && Number.isNaN(Date.parse(String(request.query.since)))) return sendError(response, 400, "INVALID_SINCE", "since must be an ISO-8601 timestamp.", gate.requestId);

  const stored = await readDataset("mulesoft-events");
  const all = (stored?.records || []).map(toCloudEvent);
  const filtered = all.filter(event => {
    if (request.query?.type && event.type !== request.query.type) return false;
    if (request.query?.subject && event.subject !== request.query.subject) return false;
    if (request.query?.since && Date.parse(event.time) <= Date.parse(String(request.query.since))) return false;
    return true;
  });
  const items = filtered.slice(cursor, cursor + limit);
  const nextCursor = Math.min(filtered.length, cursor + items.length);
  response.setHeader("Content-Type", "application/cloudevents-batch+json; charset=utf-8");
  response.setHeader("X-Next-Cursor", String(nextCursor));
  response.setHeader("X-Event-Count", String(items.length));
  response.setHeader("X-Generated-At", generatedAt());
  if (nextCursor < filtered.length) response.setHeader("Link", `</api/events?cursor=${nextCursor}&limit=${limit}>; rel=\"next\"`);
  return response.status(200).send(JSON.stringify(items));
}

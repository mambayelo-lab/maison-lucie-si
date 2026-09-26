import { beginRequest, authenticateApplication, sendError, unauthorized } from "../lib/http-api.js";
import { readDataset, writeDataset } from "../lib/persistence.js";

export default async function handler(request, response) {
  const ctx = beginRequest(request, response, ["GET", "POST"]);
  if (!ctx.ok) return;
  if (!(await authenticateApplication(request, "webhook-gateway"))) return unauthorized(response, ctx.requestId, "ApiKey");
  const stored = await readDataset("webhook-inbox");
  const records = Array.isArray(stored?.records) ? stored.records : [];
  if (request.method === "GET") return response.status(200).json({ protocol: "webhook", deliveries: records, requestId: ctx.requestId });
  let body;
  try { body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : (request.body || {}); } catch { return sendError(response, 400, "INVALID_JSON", "Webhook payload must be JSON.", ctx.requestId); }
  const delivery = { id: `wh-${Date.now()}-${records.length + 1}`, event: body.event || body.type || "lumen.event", payload: body.payload ?? body, receivedAt: new Date().toISOString(), signatureVerified: false };
  await writeDataset("webhook-inbox", { entity: "WebhookDelivery", records: [...records, delivery] });
  return response.status(202).json({ accepted: true, protocol: "webhook", delivery, requestId: ctx.requestId });
}

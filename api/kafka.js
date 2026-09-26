import { beginRequest, authenticateApplication, requestHeader, sendError, unauthorized } from "../lib/http-api.js";
import { readDataset, writeDataset } from "../lib/persistence.js";

const TOPIC = "lumen.supplychain.events";

export default async function handler(request, response) {
  const ctx = beginRequest(request, response, ["GET", "POST"]);
  if (!ctx.ok) return;
  if (!(await authenticateApplication(request, "kafka-stream"))) return unauthorized(response, ctx.requestId, "ApiKey");
  const url = new URL(request.url || "/api/kafka", "https://maison-lumen-si.vercel.app");
  const topic = url.searchParams.get("topic") || TOPIC;
  const stored = await readDataset("kafka-stream");
  const records = Array.isArray(stored?.records) ? stored.records : [];
  if (request.method === "GET") return response.status(200).json({ protocol: "kafka-compatible-http", topic, messages: records.filter(item => item.topic === topic), nextOffset: records.length, requestId: ctx.requestId });
  let body;
  try { body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : (request.body || {}); } catch { return sendError(response, 400, "INVALID_JSON", "Kafka publish payload must be JSON.", ctx.requestId); }
  if (body.topic && typeof body.topic !== "string") return sendError(response, 400, "INVALID_TOPIC", "topic must be a string.", ctx.requestId);
  const message = { offset: records.length, topic: body.topic || topic, key: body.key ?? null, value: body.value ?? body, headers: body.headers || {}, publishedAt: new Date().toISOString(), clientId: requestHeader(request, "x-client-id") || "gateway" };
  await writeDataset("kafka-stream", { entity: "KafkaMessage", records: [...records, message] });
  return response.status(202).json({ accepted: true, protocol: "kafka-compatible-http", message, requestId: ctx.requestId });
}

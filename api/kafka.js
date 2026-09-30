import { beginRequest, authenticateApplication, authenticateGateway, authorizeApplication, requestHeader, sendError, unauthorized } from "../lib/http-api.js";
import { readAllDatasets, readDataset, writeDataset } from "../lib/persistence.js";
import { LEGACY_TOPIC, parseTopic, tableNames, kebab, topicCatalog, topicMessages } from "../lib/access.js";
import { CACHE_HEADER, RESOURCES, allRows, channelName, kafkaPage, parseChannel } from "../lib/channels.js";

// Pont HTTP "Kafka-compatible" (aucun broker embarqué) :
// - topic historique lucie.supplychain.events (lecture + publication) ;
// - un topic par application et par table : lucie.<appId>.<table-kebab>
//   (lecture seule, flux CDC déterministe dont chaque valeur est un CloudEvent 1.0).
// Consommation paginée : ?topic=&offset=&limit= ; ?format=cloudevents renvoie un lot CloudEvents ; ?topics liste les topics.

const LEGACY_ALIASES = new Set([LEGACY_TOPIC, "lumen.supplychain.events"]);

function intParam(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : NaN;
}

export default async function handler(request, response) {
  const ctx = beginRequest(request, response, ["GET", "POST"]);
  if (!ctx.ok) return;
  const url = new URL(request.url || "/api/kafka", "https://maison-lucie-si.vercel.app");
  const params = { ...Object.fromEntries(url.searchParams), ...(request.query || {}) };
  const listTopics = request.method === "GET" && params.topics !== undefined;
  const topic = String(params.topic || LEGACY_TOPIC);
  const derived = LEGACY_ALIASES.has(topic) ? null : parseTopic(topic);
  // SI multi-sources (9 applications) : topics lucie.<source>.<ressource>, lecture seule, jeton passerelle.
  const multi = !derived && !LEGACY_ALIASES.has(topic) ? parseChannel(topic) : null;
  if (multi) {
    if (!authenticateGateway(request)) return unauthorized(response, ctx.requestId);
    if (request.method === "POST") return sendError(response, 403, "TOPIC_READ_ONLY", "Les topics des applications sont en lecture seule.", ctx.requestId, { topic });
    const offset = intParam(params.offset, 0), limit = intParam(params.limit, 100);
    if (!Number.isInteger(offset) || offset < 0) return sendError(response, 400, "INVALID_OFFSET", "offset must be a non-negative integer.", ctx.requestId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return sendError(response, 400, "INVALID_LIMIT", "limit must be an integer between 1 and 1000.", ctx.requestId);
    const body = kafkaPage(multi, offset, limit);
    response.setHeader("Cache-Control", CACHE_HEADER);
    response.setHeader("X-Next-Offset", String(body.nextOffset));
    response.setHeader("X-End-Offset", String(body.endOffset));
    if (params.format === "cloudevents") { response.setHeader("Content-Type", "application/cloudevents-batch+json; charset=utf-8"); return response.status(200).send(JSON.stringify(body.messages.map(m => m.value))); }
    return response.status(200).json({ ...body, requestId: ctx.requestId });
  }

  // Autorisation : identifiants kafka-stream (historique), jeton passerelle, ou identifiants de l'application propriétaire du topic.
  const allowed = (await authenticateApplication(request, "kafka-stream")) || authenticateGateway(request) || (derived ? await authorizeApplication(request, derived.appId) : false);
  if (!allowed) return unauthorized(response, ctx.requestId, "ApiKey");

  if (listTopics) {
    const datasets = await readAllDatasets();
    return response.status(200).json({ protocol: "kafka-compatible-http", topics: [...topicCatalog(datasets), ...RESOURCES.map(d => ({ topic: channelName(d), appId: d.source, table: d.resource, partitions: 1, writable: false, messageCount: allRows(d).length }))], synthetic: true, requestId: ctx.requestId });
  }
  if (!LEGACY_ALIASES.has(topic) && !derived) return sendError(response, 404, "UNKNOWN_TOPIC", "Unknown topic. GET /api/kafka?topics lists the available topics.", ctx.requestId, { topic });

  const offset = intParam(params.offset, 0);
  const limit = intParam(params.limit, 100);
  if (!Number.isInteger(offset) || offset < 0) return sendError(response, 400, "INVALID_OFFSET", "offset must be a non-negative integer.", ctx.requestId);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) return sendError(response, 400, "INVALID_LIMIT", "limit must be an integer between 1 and 500.", ctx.requestId);

  if (derived) {
    if (request.method === "POST") return sendError(response, 403, "TOPIC_READ_ONLY", "Application topics are read-only change streams; publish to lucie.supplychain.events.", ctx.requestId, { topic });
    const dataset = await readDataset(derived.appId);
    const table = tableNames(dataset).find(name => kebab(name) === derived.tableKebab);
    if (!table) return sendError(response, 404, "UNKNOWN_TOPIC", "Unknown table topic for this application.", ctx.requestId, { topic });
    const all = topicMessages(derived.appId, dataset, table);
    const messages = all.slice(offset, offset + limit);
    const nextOffset = offset + messages.length;
    response.setHeader("X-Next-Offset", String(nextOffset));
    response.setHeader("X-End-Offset", String(all.length));
    if (params.format === "cloudevents") {
      response.setHeader("Content-Type", "application/cloudevents-batch+json; charset=utf-8");
      return response.status(200).send(JSON.stringify(messages.map(message => message.value)));
    }
    return response.status(200).json({ protocol: "kafka-compatible-http", topic, appId: derived.appId, table, partition: 0, offset, limit, messages, nextOffset, endOffset: all.length, hasMore: nextOffset < all.length, synthetic: true, requestId: ctx.requestId });
  }

  const stored = await readDataset("kafka-stream");
  const records = Array.isArray(stored?.records) ? stored.records : [];
  if (request.method === "GET") {
    const inTopic = records.filter(item => LEGACY_ALIASES.has(item.topic));
    const messages = inTopic.filter(item => Number(item.offset) >= offset).slice(0, limit);
    const nextOffset = messages.length ? Number(messages[messages.length - 1].offset) + 1 : Math.max(offset, records.length);
    response.setHeader("X-Next-Offset", String(nextOffset));
    if (params.format === "cloudevents") {
      response.setHeader("Content-Type", "application/cloudevents-batch+json; charset=utf-8");
      return response.status(200).send(JSON.stringify(messages.map(message => ({
        specversion: "1.0", id: `kafka-stream:${message.offset}`, source: "/maison-lucie/kafka-stream", type: `com.maisonlucie.${message.value?.type || "event"}`,
        subject: message.key, time: message.publishedAt, datacontenttype: "application/json", data: { ...message.value, headers: message.headers, synthetic: true },
      }))));
    }
    return response.status(200).json({ protocol: "kafka-compatible-http", topic: LEGACY_TOPIC, offset, limit, messages, nextOffset, endOffset: records.length, hasMore: nextOffset < records.length, requestId: ctx.requestId });
  }
  let body;
  try { body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : (request.body || {}); } catch { return sendError(response, 400, "INVALID_JSON", "Kafka publish payload must be JSON.", ctx.requestId); }
  if (body.topic && typeof body.topic !== "string") return sendError(response, 400, "INVALID_TOPIC", "topic must be a string.", ctx.requestId);
  if (body.topic && !LEGACY_ALIASES.has(body.topic)) return sendError(response, 403, "TOPIC_READ_ONLY", "Only lucie.supplychain.events accepts publications.", ctx.requestId, { topic: body.topic });
  const message = { offset: records.length, topic: LEGACY_TOPIC, key: body.key ?? null, value: body.value ?? body, headers: body.headers || {}, publishedAt: new Date().toISOString(), clientId: requestHeader(request, "x-client-id") || "gateway" };
  await writeDataset("kafka-stream", { ...(stored || { entity: "KafkaMessage" }), records: [...records, message] });
  return response.status(202).json({ accepted: true, protocol: "kafka-compatible-http", message, requestId: ctx.requestId });
}

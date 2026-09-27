// Couche d'accès multi-protocole commune (REST, SOAP, GraphQL, évènements,
// fichiers, batch). Toutes les vues partent du même dataset persisté par
// application : une table "principale" (dataset.entity / dataset.records) et
// des tables secondaires optionnelles (dataset.tables).
import { applications } from "./demo-data.js";

export const PORTAL = "https://maison-lucie-si.vercel.app";
export const APP_IDS = applications.map(app => app.id);
export const isApplication = appId => APP_IDS.includes(appId);

export function tableNames(dataset) {
  if (!dataset) return [];
  return [dataset.entity, ...Object.keys(dataset.tables || {})];
}

/** Résout un nom de table (insensible à la casse). null si inconnu. */
export function resolveTable(dataset, table) {
  if (!dataset) return null;
  if (!table) return dataset.entity;
  return tableNames(dataset).find(name => name.toLowerCase() === String(table).toLowerCase()) ?? null;
}

export function tableRecords(dataset, table) {
  const name = resolveTable(dataset, table);
  if (!name) return null;
  const rows = name === dataset.entity ? dataset.records : dataset.tables?.[name];
  return Array.isArray(rows) ? rows : [];
}

export function applyFilter(rows, filter = {}) {
  const entries = Object.entries(filter || {}).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!entries.length) return rows;
  return rows.filter(row => entries.every(([key, value]) => String(row[key]) === String(value)));
}

export function plural(name) {
  if (/y$/.test(name) && !/[aeiou]y$/.test(name)) return name.slice(0, -1) + "ies";
  if (/(s|x|ch|sh)$/.test(name)) return name + "es";
  return name + "s";
}
export const kebab = value => String(value).replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
export const camel = value => String(value).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
export const pascal = value => { const c = camel(value); return c.charAt(0).toUpperCase() + c.slice(1); };

// ── CSV ──────────────────────────────────────────────────────────────────
export function columnsOf(rows) {
  return Array.from(new Set(rows.flatMap(row => Object.keys(row))));
}
function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export function toCsv(rows) {
  const columns = columnsOf(rows);
  return [columns.join(","), ...rows.map(row => columns.map(column => csvCell(row[column])).join(","))].join("\n") + "\n";
}
export const toNdjson = rows => rows.map(row => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");

// ── Évènements (topics Kafka-like, CloudEvents 1.0) ──────────────────────
export const LEGACY_TOPIC = "lucie.supplychain.events";
export const topicName = (appId, table) => `lucie.${appId}.${kebab(table)}`;

const KEY_FIELDS = ["purchaseOrderId", "shipmentId", "disruptionId", "promotionId", "orderId", "deliveryId", "id", "operation", "supplierId", "siteId", "sku"];
export function recordKey(record) {
  if (record.sku && record.siteId) return `${record.sku}@${record.siteId}`;
  if (record.sku && record.week) return `${record.sku}@${record.week}`;
  const field = KEY_FIELDS.find(name => record[name] !== undefined && record[name] !== null);
  return field ? String(record[field]) : null;
}
const TIME_FIELDS = ["time", "publishedAt", "deliveredAt", "lastCallAt", "startedAt", "lastCountAt", "assessedAt"];
const BASE_TIME = Date.parse("2026-09-26T00:00:00Z");
export function recordTime(record, index) {
  for (const field of TIME_FIELDS) if (record[field] && !Number.isNaN(Date.parse(record[field]))) return new Date(Date.parse(record[field])).toISOString();
  return new Date(BASE_TIME + index * 60000).toISOString();
}

/** Message Kafka-like dont la valeur est un CloudEvent 1.0 (flux CDC déterministe). */
export function topicMessages(appId, dataset, table) {
  const name = resolveTable(dataset, table);
  const rows = tableRecords(dataset, name) || [];
  const topic = topicName(appId, name);
  return rows.map((record, offset) => {
    const time = recordTime(record, offset);
    return {
      offset, topic, key: recordKey(record), partition: 0,
      value: {
        specversion: "1.0", id: `${appId}:${kebab(name)}:${offset}`, source: `/maison-lucie/${appId}`,
        type: `com.maisonlucie.${appId}.${kebab(name)}.snapshot`, subject: recordKey(record), time,
        datacontenttype: "application/json", dataschema: `/api/graphql?sdl#${name}`, data: { ...record, synthetic: true },
      },
      headers: { "ce-specversion": "1.0", "content-type": "application/cloudevents+json" },
      publishedAt: time,
    };
  });
}

export function topicCatalog(datasets) {
  const topics = [{ topic: LEGACY_TOPIC, appId: "kafka-stream", table: "KafkaMessage", partitions: 1, writable: true, messageCount: datasets["kafka-stream"]?.records?.length ?? 0 }];
  for (const appId of APP_IDS) {
    const dataset = datasets[appId];
    for (const table of tableNames(dataset)) {
      topics.push({ topic: topicName(appId, table), appId, table, partitions: 1, writable: false, messageCount: (tableRecords(dataset, table) || []).length });
    }
  }
  return topics;
}

export function parseTopic(topic) {
  const match = /^lucie\.([a-z0-9-]+)\.([a-z0-9-]+)$/.exec(String(topic || ""));
  if (!match || !isApplication(match[1])) return null;
  return { appId: match[1], tableKebab: match[2] };
}

// ── Contrats d'accès publiés dans le catalogue ───────────────────────────
export function accessContracts(app, dataset) {
  const tables = tableNames(dataset);
  const main = dataset?.entity;
  const auth = `${app.auth?.type || "Application"} (same credentials as REST) — or gateway Bearer token`;
  return {
    tables,
    protocols: {
      rest: { method: "GET", url: `/api/data/${app.id}`, tableUrl: `/api/data/${app.id}?table={table}`, format: "application/json", auth: app.auth?.type },
      soap: { method: "POST", url: `/api/soap?app=${app.id}`, wsdl: `/api/soap?wsdl&app=${app.id}`, operations: tables.map(table => `Get${plural(table)}`).concat("GetRecords"), format: "text/xml (SOAP 1.1)", auth },
      graphql: { method: "POST", url: "/api/graphql", rootField: camel(app.id), sdl: "/api/graphql?sdl", example: `{ ${camel(app.id)} { ${camel(plural(main || "record"))}(limit: 5) { __typename } } }`, auth },
      events: { method: "GET", url: `/api/kafka?topic=${topicName(app.id, main || "records")}&offset=0&limit=50`, topics: tables.map(table => topicName(app.id, table)), format: "Kafka-like JSON messages; value = CloudEvents 1.0 (format=cloudevents for a CloudEvents batch)", auth },
      file: { method: "GET", url: `/api/files/${app.id}.csv`, tableUrls: tables.map(table => `/api/files/${app.id}.${table}.csv`), format: "text/csv", auth: `${auth}, or X-API-Key files key` },
      batch: { method: "POST", url: "/api/batch", body: { app: app.id, table: main, format: "ndjson|csv", filter: {} }, statusUrl: "/api/batch?job={jobId}", resultUrl: "/api/batch?job={jobId}&result=1", format: "application/x-ndjson or text/csv", auth },
    },
  };
}

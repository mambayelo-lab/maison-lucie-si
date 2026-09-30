// Canaux d'échange du SI multi-sources Maison Lucie (taille démo).
// Une seule lecture canonique (readRows) sert tous les canaux : OData v4,
// GraphQL, SOAP, Salesforce, Kafka, AMQP, MQ, CloudEvents, CDC, SQL, fichiers,
// gRPC-web, ESB et MCP. Les données lues sont donc identiques quel que soit le
// canal ; seuls l'enveloppe et le transport changent. Tout est simulé et
// déterministe : aucun broker, aucun appel sortant, aucune écriture.
import { DATASET, SOURCES } from "./multisource-api.js";

const T = DATASET.tables;
export const AS_OF = DATASET.asOf;
/** Taille de page maximale, tous canaux confondus (budget Vercel). */
export const MAX_PAGE = 1000;

const pascal = s => String(s).replace(/(^|[-_])([a-z0-9])/g, (_, __, c) => c.toUpperCase());
const singular = s => (/ies$/.test(s) ? s.replace(/ies$/, "y") : /ss$/.test(s) ? s : s.replace(/s$/, ""));

/** Registre : une entrée par ressource (source × ressource). */
export const RESOURCES = Object.entries(SOURCES).flatMap(([source, s]) => Object.entries(s.entities ?? s.resources).map(([resource, d]) => {
  const entitySet = source === "sap" ? resource : pascal(resource);
  return { source, resource, table: d.table, key: d.key, watermark: d.watermark ?? null, entitySet, typeName: source === "sap" ? resource : singular(entitySet), label: s.label };
}));
export const SOURCE_IDS = Object.keys(SOURCES);
export function findResource(source, resource) {
  const r = String(resource ?? "").toLowerCase();
  return RESOURCES.find(x => x.source === source && (x.resource.toLowerCase() === r || x.entitySet.toLowerCase() === r || x.typeName.toLowerCase() === r)) ?? null;
}
export const firstResource = source => RESOURCES.find(x => x.source === source) ?? null;
export const allRows = def => T[def.table] ?? [];

// ── Types de colonnes (déduits des lignes, stables car déterministes) ─────
export function columnsOf(def) {
  const rows = allRows(def), names = [...new Set(rows.slice(0, 200).flatMap(r => Object.keys(r)))];
  return names.map(name => {
    const vals = rows.slice(0, 500).map(r => r[name]).filter(v => v !== null && v !== undefined);
    const type = !vals.length ? "string" : vals.every(v => typeof v === "boolean") ? "boolean" : vals.every(v => typeof v === "number") ? (vals.every(Number.isInteger) ? "integer" : "decimal")
      : vals.every(v => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(v)) ? "datetime" : vals.every(v => /^\d{4}-\d\d-\d\d$/.test(v)) ? "date" : "string";
    return { name, type, nullable: vals.length < rows.slice(0, 500).length };
  });
}

// ── Filtres communs : [{field, op, value}] ; op = eq ne gt ge lt le in like null notnull ─
function norm(v) {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\d/.test(v)) return v;
  const d = new Date(v.length === 10 ? `${v}T00:00:00Z` : /Z|[+-]\d\d:\d\d$/.test(v) ? v.replace(" ", "T") : `${v.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}
export function matches(row, f) {
  const a = row[f.field];
  switch (f.op) {
    case "null": return a === null || a === undefined;
    case "notnull": return a !== null && a !== undefined;
    case "in": return (f.value ?? []).some(v => String(v) === String(a));
    case "like": { const re = new RegExp(`^${String(f.value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, "i"); return a !== null && a !== undefined && re.test(String(a)); }
  }
  const x = norm(a), y = norm(f.value);
  const num = typeof x === "number" && y !== null && y !== "" && !Number.isNaN(Number(y));
  const l = num ? x : x, r = num ? Number(y) : y;
  switch (f.op) {
    case "eq": return x === y || (x != null && y != null && String(x) === String(y));
    case "ne": return !(x === y || (x != null && y != null && String(x) === String(y)));
    case "gt": return l != null && l > r;
    case "ge": return l != null && l >= r;
    case "lt": return l != null && l < r;
    case "le": return l != null && l <= r;
  }
  throw new Error(`Opérateur non pris en charge : ${f.op}`);
}

/**
 * Lecture canonique paginée. Toutes les façades passent par ici.
 * @returns {{rows: object[], total: number, offset: number, limit: number, nextOffset: number|null}}
 */
export function readRows(def, { filters = [], select = null, offset = 0, limit = 100, orderBy = null } = {}) {
  let rows = allRows(def);
  if (filters.length) rows = rows.filter(r => filters.every(f => matches(r, f)));
  if (orderBy?.field) {
    const k = orderBy.field, s = orderBy.desc ? -1 : 1;
    rows = [...rows].sort((a, b) => (norm(a[k]) > norm(b[k]) ? s : norm(a[k]) < norm(b[k]) ? -s : 0));
  }
  const lim = Math.max(0, Math.min(MAX_PAGE, Number.isFinite(Number(limit)) ? Number(limit) : 100));
  const off = Math.max(0, Number(offset) || 0);
  const page = rows.slice(off, off + lim).map(r => (select?.length ? Object.fromEntries(select.map(f => [f, r[f] ?? null])) : r));
  return { rows: page, total: rows.length, offset: off, limit: lim, nextOffset: off + lim < rows.length ? off + lim : null };
}

// ── Sérialisations texte ─────────────────────────────────────────────────
export const xmlEscape = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const XSD = { integer: "xsd:long", decimal: "xsd:decimal", boolean: "xsd:boolean", datetime: "xsd:string", date: "xsd:string", string: "xsd:string" };
/** Ligne → XML typé (xsi:type) : le client retrouve les types exacts. */
export function rowXml(tag, row, cols) {
  const type = Object.fromEntries(cols.map(c => [c.name, c.type]));
  return `<${tag}>${Object.entries(row).map(([k, v]) => (v === null || v === undefined ? `<${k} xsi:nil="true"/>` : `<${k} xsi:type="${XSD[type[k] ?? (typeof v === "number" ? (Number.isInteger(v) ? "integer" : "decimal") : typeof v === "boolean" ? "boolean" : "string")]}">${xmlEscape(v)}</${k}>`)).join("")}</${tag}>`;
}
/** Élément XML d'un enregistrement : nom du type, suffixé « Record » s'il est aussi le nom d'une colonne. */
export const recordTag = def => (columnsOf(def).some(c => c.name === def.typeName || c.name === def.entitySet) ? `${def.typeName}Record` : def.typeName);
export function rowsXml(def, rows) {
  const cols = columnsOf(def), root = cols.some(c => c.name === def.entitySet) ? `${def.entitySet}Set` : def.entitySet;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${root} xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" source="${def.source}" resource="${def.resource}" count="${rows.length}" synthetic="true">${rows.map(r => rowXml(recordTag(def), r, cols)).join("")}</${root}>\n`;
}
export function toCsv(rows, cols) {
  const names = cols ?? [...new Set(rows.flatMap(r => Object.keys(r)))];
  const cell = v => (v === null || v === undefined ? "" : /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [names.join(","), ...rows.map(r => names.map(n => cell(r[n])).join(","))].join("\n") + "\n";
}

// ── Liaison déterministe texte → identifiant ─────────────────────────────
export function h32(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; }

// ═════════════════════════════════════════════════════════════════════════
// SQL en lecture seule sur le data lake (et SOQL pour la façade Salesforce).
// Sous-ensemble : SELECT <*|col|agg(col) [AS x], …> FROM <table>
//   [WHERE cond AND cond …] [GROUP BY c, …] [ORDER BY c [ASC|DESC]] [LIMIT n] [OFFSET m]
// cond : col (=|<>|!=|<|<=|>|>=) littéral | col LIKE 'x%' | col IN (…) | col IS [NOT] NULL
// agg : COUNT(*), COUNT(col), SUM, MIN, MAX, AVG. Pas de jointure ni de sous-requête.
// ═════════════════════════════════════════════════════════════════════════
export class SqlError extends Error {}
function literal(tok) {
  if (/^'.*'$/s.test(tok)) return tok.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(tok)) return Number(tok);
  if (/^(true|false)$/i.test(tok)) return tok.toLowerCase() === "true";
  if (/^null$/i.test(tok)) return null;
  // SOQL : dates et datetimes non quotées (2026-09-20, 2026-09-20T00:00:00Z).
  if (/^\d{4}-\d\d-\d\d(T[\d:.]+Z?)?$/.test(tok)) return tok;
  throw new SqlError(`Littéral non pris en charge : ${tok}`);
}
function splitTop(s, sep) {
  const out = []; let depth = 0, q = false, cur = "";
  for (const ch of s) {
    if (ch === "'") q = !q;
    if (!q && ch === "(") depth++;
    if (!q && ch === ")") depth--;
    if (!q && depth === 0 && ch === sep) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function parseConditions(where) {
  if (!where) return [];
  const parts = where.split(/\s+and\s+(?=(?:[^']*'[^']*')*[^']*$)/i);
  return parts.map(c => {
    c = c.trim();
    if (/\s+or\s+/i.test(c.replace(/'[^']*'/g, ""))) throw new SqlError("OR non pris en charge (utiliser IN).");
    let m;
    if ((m = c.match(/^([A-Za-z_][\w.]*)\s+is\s+(not\s+)?null$/i))) return { field: m[1], op: m[2] ? "notnull" : "null" };
    if ((m = c.match(/^([A-Za-z_][\w.]*)\s+in\s*\((.*)\)$/is))) return { field: m[1], op: "in", value: splitTop(m[2], ",").map(literal) };
    if ((m = c.match(/^([A-Za-z_][\w.]*)\s+like\s+('.*')$/is))) return { field: m[1], op: "like", value: literal(m[2]) };
    if ((m = c.match(/^([A-Za-z_][\w.]*)\s*(<>|!=|<=|>=|=|<|>)\s*(.+)$/s))) return { field: m[1], op: { "=": "eq", "<>": "ne", "!=": "ne", "<": "lt", "<=": "le", ">": "gt", ">=": "ge" }[m[2]], value: literal(m[3].trim()) };
    throw new SqlError(`Condition non prise en charge : ${c}`);
  });
}
export function parseSql(sql) {
  const s = String(sql ?? "").trim().replace(/;\s*$/, "");
  if (!/^select\s/i.test(s)) throw new SqlError("Seules les requêtes SELECT sont autorisées (lecture seule).");
  if (/;/.test(s.replace(/'[^']*'/g, ""))) throw new SqlError("Une seule instruction par requête.");
  if (/\b(insert|update|delete|drop|alter|create|merge|grant|join|union)\b/i.test(s.replace(/'[^']*'/g, ""))) throw new SqlError("Instruction ou clause non autorisée (lecture seule, sans jointure).");
  const m = s.match(/^select\s+(.+?)\s+from\s+([A-Za-z_][\w.]*)(?:\s+where\s+(.+?))?(?:\s+group\s+by\s+(.+?))?(?:\s+order\s+by\s+(.+?))?(?:\s+limit\s+(\d+))?(?:\s+offset\s+(\d+))?$/is);
  if (!m) throw new SqlError("Syntaxe : SELECT … FROM table [WHERE …] [GROUP BY …] [ORDER BY …] [LIMIT n] [OFFSET m].");
  const columns = splitTop(m[1], ",").map(c => {
    const a = c.match(/^(count|sum|min|max|avg)\s*\(\s*(\*|[A-Za-z_]\w*)\s*\)(?:\s+as\s+([A-Za-z_]\w*))?$/i);
    if (a) return { agg: a[1].toLowerCase(), field: a[2] === "*" ? null : a[2], as: a[3] ?? `${a[1].toLowerCase()}${a[2] === "*" ? "" : `_${a[2]}`}` };
    const p = c.match(/^([A-Za-z_]\w*|\*)(?:\s+as\s+([A-Za-z_]\w*))?$/i);
    if (!p) throw new SqlError(`Colonne non prise en charge : ${c}`);
    return { field: p[1], as: p[2] ?? p[1] };
  });
  const order = m[5] ? m[5].trim().match(/^([A-Za-z_]\w*)(?:\s+(asc|desc))?$/i) : null;
  if (m[5] && !order) throw new SqlError("ORDER BY : une seule colonne.");
  return { columns, table: m[2], where: parseConditions(m[3]), groupBy: m[4] ? m[4].split(",").map(x => x.trim()) : [], orderBy: order ? { field: order[1], desc: /desc/i.test(order[2] ?? "") } : null, limit: m[6] ? Number(m[6]) : null, offset: m[7] ? Number(m[7]) : 0 };
}
/** Exécute une requête analysée sur une ressource (pas de copie : filtre + projection + agrégat en un passage). */
export function runSql(q, def) {
  const cols = columnsOf(def), known = new Set(cols.map(c => c.name));
  for (const f of [...q.where.map(w => w.field), ...q.groupBy, ...q.columns.filter(c => c.field && c.field !== "*").map(c => c.field)]) if (!known.has(f)) throw new SqlError(`Colonne inconnue : ${f}`);
  const aggs = q.columns.filter(c => c.agg);
  const limit = Math.min(q.limit ?? MAX_PAGE, MAX_PAGE);
  if (aggs.length || q.groupBy.length) {
    const groups = new Map();
    for (const r of allRows(def)) {
      if (!q.where.every(f => matches(r, f))) continue;
      const k = JSON.stringify(q.groupBy.map(g => r[g]));
      let g = groups.get(k);
      if (!g) { g = { key: Object.fromEntries(q.groupBy.map(x => [x, r[x]])), acc: aggs.map(() => ({ n: 0, s: 0, min: null, max: null })) }; groups.set(k, g); }
      aggs.forEach((a, i) => {
        const v = a.field ? r[a.field] : 1, acc = g.acc[i];
        if (a.field && (v === null || v === undefined)) return;
        acc.n++; if (typeof v === "number") acc.s += v;
        if (acc.min === null || v < acc.min) acc.min = v;
        if (acc.max === null || v > acc.max) acc.max = v;
      });
    }
    let out = [...groups.values()].map(g => {
      const row = {};
      for (const c of q.columns) {
        if (!c.agg) { if (!q.groupBy.includes(c.field)) throw new SqlError(`${c.field} doit figurer dans GROUP BY.`); row[c.as] = g.key[c.field]; continue; }
        const acc = g.acc[aggs.indexOf(c)];
        row[c.as] = c.agg === "count" ? acc.n : c.agg === "sum" ? Math.round(acc.s * 100) / 100 : c.agg === "avg" ? (acc.n ? Math.round((acc.s / acc.n) * 1e4) / 1e4 : null) : acc[c.agg];
      }
      return row;
    });
    if (q.orderBy) { const s = q.orderBy.desc ? -1 : 1, k = q.orderBy.field; out.sort((a, b) => (a[k] > b[k] ? s : a[k] < b[k] ? -s : 0)); }
    const page = out.slice(q.offset, q.offset + limit);
    return { columns: Object.keys(page[0] ?? Object.fromEntries(q.columns.map(c => [c.as, 1]))), rows: page, total: out.length, nextOffset: q.offset + limit < out.length ? q.offset + limit : null };
  }
  const star = q.columns.some(c => c.field === "*");
  const select = star ? null : q.columns.map(c => c.field);
  const r = readRows(def, { filters: q.where, select, offset: q.offset, limit, orderBy: q.orderBy });
  const rows = star ? r.rows : r.rows.map(row => Object.fromEntries(q.columns.map(c => [c.as, row[c.field]])));
  return { columns: star ? cols.map(c => c.name) : q.columns.map(c => c.as), rows, total: r.total, nextOffset: r.nextOffset };
}
/** Tables SQL du lac : lake.sales, lake.orders… (flux J-1 des applications). */
export const sqlName = resource => resource.replace(/-/g, "_");
export const LAKE_TABLES = RESOURCES.filter(r => r.source === "lake").map(r => ({ name: `lake.${sqlName(r.resource)}`, def: r }));
export function lakeTable(name) {
  const n = String(name).toLowerCase().replace(/^lake\./, "");
  return LAKE_TABLES.find(t => sqlName(t.def.resource) === n)?.def ?? null;
}
export function sqlTypeOf(t) { return { integer: "BIGINT", decimal: "DOUBLE", boolean: "BOOLEAN", datetime: "TIMESTAMP", date: "DATE", string: "VARCHAR" }[t] ?? "VARCHAR"; }

// ═════════════════════════════════════════════════════════════════════════
// OData v4 générique : /odata/v4/{source}/{EntitySet}
// ═════════════════════════════════════════════════════════════════════════
function odata4Literal(raw) {
  const s = raw.trim(); let m;
  if ((m = s.match(/^'(.*)'$/s))) return m[1].replace(/''/g, "'");
  if (/^(true|false)$/.test(s)) return s === "true";
  if (s === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^\d{4}-\d\d-\d\d(T[\d:.]+(Z|[+-]\d\d:\d\d)?)?$/.test(s)) return s;
  throw new Error(`Littéral OData non pris en charge : ${s}`);
}
export function parseOData4Filter(filter) {
  if (!filter) return [];
  return String(filter).split(/\s+and\s+(?=(?:[^']*'[^']*')*[^']*$)/i).map(c => {
    const m = c.trim().match(/^([A-Za-z_]\w*)\s+(eq|ne|gt|ge|lt|le)\s+(.+)$/i);
    if (!m) throw new Error(`Filtre OData v4 non pris en charge : ${c} (eq, ne, gt, ge, lt, le, and)`);
    return { field: m[1], op: m[2].toLowerCase(), value: odata4Literal(m[3]) };
  });
}
const EDM4 = { integer: "Edm.Int64", decimal: "Edm.Decimal", boolean: "Edm.Boolean", datetime: "Edm.String", date: "Edm.Date", string: "Edm.String" };
export function odata4Metadata(source) {
  const defs = RESOURCES.filter(r => r.source === source);
  const types = defs.map(d => `<EntityType Name="${d.typeName}"><Key><PropertyRef Name="${d.key}"/></Key>${columnsOf(d).map(c => `<Property Name="${c.name}" Type="${EDM4[c.type]}"${c.name === d.key ? ' Nullable="false"' : ""}/>`).join("")}</EntityType>`).join("");
  const sets = defs.map(d => `<EntitySet Name="${d.entitySet}" EntityType="Lucie.${source}.${d.typeName}"/>`).join("");
  return `<?xml version="1.0" encoding="utf-8"?><edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"><edmx:DataServices><Schema Namespace="Lucie.${source}" xmlns="http://docs.oasis-open.org/odata/ns/edm">${types}<EntityContainer Name="Container">${sets}</EntityContainer></Schema></edmx:DataServices></edmx:Edmx>`;
}
export function odata4(source, entitySet, q, base) {
  const def = findResource(source, entitySet);
  if (!def) return { status: 404, body: { error: { code: "NotFound", message: `EntitySet inconnu : ${entitySet}` } } };
  let filters;
  try { filters = parseOData4Filter(q.$filter); } catch (e) { return { status: 400, body: { error: { code: "BadRequest", message: e.message } } }; }
  const top = Math.min(Number(q.$top) || MAX_PAGE, MAX_PAGE), skip = Number(q.$skip) || 0;
  const select = q.$select ? String(q.$select).split(",").map(s => s.trim()).filter(Boolean) : null;
  const ob = q.$orderby ? String(q.$orderby).trim().match(/^(\w+)(?:\s+(asc|desc))?$/i) : null;
  const r = readRows(def, { filters, select, offset: skip, limit: top, orderBy: ob ? { field: ob[1], desc: /desc/i.test(ob[2] ?? "") } : null });
  const body = { "@odata.context": `${base}/$metadata#${def.entitySet}${select ? `(${select.join(",")})` : ""}` };
  if (String(q.$count) === "true") body["@odata.count"] = r.total;
  body.value = r.rows;
  if (r.nextOffset !== null) {
    const keep = Object.entries(q).filter(([k]) => ["$filter", "$select", "$orderby", "$count"].includes(k)).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
    body["@odata.nextLink"] = `${base}/${def.entitySet}?${[...keep, `$top=${top}`, `$skip=${r.nextOffset}`].join("&")}`;
  }
  return { status: 200, body };
}

// ═════════════════════════════════════════════════════════════════════════
// Messagerie simulée : Kafka, AMQP (RabbitMQ), IBM MQ, CloudEvents, CDC
// Un « topic » ou une « file » par ressource : lucie.<source>.<resource>.
// Les messages sont les lignes, dans l'ordre de la table (offset = rang).
// ═════════════════════════════════════════════════════════════════════════
export const channelName = def => `lucie.${def.source}.${def.resource}`;
export function parseChannel(name) {
  const m = /^lucie\.([a-z]+)\.([a-z_-]+)$/i.exec(String(name ?? "").trim());
  return m ? findResource(m[1].toLowerCase(), m[2].toLowerCase()) : null;
}
export function recordKey(def, row) { return row[def.key] == null ? null : String(row[def.key]); }
export function cloudEvent(def, row, offset) {
  return {
    specversion: "1.0", id: `${def.source}:${def.resource}:${offset}`, source: `/maison-lucie/${def.source}`,
    type: `com.maisonlucie.${def.source}.${def.resource}.snapshot`, subject: recordKey(def, row),
    time: row[def.watermark] ? norm(row[def.watermark]) : `${AS_OF}T00:00:00.000Z`, datacontenttype: "application/json",
    dataschema: `/odata/v4/${def.source}/$metadata#${def.entitySet}`, data: row,
  };
}
export function kafkaPage(def, offset, limit) {
  const r = readRows(def, { offset, limit });
  const messages = r.rows.map((row, i) => ({ offset: offset + i, topic: channelName(def), partition: 0, key: recordKey(def, row), value: cloudEvent(def, row, offset + i), headers: { "ce-specversion": "1.0", "content-type": "application/cloudevents+json" } }));
  return { protocol: "kafka-compatible-http", topic: channelName(def), partition: 0, offset, limit: r.limit, messages, nextOffset: offset + messages.length, endOffset: r.total, hasMore: r.nextOffset !== null, synthetic: true };
}
/** RabbitMQ (API HTTP de management) : POST /api/queues/{vhost}/{queue}/get → tableau de messages. */
export function amqpGet(def, offset, count) {
  const r = readRows(def, { offset, limit: count });
  return r.rows.map((row, i) => ({
    payload_bytes: Buffer.byteLength(JSON.stringify(row)), redelivered: false, exchange: "lucie.si", routing_key: channelName(def),
    message_count: Math.max(0, r.total - offset - i - 1),
    properties: { delivery_mode: 2, content_type: "application/json", message_id: `${def.source}:${def.resource}:${offset + i}`, timestamp: Math.floor(Date.parse(cloudEvent(def, row, 0).time) / 1000), headers: { "x-offset": offset + i } },
    payload: JSON.stringify(row), payload_encoding: "string",
  }));
}
/** IBM MQ (REST messaging API v2) : un message par appel ; lecture non destructive (browse) avec curseur. */
export function mqBrowse(def, offset) {
  const r = readRows(def, { offset, limit: 1 });
  if (!r.rows.length) return null;
  const row = r.rows[0], id = Buffer.from(`${def.source}:${def.resource}:${offset}`.padEnd(24, " ").slice(0, 24)).toString("hex");
  return { body: JSON.stringify(row), headers: { "ibm-mq-md-messageId": id, "ibm-mq-md-format": "MQSTR", "ibm-mq-md-persistence": "persistent", "ibm-mq-md-putDate": AS_OF.replace(/-/g, ""), "x-lucie-offset": String(offset), "x-lucie-next-offset": r.nextOffset === null ? "" : String(offset + 1), "Content-Type": "application/json; charset=utf-8" } };
}

/**
 * CDC de type Debezium : instantané (op "r") des lignes antérieures à la coupure,
 * puis créations (op "c") et mises à jour (op "u") des lignes modifiées après.
 * Rejouer tout le flux redonne exactement la table (vérifié par test).
 */
const CDC_CUTOFF = "2026-09-27 12:00:00";
export function cdcEvents(def) {
  const out = [];
  const rows = allRows(def);
  const wm = def.watermark;
  const tail = [];
  rows.forEach((row, i) => { if (wm && row[wm] && String(row[wm]) > CDC_CUTOFF) tail.push([row, i]); else out.push({ op: "r", before: null, after: row, i }); });
  for (const [row, i] of tail) {
    if (i % 3 === 0 && row[wm]) {
      const earlier = { ...row, [wm]: CDC_CUTOFF };
      out.push({ op: "c", before: null, after: earlier, i }, { op: "u", before: earlier, after: row, i });
    } else out.push({ op: "c", before: null, after: row, i });
  }
  return out;
}
export function cdcPage(def, offset, limit) {
  const all = cdcEvents(def), lim = Math.min(limit, MAX_PAGE);
  const base = Date.parse(`${AS_OF}T00:00:00Z`);
  const messages = all.slice(offset, offset + lim).map((e, k) => {
    const pos = offset + k, ts = e.op === "r" ? base : Date.parse(norm(e.after[def.watermark] ?? `${AS_OF} 00:00:00`));
    return {
      offset: pos, topic: `lucie.cdc.${def.source}.${def.resource}`, key: { [def.key]: e.after[def.key] },
      value: { before: e.before, after: e.after, source: { version: "2.7.0.Final-simulated", connector: "lucie", name: "lucie", ts_ms: ts, snapshot: e.op === "r" ? (pos === all.length - 1 || all[pos + 1]?.op !== "r" ? "last" : "true") : "false", db: def.source, table: def.resource, lsn: pos }, op: e.op, ts_ms: ts },
    };
  });
  return { protocol: "debezium-json", topic: `lucie.cdc.${def.source}.${def.resource}`, offset, messages, nextOffset: offset + messages.length, endOffset: all.length, hasMore: offset + messages.length < all.length, cutoff: CDC_CUTOFF, synthetic: true };
}

// ═════════════════════════════════════════════════════════════════════════
// Salesforce (façade) : SOQL (REST query) et Bulk API 2.0 (jobs de requête)
// Objets personnalisés Lucie_<Source>_<Ressource>__c. Simplification assumée :
// les champs gardent le nom de la source (un vrai org suffixerait « __c »).
// ═════════════════════════════════════════════════════════════════════════
export const sfObject = def => `Lucie_${pascal(def.source)}_${def.entitySet}__c`;
export const sfFind = name => RESOURCES.find(d => sfObject(d).toLowerCase() === String(name).toLowerCase()) ?? null;
export const sfId = (def, row) => { const h = h32(`${def.source}.${def.resource}.${recordKey(def, row)}`).toString(36).toUpperCase().padStart(7, "0"); return `a0L${h}${"00000000".slice(0, 8)}`.slice(0, 18).padEnd(18, "A"); };
export function soql(query, version, cursor = 0, pageSize = MAX_PAGE) {
  const q = parseSql(query);
  const def = sfFind(q.table);
  if (!def) throw new SqlError(`sObject type '${q.table}' is not supported.`);
  if (q.columns.some(c => c.field === "*")) throw new SqlError("SOQL n'accepte pas SELECT * : listez les champs.");
  const start = q.offset + cursor, end = q.limit != null ? q.offset + q.limit : Infinity;
  const r = runSql({ ...q, offset: start, limit: Math.max(0, Math.min(MAX_PAGE, pageSize, end - start)) }, def);
  const agg = q.columns.some(c => c.agg);
  const records = r.rows.map(row => (agg ? { attributes: { type: "AggregateResult" }, ...row } : { attributes: { type: sfObject(def), url: `/services/data/${version}/sobjects/${sfObject(def)}/${sfId(def, row)}` }, Id: sfId(def, row), ...row }));
  const done = r.nextOffset === null || start + r.rows.length >= end;
  return { def, totalSize: agg ? r.total : Math.max(0, Math.min(r.total, end) - q.offset), done, records, nextCursor: done ? null : cursor + r.rows.length };
}
export function sfDescribe(def, version) {
  const SF = { integer: "int", decimal: "double", boolean: "boolean", datetime: "datetime", date: "date", string: "string" };
  return { name: sfObject(def), label: `${def.label} · ${def.entitySet}`, custom: true, queryable: true, createable: false, updateable: false, urls: { describe: `/services/data/${version}/sobjects/${sfObject(def)}/describe` },
    fields: [{ name: "Id", type: "id", nillable: false }, ...columnsOf(def).map(c => ({ name: c.name, type: SF[c.type], nillable: c.nullable, externalId: c.name === def.key }))] };
}

// ═════════════════════════════════════════════════════════════════════════
// gRPC-web (application/grpc-web+proto) : service lucie.v1.RowService,
// méthode ListRows. Encodage protobuf écrit à la main (varint + longueur).
// Les valeurs sont transportées en texte (map<string,string>) + types en en-tête.
// ═════════════════════════════════════════════════════════════════════════
export const GRPC_PROTO = `syntax = "proto3";
package lucie.v1;
// Service de lecture générique du SI Maison Lucie (données synthétiques).
service RowService { rpc ListRows (ListRowsRequest) returns (ListRowsResponse); }
message ListRowsRequest { string source = 1; string resource = 2; int32 page_size = 3; string page_token = 4; }
message Row { map<string, string> fields = 1; repeated string null_fields = 2; }
message Column { string name = 1; string type = 2; }
message ListRowsResponse { repeated Row rows = 1; string next_page_token = 2; int32 total_size = 3; repeated Column columns = 4; }
`;
function varint(n) { const out = []; n = Number(n); while (n > 127) { out.push((n & 127) | 128); n = Math.floor(n / 128); } out.push(n); return Buffer.from(out); }
const fieldLen = (no, buf) => Buffer.concat([varint((no << 3) | 2), varint(buf.length), buf]);
const fieldStr = (no, s) => fieldLen(no, Buffer.from(String(s), "utf8"));
const fieldInt = (no, n) => Buffer.concat([varint(no << 3), varint(n)]);
export function readVarint(buf, pos) { let n = 0, mul = 1, b; do { b = buf[pos++]; n += (b & 127) * mul; mul *= 128; } while (b & 128); return [n, pos]; }
export function decodeFields(buf) {
  const out = []; let pos = 0;
  while (pos < buf.length) {
    let tag; [tag, pos] = readVarint(buf, pos);
    const no = tag >> 3, wt = tag & 7;
    if (wt === 0) { let v; [v, pos] = readVarint(buf, pos); out.push({ no, value: v }); }
    else if (wt === 2) { let len; [len, pos] = readVarint(buf, pos); out.push({ no, bytes: buf.subarray(pos, pos + len) }); pos += len; }
    else throw new Error(`Type de fil protobuf non pris en charge : ${wt}`);
  }
  return out;
}
export function grpcEncodeResponse(def, r) {
  const cols = columnsOf(def);
  const rows = r.rows.map(row => fieldLen(1, Buffer.concat([
    ...Object.entries(row).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => fieldLen(1, Buffer.concat([fieldStr(1, k), fieldStr(2, String(v))]))),
    ...Object.entries(row).filter(([, v]) => v === null || v === undefined).map(([k]) => fieldStr(2, k)),
  ])));
  const msg = Buffer.concat([...rows, ...(r.nextOffset !== null ? [fieldStr(2, String(r.nextOffset))] : []), fieldInt(3, r.total), ...cols.map(c => fieldLen(4, Buffer.concat([fieldStr(1, c.name), fieldStr(2, c.type)])))]);
  const trailer = Buffer.from("grpc-status:0\r\ngrpc-message:\r\n");
  const frame = (flag, b) => { const h = Buffer.alloc(5); h[0] = flag; h.writeUInt32BE(b.length, 1); return Buffer.concat([h, b]); };
  return Buffer.concat([frame(0, msg), frame(0x80, trailer)]);
}
export function grpcDecodeRequest(body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : "", /^[A-Za-z0-9+/=\s]+$/.test(String(body ?? "")) && String(body).length % 4 === 0 ? "base64" : "binary");
  if (buf.length < 5) return {};
  const len = buf.readUInt32BE(1), msg = buf.subarray(5, 5 + len), out = {};
  for (const f of decodeFields(msg)) { const k = { 1: "source", 2: "resource", 3: "page_size", 4: "page_token" }[f.no]; if (k) out[k] = f.bytes ? f.bytes.toString("utf8") : f.value; }
  return out;
}
export function grpcEncodeRequest(req) {
  const msg = Buffer.concat([fieldStr(1, req.source), fieldStr(2, req.resource), fieldInt(3, req.page_size ?? 100), ...(req.page_token ? [fieldStr(4, req.page_token)] : [])]);
  const h = Buffer.alloc(5); h.writeUInt32BE(msg.length, 1);
  return Buffer.concat([h, msg]);
}

// ═════════════════════════════════════════════════════════════════════════
// ESB / iPaaS (style MuleSoft : experience API → process → system API)
// Le « demi-flux » : l'ESB route vers l'application source, transforme
// l'enveloppe et trace la route ; Supply consomme la sortie de l'ESB.
// ═════════════════════════════════════════════════════════════════════════
export const ESB_FLOWS = {
  suppliers: { source: "sap", resource: "A_Supplier", system: "sap-s4-system-api (OData v2)" },
  "purchase-orders": { source: "sap", resource: "A_PurchaseOrderItem", system: "sap-s4-system-api (OData v2)" },
  products: { source: "pim", resource: "products", system: "pim-system-api (REST)" },
  inventory: { source: "manhattan", resource: "inventory", system: "manhattan-wm-system-api (REST)" },
  facilities: { source: "manhattan", resource: "facilities", system: "manhattan-wm-system-api (REST)" },
  shipments: { source: "tms", resource: "shipments", system: "tms-system-api (REST)" },
  forecasts: { source: "aps", resource: "forecasts", system: "aps-system-api (REST)" },
  "supplier-risk": { source: "srm", resource: "suppliers", system: "srm-system-api (REST)" },
  "quality-issues": { source: "qms", resource: "nonconformities", system: "qms-system-api (REST)" },
  "order-lines": { source: "oms", resource: "order-lines", system: "oms-system-api (REST)" },
  sales: { source: "lake", resource: "sales", system: "datalake-system-api (SQL)" },
};
export function esbFlow(flow, q, correlationId) {
  let def = null, f = ESB_FLOWS[flow];
  if (flow === "route") { def = findResource(String(q.to ?? ""), String(q.resource ?? "")); f = def ? { source: def.source, resource: def.resource, system: `${def.source}-system-api` } : null; }
  else if (f) def = findResource(f.source, f.resource);
  if (!def) return { status: 404, body: { error: { code: "FLOW_NOT_FOUND", message: `Flux inconnu : ${flow}`, flows: Object.keys(ESB_FLOWS).concat("route?to=<source>&resource=<ressource>") } } };
  const filters = Object.entries(q).filter(([k]) => !["flow", "to", "resource", "offset", "limit", "ch"].includes(k) && columnsOf(def).some(c => c.name === k)).map(([field, value]) => ({ field, op: "eq", value }));
  const t0 = Date.now(), r = readRows(def, { filters, offset: Number(q.offset) || 0, limit: Number(q.limit) || 100 });
  return {
    status: 200,
    headers: { "X-Correlation-ID": correlationId, "X-ESB-Route": `experience-api/${flow} > process-api/supply > ${f.system.replace(/[^\x20-\x7e]/g, "")}` },
    body: { data: r.rows, meta: { correlationId, flow, route: [{ layer: "experience", name: `supply-experience-api/${flow}` }, { layer: "process", name: "supply-process-api", transformation: "enveloppe {data, meta}, filtres d'égalité, pagination offset/limit" }, { layer: "system", name: f.system, source: def.source, resource: def.resource }], pagination: { offset: r.offset, limit: r.limit, total: r.total, nextOffset: r.nextOffset }, elapsedMs: Date.now() - t0, synthetic: true } },
  };
}

// ═════════════════════════════════════════════════════════════════════════
// Dépôt de fichiers de type SFTP : /outbound/<source>/<ressource>.<csv|json|xml|parquet>
// (listing ls -l et téléchargement ; le Parquet est un fichier statique pré-généré).
// ═════════════════════════════════════════════════════════════════════════
export const FILE_FORMATS = ["csv", "json", "xml", "parquet"];
export function renderFile(def, format) {
  const rows = allRows(def);
  if (format === "csv") return { type: "text/csv; charset=utf-8", body: toCsv(rows, columnsOf(def).map(c => c.name)) };
  if (format === "json") return { type: "application/json; charset=utf-8", body: JSON.stringify(rows) };
  if (format === "xml") return { type: "application/xml; charset=utf-8", body: rowsXml(def, rows) };
  return null;
}
export const parquetPath = def => `/public/sftp/${def.source}/${def.resource}.parquet`;
export function sftpListing(path, parquetSizes = {}) {
  const p = String(path || "/").replace(/\/+$/, "") || "/";
  const mtime = `${AS_OF}T02:00:00Z`;
  if (p === "/") return [{ name: "outbound", type: "d", permissions: "drwxr-xr-x", size: 4096, mtime }];
  if (p === "/outbound") return SOURCE_IDS.map(s => ({ name: s, type: "d", permissions: "drwxr-xr-x", size: 4096, mtime }));
  const m = /^\/outbound\/([a-z]+)$/.exec(p);
  if (!m || !SOURCE_IDS.includes(m[1])) return null;
  return RESOURCES.filter(r => r.source === m[1]).flatMap(def => FILE_FORMATS.map(fmt => ({
    name: `${def.resource}.${fmt}`, type: "-", permissions: "-rw-r--r--", mtime,
    size: fmt === "parquet" ? (parquetSizes[`${def.source}/${def.resource}`] ?? null) : Buffer.byteLength(renderFile(def, fmt).body), rows: allRows(def).length,
  })));
}
export function sftpResolve(path) {
  const m = /^\/outbound\/([a-z]+)\/([a-z-]+|A_\w+)\.(csv|json|xml|parquet)$/i.exec(String(path ?? ""));
  if (!m) return null;
  const def = findResource(m[1], m[2]);
  return def ? { def, format: m[3].toLowerCase() } : null;
}

// ═════════════════════════════════════════════════════════════════════════
// Indicateurs et alertes (exposés par MCP) : calculés à la source, bornés.
// ═════════════════════════════════════════════════════════════════════════
export const KPIS = {
  "sales-by-month": { label: "Ventes nettes par mois (data lake)", unit: "EUR" },
  "late-shipments-by-week": { label: "Expéditions en retard par semaine d'arrivée prévue (TMS)", unit: "expéditions" },
  "stockouts-by-site": { label: "Lignes de stock sous le stock de sécurité, par site (WMS)", unit: "lignes" },
  "nonconformities-by-severity": { label: "Non-conformités ouvertes par gravité (QMS)", unit: "non-conformités" },
  "forecast-by-week": { label: "Demande prévue par semaine (APS)", unit: "unités" },
};
const isoWeek = d => { const t = new Date(`${d}T00:00:00Z`); const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day + 3); const y = t.getUTCFullYear(); const w1 = new Date(Date.UTC(y, 0, 4)); return `${y}-W${String(1 + Math.round(((t - w1) / 864e5 - 3 + ((w1.getUTCDay() + 6) % 7)) / 7)).padStart(2, "0")}`; };
export function kpiSeries(id) {
  const group = (rows, k, v = () => 1) => { const m = new Map(); for (const r of rows) { const g = k(r); if (g == null) continue; m.set(g, Math.round(((m.get(g) ?? 0) + v(r)) * 100) / 100); } return [...m.entries()].sort(([a], [b]) => (a > b ? 1 : -1)).map(([period, value]) => ({ period, value })); };
  switch (id) {
    case "sales-by-month": return group(T.lake_sales, r => r.SaleDate.slice(0, 7), r => r.NetAmount);
    case "late-shipments-by-week": return group(T.tms_shipments.filter(r => (r.ActualDate ? r.ActualDate > r.ExpectedDate : r.ExpectedDate < AS_OF)), r => isoWeek(r.ExpectedDate));
    case "stockouts-by-site": return group(T.wms_stock.filter(r => r.OnHand - r.Allocated < r.SafetyStock), r => r.FacilityId);
    case "nonconformities-by-severity": return group(T.qms_nonconformities.filter(r => r.Status !== "CLOSE"), r => r.Severity);
    case "forecast-by-week": return group(T.aps_forecasts, r => r.Week, r => r.ForecastQty);
  }
  return null;
}
export function siAlerts() {
  const out = [];
  const stock = T.wms_stock.filter(r => r.OnHand - r.Allocated < r.SafetyStock);
  out.push({ id: "SI-RUPTURE", severity: stock.length > 200 ? "CRITICAL" : "MAJOR", signal: "Stock disponible sous le stock de sécurité", count: stock.length, evidence: { source: "manhattan", resource: "inventory", rule: "OnHand - Allocated < SafetyStock", sample: stock.slice(0, 5) } });
  const late = T.tms_shipments.filter(r => (r.ActualDate ? r.ActualDate > r.ExpectedDate : r.ExpectedDate < AS_OF));
  out.push({ id: "SI-RETARD", severity: late.length > 50 ? "CRITICAL" : "MAJOR", signal: "Expéditions en retard", count: late.length, evidence: { source: "tms", resource: "shipments", rule: `ActualDate > ExpectedDate, ou ActualDate vide et ExpectedDate < ${AS_OF}`, sample: late.slice(0, 5) } });
  const cert = T.srm_suppliers.filter(r => r.CertificationExpiry && r.CertificationExpiry < AS_OF);
  out.push({ id: "SI-CERTIFICATION", severity: "MAJOR", signal: "Certifications fournisseur expirées", count: cert.length, evidence: { source: "srm", resource: "suppliers", rule: `CertificationExpiry < ${AS_OF}`, sample: cert.slice(0, 5) } });
  const risk = T.srm_suppliers.filter(r => r.RiskScore >= 80);
  out.push({ id: "SI-RISQUE", severity: "CRITICAL", signal: "Fournisseurs à risque élevé (score ≥ 80)", count: risk.length, evidence: { source: "srm", resource: "suppliers", rule: "RiskScore >= 80", sample: risk.slice(0, 5) } });
  return out;
}

// ── Plafond de requêtes par client (par instance) ─────────────────────────
const hits = new Map();
export function overRate(request, perMinute = 120) {
  perMinute = Number(process.env.LUCIE_RATE_LIMIT) || perMinute; // tests locaux uniquement
  const key = String(request.headers?.["x-forwarded-for"] || "local").split(",")[0].trim(), now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.t > 60_000) { hits.set(key, { t: now, n: 1 }); if (hits.size > 5000) hits.clear(); return false; }
  return ++h.n > perMinute;
}
/** Données déterministes : cache CDN une heure, servies périmées un jour pendant la revalidation. */
export const CACHE_HEADER = "public, s-maxage=3600, stale-while-revalidate=86400";

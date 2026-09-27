import { applications, datasets } from "./demo-data.js";

// Durable when Vercel KV/Upstash is attached; process memory is a local-only
// fallback and is explicitly reported by /api/health. Production/demo writes
// should therefore run with KV configured.
const memory = globalThis.__lucieMemory ?? (globalThis.__lucieMemory = new Map());
const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const persistenceMode = kvUrl && kvToken ? "vercel-kv" : "memory-fallback";

async function kv(command, ...args) {
  if (!kvUrl || !kvToken) return null;
  const response = await fetch(kvUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${kvToken}`, "Content-Type": "application/json" },
    body: JSON.stringify([command, ...args]),
  });
  if (!response.ok) throw new Error(`KV HTTP ${response.status}`);
  return (await response.json()).result;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function readJson(key, fallback) {
  try {
    const stored = await kv("GET", key);
    if (stored) return JSON.parse(stored);
  } catch { /* fall through to memory/seed */ }
  if (memory.has(key)) return clone(memory.get(key));
  return clone(fallback);
}

async function writeJson(key, value) {
  const copy = clone(value);
  memory.set(key, copy);
  if (kvUrl && kvToken) await kv("SET", key, JSON.stringify(copy));
  return copy;
}

export async function readDataset(appId) {
  const stored = await readJson(`lucie:dataset:${appId}`, datasets[appId] ?? null);
  // Jeux persistés avant l'enrichissement : on complète les tables secondaires depuis le seed.
  if (stored && !stored.tables && datasets[appId]?.tables) stored.tables = clone(datasets[appId].tables);
  return stored;
}

export async function writeDataset(appId, dataset) {
  return writeJson(`lucie:dataset:${appId}`, dataset);
}

export async function readAllDatasets() {
  const result = {};
  for (const appId of Object.keys(datasets)) result[appId] = await readDataset(appId);
  return result;
}

export async function readApplicationConfig(appId) {
  const seed = applications.find(app => app.id === appId);
  if (!seed) return null;
  return readJson(`lucie:app-config:${appId}`, {
    id: seed.id,
    endpoint: seed.baseUrl,
    protocol: seed.protocol,
    refresh: seed.refresh,
    enabled: true,
    auth: seed.auth,
    updatedAt: null,
  });
}

export async function writeApplicationConfig(appId, patch) {
  const current = await readApplicationConfig(appId);
  if (!current) return null;
  const next = {
    ...current,
    ...patch,
    id: appId,
    auth: patch.auth ? { ...current.auth, ...patch.auth } : current.auth,
    updatedAt: new Date().toISOString(),
  };
  const saved = await writeJson(`lucie:app-config:${appId}`, next);
  await appendAudit({ type: "application.config.updated", appId, changed: Object.keys(patch), at: saved.updatedAt });
  return saved;
}

export async function readAllApplicationConfigs() {
  const result = {};
  for (const app of applications) result[app.id] = await readApplicationConfig(app.id);
  return result;
}

export async function resetApplicationConfig(appId) {
  const seed = applications.find(app => app.id === appId);
  if (!seed) return null;
  return writeJson(`lucie:app-config:${appId}`, {
    id: seed.id,
    endpoint: seed.baseUrl,
    protocol: seed.protocol,
    refresh: seed.refresh,
    enabled: true,
    auth: seed.auth,
    updatedAt: new Date().toISOString(),
  });
}

export async function appendAudit(event) {
  const key = "lucie:audit";
  const current = await readJson(key, []);
  return writeJson(key, [...current.slice(-199), event]);
}

export async function readAudit() {
  return readJson("lucie:audit", []);
}

export function validateRecords(records) {
  if (!Array.isArray(records) || records.length > 500) return "records must be an array of at most 500 objects";
  if (records.some(row => !row || typeof row !== "object" || Array.isArray(row))) return "each record must be an object";
  return null;
}

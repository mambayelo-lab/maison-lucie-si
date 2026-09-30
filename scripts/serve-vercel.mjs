// Serveur local qui reproduit le routage Vercel (fonctions api/*, réécritures de
// vercel.json, fichiers statiques) : sert aux tests de bout en bout avec Aura Supply
// sans déploiement. Usage : PORT=4300 node scripts/serve-vercel.mjs
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
const port = Number(process.env.PORT || 4300);

function compile(source) {
  const names = [];
  const re = source.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/:(\w+)(\*)?/g, (_, n, star) => { names.push(n); return star ? "(.*)" : "([^/]+)"; });
  return { re: new RegExp(`^${re}$`), names };
}
const rewrites = config.rewrites.map(r => ({ ...r, ...compile(r.source) }));

function route(pathname) {
  for (const r of rewrites) {
    const m = r.re.exec(pathname);
    if (!m) continue;
    const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    const dest = r.destination.replace(/:(\w+)\*?/g, (_, n) => encodeURIComponent(params[n] ?? "")).replace(/%2F/g, "/");
    return new URL(dest, "http://x");
  }
  return new URL(pathname, "http://x");
}
function fnFor(pathname) {
  const direct = join(root, `${pathname}.js`);
  if (existsSync(direct)) return { file: direct, query: {} };
  const m = /^\/api\/(sources|data|files)\/([^/]+)$/.exec(pathname);
  if (m) return { file: join(root, "api", m[1], m[1] === "sources" ? "[source].js" : m[1] === "data" ? "[app].js" : "[name].js"), query: { [m[1] === "sources" ? "source" : m[1] === "data" ? "app" : "name"]: decodeURIComponent(m[2]) } };
  return null;
}
const modules = new Map();

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const target = route(url.pathname);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const ct = String(req.headers["content-type"] || "");
  let body = raw.length ? raw : undefined;
  if (body && /json/.test(ct)) { try { body = JSON.parse(raw.toString("utf8")); } catch { body = raw.toString("utf8"); } }
  else if (body && /x-www-form-urlencoded/.test(ct)) body = Object.fromEntries(new URLSearchParams(raw.toString("utf8")));
  else if (body && /^text\/|xml|edi/i.test(ct)) body = raw.toString("utf8");
  const fn = fnFor(target.pathname);
  if (!fn) {
    const file = join(root, target.pathname);
    if (existsSync(file) && !file.endsWith("/")) { res.writeHead(200); return res.end(readFileSync(file)); }
    res.writeHead(404, { "content-type": "application/json" }); return res.end('{"error":"NOT_FOUND"}');
  }
  if (!modules.has(fn.file)) modules.set(fn.file, (await import(pathToFileURL(fn.file).href)).default);
  const query = { ...Object.fromEntries(url.searchParams), ...Object.fromEntries(target.searchParams), ...fn.query };
  const request = Object.assign(req, { query, body, url: req.url });
  let status = 200;
  const response = {
    setHeader: (k, v) => res.setHeader(k, v), getHeader: k => res.getHeader(k),
    status(code) { status = code; return response; },
    json(v) { if (!res.getHeader("content-type")) res.setHeader("content-type", "application/json; charset=utf-8"); res.writeHead(status); res.end(JSON.stringify(v)); return response; },
    send(v) { res.writeHead(status); res.end(typeof v === "string" || Buffer.isBuffer(v) ? v : JSON.stringify(v)); return response; },
    end(v) { res.writeHead(status); res.end(v); return response; },
  };
  try { await modules.get(fn.file)(request, response); }
  catch (e) { console.error(e); if (!res.headersSent) { res.writeHead(500); res.end(String(e.stack)); } }
}).listen(port, "127.0.0.1", () => console.log(`Maison Lucie (routage Vercel) sur http://127.0.0.1:${port}`));

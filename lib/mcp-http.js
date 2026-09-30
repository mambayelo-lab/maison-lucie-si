import { randomUUID } from "node:crypto";
import { authenticateGateway, requestHeader } from "./http-api.js";
import { handleMessage, SUPPORTED_VERSIONS } from "./mcp.js";
import { overRate } from "./channels.js";

// Serveur MCP — transport Streamable HTTP (spécification 2025-06-18), sans état.
// URL publique : https://maison-lucie-si.vercel.app/mcp (réécriture vercel.json).
// Auth : Authorization: Bearer <jeton passerelle> (démo : lucie_aura_gateway_demo_token).
const ORIGINS = /^(https:\/\/(maison-lucie-si|aura-decision-zen(-[a-z0-9-]+)?|aura-decider|aura-architect-seven)\.vercel\.app|https:\/\/claude\.ai|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

function send(response, status, body, headers = {}) {
  for (const [k, v] of Object.entries(headers)) response.setHeader(k, v);
  if (body === undefined) return response.status(status).end();
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  return response.status(status).send(JSON.stringify(body));
}

export async function mcpHandler(request, response) {
  const origin = requestHeader(request, "origin");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Request-Id", requestHeader(request, "x-request-id") || randomUUID());
  response.setHeader("Vary", "Origin");
  // Protection contre le DNS rebinding (exigée par la spécification) : Origin validé.
  if (origin && !ORIGINS.test(origin)) return send(response, 403, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Origin not allowed" } });
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID");
    response.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    response.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate");
  }
  const method = String(request.method || "GET").toUpperCase();
  if (method === "OPTIONS") return send(response, 204);
  // Pas de flux SSE initié par le serveur ni de session à fermer : 405 (autorisé par la spécification).
  if (method !== "POST") return send(response, 405, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Method not allowed: this stateless server only accepts POST." } }, { Allow: "POST, OPTIONS" });
  if (overRate(request, 120)) return send(response, 429, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Plafond de 120 requêtes par minute atteint." } }, { "Retry-After": "60" });
  if (!authenticateGateway(request)) return send(response, 401, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized: Authorization: Bearer <jeton passerelle> requis." } }, { "WWW-Authenticate": 'Bearer realm="maison-lucie-mcp"' });
  const version = requestHeader(request, "mcp-protocol-version");
  if (version && !SUPPORTED_VERSIONS.includes(version)) return send(response, 400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: `Unsupported MCP-Protocol-Version: ${version}` } });

  let payload = request.body;
  if (Buffer.isBuffer(payload)) payload = payload.toString("utf8");
  if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { return send(response, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); } }
  if (payload === undefined || payload === null) return send(response, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error: empty body" } });
  // Lots JSON-RPC (versions 2025-03-26 et antérieures) acceptés.
  const batch = Array.isArray(payload);
  const replies = (batch ? payload : [payload]).map(handleMessage).filter(Boolean);
  if (!replies.length) return send(response, 202);
  return send(response, 200, batch ? replies : replies[0]);
}

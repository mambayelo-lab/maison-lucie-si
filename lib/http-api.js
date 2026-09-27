import { randomUUID, timingSafeEqual } from "node:crypto";
import { readApplicationConfig } from "./persistence.js";

export const API_VERSION = "1.2.0";

export const DEMO_CREDENTIALS = Object.freeze({
  gateway: { token: "lucie_aura_gateway_demo_token" },
  files: { apiKey: "lucie_files_demo_key" },
});

const ALLOWED_ORIGINS = new Set([
  "https://maison-lucie-si.vercel.app",
  "https://aura-decision-zen.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
]);

function header(request, name) {
  const value = request.headers?.[name.toLowerCase()] ?? request.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  return /^https:\/\/aura-decision-zen-[a-z0-9-]+\.vercel\.app$/.test(origin);
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function beginRequest(request, response, allowedMethods = ["GET"]) {
  const requestId = header(request, "x-request-id") || randomUUID();
  const origin = header(request, "origin");
  const method = String(request.method || "GET").toUpperCase();
  response.setHeader("X-Request-Id", requestId);
  response.setHeader("X-API-Version", API_VERSION);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Vary", "Origin");
  if (origin && isAllowedOrigin(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", [...allowedMethods, "OPTIONS"].join(", "));
  response.setHeader("Access-Control-Allow-Headers", ["Authorization", "Content-Type", "X-Request-Id", "X-API-Key", "X-Lucie-Tenant", "X-Lucie-Account", "X-Lucie-Warehouse", "X-Lucie-Role", "X-Client-Id", "X-Client-Secret"].join(", "));
  if (origin && !isAllowedOrigin(origin)) { sendError(response, 403, "ORIGIN_NOT_ALLOWED", "This origin is not allowed to call Maison Lucie.", requestId); return { ok: false, requestId }; }
  if (method === "OPTIONS") { response.status(204).end(); return { ok: false, requestId }; }
  if (!allowedMethods.includes(method)) { response.setHeader("Allow", [...allowedMethods, "OPTIONS"].join(", ")); sendError(response, 405, "METHOD_NOT_ALLOWED", `Use ${allowedMethods.join(" or ")} for this resource.`, requestId); return { ok: false, requestId }; }
  return { ok: true, requestId };
}

export function sendError(response, status, code, message, requestId, details) {
  return response.status(status).json({ error: { code, message, ...(details ? { details } : {}) }, requestId });
}

function bearerToken(request) {
  const authorization = String(header(request, "authorization") || "");
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function basicCredentials(request) {
  const authorization = String(header(request, "authorization") || "");
  if (!authorization.startsWith("Basic ")) return null;
  try {
    const [username, ...password] = Buffer.from(authorization.slice(6), "base64").toString("utf8").split(":");
    return { username, password: password.join(":") };
  } catch { return null; }
}

export function authenticateGateway(request) {
  const token = bearerToken(request);
  const configured = process.env.LUCIE_GATEWAY_TOKEN || process.env.LUMEN_GATEWAY_TOKEN;
  return constantTimeEqual(token, configured || DEMO_CREDENTIALS.gateway.token)
    ;
}

export function authenticateFiles(request) {
  return constantTimeEqual(header(request, "x-api-key"), process.env.LUCIE_FILES_API_KEY || process.env.LUMEN_FILES_API_KEY || DEMO_CREDENTIALS.files.apiKey);
}

export async function authenticateApplication(request, appId) {
  const config = await readApplicationConfig(appId);
  if (!config || config.enabled === false) return false;
  const auth = config.auth || {};
  switch (appId) {
    case "sap-s4":
    case "legacy-soap": {
      const basic = basicCredentials(request);
      return !!basic && constantTimeEqual(basic.username, auth.username) && constantTimeEqual(basic.password, auth.password) && constantTimeEqual(header(request, "x-lucie-tenant"), auth.tenant);
    }
    case "manhattan-wms": return constantTimeEqual(header(request, "x-api-key"), auth.apiKey);
    case "blueyonder-tms": return constantTimeEqual(bearerToken(request), auth.accessToken || "lucie_tms_access_demo");
    case "coupa-risk": return constantTimeEqual(bearerToken(request), auth.token);
    case "snowflake-demand": return constantTimeEqual(bearerToken(request), auth.privateKey || auth.token) && constantTimeEqual(header(request, "x-lucie-account"), auth.account) && constantTimeEqual(header(request, "x-lucie-warehouse"), auth.warehouse) && constantTimeEqual(header(request, "x-lucie-role"), auth.role);
    case "mulesoft-events":
    case "kafka-stream":
    case "webhook-gateway": return constantTimeEqual(header(request, "x-client-id"), auth.clientId) && constantTimeEqual(header(request, "x-client-secret"), auth.clientSecret);
    case "rest-order-management": return constantTimeEqual(bearerToken(request), auth.token);
    default: return false;
  }
}

export async function authenticateTmsClient(clientId, clientSecret) {
  const config = await readApplicationConfig("blueyonder-tms");
  const auth = config?.auth || {};
  return constantTimeEqual(clientId, auth.clientId) && constantTimeEqual(clientSecret, auth.clientSecret);
}

export function publicApplication(application) {
  const credentialFields = Object.keys(application.auth || {}).filter(key => key !== "type");
  return { ...application, auth: { type: application.auth?.type || "Unknown", credentialFields, secretDelivery: "Studio-configured demo profile" } };
}

export function unauthorized(response, requestId, scheme = "Bearer") {
  response.setHeader("WWW-Authenticate", scheme === "Basic" ? "Basic realm=\"Maison Lucie Demo\"" : `${scheme} realm=\"Maison Lucie Demo\"`);
  return sendError(response, 401, "UNAUTHORIZED", "Missing or invalid demonstration credentials.", requestId);
}

export function requestHeader(request, name) { return header(request, name); }

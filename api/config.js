import { applications } from "../lib/demo-data.js";
import { persistenceMode, readAllApplicationConfigs, readApplicationConfig, readAudit, resetApplicationConfig, writeApplicationConfig } from "../lib/persistence.js";
import { authenticateGateway, beginRequest, sendError, unauthorized } from "../lib/http-api.js";

function sanitizedConfig(config) {
  return { ...config, syntheticCredentials: true };
}

export default async function handler(request, response) {
  const ctx = beginRequest(request, response, ["GET", "PATCH", "POST"]);
  if (!ctx.ok) return;

  if (request.method === "GET") {
    const configs = await readAllApplicationConfigs();
    const audit = await readAudit();
    return response.status(200).json({
      persistence: persistenceMode,
      applications: applications.map(app => ({ ...app, config: sanitizedConfig(configs[app.id]) })),
      audit: audit.slice(-50).reverse(),
      generatedAt: new Date().toISOString(),
    });
  }

  if (!authenticateGateway(request)) return unauthorized(response, ctx.requestId);
  const appId = String(request.body?.appId || "");
  if (!applications.some(app => app.id === appId)) return sendError(response, 404, "UNKNOWN_APPLICATION", "Unknown Maison Lumen application.", ctx.requestId, { appId });

  if (request.method === "POST" && request.body?.action === "reset") {
    const config = await resetApplicationConfig(appId);
    return response.status(200).json({ appId, config: sanitizedConfig(config), persistence: persistenceMode });
  }

  const allowed = ["endpoint", "protocol", "refresh", "enabled", "auth"];
  const patch = Object.fromEntries(Object.entries(request.body?.patch || {}).filter(([key]) => allowed.includes(key)));
  if (!Object.keys(patch).length) return sendError(response, 400, "EMPTY_PATCH", "Provide at least one supported configuration field.", ctx.requestId);
  if (patch.auth && (typeof patch.auth !== "object" || Array.isArray(patch.auth))) return sendError(response, 400, "INVALID_AUTH", "auth must be an object.", ctx.requestId);
  const config = await writeApplicationConfig(appId, patch);
  return response.status(200).json({ appId, config: sanitizedConfig(config), persistence: persistenceMode });
}

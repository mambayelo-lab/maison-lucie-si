import { readAllDatasets } from "../lib/persistence.js";
import { accessContracts, camel, tableNames } from "../lib/access.js";
import { buildSchema, execute, printSchema } from "../lib/graphql-mini.js";
import { authorizeApplication, beginRequest, sendError } from "../lib/http-api.js";

function parseBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  try { return JSON.parse(String(request.body || "{}")); } catch { return null; }
}

export default async function handler(request, response) {
  const gate = beginRequest(request, response, ["GET", "POST"]);
  if (!gate.ok) return;
  const datasets = await readAllDatasets();
  const schema = buildSchema(datasets);
  const url = new URL(request.url || "/api/graphql", "https://maison-lucie-si.vercel.app");
  const query = request.query || Object.fromEntries(url.searchParams);

  if (request.method === "GET" && (query.sdl !== undefined || url.searchParams.has("sdl"))) {
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    return response.status(200).send(printSchema(schema));
  }

  let payload;
  if (request.method === "GET") {
    if (!query.query) return sendError(response, 400, "MISSING_QUERY", "Provide ?query=… (GET) or POST {\"query\": \"…\"}. GET /api/graphql?sdl returns the schema.", gate.requestId);
    let variables = {};
    try { variables = query.variables ? JSON.parse(String(query.variables)) : {}; } catch { return sendError(response, 400, "INVALID_VARIABLES", "variables must be JSON.", gate.requestId); }
    payload = { query: String(query.query), variables, operationName: query.operationName };
  } else {
    payload = parseBody(request);
    if (!payload || typeof payload.query !== "string") return sendError(response, 400, "MISSING_QUERY", "POST body must be JSON {\"query\": \"…\", \"variables\": {…}}.", gate.requestId);
  }

  const cache = new Map();
  const result = await execute({
    schema, datasets,
    query: payload.query, variables: payload.variables || {}, operationName: payload.operationName,
    authorize: appId => { if (!cache.has(appId)) cache.set(appId, authorizeApplication(request, appId)); return cache.get(appId); },
    describeApplication: app => ({
      id: app.id, name: app.name, marketReference: app.marketReference, role: app.role, protocol: app.protocol, baseUrl: app.baseUrl,
      authType: app.auth?.type, status: app.status, disclaimer: app.disclaimer, graphqlField: camel(app.id),
      tables: tableNames(datasets[app.id]), protocols: accessContracts(app, datasets[app.id]).protocols,
    }),
  });
  const parseFailed = result.errors?.some(error => error.extensions?.code === "GRAPHQL_PARSE_FAILED");
  response.setHeader("Content-Type", "application/graphql-response+json; charset=utf-8");
  return response.status(parseFailed ? 400 : 200).send(JSON.stringify({ ...result, extensions: { synthetic: true, requestId: gate.requestId } }));
}

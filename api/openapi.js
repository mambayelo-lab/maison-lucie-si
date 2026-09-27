import { API_VERSION, beginRequest } from "../lib/http-api.js";
import { APP_IDS } from "../lib/access.js";

const appParam = { name: "app", in: "path", required: true, schema: { type: "string", enum: APP_IDS } };
const perApp = [{ bearerAuth: [] }, { basicAuth: [] }, { apiKeyAuth: [] }, { clientHeaders: [] }];

export default function handler(request, response) {
  const gate = beginRequest(request, response, ["GET"]);
  if (!gate.ok) return;
  response.status(200).json({
    openapi: "3.1.0",
    info: { title: "Maison Lucie Integration API", version: API_VERSION, description: "Synthetic integration contracts for Aura. Every application is reachable over REST, SOAP 1.1, GraphQL, Kafka-like events (CloudEvents 1.0), CSV files and batch exports, with the same per-application credentials as REST (the gateway Bearer token is also accepted on the new protocols). All data is synthetic." },
    servers: [{ url: "https://maison-lucie-si.vercel.app" }],
    paths: {
      "/api/health": { get: { summary: "Service health" } },
      "/api/catalog": { get: { summary: "Discover source applications, their tables and per-protocol access contracts (protocols.rest|soap|graphql|events|file|batch)" } },
      "/api/ontology": { get: { summary: "Read the minimal business ontology" } },
      "/api/token": { post: { summary: "Issue a demonstration OAuth client-credentials token (blueyonder-tms)" } },
      "/api/data/{app}": {
        get: { summary: "REST — read the main table of an application (or ?table=<Table>)", parameters: [appParam, { name: "table", in: "query", required: false, schema: { type: "string" } }], security: perApp },
        patch: { summary: "Persist edited demonstration records (gateway authentication required; ?table= for secondary tables)", parameters: [appParam], security: [{ bearerAuth: [] }] },
      },
      "/api/graphql": {
        get: { summary: "GraphQL — ?query=… or ?sdl for the schema (SDL)", parameters: [{ name: "query", in: "query", schema: { type: "string" } }, { name: "sdl", in: "query", schema: { type: "string" } }] },
        post: { summary: "GraphQL — POST {query, variables, operationName}; one root field per application (sapS4, manhattanWms, …) + applications, __schema, __type", requestBody: { content: { "application/json": { schema: { type: "object", required: ["query"], properties: { query: { type: "string" }, variables: { type: "object" }, operationName: { type: "string" } } } } } }, security: perApp },
      },
      "/api/soap": {
        get: { summary: "SOAP — WSDL discovery (?wsdl[&app=<id>])" },
        post: { summary: "SOAP 1.1 — Get<Tables> operations (GetPurchaseOrders, GetShipments, GetSuppliers…) or GetRecords; ?app=<id>", security: perApp },
      },
      "/api/kafka": {
        get: { summary: "Events — consume a topic: ?topic=&offset=&limit=[&format=cloudevents]; ?topics lists topics (lucie.supplychain.events + lucie.<app>.<table>)", security: perApp },
        post: { summary: "Events — publish to lucie.supplychain.events", security: [{ clientHeaders: [] }, { bearerAuth: [] }] },
      },
      "/api/events": { get: { summary: "Read a cursor-based CloudEvents 1.0 batch (mulesoft-events)", security: [{ clientHeaders: [] }] } },
      "/api/files/{name}": { get: { summary: "Files — CSV exports: demand-forecast.csv, supplier-scorecard.csv, <app>.csv, <app>.<Table>.csv, index.json", parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }], security: [{ apiKeyAuth: [] }, ...perApp] } },
      "/api/batch": {
        get: { summary: "Batch — capabilities, or ?job=<jobId> status, or ?job=<jobId>&result=1 download (NDJSON/CSV)", security: perApp },
        post: { summary: "Batch — submit an export job {app, table?, format: ndjson|csv, filter?}", requestBody: { content: { "application/json": { schema: { type: "object", required: ["app"], properties: { app: { type: "string", enum: APP_IDS }, table: { type: "string" }, format: { type: "string", enum: ["ndjson", "csv"] }, filter: { type: "object" } } } } } }, security: perApp },
      },
      "/api/alerts": { get: { summary: "Read deterministic resilience alerts", security: [{ bearerAuth: [] }] } },
      "/api/webhooks": { get: { summary: "Read persisted webhook deliveries", security: [{ clientHeaders: [] }] }, post: { summary: "Receive and persist a webhook delivery", security: [{ clientHeaders: [] }] } },
    },
    components: { securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "Application token (coupa-risk, rest-order-management, snowflake-demand + X-Lucie-* headers, blueyonder-tms via /api/token) or the Aura gateway token." },
      apiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
      clientHeaders: { type: "apiKey", in: "header", name: "X-Client-Id", description: "Also requires X-Client-Secret." },
      basicAuth: { type: "http", scheme: "basic", description: "sap-s4 / legacy-soap; also requires X-Lucie-Tenant." },
    } },
  });
}

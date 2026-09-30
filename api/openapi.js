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
      "/channels": { get: { summary: "Channels — index of every exchange channel for the 9 multi-source applications (public)" } },
      "/mcp": { post: { summary: "MCP server (Streamable HTTP, JSON-RPC 2.0, protocol 2025-06-18): tools list_sources, read_object, query, kpi_series, alerts; resources lucie://catalog, lucie://ontology, lucie://schema/{source}", security: [{ bearerAuth: [] }] } },
      "/odata/v4/{source}/{entitySet}": { get: { summary: "OData v4 — $filter, $select, $orderby, $top (≤ 1000), $skip, $count; /odata/v4/{source}/$metadata (CSDL)", security: [{ bearerAuth: [] }] } },
      "/sap/idoc/{type}": { get: { summary: "SAP IDoc XML — ORDERS05, DESADV01, CREMAS05, MATMAS05 (?offset=&limit=)", security: [{ bearerAuth: [] }] } },
      "/sap/bc/rfc": { post: { summary: "SAP RFC/BAPI simulated over JSON-RPC 2.0 — RFC_READ_TABLE, BAPI_PO_GETDETAIL1, BAPI_VENDOR_GETDETAIL, RFC_PING, RFC_SYSTEM_INFO", security: [{ bearerAuth: [] }, { basicAuth: [] }] } },
      "/services/data/{version}/query": { get: { summary: "Salesforce façade — SOQL (?q=), nextRecordsUrl; also /sobjects, /sobjects/{name}/describe, /jobs/query (Bulk API 2.0)", security: [{ bearerAuth: [] }] } },
      "/api/queues/{vhost}/{queue}/get": { post: { summary: "RabbitMQ management API — get messages {count, ackmode, encoding, offset} from lucie.<source>.<resource>", security: [{ bearerAuth: [] }, { basicAuth: [] }] } },
      "/ibmmq/rest/v2/messaging/qmgr/{qmgr}/queue/{queue}/message": { get: { summary: "IBM MQ REST messaging — browse one message (?offset=), 204 when empty", security: [{ bearerAuth: [] }, { basicAuth: [] }] } },
      "/cloudevents/{source}/{resource}": { get: { summary: "CloudEvents 1.0 batch (application/cloudevents-batch+json)", security: [{ bearerAuth: [] }] } },
      "/cdc/{source}/{resource}": { get: { summary: "Change data capture, Debezium JSON envelope (before, after, source, op, ts_ms)", security: [{ bearerAuth: [] }] } },
      "/edi/edifact/{type}": { get: { summary: "UN/EDIFACT D.96A interchange — ORDERS, DESADV, INVOIC", security: [{ bearerAuth: [] }] } },
      "/edi/x12/{type}": { get: { summary: "ANSI X12 004010 interchange — 850, 856, 810", security: [{ bearerAuth: [] }] } },
      "/as2/message/{id}": { get: { summary: "AS2 simulator — outbound message with AS2 headers and SHA-256 MIC; POST /as2 returns a synchronous MDN; /as2/outbox lists messages", security: [{ bearerAuth: [] }] } },
      "/sftp/ls": { get: { summary: "SFTP-like repository — list /outbound/<source> (csv, json, xml, parquet)", security: [{ bearerAuth: [] }] } },
      "/sftp/get": { get: { summary: "SFTP-like repository — download ?path=/outbound/<source>/<resource>.<csv|json|xml|parquet> (Parquet: 302 to a static file)", security: [{ bearerAuth: [] }] } },
      "/sql": { get: { summary: "Read-only SQL on the data lake (?q=, ?tables)", security: [{ bearerAuth: [] }] }, post: { summary: "Read-only SQL on the data lake {sql}", security: [{ bearerAuth: [] }] } },
      "/grpc/lucie.v1.RowService/ListRows": { get: { summary: "gRPC-web — .proto definition" }, post: { summary: "gRPC-web (application/grpc-web+proto) — ListRows", security: [{ bearerAuth: [] }] } },
      "/esb/api/v1/{flow}": { get: { summary: "ESB / iPaaS façade (MuleSoft-style experience → process → system API), route?to=<source>&resource=<resource>", security: [{ bearerAuth: [] }] } },
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

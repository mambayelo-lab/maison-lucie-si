# Maison Lucie SI

Executable, synthetic information system for the **Aura Supply Chain Resilience Agent**.

**Live portal:** https://maison-lucie-si.vercel.app  
**OpenAPI discovery:** https://maison-lucie-si.vercel.app/api/openapi

The project exposes ten coherent source applications, each reachable over **REST, SOAP 1.1, GraphQL, Kafka-like events (CloudEvents 1.0), CSV files and batch exports**, plus deterministic alerts and a cursor-based CloudEvents feed. All data is **synthetic** (15 fictitious suppliers, 20 SKUs, 12 sites, purchase orders, shipments with ports/routes/delays, forecasts with promotions, disruptions). Vendor names only identify familiar integration patterns; no vendor product or real customer data is embedded.

## Multi-source test IS (5 sources)

SAP S/4HANA (OData v2 with `$metadata`), PIM (REST), Manhattan Active WM (REST), OMS (REST or CSV) and a data lake (CSV and aggregates), each with its own keys and documented deliberate errors. Catalogue: `GET /api/sources/index`. Add `size=scale` to any resource for millions of rows generated on the fly (pagination only, nothing stored); `npm run generate:scale` writes the same rows as Parquet to `/tmp`. Details: [docs/SOURCES-MULTI.md](docs/SOURCES-MULTI.md).

## Public discovery endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Liveness and API version |
| `GET /api/catalog` | Applications and contracts, without secrets |
| `GET /api/ontology` | Minimal business ontology |
| `GET /api/openapi` | OpenAPI 3.1 discovery document |
| `GET /api/graphql?sdl` | GraphQL schema (SDL) |
| `GET /api/soap?wsdl[&app=<id>]` | SOAP 1.1 WSDL |

## Authenticated read endpoints

| Endpoint | Authentication | Purpose |
|---|---|---|
| `GET /api/data/sap-s4` | Basic + `X-Lucie-Tenant` | Purchase orders |
| `GET /api/data/manhattan-wms` | `X-API-Key` | Inventory positions |
| `POST /api/token` then `GET /api/data/blueyonder-tms` | OAuth2 client credentials | Shipments |
| `GET /api/data/coupa-risk` | Bearer | Supplier risk |
| `GET /api/data/snowflake-demand` | Bearer + account/warehouse/role headers | Demand forecast |
| `GET /api/data/mulesoft-events` | client-id/client-secret headers | Integration event source |
| `GET /api/alerts` | Gateway Bearer | Deterministic decision alerts |
| `GET /api/events` | client-id/client-secret headers | CloudEvents 1.0 batch with cursor |
| `GET /api/files/:name` | `X-API-Key` | CSV exports with ETag and row count |

All credentials committed in this repository are deliberately non-sensitive demonstration values. The API now validates them to exercise real authentication flows; they must never be presented as production security. Environment variables can override server-side demo secrets.

## Access per protocol (every application)

Each catalogue entry (`GET /api/catalog`) now carries `tables` and `protocols.{rest,soap,graphql,events,file,batch}` with the exact URLs. The new protocols accept **the same credentials as the application's REST endpoint**, or the Aura gateway token `Authorization: Bearer lucie_aura_gateway_demo_token`.

| Protocol | Endpoint | Format |
|---|---|---|
| REST | `GET /api/data/{app}` · `GET /api/data/{app}?table={Table}` | JSON `{application, entity, records, availableTables, lineage}` |
| SOAP 1.1 | `POST /api/soap?app={app}` (ops `Get{Tables}` or `GetRecords`) · WSDL `GET /api/soap?wsdl&app={app}` | `text/xml` envelope |
| GraphQL | `POST /api/graphql {query, variables}` · `GET /api/graphql?query=` · `GET /api/graphql?sdl` | `application/graphql-response+json` |
| Events | `GET /api/kafka?topic=lucie.{app}.{table}&offset=0&limit=50[&format=cloudevents]` · `GET /api/kafka?topics` · `POST /api/kafka` (topic `lucie.supplychain.events`) | Kafka-like messages, `value` = CloudEvent 1.0 |
| File | `GET /api/files/{app}.csv` · `GET /api/files/{app}.{Table}.csv` · `GET /api/files/index.json` | `text/csv` with ETag |
| Batch | `POST /api/batch {app, table, format: ndjson\|csv, filter}` → `GET /api/batch?job={id}` → `GET /api/batch?job={id}&result=1` | NDJSON / CSV |

Applications and tables: `sap-s4` (PurchaseOrder, Supplier, Material), `manhattan-wms` (InventoryPosition, Site), `blueyonder-tms` (Shipment, Disruption), `coupa-risk` (SupplierRiskAssessment, SupplierScorecard), `snowflake-demand` (DemandForecast, Promotion), `mulesoft-events` (CloudEvent), `rest-order-management` (CustomerOrder), `kafka-stream` (KafkaMessage), `legacy-soap` (SoapOperation), `webhook-gateway` (WebhookDelivery).

```bash
BASE=https://maison-lucie-si.vercel.app
# REST — secondary table
curl -H 'Authorization: Basic YXVyYV9kZW1vOkxVQ0lFLURFTU8tT05MWQ==' -H 'X-Lucie-Tenant: lucie-fr-100' "$BASE/api/data/sap-s4?table=Supplier"
# SOAP
curl -X POST -H 'Authorization: Bearer lucie_demo_bearer_token' -H 'Content-Type: text/xml' \
  --data '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetSupplierRiskAssessments><limit>5</limit></GetSupplierRiskAssessments></soap:Body></soap:Envelope>' \
  "$BASE/api/soap?app=coupa-risk"
# GraphQL
curl -X POST -H 'Authorization: Bearer lucie_demo_bearer_token' -H 'Content-Type: application/json' \
  -d '{"query":"{ coupaRisk { supplierRiskAssessments(limit: 5) { supplierId capacityRisk overallRisk geopoliticalRisk } } }"}' "$BASE/api/graphql"
# Events (Kafka-like topic, CloudEvents values)
curl -H 'X-API-Key: lucie_wms_demo_key' "$BASE/api/kafka?topic=lucie.manhattan-wms.inventory-position&offset=0&limit=10"
# File
curl -H 'X-API-Key: lucie_files_demo_key' "$BASE/api/files/blueyonder-tms.Disruption.csv"
# Batch
curl -X POST -H 'X-API-Key: lucie_wms_demo_key' -H 'Content-Type: application/json' \
  -d '{"app":"manhattan-wms","format":"ndjson","filter":{"belowSafetyStock":true}}' "$BASE/api/batch"
curl -H 'X-API-Key: lucie_wms_demo_key' "$BASE/api/batch?job=<jobId>&result=1"
```

Batch job ids are self-describing and signed with a digest (stateless across serverless instances); the job completes synchronously (`status: SUCCEEDED`). GraphQL is read-only and runs on a small dependency-free executor (queries, variables, aliases, fragments, `__schema`/`__type` introspection, equality filters on every scalar column, `limit`/`offset`).

## Events

`GET /api/events?cursor=0&limit=50` returns `application/cloudevents-batch+json`. Optional filters are `type`, `subject` and ISO-8601 `since`. Pagination uses `X-Next-Cursor` and a standard `Link` header when another page exists.

```bash
curl -H 'X-Client-Id: aura-demo-client' \
  -H 'X-Client-Secret: DEMO-ONLY' \
  'https://maison-lucie-si.vercel.app/api/events?cursor=0&limit=50'
```

## CSV exports

```bash
curl -H 'X-API-Key: lucie_files_demo_key' \
  https://maison-lucie-si.vercel.app/api/files/demand-forecast.csv
```

Legacy files (unchanged columns, more rows): `demand-forecast.csv` and `supplier-scorecard.csv`. Per-application files: see `GET /api/files/index.json`.

## Local microservice demonstrator

Node.js 22+ is required and no external package is needed.

```bash
npm start
npm test
npm run demo
```

The local topology still demonstrates REST services, an event broker, a CSV batch hub and the Aura gateway on ports 4100–4191. See [docs/architecture.md](docs/architecture.md) and [docs/aura-integration.md](docs/aura-integration.md).

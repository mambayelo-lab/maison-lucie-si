# Maison Lucie SI

Executable, synthetic information system for the **Aura Supply Chain Resilience Agent**.

**Live portal:** https://maison-lumen-si.vercel.app  
**OpenAPI discovery:** https://maison-lumen-si.vercel.app/api/openapi

The project exposes six coherent source applications, deterministic alerts, governed CSV exports and a cursor-based CloudEvents 1.0 feed. Vendor names only identify familiar integration patterns; no vendor product or real customer data is embedded.

## Public discovery endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Liveness and API version |
| `GET /api/catalog` | Applications and contracts, without secrets |
| `GET /api/ontology` | Minimal business ontology |
| `GET /api/openapi` | OpenAPI 3.1 discovery document |

## Authenticated read endpoints

| Endpoint | Authentication | Purpose |
|---|---|---|
| `GET /api/data/sap-s4` | Basic + `X-Lumen-Tenant` | Purchase orders |
| `GET /api/data/manhattan-wms` | `X-API-Key` | Inventory positions |
| `POST /api/token` then `GET /api/data/blueyonder-tms` | OAuth2 client credentials | Shipments |
| `GET /api/data/coupa-risk` | Bearer | Supplier risk |
| `GET /api/data/snowflake-demand` | Bearer + account/warehouse/role headers | Demand forecast |
| `GET /api/data/mulesoft-events` | client-id/client-secret headers | Integration event source |
| `GET /api/alerts` | Gateway Bearer | Deterministic decision alerts |
| `GET /api/events` | client-id/client-secret headers | CloudEvents 1.0 batch with cursor |
| `GET /api/files/:name` | `X-API-Key` | CSV exports with ETag and row count |

All credentials committed in this repository are deliberately non-sensitive demonstration values. The API now validates them to exercise real authentication flows; they must never be presented as production security. Environment variables can override server-side demo secrets.

## Events

`GET /api/events?cursor=0&limit=50` returns `application/cloudevents-batch+json`. Optional filters are `type`, `subject` and ISO-8601 `since`. Pagination uses `X-Next-Cursor` and a standard `Link` header when another page exists.

```bash
curl -H 'X-Client-Id: aura-demo-client' \
  -H 'X-Client-Secret: DEMO-ONLY' \
  'https://maison-lumen-si.vercel.app/api/events?cursor=0&limit=50'
```

## CSV exports

```bash
curl -H 'X-API-Key: lumen_files_demo_key' \
  https://maison-lumen-si.vercel.app/api/files/demand-forecast.csv
```

Available files: `demand-forecast.csv` and `supplier-scorecard.csv`.

## Local microservice demonstrator

Node.js 22+ is required and no external package is needed.

```bash
npm start
npm test
npm run demo
```

The local topology still demonstrates REST services, an event broker, a CSV batch hub and the Aura gateway on ports 4100–4191. See [docs/architecture.md](docs/architecture.md) and [docs/aura-integration.md](docs/aura-integration.md).

// SI multi-sources Maison Lucie (taille démo) : 5 sources aux clés distinctes.
// Fonctions pures, testées par scripts/test-multisource.mjs ; le handler HTTP
// est api/sources/[source].js.
import demo from "../data/multisource-demo.json" with { type: "json" };
import { LAKE_FEEDS, lakeRow, SIZES as GSIZES, TABLES as GTABLES } from "./multisource-gen.js";

export const DATASET = demo;
const T = demo.tables;
// Flux du data lake (J-1) : copies des tables applicatives, calculées au chargement pour la taille démo.
for (const feed of Object.keys(LAKE_FEEDS)) {
  const z = GSIZES.demo, n = GTABLES[LAKE_FEEDS[feed].from].count(z), rows = [];
  for (let i = 0; i < n; i++) { const r = lakeRow(feed, z, i); if (r) rows.push(r); }
  T[`lake_${feed}`] = rows;
}

export const SOURCES = {
  sap: {
    label: "SAP S/4HANA (OData v2)", role: "Achats, fournisseurs, finance (maître fournisseurs)", keys: { supplier: "Supplier (LIFNR)", purchaseOrder: "PurchaseOrder (EBELN)" },
    entities: { A_Supplier: { table: "sap_suppliers", watermark: "LastChangeDateTime", key: "Supplier" }, A_PurchaseOrderItem: { table: "sap_purchase_orders", watermark: "LastChangeDateTime", key: "PurchaseOrder" } },
  },
  pim: { label: "PIM produits (REST)", role: "Maître produits", keys: { product: "productId", ean: "ean (EAN-13)", supplier: "supplierTaxId (SIRET/TVA/DUNS en saisie libre)" }, resources: { products: { table: "pim_products", watermark: "updatedAt", key: "productId" } } },
  manhattan: { label: "Manhattan Active WM (REST)", role: "Stocks et entrepôts", keys: { item: "ItemId (GTIN-14)", facility: "FacilityId (sans tiret)" }, resources: { inventory: { table: "wms_stock", watermark: "UpdatedTimestamp", key: "ItemId" }, movements: { table: "wms_movements", watermark: "MovedAt", key: "MovementId" }, facilities: { table: "wms_facilities", key: "FacilityId" } } },
  tms: { label: "TMS (REST)", role: "Transport, expéditions, transporteurs", keys: { shipment: "ShipmentId", po: "PurchaseOrderRef (PO-…)", item: "ItemId (GTIN-14)", supplier: "OriginName (raison sociale libre)" }, resources: { shipments: { table: "tms_shipments", watermark: "UpdatedTimestamp", key: "ShipmentId" }, deliveries: { table: "tms_deliveries", watermark: "UpdatedAt", key: "DeliveryId" } } },
  aps: { label: "APS (REST)", role: "Planification, prévisions, S&OP", keys: { material: "Material (référence interne)", site: "Site", week: "Week (ISO)" }, resources: { forecasts: { table: "aps_forecasts", watermark: "UpdatedAt", key: "ForecastId" } } },
  srm: { label: "SRM · portail fournisseurs (REST)", role: "Évaluation, risques, certifications", keys: { supplier: "SrmId", tax: "TaxId (TVA « FR-12-… » ou DUNS)" }, resources: { suppliers: { table: "srm_suppliers", watermark: "UpdatedAt", key: "SrmId" } } },
  qms: { label: "QMS (REST)", role: "Qualité, non-conformités, retours", keys: { nc: "NcId", item: "Ean", supplier: "SupplierTaxId" }, resources: { nonconformities: { table: "qms_nonconformities", watermark: "UpdatedAt", key: "NcId" } } },
  oms: { label: "OMS commandes clients (REST ou fichier)", role: "Commandes clients", keys: { product: "ProductRef (référence interne, casse libre)", site: "FulfillmentSite" }, resources: { "order-lines": { table: "oms_order_lines", watermark: "UpdatedAt", key: "OrderLineId" } } },
  lake: { label: "Data lake ventes (SQL / Parquet / CSV)", role: "Historique : ventes magasin et flux J-1 des applications (OMS, WMS, ERP, TMS, APS, QMS)", keys: { product: "Ean (EAN-13)", store: "StoreCode (minuscules, underscore)", feeds: "mêmes identifiants que l'application d'origine" }, resources: { sales: { table: "lake_sales", watermark: "SaleDate", key: "TicketId" }, ...Object.fromEntries(Object.keys(LAKE_FEEDS).map(f => [f, { table: `lake_${f}`, watermark: "_ingestedAt", key: "_ingestedAt" }])) } },
};

// Erreurs volontaires documentées (vérité terrain recalculée à la génération).
export const DELIBERATE_ERRORS = [
  { id: "dup-supplier", source: "sap", count: demo.groundTruth.duplicateSuppliers, description: "Fournisseur en double : autre LIFNR, raison sociale en majuscules + « SAS », SIRET/TVA avec espaces." },
  { id: "orphan-product", source: "pim", count: demo.groundTruth.orphanProducts, description: "Produit dont l'identifiant fiscal fournisseur (FR99…) n'existe pas dans SAP." },
  { id: "dup-ean", source: "pim", count: demo.groundTruth.duplicateEans, description: "Deux produits PIM partagent le même EAN." },
  { id: "tax-format", source: "pim", count: null, description: "TVA saisie en minuscules avec espaces (« fr 12 345678901 »), DUNS avec tirets : à normaliser." },
  { id: "orphan-stock", source: "manhattan", count: demo.groundTruth.orphanStockItems, description: "Ligne de stock sur un GTIN inconnu du PIM (préfixe 0399)." },
  { id: "unknown-facility", source: "manhattan", count: demo.groundTruth.unknownFacilities, description: "Code site WHXXX inconnu." },
  { id: "gtin14", source: "manhattan", count: null, description: "ItemId en GTIN-14 (zéro de tête) à ramener en EAN-13 ; FacilityId sans tiret (WHPAR → WH-PAR)." },
  { id: "oms-case", source: "oms", count: demo.groundTruth.lowercaseOmsRefs, description: "Référence produit saisie en minuscules." },
  { id: "store-code", source: "lake", count: null, description: "Code magasin en minuscules avec underscore (btq_par_fsh → BTQ-PAR-FSH)." },
  { id: "origin-name", source: "tms", count: demo.groundTruth.variantOriginNames, description: "Raison sociale fournisseur saisie autrement dans le WMS (MAJUSCULES + « Ltd ») : rapprochement par ressemblance, soumis à validation." },
  { id: "country-divergence", source: "pim", count: demo.groundTruth.countryDivergentSuppliers, description: "Pays du fournisseur différent entre le PIM et SAP (maître) : écart de fond, signalé dans la preuve des alertes." },
  { id: "aps-unknown-material", source: "aps", count: demo.groundTruth.unknownApsMaterials, description: "Prévision sur une référence inconnue du PIM (ML-9…)." },
  { id: "srm-expired-certification", source: "srm", count: demo.groundTruth.expiredCertifications, description: "Certification fournisseur expirée." },
  { id: "srm-tax-format", source: "srm", count: null, description: "TVA au format « FR-12-345678901 » et nom de groupe « (groupe) » : à normaliser et rapprocher." },
  { id: "qms-unknown-ean", source: "qms", count: demo.groundTruth.unknownQmsEans, description: "Non-conformité sur un EAN inconnu (préfixe 399)." },
  { id: "po-prefix", source: "tms", count: null, description: "Référence de commande « PO-4500000001 » côté TMS, « 4500000001 » côté SAP." },
];

// ── OData v2 ($filter, $select, $top, $skip, $inlinecount, !deltatoken) ──────
function odataLiteral(raw) {
  const s = raw.trim();
  let m;
  if ((m = s.match(/^'(.*)'$/))) return m[1].replace(/''/g, "'");
  if ((m = s.match(/^datetime(?:offset)?'(.*)'$/))) return new Date(m[1].endsWith("Z") || /[+-]\d\d:\d\d$/.test(m[1]) ? m[1] : `${m[1]}Z`).toISOString();
  if (s === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  throw new Error(`Littéral OData non pris en charge : ${s}`);
}
export function parseODataFilter(filter) {
  if (!filter) return () => true;
  const clauses = filter.split(/\s+and\s+/i).map(c => {
    const m = c.trim().match(/^([A-Za-z0-9_]+)\s+(eq|ne|gt|ge|lt|le)\s+(.+)$/i);
    if (!m) throw new Error(`Filtre OData non pris en charge : ${c}`);
    return { field: m[1], op: m[2].toLowerCase(), value: odataLiteral(m[3]) };
  });
  return row => clauses.every(({ field, op, value }) => compare(row[field], op, value));
}
function norm(v) { return typeof v === "string" && /^\d{4}-\d\d-\d\d/.test(v) ? new Date(v.length === 10 ? `${v}T00:00:00Z` : v.endsWith("Z") ? v : `${v.replace(" ", "T")}Z`).toISOString() : v; }
function compare(a, op, b) {
  const x = norm(a), y = norm(b);
  switch (op) { case "eq": return x === y || (x != null && y != null && String(x) === String(y)); case "ne": return !(x === y || String(x) === String(y)); case "gt": return x != null && x > y; case "ge": return x != null && x >= y; case "lt": return x != null && x < y; case "le": return x != null && x <= y; }
  return false;
}
const qs = pairs => pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
const pick = (row, select) => (select ? Object.fromEntries(select.map(f => [f, row[f] ?? null])) : row);

export function odata(entity, query, baseUrl = "") {
  const def = SOURCES.sap.entities[entity];
  if (!def) return { status: 404, body: { error: { code: "NOT_FOUND", message: { lang: "fr", value: `Entité inconnue : ${entity}` } } } };
  let rows = T[def.table];
  try {
    rows = rows.filter(parseODataFilter(query.$filter));
  } catch (e) { return { status: 400, body: { error: { code: "BAD_FILTER", message: { lang: "fr", value: e.message } } } }; }
  const delta = query["!deltatoken"];
  if (delta) { const since = new Date(delta).toISOString(); rows = rows.filter(r => norm(r[def.watermark]) > since); }
  const total = rows.length;
  const top = Math.min(Number(query.$top) || 1000, 5000);
  const skip = Number(query.$skip) || 0;
  const select = query.$select ? String(query.$select).split(",").map(s => s.trim()).filter(Boolean) : null;
  const page = rows.slice(skip, skip + top).map(r => pick(r, select));
  const d = { results: page };
  if (query.$inlinecount === "allpages") d.__count = String(total);
  const passthrough = Object.entries(query).filter(([k]) => ["$filter", "$select", "$top", "!deltatoken", "$inlinecount"].includes(k));
  if (skip + top < total) d.__next = `${baseUrl}?${qs([...passthrough, ["$skip", String(skip + top)]])}`;
  else {
    const maxTs = T[def.table].reduce((m, r) => (norm(r[def.watermark]) > m ? norm(r[def.watermark]) : m), "");
    d.__delta = `${baseUrl}?${qs([["!deltatoken", maxTs]])}`;
  }
  return { status: 200, body: { d } };
}

// ── REST paginé (PIM, OMS) : updatedAfter + curseur ────────────────────────
export function restPage(source, resource, query) {
  const def = SOURCES[source]?.resources?.[resource];
  if (!def) return { status: 404, body: { error: { code: "NOT_FOUND", message: `Ressource inconnue : ${source}/${resource}` } } };
  let rows = T[def.table];
  if (query.updatedAfter && def.watermark) { const since = new Date(query.updatedAfter).toISOString(); rows = rows.filter(r => norm(r[def.watermark]) > since); }
  for (const [k, v] of Object.entries(query)) if (!["updatedAfter", "limit", "cursor", "source", "resource", "format", "fields", "from", "to", "page", "size"].includes(k) && rows[0] && k in rows[0]) rows = rows.filter(r => String(r[k]) === String(v));
  if (query.from && def.watermark) rows = rows.filter(r => norm(r[def.watermark]) >= new Date(query.from).toISOString());
  if (query.to && def.watermark) rows = rows.filter(r => norm(r[def.watermark]) < new Date(query.to).toISOString());
  const fields = query.fields ? String(query.fields).split(",") : null;
  if (source === "manhattan") {
    // Pagination Manhattan Active : page/size + en-tête (forme « à vérifier avec la documentation client »).
    const size = Math.min(Number(query.size) || 500, 2000), pageNo = Number(query.page) || 0;
    return { status: 200, body: { data: rows.slice(pageNo * size, (pageNo + 1) * size).map(r => pick(r, fields)), header: { page: pageNo, size, totalCount: rows.length, hasMore: (pageNo + 1) * size < rows.length } } };
  }
  const limit = Math.min(Number(query.limit) || 500, 2000), offset = Number(query.cursor) || 0;
  const items = rows.slice(offset, offset + limit).map(r => pick(r, fields));
  return { status: 200, body: { items, total: rows.length, nextCursor: offset + limit < rows.length ? String(offset + limit) : null } };
}

// ── Data lake : agrégation poussée à la source (GROUP BY) ─────────────────
export function lakeAggregate(query) {
  const groupBy = String(query.groupBy || "").split(",").map(s => s.trim()).filter(Boolean);
  const allowed = ["SaleDate", "Ean", "StoreCode", "month"];
  if (groupBy.some(g => !allowed.includes(g))) return { status: 400, body: { error: { code: "BAD_GROUP", message: `groupBy parmi ${allowed.join(", ")}` } } };
  let rows = T.lake_sales;
  if (query.from) rows = rows.filter(r => r.SaleDate >= query.from);
  if (query.to) rows = rows.filter(r => r.SaleDate < query.to);
  if (query.Ean) rows = rows.filter(r => r.Ean === query.Ean);
  const groups = new Map();
  for (const r of rows) {
    const key = groupBy.map(g => (g === "month" ? r.SaleDate.slice(0, 7) : r[g]));
    const k = key.join("|");
    const acc = groups.get(k) ?? { ...Object.fromEntries(groupBy.map((g, i) => [g, key[i]])), lines: 0, Quantity: 0, NetAmount: 0 };
    acc.lines++; acc.Quantity += r.Quantity; acc.NetAmount = Math.round((acc.NetAmount + r.NetAmount) * 100) / 100;
    groups.set(k, acc);
  }
  return { status: 200, body: { items: [...groups.values()], scannedRows: rows.length } };
}

export function toCsv(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = v => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n") + "\n";
}

export function catalog() {
  return {
    asOf: demo.asOf, size: demo.size, counts: demo.counts,
    sources: Object.fromEntries(Object.entries(SOURCES).map(([id, s]) => [id, { label: s.label, role: s.role, keys: s.keys, endpoints: endpointsOf(id) }])),
    deliberateErrors: DELIBERATE_ERRORS,
    auth: "Authorization: Bearer <jeton passerelle> (démo : lucie_aura_gateway_demo_token)",
    scale: { onTheFly: "Ajouter size=scale à toute ressource : pages générées à la volée (pagination seule), sans stockage.", counts: scaleCounts(), parquet: "npm run generate:scale → Parquet dans /tmp/maison-lucie-scale (mêmes lignes, vérifié par test)." },
  };
}
function endpointsOf(id) {
  if (id === "lake") return ["/api/sources/lake?resource=sales&format=csv", "/api/sources/lake?aggregate=1&groupBy=Ean,month", ...Object.keys(LAKE_FEEDS).map(f => `/api/sources/lake?resource=${f}`)];
  if (id === "sap") return ["/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_Supplier", "/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrderItem"];
  if (id === "lake") return ["/api/sources/lake?resource=sales&format=csv", "/api/sources/lake?aggregate=1&groupBy=Ean,month"];
  return Object.keys(SOURCES[id].resources).map(r => `/api/sources/${id}?resource=${r}`).concat(id === "oms" ? ["/api/sources/oms?resource=order-lines&format=csv"] : []);
}

// ── Taille « scale » à la volée : des millions de lignes, rien de stocké ─────
// Pagination seule (+ $select / fields) : les filtres demanderaient de parcourir
// toute la table. C'est le cas réaliste d'une API directe à grande échelle.
import { page as genPage, SIZES as GEN_SIZES, TABLES as GEN_TABLES } from "./multisource-gen.js";
const SCALE_TABLE = { movements: "wms_movements", deliveries: "tms_deliveries", A_Supplier: "sap_suppliers", A_PurchaseOrderItem: "sap_purchase_orders", products: "pim_products", inventory: "wms_stock", shipments: "wms_shipments", facilities: "wms_facilities", "order-lines": "oms_order_lines", sales: "lake_sales" };
export function scaleCounts() { return Object.fromEntries(Object.keys(GEN_TABLES).map(t => [t, GEN_TABLES[t].count(GEN_SIZES.scale)])); }
export function scalePage(source, name, query, baseUrl = "") {
  if (source === "lake" && LAKE_FEEDS[name]) {
    // Flux du lac à grande échelle : mêmes rangs que la table d'origine, lignes plus récentes que J-1 omises.
    const limit = Math.min(Number(query.limit) || 500, 5000), offset = Number(query.cursor) || 0, z = GSIZES.scale;
    const total = GTABLES[LAKE_FEEDS[name].from].count(z), items = [];
    for (let i = offset; i < Math.min(total, offset + limit); i++) { const r = lakeRow(name, z, i); if (r) items.push(r); }
    return { status: 200, body: { items, total, nextCursor: offset + limit < total ? String(offset + limit) : null } };
  }
  const table = SCALE_TABLE[name];
  if (!table) return { status: 404, body: { error: { code: "NOT_FOUND", message: `Ressource inconnue : ${name}` } } };
  const unsupported = ["$filter", "!deltatoken", "updatedAfter", "from", "to", "aggregate"].filter(k => query[k]);
  if (unsupported.length) return { status: 400, body: { error: { code: "SCALE_PAGINATION_ONLY", message: `Taille scale : pagination seule (${unsupported.join(", ")} non pris en charge ; utiliser les fichiers Parquet pour les calculs).` } } };
  const select = (query.$select || query.fields) ? String(query.$select || query.fields).split(",").map(s => s.trim()) : null;
  const pickRow = r => (select ? Object.fromEntries(select.map(f => [f, r[f] ?? null])) : r);
  if (source === "sap") {
    const top = Math.min(Number(query.$top) || 1000, 5000), skip = Number(query.$skip) || 0;
    const p = genPage(table, "scale", skip, top);
    const d = { results: p.rows.map(pickRow) };
    if (query.$inlinecount === "allpages") d.__count = String(p.total);
    if (p.nextOffset !== null) d.__next = `${baseUrl}?size=scale&$top=${top}&$skip=${p.nextOffset}${select ? `&$select=${select.join(",")}` : ""}`;
    return { status: 200, body: { d } };
  }
  if (source === "manhattan") {
    const size = Math.min(Number(query.size) || 500, 5000), pageNo = Number(query.page) || 0;
    const p = genPage(table, "scale", pageNo * size, size);
    return { status: 200, body: { data: p.rows.map(pickRow), header: { page: pageNo, size, totalCount: p.total, hasMore: p.nextOffset !== null } } };
  }
  const limit = Math.min(Number(query.limit) || 500, 5000), offset = Number(query.cursor) || 0;
  const p = genPage(table, "scale", offset, limit);
  return { status: 200, body: { items: p.rows.map(pickRow), total: p.total, nextCursor: p.nextOffset === null ? null : String(p.nextOffset) } };
}

// ── $metadata OData (EDMX v2) : types déclarés des entités SAP simulées ─────
export function odataMetadata() {
  const edm = v => (typeof v === "number" ? (Number.isInteger(v) ? "Edm.Int32" : "Edm.Decimal") : typeof v === "string" && /^\d{4}-\d\d-\d\d \d\d:\d\d/.test(v) ? "Edm.DateTime" : typeof v === "string" && /^\d{4}-\d\d-\d\d$/.test(v) ? "Edm.DateTime" : "Edm.String");
  const types = Object.entries(SOURCES.sap.entities).map(([name, def]) => {
    const row = T[def.table][0];
    const props = Object.keys(row).map(k => `<Property Name="${k}" Type="${edm(row[k])}" Nullable="true"/>`).join("");
    return { name, xml: `<EntityType Name="${name}Type"><Key><PropertyRef Name="${def.key}"/></Key>${props}</EntityType>` };
  });
  return `<?xml version="1.0" encoding="utf-8"?><edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx"><edmx:DataServices><Schema Namespace="LUCIE_SIM" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">${types.map(t => t.xml).join("")}<EntityContainer Name="LUCIE_SIM_Entities">${types.map(t => `<EntitySet Name="${t.name}" EntityType="LUCIE_SIM.${t.name}Type"/>`).join("")}</EntityContainer></Schema></edmx:DataServices></edmx:Edmx>`;
}

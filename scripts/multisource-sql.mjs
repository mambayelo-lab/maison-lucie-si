// Générateur SQL (DuckDB) du SI multi-sources Maison Lucie.
// Une seule logique pour les deux tailles : `demo` (quelques milliers de lignes,
// exportées en JSON versionné, servi en ligne) et `scale` (millions de lignes,
// Parquet dans /tmp, jamais dans git). Les erreurs volontaires sont injectées
// par des règles déterministes (modulo), documentées dans docs/SOURCES-MULTI.md.

import { AS_OF, SIZES, STORY_SUPPLIERS, STORY_SKUS, STORY_SITES } from "../lib/multisource-gen.js";
export { AS_OF, SIZES, STORY_SUPPLIERS, STORY_SKUS, STORY_SITES };

const lit = s => `'${String(s).replace(/'/g, "''")}'`;
const list = xs => `[${xs.map(lit).join(", ")}]`;

// Renvoie la liste ordonnée d'instructions SQL qui créent les tables.
export function generationSql(size) {
  const z = SIZES[size];
  if (!z) throw new Error(`Taille inconnue : ${size}`);
  const nDup = Math.floor(z.suppliers / z.dupSupplierEvery);
  const story = STORY_SUPPLIERS.length;
  return [
    // Hachage 32 bits identique à lib/multisource-gen.js (h32) : mêmes lignes en SQL et en JavaScript.
    `CREATE OR REPLACE MACRO m1(a) AS (xor(a >> 16, a) * 73244475) % 4294967296`,
    `CREATE OR REPLACE MACRO h32(x) AS xor(m1(m1((x)::BIGINT % 4294967296)) >> 16, m1(m1((x)::BIGINT % 4294967296)))`,
    `CREATE OR REPLACE MACRO u(i, s) AS (h32(i::BIGINT * 7919 + s) % 1000000)::DOUBLE / 1000000.0`,
    `CREATE OR REPLACE MACRO ean13(b) AS b || ((10 - list_sum(list_transform(range(1, 13), lambda k: (ascii(substr(b, k::INTEGER, 1)) - 48) * CASE WHEN k % 2 = 1 THEN 1 ELSE 3 END)) % 10) % 10)::VARCHAR`,
    `CREATE OR REPLACE MACRO siren(i) AS (100000000 + (i::BIGINT * 37) % 899999999)::VARCHAR`,
    `CREATE OR REPLACE MACRO vatfr(i) AS 'FR' || lpad(((12 + 3 * ((100000000 + (i::BIGINT * 37) % 899999999) % 97)) % 97)::VARCHAR, 2, '0') || siren(i)`,
    `CREATE OR REPLACE MACRO lifnr(i) AS lpad((100000 + i)::VARCHAR, 10, '0')`,
    `CREATE OR REPLACE MACRO site_code(k) AS CASE WHEN k < ${STORY_SITES.length} THEN ${list(STORY_SITES)}[k + 1] ELSE (CASE WHEN k % 4 = 0 THEN 'WH-' WHEN k % 4 = 1 THEN 'FAC-' ELSE 'BTQ-' END) || 'S' || lpad(k::VARCHAR, 4, '0') END`,

    // ── SAP S/4 : A_Supplier (LFA1) ─────────────────────────────────────────
    `CREATE OR REPLACE TABLE sap_supplier_base AS
     SELECT i, CASE WHEN i <= ${story} THEN ${list(STORY_SUPPLIERS.map(s => s[0]))}[i] ELSE 'Fournisseur ' || lpad(i::VARCHAR, 5, '0') END AS name,
            CASE WHEN i <= ${story} THEN ${list(STORY_SUPPLIERS.map(s => s[1]))}[i] ELSE ['FR','FR','IT','ES','PT','DE','CN','IN'][1 + (i % 8)] END AS country
     FROM range(1, ${z.suppliers + 1}) t(i)`,
    `CREATE OR REPLACE TABLE sap_suppliers AS
     WITH base AS (
       SELECT lifnr(i) AS Supplier, name AS SupplierName, country AS Country,
              CASE WHEN country = 'FR' THEN siren(i) || lpad(((i % 97) + 1)::VARCHAR, 5, '0') END AS TaxNumber1,
              CASE WHEN country = 'FR' THEN vatfr(i) WHEN country IN ('IT','ES','PT','DE','SE') THEN country || lpad(((i::BIGINT * 7717) % 99999999999)::VARCHAR, 11, '0') END AS VATRegistration,
              CASE WHEN country IN ('CN','IN') THEN lpad((150000000 + i * 13)::VARCHAR, 9, '0') END AS DUNS,
              CASE WHEN i <= ${story} THEN 'SUP-' || lpad(i::VARCHAR, 3, '0') END AS LegacySupplierId,
              (TIMESTAMP '${AS_OF} 06:00:00' - INTERVAL (i % 90) DAY) AS LastChangeDateTime
       FROM sap_supplier_base),
     -- Erreur volontaire : doublons (même identifiant fiscal, autre LIFNR, raison sociale et format différents).
     dup AS (
       SELECT lifnr(${z.suppliers} + d) AS Supplier, upper(b.SupplierName) || ' SAS' AS SupplierName, b.Country,
              CASE WHEN b.TaxNumber1 IS NOT NULL THEN substr(b.TaxNumber1,1,3) || ' ' || substr(b.TaxNumber1,4,3) || ' ' || substr(b.TaxNumber1,7,3) || ' ' || substr(b.TaxNumber1,10) END AS TaxNumber1,
              CASE WHEN b.VATRegistration IS NOT NULL THEN substr(b.VATRegistration,1,2) || ' ' || substr(b.VATRegistration,3) END AS VATRegistration,
              b.DUNS, NULL AS LegacySupplierId, TIMESTAMP '${AS_OF} 05:00:00' AS LastChangeDateTime
       FROM range(1, ${nDup + 1}) t(d) JOIN base b ON b.Supplier = lifnr(2 + (d - 1) * ${z.dupSupplierEvery}))
     SELECT * FROM base UNION ALL SELECT * FROM dup`,

    // ── PIM : produits, EAN, fournisseur lié (identifiant fiscal au format libre) ──
    `CREATE OR REPLACE TABLE pim_products AS
     WITH p AS (
       SELECT i, ean13('376' || lpad(i::VARCHAR, 9, '0')) AS own_ean,
              CASE WHEN i <= ${STORY_SKUS.length} THEN ${list(STORY_SKUS.map(s => s[0]))}[i] ELSE 'ML-' || lpad(i::VARCHAR, 7, '0') END AS ref,
              CASE WHEN i <= ${STORY_SKUS.length} THEN [${STORY_SKUS.map(s => s[1]).join(",")}][i] ELSE 1 + (h32(i::BIGINT * 31) % ${z.suppliers}) END AS sup
       FROM range(1, ${z.products + 1}) t(i))
     SELECT 'PIM-' || lpad(p.i::VARCHAR, 7, '0') AS productId, p.ref AS internalRef,
            -- Erreur volontaire : EAN en double (copie de l'EAN du produit précédent).
            CASE WHEN p.i > ${STORY_SKUS.length} AND p.i % ${z.dupEanEvery} = 0 THEN ean13('376' || lpad((p.i - 1)::VARCHAR, 9, '0')) ELSE p.own_ean END AS ean,
            CASE WHEN p.i <= ${STORY_SKUS.length} THEN replace(p.ref, '-', ' ') ELSE 'Article ' || p.i END AS name,
            ['Maroquinerie','Accessoires','Emballage','Textile','Composants'][1 + (p.i % 5)] AS category,
            -- Lien produit → fournisseur : identifiant fiscal saisi librement ; orphelins volontaires.
            CASE WHEN p.i > ${STORY_SKUS.length} AND p.i % ${z.orphanProductEvery} = 0 THEN 'FR99' || lpad(p.i::VARCHAR, 9, '0')
                 WHEN s.VATRegistration IS NOT NULL AND s.Country = 'FR' THEN lower(substr(s.VATRegistration,1,2)) || ' ' || substr(s.VATRegistration,3,2) || ' ' || substr(s.VATRegistration,5)
                 WHEN s.VATRegistration IS NOT NULL THEN s.VATRegistration
                 ELSE substr(s.DUNS,1,2) || '-' || substr(s.DUNS,3,3) || '-' || substr(s.DUNS,6) END AS supplierTaxId,
            s.SupplierName AS supplierName,
            -- Erreur volontaire (écart de fond) : pays du fournisseur saisi différemment dans le PIM.
            CASE WHEN p.sup = 3 THEN 'HK' WHEN p.sup % 23 = 0 THEN (CASE WHEN s.Country = 'FR' THEN 'BE' ELSE 'FR' END) ELSE s.Country END AS supplierCountry,
            round(5 + u(p.i, 11) * 395, 2) AS listPrice,
            (TIMESTAMP '${AS_OF} 04:00:00' - INTERVAL (p.i % 60) DAY) AS updatedAt
     FROM p JOIN sap_suppliers s ON s.Supplier = lifnr(p.sup)`,

    // ── Manhattan Active WM : sites, stock (ItemId = GTIN-14, FacilityId sans tiret) ──
    `CREATE OR REPLACE TABLE wms_facilities AS
     SELECT replace(site_code(k), '-', '') AS FacilityId, site_code(k) AS SiteCode,
            CASE WHEN site_code(k) LIKE 'WH-%' THEN 'DC' WHEN site_code(k) LIKE 'FAC-%' THEN 'PLANT' ELSE 'STORE' END AS FacilityType
     FROM range(0, ${z.sites}) t(k)`,
    `CREATE OR REPLACE TABLE wms_stock AS
     SELECT CASE WHEN r % ${z.orphanStockEvery} = ${z.orphanStockEvery - 1} THEN '0' || ean13('399' || lpad(r::VARCHAR, 9, '0'))
                 ELSE '0' || pr.ean END AS ItemId,
            CASE WHEN r % ${z.badFacilityEvery} = ${z.badFacilityEvery - 1} THEN 'WHXXX' ELSE replace(site_code(((pid * 131) + (r % ${z.sitesPerProduct}) * ${Math.max(1, Math.floor(z.sites / z.sitesPerProduct))}) % ${z.sites}), '-', '') END AS FacilityId,
            greatest(0, 90 + (u(r, 21) * 600)::INTEGER - CASE WHEN pid <= ${STORY_SKUS.length} AND (r % ${z.sitesPerProduct}) = 0 THEN 700 ELSE 0 END) AS OnHand,
            (u(r, 22) * 60)::INTEGER AS Allocated,
            30 + (u(pid, 23) * 50)::INTEGER AS SafetyStock,
            (TIMESTAMP '${AS_OF} 07:00:00' - INTERVAL ((r % 48)) HOUR) AS UpdatedTimestamp
     FROM (SELECT r, 1 + r // ${z.sitesPerProduct} AS pid FROM range(0, ${z.stockProducts * z.sitesPerProduct}) t(r)) x
     JOIN pim_products pr ON pr.productId = 'PIM-' || lpad(x.pid::VARCHAR, 7, '0')`,

    // ── SAP A_PurchaseOrderItem + Manhattan shipments (référence PO différente) ──
    `CREATE OR REPLACE TABLE sap_purchase_orders AS
     SELECT (4500000000 + n)::VARCHAR AS PurchaseOrder, '00010' AS PurchaseOrderItem,
            lifnr(CASE WHEN n <= 40 THEN [1,1,1,3,3,2,1,5,6,1][1 + (n % 10)] ELSE 1 + (h32(n::BIGINT * 17) % ${z.suppliers}) END) AS Supplier,
            CAST(NULL AS VARCHAR) AS Material,
            (50 + u(n, 31) * 5000)::INTEGER AS OrderQuantity,
            'EUR' AS DocumentCurrency,
            (DATE '${AS_OF}' - INTERVAL ((n % 60) - 20) DAY)::DATE AS ScheduleLineDeliveryDate,
            (TIMESTAMP '${AS_OF} 03:00:00' - INTERVAL (n % 45) DAY) AS LastChangeDateTime
     FROM range(1, ${z.shipments + 1}) t(n)`,
    // Article commandé : un produit dont le fournisseur est bien celui du PO quand il existe (récit), sinon hasard.
    `UPDATE sap_purchase_orders SET Material = CASE WHEN CAST(PurchaseOrder AS BIGINT) - 4500000000 <= 40
        THEN ${list(STORY_SKUS.map(s => s[0]))}[1 + ((CAST(PurchaseOrder AS BIGINT) - 4500000000) % ${STORY_SKUS.length})]
        ELSE 'ML-' || lpad((${STORY_SKUS.length + 1} + h32(CAST(PurchaseOrder AS BIGINT) * 29) % ${z.products - STORY_SKUS.length})::VARCHAR, 7, '0') END`,
    `CREATE OR REPLACE TABLE tms_shipments AS
     SELECT 'SHP-' || lpad(n::VARCHAR, 8, '0') AS ShipmentId, 'PO-' || po.PurchaseOrder AS PurchaseOrderRef,
            '0' || pr.ean AS ItemId,
            -- Erreur volontaire : raison sociale saisie autrement dans le WMS (forme juridique, casse).
            CASE WHEN n % 97 = 0 THEN upper(s.SupplierName) || ' Ltd' ELSE s.SupplierName END AS OriginName,
            replace(site_code(n % ${z.sites}), '-', '') AS DestinationFacility,
            po.ScheduleLineDeliveryDate AS ExpectedDate,
            CASE WHEN po.ScheduleLineDeliveryDate > DATE '${AS_OF}' THEN NULL
                 ELSE (po.ScheduleLineDeliveryDate + INTERVAL ((CASE WHEN u(n, 41) < (CASE WHEN po.Supplier IN (lifnr(1), lifnr(3)) THEN ${z.lateSupplierBias} ELSE 0.12 END) THEN 3 + u(n, 42) * 12 ELSE 0 END)::INTEGER) DAY)::DATE END AS ActualDate,
            po.OrderQuantity AS Quantity,
            ['Atlantic Lines', 'EuroRail Cargo', 'SkyFreight', 'TransAlpes', 'Nord Express'][1 + (n % 5)] AS Carrier,
            ['MARITIME', 'AERIEN', 'ROUTE', 'FERROVIAIRE'][1 + (n % 4)] AS TransportMode,
            (TIMESTAMP '${AS_OF} 08:00:00' - INTERVAL (n % 30) DAY) AS UpdatedTimestamp
     FROM (SELECT n FROM range(1, ${z.shipments + 1}) t(n)) k
     JOIN sap_purchase_orders po ON po.PurchaseOrder = (4500000000 + k.n)::VARCHAR
     JOIN sap_suppliers s ON s.Supplier = po.Supplier
     JOIN pim_products pr ON pr.internalRef = po.Material`,

    // ── OMS : commandes clients (ProductRef = référence interne, casse libre) ──
    `CREATE OR REPLACE TABLE oms_order_lines AS
     SELECT 'OL-' || lpad(n::VARCHAR, 9, '0') AS OrderLineId, 'SO-' || lpad((n // 3)::VARCHAR, 9, '0') AS OrderId,
            'C' || lpad((1 + h32(n::BIGINT * 3) % ${z.customers})::VARCHAR, 8, '0') AS CustomerId,
            CASE WHEN n % 50 = 0 THEN lower(ref) ELSE ref END AS ProductRef,
            1 + (u(n, 51) * 3)::INTEGER AS Quantity,
            ['WEB','STORE','MARKETPLACE'][1 + (n % 3)] AS Channel,
            site_code((n * 7) % ${z.sites}) AS FulfillmentSite,
            (DATE '${AS_OF}' - INTERVAL (n % 90) DAY)::DATE AS OrderDate,
            CASE WHEN u(n, 52) < 0.08 THEN 'BACKORDERED' WHEN (n % 90) < 3 THEN 'OPEN' ELSE 'SHIPPED' END AS Status,
            (TIMESTAMP '${AS_OF} 09:00:00' - INTERVAL (n % 90) DAY) AS UpdatedAt
     FROM (SELECT n, CASE WHEN n % 4 = 0 THEN ${list(STORY_SKUS.map(s => s[0]))}[1 + (n % ${STORY_SKUS.length})]
                          ELSE 'ML-' || lpad((${STORY_SKUS.length + 1} + h32(n::BIGINT * 5) % ${z.products - STORY_SKUS.length})::VARCHAR, 7, '0') END AS ref
           FROM range(1, ${z.omsLines + 1}) t(n)) x`,

    // ── Data lake : ventes (EAN-13, code magasin en minuscules/underscore) ──
    `CREATE OR REPLACE TABLE lake_sales AS
     SELECT (DATE '${AS_OF}' - INTERVAL (n % 365) DAY)::DATE AS SaleDate,
            ean13('376' || lpad((CASE WHEN n % 3 = 0 THEN 1 + (n % ${STORY_SKUS.length}) ELSE 1 + h32(n::BIGINT * 7) % ${z.products} END)::VARCHAR, 9, '0')) AS Ean,
            lower(replace(site_code(6 + (n % greatest(1, ${z.sites} - 6))), '-', '_')) AS StoreCode,
            1 + (u(n, 61) * 2)::INTEGER AS Quantity,
            round(20 + u(n, 62) * 480, 2) AS NetAmount,
            'T' || lpad((n // 2)::VARCHAR, 10, '0') AS TicketId
     FROM range(1, ${z.salesLines + 1}) t(n)`,
    `DROP TABLE sap_supplier_base`,
  ];
}

export const TABLES = ["sap_suppliers", "sap_purchase_orders", "pim_products", "wms_facilities", "wms_stock", "tms_shipments", "oms_order_lines", "lake_sales"];

// Vérité terrain des erreurs volontaires, calculée par requête (les deux tailles).
export const GROUND_TRUTH_SQL = {
  duplicateSuppliers: `SELECT count(*) FROM sap_suppliers WHERE LegacySupplierId IS NULL AND SupplierName LIKE '% SAS' AND SupplierName = upper(SupplierName)`,
  orphanProducts: `SELECT count(*) FROM pim_products WHERE supplierTaxId LIKE 'FR99%'`,
  duplicateEans: `SELECT count(*) FROM (SELECT ean FROM pim_products GROUP BY ean HAVING count(*) > 1)`,
  orphanStockItems: `SELECT count(*) FROM wms_stock WHERE ItemId LIKE '0399%'`,
  unknownFacilities: `SELECT count(*) FROM wms_stock WHERE FacilityId = 'WHXXX'`,
  lowercaseOmsRefs: `SELECT count(*) FROM oms_order_lines WHERE ProductRef <> upper(ProductRef)`,
  stockouts: `SELECT count(*) FROM wms_stock WHERE OnHand - Allocated < SafetyStock`,
  variantOriginNames: `SELECT count(DISTINCT OriginName) FROM tms_shipments WHERE OriginName LIKE '% Ltd'`,
  countryDivergentSuppliers: `SELECT count(DISTINCT s.Supplier) FROM pim_products p JOIN sap_suppliers s ON s.SupplierName = p.supplierName AND s.LegacySupplierId IS DISTINCT FROM 'x' WHERE p.supplierCountry <> s.Country AND p.supplierTaxId NOT LIKE 'FR99%' AND s.SupplierName <> upper(s.SupplierName)`,
  lateShipments: `SELECT count(*) FROM tms_shipments WHERE ActualDate > ExpectedDate OR (ActualDate IS NULL AND ExpectedDate < DATE '${AS_OF}')`,
};

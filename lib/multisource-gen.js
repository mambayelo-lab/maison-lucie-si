// Générateur déterministe (graine fixe) du SI multi-sources Maison Lucie.
// Chaque ligne se calcule à partir de son seul rang : les API « à grande échelle »
// servent des millions de lignes à la volée, page par page, sans rien stocker.
// La même logique existe en SQL DuckDB (scripts/multisource-sql.mjs) pour produire
// les fichiers Parquet ; un test vérifie que les deux donnent les mêmes lignes.

export const AS_OF = "2026-09-28";
export const SEED = 7919;

export const SIZES = {
  demo: {
    suppliers: 60, dupSupplierEvery: 20, products: 1200, orphanProductEvery: 200, dupEanEvery: 300,
    sites: 12, stockProducts: 300, sitesPerProduct: 12, orphanStockEvery: 700, badFacilityEvery: 1800,
    shipments: 800, omsLines: 3000, customers: 800, salesLines: 4000, lateSupplierBias: 0.6,
  },
  scale: {
    suppliers: 5000, dupSupplierEvery: 200, products: 1_000_000, orphanProductEvery: 333, dupEanEvery: 500,
    sites: 500, stockProducts: 1_000_000, sitesPerProduct: 5, orphanStockEvery: 1000, badFacilityEvery: 5000,
    shipments: 1_000_000, omsLines: 10_000_000, customers: 10_000_000, salesLines: 50_000_000, lateSupplierBias: 0.6,
  },
};

export const STORY_SUPPLIERS = [
  ["Tessitura Milano", "IT"], ["Maison Cuir du Nord", "FR"], ["Shenzhen Atelier Components", "CN"],
  ["Nordic Packaging AB", "SE"], ["Porto Leather Works", "PT"], ["Atlas Metalworks", "IN"],
  ["Rhône Textile Lab", "FR"], ["Soieries de Lyon", "FR"], ["Fibre Tech Barcelona", "ES"],
  ["Cartonnages de Bourgogne", "FR"], ["Fils d'Or Mulhouse", "FR"], ["Guangzhou Hardware Co", "CN"],
  ["Pelletteria Firenze", "IT"], ["Cachemire des Vosges", "FR"], ["Atelier Zip Normandie", "FR"],
];
export const STORY_SKUS = [
  ["BOX-PREMIUM", 1], ["CLASP-AURORA", 3], ["BAG-ORION", 2], ["PCH-NOVA", 5], ["BAG-LUNA", 2],
  ["BUCKLE-ATLAS", 6], ["LINING-RIVE", 7], ["TOTE-ETOILE", 13], ["SCARF-AZUR", 8], ["SCARF-SOIE-MIRA", 8],
  ["BAG-SIRIUS", 13], ["LEATHER-VEAU-NOIR", 2], ["STRAP-COMETE", 5], ["BELT-VEGA", 6], ["WALLET-CELESTE", 13],
  ["CARD-HOLDER-ALBA", 5], ["ZIP-ARGENT", 15], ["SHAWL-CACHEMIRE", 14], ["THREAD-OR", 11], ["GLOVE-NUIT", 4],
];
export const STORY_SITES = ["WH-PAR", "WH-LIL", "WH-MIL", "WH-LYO", "WH-MRS", "FAC-VEN", "BTQ-PAR-FSH", "BTQ-TYO-GNZ", "BTQ-NYC-5AV", "BTQ-DXB-MOE", "FAC-FLO", "BTQ-MIL-MTN"];
const NS = STORY_SKUS.length;

// ── Primitives identiques au SQL ─────────────────────────────────────────────
/** Hachage entier 32 bits (même définition que la macro SQL h32). */
export function h32(x) {
  let a = Math.trunc(x) % 4294967296; // x < 2^53 : modulo exact
  a = Math.imul(((a >>> 16) ^ a) >>> 0, 0x45d9f3b) >>> 0;
  a = Math.imul(((a >>> 16) ^ a) >>> 0, 0x45d9f3b) >>> 0;
  return ((a >>> 16) ^ a) >>> 0;
}
export const u = (i, s) => (h32(i * SEED + s) % 1000000) / 1000000;
const pad = (v, n) => String(v).padStart(n, "0");
// CAST(double AS INTEGER) en DuckDB : arrondi au plus proche, à égalité vers le pair.
const int = x => (Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x));
const round2 = x => Math.round(x * 100) / 100;
export function ean13(b) {
  let sum = 0;
  for (let k = 1; k <= 12; k++) sum += (b.charCodeAt(k - 1) - 48) * (k % 2 === 1 ? 1 : 3);
  return b + String((10 - (sum % 10)) % 10);
}
const siren = i => String(100000000 + ((i * 37) % 899999999));
const vatfr = i => `FR${pad((12 + 3 * ((100000000 + ((i * 37) % 899999999)) % 97)) % 97, 2)}${siren(i)}`;
const lifnr = i => pad(100000 + i, 10);
export function siteCode(k) {
  if (k < STORY_SITES.length) return STORY_SITES[k];
  return `${k % 4 === 0 ? "WH-" : k % 4 === 1 ? "FAC-" : "BTQ-"}S${pad(k, 4)}`;
}
const BASE = Date.UTC(2026, 8, 28);
const ts = (hour, minusDays = 0, minusHours = 0) => new Date(BASE + hour * 3600e3 - minusDays * 86400e3 - minusHours * 3600e3).toISOString().replace("T", " ").slice(0, 19);
const day = plusDays => new Date(BASE + plusDays * 86400e3).toISOString().slice(0, 10);

// ── Tables ──────────────────────────────────────────────────────────────────
function supplierBase(z, i) {
  const name = i <= STORY_SUPPLIERS.length ? STORY_SUPPLIERS[i - 1][0] : `Fournisseur ${pad(i, 5)}`;
  const country = i <= STORY_SUPPLIERS.length ? STORY_SUPPLIERS[i - 1][1] : ["FR", "FR", "IT", "ES", "PT", "DE", "CN", "IN"][i % 8];
  return {
    Supplier: lifnr(i), SupplierName: name, Country: country,
    TaxNumber1: country === "FR" ? siren(i) + pad((i % 97) + 1, 5) : null,
    VATRegistration: country === "FR" ? vatfr(i) : ["IT", "ES", "PT", "DE", "SE"].includes(country) ? country + pad((i * 7717) % 99999999999, 11) : null,
    DUNS: ["CN", "IN"].includes(country) ? pad(150000000 + i * 13, 9) : null,
    LegacySupplierId: i <= STORY_SUPPLIERS.length ? `SUP-${pad(i, 3)}` : null,
    LastChangeDateTime: ts(6, i % 90),
  };
}
export function supplier(z, pos) {
  if (pos < z.suppliers) return supplierBase(z, pos + 1);
  const d = pos - z.suppliers + 1, b = supplierBase(z, 2 + (d - 1) * z.dupSupplierEvery);
  const t = b.TaxNumber1;
  return {
    Supplier: lifnr(z.suppliers + d), SupplierName: `${b.SupplierName.toUpperCase()} SAS`, Country: b.Country,
    TaxNumber1: t ? `${t.slice(0, 3)} ${t.slice(3, 6)} ${t.slice(6, 9)} ${t.slice(9)}` : null,
    VATRegistration: b.VATRegistration ? `${b.VATRegistration.slice(0, 2)} ${b.VATRegistration.slice(2)}` : null,
    DUNS: b.DUNS, LegacySupplierId: null, LastChangeDateTime: ts(5),
  };
}
const supOfProduct = (z, i) => (i <= NS ? STORY_SKUS[i - 1][1] : 1 + (h32(i * 31) % z.suppliers));
const productRef = i => (i <= NS ? STORY_SKUS[i - 1][0] : `ML-${pad(i, 7)}`);
export const productEan = i => ean13(`376${pad(i, 9)}`);
export function product(z, pos) {
  const i = pos + 1, sup = supOfProduct(z, i), s = supplierBase(z, sup);
  const v = s.VATRegistration;
  return {
    productId: `PIM-${pad(i, 7)}`, internalRef: productRef(i),
    ean: i > NS && i % z.dupEanEvery === 0 ? productEan(i - 1) : productEan(i),
    name: i <= NS ? productRef(i).replace(/-/g, " ") : `Article ${i}`,
    category: ["Maroquinerie", "Accessoires", "Emballage", "Textile", "Composants"][i % 5],
    supplierTaxId: i > NS && i % z.orphanProductEvery === 0 ? `FR99${pad(i, 9)}`
      : v && s.Country === "FR" ? `${v.slice(0, 2).toLowerCase()} ${v.slice(2, 4)} ${v.slice(4)}`
      : v ? v : `${s.DUNS.slice(0, 2)}-${s.DUNS.slice(2, 5)}-${s.DUNS.slice(5)}`,
    supplierName: s.SupplierName,
    supplierCountry: sup === 3 ? "HK" : sup % 23 === 0 ? (s.Country === "FR" ? "BE" : "FR") : s.Country,
    listPrice: round2(5 + u(i, 11) * 395),
    updatedAt: ts(4, i % 60),
  };
}
export function facility(z, k) {
  const c = siteCode(k);
  return { FacilityId: c.replace(/-/g, ""), SiteCode: c, FacilityType: c.startsWith("WH-") ? "DC" : c.startsWith("FAC-") ? "PLANT" : "STORE" };
}
export function stock(z, r) {
  const pid = 1 + Math.floor(r / z.sitesPerProduct), spp = z.sitesPerProduct;
  const step = Math.max(1, Math.floor(z.sites / spp));
  const ean = product(z, pid - 1).ean;
  return {
    ItemId: r % z.orphanStockEvery === z.orphanStockEvery - 1 ? `0${ean13(`399${pad(r, 9)}`)}` : `0${ean}`,
    FacilityId: r % z.badFacilityEvery === z.badFacilityEvery - 1 ? "WHXXX" : siteCode(((pid * 131) + (r % spp) * step) % z.sites).replace(/-/g, ""),
    OnHand: Math.max(0, 90 + int(u(r, 21) * 600) - (pid <= NS && r % spp === 0 ? 700 : 0)),
    Allocated: int(u(r, 22) * 60),
    SafetyStock: 30 + int(u(pid, 23) * 50),
    UpdatedTimestamp: ts(7, 0, r % 48),
  };
}
function poSupplier(z, n) { return n <= 40 ? [1, 1, 1, 3, 3, 2, 1, 5, 6, 1][n % 10] : 1 + (h32(n * 17) % z.suppliers); }
function poMaterialIndex(z, n) { return n <= 40 ? 1 + (n % NS) : NS + 1 + (h32((4500000000 + n) * 29) % (z.products - NS)); }
export function purchaseOrder(z, pos) {
  const n = pos + 1;
  return {
    PurchaseOrder: String(4500000000 + n), PurchaseOrderItem: "00010", Supplier: lifnr(poSupplier(z, n)),
    Material: productRef(poMaterialIndex(z, n)), OrderQuantity: int(50 + u(n, 31) * 5000), DocumentCurrency: "EUR",
    ScheduleLineDeliveryDate: day(20 - (n % 60)), LastChangeDateTime: ts(3, n % 45),
  };
}
export function shipment(z, pos) {
  const n = pos + 1, po = purchaseOrder(z, pos), sup = poSupplier(z, n), s = supplierBase(z, sup);
  const expected = po.ScheduleLineDeliveryDate;
  const lateP = sup === 1 || sup === 3 ? z.lateSupplierBias : 0.12;
  const delay = u(n, 41) < lateP ? int(3 + u(n, 42) * 12) : 0;
  return {
    ShipmentId: `SHP-${pad(n, 8)}`, PurchaseOrderRef: `PO-${po.PurchaseOrder}`,
    ItemId: `0${product(z, poMaterialIndex(z, n) - 1).ean}`,
    OriginName: n % 97 === 0 ? `${s.SupplierName.toUpperCase()} Ltd` : s.SupplierName,
    DestinationFacility: siteCode(n % z.sites).replace(/-/g, ""),
    ExpectedDate: expected,
    ActualDate: expected > AS_OF ? null : day(20 - (n % 60) + delay),
    Quantity: po.OrderQuantity, UpdatedTimestamp: ts(8, n % 30),
  };
}
export function orderLine(z, pos) {
  const n = pos + 1;
  const ref = n % 4 === 0 ? STORY_SKUS[n % NS][0] : `ML-${pad(NS + 1 + (h32(n * 5) % (z.products - NS)), 7)}`;
  return {
    OrderLineId: `OL-${pad(n, 9)}`, OrderId: `SO-${pad(Math.floor(n / 3), 9)}`, CustomerId: `C${pad(1 + (h32(n * 3) % z.customers), 8)}`,
    ProductRef: n % 50 === 0 ? ref.toLowerCase() : ref, Quantity: 1 + int(u(n, 51) * 3), Channel: ["WEB", "STORE", "MARKETPLACE"][n % 3],
    FulfillmentSite: siteCode((n * 7) % z.sites), OrderDate: day(-(n % 90)),
    Status: u(n, 52) < 0.08 ? "BACKORDERED" : n % 90 < 3 ? "OPEN" : "SHIPPED", UpdatedAt: ts(9, n % 90),
  };
}
export function sale(z, pos) {
  const n = pos + 1;
  const idx = n % 3 === 0 ? 1 + (n % NS) : 1 + (h32(n * 7) % z.products);
  return {
    SaleDate: day(-(n % 365)), Ean: productEan(idx),
    StoreCode: siteCode(6 + (n % Math.max(1, z.sites - 6))).replace(/-/g, "_").toLowerCase(),
    Quantity: 1 + int(u(n, 61) * 2), NetAmount: round2(20 + u(n, 62) * 480), TicketId: `T${pad(Math.floor(n / 2), 10)}`,
  };
}

export const TABLES = {
  sap_suppliers: { count: z => z.suppliers + Math.floor(z.suppliers / z.dupSupplierEvery), row: supplier, watermark: "LastChangeDateTime" },
  sap_purchase_orders: { count: z => z.shipments, row: purchaseOrder, watermark: "LastChangeDateTime" },
  pim_products: { count: z => z.products, row: product, watermark: "updatedAt" },
  wms_facilities: { count: z => z.sites, row: facility },
  wms_stock: { count: z => z.stockProducts * z.sitesPerProduct, row: stock, watermark: "UpdatedTimestamp" },
  wms_shipments: { count: z => z.shipments, row: shipment, watermark: "UpdatedTimestamp" },
  oms_order_lines: { count: z => z.omsLines, row: orderLine, watermark: "UpdatedAt" },
  lake_sales: { count: z => z.salesLines, row: sale, watermark: "SaleDate" },
};

/** Page d'une table à la volée : rangs [offset, offset + limit). Aucun stockage. */
export function page(table, size, offset, limit) {
  const z = SIZES[size], t = TABLES[table];
  if (!z || !t) throw new Error(`Table ou taille inconnue : ${table}/${size}`);
  const total = t.count(z), end = Math.min(total, offset + limit), rows = [];
  for (let i = offset; i < end; i++) rows.push(t.row(z, i));
  return { rows, total, nextOffset: end < total ? end : null };
}

// npm run generate:demo  → data/multisource-demo.json (versionné, servi en ligne)
// npm run generate:scale → Parquet dans /tmp/maison-lucie-scale (jamais dans git)
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { generationSql, GROUND_TRUTH_SQL, TABLES, SIZES, AS_OF } from "./multisource-sql.mjs";
import { TABLES as GEN } from "../lib/multisource-gen.js";

const size = process.argv[2] || "demo";
if (size === "demo") {
  // Taille démo : générateur JavaScript (le même que les API à la volée), sans DuckDB.
  const z = SIZES.demo, tables = {}, counts = {};
  for (const t of Object.keys(GEN)) { tables[t] = Array.from({ length: GEN[t].count(z) }, (_, i) => GEN[t].row(z, i)); counts[t] = tables[t].length; }
  const T = tables, sup = new Map(T.sap_suppliers.map(s => [s.SupplierName, s]));
  const eanCount = new Map(); for (const p of T.pim_products) eanCount.set(p.ean, (eanCount.get(p.ean) ?? 0) + 1);
  const groundTruth = {
    duplicateSuppliers: T.sap_suppliers.filter(s => !s.LegacySupplierId && / SAS$/.test(s.SupplierName) && s.SupplierName === s.SupplierName.toUpperCase()).length,
    orphanProducts: T.pim_products.filter(p => p.supplierTaxId.startsWith("FR99")).length,
    duplicateEans: [...eanCount.values()].filter(n => n > 1).length,
    orphanStockItems: T.wms_stock.filter(s => s.ItemId.startsWith("0399")).length,
    unknownFacilities: T.wms_stock.filter(s => s.FacilityId === "WHXXX").length,
    lowercaseOmsRefs: T.oms_order_lines.filter(o => o.ProductRef !== o.ProductRef.toUpperCase()).length,
    stockouts: T.wms_stock.filter(s => s.OnHand - s.Allocated < s.SafetyStock).length,
    variantOriginNames: new Set(T.tms_shipments.filter(s => / Ltd$/.test(s.OriginName)).map(s => s.OriginName)).size,
    countryDivergentSuppliers: new Set(T.pim_products.filter(p => !p.supplierTaxId.startsWith("FR99") && sup.get(p.supplierName) && sup.get(p.supplierName).Country !== p.supplierCountry).map(p => p.supplierName)).size,
    unknownApsMaterials: T.aps_forecasts.filter(f => /^ML-9/.test(f.Material)).length,
    expiredCertifications: T.srm_suppliers.filter(x => x.CertificationExpiry < AS_OF).length,
    unknownQmsEans: T.qms_nonconformities.filter(x => x.Ean.startsWith("399")).length,
    lateShipments: T.tms_shipments.filter(s => (s.ActualDate ?? "") > s.ExpectedDate || (!s.ActualDate && s.ExpectedDate < AS_OF)).length,
  };
  mkdirSync("data", { recursive: true });
  writeFileSync("data/multisource-demo.json", JSON.stringify({ asOf: AS_OF, size, counts, groundTruth, tables }));
  console.log(JSON.stringify({ counts, groundTruth }, null, 1));
  process.exit(0);
}
const { DuckDBInstance } = await import("@duckdb/node-api");
const out = process.env.SCALE_DIR || "/tmp/maison-lucie-scale";
if (size === "scale" && process.env.SALES_LINES) SIZES.scale.salesLines = Number(process.env.SALES_LINES);
if (size === "scale" && process.env.OMS_LINES) SIZES.scale.omsLines = Number(process.env.OMS_LINES);

const db = await DuckDBInstance.create(":memory:", { threads: "4", memory_limit: "10GB", preserve_insertion_order: "false" });
const con = await db.connect();
const t0 = Date.now();
for (const sql of generationSql(size)) {
  const t = Date.now();
  await con.run(sql);
  const name = sql.match(/TABLE (\w+)/)?.[1];
  if (name && size === "scale") console.log(`  ${name.padEnd(22)} ${((Date.now() - t) / 1000).toFixed(1)} s`);
}
const counts = {};
for (const t of TABLES) counts[t] = Number((await (await con.runAndReadAll(`SELECT count(*) FROM ${t}`)).getRows())[0][0]);
const truth = {};
for (const [k, sql] of Object.entries(GROUND_TRUTH_SQL)) truth[k] = Number((await (await con.runAndReadAll(sql)).getRows())[0][0]);

{
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const t of TABLES) {
    const t1 = Date.now();
    const partition = t === "lake_sales" ? `, PARTITION_BY (month)` : "";
    const select = t === "lake_sales" ? `SELECT *, strftime(SaleDate, '%Y-%m') AS month FROM ${t}` : `SELECT * FROM ${t}`;
    await con.run(`COPY (${select}) TO '${out}/${t}${partition ? "" : ".parquet"}' (FORMAT parquet, COMPRESSION zstd${partition})`);
    console.log(`  écrit ${t.padEnd(22)} ${counts[t].toLocaleString("fr-FR").padStart(12)} lignes  ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  }
  // Applications générées en JavaScript seulement (APS, SRM, QMS) : NDJSON puis Parquet.
  const { appendFileSync } = await import("node:fs");
  for (const [t, def] of Object.entries(GEN).filter(([, d]) => d.jsOnly)) {
    const t1 = Date.now(), z = SIZES.scale, n = def.count(z), tmp = `${out}/${t}.ndjson`;
    writeFileSync(tmp, "");
    for (let i = 0; i < n; i += 100_000) appendFileSync(tmp, Array.from({ length: Math.min(100_000, n - i) }, (_, k) => JSON.stringify(def.row(z, i + k))).join("\n") + "\n");
    await con.run(`COPY (SELECT * FROM read_json_auto('${tmp}')) TO '${out}/${t}.parquet' (FORMAT parquet, COMPRESSION zstd)`);
    rmSync(tmp); counts[t] = n;
    console.log(`  écrit ${t.padEnd(22)} ${n.toLocaleString("fr-FR").padStart(12)} lignes  ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  }
  writeFileSync(`${out}/manifest.json`, JSON.stringify({ asOf: AS_OF, size, counts, groundTruth: truth, seconds: (Date.now() - t0) / 1000 }, null, 1));
  console.log(JSON.stringify({ counts, groundTruth: truth, seconds: (Date.now() - t0) / 1000 }, null, 1));
}

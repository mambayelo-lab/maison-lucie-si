// Le générateur JavaScript (API à la volée) et le générateur SQL (Parquet) donnent les mêmes lignes.
import assert from "node:assert/strict";
import { generationSql, TABLES as SQL_TABLES } from "./multisource-sql.mjs";
import { SIZES, TABLES } from "../lib/multisource-gen.js";

let DuckDBInstance;
try { ({ DuckDBInstance } = await import("@duckdb/node-api")); } catch { console.log("  (DuckDB absent : équivalence SQL non vérifiée)"); process.exit(0); }
const db = await DuckDBInstance.create(":memory:");
const con = await db.connect();
for (const sql of generationSql("demo")) await con.run(sql);
const z = SIZES.demo;
const canon = r => JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? Math.round(v * 100) / 100 : v])));
for (const t of SQL_TABLES) {
  const sqlRows = (await con.runAndReadAll(`SELECT * FROM ${t}`)).getRowObjectsJson().map(canon).sort();
  const def = TABLES[t];
  const jsRows = Array.from({ length: def.count(z) }, (_, i) => canon(def.row(z, i))).sort();
  assert.equal(jsRows.length, sqlRows.length, `${t} : nombre de lignes`);
  const diff = jsRows.findIndex((r, i) => r !== sqlRows[i]);
  assert.equal(diff, -1, `${t} : première différence\n JS  ${jsRows[diff]}\n SQL ${sqlRows[diff]}`);
  console.log(`  ok ${t} (${jsRows.length} lignes identiques)`);
}

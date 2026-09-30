// Fichiers Parquet du dépôt SFTP simulé (taille démo) : public/sftp/<source>/<ressource>.parquet.
// Générés une fois (DuckDB, développement uniquement) et servis en statique par le CDN :
// aucune fonction Vercel ne produit de Parquet. Types : BIGINT, DOUBLE, BOOLEAN, VARCHAR
// (dates et horodatages gardés en texte, identiques aux autres canaux).
import { mkdirSync, writeFileSync, statSync, rmSync } from "node:fs";
import { DuckDBInstance } from "@duckdb/node-api";
import { RESOURCES, allRows, columnsOf } from "../lib/channels.js";

const out = new URL("../public/sftp/", import.meta.url).pathname;
const tmp = `${out}.tmp.ndjson`;
const db = await (await DuckDBInstance.create(":memory:")).connect();
const sizes = {};
for (const def of RESOURCES) {
  mkdirSync(`${out}${def.source}`, { recursive: true });
  writeFileSync(tmp, allRows(def).map(r => JSON.stringify(r)).join("\n") + "\n");
  const cols = columnsOf(def).map(c => `'${c.name}': '${{ integer: "BIGINT", decimal: "DOUBLE", boolean: "BOOLEAN" }[c.type] ?? "VARCHAR"}'`).join(", ");
  const file = `${out}${def.source}/${def.resource}.parquet`;
  await db.run(`COPY (SELECT * FROM read_json('${tmp}', format='newline_delimited', columns={${cols}})) TO '${file}' (FORMAT parquet, COMPRESSION zstd)`);
  sizes[`${def.source}/${def.resource}`] = statSync(file).size;
}
rmSync(tmp);
writeFileSync(`${out}manifest.json`, JSON.stringify({ generatedBy: "scripts/generate-parquet-files.mjs", sizes }, null, 2) + "\n");
console.log(sizes);

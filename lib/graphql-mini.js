// Mini moteur GraphQL sans dépendance : parseur (sous-ensemble du langage :
// opérations query anonymes/nommées, variables, alias, arguments scalaires,
// listes/objets littéraux, fragments nommés et inline, __typename) +
// schéma typé dérivé des données de chaque application + introspection
// (__schema / __type) suffisante pour la découverte de métadonnées.
import { applications } from "./demo-data.js";
import { camel, pascal, plural, tableNames, tableRecords, applyFilter } from "./access.js";

// ── Lexer / parser ──────────────────────────────────────────────────────
class GraphQLSyntaxError extends Error {}

function tokenize(source) {
  const tokens = [];
  const re = /\s+|,|#[^\n]*|(\.\.\.)|([{}()[\]:!$=@|&])|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([_A-Za-z][_0-9A-Za-z]*)/gy;
  let match;
  while (re.lastIndex < source.length) {
    const start = re.lastIndex;
    match = re.exec(source);
    if (!match || re.lastIndex === start) throw new GraphQLSyntaxError(`Syntax Error: unexpected character "${source[start]}" at ${start}.`);
    if (match[1]) tokens.push({ kind: "spread", value: "..." });
    else if (match[2]) tokens.push({ kind: "punct", value: match[2] });
    else if (match[3]) tokens.push({ kind: "string", value: JSON.parse(match[3]) });
    else if (match[4]) tokens.push({ kind: "number", value: Number(match[4]) });
    else if (match[5]) tokens.push({ kind: "name", value: match[5] });
  }
  tokens.push({ kind: "eof" });
  return tokens;
}

export function parse(source) {
  const tokens = tokenize(String(source || ""));
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const is = (kind, value) => peek().kind === kind && (value === undefined || peek().value === value);
  const expect = (kind, value) => {
    if (!is(kind, value)) throw new GraphQLSyntaxError(`Syntax Error: expected ${value ?? kind}, found ${peek().value ?? peek().kind}.`);
    return next();
  };

  function parseValue() {
    const token = peek();
    if (is("punct", "$")) { next(); return { var: expect("name").value }; }
    if (is("punct", "[")) { next(); const list = []; while (!is("punct", "]")) list.push(parseValue()); next(); return { list }; }
    if (is("punct", "{")) { next(); const obj = {}; while (!is("punct", "}")) { const key = expect("name").value; expect("punct", ":"); obj[key] = parseValue(); } next(); return { obj }; }
    if (token.kind === "string" || token.kind === "number") { next(); return { const: token.value }; }
    if (token.kind === "name") { next(); if (token.value === "true") return { const: true }; if (token.value === "false") return { const: false }; if (token.value === "null") return { const: null }; return { const: token.value, enum: true }; }
    throw new GraphQLSyntaxError(`Syntax Error: unexpected ${token.value ?? token.kind}.`);
  }
  function parseArguments() {
    const args = {};
    if (!is("punct", "(")) return args;
    next();
    while (!is("punct", ")")) { const name = expect("name").value; expect("punct", ":"); args[name] = parseValue(); }
    next();
    return args;
  }
  function skipDirectives() { while (is("punct", "@")) { next(); expect("name"); parseArguments(); } }
  function parseSelectionSet() {
    expect("punct", "{");
    const selections = [];
    while (!is("punct", "}")) {
      if (is("spread")) {
        next();
        if (is("name", "on")) { next(); const typeCondition = expect("name").value; skipDirectives(); selections.push({ kind: "inline", typeCondition, selectionSet: parseSelectionSet() }); }
        else if (is("punct", "{")) selections.push({ kind: "inline", typeCondition: null, selectionSet: parseSelectionSet() });
        else { selections.push({ kind: "spread", name: expect("name").value }); skipDirectives(); }
        continue;
      }
      let name = expect("name").value;
      let alias = name;
      if (is("punct", ":")) { next(); name = expect("name").value; }
      const args = parseArguments();
      skipDirectives();
      const selectionSet = is("punct", "{") ? parseSelectionSet() : null;
      selections.push({ kind: "field", alias, name, args, selectionSet });
    }
    next();
    return selections;
  }
  function skipVariableDefinitions() {
    if (!is("punct", "(")) return {};
    next();
    const defaults = {};
    while (!is("punct", ")")) {
      expect("punct", "$"); const name = expect("name").value; expect("punct", ":");
      let depth = 0;
      while (!(depth === 0 && (is("punct", "$") || is("punct", ")") || is("punct", "=")))) { const t = next(); if (t.kind === "eof") throw new GraphQLSyntaxError("Syntax Error: unterminated variable definitions."); if (t.value === "[") depth++; if (t.value === "]") depth--; }
      if (is("punct", "=")) { next(); defaults[name] = parseValue(); }
    }
    next();
    return defaults;
  }

  const operations = [];
  const fragments = {};
  while (!is("eof")) {
    if (is("punct", "{")) { operations.push({ operation: "query", name: null, defaults: {}, selectionSet: parseSelectionSet() }); continue; }
    const keyword = expect("name").value;
    if (keyword === "fragment") {
      const name = expect("name").value; expect("name", "on"); const typeCondition = expect("name").value; skipDirectives();
      fragments[name] = { typeCondition, selectionSet: parseSelectionSet() };
      continue;
    }
    if (!["query", "mutation", "subscription"].includes(keyword)) throw new GraphQLSyntaxError(`Syntax Error: unexpected "${keyword}".`);
    const name = is("name") ? next().value : null;
    const defaults = skipVariableDefinitions();
    skipDirectives();
    operations.push({ operation: keyword, name, defaults, selectionSet: parseSelectionSet() });
  }
  return { operations, fragments };
}

// ── Schéma ──────────────────────────────────────────────────────────────
const ref = (kind, name, ofType = null) => ({ kind, name, ofType });
const named = (name, kind = "OBJECT") => ref(kind, name);
const listOf = type => ref("LIST", null, type);
const nonNull = type => ref("NON_NULL", null, type);
const SCALARS = ["String", "Int", "Float", "Boolean", "ID", "JSON"];
const arg = (name, type, description = null, defaultValue = null) => ({ name, description, type, defaultValue });
const field = (name, type, description = null, args = []) => ({ name, description, args, type, isDeprecated: false, deprecationReason: null });

function scalarOf(values) {
  const present = values.filter(v => v !== null && v !== undefined);
  if (!present.length) return "String";
  if (present.every(v => typeof v === "boolean")) return "Boolean";
  if (present.every(v => typeof v === "number")) return present.every(Number.isInteger) ? "Int" : "Float";
  if (present.every(v => typeof v === "string")) return "String";
  return "JSON";
}

/** Construit le schéma à partir des datasets (persistés) courants. */
export function buildSchema(datasets) {
  const types = {};
  const add = (name, kind, description, fields = null, extra = {}) => { types[name] = { kind, name, description, fields, inputFields: null, interfaces: kind === "OBJECT" ? [] : null, enumValues: null, possibleTypes: null, ...extra }; };
  for (const scalar of SCALARS) add(scalar, "SCALAR", scalar === "JSON" ? "Arbitrary JSON value (objects, arrays)." : `Built-in ${scalar} scalar.`);

  const tableTypes = {};
  const appFields = [];
  for (const app of applications) {
    const dataset = datasets[app.id];
    if (!dataset) continue;
    const appTypeName = `${pascal(app.id)}Application`;
    const appTypeFields = [
      field("application", nonNull(named("Application")), "Catalogue entry of this application."),
      field("entity", nonNull(named("String", "SCALAR")), "Name of the main table."),
      field("tables", nonNull(listOf(nonNull(named("String", "SCALAR")))), "Available tables."),
    ];
    for (const table of tableNames(dataset)) {
      const rows = tableRecords(dataset, table) || [];
      const columns = Array.from(new Set(rows.flatMap(row => Object.keys(row))));
      const typeName = types[table] ? `${pascal(app.id)}${table}` : table;
      const columnFields = columns.map(column => field(column, named(scalarOf(rows.map(row => row[column])), "SCALAR"), null));
      add(typeName, "OBJECT", `${table} records of ${app.name} (${app.id}). Synthetic data.`, columnFields);
      tableTypes[`${app.id}/${table}`] = typeName;
      const filterArgs = columnFields.filter(f => f.type.name !== "JSON").map(f => arg(f.name, named(f.type.name, "SCALAR"), `Equality filter on ${f.name}.`));
      const pageArgs = [arg("limit", named("Int", "SCALAR"), "Maximum number of records (default 100, max 500).", "100"), arg("offset", named("Int", "SCALAR"), "Records to skip.", "0")];
      appTypeFields.push(field(camel(plural(table.charAt(0).toLowerCase() + table.slice(1))), nonNull(listOf(nonNull(named(typeName)))), `${table} records.`, [...pageArgs, ...filterArgs]));
      appTypeFields.push(field(`${camel(table.charAt(0).toLowerCase() + table.slice(1))}Count`, nonNull(named("Int", "SCALAR")), `Number of ${table} records matching the filters.`, filterArgs));
    }
    add(appTypeName, "OBJECT", `${app.name} — ${app.role}. Requires this application's credentials (or the gateway token).`, appTypeFields);
    appFields.push(field(camel(app.id), named(appTypeName), `${app.name} (${app.marketReference}-inspired). Auth: ${app.auth?.type}.`));
  }

  add("Application", "OBJECT", "A Maison Lucie source application.", [
    field("id", nonNull(named("ID", "SCALAR"))), field("name", nonNull(named("String", "SCALAR"))), field("marketReference", named("String", "SCALAR")),
    field("role", named("String", "SCALAR")), field("protocol", named("String", "SCALAR")), field("baseUrl", named("String", "SCALAR")),
    field("authType", named("String", "SCALAR")), field("status", named("String", "SCALAR")), field("disclaimer", named("String", "SCALAR")),
    field("graphqlField", named("String", "SCALAR")), field("tables", listOf(named("String", "SCALAR"))),
    field("protocols", named("JSON", "SCALAR"), "Access contracts per protocol (rest, soap, graphql, events, file, batch)."),
  ]);
  add("Query", "OBJECT", "Maison Lucie synthetic SI — GraphQL entry point.", [
    field("applications", nonNull(listOf(nonNull(named("Application")))), "All applications (public metadata)."),
    field("application", named("Application"), "One application by id.", [arg("id", nonNull(named("ID", "SCALAR")))]),
    ...appFields,
  ]);

  // Types d'introspection (description minimale — suffisante pour les clients courants).
  const intro = (name, names, kind = "OBJECT") => add(name, kind, null, names.map(n => field(n, named("JSON", "SCALAR"))));
  intro("__Schema", ["description", "types", "queryType", "mutationType", "subscriptionType", "directives"]);
  intro("__Type", ["kind", "name", "description", "fields", "interfaces", "possibleTypes", "enumValues", "inputFields", "ofType", "specifiedByURL"]);
  intro("__Field", ["name", "description", "args", "type", "isDeprecated", "deprecationReason"]);
  intro("__InputValue", ["name", "description", "type", "defaultValue"]);

  return { types, tableTypes, queryType: "Query" };
}

export function printSchema(schema) {
  const printRef = type => type.kind === "NON_NULL" ? `${printRef(type.ofType)}!` : type.kind === "LIST" ? `[${printRef(type.ofType)}]` : type.name;
  const out = ["scalar JSON", ""];
  for (const type of Object.values(schema.types)) {
    if (type.kind !== "OBJECT" || type.name.startsWith("__")) continue;
    if (type.description) out.push(`"""${type.description}"""`);
    out.push(`type ${type.name} {`);
    for (const f of type.fields) {
      const args = f.args.length ? `(${f.args.map(a => `${a.name}: ${printRef(a.type)}${a.defaultValue !== null ? ` = ${a.defaultValue}` : ""}`).join(", ")})` : "";
      out.push(`  ${f.name}${args}: ${printRef(f.type)}`);
    }
    out.push("}", "");
  }
  return out.join("\n");
}

// ── Exécution ────────────────────────────────────────────────────────────
function unwrap(type) { return type.kind === "NON_NULL" || type.kind === "LIST" ? unwrap(type.ofType) : type.name; }

function valueOf(node, variables) {
  if (node.var !== undefined) return variables[node.var];
  if (node.list) return node.list.map(item => valueOf(item, variables));
  if (node.obj) return Object.fromEntries(Object.entries(node.obj).map(([k, v]) => [k, valueOf(v, variables)]));
  return node.const;
}

/**
 * @param {object} options { schema, datasets, query, variables, operationName, authorize(appId) => Promise<boolean>, publicApplication(app) }
 */
export async function execute({ schema, datasets, query, variables = {}, operationName, authorize, describeApplication }) {
  let document;
  try { document = parse(query); } catch (error) { return { errors: [{ message: error.message, extensions: { code: "GRAPHQL_PARSE_FAILED" } }] }; }
  const operation = operationName ? document.operations.find(op => op.name === operationName) : document.operations[0];
  if (!operation) return { errors: [{ message: operationName ? `Unknown operation "${operationName}".` : "No operation found.", extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }] };
  if (operation.operation !== "query") return { errors: [{ message: `${operation.operation} operations are not supported: the Maison Lucie GraphQL API is read-only.`, extensions: { code: "OPERATION_NOT_SUPPORTED" } }] };
  const vars = { ...Object.fromEntries(Object.entries(operation.defaults).map(([k, v]) => [k, valueOf(v, {})])), ...(variables || {}) };
  const errors = [];

  const collect = (selections, typeName) => {
    const fields = [];
    for (const selection of selections) {
      if (selection.kind === "field") fields.push(selection);
      else if (selection.kind === "inline") { if (!selection.typeCondition || selection.typeCondition === typeName) fields.push(...collect(selection.selectionSet, typeName)); }
      else {
        const fragment = document.fragments[selection.name];
        if (!fragment) throw new GraphQLSyntaxError(`Unknown fragment "${selection.name}".`);
        if (fragment.typeCondition === typeName) fields.push(...collect(fragment.selectionSet, typeName));
      }
    }
    return fields;
  };

  // Résolution générique d'objets JS (introspection, lignes de table, métadonnées).
  function completePlain(value, selectionSet, typeName, path) {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) return value.map((item, index) => completePlain(item, selectionSet, typeName, [...path, index]));
    if (!selectionSet) return value;
    const result = {};
    for (const node of collect(selectionSet, typeName)) {
      if (node.name === "__typename") { result[node.alias] = typeName; continue; }
      const typeDef = schema.types[typeName];
      const fieldDef = typeName.startsWith("__") ? null : typeDef?.fields?.find(f => f.name === node.name);
      if (typeDef && !typeName.startsWith("__") && !fieldDef) { errors.push({ message: `Cannot query field "${node.name}" on type "${typeName}".`, path: [...path, node.alias], extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }); result[node.alias] = null; continue; }
      let childType = fieldDef ? unwrap(fieldDef.type) : introspectionChildType(typeName, node.name);
      let raw = value[node.name];
      if (typeName === "__Type" && node.name === "fields" && Array.isArray(raw) && valueOf(node.args.includeDeprecated ?? { const: false }, vars) === false) raw = raw.filter(f => !f.isDeprecated);
      result[node.alias] = childType && schema.types[childType]?.kind === "SCALAR" ? (raw ?? null) : completePlain(raw ?? null, node.selectionSet, childType, [...path, node.alias]);
    }
    return result;
  }
  function introspectionChildType(parent, name) {
    const map = { __Schema: { types: "__Type", queryType: "__Type", mutationType: "__Type", subscriptionType: "__Type", directives: "JSON" }, __Type: { fields: "__Field", interfaces: "__Type", possibleTypes: "__Type", inputFields: "__InputValue", ofType: "__Type", enumValues: "JSON" }, __Field: { args: "__InputValue", type: "__Type" }, __InputValue: { type: "__Type" } };
    return map[parent]?.[name] ?? null;
  }
  const introspectionSchema = () => ({ description: "Maison Lucie synthetic SI", types: Object.values(schema.types), queryType: schema.types.Query, mutationType: null, subscriptionType: null, directives: [] });

  const data = {};
  for (const node of collect(operation.selectionSet, "Query")) {
    const path = [node.alias];
    try {
      if (node.name === "__typename") { data[node.alias] = "Query"; continue; }
      if (node.name === "__schema") { data[node.alias] = completePlain(introspectionSchema(), node.selectionSet, "__Schema", path); continue; }
      if (node.name === "__type") { const name = valueOf(node.args.name ?? { const: null }, vars); data[node.alias] = completePlain(schema.types[name] ?? null, node.selectionSet, "__Type", path); continue; }
      if (node.name === "applications") { data[node.alias] = completePlain(applications.map(describeApplication), node.selectionSet, "Application", path); continue; }
      if (node.name === "application") { const id = valueOf(node.args.id ?? { const: null }, vars); const app = applications.find(a => a.id === id); data[node.alias] = completePlain(app ? describeApplication(app) : null, node.selectionSet, "Application", path); continue; }
      const app = applications.find(a => camel(a.id) === node.name);
      if (!app) { errors.push({ message: `Cannot query field "${node.name}" on type "Query".`, path, extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }); data[node.alias] = null; continue; }
      if (!(await authorize(app.id))) { errors.push({ message: `Missing or invalid demonstration credentials for application "${app.id}".`, path, extensions: { code: "UNAUTHORIZED", appId: app.id } }); data[node.alias] = null; continue; }
      data[node.alias] = resolveApplication(app, datasets[app.id], node, path);
    } catch (error) {
      errors.push({ message: error.message, path });
      data[node.alias] = null;
    }
  }

  function resolveApplication(app, dataset, node, path) {
    const typeName = `${pascal(app.id)}Application`;
    const typeDef = schema.types[typeName];
    const result = {};
    for (const child of collect(node.selectionSet || [], typeName)) {
      const childPath = [...path, child.alias];
      if (child.name === "__typename") { result[child.alias] = typeName; continue; }
      if (child.name === "application") { result[child.alias] = completePlain(describeApplication(app), child.selectionSet, "Application", childPath); continue; }
      if (child.name === "entity") { result[child.alias] = dataset.entity; continue; }
      if (child.name === "tables") { result[child.alias] = tableNames(dataset); continue; }
      const fieldDef = typeDef.fields.find(f => f.name === child.name);
      if (!fieldDef) { errors.push({ message: `Cannot query field "${child.name}" on type "${typeName}".`, path: childPath, extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }); result[child.alias] = null; continue; }
      const table = tableNames(dataset).find(t => fieldDef.name === camel(plural(t.charAt(0).toLowerCase() + t.slice(1))) || fieldDef.name === `${camel(t.charAt(0).toLowerCase() + t.slice(1))}Count`);
      const args = Object.fromEntries(Object.entries(child.args).map(([k, v]) => [k, valueOf(v, vars)]));
      const unknown = Object.keys(args).find(name => !fieldDef.args.some(a => a.name === name));
      if (unknown) { errors.push({ message: `Unknown argument "${unknown}" on field "${typeName}.${child.name}".`, path: childPath, extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }); result[child.alias] = null; continue; }
      const { limit = 100, offset = 0, ...filter } = args;
      const rows = applyFilter(tableRecords(dataset, table) || [], filter);
      if (fieldDef.name.endsWith("Count") && unwrap(fieldDef.type) === "Int") { result[child.alias] = rows.length; continue; }
      const page = rows.slice(Math.max(0, Number(offset) || 0), Math.max(0, Number(offset) || 0) + Math.min(500, Math.max(0, Number(limit) || 0)));
      result[child.alias] = completePlain(page, child.selectionSet, unwrap(fieldDef.type), childPath);
    }
    return result;
  }

  return errors.length ? { data, errors } : { data };
}

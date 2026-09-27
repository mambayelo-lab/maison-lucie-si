import { beginRequest, authenticateApplication, authorizeApplication, requestHeader, sendError, unauthorized } from "../lib/http-api.js";
import { readAllDatasets } from "../lib/persistence.js";
import { APP_IDS, applyFilter, plural, tableNames, tableRecords } from "../lib/access.js";
import { applications } from "../lib/demo-data.js";

// SOAP 1.1 multi-application.
// - ?wsdl[&app=<id>] : WSDL (toutes les applications ou une seule).
// - POST ?app=<id> : opérations Get<Table(s)> (ex. GetShipments, GetSuppliers) et GetRecords(<table>,<limit>,<offset>).
//   L'application peut aussi être déduite de l'opération (noms de tables uniques).
// Rétrocompatibilité : POST sans app/opération → GetPurchaseOrders (legacy-soap, Basic + X-Lucie-Tenant) au format historique.

const NS = "https://maison-lucie-si.vercel.app/soap";
const xmlEscape = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const xmlName = name => String(name).replace(/[^A-Za-z0-9_.-]/g, "_").replace(/^([^A-Za-z_])/, "_$1");

function recordXml(entity, record) {
  const children = Object.entries(record).map(([key, value]) => {
    const tag = xmlName(key);
    if (value === null || value === undefined) return `<${tag} xsi:nil="true"/>`;
    if (Array.isArray(value)) return `<${tag}>${value.map(item => `<item>${xmlEscape(typeof item === "object" ? JSON.stringify(item) : item)}</item>`).join("")}</${tag}>`;
    if (typeof value === "object") return `<${tag}>${xmlEscape(JSON.stringify(value))}</${tag}>`;
    return `<${tag}>${xmlEscape(value)}</${tag}>`;
  }).join("");
  return `<${xmlName(entity)}>${children}</${xmlName(entity)}>`;
}

const envelope = inner => `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soap:Body>${inner}</soap:Body></soap:Envelope>`;

function fault(response, status, code, message) {
  response.setHeader("Content-Type", "text/xml; charset=utf-8");
  return response.status(status).send(envelope(`<soap:Fault><faultcode>soap:${code}</faultcode><faultstring>${xmlEscape(message)}</faultstring></soap:Fault>`));
}

// Opération → { appId, table }
function operationIndex(datasets) {
  const index = {};
  for (const appId of APP_IDS) {
    for (const table of tableNames(datasets[appId])) {
      index[`Get${plural(table)}`] ??= { appId, table };
      index[`Get${table}`] ??= { appId, table };
    }
  }
  return index;
}

function wsdl(datasets, onlyApp) {
  const index = operationIndex(datasets);
  const operations = Object.entries(index).filter(([name, target]) => (!onlyApp || target.appId === onlyApp) && name === `Get${plural(target.table)}`);
  const all = [...operations.map(([name]) => name), "GetRecords"];
  const elements = all.map(name => `<xsd:element name="${name}"><xsd:complexType><xsd:sequence><xsd:element name="table" type="xsd:string" minOccurs="0"/><xsd:element name="limit" type="xsd:int" minOccurs="0"/><xsd:element name="offset" type="xsd:int" minOccurs="0"/><xsd:any minOccurs="0" maxOccurs="unbounded" processContents="lax"/></xsd:sequence></xsd:complexType></xsd:element><xsd:element name="${name}Response"><xsd:complexType><xsd:sequence><xsd:any minOccurs="0" maxOccurs="unbounded" processContents="lax"/></xsd:sequence></xsd:complexType></xsd:element>`).join("");
  const messages = all.map(name => `<message name="${name}Request"><part name="parameters" element="tns:${name}"/></message><message name="${name}Response"><part name="parameters" element="tns:${name}Response"/></message>`).join("");
  const portOps = all.map(name => `<operation name="${name}"><input message="tns:${name}Request"/><output message="tns:${name}Response"/></operation>`).join("");
  const bindingOps = all.map(name => `<operation name="${name}"><soap:operation soapAction="${NS}/${name}"/><input><soap:body use="literal"/></input><output><soap:body use="literal"/></output></operation>`).join("");
  const location = onlyApp ? `/api/soap?app=${onlyApp}` : "/api/soap";
  const app = applications.find(a => a.id === onlyApp);
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions name="LucieSI" targetNamespace="${NS}" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:tns="${NS}" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <documentation>Maison Lucie synthetic SI${app ? ` — ${xmlEscape(app.name)} (${app.id})` : ""}. Synthetic demonstration data. Auth: same credentials as the REST API of the target application (or gateway Bearer token).</documentation>
  <types><xsd:schema targetNamespace="${NS}" elementFormDefault="qualified">${elements}</xsd:schema></types>
  ${messages}
  <portType name="LucieSIPortType">${portOps}</portType>
  <binding name="LucieSISoapBinding" type="tns:LucieSIPortType"><soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>${bindingOps}</binding>
  <service name="LucieSI"><port name="LucieSIPort" binding="tns:LucieSISoapBinding"><soap:address location="${location}"/></port></service>
</definitions>`;
}

function readTag(payload, tag) {
  const match = new RegExp(`<(?:\\w+:)?${tag}>([^<]*)</(?:\\w+:)?${tag}>`).exec(payload);
  return match ? match[1].trim() : undefined;
}

export default async function handler(request, response) {
  const ctx = beginRequest(request, response, ["GET", "POST"]);
  if (!ctx.ok) return;
  const url = new URL(request.url || "/api/soap", "https://maison-lucie-si.vercel.app");
  const params = { ...Object.fromEntries(url.searchParams), ...(request.query || {}) };
  const datasets = await readAllDatasets();
  const requestedApp = params.app ? String(params.app) : "";
  if (requestedApp && !APP_IDS.includes(requestedApp)) return fault(response, 404, "Client", `Unknown application "${requestedApp}".`);

  if (request.method === "GET") {
    if (params.wsdl === undefined && !url.searchParams.has("wsdl")) return fault(response, 400, "Client", "Use GET ?wsdl for discovery or POST a SOAP 1.1 envelope.");
    response.setHeader("Content-Type", "text/xml; charset=utf-8");
    return response.status(200).send(wsdl(datasets, requestedApp || null));
  }

  const payload = typeof request.body === "string" ? request.body : Buffer.isBuffer(request.body) ? request.body.toString("utf8") : "";
  const soapAction = String(requestHeader(request, "soapaction") || "").replace(/"/g, "").split("/").pop();
  const bodyOp = /<(?:\w+:)?Body[^>]*>\s*<(?:\w+:)?(Get\w+)/.exec(payload)?.[1] || /<(?:\w+:)?(Get\w+)[\s/>]/.exec(payload)?.[1];
  const operation = bodyOp || (soapAction.startsWith("Get") ? soapAction : "") || params.operation || (requestedApp && requestedApp !== "legacy-soap" ? "GetRecords" : "GetPurchaseOrders");
  if (payload && !bodyOp && !/<(?:\w+:)?Envelope/.test(payload)) return fault(response, 400, "Client", "Body must be a SOAP 1.1 envelope or a Get* operation element.");

  const index = operationIndex(datasets);
  let target;
  if (operation === "GetRecords") {
    const appId = requestedApp || "sap-s4";
    const tableParam = readTag(payload, "table") || params.table;
    const table = tableNames(datasets[appId]).find(name => !tableParam || name.toLowerCase() === String(tableParam).toLowerCase());
    if (!table) return fault(response, 404, "Client", `Unknown table "${tableParam}" for ${appId}.`);
    target = { appId, table };
  } else {
    target = index[operation];
    if (!target) return fault(response, 400, "Client", `Operation ${operation} is not supported. See /api/soap?wsdl.`);
    if (requestedApp && requestedApp !== "legacy-soap" && target.appId !== requestedApp) return fault(response, 400, "Client", `Operation ${operation} belongs to ${target.appId}, not ${requestedApp}.`);
  }

  // Auth : legacy-soap (historique, pour les commandes d'achat) OU identifiants de l'application cible OU passerelle.
  const legacy = target.appId === "sap-s4" && (await authenticateApplication(request, "legacy-soap"));
  if (!legacy && !(await authorizeApplication(request, target.appId))) return unauthorized(response, ctx.requestId, target.appId === "sap-s4" ? "Basic" : "Bearer");

  const limit = Math.min(500, Math.max(1, Number.parseInt(readTag(payload, "limit") ?? params.limit ?? "500", 10) || 500));
  const offset = Math.max(0, Number.parseInt(readTag(payload, "offset") ?? params.offset ?? "0", 10) || 0);
  const filterField = readTag(payload, "filterField") || params.filterField;
  const filterValue = readTag(payload, "filterValue") ?? params.filterValue;
  const rows = applyFilter(tableRecords(datasets[target.appId], target.table) || [], filterField ? { [filterField]: filterValue } : {});
  const page = rows.slice(offset, offset + limit);
  const records = page.map(record => recordXml(target.table, record)).join("");
  const wrapper = target.table === "PurchaseOrder" && operation !== "GetRecords" ? "orders" : "records";
  const responseName = `${operation}Response`;
  response.setHeader("Content-Type", "text/xml; charset=utf-8");
  response.setHeader("X-Record-Count", String(page.length));
  return response.status(200).send(envelope(`<${responseName} xmlns="${NS}" application="${target.appId}" table="${target.table}" total="${rows.length}" synthetic="true"><${wrapper}>${records}</${wrapper}></${responseName}>`));
}

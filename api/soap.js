import { beginRequest, authenticateApplication, sendError, unauthorized } from "../lib/http-api.js";
import { readDataset } from "../lib/persistence.js";

const WSDL = `<?xml version="1.0" encoding="UTF-8"?>
<definitions name="LumenLegacyERP" targetNamespace="https://maison-lumen-si.vercel.app/soap" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="https://maison-lumen-si.vercel.app/soap">
  <service name="LumenLegacyERP"><port name="LumenLegacyERPPort" binding="tns:LumenLegacyERPSoapBinding"><soap:address location="/api/soap"/></port></service>
</definitions>`;

function xmlEscape(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

export default async function handler(request, response) {
  const ctx = beginRequest(request, response, ["GET", "POST"]);
  if (!ctx.ok) return;
  const url = new URL(request.url || "/api/soap", "https://maison-lumen-si.vercel.app");
  if (request.method === "GET" && url.searchParams.has("wsdl")) { response.setHeader("Content-Type", "text/xml; charset=utf-8"); return response.status(200).send(WSDL); }
  if (!(await authenticateApplication(request, "legacy-soap"))) return unauthorized(response, ctx.requestId, "Basic");
  const payload = typeof request.body === "string" ? request.body : "";
  if (payload && !/GetPurchaseOrders|PurchaseOrder/i.test(payload)) return sendError(response, 400, "SOAP_ACTION_NOT_SUPPORTED", "Use GetPurchaseOrders.", ctx.requestId);
  const dataset = await readDataset("sap-s4");
  const orders = Array.isArray(dataset?.records) ? dataset.records : [];
  const body = orders.map(order => `<PurchaseOrder><purchaseOrderId>${xmlEscape(order.purchaseOrderId)}</purchaseOrderId><supplierId>${xmlEscape(order.supplierId)}</supplierId><sku>${xmlEscape(order.sku)}</sku><quantity>${xmlEscape(order.quantity)}</quantity><status>${xmlEscape(order.status)}</status></PurchaseOrder>`).join("");
  response.setHeader("Content-Type", "text/xml; charset=utf-8");
  return response.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetPurchaseOrdersResponse xmlns="https://maison-lumen-si.vercel.app/soap"><orders>${body}</orders></GetPurchaseOrdersResponse></soap:Body></soap:Envelope>`);
}

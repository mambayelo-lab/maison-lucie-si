import { resilienceAlerts, generatedAt } from "../lib/demo-data.js";
import { readAllDatasets } from "../lib/persistence.js";
import { authenticateGateway, beginRequest, unauthorized } from "../lib/http-api.js";

export default async function handler(request, response) {
  const gate = beginRequest(request, response, ["GET"]);
  if (!gate.ok) return;
  if (!authenticateGateway(request)) return unauthorized(response, gate.requestId);
  const all = await readAllDatasets();
  const alerts = resilienceAlerts().map(alert => {
    if (alert.id === "ALT-001") {
      const row = all["coupa-risk"]?.records?.find(item => item.supplierId === "SUP-001");
      const risk = Number(row?.capacityRisk ?? 88);
      return { ...alert, exposureEur: Math.round(1840000 * risk / 88), severity: risk >= 80 ? "CRITICAL" : risk >= 60 ? "MAJOR" : "MINOR" };
    }
    if (alert.id === "ALT-002") {
      const row = all["blueyonder-tms"]?.records?.find(item => item.shipmentId === "SHP-883");
      const delay = Number(row?.delayHours ?? 72);
      return { ...alert, exposureEur: Math.round(920000 * Math.max(0, delay) / 72), severity: delay >= 72 ? "CRITICAL" : delay >= 24 ? "MAJOR" : "MINOR" };
    }
    if (alert.id !== "ALT-003") return alert;
    const row = all["manhattan-wms"]?.records?.find(item => item.sku === "BOX-PREMIUM");
    const available = Number(row?.available ?? 290);
    const safety = Number(row?.safetyStock ?? 600);
    return { ...alert, exposureEur: Math.round(410000 * Math.max(0, safety - available) / 310), severity: available < safety ? "MAJOR" : "MINOR" };
  });
  response.status(200).json({
    generatedAt: generatedAt(),
    synthetic: true,
    alerts: alerts.map(alert => ({ ...alert, evidence: alert.evidence.map(sourceId => ({ sourceId, href: `/api/data/${sourceId}` })) })),
    lineage: { ruleSet: "lucie-resilience-v1", requestId: gate.requestId },
  });
}

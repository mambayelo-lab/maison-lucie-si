import { API_VERSION, beginRequest } from "../lib/http-api.js";
import { persistenceMode } from "../lib/persistence.js";

export default function handler(request, response) {
  const gate = beginRequest(request, response, ["GET"]);
  if (!gate.ok) return;
  response.status(200).json({ status: "ok", service: "maison-lucie-si", version: API_VERSION, persistence: persistenceMode, time: new Date().toISOString() });
}

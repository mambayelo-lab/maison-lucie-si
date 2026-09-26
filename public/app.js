const state = { applications: [], configs: {}, active: null, tmsToken: null };
const ADMIN_TOKEN_KEY = "lumen-admin-token";
const clean = value => String(value ?? "—");
const money = value => new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);

async function getJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${payload.error?.code || url}`);
  return payload;
}

function activeConfig(id) {
  return state.configs[id] || state.applications.find(app => app.id === id)?.config || {};
}

async function sourceHeaders(id) {
  const auth = activeConfig(id).auth || {};
  if (id === "sap-s4" || id === "legacy-soap") return { Authorization: `Basic ${btoa(`${auth.username || ""}:${auth.password || ""}`)}`, "X-Lumen-Tenant": auth.tenant || "" };
  if (id === "manhattan-wms") return { "X-API-Key": auth.apiKey || "" };
  if (id === "coupa-risk") return { Authorization: `Bearer ${auth.token || ""}` };
  if (id === "snowflake-demand") return { Authorization: `Bearer ${auth.privateKey || auth.token || ""}`, "X-Lumen-Account": auth.account || "", "X-Lumen-Warehouse": auth.warehouse || "", "X-Lumen-Role": auth.role || "" };
  if (id === "mulesoft-events" || id === "kafka-stream" || id === "webhook-gateway") return { "X-Client-Id": auth.clientId || "", "X-Client-Secret": auth.clientSecret || "" };
  if (id === "rest-order-management") return { Authorization: `Bearer ${auth.token || ""}` };
  if (id === "blueyonder-tms") {
    if (!state.tmsToken) {
      const body = new URLSearchParams({ grant_type: "client_credentials", client_id: auth.clientId || "", client_secret: auth.clientSecret || "" });
      const token = await getJson("/api/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
      state.tmsToken = token.access_token;
    }
    return { Authorization: `Bearer ${state.tmsToken}` };
  }
  return {};
}

function renderSignals(alerts, generatedAt) {
  document.querySelector("#updated-at").textContent = new Date(generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  document.querySelector("#signals").innerHTML = alerts.slice(0, 3).map(alert => `<div class="signal"><span class="severity ${alert.severity}"></span><div><strong>${clean(alert.signal)}</strong><small>${clean(alert.decision)}</small></div><b>${money(alert.exposureEur)}</b></div>`).join("");
}

function renderCredentials(app) {
  const config = activeConfig(app.id);
  const pairs = { endpoint: location.origin + (config.endpoint || app.baseUrl), protocol: config.protocol || app.protocol, refresh: config.refresh || app.refresh, enabled: config.enabled !== false, ...(config.auth || {}) };
  document.querySelector("#credentials").innerHTML = `
    ${Object.entries(pairs).map(([key, value]) => `<div class="credential"><label>${clean(key.replace(/([A-Z])/g, " $1"))}</label><code>${clean(value)}</code></div>`).join("")}
    <div class="editor-panel" style="margin-top:12px">
      <div class="editor-head"><strong>Configuration de connexion</strong><span>Persistée côté serveur · utilisée par les prochaines lectures Aura</span></div>
      <textarea id="config-editor" spellcheck="false">${JSON.stringify({ endpoint: config.endpoint || app.baseUrl, protocol: config.protocol || app.protocol, refresh: config.refresh || app.refresh, enabled: config.enabled !== false, auth: config.auth || {} }, null, 2)}</textarea>
      <div class="editor-actions"><button class="button primary" id="save-config">Enregistrer la connexion</button><button class="button" id="reset-config">Réinitialiser</button><span id="config-status"></span></div>
    </div>`;
  document.querySelector("#save-config")?.addEventListener("click", saveConfig);
  document.querySelector("#reset-config")?.addEventListener("click", resetConfig);
}

function renderTable(records) {
  const keys = [...new Set(records.flatMap(Object.keys))];
  return `<div class="table-wrap"><table><thead><tr>${keys.map(key => `<th>${key}</th>`).join("")}</tr></thead><tbody>${records.map(record => `<tr>${keys.map(key => `<td>${clean(record[key])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderEditor(records) {
  return `<div class="editor-panel"><div class="editor-head"><strong>Modifier les valeurs fictives</strong><span>PATCH persistant · les prochaines lectures Aura les verront</span></div><textarea id="records-editor" spellcheck="false">${JSON.stringify(records, null, 2)}</textarea><div class="editor-actions"><input id="admin-token" type="password" placeholder="Token d’administration (démo)" value="${sessionStorage.getItem(ADMIN_TOKEN_KEY) || ""}"/><button class="button primary" id="save-records">Enregistrer</button><span id="save-status"></span></div></div>`;
}

function adminHeaders() {
  const token = sessionStorage.getItem(ADMIN_TOKEN_KEY) || document.querySelector("#admin-token")?.value.trim() || "lumen_aura_gateway_demo_token";
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function saveConfig() {
  const status = document.querySelector("#config-status");
  try {
    const patch = JSON.parse(document.querySelector("#config-editor").value);
    const saved = await getJson("/api/config", { method: "PATCH", headers: adminHeaders(), body: JSON.stringify({ appId: state.active, patch }) });
    state.configs[state.active] = saved.config;
    state.tmsToken = null;
    status.textContent = `Enregistré · ${saved.persistence}`;
    await selectApplication(state.active);
  } catch (error) { status.textContent = `Échec : ${clean(error.message)}`; }
}

async function resetConfig() {
  const status = document.querySelector("#config-status");
  try {
    const saved = await getJson("/api/config", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ appId: state.active, action: "reset" }) });
    state.configs[state.active] = saved.config;
    state.tmsToken = null;
    await selectApplication(state.active);
  } catch (error) { status.textContent = `Échec : ${clean(error.message)}`; }
}

async function saveRecords() {
  const status = document.querySelector("#save-status");
  try {
    const records = JSON.parse(document.querySelector("#records-editor").value);
    const token = document.querySelector("#admin-token").value.trim();
    if (!token) throw new Error("Token d’administration requis");
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    const saved = await getJson(`/api/data/${state.active}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ records }) });
    status.textContent = `Enregistré · ${saved.records.length} lignes · ${saved.persistence}`;
    await selectApplication(state.active);
    await refreshSignals();
  } catch (error) { status.textContent = `Échec : ${clean(error.message)}`; }
}

async function refreshSignals() {
  try {
    const alerts = await getJson("/api/alerts", { headers: { Authorization: "Bearer lumen_aura_gateway_demo_token" } });
    renderSignals(alerts.alerts, alerts.generatedAt);
  } catch (error) { document.querySelector("#signals").innerHTML = `<p>Alertes indisponibles · ${clean(error.message)}</p>`; }
}

async function selectApplication(id) {
  state.active = id;
  document.querySelectorAll(".app-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.id === id));
  document.querySelector("#app-detail").innerHTML = "<p>Authenticated read in progress…</p>";
  const app = state.applications.find(item => item.id === id);
  renderCredentials(app);
  try {
    const config = activeConfig(id);
    if (config.enabled === false) throw new Error("Source désactivée dans la configuration");
    let payload;
    if (["kafka-stream", "legacy-soap", "webhook-gateway"].includes(id)) {
      document.querySelector("#app-detail").innerHTML = `<div class="app-heading"><div><p class="eyebrow">${clean(app.marketReference)}-INSPIRED</p><h3>${clean(app.name)}</h3><p>${clean(app.role)}</p></div><span class="status">● ${clean(app.status)}</span></div><div class="contract"><span>${clean(config.protocol || app.protocol)}</span><span>${clean(config.endpoint || app.baseUrl)}</span><span>Connecteur opérationnel dédié</span></div><p style="color:#7c8097;font-size:12px;margin-top:18px">${clean(app.disclaimer)}</p>`;
      return;
    }
    payload = await getJson(`/api/data/${id}`, { headers: await sourceHeaders(id) });
    const { application: readApp, entity, records, lineage } = payload;
    document.querySelector("#app-detail").innerHTML = `<div class="app-heading"><div><p class="eyebrow">${clean(readApp.marketReference)}-INSPIRED</p><h3>${clean(readApp.name)}</h3><p>${clean(readApp.role)}</p></div><span class="status">● ${clean(readApp.status)}</span></div><div class="contract"><span>${clean(config.protocol || readApp.protocol)}</span><span>${clean(entity)}</span><span>${records.length} sample records</span><span>request ${clean(lineage?.requestId).slice(0, 8)}</span></div>${renderTable(records)}${renderEditor(records)}<p style="color:#7c8097;font-size:12px;margin-top:18px">${clean(readApp.disclaimer)}</p>`;
    document.querySelector("#save-records").addEventListener("click", saveRecords);
  } catch (error) { document.querySelector("#app-detail").innerHTML = `<h3>Authenticated source read failed</h3><p>${clean(error.message)}</p>`; }
}

function renderTabs(applications) {
  document.querySelector("#app-tabs").innerHTML = applications.map(app => `<button class="app-tab" data-id="${app.id}" role="tab">${clean(app.name)}</button>`).join("");
  document.querySelectorAll(".app-tab").forEach(tab => tab.addEventListener("click", () => selectApplication(tab.dataset.id)));
}

async function bootstrap() {
  try {
    const [catalog, configPayload, alerts, ontology] = await Promise.all([
      getJson("/api/catalog"), getJson("/api/config"), getJson("/api/alerts", { headers: { Authorization: "Bearer lumen_aura_gateway_demo_token" } }), getJson("/api/ontology"),
    ]);
    state.applications = configPayload.applications?.length ? configPayload.applications : catalog.applications;
    state.configs = Object.fromEntries(state.applications.map(app => [app.id, app.config || {}]));
    renderTabs(state.applications);
    renderSignals(alerts.alerts, alerts.generatedAt);
    document.querySelector("#ontology").innerHTML = ontology.objects.map(item => `<span>${clean(item)}</span>`).join("");
    await selectApplication(state.applications[0].id);
  } catch (error) { document.querySelector("#app-detail").innerHTML = `<h3>Integration lab unavailable</h3><p>${clean(error.message)}</p>`; }
}

bootstrap();
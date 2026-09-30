// Extensions du SI multi-sources (taille démo) pour couvrir tous les cas d'Aura,
// sur des objets et des champs standard des applications du marché :
//  - résilience (TTS/TTR) : liste de sources SAP (EORD), fiches info-achat
//    (EINA/EINE), données MRP article-division (MARC), valorisation (MBEW) et
//    conditions de prix de vente (PPR0) ;
//  - pandémie : historique de demande OMS et data lake avec un pic, historique
//    d'achats ERP (amplification des commandes), absences RH (SuccessFactors) ;
//  - détroits : lignes maritimes, étapes des expéditions et évènements de
//    perturbation dans le TMS ;
//  - qualité, risque et certification : certificats et évaluations de risque
//    (SRM), lots de contrôle (QMS).
// Chaque ligne est calculée de façon déterministe à partir des tables existantes
// (mêmes identifiants) ; l'équivalent réel de chaque champ est documenté dans
// docs/SOURCES-MULTI.md (« Champs standard ajoutés »). Taille démo uniquement.
import { AS_OF, STORY_SITES, STORY_SKUS, u } from "./multisource-gen.js";

const pad = (v, n) => String(v).padStart(n, "0");
const round2 = x => Math.round(x * 100) / 100;
const DAY = 86400e3, ASOF = Date.parse(`${AS_OF}T00:00:00Z`);
const date = ms => new Date(ms).toISOString().slice(0, 10);
const ts = ms => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
// Semaines ISO : 52 semaines closes avant AS_OF (lundi 2026-09-28 = début de 2026-W40).
function isoWeek(ms) { const t = new Date(ms); const d = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - d + 3); const y = t.getUTCFullYear(); const w1 = new Date(Date.UTC(y, 0, 4)); return `${y}-W${pad(1 + Math.round(((t - w1) / DAY - 3 + ((w1.getUTCDay() + 6) % 7)) / 7), 2)}`; }
export const WEEKS = Array.from({ length: 52 }, (_, i) => { const monday = ASOF - (52 - i) * 7 * DAY; return { week: isoWeek(monday), monday }; });
/** Pic de demande de type crise sanitaire : 6 semaines (2026-W11 à 2026-W16), montée puis retombée. */
export const SPIKE = { "2026-W11": 1.6, "2026-W12": 2.4, "2026-W13": 3.1, "2026-W14": 2.8, "2026-W15": 2.0, "2026-W16": 1.4 };
const ASIA = new Set(["CN", "IN"]);

export function extendTables(T) {
  const sup = T.sap_suppliers.filter(s => !/SAS$/.test(s.SupplierName) || s.SupplierName !== s.SupplierName.toUpperCase()); // sans les doublons volontaires
  const supById = new Map(T.sap_suppliers.map(s => [s.Supplier, s]));
  const pim = new Map(); for (const p of T.pim_products) if (!pim.has(p.internalRef)) pim.set(p.internalRef, p);
  // Fournisseur principal d'un article : fournisseur le plus fréquent de ses commandes d'achat.
  const byMat = new Map();
  for (const p of T.sap_purchase_orders) { const m = byMat.get(p.Material) ?? new Map(); m.set(p.Supplier, (m.get(p.Supplier) ?? 0) + 1); byMat.set(p.Material, m); }
  const materials = [...byMat.keys()];
  const primaryOf = mat => [...byMat.get(mat).entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  const leadFor = (supplier, i, salt) => { const c = supById.get(supplier)?.Country; return ASIA.has(c) ? 35 + Math.floor(u(i, salt) * 16) : ["IT", "ES", "PT", "DE", "SE"].includes(c) ? 8 + Math.floor(u(i, salt) * 8) : 4 + Math.floor(u(i, salt) * 7); };
  // Couverture (TTS) au sens d'Aura : (stock disponible WMS + transit TMS) / demande journalière APS (première semaine).
  const refOfEan = new Map(T.pim_products.map(p => [p.ean, p.internalRef]));
  const avail = new Map(); for (const w of T.wms_stock) { const r = refOfEan.get(w.ItemId.replace(/^0/, "")); if (r) avail.set(r, (avail.get(r) ?? 0) + Math.max(0, w.OnHand - w.Allocated)); }
  const onHand = new Map(avail);
  for (const sh of T.tms_shipments) if (!sh.ActualDate) { const r = refOfEan.get(sh.ItemId.replace(/^0/, "")); if (r) avail.set(r, (avail.get(r) ?? 0) + sh.Quantity); }
  const firstWeek = T.aps_forecasts.map(f => f.Week).sort()[0], daily = new Map();
  for (const f of T.aps_forecasts) if (f.Week === firstWeek) daily.set(f.Material, (daily.get(f.Material) ?? 0) + f.ForecastQty / 7);
  const ttsOf = m => (daily.get(m) && onHand.has(m) ? (avail.get(m) ?? 0) / daily.get(m) : null);
  // Scénarios illustratifs (champ `_scenario: "illustratif"`) : ces cas sont réglés à la main pour
  // que les alertes d'Aura se déclenchent ; ils ne reflètent pas une distribution observée.
  // Cas reproductibles : les 6 articles stockés dont le délai de reprise sans alternative (délai + 60 j de
  // requalification) dépasse le plus leur couverture n'ont qu'une source approuvée (fournisseur unique).
  const gaps = materials.map((m, i) => ({ m, gap: ttsOf(m) === null ? null : ttsOf(m) - (leadFor(primaryOf(m), i, 73) + 60) })).filter(x => x.gap !== null).sort((a, b) => a.gap - b.gap || (a.m < b.m ? -1 : 1)).slice(0, 6);
  const lowCover = new Set(gaps.map(x => x.m));
  // Pour ces articles, le délai planifié de la source fixe (fiche info-achat) dépasse la couverture diminuée
  // de la requalification : délai de reprise supérieur au délai de survie, de façon reproductible.
  const leadBoost = new Map(gaps.map(x => [x.m, Math.max(0, Math.ceil(x.gap) + 10)]));

  // ── SAP : liste de sources (EORD), fiches info-achat (EINA/EINE), MRP (MARC), valorisation (MBEW), prix de vente ──
  const sources = [], infos = [], planning = [], valuation = [], prices = [];
  materials.forEach((mat, i) => {
    const p = pim.get(mat), primary = primaryOf(mat);
    // Deux articles sur trois ont une source alternative approuvée (autre pays si possible) ; les autres n'en ont pas.
    let alt = null;
    if (i % 3 !== 2 && !lowCover.has(mat)) {
      const pc = supById.get(primary)?.Country;
      const pool = sup.filter(s => s.Supplier !== primary && s.Country !== pc);
      alt = pool[Math.floor(u(i, 71) * pool.length)]?.Supplier ?? null;
    }
    const std = round2(p.listPrice * (0.38 + u(i, 72) * 0.22));
    [[primary, true], ...(alt ? [[alt, false]] : [])].forEach(([s, fixed], k) => {
      sources.push({ Material: mat, Plant: "1000", SourceListRecord: pad(k + 1, 5), ValidityStartDate: "2026-01-01", ValidityEndDate: "9999-12-31", Supplier: s, PurchasingOrganization: "1000", SupplierIsFixed: fixed, SourceOfSupplyIsBlocked: false, MRPSourcingControl: "1", _scenario: lowCover.has(mat) ? "illustratif" : null });
      const lead = leadFor(s, i, 73 + k) + (fixed ? leadBoost.get(mat) ?? 0 : 5 + Math.floor(u(i, 74) * 10));
      infos.push({ PurchasingInfoRecord: `53${pad(infos.length + 1, 8)}`, Supplier: s, Material: mat, PurchasingInfoRecordCategory: "0", PurchasingOrganization: "1000", Plant: "1000", MaterialPlannedDeliveryDurn: lead, NetPriceAmount: round2(std * (fixed ? 0.96 + u(i, 75) * 0.06 : 1.04 + u(i, 76) * 0.12)), Currency: "EUR", MaterialPriceUnitQty: 1, MinimumPurchaseOrderQuantity: fixed ? 100 : 250, _scenario: fixed && leadBoost.get(mat) ? "illustratif" : null });
    });
    const primaryLead = infos.find(r => r.Material === mat && r.Supplier === primary).MaterialPlannedDeliveryDurn;
    // Stock de sécurité (MARC-EISBE) : 10 à 25 jours de demande prévue (somme des seuils WMS à défaut).
    const d = daily.get(mat), wmsSafety = T.wms_stock.filter(w => refOfEan.get(w.ItemId.replace(/^0/, "")) === mat).reduce((s2, w) => s2 + w.SafetyStock, 0);
    planning.push({ Product: mat, Plant: "1000", ProcurementType: "F", MRPType: "PD", PlannedDeliveryDurationInDays: primaryLead, GoodsReceiptDuration: 1, SafetyStockQuantity: d ? Math.round(d * (10 + Math.floor(u(i, 78) * 16))) : wmsSafety, _scenario: leadBoost.get(mat) ? "illustratif" : null });
    valuation.push({ Product: mat, ValuationArea: "1000", ValuationType: "", InventoryValuationProcedure: "S", StandardPrice: std, PriceUnitQty: 1, Currency: "EUR", MovingAveragePrice: round2(std * (0.99 + u(i, 77) * 0.04)) });
    prices.push({ ConditionRecord: pad(1000000 + i, 10), ConditionType: "PPR0", Material: mat, SalesOrganization: "1000", DistributionChannel: "10", ConditionRateValue: p.listPrice, ConditionRateValueUnit: "EUR", ConditionQuantity: 1, ConditionValidityStartDate: "2026-01-01", ConditionValidityEndDate: "9999-12-31" });
  });

  // ── SAP : en-têtes de commande (EKKO) et entrées de marchandises (MSEG, mouvement 101) ──
  // Date de commande = date de livraison demandée − délai planifié de la fiche info-achat.
  // Dérive reproductible : pour les fournisseurs 0000100003 et 0000100006, les réceptions des
  // 4 dernières semaines arrivent 35 à 50 % plus tard que le délai planifié.
  const DRIFT = new Set(["0000100003", "0000100006"]), plannedOf = (m, sp) => infos.find(r => r.Material === m && r.Supplier === sp)?.MaterialPlannedDeliveryDurn ?? planning.find(p => p.Product === m)?.PlannedDeliveryDurationInDays ?? 14;
  const headers = [], receipts = [];
  T.sap_purchase_orders.forEach((po, i) => {
    const planned = plannedOf(po.Material, po.Supplier), due = Date.parse(`${po.ScheduleLineDeliveryDate}T00:00:00Z`), orderedAt = due - planned * DAY;
    headers.push({ PurchaseOrder: po.PurchaseOrder, PurchaseOrderType: "NB", Supplier: po.Supplier, PurchasingOrganization: "1000", PurchasingGroup: "001", PurchaseOrderDate: date(orderedAt), DocumentCurrency: po.DocumentCurrency });
    const recent = due >= ASOF - 28 * DAY;
    const factor = DRIFT.has(po.Supplier) && recent ? 1.35 + u(i, 105) * 0.15 : 0.95 + u(i, 106) * 0.13;
    const posted = orderedAt + Math.round(planned * factor) * DAY;
    if (posted < ASOF) receipts.push({ MaterialDocument: `50${pad(receipts.length + 1, 8)}`, MaterialDocumentYear: date(posted).slice(0, 4), MaterialDocumentItem: "0001", Material: po.Material, Plant: "1000", GoodsMovementType: "101", PurchaseOrder: po.PurchaseOrder, PurchaseOrderItem: po.PurchaseOrderItem, Supplier: po.Supplier, Batch: `B${po.PurchaseOrder.slice(-7)}`, PostingDate: date(posted), QuantityInEntryUnit: po.OrderQuantity, _scenario: DRIFT.has(po.Supplier) && recent ? "illustratif" : null });
  });

  // ── OMS : historique de lignes de commande (52 semaines, pic sanitaire) ; lac : demande et achats hebdomadaires ──
  const skus = STORY_SKUS.map(([sku]) => sku);
  const history = [], demand = [], purchases = [];
  skus.forEach((sku, si) => {
    const base = 40 + Math.floor(u(si, 81) * 80);
    let prevDemand = null, pipeline = [];
    WEEKS.forEach(({ week, monday }, wi) => {
      const season = 1 + 0.15 * Math.sin((wi / 52) * 2 * Math.PI);
      let weekQty = 0;
      ["STORE", "WEB"].forEach((channel, ci) => {
        const q = Math.max(0, Math.round(base * (ci ? 0.45 : 0.55) * season * (SPIKE[week] ?? 1) * (0.9 + u(si * 1000 + wi * 2 + ci, 82) * 0.2)));
        weekQty += q;
        const n = history.length + 1;
        history.push({ OrderLineId: `OH-${pad(n, 9)}`, OrderId: `SH-${pad(Math.ceil(n / 2), 9)}`, ProductRef: sku, Quantity: q, Channel: channel, FulfillmentSite: STORY_SITES[(si + ci * 3) % 5], OrderDate: date(monday + 2 * DAY), Status: "DELIVERED", UpdatedAt: ts(monday + 9 * DAY + 6 * 3600e3) });
      });
      demand.push({ Week: week, ProductRef: sku, Quantity: weekQty, OrderLines: 2, _source: "OMS", _ingestedAt: ts(monday + 8 * DAY) });
      // Commandes d'achat : politique « demande + correction de tendance », 2 semaines de délai de décision :
      // les à-coups de la demande sont amplifiés vers l'amont (effet coup de fouet).
      const trend = prevDemand === null ? 0 : weekQty - prevDemand;
      pipeline.push(Math.max(0, Math.round(weekQty + 1.8 * trend + (SPIKE[week] ? weekQty * 0.35 : 0))));
      prevDemand = weekQty;
      const ordered = wi >= 2 ? pipeline[wi - 2] : weekQty;
      purchases.push({ Week: week, Material: sku, OrderedQty: ordered, PurchaseOrderCount: ordered > 0 ? 1 + Math.floor(ordered / 150) : 0, _source: "ERP", _ingestedAt: ts(monday + 8 * DAY) });
    });
  });

  // ── RH (SuccessFactors Employee Central, simulé) : EmpJob et EmployeeTime ; lac : absentéisme hebdomadaire ──
  const jobs = [], absences = [];
  const sites = T.wms_facilities.map(f => f.SiteCode);
  sites.forEach((site, k) => {
    const staff = 18 + Math.floor(u(k, 91) * 20);
    for (let e = 0; e < staff; e++) jobs.push({ userId: `E${pad(10000 + jobs.length + 1, 6)}`, startDate: date(Date.parse("2024-01-01T00:00:00Z") + Math.floor(u(jobs.length, 92) * 600) * DAY), seqNumber: 1, company: "1000", location: site, department: /^WH|^FAC/.test(site) ? "LOGISTICS" : "RETAIL", jobCode: /^WH/.test(site) ? "WH_OPERATOR" : /^FAC/.test(site) ? "PROD_OPERATOR" : "STORE_ADVISOR", emplStatus: "A" });
  });
  jobs.forEach((j, ei) => {
    WEEKS.forEach(({ week, monday }, wi) => {
      const p = 0.035 * (SPIKE[week] ? 1 + (SPIKE[week] - 1) * 1.6 : 1);
      if (u(ei * 100 + wi, 93) < p) {
        const days = 1 + Math.floor(u(ei * 100 + wi, 94) * (SPIKE[week] ? 5 : 3));
        absences.push({ externalCode: `ABS${pad(absences.length + 1, 7)}`, userId: j.userId, timeType: "SICK_LEAVE", startDate: date(monday), endDate: date(monday + (days - 1) * DAY), quantityInDays: Math.min(days, 5), approvalStatus: "APPROVED" });
      }
    });
  });
  const locOf = new Map(jobs.map(j => [j.userId, j.location]));
  const absenteeism = [];
  for (const { week, monday } of WEEKS) for (const site of sites) {
    const hc = jobs.filter(j => j.location === site).length;
    const daysAbs = absences.filter(a => a.startDate === date(monday) && locOf.get(a.userId) === site).reduce((s, a) => s + a.quantityInDays, 0);
    absenteeism.push({ Week: week, Site: site, Headcount: hc, PlannedDays: hc * 5, AbsenceDays: daysAbs, AbsenteeismRate: round2((daysAbs / (hc * 5)) * 100), _source: "HR", _ingestedAt: ts(monday + 8 * DAY) });
  }

  // ── TMS : lignes maritimes (escales UN/LOCODE), étapes des expéditions maritimes, évènements ──
  const ROUTES = [
    { RouteId: "RT-CNSHA-FRLEH-SUEZ", OriginPort: "CNSHA", DestinationPort: "FRLEH", TransitPorts: "SGSIN;LKCMB;EGSUZ;EGPSD", TransitDays: 34, Carrier: "Atlantic Lines" },
    { RouteId: "RT-CNSHA-FRLEH-CAPE", OriginPort: "CNSHA", DestinationPort: "FRLEH", TransitPorts: "SGSIN;ZACPT", TransitDays: 45, Carrier: "Atlantic Lines" },
    { RouteId: "RT-CNYTN-NLRTM-SUEZ", OriginPort: "CNYTN", DestinationPort: "NLRTM", TransitPorts: "SGSIN;EGSUZ;EGPSD", TransitDays: 32, Carrier: "Nord Express" },
    { RouteId: "RT-CNYTN-NLRTM-CAPE", OriginPort: "CNYTN", DestinationPort: "NLRTM", TransitPorts: "SGSIN;ZACPT", TransitDays: 43, Carrier: "Nord Express" },
    { RouteId: "RT-INNSA-ITGOA-SUEZ", OriginPort: "INNSA", DestinationPort: "ITGOA", TransitPorts: "EGSUZ;EGPSD", TransitDays: 21, Carrier: "Atlantic Lines" },
    { RouteId: "RT-INNSA-ITGOA-CAPE", OriginPort: "INNSA", DestinationPort: "ITGOA", TransitPorts: "ZACPT;ESALG", TransitDays: 33, Carrier: "Atlantic Lines" },
    { RouteId: "RT-PTLEI-FRLEH", OriginPort: "PTLEI", DestinationPort: "FRLEH", TransitPorts: "", TransitDays: 4, Carrier: "Nord Express" },
  ].map(r => ({ ...r, TransportMode: "MARITIME", ValidFrom: "2026-01-01", ValidTo: "9999-12-31" }));
  const byName = new Map(T.sap_suppliers.map(s => [s.SupplierName.toUpperCase().replace(/ (SAS|LTD)$/, ""), s]));
  const stages = [];
  const legsOf = r => [r.OriginPort, ...(r.TransitPorts ? r.TransitPorts.split(";") : []), r.DestinationPort];
  T.tms_shipments.filter(s => s.TransportMode === "MARITIME").forEach((s, i) => {
    const c = byName.get(s.OriginName.toUpperCase().replace(/ (SAS|LTD)$/, ""))?.Country;
    const origin = c === "CN" ? (i % 2 ? "CNYTN" : "CNSHA") : c === "IN" ? "INNSA" : "PTLEI";
    // Détour par le cap de Bonne-Espérance pour les départs récents (perturbation en mer Rouge).
    const cape = origin !== "PTLEI" && s.ExpectedDate >= "2026-10-05";
    const route = ROUTES.find(r => r.OriginPort === origin && (origin === "PTLEI" || r.RouteId.endsWith(cape ? "CAPE" : "SUEZ")));
    const ports = legsOf(route), arrive = Date.parse(`${s.ExpectedDate}T00:00:00Z`), depart = arrive - route.TransitDays * DAY;
    for (let k = 0; k < ports.length - 1; k++) {
      const from = depart + Math.round((route.TransitDays * k) / (ports.length - 1)) * DAY, to = depart + Math.round((route.TransitDays * (k + 1)) / (ports.length - 1)) * DAY;
      stages.push({ ShipmentId: s.ShipmentId, StageSequence: k + 1, StageType: "MAIN_CARRIAGE", RouteId: route.RouteId, SourceLocation: ports[k], DestinationLocation: ports[k + 1], PlannedDeparture: date(from), PlannedArrival: date(to), ActualArrival: to < ASOF && s.ActualDate ? date(to) : null });
    }
  });
  const events = [
    { EventId: "EV-0000001", EventCode: "CONGESTION", Location: "SGSIN", RouteId: null, ShipmentId: null, StartDate: "2026-08-18", EndDate: "2026-08-29", EstimatedDelayDays: 3, Reason: "Congestion portuaire" },
    { EventId: "EV-0000002", EventCode: "BLOCKED", Location: "EGSUZ", RouteId: "RT-CNSHA-FRLEH-SUEZ", ShipmentId: null, StartDate: "2026-09-12", EndDate: null, EstimatedDelayDays: 14, Reason: "Passage mer Rouge / canal de Suez suspendu par l'armateur" },
    { EventId: "EV-0000003", EventCode: "BLOCKED", Location: "EGSUZ", RouteId: "RT-CNYTN-NLRTM-SUEZ", ShipmentId: null, StartDate: "2026-09-12", EndDate: null, EstimatedDelayDays: 14, Reason: "Passage mer Rouge / canal de Suez suspendu par l'armateur" },
    { EventId: "EV-0000004", EventCode: "BLOCKED", Location: "EGSUZ", RouteId: "RT-INNSA-ITGOA-SUEZ", ShipmentId: null, StartDate: "2026-09-12", EndDate: null, EstimatedDelayDays: 12, Reason: "Passage mer Rouge / canal de Suez suspendu par l'armateur" },
    { EventId: "EV-0000005", EventCode: "STRIKE", Location: "FRLEH", RouteId: null, ShipmentId: null, StartDate: "2026-09-24", EndDate: "2026-09-26", EstimatedDelayDays: 2, Reason: "Grève des dockers" },
  ].map(e => ({ ...e, _scenario: null }));
  // Congestion en cours au port d'arrivée de l'expédition maritime ouverte la moins couverte (cas reproductible) ;
  // la marchandise étant bloquée, la couverture se lit sur le seul stock disponible.
  const openMar = T.tms_shipments.filter(sh => sh.TransportMode === "MARITIME" && !sh.ActualDate && stages.some(st => st.ShipmentId === sh.ShipmentId));
  const cover = sh => { const r = refOfEan.get(sh.ItemId.replace(/^0/, "")); return r && daily.get(r) ? (onHand.get(r) ?? 0) / daily.get(r) : Infinity; };
  const tight = [...openMar].sort((a, b) => cover(a) - cover(b) || (a.ShipmentId < b.ShipmentId ? -1 : 1))[0];
  if (tight) {
    const port = stages.filter(st => st.ShipmentId === tight.ShipmentId).at(-1).DestinationLocation;
    events.push({ EventId: `EV-${pad(events.length + 1, 7)}`, EventCode: "CONGESTION", Location: port, RouteId: null, ShipmentId: null, StartDate: "2026-09-25", EndDate: null, EstimatedDelayDays: 4, Reason: "Congestion portuaire : temps d'attente au mouillage", _scenario: "illustratif" });
  }
  // Expéditions encore sur une route via Suez pendant la suspension : un évènement DIVERSION chacune (détour par le Cap).
  const suezOpen = new Set(stages.filter(st => st.RouteId.endsWith("SUEZ") && st.DestinationLocation === "EGSUZ" && st.PlannedArrival >= "2026-09-12" && !st.ActualArrival).map(st => st.ShipmentId));
  for (const sh of suezOpen) events.push({ EventId: `EV-${pad(events.length + 1, 7)}`, EventCode: "DIVERSION", Location: "EGSUZ", RouteId: stages.find(x => x.ShipmentId === sh).RouteId, ShipmentId: sh, StartDate: "2026-09-12", EndDate: null, EstimatedDelayDays: 11, Reason: "Détour par le cap de Bonne-Espérance", _scenario: null });

  // ── SRM : certificats et évaluations de risque (identifiant fournisseur ERP) ; QMS : lots de contrôle ──
  const erpOf = srm => pad(100000 + Number(srm.SrmId.slice(4)), 10);
  const certificates = [], risks = [];
  T.srm_suppliers.forEach((s, i) => {
    String(s.Certifications ?? "").split(";").filter(Boolean).forEach((c, k) => {
      const to = k === 0 ? s.CertificationExpiry : date(Date.parse(`${s.CertificationExpiry}T00:00:00Z`) + (200 + Math.floor(u(i * 10 + k, 95) * 500)) * DAY);
      certificates.push({ CertificateId: `CERT-${pad(certificates.length + 1, 6)}`, SrmId: s.SrmId, ErpVendorId: erpOf(s), CertificateType: c, CertificateNumber: `${c.replace(/\s/g, "")}-${pad(Math.floor(u(i * 10 + k, 96) * 1e6), 6)}`, IssuedBy: ["Bureau Veritas", "SGS", "TÜV SÜD", "AFNOR Certification"][Math.floor(u(i * 10 + k, 97) * 4)], ValidFrom: date(Date.parse(`${to}T00:00:00Z`) - 3 * 365 * DAY), ValidTo: to, Status: to < AS_OF ? "EXPIRED" : "VALID" });
    });
    // Devoir de vigilance : trois fournisseurs n'ont pas encore d'évaluation ESG (cas reproductible).
    const noEsg = ["SRM-00007", "SRM-00015", "SRM-00022"].includes(s.SrmId);
    const cats = [["OVERALL", s.RiskScore], ["FINANCIAL", s.FinancialRisk], ["OPERATIONAL", Math.round(20 + u(i, 98) * 60)], ["SUPPLY_CAPACITY", Math.min(100, Math.round(s.RiskScore * (0.7 + u(i, 99) * 0.4)))], ["GEOPOLITICAL", ASIA.has(s.Country) ? Math.round(60 + u(i, 100) * 30) : Math.round(10 + u(i, 100) * 30)], ["ESG", Math.round(15 + u(i, 101) * 60)]].filter(([c]) => !(noEsg && c === "ESG"));
    const level = score => (score >= 70 ? "HIGH" : score >= 40 ? "MEDIUM" : "LOW");
    for (const [cat, score] of cats) risks.push({ AssessmentId: `RA-${pad(risks.length + 1, 6)}`, SrmId: s.SrmId, ErpVendorId: erpOf(s), RiskCategory: cat, Score: score, RiskLevel: level(score), AssessedOn: s.UpdatedAt.slice(0, 10) });
    // Historique mensuel du risque financier (5 évaluations antérieures). Dégradation reproductible
    // pour SRM-00003 et SRM-00012 : +25 points en 5 mois ; stable (± 3) pour les autres.
    const degrading = ["SRM-00003", "SRM-00012"].includes(s.SrmId);
    for (let k = 5; k >= 1; k--) {
      const past = degrading ? Math.max(5, s.FinancialRisk - 5 * k) : Math.max(0, Math.min(100, s.FinancialRisk + Math.round((u(i * 10 + k, 107) - 0.5) * 6)));
      risks.push({ AssessmentId: `RA-${pad(risks.length + 1, 6)}`, SrmId: s.SrmId, ErpVendorId: erpOf(s), RiskCategory: "FINANCIAL", Score: past, RiskLevel: level(past), AssessedOn: date(Date.parse(`${s.UpdatedAt.slice(0, 10)}T00:00:00Z`) - k * 30 * DAY) });
    }
  });
  const ncBySupplierTax = new Map();
  for (const n of T.qms_nonconformities) ncBySupplierTax.set(n.SupplierTaxId, (ncBySupplierTax.get(n.SupplierTaxId) ?? 0) + 1);
  const lots = T.sap_purchase_orders.filter((_, i) => i % 2 === 0).map((po, i) => {
    const s = supById.get(po.Supplier), rejectP = s && ASIA.has(s.Country) ? 0.12 : 0.04;
    const reject = u(i, 102) < rejectP, qty = po.OrderQuantity;
    return { InspectionLot: `01${pad(i + 1, 10)}`, InspectionLotOrigin: "01", Material: po.Material, Batch: `B${po.PurchaseOrder.slice(-7)}`, Plant: "1000", Supplier: po.Supplier, PurchaseOrder: po.PurchaseOrder, InspectionLotQuantity: qty, InspectionLotDefectiveQuantity: reject ? Math.round(qty * (0.05 + u(i, 103) * 0.2)) : Math.round(qty * u(i, 104) * 0.01), InspectionLotUsageDecisionCode: reject ? "R" : "A", InspectionLotEndDate: po.ScheduleLineDeliveryDate < AS_OF ? po.ScheduleLineDeliveryDate : null };
  });

  // ── WMS : lignes de livraison sortantes avec numéro de lot (traçabilité descendante lot → commande client) ──
  // Chaque ligne de commande client expédiée consomme le lot reçu le plus ancien de l'article (FIFO).
  const productOfRef = new Map(T.pim_products.map(p => [p.internalRef.toUpperCase(), p]));
  const lotsByMat = new Map();
  for (const r of receipts) { const l = lotsByMat.get(r.Material) ?? []; l.push(r); lotsByMat.set(r.Material, l); }
  for (const l of lotsByMat.values()) l.sort((a, b) => (a.PostingDate < b.PostingDate ? -1 : a.PostingDate > b.PostingDate ? 1 : a.Batch < b.Batch ? -1 : 1));
  const outbound = [];
  for (const ol of T.oms_order_lines) {
    const p = productOfRef.get(String(ol.ProductRef).toUpperCase()), lots = p && lotsByMat.get(p.internalRef);
    if (!lots || ol.Status === "OPEN") continue;
    const lot = lots.find(x => x.PostingDate <= ol.OrderDate) ?? lots[0];
    outbound.push({ DeliveryId: `OBD-${pad(outbound.length + 1, 8)}`, OrderId: ol.OrderId, OrderLineId: ol.OrderLineId, ItemId: `0${p.ean}`, BatchNumber: lot.Batch, ShippedQuantity: ol.Quantity, FacilityId: String(ol.FulfillmentSite).replace(/-/g, ""), ShippedAt: `${ol.OrderDate} 18:00:00` });
  }

  return {
    wms_outbound_deliveries: outbound,
    sap_purchasing_sources: sources, sap_info_records: infos, sap_product_supply: planning, sap_product_valuation: valuation, sap_sales_prices: prices,
    sap_purchase_order_headers: headers, sap_material_documents: receipts,
    oms_order_history: history, lake_demand_history: demand, lake_purchase_history: purchases, lake_absenteeism: absenteeism,
    hr_emp_job: jobs, hr_employee_time: absences,
    tms_routes: ROUTES, tms_shipment_stages: stages, tms_events: events,
    srm_certificates: certificates, srm_risk_assessments: risks, qms_inspection_lots: lots,
  };
}

/** Ressources ajoutées au catalogue des sources (source → ressource → table, clé, watermark). */
export const EXTENSION_RESOURCES = {
  sap: {
    A_PurchasingSource: { table: "sap_purchasing_sources", key: "Material", service: "API_PURCHASING_SOURCE_SRV" },
    A_PurgInfoRecdOrgPlantData: { table: "sap_info_records", key: "PurchasingInfoRecord", service: "API_INFORECORD_PROCESS_SRV" },
    A_ProductSupplyPlanning: { table: "sap_product_supply", key: "Product", service: "API_PRODUCT_SRV" },
    A_ProductValuation: { table: "sap_product_valuation", key: "Product", service: "API_PRODUCT_SRV" },
    A_SlsPrcgConditionRecord: { table: "sap_sales_prices", key: "ConditionRecord", service: "API_SLSPRICINGCONDITIONRECORD_SRV" },
    A_PurchaseOrder: { table: "sap_purchase_order_headers", key: "PurchaseOrder", service: "API_PURCHASEORDER_PROCESS_SRV" },
    A_MaterialDocumentItem: { table: "sap_material_documents", key: "MaterialDocument", service: "API_MATERIAL_DOCUMENT_SRV" },
  },
  oms: { "order-history": { table: "oms_order_history", watermark: "UpdatedAt", key: "OrderLineId" } },
  lake: { "demand-history": { table: "lake_demand_history", watermark: "_ingestedAt", key: "Week" }, "purchase-history": { table: "lake_purchase_history", watermark: "_ingestedAt", key: "Week" }, absenteeism: { table: "lake_absenteeism", watermark: "_ingestedAt", key: "Week" } },
  hr: { "emp-job": { table: "hr_emp_job", key: "userId" }, "employee-time": { table: "hr_employee_time", key: "externalCode" } },
  tms: { routes: { table: "tms_routes", key: "RouteId" }, "shipment-stages": { table: "tms_shipment_stages", key: "ShipmentId" }, events: { table: "tms_events", key: "EventId" } },
  srm: { certificates: { table: "srm_certificates", key: "CertificateId" }, "risk-assessments": { table: "srm_risk_assessments", key: "AssessmentId" } },
  qms: { "inspection-lots": { table: "qms_inspection_lots", key: "InspectionLot" } },
  manhattan: { "outbound-deliveries": { table: "wms_outbound_deliveries", key: "DeliveryId" } },
};

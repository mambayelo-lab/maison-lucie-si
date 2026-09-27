// Enrichissement SYNTHÉTIQUE et DÉTERMINISTE du SI Maison Lucie.
//
// Toutes les valeurs ci-dessous sont fictives (aucune donnée réelle de
// fournisseur, de client ou de marché). Elles sont construites pour être
// cohérentes entre applications (mêmes identifiants SUP-xxx, SKU, PO-xxxx,
// SHP-xxx, sites) et pour contenir à la fois des valeurs qui franchissent les
// seuils d'alerte Aura (risque capacité >= 70, couverture < 3 jours, retard
// >= 48 h, prévision promue, risque global élevé) et des valeurs normales.
//
// Règle de compatibilité : les enregistrements historiques restent en tête
// de chaque table et gardent leurs valeurs ; on n'ajoute que des champs ou
// des enregistrements (Aura lit certains enregistrements par "premier trouvé").

export const SYNTHETIC_NOTICE = "Synthetic demonstration data for Maison Lucie — fictitious, not real business data.";

// PRNG seedé (mulberry32) — jamais de Math.random.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round1 = value => Math.round(value * 10) / 10;

// ── Fournisseurs ─────────────────────────────────────────────────────────
// [id, nom, pays ISO, ville, catégorie, tier, stratégique, dépense annuelle €, depuis]
const SUPPLIERS = [
  ["SUP-001", "Tessitura Milano", "IT", "Milan", "Textile & coffrets", 1, true, 4200000, 2014],
  ["SUP-002", "Maison Cuir du Nord", "FR", "Roubaix", "Cuir", 1, true, 6100000, 2009],
  ["SUP-003", "Shenzhen Atelier Components", "CN", "Shenzhen", "Accessoires métal", 2, false, 1900000, 2018],
  ["SUP-004", "Nordic Packaging AB", "SE", "Norrköping", "Emballage", 2, false, 820000, 2020],
  ["SUP-005", "Porto Leather Works", "PT", "Porto", "Maroquinerie", 1, true, 3300000, 2016],
  ["SUP-006", "Atlas Metalworks", "TN", "Sfax", "Accessoires métal", 2, false, 1400000, 2019],
  ["SUP-007", "Rhône Textile Lab", "FR", "Lyon", "Textile", 1, false, 1150000, 2012],
  ["SUP-008", "Anatolia Deri Tekstil", "TR", "Istanbul", "Maroquinerie", 2, false, 1250000, 2021],
  ["SUP-009", "Como Seta Filati", "IT", "Côme", "Soie", 1, true, 2700000, 2011],
  ["SUP-010", "Kanpur Tannery Partners", "IN", "Kanpur", "Cuir", 2, false, 1750000, 2022],
  ["SUP-011", "Saigon Stitchworks", "VN", "Hô Chi Minh-Ville", "Assemblage", 2, false, 980000, 2023],
  ["SUP-012", "Firenze Pelletteria Artigiana", "IT", "Florence", "Maroquinerie", 1, true, 5400000, 2010],
  ["SUP-013", "Casablanca Zip & Trim", "MA", "Casablanca", "Fermetures & garnitures", 2, false, 640000, 2020],
  ["SUP-014", "Pirineos Wool Cooperative", "ES", "Pampelune", "Laine & cachemire", 1, false, 1320000, 2015],
  ["SUP-015", "Busan Precision Metals", "KR", "Busan", "Accessoires métal", 2, false, 910000, 2022],
].map(([supplierId, name, country, city, category, tier, strategic, annualSpendEur, since]) => ({
  supplierId, name, country, city, category, tier, strategic, annualSpendEur, currency: "EUR",
  paymentTerms: tier === 1 ? "60 days EOM" : "45 days net", supplierSince: since,
}));
const supplierName = id => SUPPLIERS.find(s => s.supplierId === id)?.name ?? id;
const supplierCountry = id => SUPPLIERS.find(s => s.supplierId === id)?.country ?? null;

// Risque géopolitique + pays ajoutés aux 7 évaluations historiques (valeurs historiques inchangées).
const RISK_EXTRA = {
  "SUP-001": { geopoliticalRisk: 12 }, "SUP-002": { geopoliticalRisk: 6 }, "SUP-003": { geopoliticalRisk: 68 },
  "SUP-004": { geopoliticalRisk: 7 }, "SUP-005": { geopoliticalRisk: 9 }, "SUP-006": { geopoliticalRisk: 58 },
  "SUP-007": { geopoliticalRisk: 6 },
};
// [id, financier, pays, qualité, capacité, global, géopolitique, tendance]
const NEW_RISKS = [
  ["SUP-008", 34, 52, 22, 58, 46, 55, "+5"],
  ["SUP-009", 14, 18, 9, 27, 19, 12, "0"],
  ["SUP-010", 57, 49, 44, 83, 74, 41, "+21"],
  ["SUP-011", 31, 38, 35, 66, 49, 44, "+9"],
  ["SUP-012", 11, 18, 8, 42, 22, 12, "-1"],
  ["SUP-013", 26, 33, 61, 47, 45, 28, "+12"],
  ["SUP-014", 19, 12, 10, 21, 16, 9, "-4"],
  ["SUP-015", 15, 29, 12, 38, 25, 47, "+3"],
].map(([supplierId, financialRisk, countryRisk, qualityRisk, capacityRisk, overallRisk, geopoliticalRisk, trend]) => ({
  supplierId, supplier: supplierName(supplierId), financialRisk, countryRisk, qualityRisk, capacityRisk, overallRisk, trend, geopoliticalRisk,
}));

// Scorecard fournisseur (même source que data/supplier-scorecard.csv).
// [id, OTIF %, défauts %, lead time j, capacité confirmée %]
const SCORECARD = [
  ["SUP-001", 91.2, 1.4, 18, 84], ["SUP-002", 97.8, 0.6, 9, 96], ["SUP-003", 72.4, 4.8, 43, 61],
  ["SUP-004", 98.1, 0.4, 7, 92], ["SUP-005", 93.5, 1.1, 12, 78], ["SUP-006", 81.7, 2.9, 21, 58],
  ["SUP-007", 99.0, 0.3, 5, 97], ["SUP-008", 88.4, 1.9, 16, 71], ["SUP-009", 96.2, 0.7, 10, 90],
  ["SUP-010", 69.8, 3.6, 38, 52], ["SUP-011", 84.3, 2.4, 34, 64], ["SUP-012", 97.1, 0.5, 8, 88],
  ["SUP-013", 86.0, 5.7, 14, 79], ["SUP-014", 98.6, 0.4, 11, 95], ["SUP-015", 94.4, 0.9, 29, 83],
].map(([supplierId, otifPct, defectRatePct, leadTimeDays, confirmedCapacityPct]) => ({
  supplierId, supplier: supplierName(supplierId), period: "2026-09", otifPct, defectRatePct, leadTimeDays, confirmedCapacityPct,
}));

// ── Articles (20 SKU) ────────────────────────────────────────────────────
// [sku, description, famille, unité, coût standard €, marge brute %, fournisseur principal, alternatif, délai j]
const MATERIALS = [
  ["BOX-PREMIUM", "Coffret cadeau premium gainé", "Emballage luxe", "EA", 18.4, 42, "SUP-001", "SUP-004", 18],
  ["BAG-ORION", "Sac Orion cuir grainé", "Maroquinerie", "EA", 42.8, 58, "SUP-002", "SUP-005", 9],
  ["CLASP-AURORA", "Fermoir Aurora laiton doré", "Accessoires métal", "EA", 3.2, 35, "SUP-003", "SUP-015", 43],
  ["PCH-NOVA", "Pochette Nova toile enduite", "Emballage luxe", "EA", 1.9, 49, "SUP-004", null, 7],
  ["BAG-LUNA", "Sac Luna veau lisse", "Maroquinerie", "EA", 36.7, 51, "SUP-005", "SUP-012", 12],
  ["BUCKLE-ATLAS", "Boucle Atlas palladium", "Accessoires métal", "EA", 2.6, 33, "SUP-006", "SUP-015", 21],
  ["LINING-RIVE", "Doublure Rive coton-soie", "Textile", "M", 4.1, 46, "SUP-007", null, 5],
  ["SCARF-AZUR", "Carré Azur twill de soie 90", "Textile", "EA", 38, 64, "SUP-009", null, 10],
  ["SCARF-SOIE-MIRA", "Étole Mira mousseline de soie", "Textile", "EA", 52, 68, "SUP-009", "SUP-007", 10],
  ["BELT-VEGA", "Ceinture Vega réversible", "Maroquinerie", "EA", 29, 61, "SUP-012", "SUP-008", 8],
  ["WALLET-CELESTE", "Portefeuille Céleste compact", "Petite maroquinerie", "EA", 24, 66, "SUP-012", "SUP-005", 8],
  ["BAG-SIRIUS", "Sac Sirius cuir pleine fleur", "Maroquinerie", "EA", 118, 63, "SUP-010", "SUP-002", 38],
  ["TOTE-ETOILE", "Cabas Étoile toile & cuir", "Maroquinerie", "EA", 64, 57, "SUP-008", "SUP-012", 16],
  ["GLOVE-NUIT", "Gants Nuit agneau doublés cachemire", "Textile & cuir", "PR", 31, 59, "SUP-005", null, 12],
  ["STRAP-COMETE", "Bandoulière Comète amovible", "Composants", "EA", 5.4, 38, "SUP-011", "SUP-008", 34],
  ["ZIP-ARGENT", "Fermeture éclair Argent 20 cm", "Composants", "EA", 0.9, 31, "SUP-013", "SUP-003", 14],
  ["THREAD-OR", "Fil de couture doré polyester-lurex", "Composants", "BOB", 2.2, 29, "SUP-007", null, 5],
  ["LEATHER-VEAU-NOIR", "Peau de veau noir box calf", "Matière première", "M2", 46, 22, "SUP-002", "SUP-010", 9],
  ["SHAWL-CACHEMIRE", "Châle cachemire tissé main", "Textile", "EA", 140, 62, "SUP-014", null, 11],
  ["CARD-HOLDER-ALBA", "Porte-cartes Alba", "Petite maroquinerie", "EA", 11, 71, "SUP-012", "SUP-005", 8],
].map(([sku, description, family, uom, standardCostEur, grossMarginPct, primarySupplierId, alternateSupplierId, leadTimeDays]) => ({
  sku, description, family, uom, standardCostEur, grossMarginPct,
  sellingPriceEur: Math.round((standardCostEur / (1 - grossMarginPct / 100)) * 100) / 100,
  primarySupplierId, alternateSupplierId, leadTimeDays,
}));
const material = sku => MATERIALS.find(m => m.sku === sku);

// ── Sites ────────────────────────────────────────────────────────────────
const SITES = [
  ["WH-PAR", "Entrepôt Paris-Nord (Gonesse)", "WAREHOUSE", "Gonesse", "FR", 42000],
  ["WH-LIL", "Entrepôt Lille-Lesquin", "WAREHOUSE", "Lesquin", "FR", 26000],
  ["WH-MIL", "Hub Milan-Malpensa", "WAREHOUSE", "Milan", "IT", 18000],
  ["WH-LYO", "Entrepôt Lyon-Saint-Priest", "WAREHOUSE", "Saint-Priest", "FR", 21000],
  ["WH-MRS", "Hub import Marseille-Fos", "WAREHOUSE", "Fos-sur-Mer", "FR", 30000],
  ["FAC-VEN", "Atelier de maroquinerie de Vendôme", "WORKSHOP", "Vendôme", "FR", 6000],
  ["FAC-FLO", "Atelier partenaire Florence", "WORKSHOP", "Florence", "IT", 4500],
  ["BTQ-PAR-FSH", "Boutique Paris Faubourg", "STORE", "Paris", "FR", 900],
  ["BTQ-MIL-MTN", "Boutique Milan Montenapoleone", "STORE", "Milan", "IT", 700],
  ["BTQ-TYO-GNZ", "Boutique Tokyo Ginza", "STORE", "Tokyo", "JP", 650],
  ["BTQ-NYC-5AV", "Boutique New York Fifth Avenue", "STORE", "New York", "US", 800],
  ["BTQ-DXB-MOE", "Boutique Dubaï Mall of the Emirates", "STORE", "Dubaï", "AE", 550],
].map(([siteId, name, type, city, country, capacityUnits]) => ({ siteId, name, type, city, country, capacityUnits }));

// ── Stocks ───────────────────────────────────────────────────────────────
// Champs ajoutés aux positions historiques : inTransit, lastCountAt.
const INVENTORY_EXTRA = {
  "BOX-PREMIUM@WH-PAR": { inTransit: 2400 }, "BAG-ORION@WH-LIL": { inTransit: 750 },
  "CLASP-AURORA@WH-PAR": { inTransit: 8000 }, "PCH-NOVA@WH-LIL": { inTransit: 5200 },
  "BAG-LUNA@WH-MIL": { inTransit: 980 }, "BUCKLE-ATLAS@WH-PAR": { inTransit: 12400 },
  "LINING-RIVE@WH-LYO": { inTransit: 6400 },
};
// [sku, site, stock physique, réservé, stock de sécurité, demande/jour, en transit]
const NEW_INVENTORY = [
  ["SCARF-AZUR", "WH-PAR", 820, 190, 400, 95, 1500],
  ["SCARF-SOIE-MIRA", "WH-MIL", 260, 140, 180, 48, 900],
  ["BELT-VEGA", "WH-LYO", 1450, 310, 600, 70, 0],
  ["WALLET-CELESTE", "WH-PAR", 980, 420, 500, 85, 2000],
  ["BAG-SIRIUS", "WH-PAR", 140, 95, 120, 22, 320],
  ["TOTE-ETOILE", "WH-LIL", 640, 120, 300, 40, 600],
  ["GLOVE-NUIT", "WH-MIL", 380, 60, 200, 18, 450],
  ["STRAP-COMETE", "WH-MRS", 5200, 3900, 2000, 610, 9000],
  ["ZIP-ARGENT", "WH-MRS", 21000, 9000, 8000, 1100, 40000],
  ["THREAD-OR", "WH-LYO", 3400, 800, 1500, 150, 4000],
  ["LEATHER-VEAU-NOIR", "FAC-VEN", 2600, 1900, 1200, 240, 4800],
  ["SHAWL-CACHEMIRE", "WH-PAR", 210, 40, 120, 9, 260],
  ["CARD-HOLDER-ALBA", "WH-LIL", 1200, 300, 450, 60, 0],
  ["BAG-ORION", "BTQ-PAR-FSH", 24, 6, 20, 3, 12],
  ["BOX-PREMIUM", "BTQ-TYO-GNZ", 60, 20, 40, 12, 0],
  ["BAG-LUNA", "BTQ-NYC-5AV", 35, 12, 30, 6, 0],
  ["SCARF-AZUR", "BTQ-DXB-MOE", 44, 8, 25, 4, 0],
].map(([sku, siteId, onHand, reserved, safetyStock, dailyDemand, inTransit]) => {
  const available = onHand - reserved;
  return { sku, siteId, onHand, reserved, available, safetyStock, dailyDemand, daysOfCover: round1(available / dailyDemand), inTransit };
});

// ── Commandes d'achat ────────────────────────────────────────────────────
const PO_EXTRA = {
  "PO-1042": { destinationSiteId: "WH-PAR", incoterm: "DAP", confirmedQuantity: 2000 },
  "PO-1043": { destinationSiteId: "WH-PAR", incoterm: "FOB", confirmedQuantity: 5600 },
  "PO-1044": { destinationSiteId: "WH-LIL", incoterm: "DAP", confirmedQuantity: 750 },
  "PO-1045": { destinationSiteId: "WH-LIL", incoterm: "DAP", confirmedQuantity: 5200 },
  "PO-1046": { destinationSiteId: "WH-MIL", incoterm: "DAP", confirmedQuantity: 900 },
  "PO-1047": { destinationSiteId: "WH-PAR", incoterm: "CIF", confirmedQuantity: 9800 },
  "PO-1048": { destinationSiteId: "WH-LYO", incoterm: "DAP", confirmedQuantity: 6400 },
};
// [po, fournisseur, sku, qté, date demandée, statut, site, incoterm, qté confirmée]
const NEW_POS = [
  ["PO-1049", "SUP-008", "TOTE-ETOILE", 600, "2026-10-15", "CONFIRMED", "WH-LIL", "DAP", 600],
  ["PO-1050", "SUP-009", "SCARF-AZUR", 1500, "2026-10-09", "CONFIRMED", "WH-PAR", "DAP", 1500],
  ["PO-1051", "SUP-009", "SCARF-SOIE-MIRA", 900, "2026-10-04", "RELEASED", "WH-MIL", "DAP", 900],
  ["PO-1052", "SUP-010", "BAG-SIRIUS", 320, "2026-10-03", "AT_RISK", "WH-PAR", "CPT", 210],
  ["PO-1053", "SUP-010", "LEATHER-VEAU-NOIR", 3000, "2026-10-10", "AT_RISK", "FAC-VEN", "CIF", 2100],
  ["PO-1054", "SUP-011", "STRAP-COMETE", 9000, "2026-10-05", "AT_RISK", "WH-MRS", "FOB", 6800],
  ["PO-1055", "SUP-012", "BELT-VEGA", 1100, "2026-10-20", "PLANNED", "WH-LYO", "DAP", 0],
  ["PO-1056", "SUP-012", "WALLET-CELESTE", 2000, "2026-10-16", "CONFIRMED", "WH-PAR", "DAP", 2000],
  ["PO-1057", "SUP-012", "CARD-HOLDER-ALBA", 1800, "2026-10-22", "PLANNED", "WH-LIL", "DAP", 0],
  ["PO-1058", "SUP-013", "ZIP-ARGENT", 40000, "2026-10-06", "QUALITY_HOLD", "WH-MRS", "CIF", 40000],
  ["PO-1059", "SUP-014", "SHAWL-CACHEMIRE", 260, "2026-10-18", "CONFIRMED", "WH-PAR", "DAP", 260],
  ["PO-1060", "SUP-015", "BUCKLE-ATLAS", 6000, "2026-10-12", "RELEASED", "WH-LYO", "FOB", 6000],
  ["PO-1061", "SUP-007", "THREAD-OR", 4000, "2026-10-09", "CONFIRMED", "WH-LYO", "DAP", 4000],
  ["PO-1062", "SUP-005", "GLOVE-NUIT", 450, "2026-10-14", "CONFIRMED", "WH-MIL", "DAP", 450],
  ["PO-1063", "SUP-002", "LEATHER-VEAU-NOIR", 1800, "2026-10-07", "CONFIRMED", "FAC-VEN", "DAP", 1800],
  ["PO-1064", "SUP-003", "CLASP-AURORA", 5000, "2026-10-13", "PLANNED", "WH-PAR", "FOB", 0],
].map(([purchaseOrderId, supplierId, sku, quantity, requestedDate, status, destinationSiteId, incoterm, confirmedQuantity]) => ({
  purchaseOrderId, supplierId, supplier: supplierName(supplierId), sku, quantity,
  unitCost: material(sku).standardCostEur, currency: "EUR", requestedDate, status, destinationSiteId, incoterm, confirmedQuantity,
}));

// ── Expéditions ──────────────────────────────────────────────────────────
// Champs ajoutés : mode, route, originPort, destinationPort, plannedEta (= eta − retard), disruptionId.
const SHIPMENT_EXTRA = {
  "SHP-882": { mode: "ROAD", route: "Milan → Mont-Blanc → Paris", originPort: null, destinationPort: null, disruptionId: "DIS-006" },
  "SHP-883": { mode: "SEA", route: "Yantian → Suez → Le Havre → Paris", originPort: "CNYTN", destinationPort: "FRLEH", disruptionId: "DIS-001" },
  "SHP-884": { mode: "ROAD", route: "Lille → Paris (A1)", originPort: null, destinationPort: null, disruptionId: null },
  "SHP-885": { mode: "ROAD", route: "Stockholm → Trelleborg → Rostock → Lille", originPort: "SETRG", destinationPort: "DERSK", disruptionId: null },
  "SHP-886": { mode: "ROAD", route: "Porto → Irun → Paris", originPort: null, destinationPort: null, disruptionId: null },
  "SHP-887": { mode: "SEA", route: "Radès → Marseille-Fos", originPort: "TNRAD", destinationPort: "FRFOS", disruptionId: "DIS-002" },
  "SHP-888": { mode: "ROAD", route: "Lyon → Lille (A1/A26)", originPort: null, destinationPort: null, disruptionId: null },
};
// [id, po, transporteur, origine, destination, eta, retard h, statut, mode, route, port origine, port destination, perturbation]
const NEW_SHIPMENTS = [
  ["SHP-889", "PO-1049", "TransAnatolia", "Istanbul", "Lille", "2026-10-15T14:00:00Z", 12, "WATCH", "ROAD", "Istanbul → Kapıkule → Munich → Lille", null, null, null],
  ["SHP-890", "PO-1050", "EuroFreight", "Côme", "Paris", "2026-10-09T09:00:00Z", 0, "ON_TIME", "ROAD", "Côme → Fréjus → Paris", null, null, null],
  ["SHP-891", "PO-1051", "EuroFreight", "Côme", "Milan", "2026-10-04T11:00:00Z", 6, "ON_TIME", "ROAD", "Côme → Milan", null, null, null],
  ["SHP-892", "PO-1052", "IndoAir Cargo", "Delhi", "Paris", "2026-10-04T07:00:00Z", 30, "DELAYED", "AIR", "DEL → CDG", "INDEL", "FRCDG", "DIS-003"],
  ["SHP-893", "PO-1053", "AsiaBridge", "Chennai", "Vendôme", "2026-10-12T06:00:00Z", 96, "CRITICAL", "SEA", "Chennai → Suez → Le Havre → Vendôme", "INMAA", "FRLEH", "DIS-001"],
  ["SHP-894", "PO-1054", "MekongLines", "Hô Chi Minh-Ville", "Marseille", "2026-10-09T18:00:00Z", 60, "CRITICAL", "SEA", "Cat Lai → Cap de Bonne-Espérance → Marseille-Fos", "VNCLI", "FRFOS", "DIS-005"],
  ["SHP-895", "PO-1058", "AtlasMaritime", "Casablanca", "Marseille", "2026-10-06T10:00:00Z", 8, "ON_HOLD", "SEA", "Casablanca → Marseille-Fos", "MACAS", "FRFOS", "DIS-004"],
  ["SHP-896", "PO-1059", "IberiaCargo", "Pampelune", "Paris", "2026-10-18T08:00:00Z", 0, "ON_TIME", "ROAD", "Pampelune → Bordeaux → Paris", null, null, null],
  ["SHP-897", "PO-1060", "KoreaExpress", "Busan", "Lyon", "2026-10-12T15:00:00Z", 20, "WATCH", "SEA", "Busan → Rotterdam → Lyon (barge + route)", "KRPUS", "NLRTM", null],
  ["SHP-898", "PO-1061", "RhôneExpress", "Lyon", "Lyon", "2026-10-09T08:00:00Z", 0, "ON_TIME", "ROAD", "Lyon intra-site", null, null, null],
  ["SHP-899", "PO-1063", "NordLog", "Roubaix", "Vendôme", "2026-10-07T13:00:00Z", 2, "ON_TIME", "ROAD", "Roubaix → Paris → Vendôme", null, null, null],
  ["SHP-900", "PO-1056", "EuroFreight", "Florence", "Paris", "2026-10-16T09:00:00Z", 0, "ON_TIME", "ROAD", "Florence → Fréjus → Paris", null, null, null],
].map(([shipmentId, purchaseOrderId, carrier, origin, destination, eta, delayHours, status, mode, route, originPort, destinationPort, disruptionId]) => ({
  shipmentId, purchaseOrderId, carrier, origin, destination, eta, delayHours, status, mode, route, originPort, destinationPort, disruptionId,
}));
const plannedEta = (eta, delayHours) => new Date(Date.parse(eta) - delayHours * 3600000).toISOString().replace(".000Z", "Z");

// ── Perturbations ────────────────────────────────────────────────────────
const DISRUPTIONS = [
  { disruptionId: "DIS-001", type: "PORT_STRIKE", title: "Grève des dockers — port du Havre", location: "Le Havre (FRLEH)", startedAt: "2026-09-24T06:00:00Z", expectedEndAt: "2026-10-01T18:00:00Z", severity: "CRITICAL", status: "ACTIVE", impactedShipments: ["SHP-883", "SHP-893"], impactedSuppliers: ["SUP-003", "SUP-010"], impactedSkus: ["CLASP-AURORA", "LEATHER-VEAU-NOIR"], estimatedDelayHours: 96 },
  { disruptionId: "DIS-002", type: "CUSTOMS_DELAY", title: "Contrôle douanier renforcé — Marseille-Fos (origine métal)", location: "Marseille-Fos (FRFOS)", startedAt: "2026-09-25T08:00:00Z", expectedEndAt: "2026-10-03T12:00:00Z", severity: "MAJOR", status: "ACTIVE", impactedShipments: ["SHP-887"], impactedSuppliers: ["SUP-006"], impactedSkus: ["BUCKLE-ATLAS"], estimatedDelayHours: 54 },
  { disruptionId: "DIS-003", type: "CUSTOMS_DELAY", title: "Documents CITES incomplets — fret aérien cuir", location: "Paris-CDG (FRCDG)", startedAt: "2026-09-26T05:00:00Z", expectedEndAt: "2026-09-29T17:00:00Z", severity: "MAJOR", status: "ACTIVE", impactedShipments: ["SHP-892"], impactedSuppliers: ["SUP-010"], impactedSkus: ["BAG-SIRIUS"], estimatedDelayHours: 30 },
  { disruptionId: "DIS-004", type: "QUALITY_DEFECT", title: "Défaut de placage — lot ZIP-ARGENT L4471", location: "Casablanca (SUP-013)", startedAt: "2026-09-23T10:00:00Z", expectedEndAt: "2026-10-08T00:00:00Z", severity: "MAJOR", status: "ACTIVE", impactedShipments: ["SHP-895"], impactedSuppliers: ["SUP-013"], impactedSkus: ["ZIP-ARGENT"], estimatedDelayHours: 0 },
  { disruptionId: "DIS-005", type: "ROUTE_DISRUPTION", title: "Déroutement mer Rouge via le Cap", location: "Mer Rouge / Suez", startedAt: "2026-09-10T00:00:00Z", expectedEndAt: null, severity: "MAJOR", status: "ACTIVE", impactedShipments: ["SHP-894"], impactedSuppliers: ["SUP-011"], impactedSkus: ["STRAP-COMETE"], estimatedDelayHours: 60 },
  { disruptionId: "DIS-006", type: "WEATHER", title: "Fermeture temporaire tunnel du Mont-Blanc (neige)", location: "Chamonix / Courmayeur", startedAt: "2026-09-25T02:00:00Z", expectedEndAt: "2026-09-26T20:00:00Z", severity: "MINOR", status: "RESOLVED", impactedShipments: ["SHP-882"], impactedSuppliers: ["SUP-001"], impactedSkus: ["BOX-PREMIUM"], estimatedDelayHours: 36 },
  { disruptionId: "DIS-007", type: "CAPACITY_SHORTFALL", title: "Maintenance métiers à tisser — Tessitura Milano", location: "Milan (SUP-001)", startedAt: "2026-09-22T00:00:00Z", expectedEndAt: "2026-10-06T00:00:00Z", severity: "CRITICAL", status: "ACTIVE", impactedShipments: [], impactedSuppliers: ["SUP-001"], impactedSkus: ["BOX-PREMIUM"], estimatedDelayHours: 0 },
];

// ── Promotions & prévisions ──────────────────────────────────────────────
const PROMOTIONS = [
  { promotionId: "PROMO-2026-VIC", name: "Vente privée clients VIC", channel: "Boutiques + clienteling", startWeek: "2026-W40", endWeek: "2026-W40", upliftPct: 25, skus: ["BOX-PREMIUM", "CLASP-AURORA", "BAG-LUNA", "BUCKLE-ATLAS"] },
  { promotionId: "PROMO-2026-FET", name: "Pré-collection des fêtes", channel: "Omnicanal", startWeek: "2026-W41", endWeek: "2026-W42", upliftPct: 35, skus: ["BOX-PREMIUM", "BAG-LUNA", "SCARF-SOIE-MIRA", "WALLET-CELESTE", "CARD-HOLDER-ALBA"] },
  { promotionId: "PROMO-2026-ASIA", name: "Lancement capsule Tokyo Ginza", channel: "Boutique BTQ-TYO-GNZ", startWeek: "2026-W41", endWeek: "2026-W41", upliftPct: 18, skus: ["BAG-SIRIUS", "SCARF-AZUR"] },
];
const promoFor = (sku, week) => PROMOTIONS.find(p => p.skus.includes(sku) && week >= p.startWeek && week <= p.endWeek) ?? null;

// Baseline W40 des nouveaux SKU (demande hebdomadaire).
const NEW_W40_BASELINE = {
  "SCARF-AZUR": 640, "SCARF-SOIE-MIRA": 330, "BELT-VEGA": 470, "WALLET-CELESTE": 560, "BAG-SIRIUS": 150,
  "TOTE-ETOILE": 270, "GLOVE-NUIT": 120, "STRAP-COMETE": 4100, "ZIP-ARGENT": 7600, "THREAD-OR": 1050,
  "LEATHER-VEAU-NOIR": 1650, "SHAWL-CACHEMIRE": 60, "CARD-HOLDER-ALBA": 410,
};
const HISTORICAL_W40 = { "BOX-PREMIUM": 930, "BAG-ORION": 220, "CLASP-AURORA": 3300, "PCH-NOVA": 1180, "BAG-LUNA": 310, "BUCKLE-ATLAS": 5600, "LINING-RIVE": 2450 };

function buildForecasts() {
  const rng = mulberry32(20261);
  const rows = [];
  for (const [sku, baseline] of Object.entries(NEW_W40_BASELINE)) {
    const promo = promoFor(sku, "2026-W40");
    const noise = 0.97 + rng() * 0.06;
    rows.push({
      sku, week: "2026-W40", baseline, promoted: Math.round(baseline * (promo ? 1 + promo.upliftPct / 100 : noise)),
      forecastConfidence: Math.round((0.62 + rng() * 0.33) * 100) / 100, grossMarginPct: material(sku).grossMarginPct, promotionId: promo?.promotionId ?? null,
    });
  }
  const allW40 = { ...HISTORICAL_W40, ...NEW_W40_BASELINE };
  for (const week of ["2026-W41", "2026-W42"]) {
    for (const [sku, w40] of Object.entries(allW40)) {
      const promo = promoFor(sku, week);
      const baseline = Math.round(w40 * (0.94 + rng() * 0.14));
      rows.push({
        sku, week, baseline, promoted: Math.round(baseline * (promo ? 1 + promo.upliftPct / 100 : 0.98 + rng() * 0.04)),
        forecastConfidence: Math.round((week === "2026-W41" ? 0.6 + rng() * 0.3 : 0.55 + rng() * 0.3) * 100) / 100,
        grossMarginPct: material(sku).grossMarginPct, promotionId: promo?.promotionId ?? null,
      });
    }
  }
  return rows;
}

// ── Commandes clients, évènements ────────────────────────────────────────
const NEW_ORDERS = [
  ["ORD-7008", "Boutique Tokyo Ginza", "BAG-SIRIUS", 18, "BACKORDERED", "2026-10-05", "BTQ-TYO-GNZ"],
  ["ORD-7009", "Boutique New York Fifth Avenue", "SCARF-SOIE-MIRA", 40, "ALLOCATED", "2026-10-06", "BTQ-NYC-5AV"],
  ["ORD-7010", "Boutique Dubaï Mall of the Emirates", "SHAWL-CACHEMIRE", 12, "ALLOCATED", "2026-10-09", "BTQ-DXB-MOE"],
  ["ORD-7011", "Boutique Paris Faubourg", "WALLET-CELESTE", 90, "PLANNED", "2026-10-12", "BTQ-PAR-FSH"],
  ["ORD-7012", "Atelier de Vendôme", "LEATHER-VEAU-NOIR", 700, "BACKORDERED", "2026-10-04", "FAC-VEN"],
  ["ORD-7013", "Boutique Milan Montenapoleone", "BELT-VEGA", 60, "ALLOCATED", "2026-10-08", "BTQ-MIL-MTN"],
  ["ORD-7014", "E-commerce Europe", "CARD-HOLDER-ALBA", 240, "PLANNED", "2026-10-14", "WH-LIL"],
  ["ORD-7015", "Atelier partenaire Florence", "STRAP-COMETE", 1600, "BACKORDERED", "2026-10-06", "FAC-FLO"],
].map(([orderId, customer, sku, quantity, status, requestedDate, shipToSiteId]) => ({ orderId, customer, sku, quantity, status, requestedDate, shipToSiteId }));

const NEW_EVENTS = [
  ["evt-9008", "port.strike.declared", "lucie-luminate-transport", "DIS-001", "2026-09-24T06:05:00Z", "critical"],
  ["evt-9009", "customs.hold.detected", "lucie-luminate-transport", "SHP-892", "2026-09-26T05:12:00Z", "major"],
  ["evt-9010", "quality.defect.reported", "lucie-spendguard", "SUP-013", "2026-09-26T07:02:00Z", "major"],
  ["evt-9011", "supplier.risk.changed", "lucie-spendguard", "SUP-010", "2026-09-26T07:15:00Z", "critical"],
  ["evt-9012", "inventory.cover.breached", "lucie-active-warehouse", "BAG-SIRIUS@WH-PAR", "2026-09-26T07:40:00Z", "critical"],
  ["evt-9013", "shipment.delay.detected", "lucie-luminate-transport", "SHP-893", "2026-09-26T08:05:00Z", "critical"],
  ["evt-9014", "promotion.launched", "lucie-data-cloud", "PROMO-2026-FET", "2026-09-26T09:00:00Z", "info"],
  ["evt-9015", "shipment.eta.confirmed", "lucie-luminate-transport", "SHP-890", "2026-09-26T09:20:00Z", "info"],
].map(([id, type, source, subject, time, severity]) => ({ id, type, source, subject, time, severity }));

// Topic historique Kafka : on y republie les nouveaux évènements (offsets continus).
const newKafkaMessages = startOffset => NEW_EVENTS.map((event, index) => ({
  offset: startOffset + index, topic: "lucie.supplychain.events", key: event.subject,
  value: { type: event.type, severity: event.severity }, headers: { traceId: `tr-${event.id.slice(4)}` }, publishedAt: event.time,
}));

const NEW_SOAP_OPERATIONS = [
  { operation: "GetRecords", wsdl: "/api/soap?wsdl", status: "AVAILABLE", lastCallAt: "2026-09-26T09:30:00Z" },
  { operation: "GetShipments", wsdl: "/api/soap?wsdl&app=blueyonder-tms", status: "AVAILABLE", lastCallAt: "2026-09-26T09:31:00Z" },
  { operation: "GetSupplierRiskAssessments", wsdl: "/api/soap?wsdl&app=coupa-risk", status: "AVAILABLE", lastCallAt: "2026-09-26T09:32:00Z" },
];

/** Applique l'enrichissement (mutation en place du seed `datasets`). */
export function enrichDatasets(datasets) {
  const merge = (rows, keyOf, extra) => rows.forEach(row => Object.assign(row, extra[keyOf(row)] || {}));

  const sap = datasets["sap-s4"];
  merge(sap.records, row => row.purchaseOrderId, PO_EXTRA);
  sap.records.push(...NEW_POS);
  sap.records.forEach(row => { row.orderValueEur = Math.round(row.quantity * row.unitCost * 100) / 100; row.supplierCountry = supplierCountry(row.supplierId); });
  sap.tables = { Supplier: SUPPLIERS, Material: MATERIALS };

  const wms = datasets["manhattan-wms"];
  merge(wms.records, row => `${row.sku}@${row.siteId}`, INVENTORY_EXTRA);
  wms.records.push(...NEW_INVENTORY);
  wms.records.forEach(row => { row.belowSafetyStock = row.available < row.safetyStock; row.lastCountAt = "2026-09-26T05:00:00Z"; });
  wms.tables = { Site: SITES };

  const tms = datasets["blueyonder-tms"];
  merge(tms.records, row => row.shipmentId, SHIPMENT_EXTRA);
  tms.records.push(...NEW_SHIPMENTS);
  tms.records.forEach(row => { row.plannedEta = plannedEta(row.eta, row.delayHours); });
  tms.tables = { Disruption: DISRUPTIONS };

  const risk = datasets["coupa-risk"];
  merge(risk.records, row => row.supplierId, RISK_EXTRA);
  risk.records.push(...NEW_RISKS);
  risk.records.forEach(row => { row.country = supplierCountry(row.supplierId); row.assessedAt = "2026-09-26"; });
  risk.tables = { SupplierScorecard: SCORECARD };

  const demand = datasets["snowflake-demand"];
  demand.records.forEach(row => { const promo = row.promoted > row.baseline * 1.1 ? promoFor(row.sku, row.week) : null; row.promotionId = promo?.promotionId ?? null; });
  demand.records.push(...buildForecasts());
  demand.tables = { Promotion: PROMOTIONS };

  datasets["mulesoft-events"].records.push(...NEW_EVENTS);
  datasets["rest-order-management"].records.push(...NEW_ORDERS);
  const kafka = datasets["kafka-stream"];
  kafka.records.push(...newKafkaMessages(kafka.records.length));
  datasets["legacy-soap"].records.push(...NEW_SOAP_OPERATIONS);

  for (const dataset of Object.values(datasets)) dataset.synthetic = true;
  return datasets;
}

/** CSV historiques (colonnes inchangées, lignes historiques en tête). */
export function legacyCsvFiles(datasets) {
  const forecasts = datasets["snowflake-demand"].records;
  const inventory = datasets["manhattan-wms"].records;
  const siteOf = sku => inventory.find(row => row.sku === sku)?.siteId ?? "WH-PAR";
  const head = [["SCARF-AZUR", "WH-PAR", "2026-W40", 665, 82], ["BOX-PREMIUM", "WH-PAR", "2026-W40", 1120, 74], ["BAG-ORION", "WH-LIL", "2026-W40", 252, 88]];
  const seen = new Set(head.map(row => `${row[0]}|${row[2]}`));
  const rest = forecasts.filter(row => !seen.has(`${row.sku}|${row.week}`)).map(row => [row.sku, siteOf(row.sku), row.week, row.promoted, Math.round(row.forecastConfidence * 100)]);
  const demandCsv = ["sku,site_id,week,forecast_qty,confidence_pct", ...[...head, ...rest].map(row => row.join(","))].join("\n") + "\n";
  const scorecardCsv = ["supplier_id,period,otif_pct,defect_rate_pct,lead_time_days,confirmed_capacity_pct",
    ...SCORECARD.map(row => [row.supplierId, row.period, row.otifPct, row.defectRatePct, row.leadTimeDays, row.confirmedCapacityPct].join(","))].join("\n") + "\n";
  return { "demand-forecast.csv": demandCsv, "supplier-scorecard.csv": scorecardCsv };
}

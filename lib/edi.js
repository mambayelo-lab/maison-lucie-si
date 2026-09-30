// EDI et IDoc simulés, sur les structures réelles (voir docs/SOURCES-MULTI.md,
// section « EDI, IDoc et AS2 : ce qui est simplifié ») :
// - UN/EDIFACT D.96A : ORDERS (commande d'achat), DESADV (avis d'expédition), INVOIC (facture) ;
// - ANSI ASC X12 004010 : 850 (commande), 856 (avis d'expédition), 810 (facture) ;
// - SAP IDoc XML : ORDERS05, DESADV01, CREMAS05, MATMAS05 (enregistrement de contrôle EDI_DC40) ;
// - AS2 (RFC 4130) : en-têtes, MIC SHA-256 et MDN synchrone ; sans signature ni chiffrement S/MIME.
// Chaque document est dérivé ligne à ligne des tables de la taille démo.
import { createHash } from "node:crypto";
import { AS_OF, allRows, findResource, xmlEscape } from "./channels.js";

const T = name => allRows(findResource(...name.split("/")));
const d8 = v => String(v ?? "").slice(0, 10).replace(/-/g, "");            // CCYYMMDD
const d6 = v => d8(v).slice(2);                                             // YYMMDD
const PREP = `${d6(AS_OF)}:0200`;
const SENDER = "MAISONLUCIE", RECEIVER = "AURASUPPLY";

// ── Prix : listPrice du PIM pour la référence interne (INVOIC / 810 dérivés) ─
let priceIndex = null;
const priceOf = ref => { priceIndex ??= new Map(T("pim/products").map(p => [p.internalRef, p.listPrice])); return priceIndex.get(ref) ?? null; };

// Modes de transport : code UN/ECE Rec. 19 (EDIFACT 8067) et X12 TD504.
export const MODE_EDIFACT = { MARITIME: "1", FERROVIAIRE: "2", ROUTE: "3", AERIEN: "4" };
export const MODE_X12 = { MARITIME: "S", FERROVIAIRE: "R", ROUTE: "M", AERIEN: "A" };

// ═════════════════════════════════════════════════════════════════════════
// UN/EDIFACT (syntaxe ISO 9735, niveau UNOC, répertoire D.96A)
// ═════════════════════════════════════════════════════════════════════════
const esc = v => String(v ?? "").replace(/([?+:'])/g, "?$1");
const seg = (...els) => `${els.map(e => (Array.isArray(e) ? e.map(esc).join(":") : esc(e))).join("+").replace(/\+*$/, "")}'`;

function ordersMsg(po, ref) {
  return [
    seg("UNH", ref, ["ORDERS", "D", "96A", "UN"]),
    seg("BGM", "220", po.PurchaseOrder, "9"),
    seg("DTM", ["137", d8(po.LastChangeDateTime), "102"]),
    seg("NAD", "BY", [SENDER, "", "92"]),
    seg("NAD", "SU", [po.Supplier, "", "92"]),
    seg("CUX", ["2", po.DocumentCurrency, "9"]),
    seg("LIN", po.PurchaseOrderItem, "", [po.Material, "IN"]),
    seg("QTY", ["21", po.OrderQuantity]),
    seg("DTM", ["2", d8(po.ScheduleLineDeliveryDate), "102"]),
    seg("UNS", "S"),
    seg("CNT", ["2", "1"]),
  ];
}
function desadvMsg(s, ref) {
  return [
    seg("UNH", ref, ["DESADV", "D", "96A", "UN"]),
    seg("BGM", "351", s.ShipmentId, "9"),
    seg("DTM", ["137", d8(s.UpdatedTimestamp), "102"]),
    seg("DTM", ["132", d8(s.ExpectedDate), "102"]),
    ...(s.ActualDate ? [seg("DTM", ["35", d8(s.ActualDate), "102"])] : []),
    seg("RFF", ["ON", s.PurchaseOrderRef]),
    seg("NAD", "SU", "", "", s.OriginName),
    seg("NAD", "ST", [s.DestinationFacility, "", "92"]),
    seg("TDT", "20", "", MODE_EDIFACT[s.TransportMode] ?? "", "", ["", "", "", s.Carrier]),
    seg("CPS", "1"),
    seg("LIN", "1", "", [s.ItemId, "SRV"]),
    seg("QTY", ["12", s.Quantity]),
  ];
}
function invoicMsg(po, ref) {
  const price = priceOf(po.Material), amount = Math.round(price * po.OrderQuantity * 100) / 100;
  return [
    seg("UNH", ref, ["INVOIC", "D", "96A", "UN"]),
    seg("BGM", "380", `INV${po.PurchaseOrder}`, "9"),
    seg("DTM", ["137", d8(po.LastChangeDateTime), "102"]),
    seg("RFF", ["ON", po.PurchaseOrder]),
    seg("NAD", "SU", [po.Supplier, "", "92"]),
    seg("NAD", "BY", [SENDER, "", "92"]),
    seg("CUX", ["2", po.DocumentCurrency, "4"]),
    seg("LIN", po.PurchaseOrderItem, "", [po.Material, "IN"]),
    seg("QTY", ["47", po.OrderQuantity]),
    seg("MOA", ["203", amount.toFixed(2)]),
    seg("PRI", ["AAA", price.toFixed(2)]),
    seg("UNS", "S"),
    seg("MOA", ["86", amount.toFixed(2)]),
  ];
}
export const EDIFACT_TYPES = {
  ORDERS: { source: "sap/A_PurchaseOrderItem", build: ordersMsg, rows: () => T("sap/A_PurchaseOrderItem") },
  DESADV: { source: "tms/shipments", build: desadvMsg, rows: () => T("tms/shipments") },
  INVOIC: { source: "sap/A_PurchaseOrderItem", build: invoicMsg, rows: () => T("sap/A_PurchaseOrderItem").filter(p => priceOf(p.Material) !== null) },
};
/** Échange UNB…UNZ contenant un message par ligne (offset/limit). */
export function edifact(type, offset = 0, limit = 100) {
  const t = EDIFACT_TYPES[type];
  if (!t) return null;
  const all = t.rows(), page = all.slice(offset, offset + limit), icr = String(10000 + offset).slice(-9);
  const msgs = page.map((row, i) => { const body = t.build(row, String(i + 1)); return [...body, seg("UNT", String(body.length + 1), String(i + 1))].join("\n"); });
  const text = ["UNA:+.? '", seg("UNB", ["UNOC", "3"], [SENDER, "ZZZ"], [RECEIVER, "ZZZ"], PREP.split(":"), icr), ...msgs, seg("UNZ", String(page.length), icr)].join("\n") + "\n";
  return { text, count: page.length, total: all.length, nextOffset: offset + limit < all.length ? offset + limit : null };
}
/** Analyse EDIFACT (tolérante aux sauts de ligne) : liste de segments [tag, ...éléments[composants]]. */
export function parseEdifact(text) {
  const s = String(text).replace(/^UNA.{6}/, "").replace(/\r?\n/g, "");
  const segs = []; let sg = [], el = [], comp = "", e = false;
  for (const ch of s) {
    if (e) { comp += ch; e = false; continue; }
    if (ch === "?") { e = true; continue; }
    if (ch === ":") { el.push(comp); comp = ""; continue; }
    if (ch === "+") { el.push(comp); sg.push(el); el = []; comp = ""; continue; }
    if (ch === "'") { el.push(comp); sg.push(el); segs.push(sg); sg = []; el = []; comp = ""; continue; }
    comp += ch;
  }
  return segs;
}

// ═════════════════════════════════════════════════════════════════════════
// ANSI ASC X12 004010 (séparateurs : * élément, > sous-élément, ~ segment)
// ═════════════════════════════════════════════════════════════════════════
const xs = v => String(v ?? "").replace(/[*~>]/g, " ");
const x = (...els) => `${els.map(xs).join("*").replace(/\*+$/, "")}~`;
const pad = (v, n) => String(v).padEnd(n, " ").slice(0, n);
function x850(po) {
  return [x("BEG", "00", "SA", po.PurchaseOrder, "", d8(po.LastChangeDateTime)), x("CUR", "BY", po.DocumentCurrency), x("N1", "SE", "", "92", po.Supplier),
    x("PO1", po.PurchaseOrderItem, po.OrderQuantity, "EA", "", "", "IN", po.Material), x("DTM", "002", d8(po.ScheduleLineDeliveryDate)), x("CTT", "1")];
}
function x856(s) {
  return [x("BSN", "00", s.ShipmentId, d8(s.UpdatedTimestamp), "0000"), x("HL", "1", "", "S"), x("TD5", "B", "", "", MODE_X12[s.TransportMode] ?? "", s.Carrier),
    x("DTM", "017", d8(s.ExpectedDate)), ...(s.ActualDate ? [x("DTM", "050", d8(s.ActualDate))] : []), x("N1", "SF", s.OriginName), x("N1", "ST", "", "92", s.DestinationFacility),
    x("HL", "2", "1", "O"), x("PRF", s.PurchaseOrderRef), x("HL", "3", "2", "I"), x("LIN", "", "UK", s.ItemId), x("SN1", "", s.Quantity, "EA"), x("CTT", "3")];
}
function x810(po) {
  const price = priceOf(po.Material), cents = Math.round(price * po.OrderQuantity * 100);
  return [x("BIG", d8(po.LastChangeDateTime), `INV${po.PurchaseOrder}`, "", po.PurchaseOrder), x("CUR", "SE", po.DocumentCurrency), x("N1", "SE", "", "92", po.Supplier),
    x("IT1", po.PurchaseOrderItem, po.OrderQuantity, "EA", price.toFixed(2), "", "IN", po.Material), x("TDS", String(cents)), x("CTT", "1")];
}
export const X12_TYPES = {
  850: { gs: "PO", source: "sap/A_PurchaseOrderItem", build: x850, rows: () => T("sap/A_PurchaseOrderItem") },
  856: { gs: "SH", source: "tms/shipments", build: x856, rows: () => T("tms/shipments") },
  810: { gs: "IN", source: "sap/A_PurchaseOrderItem", build: x810, rows: () => T("sap/A_PurchaseOrderItem").filter(p => priceOf(p.Material) !== null) },
};
export function x12(type, offset = 0, limit = 100) {
  const t = X12_TYPES[type];
  if (!t) return null;
  const all = t.rows(), page = all.slice(offset, offset + limit), ctl = String(1 + offset).padStart(9, "0");
  const sets = page.map((row, i) => { const cn = String(i + 1).padStart(4, "0"), body = [x("ST", type, cn), ...t.build(row)]; return [...body, x("SE", String(body.length + 1), cn)].join("\n"); });
  const isa = `ISA*00*${pad("", 10)}*00*${pad("", 10)}*ZZ*${pad(SENDER, 15)}*ZZ*${pad(RECEIVER, 15)}*${d6(AS_OF)}*0200*U*00401*${ctl}*0*T*>~`;
  const text = [isa, x("GS", t.gs, SENDER, RECEIVER, d8(AS_OF), "0200", String(1 + offset), "X", "004010"), ...sets, x("GE", String(page.length), String(1 + offset)), x("IEA", "1", ctl)].join("\n") + "\n";
  return { text, count: page.length, total: all.length, nextOffset: offset + limit < all.length ? offset + limit : null };
}
export function parseX12(text) {
  const s = String(text).replace(/\r?\n/g, "");
  const el = s[3], term = s[105], sub = s[104];
  return s.split(term).filter(Boolean).map(seg => seg.split(el).map(e => e.split(sub)));
}

// ═════════════════════════════════════════════════════════════════════════
// SAP IDoc XML (représentation XML standard : <TYPE><IDOC BEGIN="1"><EDI_DC40 …/>…)
// ═════════════════════════════════════════════════════════════════════════
const tag = (name, fields, children = "") => `<${name} SEGMENT="1">${Object.entries(fields).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `<${k}>${xmlEscape(v)}</${k}>`).join("")}${children}</${name}>`;
function dc40(idoctyp, mestyp, docnum) {
  return tag("EDI_DC40", { TABNAM: "EDI_DC40", MANDT: "100", DOCNUM: String(docnum).padStart(16, "0"), DIRECT: "1", IDOCTYP: idoctyp, MESTYP: mestyp, SNDPOR: "SAPLUC", SNDPRT: "LS", SNDPRN: "LUCIES4H", RCVPOR: "AURASUPPLY", RCVPRT: "LS", RCVPRN: "AURASUPPLY", CREDAT: d8(AS_OF), CRETIM: "020000" });
}
export const IDOC_TYPES = {
  ORDERS05: { mestyp: "ORDERS", source: "sap/A_PurchaseOrderItem", segs: po => tag("E1EDK01", { CURCY: po.DocumentCurrency, BELNR: po.PurchaseOrder })
    + tag("E1EDKA1", { PARVW: "LF", PARTN: po.Supplier })
    + tag("E1EDK02", { QUALF: "001", BELNR: po.PurchaseOrder, DATUM: d8(po.LastChangeDateTime) })
    + tag("E1EDP01", { POSEX: po.PurchaseOrderItem, MENGE: po.OrderQuantity, MENEE: "ST" }, tag("E1EDP20", { WMENG: po.OrderQuantity, EDATU: d8(po.ScheduleLineDeliveryDate) }) + tag("E1EDP19", { QUALF: "001", IDTNR: po.Material })) },
  DESADV01: { mestyp: "DESADV", source: "tms/shipments", segs: s => tag("E1EDL20", { VBELN: s.ShipmentId, TRATY: s.TransportMode },
    tag("E1ADRM1", { PARTNER_Q: "LF", NAME1: s.OriginName }) + tag("E1ADRM1", { PARTNER_Q: "SP", NAME1: s.Carrier }) + tag("E1ADRM1", { PARTNER_Q: "WE", PARTNER_ID: s.DestinationFacility })
    + tag("E1EDT13", { QUALF: "007", NTANF: d8(s.ExpectedDate), ISDD: s.ActualDate ? d8(s.ActualDate) : null })
    + tag("E1EDL24", { POSNR: "000010", MATNR: s.ItemId, LFIMG: s.Quantity, VRKME: "ST" }, tag("E1EDL41", { QUALI: "001", BSTNR: s.PurchaseOrderRef }))) },
  CREMAS05: { mestyp: "CREMAS", source: "sap/A_Supplier", segs: v => tag("E1LFA1M", { MSGFN: "005", LIFNR: v.Supplier, NAME1: v.SupplierName, LAND1: v.Country, STCD1: v.TaxNumber1, STCEG: v.VATRegistration, KRAUS: v.DUNS },
    tag("E1LFB1M", { MSGFN: "005", BUKRS: "1000", ALTKN: v.LegacySupplierId })) },
  MATMAS05: { mestyp: "MATMAS", source: "pim/products", segs: p => tag("E1MARAM", { MSGFN: "005", MATNR: p.productId, BISMT: p.internalRef, EAN11: p.ean, NUMTP: "HE", MATKL: p.category, MEINS: "ST" },
    tag("E1MAKTM", { MSGFN: "005", SPRAS: "F", MAKTX: p.name })) },
};
export function idoc(type, offset = 0, limit = 100) {
  const t = IDOC_TYPES[type];
  if (!t) return null;
  const all = T(t.source), page = all.slice(offset, offset + limit);
  const body = page.map((row, i) => `<IDOC BEGIN="1">${dc40(type, t.mestyp, offset + i + 1)}${t.segs(row)}</IDOC>`).join("\n");
  return { text: `<?xml version="1.0" encoding="UTF-8"?>\n<${type}>\n${body}\n</${type}>\n`, count: page.length, total: all.length, nextOffset: offset + limit < all.length ? offset + limit : null };
}

// ═════════════════════════════════════════════════════════════════════════
// AS2 (RFC 4130) : boîte d'envoi et MDN synchrone. MIC = SHA-256 du contenu.
// ═════════════════════════════════════════════════════════════════════════
export const AS2_DOCS = {
  "edifact-orders": { kind: "edifact", type: "ORDERS", contentType: "application/EDIFACT" },
  "edifact-desadv": { kind: "edifact", type: "DESADV", contentType: "application/EDIFACT" },
  "edifact-invoic": { kind: "edifact", type: "INVOIC", contentType: "application/EDIFACT" },
  "x12-850": { kind: "x12", type: "850", contentType: "application/EDI-X12" },
  "x12-856": { kind: "x12", type: "856", contentType: "application/EDI-X12" },
  "x12-810": { kind: "x12", type: "810", contentType: "application/EDI-X12" },
};
export const mic = text => `${createHash("sha256").update(text).digest("base64")}, sha-256`;
export function as2Message(id, offset = 0, limit = 100) {
  const d = AS2_DOCS[id];
  if (!d) return null;
  const doc = d.kind === "edifact" ? edifact(d.type, offset, limit) : x12(d.type, offset, limit);
  return { ...doc, headers: { "AS2-Version": "1.2", "AS2-From": SENDER, "AS2-To": RECEIVER, "Message-ID": `<${id}.${offset}.${AS_OF}@maison-lucie-si.vercel.app>`, "Content-Type": d.contentType, "Disposition-Notification-To": "edi@maison-lucie.example", "Disposition-Notification-Options": "signed-receipt-protocol=optional, pkcs7-signature; signed-receipt-micalg=optional, sha-256", "X-Lucie-Content-MIC": mic(doc.text) } };
}
/** MDN synchrone (multipart/report) pour un document reçu. */
export function as2Mdn({ messageId, as2From, text }) {
  const boundary = "----=_LucieMDN_" + createHash("sha256").update(String(messageId)).digest("hex").slice(0, 12);
  const ok = !!text && (/^UNA|^UNB/.test(text) || /^ISA/.test(text) || /^<\?xml/.test(text));
  const disposition = ok ? "automatic-action/MDN-sent-automatically; processed" : "automatic-action/MDN-sent-automatically; processed/error: unexpected-processing-error";
  const body = [`--${boundary}`, "Content-Type: text/plain", "", ok ? "Le message a été reçu et traité (simulation Maison Lucie)." : "Contenu non reconnu (EDIFACT, X12 ou XML attendu).", "",
    `--${boundary}`, "Content-Type: message/disposition-notification", "", "Reporting-UA: Maison Lucie AS2 simulator", `Original-Recipient: rfc822; ${SENDER}`, `Final-Recipient: rfc822; ${SENDER}`,
    `Original-Message-ID: ${messageId ?? ""}`, `Disposition: ${disposition}`, ...(ok ? [`Received-Content-MIC: ${mic(text)}`] : []), "", `--${boundary}--`, ""].join("\r\n");
  return { ok, contentType: `multipart/report; report-type=disposition-notification; boundary="${boundary}"`, body, headers: { "AS2-Version": "1.2", "AS2-From": SENDER, "AS2-To": as2From ?? RECEIVER, "Message-ID": `<mdn.${Date.parse(`${AS_OF}T00:00:00Z`)}@maison-lucie-si.vercel.app>` } };
}

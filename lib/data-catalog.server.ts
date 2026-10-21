import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";

/**
 * Catálogo de todas las series descargables, armado al construir el sitio. Para agregar una
 * serie basta con subir el archivo a su carpeta: aparece en la siguiente publicación.
 * Las series nuevas de Bloomberg sin nombre conocido aparecen en "Otros" con su código.
 */
export type SeriesField = { key: string; label: string; unit: string };
export type CatalogSeries = {
  id: string; group: string; label: string; detail: string; source: string; frequency: "Diaria" | "Mensual";
  first: string; last: string; count: number;
  /** Cómo leer el archivo en el navegador. */
  file: string; format: "riskamerica" | "bloomberg" | "rows"; key: string;
  fields: SeriesField[]; search: string;
};
export type Catalog = { groups: { name: string; series: CatalogSeries[] }[]; shortcuts: { label: string; ids: string[] }[] };

const DATA = path.join(process.cwd(), "public", "data");
const readJson = (rel: string) => JSON.parse(readFileSync(path.join(DATA, rel), "utf8").replace(/^﻿/, ""));
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const BLOOMBERG: Record<string, { group: string; label: string; unit: string; order?: number }> = {
  usdclp: { group: "Monedas", label: "USD/CLP", unit: "CLP por USD", order: 1 },
  eurusd: { group: "Monedas", label: "EUR/USD", unit: "USD por EUR", order: 2 },
  usdbrl: { group: "Monedas", label: "USD/BRL", unit: "BRL por USD", order: 3 },
  usdmxn: { group: "Monedas", label: "USD/MXN", unit: "MXN por USD", order: 4 },
  dxy: { group: "Monedas", label: "DXY (índice dólar)", unit: "Índice", order: 5 },
  treasury_1y: { group: "Tasas internacionales", label: "Treasury 1 año", unit: "%", order: 1 },
  treasury_5y: { group: "Tasas internacionales", label: "Treasury 5 años", unit: "%", order: 2 },
  treasury_10y: { group: "Tasas internacionales", label: "Treasury 10 años", unit: "%", order: 3 },
  fedfund: { group: "Tasas internacionales", label: "Fed Funds", unit: "%", order: 4 },
  tpm: { group: "Tasas internacionales", label: "TPM (Bloomberg)", unit: "%", order: 9 },
  cds_chile: { group: "Riesgo y volatilidad", label: "CDS Chile 5 años", unit: "pb", order: 1 },
  vix: { group: "Riesgo y volatilidad", label: "VIX", unit: "Índice", order: 2 },
  move: { group: "Riesgo y volatilidad", label: "MOVE", unit: "Índice", order: 3 },
  ipsa: { group: "Índices accionarios", label: "IPSA", unit: "Puntos", order: 1 },
  spx: { group: "Índices accionarios", label: "S&P 500", unit: "Puntos", order: 2 },
  cobre: { group: "Commodities", label: "Cobre (COMEX)", unit: "USc/lb", order: 1 },
  oro: { group: "Commodities", label: "Oro", unit: "USD/oz", order: 2 },
  brent: { group: "Commodities", label: "Petróleo Brent", unit: "USD/bbl", order: 3 },
  wti: { group: "Commodities", label: "Petróleo WTI", unit: "USD/bbl", order: 4 },
  bitcoin: { group: "Criptomonedas", label: "Bitcoin", unit: "USD", order: 1 },
};
const MACRO_DAILY: Record<string, { label: string; unit: string }> = {
  tpm: { label: "TPM", unit: "%" }, usdclp_obs: { label: "Dólar observado", unit: "CLP por USD" }, componente_m2: { label: "M2 (componente)", unit: "MM CLP" },
};
const MACRO_MONTHLY: Record<string, { label: string; unit: string }> = {
  ipc_yoy: { label: "IPC variación 12 meses", unit: "%" }, ipc_mom: { label: "IPC variación mensual", unit: "%" },
  ipcsae_mom: { label: "IPC SAE variación mensual", unit: "%" }, imacec: { label: "IMACEC variación anual", unit: "%" },
  imacec_ind_des: { label: "IMACEC desestacionalizado", unit: "Índice" }, desempleo: { label: "Tasa de desempleo", unit: "%" },
  tc_real: { label: "Tipo de cambio real", unit: "Índice" }, posicion_os_teso: { label: "Posición OS Tesorería", unit: "—" }, posicion_os_bc: { label: "Posición OS Banco Central", unit: "—" },
};
const GROUP_ORDER = ["Bonos BTP (pesos)", "Bonos BTU (UF)", "Swap Cámara CLP", "Swap Cámara UF", "Depósitos a plazo (DPF)", "Macro Chile · diaria", "Macro Chile · mensual",
  "Monedas", "Tasas internacionales", "Riesgo y volatilidad", "Índices accionarios", "Commodities", "Criptomonedas", "Otros"];

const tenorMonths = (t: string) => { const m = t.match(/^(\d+)(m|y)$/); return m ? Number(m[1]) * (m[2] === "y" ? 12 : 1) : 999; };
const tenorLabel = (t: string) => { const m = t.match(/^(\d+)(m|y)$/); if (!m) return t; const n = Number(m[1]); return m[2] === "m" ? `${n} ${n === 1 ? "mes" : "meses"}` : `${n} ${n === 1 ? "año" : "años"}`; };
function range(dates: string[], values: unknown[]) {
  const ok = dates.filter((d, i) => typeof values[i] === "number" && Number.isFinite(values[i] as number)).sort();
  return { first: ok[0] ?? "", last: ok[ok.length - 1] ?? "", count: ok.length };
}

export function dataCatalog(): Catalog {
  const all: CatalogSeries[] = [];
  // RiskAmerica: bonos y DPF
  for (const file of readdirSync(path.join(DATA, "historico_riskamerica")).filter(f => f.endsWith(".json")).sort()) {
    const code = file.slice(0, -5);
    const s = readJson(`historico_riskamerica/${file}`)[code] as Record<string, unknown[]> & { fecha: string[] };
    if (!s?.fecha) continue;
    const r = range(s.fecha, s.tir ?? []);
    const bond = code.match(/^(BTP|BTU)(\d{3})(\d{2})(\d{2})$/);
    if (bond) {
      const [, type, cpn, mm, yy] = bond;
      const label = `${type} ${(Number(cpn) / 10).toFixed(1).replace(".", ",")}% ${MONTHS[Number(mm) - 1]}-20${yy}`;
      const fields: SeriesField[] = [{ key: "tir", label: "TIR", unit: type === "BTU" ? "% real (UF)" : "%" }, { key: "duracion", label: "Duración", unit: "años" }, { key: "precio", label: "Precio", unit: "% del par" }, { key: "convexidad", label: "Convexidad", unit: "" }]
        .filter(f => Array.isArray(s[f.key]));
      all.push({ id: code, group: type === "BTP" ? "Bonos BTP (pesos)" : "Bonos BTU (UF)", label, detail: code, source: "Mercado", frequency: "Diaria",
        ...r, file: `/data/historico_riskamerica/${file}`, format: "riskamerica", key: code, fields, search: `${code} ${label}`.toLowerCase() });
    } else if (/^DPF_\d+$/.test(code)) {
      const days = Number(code.slice(4));
      all.push({ id: code, group: "Depósitos a plazo (DPF)", label: `DPF ${days} días`, detail: "Tasa mensual", source: "Mercado", frequency: "Diaria",
        ...r, file: `/data/historico_riskamerica/${file}`, format: "riskamerica", key: code, fields: [{ key: "tir", label: "Tasa", unit: "% mensual" }], search: `dpf deposito ${days}`.toLowerCase() });
    }
  }
  // Bloomberg
  for (const file of readdirSync(path.join(DATA, "historico_bloomberg")).filter(f => f.endsWith(".json")).sort()) {
    const code = file.slice(0, -5);
    const s = readJson(`historico_bloomberg/${file}`)[code] as { fecha: string[]; valor: unknown[] };
    if (!s?.fecha) continue;
    const r = range(s.fecha, s.valor);
    const swap = code.match(/^(clpcam|ufcam)_(\d+[my])$/);
    const known = BLOOMBERG[code];
    const group = swap ? (swap[1] === "clpcam" ? "Swap Cámara CLP" : "Swap Cámara UF") : known?.group ?? "Otros";
    const label = swap ? `${swap[1] === "clpcam" ? "SPC CLP" : "SPC UF"} ${tenorLabel(swap[2])}` : known?.label ?? code;
    const unit = swap ? (swap[1] === "clpcam" ? "%" : "% real (UF)") : known?.unit ?? "";
    all.push({ id: `bbg:${code}`, group, label, detail: code, source: "Bloomberg", frequency: "Diaria", ...r,
      file: `/data/historico_bloomberg/${file}`, format: "bloomberg", key: code, fields: [{ key: "valor", label: "Valor", unit }],
      search: `${code} ${label} ${group}`.toLowerCase() });
  }
  // Banco Central
  const addRows = (rel: string, dict: Record<string, { label: string; unit: string }>, group: string, frequency: "Diaria" | "Mensual") => {
    if (!existsSync(path.join(DATA, rel))) return;
    const rows = readJson(rel) as Record<string, unknown>[];
    for (const [key, info] of Object.entries(dict)) {
      const r = range(rows.map(x => x.fecha as string), rows.map(x => x[key]));
      if (!r.count) continue;
      all.push({ id: `bcch:${key}`, group, label: info.label, detail: key, source: "Banco Central", frequency, ...r,
        file: `/data/${rel}`, format: "rows", key, fields: [{ key, label: info.label, unit: info.unit }], search: `${key} ${info.label} macro banco central`.toLowerCase() });
    }
  };
  addRows("historico_bcentral/datos-diarios.json", MACRO_DAILY, "Macro Chile · diaria", "Diaria");
  addRows("historico_bcentral/datos-mensuales.json", MACRO_MONTHLY, "Macro Chile · mensual", "Mensual");

  const sortKey = (s: CatalogSeries) => {
    if (s.format === "riskamerica" && s.id.startsWith("BT")) return s.id.slice(-2) + s.id.slice(-4, -2);   // AAMM
    if (s.id.startsWith("DPF_")) return String(Number(s.id.slice(4))).padStart(4, "0");
    const swap = s.key.match(/^(clpcam|ufcam)_(\d+[my])$/);
    if (swap) return String(tenorMonths(swap[2])).padStart(4, "0");
    return String(BLOOMBERG[s.key]?.order ?? 50).padStart(3, "0") + s.label;
  };
  const groups = GROUP_ORDER.map(name => ({ name, series: all.filter(s => s.group === name).sort((a, b) => sortKey(a).localeCompare(sortKey(b))) })).filter(g => g.series.length);

  const benchmark = existsSync(path.join(DATA, "instrumentos-benchmark.json")) ? readJson("instrumentos-benchmark.json") as Record<string, string[]> : {};
  const ids = new Set(all.map(s => s.id));
  const pick = (list: string[]) => list.filter(id => ids.has(id));
  const shortcuts = [
    { label: "BTP benchmark", ids: pick(benchmark.BTP ?? []) },
    { label: "BTU benchmark", ids: pick(benchmark.BTU ?? []) },
    { label: "Curva swap CLP", ids: groups.find(g => g.name === "Swap Cámara CLP")?.series.map(s => s.id) ?? [] },
    { label: "Curva swap UF", ids: groups.find(g => g.name === "Swap Cámara UF")?.series.map(s => s.id) ?? [] },
    { label: "Monedas", ids: groups.find(g => g.name === "Monedas")?.series.map(s => s.id) ?? [] },
    { label: "Macro mensual", ids: groups.find(g => g.name === "Macro Chile · mensual")?.series.map(s => s.id) ?? [] },
  ].filter(s => s.ids.length);
  return { groups, shortcuts };
}

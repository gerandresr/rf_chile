import { readFileSync, readdirSync } from "fs";
import path from "path";

/**
 * Datos del Dashboard RF, calculados al construir el sitio.
 * Convenciones:
 *  - Cambios: 1D = contra la observación anterior; 1S = contra el último dato ≤ fecha − 7 días;
 *    1M = ≤ fecha − 1 mes; YTD = ≤ 31-dic del año anterior. Tasas en pb, precios en %.
 *  - Plazos constantes BTP/BTU de 2, 5 y 10 años: misma metodología que "Tasas Benchmark" de
 *    Mercados (interpolación lineal entre los papeles benchmark; BTP sin cero cupón). 20 años:
 *    interpolación lineal entre todos los bonos con cupón vigentes (no hay benchmark a ese plazo).
 *  - Breakeven: (1 + TIR BTP) / (1 + TIR BTU) − 1 al mismo plazo.
 *  - Percentil: posición del último dato entre las observaciones del último año.
 */

const DATA = path.join(process.cwd(), "public", "data");
const readJson = (relative: string) => JSON.parse(readFileSync(path.join(DATA, relative), "utf8").replace(/^﻿/, ""));
const DAY = 86400000;
const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const shiftMonths = (date: string, months: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + months); return iso(d.getTime()); };

export type Series = { dates: string[]; values: number[] };
function series(entries: [string, number][]): Series {
  const map = new Map(entries.filter(([d, v]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(v)));
  const dates = [...map.keys()].sort();
  return { dates, values: dates.map(d => map.get(d)!) };
}
function indexOnOrBefore(s: Series, date: string) {
  let lo = 0, hi = s.dates.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (s.dates[m] <= date) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
const valueOn = (s: Series, date: string) => { const i = indexOnOrBefore(s, date); return i < 0 ? null : s.values[i]; };
function bloomberg(key: string): Series {
  const s = readJson(`historico_bloomberg/${key}.json`)[key] as { fecha: string[]; valor: (number | null)[] };
  // Nota: Bloomberg repite el valor en feriados chilenos; ese día el cambio 1D es 0.
  return series(s.fecha.map((f, i) => [f, s.valor[i] as number]));
}

export type Changes = { d1: number | null; w1: number | null; m1: number | null; ytd: number | null };
function changes(s: Series, unit: "bp" | "pct" | "level"): Changes {
  const n = s.dates.length;
  if (!n) return { d1: null, w1: null, m1: null, ytd: null };
  const last = s.dates[n - 1], v = s.values[n - 1];
  const ref = (date: string) => { const i = indexOnOrBefore(s, date); return i < 0 || i === n - 1 ? null : s.values[i]; };
  const diff = (base: number | null) => base === null ? null : unit === "bp" ? (v - base) * 100 : unit === "pct" ? (v / base - 1) * 100 : v - base;
  return {
    d1: n > 1 ? diff(s.values[n - 2]) : null,
    w1: diff(ref(iso(toTime(last) - 7 * DAY))),
    m1: diff(ref(shiftMonths(last, -1))),
    ytd: diff(ref(`${Number(last.slice(0, 4)) - 1}-12-31`)),
  };
}
function spark(s: Series, months: number) {
  if (!s.dates.length) return [];
  const from = shiftMonths(s.dates[s.dates.length - 1], -months);
  return s.values.filter((_, i) => s.dates[i] >= from);
}
function percentile(s: Series) {
  if (s.dates.length < 20) return null;
  const from = shiftMonths(s.dates[s.dates.length - 1], -12);
  const window = s.values.filter((_, i) => s.dates[i] >= from);
  const v = s.values[s.values.length - 1];
  return 100 * (window.filter(x => x < v).length + 0.5 * window.filter(x => x === v).length) / window.length;
}
function range1y(s: Series) {
  const from = shiftMonths(s.dates[s.dates.length - 1], -12);
  const window = s.values.filter((_, i) => s.dates[i] >= from);
  return { min: Math.min(...window), max: Math.max(...window) };
}

// ---------- Bonos (RiskAmerica) ----------
type Bond = { code: string; type: "BTP" | "BTU"; coupon: number; year: number; month: number; tir: Series; duration: number | null };
function loadBonds(): Bond[] {
  const dir = path.join(DATA, "historico_riskamerica");
  return readdirSync(dir).filter(f => /^BT[PU]\d{7}\.json$/.test(f)).flatMap(file => {
    const code = file.slice(0, -5), m = code.match(/^(BTP|BTU)(\d{3})(\d{2})(\d{2})$/);
    if (!m) return [];
    const s = readJson(`historico_riskamerica/${file}`)[code] as { fecha: string[]; tir: (number | null)[]; duracion: (number | null)[] };
    const lastDuration = [...s.duracion].reverse().find(v => typeof v === "number") ?? null;
    return [{ code, type: m[1] as "BTP" | "BTU", coupon: Number(m[2]) / 10, month: Number(m[3]), year: 2000 + Number(m[4]),
      tir: series(s.fecha.map((f, i) => [f, s.tir[i] as number])), duration: lastDuration }];
  });
}
const termOf = (b: Bond, date: string) => (Date.UTC(b.year, b.month - 1, 1) - toTime(date)) / (365 * DAY);
function interpolate(term: number, points: { term: number; y: number }[], flat: boolean) {
  const p = points.filter(x => x.term > 0).sort((a, b) => a.term - b.term);
  if (!p.length) return null;
  if (term <= p[0].term) return flat || Math.abs(term - p[0].term) < 1e-9 ? p[0].y : null;
  if (term >= p[p.length - 1].term) return flat || Math.abs(term - p[p.length - 1].term) < 1e-9 ? p[p.length - 1].y : null;
  for (let i = 1; i < p.length; i++) if (term <= p[i].term) {
    const w = (term - p[i - 1].term) / (p[i].term - p[i - 1].term);
    return p[i - 1].y + w * (p[i].y - p[i - 1].y);
  }
  return null;
}

export type TickerItem = { label: string; value: number; unit: "%" | "pb" | ""; digits: number; change: number | null; changeUnit: "pb" | "%"; spark: number[]; asOf: string };
export type HeatCell = { level: number | null; changes: Changes };
export type SpreadCard = { label: string; detail: string; value: number; unit: "pb" | "%"; changes: Changes; percentile: number | null; min: number; max: number; spark: number[]; reference?: { label: string; value: number } };
export type MonitorRow = { code: string; detail: string; duration: number | null; value: number; changes: Changes; spark: number[]; percentile: number | null };
export type CurveSet = { key: string; label: string; tenors: number[]; lines: { label: string; date: string; values: (number | null)[] }[]; points: { term: number; y: number; code: string }[] };
export type DashboardData = {
  asOf: { bonds: string; bloomberg: string };
  ticker: TickerItem[];
  macro: { label: string; value: string; detail: string }[];
  heatmap: { rows: number[]; columns: string[]; cells: HeatCell[][] };
  curves: CurveSet[];
  spreads: SpreadCard[];
  monitor: { key: string; label: string; unit: "%" | "% mensual"; rows: MonitorRow[] }[];
};

export function dashboardData(): DashboardData {
  const bonds = loadBonds();
  const benchmark = readJson("instrumentos-benchmark.json") as Record<"BTP" | "BTU", string[]>;
  const bondDates = [...new Set(bonds.flatMap(b => b.tir.dates))].sort();
  const lastBondDate = bondDates[bondDates.length - 1];
  const fromDate = shiftMonths(lastBondDate, -13);
  const ytdDate = `${Number(lastBondDate.slice(0, 4)) - 1}-12-31`;
  const start = fromDate < ytdDate ? fromDate : shiftMonths(ytdDate, -1);
  const cmDates = bondDates.filter(d => d >= start);

  const bondPoints = (type: "BTP" | "BTU", date: string, set: Set<string> | null) => bonds
    .filter(b => b.type === type && (!set || set.has(b.code)) && (type === "BTU" || b.coupon > 0) && b.tir.dates.includes(date))
    .map(b => ({ term: termOf(b, date), y: valueOn(b.tir, date)!, code: b.code }))
    .filter(p => p.term > 0);
  const constantMaturity = (type: "BTP" | "BTU", term: number): Series => series(cmDates.map(d => {
    const bench = term <= 10 ? new Set(benchmark[type]) : null;
    const pts = bondPoints(type, d, bench).filter(p => term <= 10 || p.term >= 1);
    return [d, interpolate(term, pts, term <= 10) as number];
  }));
  const tenors = [2, 5, 10, 20];
  const cm = { BTP: Object.fromEntries(tenors.map(t => [t, constantMaturity("BTP", t)])), BTU: Object.fromEntries(tenors.map(t => [t, constantMaturity("BTU", t)])) } as Record<"BTP" | "BTU", Record<number, Series>>;
  const breakeven = Object.fromEntries(tenors.map(t => [t, series(cm.BTP[t].dates.map(d => {
    const n = valueOn(cm.BTP[t], d), r = valueOn(cm.BTU[t], d);
    return [d, n === null || r === null ? NaN : 100 * ((1 + n / 100) / (1 + r / 100) - 1)];
  }))])) as Record<number, Series>;

  const spc = (t: number) => bloomberg(`clpcam_${t}y`), spu = (t: number) => bloomberg(`ufcam_${t}y`);
  const swapsCLP = Object.fromEntries(tenors.map(t => [t, spc(t)])) as Record<number, Series>;
  const swapsUF = Object.fromEntries(tenors.map(t => [t, spu(t)])) as Record<number, Series>;
  const daily = (readJson("historico_bcentral/datos-diarios.json") as { fecha: string; tpm: number | null }[]);
  const tpm = series(daily.filter(r => typeof r.tpm === "number").map(r => [r.fecha, r.tpm as number]));
  const usdclp = bloomberg("usdclp"), ust10 = bloomberg("treasury_10y"), copper = bloomberg("cobre"), cds = bloomberg("cds_chile");
  const lastBloomberg = swapsCLP[10].dates[swapsCLP[10].dates.length - 1];

  const last = (s: Series) => s.values[s.values.length - 1];
  const lastDate = (s: Series) => s.dates[s.dates.length - 1];
  const tick = (label: string, s: Series, unit: TickerItem["unit"], digits: number, kind: "bp" | "pct"): TickerItem =>
    ({ label, value: last(s), unit, digits, change: changes(s, kind).d1, changeUnit: kind === "bp" ? "pb" : "%", spark: spark(s, 1), asOf: lastDate(s) });
  const ticker: TickerItem[] = [
    tick("TPM", tpm, "%", 2, "bp"),
    tick("BTP 2", cm.BTP[2], "%", 2, "bp"), tick("BTP 5", cm.BTP[5], "%", 2, "bp"), tick("BTP 10", cm.BTP[10], "%", 2, "bp"),
    tick("BTU 5", cm.BTU[5], "%", 2, "bp"), tick("BTU 10", cm.BTU[10], "%", 2, "bp"),
    tick("SPC 2a", swapsCLP[2], "%", 2, "bp"), tick("SPC 10a", swapsCLP[10], "%", 2, "bp"),
    tick("USD/CLP", usdclp, "", 2, "pct"), tick("UST 10a", ust10, "%", 2, "bp"),
    tick("Cobre", copper, "", 1, "pct"), tick("CDS 5a", cds, "pb", 1, "bp"),
  ];
  // CDS ya está en pb: el cambio en "bp" multiplicaría por 100.
  ticker[ticker.length - 1].change = cds.values.length > 1 ? last(cds) - cds.values[cds.values.length - 2] : null;

  // Macro
  const monthly = readJson("historico_bcentral/datos-mensuales.json") as Record<string, number | null | string>[];
  const latestOf = (key: string) => [...monthly].reverse().find(r => typeof r[key] === "number");
  const monthName = (d: string) => new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const fmt = (v: number, d = 1) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  const meetings = (readJson("tpm-meetings.json") as { dates: string[] }).dates.filter(d => d >= lastBloomberg).sort();
  const macro = [
    ["IPC 12 meses", "ipc_yoy", (v: number) => `${fmt(v)}%`], ["IPC mensual", "ipc_mom", (v: number) => `${fmt(v)}%`],
    ["IMACEC anual", "imacec", (v: number) => `${fmt(v)}%`], ["Desempleo", "desempleo", (v: number) => `${fmt(v)}%`],
  ].flatMap(([label, key, f]) => { const r = latestOf(key as string); return r ? [{ label: label as string, value: (f as (v: number) => string)(r[key as string] as number), detail: monthName(r.fecha as string) }] : []; });
  if (meetings[0]) macro.push({ label: "Próxima RPM", value: new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${meetings[0]}T00:00:00Z`)), detail: `${Math.round((toTime(meetings[0]) - toTime(lastBloomberg)) / DAY)} días` });

  // Mapa de calor
  const columns = ["BTP", "BTU", "SPC CLP", "SPC UF", "Breakeven"];
  const columnSeries = (c: string, t: number) => c === "BTP" ? cm.BTP[t] : c === "BTU" ? cm.BTU[t] : c === "SPC CLP" ? swapsCLP[t] : c === "SPC UF" ? swapsUF[t] : breakeven[t];
  const cells = tenors.map(t => columns.map(c => { const s = columnSeries(c, t); return { level: s.values.length ? last(s) : null, changes: changes(s, "bp") }; }));

  // Curvas con comparación
  const refDates = (dates: string[]) => {
    const l = dates[dates.length - 1];
    const pick = (d: string) => dates[indexOnOrBefore({ dates, values: [] }, d)];
    return [["Hoy", l], ["Hace 1 semana", pick(iso(toTime(l) - 7 * DAY))], ["Hace 1 mes", pick(shiftMonths(l, -1))], ["Inicio de año", pick(`${Number(l.slice(0, 4)) - 1}-12-31`)]] as [string, string][];
  };
  const bondGrid = [1, 2, 3, 4, 5, 7, 10, 12, 15, 20, 25];
  const bondCurve = (type: "BTP" | "BTU"): CurveSet => ({
    key: type, label: type === "BTP" ? "BTP (nominal)" : "BTU (UF)", tenors: bondGrid,
    lines: refDates(bondDates).map(([label, d]) => {
      const pts = bondPoints(type, d, null);
      return { label, date: d, values: bondGrid.map(t => interpolate(t, pts, false)) };
    }),
    points: bondPoints(type, lastBondDate, null).map(p => ({ term: p.term, y: p.y, code: p.code })),
  });
  const swapTenors: [number, string][] = [[0.25, "3m"], [0.5, "6m"], [1, "1y"], [2, "2y"], [5, "5y"], [7, "7y"], [10, "10y"], [15, "15y"], [20, "20y"]];
  const swapCurve = (prefix: "clpcam" | "ufcam", label: string): CurveSet => {
    const all = swapTenors.map(([t, k]) => [t, bloomberg(`${prefix}_${k}`)] as const);
    return { key: prefix, label, tenors: swapTenors.map(([t]) => t),
      lines: refDates(all[6][1].dates).map(([l, d]) => ({ label: l, date: d, values: all.map(([, s]) => valueOn(s, d)) })), points: [] };
  };
  const curves = [bondCurve("BTP"), bondCurve("BTU"), swapCurve("clpcam", "SPC CLP"), swapCurve("ufcam", "SPC UF")];

  // Spreads
  const combine = (a: Series, b: Series, f: (x: number, y: number) => number) => series(a.dates.map(d => { const y = valueOn(b, d); return [d, y === null ? NaN : f(valueOn(a, d)!, y)]; }));
  const card = (label: string, detail: string, s: Series, unit: "pb" | "%", reference?: { label: string; value: number }): SpreadCard => ({
    label, detail, value: last(s), unit, changes: unit === "pb" ? changes(s, "level") : changes(s, "bp"),
    percentile: percentile(s), ...range1y(s), spark: spark(s, 3), reference,
  });
  const spreads = [
    card("Pendiente BTP 2–10", "BTP 10 − BTP 2", combine(cm.BTP[10], cm.BTP[2], (x, y) => (x - y) * 100), "pb"),
    card("Pendiente SPC 2–10", "SPC 10a − SPC 2a", combine(swapsCLP[10], swapsCLP[2], (x, y) => (x - y) * 100), "pb"),
    card("BTP 10 − SPC 10", "Spread bono-swap (convenciones sin ajustar)", combine(cm.BTP[10], swapsCLP[10], (x, y) => (x - y) * 100), "pb"),
    card("Breakeven 5 años", "Compensación inflacionaria bonos", breakeven[5], "%", { label: "Meta", value: 3 }),
    card("Breakeven 10 años", "Compensación inflacionaria bonos", breakeven[10], "%", { label: "Meta", value: 3 }),
    card("BTP 10 − UST 10", "Diferencial con Treasury", combine(cm.BTP[10], ust10, (x, y) => (x - y) * 100), "pb"),
    card("SPC 1a − TPM", "Alzas (+) o recortes (−) descontados a 1 año", combine(bloomberg("clpcam_1y"), tpm, (x, y) => (x - y) * 100), "pb"),
  ];

  // Monitor
  const active = (b: Bond) => b.year * 12 + b.month - 1 >= Number(lastBondDate.slice(0, 4)) * 12 + Number(lastBondDate.slice(5, 7)) - 1 && lastDate(b.tir) === lastBondDate;
  const bondRows = (type: "BTP" | "BTU") => bonds.filter(b => b.type === type && active(b)).sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month)).map(b => ({
    code: b.code, detail: `${String(b.month).padStart(2, "0")}/${b.year} · cupón ${fmt(b.coupon, 1)}%`, duration: b.duration,
    value: last(b.tir), changes: changes(b.tir, "bp"), spark: spark(b.tir, 1), percentile: percentile(b.tir),
  }));
  const swapRows = (prefix: "clpcam" | "ufcam") => [["1m", "1 mes"], ["3m", "3 meses"], ["6m", "6 meses"], ["9m", "9 meses"], ["1y", "1 año"], ["2y", "2 años"], ["5y", "5 años"], ["7y", "7 años"], ["10y", "10 años"], ["15y", "15 años"], ["20y", "20 años"]]
    .filter(([k]) => { try { readFileSync(path.join(DATA, `historico_bloomberg/${prefix}_${k}.json`)); return true; } catch { return false; } })
    .map(([k, label]) => { const s = bloomberg(`${prefix}_${k}`); return { code: `${prefix === "clpcam" ? "SPC" : "SPC UF"} ${k}`, detail: label, duration: null, value: last(s), changes: changes(s, "bp"), spark: spark(s, 1), percentile: percentile(s) }; });
  const dpfRows = [7, 30, 90, 180, 270, 360].map(n => {
    const s = readJson(`historico_riskamerica/DPF_${n}.json`)[`DPF_${n}`] as { fecha: string[]; tir: (number | null)[] };
    const ser = series(s.fecha.map((f, i) => [f, s.tir[i] as number]));
    return { code: `DPF ${n} días`, detail: "Tasa mensual", duration: null, value: last(ser), changes: changes(ser, "bp"), spark: spark(ser, 1), percentile: percentile(ser) };
  });
  const monitor = [
    { key: "BTP", label: "BTP", unit: "%" as const, rows: bondRows("BTP") },
    { key: "BTU", label: "BTU", unit: "%" as const, rows: bondRows("BTU") },
    { key: "SPC", label: "Swaps CLP", unit: "%" as const, rows: swapRows("clpcam") },
    { key: "SPCUF", label: "Swaps UF", unit: "%" as const, rows: swapRows("ufcam") },
    { key: "DPF", label: "DPF", unit: "% mensual" as const, rows: dpfRows },
  ];

  return { asOf: { bonds: lastBondDate, bloomberg: lastBloomberg }, ticker, macro, heatmap: { rows: tenors, columns, cells }, curves, spreads, monitor };
}

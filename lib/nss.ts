/**
 * Nelson-Siegel-Svensson para curvas BTP (nominal) y BTU (real).
 *
 *   y(t) = β0 + β1·[(1−e^(−t/τ1))/(t/τ1)] + β2·[(1−e^(−t/τ1))/(t/τ1) − e^(−t/τ1)] + β3·[(1−e^(−t/τ2))/(t/τ2) − e^(−t/τ2)]
 *
 * Ajuste: grilla de (τ1, τ2) con τ2 ≥ 1,5·τ1 y mínimos cuadrados lineales en β para cada par
 * (con una penalización ridge mínima para estabilidad). Luego una segunda pasada con pesos de Huber
 * para que un bono desalineado (ilíquido, recién emitido) no tuerza la curva del resto.
 */

export type NssCurve = { beta: [number, number, number, number]; tau1: number; tau2: number; rmseBp: number };
export type CurvePoint = { t: number; y: number; w?: number };

const TAU1 = geom(0.3, 8, 22);
const TAU2 = geom(1.5, 30, 18);
const RIDGE = 1e-6;

function geom(a: number, b: number, n: number) {
  return Array.from({ length: n }, (_, i) => a * Math.pow(b / a, i / (n - 1)));
}

export function nssLoadings(t: number, tau1: number, tau2: number): [number, number, number, number] {
  const x1 = Math.max(t, 1e-6) / tau1, x2 = Math.max(t, 1e-6) / tau2;
  const e1 = Math.exp(-x1), e2 = Math.exp(-x2);
  const s1 = (1 - e1) / x1, s2 = (1 - e2) / x2;
  return [1, s1, s1 - e1, s2 - e2];
}

export const nssYield = (c: NssCurve, t: number) => {
  const l = nssLoadings(t, c.tau1, c.tau2);
  return l[0] * c.beta[0] + l[1] * c.beta[1] + l[2] * c.beta[2] + l[3] * c.beta[3];
};

function solve(A: number[][], b: number[]) {
  const n = b.length, m = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-14) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = m[r][c] / m[c][c]; for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k]; }
  }
  return m.map((r, i) => r[n] / r[i]);
}

function gridFit(points: CurvePoint[], weights: number[]) {
  let best: { beta: number[]; tau1: number; tau2: number; sse: number } | null = null;
  for (const tau1 of TAU1) for (const tau2 of TAU2) {
    if (tau2 < 1.5 * tau1) continue;
    const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], b = [0, 0, 0, 0];
    const L = points.map(p => nssLoadings(p.t, tau1, tau2));
    points.forEach((p, k) => {
      const l = L[k], w = weights[k];
      for (let i = 0; i < 4; i++) { b[i] += w * l[i] * p.y; for (let j = 0; j < 4; j++) A[i][j] += w * l[i] * l[j]; }
    });
    for (let i = 0; i < 4; i++) A[i][i] += RIDGE;
    const beta = solve(A, b);
    if (!beta || beta.some(v => !Number.isFinite(v))) continue;
    let sse = 0;
    points.forEach((p, k) => { const l = L[k], e = p.y - (l[0] * beta[0] + l[1] * beta[1] + l[2] * beta[2] + l[3] * beta[3]); sse += weights[k] * e * e; });
    if (!best || sse < best.sse) best = { beta, tau1, tau2, sse };
  }
  return best;
}

/** Ajusta la curva. Requiere al menos 6 puntos (4 betas + holgura). */
export function fitNss(points: CurvePoint[]): NssCurve | null {
  if (points.length < 6) return null;
  const base = points.map(p => p.w ?? 1);
  const first = gridFit(points, base);
  if (!first) return null;
  // Pesos de Huber: residuos mayores a 2,5 desviaciones robustas pesan menos.
  const res = points.map(p => p.y - nssYield({ beta: first.beta as NssCurve["beta"], tau1: first.tau1, tau2: first.tau2, rmseBp: 0 }, p.t));
  const abs = res.map(Math.abs).sort((a, b) => a - b);
  const mad = 1.4826 * abs[Math.floor(abs.length / 2)];
  const k = Math.max(2.5 * mad, 0.02); // piso de 2 pb para no castigar curvas casi perfectas
  const robust = points.map((_, i) => base[i] * Math.min(1, k / Math.max(Math.abs(res[i]), 1e-12)));
  const fit = gridFit(points, robust) ?? first;
  const curve: NssCurve = { beta: fit.beta as NssCurve["beta"], tau1: fit.tau1, tau2: fit.tau2, rmseBp: 0 };
  curve.rmseBp = 100 * Math.sqrt(points.reduce((s, p) => s + (p.y - nssYield(curve, p.t)) ** 2, 0) / points.length);
  return curve;
}

/** Breakeven de inflación compuesto (Fisher), en %. */
export const breakeven = (nominal: number, real: number) => 100 * ((1 + nominal / 100) / (1 + real / 100) - 1);

/** Z-score y percentil del último valor sobre una ventana (mínimo `min` observaciones). */
export function zAndPercentile(values: number[], min = 60) {
  if (values.length < min) return { z: null, pct: null };
  const last = values[values.length - 1];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  const below = values.filter(v => v < last).length, equal = values.filter(v => v === last).length;
  return { z: sd > 1e-9 ? (last - mean) / sd : null, pct: 100 * (below + 0.5 * equal) / values.length };
}

// ================= Valor relativo =================
/**
 * Valor relativo BTP/BTU contra la curva Nelson-Siegel-Svensson del día.
 *
 * Cada fecha se ajusta una curva por tipo con los bonos con cupón de más de 1 año. El residuo de un bono
 * (TIR observada − TIR de la curva a su plazo, en pb) mide si está barato (+, rinde más que sus pares)
 * o caro (−). Como el residuo de un mismo papel es estable en el tiempo (liquidez, cupón, demanda
 * estructural), la señal útil es su z-score frente a su propia historia de 1 año, no el nivel.
 * Los cero cupón se muestran contra la curva pero no la ajustan; los bonos de menos de 1 año quedan fuera
 * (en BTU la estacionalidad del IPC domina el tramo corto y la extrapolación no es confiable).
 */


export type FvBond = { code: string; type: "BTP" | "BTU"; maturity: string; dates: string[]; tir: (number | null)[] };
export type FvRow = {
  code: string; type: "BTP" | "BTU"; maturity: string; years: number; yield: number; fitted: number;
  residualBp: number; change1mBp: number | null; z: number | null; percentile: number | null;
  meanBp: number | null; observations: number; inFit: boolean;
};
export type FvBreakeven = { tenor: number; value: number; change1mBp: number | null; percentile: number | null };
export type FvResult = {
  date: string;
  curves: Record<"BTP" | "BTU", { curve: NssCurve; n: number; points: { t: number; y: number }[] } | null>;
  rows: FvRow[];
  breakevens: FvBreakeven[];
  history: { date: string; be2: number | null; be5: number | null; be10: number | null; be20: number | null; nom10: number | null; real10: number | null }[];
  window: number;
};

const DAY = 86400000;
export const MIN_YEARS_FIT = 1;
export const Z_WINDOW = 252;
export const Z_MIN = 60;
const BE_TENORS = [2, 5, 10, 20];
const isZero = (code: string) => /^(BTP|BTU)000/.test(code);
const years = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY / 365.25;

export function fairValue(bonds: FvBond[], historyDays = 520): FvResult {
  const byDate = bonds.map(b => new Map(b.dates.map((d, i) => [d, b.tir[i]] as const).filter((e): e is [string, number] => typeof e[1] === "number")));
  const allDates = [...new Set(bonds.flatMap(b => b.dates))].sort();
  const dates = allDates.slice(-historyDays);
  if (!dates.length) throw new Error("Sin datos de bonos.");

  const residuals = bonds.map(() => new Map<string, number>());
  const history: FvResult["history"] = [];
  let lastCurves: FvResult["curves"] = { BTP: null, BTU: null };

  for (const date of dates) {
    const curves: FvResult["curves"] = { BTP: null, BTU: null };
    for (const type of ["BTP", "BTU"] as const) {
      const pts = bonds.map((b, i) => ({ b, i, y: byDate[i].get(date), t: years(date, b.maturity) }))
        .filter(p => p.b.type === type && typeof p.y === "number" && p.t > 0) as { b: FvBond; i: number; y: number; t: number }[];
      const fitPts = pts.filter(p => p.t >= MIN_YEARS_FIT && !isZero(p.b.code));
      const curve = fitNss(fitPts.map(p => ({ t: p.t, y: p.y })));
      if (!curve) continue;
      curves[type] = { curve, n: fitPts.length, points: fitPts.map(p => ({ t: p.t, y: p.y })) };
      for (const p of pts) if (p.t >= MIN_YEARS_FIT) residuals[p.i].set(date, 100 * (p.y - nssYield(curve, p.t)));
    }
    const n = curves.BTP?.curve, r = curves.BTU?.curve;
    const be = (t: number) => (n && r ? breakeven(nssYield(n, t), nssYield(r, t)) : null);
    history.push({ date, be2: be(2), be5: be(5), be10: be(10), be20: be(20), nom10: n ? nssYield(n, 10) : null, real10: r ? nssYield(r, 10) : null });
    lastCurves = curves;
  }

  const date = dates[dates.length - 1];
  const monthAgo = (() => {
    const target = new Date(`${date}T00:00:00Z`); target.setUTCMonth(target.getUTCMonth() - 1);
    const t = target.toISOString().slice(0, 10);
    return [...dates].reverse().find(d => d <= t) ?? null;
  })();

  const rows: FvRow[] = [];
  bonds.forEach((b, i) => {
    const y = byDate[i].get(date), res = residuals[i].get(date), curve = lastCurves[b.type]?.curve;
    if (typeof y !== "number" || res === undefined || !curve) return;
    const t = years(date, b.maturity);
    const series = dates.filter(d => residuals[i].has(d)).slice(-Z_WINDOW).map(d => residuals[i].get(d)!);
    const stats = zAndPercentile(series, Z_MIN);
    const prev = monthAgo ? residuals[i].get(monthAgo) : undefined;
    rows.push({
      code: b.code, type: b.type, maturity: b.maturity, years: t, yield: y, fitted: nssYield(curve, t),
      residualBp: res, change1mBp: prev === undefined ? null : res - prev, z: stats.z, percentile: stats.pct,
      meanBp: series.length >= Z_MIN ? series.reduce((a, v) => a + v, 0) / series.length : null,
      observations: series.length, inFit: t >= MIN_YEARS_FIT && !isZero(b.code),
    });
  });
  rows.sort((a, b) => a.type.localeCompare(b.type) || a.years - b.years);

  const lastHistory = history.slice(-Z_WINDOW);
  const breakevens: FvBreakeven[] = [];
  const n = lastCurves.BTP?.curve, r = lastCurves.BTU?.curve;
  if (n && r) for (const tenor of BE_TENORS) {
    const value = breakeven(nssYield(n, tenor), nssYield(r, tenor));
    // Percentil sobre la historia diaria del mismo plazo en la ventana de 1 año.
    const key = `be${tenor}` as "be2" | "be5" | "be10" | "be20";
    const hist = lastHistory.map(h => h[key]).filter((v): v is number => typeof v === "number");
    const prev = monthAgo ? history.find(h => h.date === monthAgo)?.[key] ?? null : null;
    breakevens.push({ tenor, value, change1mBp: typeof prev === "number" ? 100 * (value - prev) : null, percentile: zAndPercentile(hist, Z_MIN).pct });
  }

  return { date, curves: lastCurves, rows, breakevens, history, window: Z_WINDOW };
}

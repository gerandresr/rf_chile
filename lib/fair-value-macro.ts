/**
 * Fair value direccional: la tasa a 10 años (BTP o BTU de la curva NSS) contra sus fundamentales.
 *
 *   y_t = α + β1·TPM + β2·UST10 + β3·CDS Chile + β4·ln(cobre) + β5·ln(USD/CLP) + e_t
 *
 * Mínimos cuadrados en una ventana móvil de 2 años que termina en cada fecha (reestimada semanalmente),
 * de modo que el valor justo de cada día usa solo información disponible ese día. El residuo e_t es la
 * señal: positivo = la tasa está sobre lo que justifican los fundamentales (barata; favorece duración).
 * Cobre y USD/CLP entran en log escalado a 10%, CDS por cada 10 pb: los coeficientes se leen en pb de tasa.
 */

export type MacroDriver = { key: string; label: string; unit: string; transform: (v: number) => number; change: (a: number, b: number) => number; changeUnit: "pb" | "%" };
export type MacroCoefficient = { key: string; label: string; unit: string; bp: number; tStat: number | null };
export type MacroContribution = { key: string; label: string; change: number; changeUnit: "pb" | "%"; bp: number };
export type MacroPoint = { date: string; actual: number; fair: number; low: number; high: number };
export type MacroResult = {
  date: string; actual: number; fair: number; residualBp: number; z: number; residualSdBp: number;
  r2: number; halfLifeDays: number | null; window: number;
  coefficients: MacroCoefficient[]; contributions: MacroContribution[]; actualChangeBp: number; residualChangeBp: number;
  history: MacroPoint[];
  backtest: { signals: number; hitRate: number | null; avgMoveBp: number | null };
};

export const MACRO_WINDOW = 504;
export const MACRO_STEP = 5;
const LN10 = Math.log(1.1);
export const MACRO_DRIVERS: MacroDriver[] = [
  { key: "tpm", label: "TPM", unit: "por 1 pp", transform: v => v, change: (a, b) => 100 * (b - a), changeUnit: "pb" },
  { key: "ust10", label: "Treasury 10 años", unit: "por 1 pp", transform: v => v, change: (a, b) => 100 * (b - a), changeUnit: "pb" },
  { key: "cds", label: "CDS Chile 5 años", unit: "por 10 pb", transform: v => v / 10, change: (a, b) => b - a, changeUnit: "pb" },
  { key: "copper", label: "Cobre", unit: "por 10%", transform: v => Math.log(v) / LN10, change: (a, b) => 100 * (b / a - 1), changeUnit: "%" },
  { key: "usdclp", label: "USD/CLP", unit: "por 10%", transform: v => Math.log(v) / LN10, change: (a, b) => 100 * (b / a - 1), changeUnit: "%" },
];

/** Último valor disponible en o antes de cada fecha, con un máximo de `maxGap` días corridos. */
export function alignForward(series: Map<string, number>, dates: string[], maxGap = 7) {
  const keys = [...series.keys()].sort();
  const out = new Map<string, number>();
  let k = -1;
  for (const d of dates) {
    while (k + 1 < keys.length && keys[k + 1] <= d) k++;
    if (k < 0) continue;
    const gap = (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${keys[k]}T00:00:00Z`)) / 86400000;
    if (gap <= maxGap) out.set(d, series.get(keys[k])!);
  }
  return out;
}

function solve(A: number[][], b: number[]) {
  const n = b.length, m = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = m[r][c] / m[c][c]; for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k]; }
  }
  return m.map((r, i) => r[n] / r[i]);
}

function invert(A: number[][]) {
  const n = A.length, cols = A.map((_, j) => solve(A, A.map((__, i) => (i === j ? 1 : 0))));
  return cols.some(c => !c) ? null : A.map((_, i) => Array.from({ length: n }, (__, j) => cols[j]![i]));
}

/** OLS con constante. Devuelve betas, R², desviación residual y errores estándar Newey-West (21 rezagos, solo si se piden). */
export function ols(X: number[][], y: number[], withSe = false) {
  const n = y.length, k = X[0].length + 1, Z = X.map(r => [1, ...r]);
  const A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0);
  for (let t = 0; t < n; t++) for (let i = 0; i < k; i++) { b[i] += Z[t][i] * y[t]; for (let j = 0; j < k; j++) A[i][j] += Z[t][i] * Z[t][j]; }
  const beta = solve(A, b);
  if (!beta) return null;
  const e = y.map((v, t) => v - Z[t].reduce((s, z, i) => s + z * beta[i], 0));
  const mean = y.reduce((s, v) => s + v, 0) / n;
  const sse = e.reduce((s, v) => s + v * v, 0), sst = y.reduce((s, v) => s + (v - mean) ** 2, 0);
  // Newey-West: los residuos diarios están muy autocorrelacionados; los t de OLS simples serían inflados.
  const inv = invert(A);
  let se: number[] | null = null;
  if (inv && withSe) {
    const L = 21, S = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let lag = 0; lag <= L; lag++) {
      const w = lag === 0 ? 1 : 1 - lag / (L + 1);
      for (let t = lag; t < n; t++) for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
        const v = w * e[t] * e[t - lag] * Z[t][i] * Z[t - lag][j];
        S[i][j] += v; if (lag > 0) S[j][i] += v;
      }
    }
    const V = inv.map(r => S[0].map((_, j) => r.reduce((s, a, m) => s + a * S[m][j], 0))).map(r => inv[0].map((_, j) => r.reduce((s, a, m) => s + a * inv[m][j], 0)));
    se = V.map((r, i) => Math.sqrt(Math.max(r[i], 0)));
  }
  return { beta, r2: sst > 0 ? 1 - sse / sst : 0, sd: Math.sqrt(sse / Math.max(n - k, 1)), residuals: e, se };
}

/** AR(1) del residuo: vida media en días hábiles (null si no revierte). */
export function halfLife(e: number[]) {
  let num = 0, den = 0;
  for (let t = 1; t < e.length; t++) { num += e[t] * e[t - 1]; den += e[t - 1] * e[t - 1]; }
  const phi = den > 0 ? num / den : 1;
  return phi > 0 && phi < 1 ? Math.log(0.5) / Math.log(phi) : null;
}

/**
 * `target`: tasa a 10 años por fecha (%). `drivers`: series crudas por clave de MACRO_DRIVERS, ya alineadas o no.
 */
export function macroFairValue(target: Map<string, number>, drivers: Record<string, Map<string, number>>, window = MACRO_WINDOW, step = MACRO_STEP): MacroResult {
  const dates = [...target.keys()].sort();
  const aligned = MACRO_DRIVERS.map(d => alignForward(drivers[d.key] ?? new Map(), dates));
  const rows = dates.flatMap(date => {
    const raw = aligned.map(a => a.get(date));
    if (raw.some(v => typeof v !== "number" || !Number.isFinite(v))) return [];
    const x = raw.map((v, i) => MACRO_DRIVERS[i].transform(v as number));
    return x.every(Number.isFinite) ? [{ date, y: target.get(date)!, x }] : [];
  });
  if (rows.length < window + 21) throw new Error(`Se necesitan al menos ${window + 21} días con todas las variables; hay ${rows.length}.`);

  // Valor justo en tiempo real: coeficientes de la ventana que termina en t (reestimados cada `step` días).
  const history: MacroPoint[] = [];
  const realtime: { date: string; y: number; res: number; sd: number }[] = [];
  let fit: ReturnType<typeof ols> = null;
  for (let t = window - 1; t < rows.length; t++) {
    if (!fit || (t - (window - 1)) % step === 0 || t === rows.length - 1) {
      const w = rows.slice(t - window + 1, t + 1);
      fit = ols(w.map(r => r.x), w.map(r => r.y)) ?? fit;
    }
    if (!fit) continue;
    const r = rows[t], fair = fit.beta[0] + r.x.reduce((s, v, i) => s + v * fit!.beta[i + 1], 0);
    history.push({ date: r.date, actual: r.y, fair, low: fair - fit.sd, high: fair + fit.sd });
    realtime.push({ date: r.date, y: r.y, res: r.y - fair, sd: fit.sd });
  }
  if (!fit || !history.length) throw new Error("No fue posible estimar la regresión.");
  { const w = rows.slice(-window); fit = ols(w.map(r => r.x), w.map(r => r.y), true) ?? fit; }

  const last = rows[rows.length - 1], point = history[history.length - 1];
  const residualBp = 100 * (point.actual - point.fair);

  // Descomposición del último mes (≈21 días hábiles) con los coeficientes vigentes.
  const prev = rows[Math.max(0, rows.length - 22)];
  const contributions = MACRO_DRIVERS.map((d, i) => ({
    key: d.key, label: d.label,
    change: d.change(aligned[i].get(prev.date)!, aligned[i].get(last.date)!), changeUnit: d.changeUnit,
    bp: 100 * fit!.beta[i + 1] * (last.x[i] - prev.x[i]),
  }));
  const actualChangeBp = 100 * (last.y - prev.y);
  const residualChangeBp = actualChangeBp - contributions.reduce((s, c) => s + c.bp, 0);

  // Validación: cuando el residuo en tiempo real supera 1 desviación, ¿la tasa se movió hacia el valor justo en 1 mes?
  let signals = 0, hits = 0, move = 0;
  for (let t = 0; t + 21 < realtime.length; t += 5) {
    const r = realtime[t], z = r.res / r.sd;
    if (Math.abs(z) < 1) continue;
    const change = realtime[t + 21].y - r.y;
    signals++; if (Math.sign(change) === -Math.sign(r.res)) hits++;
    move += -Math.sign(r.res) * change * 100;
  }

  return {
    date: last.date, actual: last.y, fair: point.fair, residualBp, z: residualBp / (100 * fit.sd), residualSdBp: 100 * fit.sd,
    r2: fit.r2, halfLifeDays: halfLife(fit.residuals), window,
    coefficients: MACRO_DRIVERS.map((d, i) => ({ key: d.key, label: d.label, unit: d.unit, bp: 100 * fit!.beta[i + 1], tStat: fit!.se && fit!.se[i + 1] > 0 ? fit!.beta[i + 1] / fit!.se[i + 1] : null })),
    contributions, actualChangeBp, residualChangeBp, history,
    backtest: { signals, hitRate: signals ? 100 * hits / signals : null, avgMoveBp: signals ? move / signals : null },
  };
}

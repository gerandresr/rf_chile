import type { MonthlyMacroRow } from "./macro";

/**
 * Tasa de desempleo natural mediante un filtro multivariado (ley de Okun).
 *
 * Por qué no una curva de Phillips: en la muestra disponible (2015 en adelante)
 * la relación entre desempleo e inflación no es detectable (pendiente ≈ 0 en
 * todas las especificaciones probadas, con o sin pandemia, con inflación
 * anclada a la meta y con tipo de cambio real). Con pendiente cero el filtro
 * no aprende de los datos y la "NAIRU" queda fija en el valor inicial.
 * La actividad (IMACEC desestacionalizado) sí se mueve con el desempleo, por lo
 * que se usa para separar tendencia y ciclo del desempleo.
 *
 * Modelo de espacio de estados (mensual):
 *   u_t  = n_t + c_t                       desempleo desestacionalizado
 *   y_t  = y*_t − θ c_t                    100·log(IMACEC desestacionalizado)
 *   n_t  = n_(t−1) + η_t                   tasa natural (paseo aleatorio)
 *   c_t  = φ1 c_(t−1) + φ2 c_(t−2) + ε_t   ciclo del desempleo (AR(2) estacionario)
 *   y*_t = y*_(t−1) + μ_(t−1) + ζ_t,  μ_t = μ_(t−1)   producto tendencial con deriva
 * θ es el coeficiente de Okun: 1 pp de desempleo cíclico ↔ θ % de brecha de actividad.
 * Parámetros por máxima verosimilitud; estimación filtrada (Kalman) y suavizada (RTS).
 */

export type NairuPoint = {
  date: string;
  unemployment: number;            // desempleo publicado (trimestre móvil, sin ajuste)
  unemploymentSa: number;          // desempleo desestacionalizado
  filtered: number; smoothed: number;
  filteredLower: number; filteredUpper: number;
  smoothedLower: number; smoothedUpper: number;
  outputGapSmoothed: number;       // brecha de actividad (%), y − y*
  outputGapFiltered: number;
};
export type NairuResult = {
  points: NairuPoint[];
  parameters: { okun: number; phi1: number; phi2: number; trendSd: number; cycleSd: number; outputTrendSd: number; cycleHalfLife: number };
  seasonalFactors: number[];       // enero..diciembre, pp
  observations: number;
  likelihood: number;
  start: string; end: string;
};

type Row = { date: string; u: number; y: number };
const BURN_IN = 12;                 // meses usados solo para inicializar el filtro
const MEASUREMENT_SD = 0.01;        // error de medición pequeño y fijo (pp y %)
const MIN_OBSERVATIONS = 72;
// Período excluido al estimar la estacionalidad: el shock pandémico distorsiona los factores.
const SEASONAL_EXCLUSION: [string, string] = ["2020-03-01", "2021-06-01"];

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
function monthIndex(date: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(date)) return NaN;
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

function prepare(rows: MonthlyMacroRow[]): Row[] {
  const dates = new Set<string>();
  const valid = rows.filter((row) => {
    if (!Number.isFinite(monthIndex(row.fecha))) throw new Error(`Fecha mensual inválida: ${row.fecha}`);
    if (dates.has(row.fecha)) throw new Error(`Fecha duplicada: ${row.fecha}`);
    dates.add(row.fecha);
    return isNumber(row.desempleo) && isNumber(row.imacec_ind_des) && row.imacec_ind_des > 0;
  }).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (valid.some((r) => r.desempleo! < 0 || r.desempleo! > 100)) throw new Error("El desempleo debe estar expresado en porcentaje: 9,6 significa 9,6%.");
  for (let i = 1; i < valid.length; i++) {
    if (monthIndex(valid[i].fecha) - monthIndex(valid[i - 1].fecha) !== 1) {
      throw new Error("La muestra conjunta tiene meses faltantes. Completa desempleo e IMACEC para una serie mensual continua.");
    }
  }
  if (valid.length < MIN_OBSERVATIONS) throw new Error(`Se necesitan al menos ${MIN_OBSERVATIONS} meses con desempleo e IMACEC.`);
  return valid.map((r) => ({ date: r.fecha, u: r.desempleo!, y: 100 * Math.log(r.imacec_ind_des!) }));
}

/** Factores estacionales aditivos: promedio por mes del desvío respecto de una media móvil centrada 2×12. */
export function seasonalFactors(dates: string[], values: number[]) {
  const sums = Array(12).fill(0), counts = Array(12).fill(0);
  for (let t = 6; t < values.length - 6; t++) {
    if (dates[t] >= SEASONAL_EXCLUSION[0] && dates[t] <= SEASONAL_EXCLUSION[1]) continue;
    let ma = 0.5 * (values[t - 6] + values[t + 6]);
    for (let k = t - 5; k <= t + 5; k++) ma += values[k];
    ma /= 12;
    const m = Number(dates[t].slice(5, 7)) - 1;
    sums[m] += values[t] - ma; counts[m]++;
  }
  if (counts.some((c) => c === 0)) throw new Error("No hay suficientes años para estimar la estacionalidad del desempleo.");
  const raw = sums.map((s, i) => s / counts[i]);
  const mean = raw.reduce((a, b) => a + b, 0) / 12;
  return raw.map((v) => v - mean);
}

// ---- Álgebra pequeña (matrices como arreglos de filas) ----
type M = number[][];
const zeros = (r: number, c: number): M => Array.from({ length: r }, () => Array(c).fill(0));
function mul(a: M, b: M): M {
  const out = zeros(a.length, b[0].length);
  for (let i = 0; i < a.length; i++) for (let k = 0; k < b.length; k++) {
    const v = a[i][k]; if (v === 0) continue;
    for (let j = 0; j < b[0].length; j++) out[i][j] += v * b[k][j];
  }
  return out;
}
const tr = (a: M): M => a[0].map((_, j) => a.map((row) => row[j]));
const add = (a: M, b: M): M => a.map((row, i) => row.map((v, j) => v + b[i][j]));
const sub = (a: M, b: M): M => a.map((row, i) => row.map((v, j) => v - b[i][j]));
const vec = (v: number[]): M => v.map((x) => [x]);
function inv2(a: M): { inv: M; det: number } {
  const det = a[0][0] * a[1][1] - a[0][1] * a[1][0];
  return { det, inv: [[a[1][1] / det, -a[0][1] / det], [-a[1][0] / det, a[0][0] / det]] };
}
/** Inversa general (Gauss-Jordan con pivoteo); usada en el suavizador. */
function inverse(a: M): M {
  const n = a.length, m = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-14) throw new Error("Matriz singular en el suavizador.");
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c];
    for (let j = 0; j < 2 * n; j++) m[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) {
      const f = m[r][c];
      if (f !== 0) for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[c][j];
    }
  }
  return m.map((row) => row.slice(n));
}

type Params = { phi1: number; phi2: number; theta: number; sn: number; sc: number; sy: number };
/** Parámetros libres → restringidos. φ vía autocorrelaciones parciales (garantiza AR(2) estacionario). */
function unpack(x: number[]): Params {
  const r1 = Math.tanh(x[0]), r2 = Math.tanh(x[1]);
  return { phi1: r1 * (1 - r2), phi2: r2, theta: Math.exp(x[2]), sn: Math.exp(x[3]), sc: Math.exp(x[4]), sy: Math.exp(x[5]) };
}

type Filtered = { a: number[]; P: M; ap: number[]; Pp: M };
function kalman(rows: { u: number; y: number }[], p: Params, capture: boolean) {
  const T: M = [[1, 0, 0, 0, 0], [0, p.phi1, p.phi2, 0, 0], [0, 1, 0, 0, 0], [0, 0, 0, 1, 1], [0, 0, 0, 0, 1]];
  const Q: M = zeros(5, 5); Q[0][0] = p.sn ** 2; Q[1][1] = p.sc ** 2; Q[3][3] = p.sy ** 2;
  const Z: M = [[1, 1, 0, 0, 0], [0, -p.theta, 0, 1, 0]], Zt = tr(Z);
  const H: M = [[MEASUREMENT_SD ** 2, 0], [0, MEASUREMENT_SD ** 2]];
  const Tt = tr(T);
  const initialU = rows.slice(0, 12).reduce((s, r) => s + r.u, 0) / Math.min(12, rows.length);
  let a = [initialU, 0, 0, rows[0].y, 0];
  // Prior amplio: 2 pp para tendencia y ciclo, 10% para el nivel del producto, 1% mensual para la deriva.
  let P: M = zeros(5, 5); P[0][0] = 4; P[1][1] = 4; P[2][2] = 4; P[3][3] = 100; P[4][4] = 1;
  let nll = 0;
  const states: Filtered[] = [];
  for (let t = 0; t < rows.length; t++) {
    const ap = [a[0], p.phi1 * a[1] + p.phi2 * a[2], a[1], a[3] + a[4], a[4]];
    const Pp = add(mul(mul(T, P), Tt), Q);
    const v = [rows[t].u - (ap[0] + ap[1]), rows[t].y - (ap[3] - p.theta * ap[1])];
    const F = add(mul(mul(Z, Pp), Zt), H);
    const { inv: Fi, det } = inv2(F);
    const K = mul(mul(Pp, Zt), Fi);
    const Kv = mul(K, vec(v));
    a = ap.map((x, i) => x + Kv[i][0]);
    // Forma de Joseph: P = (I−KZ) Pp (I−KZ)' + K H K'
    const IKZ = sub(zeros(5, 5).map((row, i) => row.map((_, j) => (i === j ? 1 : 0))), mul(K, Z));
    P = add(mul(mul(IKZ, Pp), tr(IKZ)), mul(mul(K, H), tr(K)));
    if (t >= BURN_IN) {
      const q = v[0] * (Fi[0][0] * v[0] + Fi[0][1] * v[1]) + v[1] * (Fi[1][0] * v[0] + Fi[1][1] * v[1]);
      nll += 0.5 * (2 * Math.log(2 * Math.PI) + Math.log(det) + q);
    }
    if (capture) states.push({ a, P, ap, Pp });
  }
  return { nll: Number.isFinite(nll) ? nll : Infinity, states, T };
}

/** Versión rápida solo para la verosimilitud (sin asignaciones); equivalente a kalman(). */
function negLogLikelihood(rows: { u: number; y: number }[], p: Params) {
  const n = 5, h = MEASUREMENT_SD ** 2;
  const Tm = [1, 0, 0, 0, 0, 0, p.phi1, p.phi2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1];
  const q = [p.sn ** 2, p.sc ** 2, 0, p.sy ** 2, 0];
  const z0 = [1, 1, 0, 0, 0], z1 = [0, -p.theta, 0, 1, 0];
  const initialU = rows.slice(0, 12).reduce((s, r) => s + r.u, 0) / Math.min(12, rows.length);
  const a = [initialU, 0, 0, rows[0].y, 0];
  const P = new Float64Array(25); P[0] = 4; P[6] = 4; P[12] = 4; P[18] = 100; P[24] = 1;
  const TP = new Float64Array(25), Pp = new Float64Array(25), ap = new Float64Array(5);
  const pz0 = new Float64Array(5), pz1 = new Float64Array(5), k0 = new Float64Array(5), k1 = new Float64Array(5);
  let nll = 0;
  for (let t = 0; t < rows.length; t++) {
    for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < n; k++) s += Tm[i * n + k] * a[k]; ap[i] = s; }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { let s = 0; for (let k = 0; k < n; k++) s += Tm[i * n + k] * P[k * n + j]; TP[i * n + j] = s; }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { let s = 0; for (let k = 0; k < n; k++) s += TP[i * n + k] * Tm[j * n + k]; Pp[i * n + j] = s + (i === j ? q[i] : 0); }
    for (let i = 0; i < n; i++) { let s0 = 0, s1 = 0; for (let k = 0; k < n; k++) { s0 += Pp[i * n + k] * z0[k]; s1 += Pp[i * n + k] * z1[k]; } pz0[i] = s0; pz1[i] = s1; }
    let f00 = h, f01 = 0, f11 = h, e0 = rows[t].u, e1 = rows[t].y;
    for (let k = 0; k < n; k++) { f00 += z0[k] * pz0[k]; f01 += z0[k] * pz1[k]; f11 += z1[k] * pz1[k]; e0 -= z0[k] * ap[k]; e1 -= z1[k] * ap[k]; }
    const det = f00 * f11 - f01 * f01;
    if (!(det > 0)) return Infinity;
    const i00 = f11 / det, i01 = -f01 / det, i11 = f00 / det;
    for (let i = 0; i < n; i++) { k0[i] = pz0[i] * i00 + pz1[i] * i01; k1[i] = pz0[i] * i01 + pz1[i] * i11; }
    for (let i = 0; i < n; i++) a[i] = ap[i] + k0[i] * e0 + k1[i] * e1;
    // P = Pp − K F K' (equivalente a Joseph con la ganancia óptima)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) P[i * n + j] = Pp[i * n + j] - (k0[i] * pz0[j] + k1[i] * pz1[j]);
    if (t >= BURN_IN) nll += 0.5 * (2 * Math.log(2 * Math.PI) + Math.log(det) + e0 * (i00 * e0 + i01 * e1) + e1 * (i01 * e0 + i11 * e1));
  }
  return Number.isFinite(nll) ? nll : Infinity;
}

/** Nelder-Mead determinístico. */
function nelderMead(f: (x: number[]) => number, start: number[], scale: number, iterations = 1500) {
  const n = start.length;
  let simplex = [start, ...start.map((_, i) => start.map((v, j) => (i === j ? v + scale : v)))].map((x) => ({ x, f: f(x) }));
  for (let it = 0; it < iterations; it++) {
    simplex.sort((a, b) => a.f - b.f);
    if (Math.abs(simplex[n].f - simplex[0].f) < 1e-10 && it > 50) break;
    const centroid = Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i].x[j] / n;
    const at = (c: number) => centroid.map((v, j) => v + c * (simplex[n].x[j] - v));
    const r = { x: at(-1), f: 0 }; r.f = f(r.x);
    if (r.f < simplex[0].f) {
      const e = { x: at(-2), f: 0 }; e.f = f(e.x);
      simplex[n] = e.f < r.f ? e : r;
    } else if (r.f < simplex[n - 1].f) simplex[n] = r;
    else {
      const c = { x: r.f < simplex[n].f ? at(-0.5) : at(0.5), f: 0 }; c.f = f(c.x);
      if (c.f < Math.min(r.f, simplex[n].f)) simplex[n] = c;
      else simplex = simplex.map((s, i) => (i === 0 ? s : { x: s.x.map((v, j) => simplex[0].x[j] + 0.5 * (v - simplex[0].x[j])), f: 0 })).map((s, i) => (i === 0 ? s : { ...s, f: f(s.x) }));
    }
  }
  simplex.sort((a, b) => a.f - b.f);
  return simplex[0];
}

function fit(rows: Row[]) {
  const objective = (x: number[]) => (x.some((v) => Math.abs(v) > 8) ? Infinity : negLogLikelihood(rows, unpack(x)));
  let best = { x: [] as number[], f: Infinity };
  // Varios puntos de partida (ciclo persistente/oscilante, Okun bajo/alto).
  for (const [a0, b0, okun] of [[0.8, -0.3, 0.7], [1.5, -0.9, 2], [1.5, -0.3, 1.5], [0.8, -0.9, 3]]) {
    let candidate = nelderMead(objective, [a0, b0, Math.log(okun), Math.log(0.1), Math.log(0.2), Math.log(0.5)], 0.5);
    candidate = nelderMead(objective, candidate.x, 0.05);   // reinicio para pulir
    if (candidate.f < best.f) best = candidate;
  }
  return best;
}

export function estimateNairu(rows: MonthlyMacroRow[]): NairuResult {
  const prepared = prepare(rows);
  const dates = prepared.map((r) => r.date);
  const factors = seasonalFactors(dates, prepared.map((r) => r.u));
  const adjusted = prepared.map((r) => ({ ...r, u: r.u - factors[Number(r.date.slice(5, 7)) - 1] }));
  const best = fit(adjusted);
  const params = unpack(best.x);
  const { states, T } = kalman(adjusted, params, true);
  const Tt = tr(T);
  // Suavizador de Rauch–Tung–Striebel.
  const smoothed = states.map((s) => ({ a: s.a, P: s.P }));
  for (let t = states.length - 2; t >= 0; t--) {
    const G = mul(mul(states[t].P, Tt), inverse(states[t + 1].Pp));
    const diff = smoothed[t + 1].a.map((v, i) => v - states[t + 1].ap[i]);
    const Gd = mul(G, vec(diff));
    smoothed[t] = {
      a: states[t].a.map((v, i) => v + Gd[i][0]),
      P: add(states[t].P, mul(mul(G, sub(smoothed[t + 1].P, states[t + 1].Pp)), tr(G))),
    };
  }
  const points: NairuPoint[] = prepared.map((r, t) => {
    const fm = 1.96 * Math.sqrt(Math.max(0, states[t].P[0][0]));
    const sm = 1.96 * Math.sqrt(Math.max(0, smoothed[t].P[0][0]));
    return {
      date: r.date, unemployment: r.u, unemploymentSa: adjusted[t].u,
      filtered: states[t].a[0], smoothed: smoothed[t].a[0],
      filteredLower: states[t].a[0] - fm, filteredUpper: states[t].a[0] + fm,
      smoothedLower: smoothed[t].a[0] - sm, smoothedUpper: smoothed[t].a[0] + sm,
      outputGapSmoothed: -params.theta * smoothed[t].a[1],
      outputGapFiltered: -params.theta * states[t].a[1],
    };
  }).slice(BURN_IN);
  // Vida media del ciclo: meses hasta que la respuesta a un shock cae bajo la mitad de su máximo.
  const impulse = [1, params.phi1];
  for (let k = 2; k < 240; k++) impulse.push(params.phi1 * impulse[k - 1] + params.phi2 * impulse[k - 2]);
  const peak = Math.max(...impulse.map(Math.abs));
  const peakAt = impulse.findIndex((v) => Math.abs(v) === peak);
  const halfLife = impulse.findIndex((v, k) => k > peakAt && Math.abs(v) < peak / 2) - peakAt;
  return {
    points,
    parameters: { okun: params.theta, phi1: params.phi1, phi2: params.phi2, trendSd: params.sn, cycleSd: params.sc, outputTrendSd: params.sy, cycleHalfLife: halfLife },
    seasonalFactors: factors,
    observations: prepared.length,
    likelihood: -best.f,
    start: points[0]?.date ?? "", end: points.at(-1)?.date ?? "",
  };
}

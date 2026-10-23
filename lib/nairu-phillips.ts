/**
 * NAIRU por curva de Phillips (modelo de componentes no observados, trimestral).
 *
 *   u_t  = u*_t + g_t                                        desempleo desestacionalizado
 *   u*_t = u*_(t−1) + η_t,        η ~ N(0, σ_η²)             NAIRU (paseo aleatorio)
 *   g_t  = φ1 g_(t−1) + φ2 g_(t−2) + ε_t                     brecha de desempleo (AR(2))
 *
 * Curva de Phillips (forma "parcial" con expectativas):
 *   π_t = ρ π_(t−1) + (1 − ρ) πᵉ_t − κ g_t + δ Δfx_t + c + ν_t
 *     π   = IPC variación 12 meses (promedio del trimestre)
 *     πᵉ  = compensación inflacionaria a 1 año (swap Cámara CLP − UF) observada 4 trimestres antes
 *     Δfx = depreciación anual del peso (USD/CLP, %): shocks de oferta importados
 * La NAIRU es el desempleo que, sin shocks, no presiona la inflación (g = 0).
 *
 * σ_η se fija (0,1 pp por trimestre) porque por máxima verosimilitud se va a los extremos
 * (NAIRU constante o NAIRU que copia al desempleo). Los trimestres de pandemia se excluyen de
 * la ecuación de inflación. κ se estima con poca precisión: por eso también se entrega el
 * modelo re-estimado para varias pendientes fijas (perfil de verosimilitud).
 */

export type QuarterRow = { date: string; u: number | null; pi: number | null; pe: number | null; fx: number | null };
export type PhillipsPoint = {
  date: string; u: number | null; pi: number | null; pe: number | null;
  nairu: number; lower: number; upper: number; nairuFiltered: number; gap: number;
};
export type PhillipsFit = {
  kappa: number; rho: number; delta: number; c: number; phi1: number; phi2: number;
  sigmaCycle: number; sigmaInflation: number; logLik: number; points: PhillipsPoint[];
};
export type PhillipsResult = {
  ml: PhillipsFit; grid: PhillipsFit[]; kappaInterval: [number, number];
  sigmaEta: number; start: string; end: string; excluded: [string, string]; observations: number;
};

export const SIGMA_ETA = 0.1;
export const PANDEMIC: [string, string] = ["2020-04-01", "2021-10-01"];
export const KAPPA_GRID = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1];
const Z90 = 1.645;

// ---------------- Preparación de datos ----------------
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const quarterOf = (date: string) => { const y = date.slice(0, 4), m = Number(date.slice(5, 7)); return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`; };
const shiftQuarter = (q: string, n: number) => { const y = Number(q.slice(0, 4)), m = Number(q.slice(5, 7)) - 1 + 3 * n; const d = new Date(Date.UTC(y, m, 1)); return d.toISOString().slice(0, 10); };

/** Factores estacionales mensuales (pp) por diferencia con un promedio móvil centrado de 12 meses. */
export function seasonalAdjust(dates: string[], values: number[]) {
  const sums = Array(12).fill(0), counts = Array(12).fill(0);
  for (let i = 6; i < values.length - 6; i++) {
    const ma = (values.slice(i - 6, i + 6).reduce((a, b) => a + b, 0) + values.slice(i - 5, i + 7).reduce((a, b) => a + b, 0)) / 24;
    const m = Number(dates[i].slice(5, 7)) - 1;
    sums[m] += values[i] - ma; counts[m]++;
  }
  const raw = sums.map((s, i) => counts[i] ? s / counts[i] : 0), mean = raw.reduce((a, b) => a + b, 0) / 12;
  const factors = raw.map(f => f - mean);
  return { factors, adjusted: values.map((v, i) => v - factors[Number(dates[i].slice(5, 7)) - 1]) };
}

const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
function quarterly(points: [string, number][]) {
  const groups = new Map<string, number[]>();
  for (const [d, v] of points) { const q = quarterOf(d); if (!groups.has(q)) groups.set(q, []); groups.get(q)!.push(v); }
  return new Map([...groups].map(([q, xs]) => [q, mean(xs)!]));
}

/** Arma los trimestres: desempleo desestacionalizado, IPC 12m, expectativa (BEI 1 año, 4 trimestres antes) y USD/CLP. */
export function buildQuarters(monthly: { fecha: string; desempleo?: number | null; ipc_yoy?: number | null }[], bei1y: Map<string, number>, usdclp: Map<string, number>, from = "2016-01-01"): QuarterRow[] {
  const unemp = monthly.filter(r => isNum(r.desempleo)).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const sa = seasonalAdjust(unemp.map(r => r.fecha), unemp.map(r => r.desempleo as number)).adjusted;
  const u = quarterly(unemp.map((r, i) => [r.fecha, sa[i]]));
  const pi = quarterly(monthly.filter(r => isNum(r.ipc_yoy)).map(r => [r.fecha, r.ipc_yoy as number]));
  const bei = quarterly([...bei1y]), fx = quarterly([...usdclp]);
  const last = [...u.keys(), ...pi.keys()].sort().at(-1)!;
  const rows: QuarterRow[] = [];
  for (let q = from; q <= last; q = shiftQuarter(q, 1)) rows.push({ date: q, u: u.get(q) ?? null, pi: pi.get(q) ?? null, pe: bei.get(shiftQuarter(q, -4)) ?? null, fx: fx.get(q) ?? null });
  // Depreciación anual en la columna fx (necesita el trimestre de hace un año).
  return rows.map(r => {
    const f0 = fx.get(shiftQuarter(r.date, -4));
    return { ...r, fx: isNum(r.fx) && isNum(f0) ? 100 * Math.log(r.fx / f0) : null };
  });
}

// ---------------- Álgebra mínima ----------------
type M = number[][];
const T = (a: M): M => a[0].map((_, j) => a.map(r => r[j]));
const mul = (a: M, b: M): M => a.map(r => b[0].map((_, j) => r.reduce((s, v, k) => s + v * b[k][j], 0)));
const addM = (a: M, b: M): M => a.map((r, i) => r.map((v, j) => v + b[i][j]));
const subM = (a: M, b: M): M => a.map((r, i) => r.map((v, j) => v - b[i][j]));
function inv(a: M): { inv: M; det: number } {
  if (a.length === 1) return { inv: [[1 / a[0][0]]], det: a[0][0] };
  const [[p, q], [r, s]] = a, det = p * s - q * r;
  return { inv: [[s / det, -q / det], [-r / det, p / det]], det };
}

type Params = { phi1: number; phi2: number; sg: number; rho: number; kappa: number; delta: number; se: number; c: number };

function filter(rows: QuarterRow[], p: Params, smooth: boolean) {
  const n = rows.length;
  const F: M = [[1, 0, 0], [0, p.phi1, p.phi2], [0, 1, 0]];
  const Q: M = [[SIGMA_ETA ** 2, 0, 0], [0, p.sg ** 2, 0], [0, 0, 0]];
  const u0 = rows.find(r => isNum(r.u))?.u ?? 8;
  let x: M = [[u0], [0], [0]], P: M = [[4, 0, 0], [0, 4, 0], [0, 0, 4]];
  const xp: M[] = [], Pp: M[] = [], xf: M[] = [], Pf: M[] = [];
  let ll = 0;
  for (let t = 0; t < n; t++) {
    if (t > 0) { x = mul(F, x); P = addM(mul(mul(F, P), T(F)), Q); }
    xp.push(x); Pp.push(P);
    const r = rows[t], prev = rows[t - 1], H: number[][] = [], y: number[] = [], R: number[] = [];
    if (isNum(r.u)) { H.push([1, 1, 0]); y.push(r.u); R.push(0.01); }
    const excluded = r.date >= PANDEMIC[0] && r.date <= PANDEMIC[1];
    if (prev && !excluded && isNum(r.pi) && isNum(r.pe) && isNum(r.fx) && isNum(prev.pi)) {
      H.push([0, -p.kappa, 0]); y.push(r.pi - p.rho * prev.pi - (1 - p.rho) * r.pe - p.delta * r.fx - p.c); R.push(p.se ** 2);
    }
    if (H.length) {
      const v = y.map((yi, i) => [yi - H[i].reduce((s, h, k) => s + h * x[k][0], 0)]);
      const S = addM(mul(mul(H, P), T(H)), R.map((ri, i) => R.map((_, j) => i === j ? ri : 0)));
      const { inv: Si, det } = inv(S);
      if (!(det > 0)) return { ll: -Infinity, xf, Pf, xs: [], Ps: [] };
      const K = mul(mul(P, T(H)), Si);
      ll += -0.5 * (Math.log(det) + mul(mul(T(v), Si), v)[0][0] + H.length * Math.log(2 * Math.PI));
      x = addM(x, mul(K, v)); P = subM(P, mul(mul(K, H), P));
    }
    xf.push(x); Pf.push(P);
  }
  if (!smooth) return { ll, xf, Pf, xs: [], Ps: [] };
  const xs: M[] = Array(n), Ps: M[] = Array(n);
  xs[n - 1] = xf[n - 1]; Ps[n - 1] = Pf[n - 1];
  for (let t = n - 2; t >= 0; t--) {
    // P(t+1|t) puede ser singular en la 3ª componente: se invierte el bloque 3×3 por Gauss-Jordan.
    const J = mul(mul(Pf[t], T(F)), invert3(Pp[t + 1]));
    xs[t] = addM(xf[t], mul(J, subM(xs[t + 1], xp[t + 1])));
    Ps[t] = addM(Pf[t], mul(mul(J, subM(Ps[t + 1], Pp[t + 1])), T(J)));
  }
  return { ll, xf, Pf, xs, Ps };
}
function invert3(a: M): M {
  const n = a.length, m = a.map((r, i) => [...r.map((v, j) => v + (i === j ? 1e-10 : 0)), ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    [m[c], m[piv]] = [m[piv], m[c]];
    const d = m[c][c]; for (let j = 0; j < 2 * n; j++) m[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = m[r][c]; for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[c][j]; }
  }
  return m.map(r => r.slice(n));
}

// ---------------- Estimación ----------------
const logistic = (z: number) => 1 / (1 + Math.exp(-z));
function unpack(z: number[], kappa?: number): Params | null {
  const [phi1, phi2, lsg, zr, k, delta, lse, c] = z;
  if (phi1 + phi2 >= 0.98 || phi2 - phi1 >= 0.98 || Math.abs(phi2) >= 0.98) return null;
  const kap = kappa ?? k;
  if (kap < 0) return null;
  return { phi1, phi2, sg: Math.exp(lsg), rho: 0.98 * logistic(zr), kappa: kap, delta, se: Math.exp(lse), c };
}

function nelderMead(f: (x: number[]) => number, start: number[], scale: number[], iterations = 4000) {
  const n = start.length;
  let simplex = [start, ...start.map((_, i) => start.map((v, j) => v + (i === j ? scale[j] : 0)))].map(x => ({ x, f: f(x) }));
  for (let it = 0; it < iterations; it++) {
    simplex.sort((a, b) => a.f - b.f);
    if (Math.abs(simplex[n].f - simplex[0].f) < 1e-9 && it > 200) break;
    const centroid = start.map((_, j) => simplex.slice(0, n).reduce((s, p) => s + p.x[j], 0) / n);
    const at = (t: number) => centroid.map((c, j) => c + t * (simplex[n].x[j] - c));
    const r = at(-1), fr = f(r);
    if (fr < simplex[0].f) { const e = at(-2), fe = f(e); simplex[n] = fe < fr ? { x: e, f: fe } : { x: r, f: fr }; }
    else if (fr < simplex[n - 1].f) simplex[n] = { x: r, f: fr };
    else {
      const k = fr < simplex[n].f ? at(-0.5) : at(0.5), fk = f(k);
      if (fk < Math.min(fr, simplex[n].f)) simplex[n] = { x: k, f: fk };
      else simplex = simplex.map((p, i) => i === 0 ? p : (() => { const x = p.x.map((v, j) => simplex[0].x[j] + 0.5 * (v - simplex[0].x[j])); return { x, f: f(x) }; })());
    }
  }
  simplex.sort((a, b) => a.f - b.f);
  return simplex[0];
}

function fitOne(rows: QuarterRow[], kappa?: number, warm?: number[]): PhillipsFit & { z: number[] } {
  const objective = (z: number[]) => { const p = unpack(z, kappa); if (!p) return 1e10; const { ll } = filter(rows, p, false); return Number.isFinite(ll) ? -ll : 1e10; };
  const scale = [0.2, 0.2, 0.3, 0.8, 0.15, 0.03, 0.3, 0.3];
  let best: { x: number[]; f: number } | null = null;
  const starts = warm ? [warm] : [0.1, 0.5].flatMap(k0 => [1.5, 3].map(rho0 => [1.2, -0.4, Math.log(0.5), rho0, k0, 0.07, Math.log(0.9), -0.3]));
  for (const start of starts) {
    let r = nelderMead(objective, start, warm ? scale.map(s => s / 2) : scale);
    r = nelderMead(objective, r.x, scale.map(s => s / 4));   // reinicio para salir de colapsos del simplex
    if (!best || r.f < best.f) best = r;
  }
  const p = unpack(best!.x, kappa)!;
  const { ll, xf, xs, Ps } = filter(rows, p, true);
  const points = rows.map((r, t) => {
    const sd = Math.sqrt(Math.max(Ps[t][0][0], 0));
    return { date: r.date, u: r.u, pi: r.pi, pe: r.pe, nairu: xs[t][0][0], lower: xs[t][0][0] - Z90 * sd, upper: xs[t][0][0] + Z90 * sd, nairuFiltered: xf[t][0][0], gap: xs[t][1][0] };
  });
  return { z: best!.x, kappa: p.kappa, rho: p.rho, delta: p.delta, c: p.c, phi1: p.phi1, phi2: p.phi2, sigmaCycle: p.sg, sigmaInflation: p.se, logLik: ll, points };
}

export function estimatePhillipsNairu(rows: QuarterRow[]): PhillipsResult {
  // Se recorta al último trimestre con desempleo.
  const lastU = rows.map(r => isNum(r.u)).lastIndexOf(true);
  const data = rows.slice(0, lastU + 1);
  const { z, ...ml } = fitOne(data);
  const grid = KAPPA_GRID.map(k => { const { z: _z, ...fit } = fitOne(data, k, z); return fit; });
  // Intervalo de 90% para κ por perfil de verosimilitud (caída de 1,35 en log-verosimilitud).
  const maxLl = Math.max(ml.logLik, ...grid.map(g => g.logLik));
  const inside = grid.filter(g => g.logLik >= maxLl - 1.353).map(g => g.kappa);
  const observations = data.filter((r, t) => t > 0 && !(r.date >= PANDEMIC[0] && r.date <= PANDEMIC[1]) && isNum(r.pi) && isNum(r.pe) && isNum(r.fx)).length;
  return { ml, grid, kappaInterval: [Math.min(...inside, ml.kappa), Math.max(...inside, ml.kappa)], sigmaEta: SIGMA_ETA, start: data[0].date, end: data[data.length - 1].date, excluded: PANDEMIC, observations };
}

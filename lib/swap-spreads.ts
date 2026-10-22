/** Spread indicativo: TIR del papel menos tasa par swap; no es un asset swap de flujos. */
export type SpreadBasis = "maturity" | "duration";
export type SpreadPoint = { date: string; yield: number; swap: number; spread: number; durationSpread: number | null; macaulay: number; term: number;
  referenceSpread?: number | null; residual?: number | null; durationReferenceSpread?: number | null; durationResidual?: number | null };
export type SpreadBond = { code: string; currency: "CLP" | "UF"; maturity: string; points: SpreadPoint[]; missing: number };
export type ConstantSpread = { currency: "CLP" | "UF"; tenor: number; points: { date: string; spread: number }[] };
export type SpreadData = { asOf: string; bonds: SpreadBond[]; errors: string[]; constantSpreads: ConstantSpread[] };
export type CurvePoint = { x: number; y: number };
export const DAY = 86400000;
export const time = (date: string) => Date.parse(`${date}T00:00:00Z`);
export const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const spreadValue = (p: SpreadPoint, basis: SpreadBasis) => basis === "duration" ? p.durationSpread : p.spread;
export const residualValue = (p: SpreadPoint, basis: SpreadBasis) => (basis === "duration" ? p.durationResidual : p.residual) ?? null;
export const referenceValue = (p: SpreadPoint, basis: SpreadBasis) => (basis === "duration" ? p.durationReferenceSpread : p.referenceSpread) ?? null;

/** Réplicas de un mismo plazo se promedian antes de interpolar. */
export function distinctCurve(points: CurvePoint[]) {
  const groups = new Map<number, number[]>();
  for (const p of points) if (Number.isFinite(p.x) && Number.isFinite(p.y)) groups.set(p.x, [...(groups.get(p.x) ?? []), p.y]);
  return [...groups].map(([x, ys]) => ({ x, y: ys.reduce((a, b) => a + b, 0) / ys.length })).sort((a, b) => a.x - b.x);
}

/** Referencia diaria leave-one-out. Nunca usa otros días ni incorpora el propio papel. */
export function relativeCurves(universe: SpreadBond[]) {
  const dates = new Map<string, { code: string; currency: "CLP" | "UF"; point: SpreadPoint }[]>();
  for (const b of universe) for (const point of b.points) {
    if (point.term <= 0 || point.date >= b.maturity) continue;
    const key = `${b.currency}:${point.date}`;
    dates.set(key, [...(dates.get(key) ?? []), { code: b.code, currency: b.currency, point }]);
  }
  const constantSpreads: ConstantSpread[] = [];
  for (const currency of ["CLP", "UF"] as const) for (const tenor of [1, 2, 3, 5, 10]) constantSpreads.push({ currency, tenor, points: [] });
  const references = new Map<string, { referenceSpread: number | null; residual: number | null; durationReferenceSpread: number | null; durationResidual: number | null }>();
  for (const [key, rows] of dates) {
    const [currency, date] = key.split(":");
    const curve = distinctCurve(rows.map(r => ({ x: r.point.term, y: r.point.spread })));
    if (curve.length >= 2) for (const s of constantSpreads.filter(s => s.currency === currency)) {
      const v = interpolate(s.tenor, curve);
      if (v !== null) s.points.push({ date, spread: v });
    }
    for (const row of rows) {
      const peers = rows.filter(r => r.code !== row.code);
      const maturityCurve = distinctCurve(peers.map(r => ({ x: r.point.term, y: r.point.spread })));
      const durationCurve = distinctCurve(peers.flatMap(r => r.point.durationSpread === null ? [] : [{ x: r.point.macaulay / (1 + r.point.yield / 100), y: r.point.durationSpread }]));
      const referenceSpread = maturityCurve.length >= 2 ? interpolate(row.point.term, maturityCurve) : null;
      const durationReferenceSpread = durationCurve.length >= 2 ? interpolate(row.point.macaulay / (1 + row.point.yield / 100), durationCurve) : null;
      references.set(`${row.code}:${date}`, { referenceSpread, residual: referenceSpread === null ? null : row.point.spread - referenceSpread,
        durationReferenceSpread, durationResidual: durationReferenceSpread === null || row.point.durationSpread === null ? null : row.point.durationSpread - durationReferenceSpread });
    }
  }
  for (const s of constantSpreads) s.points.sort((a, b) => a.date.localeCompare(b.date));
  return { bonds: universe.map(b => ({ ...b, points: b.points.map(p => ({ ...p, ...references.get(`${b.code}:${p.date}`) })) })), constantSpreads };
}

/** El envejecimiento conserva el residuo; la convergencia solo modifica ese residuo. */
export function residualScenario(currentSpread: number, currentReference: number, futureReference: number, forecastResidual: number | null) {
  const residual = currentSpread - currentReference;
  const rollSpreadBp = currentReference - futureReference;
  const neutralSpread = futureReference + residual;
  const targetSpread = futureReference + (forecastResidual ?? residual);
  return { residual, rollSpreadBp, neutralSpread, targetSpread, convergenceBp: targetSpread - neutralSpread };
}

/** No extrapola, no rellena puntos fuera de la curva. */
export function interpolate(x: number, points: CurvePoint[]): number | null {
  const p = points.filter(v => Number.isFinite(v.x) && Number.isFinite(v.y)).slice().sort((a, b) => a.x - b.x);
  if (!p.length || x < p[0].x || x > p[p.length - 1].x) return null;
  const exact = p.find(v => Math.abs(v.x - x) < 1e-9);
  if (exact) return exact.y;
  for (let i = 1; i < p.length; i++) if (x < p[i].x) return p[i - 1].y + (x - p[i - 1].x) / (p[i].x - p[i - 1].x) * (p[i].y - p[i - 1].y);
  return null;
}

export function windowPoints(bond: SpreadBond, years: number, asOf: string, basis: SpreadBasis) {
  const cutoff = time(asOf) - years * 365.25 * DAY;
  return bond.points.filter(p => time(p.date) >= cutoff && p.date <= asOf && spreadValue(p, basis) !== null);
}

export function stats(values: number[]) {
  const n = values.length;
  if (!n) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0;
  const sorted = values.slice().sort((a, b) => a - b), last = values[n - 1];
  return { n, mean, sd, median: (sorted[Math.floor((n - 1) / 2)] + sorted[Math.ceil((n - 1) / 2)]) / 2,
    z: sd > 1e-9 ? (last - mean) / sd : null,
    percentile: 100 * (values.filter(v => v < last).length + .5 * values.filter(v => v === last).length) / n };
}

function adjacentBusinessDay(a: string, b: string) {
  const d = new Date(time(a));
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return iso(d.getTime()) === b;
}
type Observation = { date: string; value: number };
function fitAR(observations: Observation[]) {
  const pairs = observations.slice(1).flatMap((p, i) => adjacentBusinessDay(observations[i].date, p.date) ? [[observations[i].value, p.value]] : []);
  if (pairs.length < 60) return null;
  const n = pairs.length, mx = pairs.reduce((s, p) => s + p[0], 0) / n, my = pairs.reduce((s, p) => s + p[1], 0) / n;
  const xx = pairs.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  if (xx < 1e-9) return null;
  const phi = pairs.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / xx, alpha = my - phi * mx;
  const variance = pairs.reduce((s, p) => s + (p[1] - alpha - phi * p[0]) ** 2, 0) / (n - 2);
  const phiSE = Math.sqrt(variance / xx);
  return { phi, alpha, variance, phiSE, n };
}

export function meanReversion(points: SpreadPoint[], basis: SpreadBasis, months: number) {
  const obs = points.flatMap(p => { const v = spreadValue(p, basis); return v === null ? [] : [{ date: p.date, value: v }]; });
  return meanReversionSeries(obs, months);
}

export function meanReversionSeries(obs: Observation[], months: number) {
  const fit = fitAR(obs);
  if (!fit) return null;
  const stable = fit.phi > 0 && fit.phi < 1;
  // Diagnóstico prudente, no reemplaza una prueba de raíz unitaria con valores críticos adecuados.
  const distinguishable = stable && fit.phi + 1.96 * fit.phiSE < 1;
  const mean = stable ? fit.alpha / (1 - fit.phi) : null;
  const halfLife = stable ? Math.log(.5) / Math.log(fit.phi) : null;
  const steps = Math.round(months * 21), power = Math.pow(fit.phi, steps);
  const forecast = stable ? mean! + power * (obs[obs.length - 1].value - mean!) : null;
  const band = stable ? 1.96 * Math.sqrt(fit.variance * (1 - power ** 2) / (1 - fit.phi ** 2)) : null;
  let arError = 0, rwError = 0, tests = 0;
  // Walk-forward de un día, hasta 60 observaciones; cada ajuste usa solo el pasado.
  for (let i = Math.max(120, obs.length - 60); i < obs.length; i++) {
    if (!adjacentBusinessDay(obs[i - 1].date, obs[i].date)) continue;
    const train = fitAR(obs.slice(Math.max(0, i - 252), i));
    if (!train || train.phi <= 0 || train.phi >= 1) continue;
    arError += (obs[i].value - train.alpha - train.phi * obs[i - 1].value) ** 2;
    rwError += (obs[i].value - obs[i - 1].value) ** 2;
    tests++;
  }
  const rmseAR = tests >= 20 ? Math.sqrt(arError / tests) : null, rmseRW = tests >= 20 ? Math.sqrt(rwError / tests) : null;
  return { ...fit, stable, distinguishable, mean, halfLife, forecast, band, tests, rmseAR, rmseRW,
    supported: distinguishable && rmseAR !== null && rmseRW !== null && rmseAR < rmseRW };
}

export function change(points: SpreadPoint[], basis: SpreadBasis, days: number) {
  const last = points.at(-1);
  if (!last) return null;
  const previous = days === 1 ? points.at(-2) : points.filter(p => time(p.date) <= time(last.date) - days * DAY).at(-1);
  if (!previous) return null;
  const a = spreadValue(last, basis), b = spreadValue(previous, basis);
  return a === null || b === null ? null : a - b;
}

/** Componentes en % del monto, aproximación de primer orden, tasas anuales efectivas. */
export function scenario(input: { y: number; duration: number; months: number; rollBaseBp: number; rollSpreadBp: number; swapBp: number; spreadBp: number; ufPct: number; costsBp: number }) {
  const h = input.months / 12;
  const carry = (Math.pow(1 + input.y / 100, h) - 1) * 100;
  const rollBase = input.duration * input.rollBaseBp / 100, rollSpread = input.duration * input.rollSpreadBp / 100;
  const rates = -input.duration * input.swapBp / 100, convergence = -input.duration * input.spreadBp / 100;
  const local = carry + rollBase + rollSpread + rates + convergence;
  const uf = (1 + local / 100) * input.ufPct;
  return { carry, rollBase, rollSpread, rates, convergence, uf, costs: -input.costsBp / 100, total: local + uf - input.costsBp / 100 };
}

/**
 * Trayectoria de TPM implícita en los Swap Promedio Cámara (SPC).
 *
 * Los SPC de hasta 18 meses tienen un solo pago al vencimiento (Act/360). En ese tramo
 * el factor de descuento multiplica a ambas patas y se cancela, así que la tasa fija
 * entrega directamente el factor ICP esperado:  1 + r·τ = Π (1 + ICP_d / 360).
 * No se requiere doble curva (proyección CLP / descuento con colateral USD) en este tramo.
 *
 * Supuestos: el overnight (ICP) es constante entre reuniones y cambia el día hábil
 * siguiente a cada decisión; ICP = TPM + spread, con el spread estimado en períodos
 * sin cambios de TPM. Los tenores son menos que las reuniones, por lo que se resuelve
 * por mínimos cuadrados con una penalización pequeña a los saltos entre reuniones.
 */

export type SwapQuote = { months: number; rate: number };   // tasa en %
export type MeetingPath = {
  meeting: string; effective: string;
  expectedTpm: number; change: number; cumulativeChange: number;
};
export type TpmPathResult = {
  valuationDate: string; currentTpm: number; spreadBp: number;
  nextMeeting: MeetingPath | null;
  /** Probabilidad implícita de un movimiento de 25 pb en la próxima reunión (signo = dirección). */
  nextMeetingProbability: number | null;
  path: MeetingPath[];
  fit: { months: number; quoted: number; fitted: number; errorBp: number }[];
  horizonEnd: string;
};

const DAY = 86400000;
export const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
export const iso = (d: Date) => d.toISOString().slice(0, 10);
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
export function addBusinessDays(date: string, n: number) {
  const d = toDate(date);
  let left = n;
  while (left > 0) { d.setUTCDate(d.getUTCDate() + 1); if (!isWeekend(d)) left--; }
  return iso(d);
}
export function addMonths(date: string, months: number) {
  const d = toDate(date), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return iso(d);
}
const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);
/** Tasa diaria equivalente: y = 360·ln(1 + r/360); hace lineal la capitalización diaria. */
const toLog = (ratePct: number) => 360 * Math.log(1 + ratePct / 100 / 360);
const fromLog = (y: number) => 100 * 360 * (Math.exp(y / 360) - 1);

/** Resuelve (AᵀA + λDᵀD) x = Aᵀb por eliminación gaussiana. */
function solve(M: number[][], v: number[]) {
  const n = v.length, a = M.map((row, i) => [...row, v[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < n; r++) if (r !== c) {
      const f = a[r][c] / a[c][c];
      for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

export function impliedTpmPath(options: {
  valuationDate: string; quotes: SwapQuote[]; meetings: string[]; currentTpm: number; spreadBp: number;
  spotLag?: number; smoothing?: number;
}): TpmPathResult {
  const { valuationDate, currentTpm, spreadBp } = options;
  const quotes = options.quotes.filter(q => q.months > 0 && q.months <= 18 && Number.isFinite(q.rate)).sort((a, b) => a.months - b.months);
  if (quotes.length < 2) throw new Error("Se necesitan al menos dos tasas swap de hasta 18 meses.");
  const start = addBusinessDays(valuationDate, options.spotLag ?? 2);
  const ends = quotes.map(q => addMonths(start, q.months));
  const horizonEnd = ends[ends.length - 1];
  // Reuniones posteriores a la fecha de valorización cuyo efecto cae dentro del horizonte.
  const meetings = [...new Set(options.meetings)].sort()
    .filter(m => m >= valuationDate)
    .map(m => ({ meeting: m, effective: addBusinessDays(m, 1) }))
    .filter(m => m.effective < horizonEnd);
  // Segmentos: [start, ef1), [ef1, ef2), ... ; el primero tiene tasa conocida (TPM actual + spread).
  const bounds = [start, ...meetings.map(m => (m.effective < start ? start : m.effective)), horizonEnd];
  const known = toLog(currentTpm + spreadBp / 100);
  const K = meetings.length;
  const rows: number[][] = [], rhs: number[] = [];
  quotes.forEach((q, j) => {
    const end = ends[j], tau = daysBetween(start, end);
    const lhs = 360 * Math.log(1 + q.rate / 100 * tau / 360);   // Σ días·y / 360·360
    const coef = Array(K).fill(0);
    let fixed = 0;
    for (let s = 0; s <= K; s++) {
      const a = bounds[s], b = bounds[s + 1] < end ? bounds[s + 1] : end;
      const days = a < b ? daysBetween(a, b) : 0;
      if (s === 0) fixed += days * known; else coef[s - 1] += days;
    }
    // Escala por τ: el residuo queda en unidades de tasa promedio.
    rows.push(coef.map(c => c / tau)); rhs.push((lhs - fixed) / tau);
  });
  const lambda = options.smoothing ?? 0.02;
  // Normal equations con penalización a primeras diferencias (y_0 conocido).
  const N = Array.from({ length: K }, () => Array(K).fill(0)), v = Array(K).fill(0);
  rows.forEach((r, j) => { for (let a = 0; a < K; a++) { v[a] += r[a] * rhs[j]; for (let b = 0; b < K; b++) N[a][b] += r[a] * r[b]; } });
  for (let k = 0; k < K; k++) {
    N[k][k] += lambda * (k === K - 1 ? 1 : 2);
    if (k > 0) { N[k][k - 1] -= lambda; N[k - 1][k] -= lambda; }
  }
  v[0] += lambda * known;
  const y = K ? solve(N, v) : [];
  let previous = currentTpm;
  const path = meetings.map((m, k) => {
    const expectedTpm = fromLog(y[k]) - spreadBp / 100;
    const out = { ...m, expectedTpm, change: expectedTpm - previous, cumulativeChange: expectedTpm - currentTpm };
    previous = expectedTpm;
    return out;
  });
  const fit = quotes.map((q, j) => {
    // Reconstruye la tasa swap a partir de la trayectoria ajustada.
    const end = ends[j], tau = daysBetween(start, end);
    let logF = 0;
    for (let s = 0; s <= K; s++) {
      const a = bounds[s], b = bounds[s + 1] < end ? bounds[s + 1] : end;
      if (a < b) logF += daysBetween(a, b) * (s === 0 ? known : y[s - 1]) / 360;
    }
    const fitted = 100 * (Math.exp(logF) - 1) * 360 / tau;
    return { months: q.months, quoted: q.rate, fitted, errorBp: (fitted - q.rate) * 100 };
  });
  const nextMeeting = path[0] ?? null;
  return {
    valuationDate, currentTpm, spreadBp, path, fit, horizonEnd, nextMeeting,
    nextMeetingProbability: nextMeeting ? nextMeeting.change / 0.25 : null,
  };
}

/** Tasa overnight implícita promedio (simple, %) entre dos plazos a partir de swaps cero cupón. */
export function forwardAverage(r1: number, d1: number, r2: number, d2: number) {
  const f1 = 1 + r1 / 100 * d1 / 360, f2 = 1 + r2 / 100 * d2 / 360;
  return 100 * (f2 / f1 - 1) * 360 / (d2 - d1);
}

/**
 * Spread ICP − TPM (pb): tasa overnight implícita en el swap 1m, en días en que la TPM
 * no cambió durante los 45 días siguientes. Mediana, robusta a días atípicos.
 */
export function estimateSpreadBp(swap1m: Map<string, number>, tpmOn: (date: string) => number | null) {
  const values: number[] = [];
  for (const [date, rate] of swap1m) {
    const now = tpmOn(date), later = tpmOn(iso(new Date(toDate(date).getTime() + 45 * DAY)));
    if (now === null || later === null || Math.abs(now - later) > 1e-9) continue;
    const days = daysBetween(addBusinessDays(date, 2), addMonths(addBusinessDays(date, 2), 1));
    const overnight = fromLog(360 * Math.log(1 + rate / 100 * days / 360) / days);
    values.push((overnight - now) * 100);
  }
  if (values.length < 20) return { spreadBp: 0, observations: values.length };
  values.sort((a, b) => a - b);
  return { spreadBp: values[Math.floor(values.length / 2)], observations: values.length };
}

export type ForwardHistoryPoint = { date: string; implied: number; realized: number | null };
export type ForwardHistory = {
  window: string; points: ForwardHistoryPoint[];
  biasBp: number | null; maeBp: number | null; observations: number;
};

/**
 * Historia de lo que descontaban los swaps para la TPM promedio de una ventana futura
 * (p. ej. entre 6 y 12 meses) versus la TPM promedio que efectivamente rigió.
 * El sesgo medio aproxima la prima por plazo; el error absoluto medio, la precisión.
 */
export function forwardHistory(options: {
  label: string; near: Map<string, number> | null; nearMonths: number; far: Map<string, number>; farMonths: number;
  tpmOn: (date: string) => number | null; lastTpmDate: string; spreadBp: number; step?: number;
}): ForwardHistory {
  const { near, far, nearMonths, farMonths, tpmOn, lastTpmDate, spreadBp } = options;
  const dates = [...far.keys()].filter(d => !near || near.has(d)).sort();
  const points: ForwardHistoryPoint[] = [];
  const step = options.step ?? 5;
  for (let i = 0; i < dates.length; i += step) {
    const date = dates[i];
    const start = addBusinessDays(date, 2);
    const d1 = nearMonths ? daysBetween(start, addMonths(start, nearMonths)) : 0;
    const d2 = daysBetween(start, addMonths(start, farMonths));
    const r2 = far.get(date)!;
    const forward = near ? forwardAverage(near.get(date)!, d1, r2, d2) : forwardAverage(0, 0, r2, d2);
    // Promedio compuesto: tasa simple equivalente → overnight promedio → menos spread.
    const days = d2 - d1;
    const implied = fromLog(360 * Math.log(1 + forward / 100 * days / 360) / days) - spreadBp / 100;
    const from = addMonths(start, nearMonths), to = addMonths(start, farMonths);
    let realized: number | null = null;
    if (to <= lastTpmDate) {
      let sum = 0, n = 0;
      for (let t = toDate(from).getTime(); t < toDate(to).getTime(); t += DAY) {
        const v = tpmOn(iso(new Date(t))); if (v !== null) { sum += v; n++; }
      }
      realized = n ? sum / n : null;
    }
    points.push({ date, implied, realized });
  }
  const done = points.filter(p => p.realized !== null);
  const errors = done.map(p => (p.implied - p.realized!) * 100);
  return {
    window: options.label, points, observations: done.length,
    biasBp: errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null,
    maeBp: errors.length ? errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length : null,
  };
}

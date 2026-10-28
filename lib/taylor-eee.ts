/**
 * Regla de Taylor forward-looking con la Encuesta de Expectativas Económicas (EEE) del Banco Central:
 *   i_t = TPM neutral + (1 + a)·(E_t[π] − meta) + b·brecha_t
 * donde E_t[π] es la inflación esperada en la EEE a 24 meses (horizonte de política) o a 12 meses.
 *
 * A diferencia de la versión de mercado, la expectativa viene de una encuesta: no trae primas por riesgo
 * inflacionario ni de liquidez y tiene historia mensual desde 2015, así que la historia de la regla es
 * comparable en todo el período.
 *
 * Proyección a 12 meses: la expectativa se mantiene en el último dato de la encuesta, la brecha se cierra
 * según su persistencia histórica (AR(1) mensual) y la trayectoria con inercia parte de la TPM actual.
 * El punto a 12 meses se compara con la TPM esperada en la EEE a 12 meses y con la TPM implícita en swaps.
 */
import type { TaylorParameters } from "./taylor";
import type { MonthValue } from "./taylor-forward";

// Misma fórmula que taylorRate de lib/taylor.ts (copiada para que el módulo se pruebe sin bundler).
const taylorRate = (inflation: number, gap: number, p: TaylorParameters) =>
  p.neutralNominal + (1 + p.inflationWeight) * (inflation - p.inflationTarget) + p.activityWeight * gap;

export type EeeHorizon = "24m" | "12m";
export type EeeRow = { month: string; inf12: number | null; inf24: number | null; tpm12: number | null; pib: number | null };
export type TaylorEeeInput = {
  rows: EeeRow[];              // encuesta mensual (fecha = mes de la encuesta)
  pibLabel: string;            // año al que corresponde la serie de PIB esperado
  tpmMonthly: MonthValue[];    // TPM de cierre de mes
  currentTpm: number;
  currentTpmDate: string;
  market: MonthValue[];        // TPM implícita en swaps al cierre de cada mes futuro (puede venir vacía)
  marketSource: string | null;
};
export type EeeHistoryPoint = { date: string; expected: number; gap: number; taylor: number; tpm: number; eeeTpm12: number | null };
export type EeeProjectionPoint = { date: string; taylor: number; inertial: number; gap: number; market: number | null };
export type TaylorEeeResult = {
  survey: EeeRow & { expected: number };
  history: EeeHistoryPoint[];
  projection: EeeProjectionPoint[];
  today: { taylor: number; gap: number };
  in12: { date: string; inertial: number; taylor: number; eee: number | null; market: number | null };
  lastGap: { month: string; value: number };
  gapPersistence: number;
  meanAbsGap: number | null;   // |TPM − regla| promedio en la historia, pb
};

const shift = (month: string, n: number) => {
  const d = new Date(`${month}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const monthsBetween = (a: string, b: string) => {
  const x = new Date(`${a}T00:00:00Z`), y = new Date(`${b}T00:00:00Z`);
  return (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + y.getUTCMonth() - x.getUTCMonth();
};
/** AR(1) mensual sin constante de la brecha (misma función que lib/taylor-forward.ts, copiada para probar sin bundler). */
function gapPersistence(gaps: Record<string, number>, window = 120) {
  const keys = Object.keys(gaps).sort().slice(-window);
  let num = 0, den = 0;
  for (let i = 1; i < keys.length; i++) {
    if (monthsBetween(keys[i - 1], keys[i]) !== 1) continue;
    num += gaps[keys[i]] * gaps[keys[i - 1]]; den += gaps[keys[i - 1]] ** 2;
  }
  const phi = den > 0 ? num / den : 0.9;
  return Math.min(Math.max(phi, 0), 0.99);
}
const pick = (r: EeeRow, h: EeeHorizon) => (h === "24m" ? r.inf24 : r.inf12);

export function taylorEee(input: TaylorEeeInput, gaps: Record<string, number>, p: TaylorParameters, horizon: EeeHorizon = "24m"): TaylorEeeResult {
  const gapKeys = Object.keys(gaps).sort();
  if (!gapKeys.length) throw new Error("No hay brecha de actividad disponible.");
  const rows = input.rows.filter(r => typeof pick(r, horizon) === "number").sort((a, b) => a.month.localeCompare(b.month));
  if (!rows.length) throw new Error(`No hay datos de inflación esperada EEE a ${horizon === "24m" ? "24" : "12"} meses.`);
  const lastGapMonth = gapKeys[gapKeys.length - 1], lastGap = gaps[lastGapMonth];
  const phi = gapPersistence(gaps);
  const gapAt = (m: string) => gaps[m] ?? lastGap * Math.pow(phi, Math.max(monthsBetween(lastGapMonth, m), 0));

  const tpm = new Map(input.tpmMonthly.map(r => [r.month, r.value]));
  const history: EeeHistoryPoint[] = rows.flatMap(r => {
    const g = gaps[r.month], t = tpm.get(r.month), e = pick(r, horizon) as number;
    return typeof g === "number" && typeof t === "number" ? [{ date: r.month, expected: e, gap: g, taylor: taylorRate(e, g, p), tpm: t, eeeTpm12: r.tpm12 }] : [];
  });
  const meanAbsGap = history.length ? 100 * history.reduce((s, h) => s + Math.abs(h.tpm - h.taylor), 0) / history.length : null;

  const last = rows[rows.length - 1], expected = pick(last, horizon) as number;
  const start = `${input.currentTpmDate.slice(0, 7)}-01` > last.month ? `${input.currentTpmDate.slice(0, 7)}-01` : last.month;
  const market = new Map(input.market.map(r => [r.month, r.value]));
  const projection: EeeProjectionPoint[] = [];
  let inertial = input.currentTpm;
  for (let h = 0; h <= 12; h++) {
    const m = shift(start, h), gap = gapAt(m), taylor = taylorRate(expected, gap, p);
    if (h > 0) inertial = p.smoothing * inertial + (1 - p.smoothing) * taylor;
    projection.push({ date: m, taylor, inertial, gap, market: market.get(m) ?? null });
  }
  const end = projection[projection.length - 1];
  return {
    survey: { ...last, expected }, history, projection,
    today: { taylor: projection[0].taylor, gap: projection[0].gap },
    in12: { date: end.date, inertial: end.inertial, taylor: end.taylor, eee: last.tpm12, market: end.market },
    lastGap: { month: lastGapMonth, value: lastGap }, gapPersistence: phi, meanAbsGap,
  };
}

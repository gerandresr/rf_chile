/**
 * Regla de Taylor forward-looking:
 *   i_t = TPM neutral + (1 + a)·(E_t[π a 12 meses] − meta) + b·E_t[brecha]
 *
 * Proyección (desde hoy): la inflación esperada de cada mes futuro sale de los forwards de IPC mensual
 * de ICAP (variación compuesta de los 12 meses siguientes). La brecha de actividad se cierra según su
 * persistencia histórica (AR(1) mensual sin constante: tiende a cero, es decir, el desempleo a la NAIRU).
 * La trayectoria con inercia parte de la TPM actual: i_h = ρ·i_(h−1) + (1 − ρ)·Taylor_h.
 * Se compara con la TPM implícita en los swaps Cámara.
 *
 * Historia (provisoria, mientras no haya serie de expectativas de encuesta): la inflación esperada es el
 * breakeven swap Cámara a 1 año, CLP vs. UF (promedio mensual). Incluye primas por riesgo inflacionario
 * y liquidez, por lo que es más ruidoso que una encuesta.
 */
import type { TaylorParameters } from "./taylor";

// Misma fórmula que taylorRate de lib/taylor.ts (copiada para que el módulo se pruebe sin bundler).
const taylorRate = (inflation: number, gap: number, p: TaylorParameters) =>
  p.neutralNominal + (1 + p.inflationWeight) * (inflation - p.inflationTarget) + p.activityWeight * gap;

export type MonthValue = { month: string; value: number };
export type TaylorForwardInput = {
  asOf: string;                 // fecha de los datos de mercado (AAAA-MM-DD)
  icapDate: string;
  expected12m: MonthValue[];    // inflación esperada 12 meses adelante desde cada mes (ICAP), %
  expectedHistory: MonthValue[]; // expectativa histórica de inflación 12 meses (proxy de mercado), %
  expectedHistorySource: string;
  tpmMonthly: MonthValue[];     // TPM de cierre de mes
  market: MonthValue[];         // TPM implícita en swaps al cierre de cada mes futuro
  marketSource: string;
  currentTpm: number;
  lastIpcYoy: { month: string; value: number } | null;
};
export type ForwardHistoryPoint = { date: string; expected: number; gap: number; taylor: number; tpm: number };
export type ForwardProjectionPoint = { date: string; expected: number; gap: number; taylor: number; inertial: number; market: number | null };
export type TaylorForwardResult = {
  history: ForwardHistoryPoint[];
  projection: ForwardProjectionPoint[];
  gapPersistence: number; gapHalfLifeMonths: number | null; lastGap: { month: string; value: number };
  backwardToday: number | null;
};

const shift = (month: string, n: number) => {
  const d = new Date(`${month}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const monthsBetween = (a: string, b: string) => {
  const x = new Date(`${a}T00:00:00Z`), y = new Date(`${b}T00:00:00Z`);
  return (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + y.getUTCMonth() - x.getUTCMonth();
};
export const monthOf = (date: string) => `${date.slice(0, 7)}-01`;

/** Variación compuesta de los 12 meses siguientes a cada mes, con IPC mensual observado o esperado (%). */
export function expectedInflation12m(ipcMom: Map<string, number>, from: string) {
  const out: MonthValue[] = [];
  for (let m = from; ; m = shift(m, 1)) {
    let f = 1;
    for (let k = 1; k <= 12; k++) {
      const v = ipcMom.get(shift(m, k));
      if (typeof v !== "number") return out;
      f *= 1 + v / 100;
    }
    out.push({ month: m, value: 100 * (f - 1) });
  }
}

/** AR(1) mensual sin constante sobre los últimos `window` meses de la brecha. */
export function gapPersistence(gaps: Record<string, number>, window = 120) {
  const keys = Object.keys(gaps).sort().slice(-window);
  let num = 0, den = 0;
  for (let i = 1; i < keys.length; i++) {
    if (monthsBetween(keys[i - 1], keys[i]) !== 1) continue;
    num += gaps[keys[i]] * gaps[keys[i - 1]]; den += gaps[keys[i - 1]] ** 2;
  }
  const phi = den > 0 ? num / den : 0.9;
  return Math.min(Math.max(phi, 0), 0.99);
}

export function forwardTaylor(input: TaylorForwardInput, gaps: Record<string, number>, p: TaylorParameters, horizonMonths = 18): TaylorForwardResult {
  const gapKeys = Object.keys(gaps).sort();
  if (!gapKeys.length) throw new Error("No hay brecha de actividad disponible.");
  if (!input.expected12m.length) throw new Error("No hay forwards de inflación para proyectar.");
  const lastGapMonth = gapKeys[gapKeys.length - 1], lastGap = gaps[lastGapMonth];
  const phi = gapPersistence(gaps);

  // Historia: expectativa de mercado (proxy), brecha y TPM del mismo mes.
  const tpm = new Map(input.tpmMonthly.map(r => [r.month, r.value]));
  const history: ForwardHistoryPoint[] = input.expectedHistory.flatMap(r => {
    const g = gaps[r.month], t = tpm.get(r.month);
    return typeof g === "number" && typeof t === "number" ? [{ date: r.month, expected: r.value, gap: g, taylor: taylorRate(r.value, g, p), tpm: t }] : [];
  });

  // Proyección: desde el mes de los datos de mercado.
  const start = monthOf(input.asOf);
  const expected = new Map(input.expected12m.map(r => [r.month, r.value]));
  const market = new Map(input.market.map(r => [r.month, r.value]));
  const projection: ForwardProjectionPoint[] = [];
  let inertial = input.currentTpm;
  for (let h = 0; h <= horizonMonths; h++) {
    const m = shift(start, h), e = expected.get(m);
    if (typeof e !== "number") break;
    const gap = lastGap * Math.pow(phi, Math.max(monthsBetween(lastGapMonth, m), 0));
    const taylor = taylorRate(e, gap, p);
    if (h > 0) inertial = p.smoothing * inertial + (1 - p.smoothing) * taylor;
    projection.push({ date: m, expected: e, gap, taylor, inertial: h === 0 ? input.currentTpm : inertial, market: market.get(m) ?? null });
  }

  const gapNow = lastGap * Math.pow(phi, Math.max(monthsBetween(lastGapMonth, start), 0));
  return {
    history, projection, gapPersistence: phi,
    gapHalfLifeMonths: phi > 0 && phi < 1 ? Math.log(0.5) / Math.log(phi) : null,
    lastGap: { month: lastGapMonth, value: lastGap },
    backwardToday: input.lastIpcYoy ? taylorRate(input.lastIpcYoy.value, gapNow, p) : null,
  };
}

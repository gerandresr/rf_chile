import type { DailyMacroRow } from "./macro";

/**
 * Regla de Taylor (1993) para Chile:
 *   i_t = r* + π_t + a·(π_t − π*) + b·brecha_t
 * con r* = TPM neutral nominal − meta. La brecha de actividad viene del modelo de
 * tasa natural (filtro de Kalman con ley de Okun), en vez de un filtro HP: el HP
 * tiene sesgo en el último dato y la caída de 2020 hunde su tendencia, lo que
 * fabricaba brechas positivas de +2% en 2018–2019.
 *
 * También entrega la regla con inercia, que describe cómo ajusta un banco central
 * gradualista: i_t = ρ·TPM_(t−1) + (1 − ρ)·Taylor_t.
 */
export type TaylorMonthlyRow = { fecha: string; ipc_yoy: number | null };
export type TaylorParameters = { neutralNominal: number; inflationTarget: number; inflationWeight: number; activityWeight: number; smoothing: number };
// TPM neutral: punto medio del rango 3,75%–4,75% del IPoM de diciembre de 2025.
export const DEFAULT_TAYLOR_PARAMETERS: TaylorParameters = { neutralNominal: 4.25, inflationTarget: 3, inflationWeight: 0.5, activityWeight: 0.5, smoothing: 0.85 };
export const NEUTRAL_RANGE_HALF_WIDTH = 0.5;

export type TaylorPoint = {
  date: string; inflation: number; gap: number;
  taylor: number; taylorLow: number; taylorHigh: number;
  inertial: number | null;
  tpm: number; tpmDate: string; difference: number;
};

function validDate(date: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const previousMonth = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
};

export function taylorRate(inflation: number, gap: number, p: TaylorParameters) {
  return p.neutralNominal + (1 + p.inflationWeight) * (inflation - p.inflationTarget) + p.activityWeight * gap;
}

/** `gaps`: brecha de actividad (%) por mes (fecha AAAA-MM-01). */
export function estimateTaylor(monthly: TaylorMonthlyRow[], daily: DailyMacroRow[], gaps: Record<string, number>, parameters = DEFAULT_TAYLOR_PARAMETERS) {
  if (Object.values(parameters).some(value => !finite(value))) throw new Error("Revisa los parámetros de la regla de Taylor.");
  if (parameters.smoothing < 0 || parameters.smoothing >= 1) throw new Error("La inercia debe estar entre 0 y 0,99.");
  // TPM: último dato válido de cada mes (cierre mensual).
  const tpmByMonth = new Map<string, DailyMacroRow>();
  for (const row of daily) {
    if (!validDate(row.fecha) || !finite(row.tpm)) continue;
    const key = row.fecha.slice(0, 7), previous = tpmByMonth.get(key);
    if (!previous || row.fecha > previous.fecha) tpmByMonth.set(key, row);
  }
  const inflation = new Map(monthly.filter(r => validDate(r.fecha) && r.fecha.endsWith("-01") && finite(r.ipc_yoy)).map(r => [r.fecha, r.ipc_yoy!]));
  const low = { ...parameters, neutralNominal: parameters.neutralNominal - NEUTRAL_RANGE_HALF_WIDTH };
  const high = { ...parameters, neutralNominal: parameters.neutralNominal + NEUTRAL_RANGE_HALF_WIDTH };
  const points: TaylorPoint[] = Object.keys(gaps).filter(validDate).sort().flatMap(date => {
    const pi = inflation.get(date), gap = gaps[date], tpm = tpmByMonth.get(date.slice(0, 7));
    if (!finite(pi) || !finite(gap) || !tpm) return [];
    const taylor = taylorRate(pi, gap, parameters);
    const lagged = tpmByMonth.get(previousMonth(date).slice(0, 7));
    return [{
      date, inflation: pi, gap, taylor,
      taylorLow: taylorRate(pi, gap, low), taylorHigh: taylorRate(pi, gap, high),
      inertial: lagged ? parameters.smoothing * lagged.tpm! + (1 - parameters.smoothing) * taylor : null,
      tpm: tpm.tpm!, tpmDate: tpm.fecha, difference: taylor - tpm.tpm!,
    }];
  });
  if (!points.length) throw new Error("No hay meses con inflación, brecha de actividad y TPM disponibles simultáneamente.");
  return { points };
}

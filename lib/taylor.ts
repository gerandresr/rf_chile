import type { DailyMacroRow } from "./macro";

export type TaylorMonthlyRow = { fecha: string; imacec_ind_des?: number | null; ipc_yoy: number | null };
export type TaylorParameters = { neutralReal: number; inflationTarget: number; inflationWeight: number; activityWeight: number };
export const DEFAULT_TAYLOR_PARAMETERS: TaylorParameters = { neutralReal: 1.25, inflationTarget: 3, inflationWeight: 0.5, activityWeight: 0.5 };
export const HP_MONTHLY_LAMBDA = 129600;

function validDate(date: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));

// Solve (I + lambda D'D) trend = log(index), where D is the second-difference matrix.
export function hpTrend(values: number[], lambda = HP_MONTHLY_LAMBDA): number[] {
  if (values.length < 3 || values.some(value => !finite(value)) || !finite(lambda) || lambda < 0) throw new Error("Serie o parámetro HP inválido.");
  const n = values.length;
  const matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 1 : 0));
  const weights = [1, -2, 1];
  for (let k = 0; k < n - 2; k++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) matrix[k + i][k + j] += lambda * weights[i] * weights[j];
  const lower = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let sum = matrix[i][j];
    for (let k = 0; k < j; k++) sum -= lower[i][k] * lower[j][k];
    lower[i][j] = i === j ? Math.sqrt(sum) : sum / lower[j][j];
  }
  const intermediate = Array<number>(n).fill(0), trend = Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = values[i];
    for (let j = 0; j < i; j++) sum -= lower[i][j] * intermediate[j];
    intermediate[i] = sum / lower[i][i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let sum = intermediate[i];
    for (let j = i + 1; j < n; j++) sum -= lower[j][i] * trend[j];
    trend[i] = sum / lower[i][i];
  }
  return trend;
}

export function estimateTaylor(monthly: TaylorMonthlyRow[], daily: DailyMacroRow[], parameters = DEFAULT_TAYLOR_PARAMETERS) {
  if (Object.values(parameters).some(value => !finite(value))) throw new Error("Revisa los parámetros de la regla de Taylor.");
  // Deduplicate dates, sort chronologically and retain the latest uninterrupted activity history.
  const activity = [...new Map(monthly.filter(row => validDate(row.fecha) && row.fecha.endsWith("-01") && finite(row.imacec_ind_des) && row.imacec_ind_des > 0).map(row => [row.fecha, row])).values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
  let start = 0;
  for (let i = 1; i < activity.length; i++) if (monthIndex(activity[i].fecha) !== monthIndex(activity[i - 1].fecha) + 1) start = i;
  const rows = activity.slice(start);
  if (rows.length < 36) throw new Error("Se necesitan al menos 36 meses consecutivos de IMACEC desestacionalizado positivo.");
  const logs = rows.map(row => Math.log(row.imacec_ind_des!));
  const trend = hpTrend(logs);
  const tpmByMonth = new Map<string, DailyMacroRow>();
  for (const row of daily) {
    if (!validDate(row.fecha) || !finite(row.tpm)) continue;
    const key = row.fecha.slice(0, 7), previous = tpmByMonth.get(key);
    if (!previous || row.fecha > previous.fecha) tpmByMonth.set(key, row);
  }
  const points = rows.flatMap((row, i) => {
    if (!finite(row.ipc_yoy)) return [];
    const tpm = tpmByMonth.get(row.fecha.slice(0, 7));
    if (!tpm) return [];
    const gap = 100 * (logs[i] - trend[i]);
    const inflationGap = row.ipc_yoy - parameters.inflationTarget;
    const taylor = parameters.neutralReal + row.ipc_yoy + parameters.inflationWeight * inflationGap + parameters.activityWeight * gap;
    return [{ date: row.fecha, inflation: row.ipc_yoy, activity: row.imacec_ind_des!, potential: Math.exp(trend[i]), gap, taylor, tpm: tpm.tpm!, tpmDate: tpm.fecha, difference: taylor - tpm.tpm! }];
  });
  if (!points.length) throw new Error("No hay meses con inflación, IMACEC y TPM disponibles simultáneamente.");
  return { points, activityMonths: rows.length, startDate: rows[0].fecha, endDate: rows[rows.length - 1].fecha };
}

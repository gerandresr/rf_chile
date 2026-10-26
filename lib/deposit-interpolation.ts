/**
 * Interpolador de depósitos a plazo (RiskAmerica): DPF en pesos (tasa base 30 días) y DPR en UF (tasa real anual).
 * Curva = último día con todos los plazos disponibles; interpolación lineal por días. Fuera del rango
 * cotizado se toma la tasa del plazo extremo más cercano (mismo criterio que Spread Bonos).
 */
export type DepositKind = "DPF" | "DPR";
export type DepositPoint = { days: number; rate: number };
export type DepositCurve = { date: string; points: DepositPoint[] };

export const DEPOSIT_TENORS: Record<DepositKind, number[]> = { DPF: [7, 30, 90, 180, 270, 360], DPR: [90, 180, 360] };

/** `series`: por plazo, fechas y tasas tal como vienen en historico_riskamerica/<KIND>_<días>.json. */
export function latestDepositCurve(series: Record<number, { fecha: string[]; tir: (number | null)[] }>): DepositCurve | null {
  const maps = Object.entries(series).map(([days, s]) => ({
    days: Number(days),
    values: new Map(s.fecha.map((f, i) => [f, s.tir[i]] as const).filter((e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1]))),
  }));
  if (!maps.length) return null;
  const dates = [...maps[0].values.keys()].filter(d => maps.every(m => m.values.has(d))).sort();
  const date = dates[dates.length - 1];
  if (!date) return null;
  return { date, points: maps.map(m => ({ days: m.days, rate: m.values.get(date)! })).sort((a, b) => a.days - b.days) };
}

export function interpolateDeposit(days: number | null, points: DepositPoint[]) {
  if (days === null || !Number.isFinite(days) || days <= 0 || !points.length) return null;
  const first = points[0], last = points[points.length - 1];
  if (days <= first.days) return { rate: first.rate, left: first, right: first, extrapolated: days < first.days };
  if (days >= last.days) return { rate: last.rate, left: last, right: last, extrapolated: days > last.days };
  for (let i = 1; i < points.length; i++) {
    const left = points[i - 1], right = points[i];
    if (days <= right.days) {
      const w = (days - left.days) / (right.days - left.days);
      return { rate: left.rate + w * (right.rate - left.rate), left, right, extrapolated: false };
    }
  }
  return null;
}

/** DPF: tasa base 30 días → tasa anual simple base 360 (×12). */
export const dpfAnnual = (monthlyPct: number) => monthlyPct * 12;

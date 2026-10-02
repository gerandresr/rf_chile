export type MonthlyExchangeRate = { fecha: string; tc_real?: number | null };
export type DailyExchangeRate = { fecha: string; usdclp_obs?: number | null };
export type ExchangeRatePoint = { fecha: string; tc_real: number | null; usdclp: number | null; dollarObservations: number; dollarDate: string | null; reference: number | null; gap: number | null; positive: number | null; negative: number | null; cumulativeReference: number | null; cumulativeGap: number | null; hpReference: number | null; hpGap: number | null };
const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
function validDate(date: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

export function exchangeRateSeries(monthly: MonthlyExchangeRate[], daily: DailyExchangeRate[]): ExchangeRatePoint[] {
  const real = new Map<string, number>();
  for (const row of monthly) if (validDate(row.fecha) && row.fecha.endsWith("-01") && positive(row.tc_real)) real.set(row.fecha, row.tc_real);
  const dollars = new Map<string, { date: string; value: number; count: number }>();
  // Count each date once; missing days are not filled or counted as zero.
  const unique = new Map(daily.filter(r => validDate(r.fecha)).map(r => [r.fecha, r]));
  for (const row of unique.values()) {
    if (!positive(row.usdclp_obs)) continue;
    const month = `${row.fecha.slice(0, 7)}-01`;
    const previous = dollars.get(month);
    const count = (previous?.count ?? 0) + 1;
    if (!previous || row.fecha > previous.date) dollars.set(month, { date: row.fecha, value: row.usdclp_obs, count });
    else previous.count = count;
  }
  const dates = [...new Set([...real.keys(), ...dollars.keys()])].sort();
  const realByIndex = new Map([...real].map(([date, value]) => [monthIndex(date), value]));
  const sortedReal = [...real].sort(([a], [b]) => a.localeCompare(b));
  const hpReferences = new Map<string, number>();
  // Fit each uninterrupted monthly segment independently; never compress gaps.
  let start = 0;
  for (let end = 1; end <= sortedReal.length; end++) {
    if (end < sortedReal.length && monthIndex(sortedReal[end][0]) === monthIndex(sortedReal[end - 1][0]) + 1) continue;
    const segment = sortedReal.slice(start, end);
    if (segment.length >= 36) {
      const trend = hpTrend(segment.map(([, value]) => Math.log(value)), HP_MONTHLY_LAMBDA);
      segment.forEach(([date], i) => hpReferences.set(date, Math.exp(trend[i])));
    }
    start = end;
  }
  let accumulatedSum = 0, accumulatedCount = 0;
  return dates.map(fecha => {
    const tc_real = real.get(fecha) ?? null;
    const dollar = dollars.get(fecha);
    const previous = Array.from({ length: 36 }, (_, i) => realByIndex.get(monthIndex(fecha) - i - 1));
    const reference = previous.every(positive) ? (previous as number[]).reduce((a, b) => a + b, 0) / 36 : null;
    const gap = tc_real !== null && reference !== null ? (tc_real / reference - 1) * 100 : null;
    const cumulativeReference = accumulatedCount >= 36 ? accumulatedSum / accumulatedCount : null;
    const cumulativeGap = tc_real !== null && cumulativeReference !== null ? (tc_real / cumulativeReference - 1) * 100 : null;
    const hpReference = hpReferences.get(fecha) ?? null;
    const hpGap = tc_real !== null && hpReference !== null ? (tc_real / hpReference - 1) * 100 : null;
    if (tc_real !== null) { accumulatedSum += tc_real; accumulatedCount++; }
    return { fecha, tc_real, usdclp: dollar?.value ?? null,
      dollarObservations: dollar?.count ?? 0, dollarDate: dollar?.date ?? null, reference, gap, positive: gap === null ? null : Math.max(0, gap), negative: gap === null ? null : Math.min(0, gap), cumulativeReference, cumulativeGap, hpReference, hpGap };
  });
}
import { hpTrend, HP_MONTHLY_LAMBDA } from "./taylor";

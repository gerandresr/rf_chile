export type MonthlyExchangeRate = { fecha: string; tc_real?: number | null };
export type DailyExchangeRate = { fecha: string; usdclp_obs?: number | null };
export type ExchangeRatePoint = { fecha: string; tc_real: number | null; usdclp: number | null; dollarObservations: number; reference: number | null; gap: number | null; positive: number | null; negative: number | null };
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
  const dollars = new Map<string, number[]>();
  // Count each date once; missing days are not filled or counted as zero.
  const unique = new Map(daily.filter(r => validDate(r.fecha)).map(r => [r.fecha, r]));
  for (const row of unique.values()) {
    if (!positive(row.usdclp_obs)) continue;
    const month = `${row.fecha.slice(0, 7)}-01`;
    if (!dollars.has(month)) dollars.set(month, []);
    dollars.get(month)!.push(row.usdclp_obs);
  }
  const dates = [...new Set([...real.keys(), ...dollars.keys()])].sort();
  const realByIndex = new Map([...real].map(([date, value]) => [monthIndex(date), value]));
  return dates.map(fecha => {
    const tc_real = real.get(fecha) ?? null;
    const observations = dollars.get(fecha) ?? [];
    const previous = Array.from({ length: 120 }, (_, i) => realByIndex.get(monthIndex(fecha) - i - 1));
    const reference = previous.every(positive) ? (previous as number[]).reduce((a, b) => a + b, 0) / 120 : null;
    const gap = tc_real !== null && reference !== null ? (tc_real / reference - 1) * 100 : null;
    return { fecha, tc_real, usdclp: observations.length ? observations.reduce((a, b) => a + b, 0) / observations.length : null,
      dollarObservations: observations.length, reference, gap, positive: gap === null ? null : Math.max(0, gap), negative: gap === null ? null : Math.min(0, gap) };
  });
}

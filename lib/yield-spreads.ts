import type { Instrument } from "./rf";

export function spreadPair(primary: Instrument, comparison: Instrument) {
  let left = primary, right = comparison;
  if (primary.type !== comparison.type) {
    if (primary.type === "BTU") [left, right] = [comparison, primary];
  } else if (primary.maturityYear * 12 + primary.maturityMonth < comparison.maturityYear * 12 + comparison.maturityMonth) {
    [left, right] = [comparison, primary];
  }
  return { left: left.code, right: right.code, label: `${left.code} − ${right.code}` };
}
export function yieldSpread(rows: { date: string; [key: string]: string | number | null }[], left: string, right: string) {
  const points = rows.map(row => {
    const a = row[left], b = row[right];
    return { date: row.date, spread: typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b) ? (a - b) * 100 : null };
  });
  const valid = points.filter((p): p is { date: string; spread: number } => p.spread !== null);
  const average = valid.length ? valid.reduce((sum, p) => sum + p.spread, 0) / valid.length : null;
  return { points, average };
}

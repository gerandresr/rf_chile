import type { CatalogSeries } from "./data-catalog.server";

/** Lee una serie de un archivo de datos ya descargado, para un campo dado. Fechas AAAA-MM-DD. */
export function extractSeries(json: unknown, s: Pick<CatalogSeries, "format" | "key">, field: string): Map<string, number> {
  const out = new Map<string, number>();
  if (s.format === "rows") {
    for (const row of json as Record<string, unknown>[]) if (typeof row[field] === "number") out.set(row.fecha as string, row[field] as number);
    return out;
  }
  const obj = (json as Record<string, Record<string, unknown[]>>)[s.key];
  const dates = obj?.fecha as string[] | undefined, values = obj?.[field];
  if (!dates || !values) return out;
  dates.forEach((d, i) => { const v = values[i]; if (typeof v === "number" && Number.isFinite(v)) out.set(d, v); });
  return out;
}

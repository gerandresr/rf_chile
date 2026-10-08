export const BENCHMARK_CODES = [
  "PESOS-02", "PESOS-05", "PESOS-10",
  "UF-02", "UF-05", "UF-10",
] as const;

export type BenchmarkEstimateMode = "maturity" | "duration";
export type BenchmarkEstimate = {
  fecha: string;
  hora: string;
  modo: BenchmarkEstimateMode;
  benchmark: Partial<Record<(typeof BENCHMARK_CODES)[number], number>>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** Fecha civil en Chile, independiente de la zona horaria del navegador. */
export function chileToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (name: string) => parts.find(part => part.type === name)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Solo muestra estimaciones del día de Chile y posteriores al cierre oficial
 * cargado. Separa las estimaciones por vencimiento y por duración.
 */
export function latestBenchmarkEstimate(
  input: unknown,
  mode: BenchmarkEstimateMode,
  officialDate: string,
  today: string,
): BenchmarkEstimate | null {
  if (!isObject(input) || input.fecha !== today || officialDate >= today || !Array.isArray(input.actualizaciones)) {
    return null;
  }

  let latest: BenchmarkEstimate | null = null;
  for (const item of input.actualizaciones) {
    if (!isObject(item) || item.modo !== mode || !isObject(item.benchmark)) continue;
    if (typeof item.hora !== "string" || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(item.hora)) continue;

    const benchmark: BenchmarkEstimate["benchmark"] = {};
    for (const code of BENCHMARK_CODES) {
      const value = item.benchmark[code];
      if (typeof value === "number" && Number.isFinite(value)) benchmark[code] = value;
    }
    if (Object.keys(benchmark).length === 0) continue;

    // A igualdad de hora, prevalece la última actualización del archivo.
    if (!latest || item.hora >= latest.hora) {
      latest = { fecha: today, hora: item.hora, modo: mode, benchmark };
    }
  }
  return latest;
}

export type MonthlyMacroRow = {
  fecha: string;
  imacec: number | null;
  desempleo: number | null;
  ipc_mom: number | null;
  ipcsae_mom: number | null;
  ipc_yoy: number | null;
};

type MacroColumn = Exclude<keyof MonthlyMacroRow, "fecha">;
const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export function monthlyMacroKpi(rows: MonthlyMacroRow[], column: MacroColumn, label: string) {
  const latest = rows.reduce<MonthlyMacroRow | null>((found, row) => {
    const value = row[column];
    if (typeof value !== "number" || !Number.isFinite(value) || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(row.fecha)) return found;
    return !found || row.fecha > found.fecha ? row : found;
  }, null);

  if (!latest) return { label, value: "—", description: "Sin datos disponibles" };
  const [year, month] = latest.fecha.split("-");
  return {
    label,
    value: `${new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(latest[column]!)}%`,
    description: `Dato ${months[Number(month) - 1]} ${year}`,
  };
}

export type DailyMacroRow = { fecha: string; tpm: number | null };

export function dailyTpmKpi(rows: DailyMacroRow[]) {
  const latest = rows.reduce<DailyMacroRow | null>((found, row) => {
    if (typeof row.tpm !== "number" || !Number.isFinite(row.tpm) || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(row.fecha)) return found;
    const date = new Date(`${row.fecha}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== row.fecha) return found;
    return !found || row.fecha > found.fecha ? row : found;
  }, null);

  return {
    label: "TPM",
    value: latest ? `${new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(latest.tpm!)}%` : "—",
    description: latest ? "Tasa de Política Monetaria" : "Sin datos disponibles",
  };
}

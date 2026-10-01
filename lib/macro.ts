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

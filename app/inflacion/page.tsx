import monthlyData from "@/public/data/datos-mensuales.json";
import icapData from "@/public/data/Closing_Icap/inflacion.json";
import { InflationMonthlyChart, type InflationPoint } from "@/components/InflationMonthlyChart";

type MonthlyRow = { fecha: string; ipc_mom: number | null };
type IcapRow = { Tenor: number; IPC: number | null };

function twoMonthsEarlier(tenor: number): string | null {
  if (!Number.isFinite(tenor)) return null;
  const date = new Date(tenor);
  if (!Number.isFinite(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 2, 1)).toISOString().slice(0, 10);
}

export default function InflationPage() {
  const observed: InflationPoint[] = (monthlyData as MonthlyRow[])
    .filter((row) => /^\d{4}-(0[1-9]|1[0-2])-01$/.test(row.fecha) && typeof row.ipc_mom === "number" && Number.isFinite(row.ipc_mom))
    .map((row) => ({ fecha: row.fecha, ipc: row.ipc_mom as number, tipo: "observado" as const }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  const lastObserved = observed.at(-1)?.fecha ?? "";
  const expectedByMonth = new Map<string, InflationPoint>();
  for (const row of icapData.datos as IcapRow[]) {
    const fecha = twoMonthsEarlier(row.Tenor);
    if (fecha && fecha > lastObserved && typeof row.IPC === "number" && Number.isFinite(row.IPC)) {
      expectedByMonth.set(fecha, { fecha, ipc: row.IPC, tipo: "esperado" });
    }
  }
  const expected = [...expectedByMonth.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));

  return (
    <section style={{ padding: "28px 24px", maxWidth: 1100, margin: "0 auto" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)", fontWeight: 700, marginBottom: 8 }}>
          Inflación y expectativas
        </h1>
        <p style={{ opacity: 0.75, margin: 0 }}>
          IPC mensual observado y expectativas de mercado ICAP
        </p>
      </header>
      <InflationMonthlyChart observed={observed} expected={expected} icapClosingDate={icapData.fecha} />
    </section>
  );
}

import { AppShell } from "@/components/AppShell";
import monthlyData from "@/public/data/historico_bcentral/datos-mensuales.json";
import icapData from "@/public/data/Closing_Icap/inflacion.json";
import { InflationMonthlyChart, type InflationPoint } from "@/components/InflationMonthlyChart";
import { TpmProbabilities } from "@/components/TpmProbabilities";
import { tpmModelData } from "@/lib/market-models.server";

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
    <AppShell>
      <header className="page-head">
        <div>
          <div className="eyebrow">Trading Propietario</div>
          <h1>Inflación y TPM</h1>
          <p>IPC mensual observado, expectativas de mercado y TPM descontada por los swaps.</p>
        </div>
        <div className="asof"><span>Cierre ICAP</span><strong>{icapData.fecha}</strong></div>
      </header>
      <InflationMonthlyChart observed={observed} expected={expected} />
      <TpmProbabilities data={tpmModelData()} />
    </AppShell>
  );
}

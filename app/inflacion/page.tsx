import monthlyData from "@/public/data/datos-mensuales.json";
import { InflationMonthlyChart } from "@/components/InflationMonthlyChart";

type IpcRow = { fecha: string; ipc_mom: number | null };

export default function InflationPage() {
  const latest = (monthlyData as IpcRow[])
    .filter((row) => /^\d{4}-(0[1-9]|1[0-2])-01$/.test(row.fecha) && typeof row.ipc_mom === "number" && Number.isFinite(row.ipc_mom))
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .slice(0, 2)
    .reverse()
    .map((row) => ({ fecha: row.fecha, ipc: row.ipc_mom as number }));

  return (
    <section style={{ padding: "28px 24px", maxWidth: 1100, margin: "0 auto" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)", fontWeight: 700, marginBottom: 8 }}>
          Inflación y expectativas
        </h1>
        <p style={{ opacity: 0.75, margin: 0 }}>
          Evolución de la inflación en Chile · IPC observado
        </p>
      </header>
      <InflationMonthlyChart data={latest} />
    </section>
  );
}

"use client";

import {
  Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip,
  XAxis, YAxis, ReferenceLine
} from "recharts";

type Point = { fecha: string; ipc: number };
const monthNames = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fmt = (n: number) => `${new Intl.NumberFormat("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n)}%`;
const label = (fecha: string) => {
  const [year, month] = fecha.split("-");
  return `${monthNames[Number(month) - 1]} ${year}`;
};

export function InflationMonthlyChart({ data }: { data: Point[] }) {
  const chartData = data.map((p) => ({ ...p, mes: label(p.fecha) }));
  const values = chartData.map((p) => p.ipc);
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const padding = Math.max(0.15, (high - low) * 0.3);
  const domain: [number, number] = [Math.min(0, low - padding), Math.max(0, high + padding)];

  return (
    <article style={{ border: "1px solid var(--border, #334155)", borderRadius: 14, padding: "22px 20px", background: "var(--card, transparent)" }}>
      <h2 style={{ margin: "0 0 6px", fontSize: "1.2rem" }}>IPC mensual · últimas 2 observaciones</h2>
      <p style={{ opacity: 0.7, margin: "0 0 20px", fontSize: 13 }}>Variación mensual (%) · Fuente: datos-mensuales.json</p>
      {chartData.length === 0 ? (
        <p>No hay datos de IPC mensual disponibles.</p>
      ) : (
        <div role="img" aria-label={`IPC mensual: ${chartData.map((p) => `${p.mes} ${fmt(p.ipc)}`).join(", ")}`} style={{ width: "100%", height: 310 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 30, right: 20, left: 2, bottom: 8 }} barCategoryGap="45%">
              <CartesianGrid strokeDasharray="3 4" vertical={false} stroke="#64748b" strokeOpacity={0.25} />
              <XAxis dataKey="mes" tickLine={false} axisLine={false} tick={{ fill: "#94a3b8", fontSize: 13 }} />
              <YAxis domain={domain} tickFormatter={fmt} tickLine={false} axisLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} width={53} />
              <Tooltip formatter={(value: number) => [fmt(value), "IPC mensual"]} />
              <ReferenceLine y={0} stroke="#94a3b8" strokeOpacity={0.7} />
              <Bar dataKey="ipc" fill="#38bdf8" maxBarSize={100} radius={[5, 5, 0, 0]}>
                <LabelList dataKey="ipc" position="top" formatter={fmt} fill="#38bdf8" fontWeight={600} fontSize={14} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <p style={{ opacity: 0.65, fontSize: 12, margin: "14px 0 0" }}>
        Se muestran automáticamente los dos últimos meses con IPC mensual informado.
      </p>
    </article>
  );
}

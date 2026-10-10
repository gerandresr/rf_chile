"use client";

import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip,
  XAxis, YAxis, ReferenceLine
} from "recharts";

export type InflationPoint = { fecha: string; ipc: number; tipo: "observado" | "esperado" };

const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const numberFormat = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const fmt = (n: number) => `${numberFormat.format(n)}%`;
const label = (fecha: string) => {
  const [year, month] = fecha.split("-");
  return `${months[Number(month) - 1]} ${year}`;
};

const OBSERVED = "#38bdf8";
const EXPECTED = "#f59e0b";

export function InflationMonthlyChart({
  observed, expected, icapClosingDate
}: {
  observed: InflationPoint[];
  expected: InflationPoint[];
  icapClosingDate: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const selectedObserved = showAll ? observed : observed.slice(-12);
  const selectedExpected = showAll ? expected : expected.slice(0, 12);
  const chartData = [...selectedObserved, ...selectedExpected]
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .map((row) => ({ ...row, mes: label(row.fecha) }));

  const vals = chartData.map((point) => point.ipc);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const pad = Math.max(0.15, (max - min) * 0.12);
  const domain: [number, number] = [Math.min(0, min - pad), Math.max(0, max + pad)];

  return (
    <article style={{ border: "1px solid var(--border, #334155)", borderRadius: 14, padding: "22px 20px", background: "var(--card, transparent)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: "0 0 5px", fontSize: "1.2rem" }}>IPC mensual · observado y esperado</h2>
          <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>Variación mensual (%) · ICAP cierre {icapClosingDate}</p>
        </div>
        <div role="group" aria-label="Período del gráfico" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <button type="button" aria-pressed={!showAll} onClick={() => setShowAll(false)}
            style={{ padding: "9px 12px", borderRadius: 8, cursor: "pointer", border: "1px solid #64748b", color: !showAll ? "#0f172a" : "inherit", background: !showAll ? "#7dd3fc" : "transparent" }}>
            Últimos 12 + próximos 12
          </button>
          <button type="button" aria-pressed={showAll} onClick={() => setShowAll(true)}
            style={{ padding: "9px 12px", borderRadius: 8, cursor: "pointer", border: "1px solid #64748b", color: showAll ? "#0f172a" : "inherit", background: showAll ? "#7dd3fc" : "transparent" }}>
            Mostrar toda la muestra
          </button>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginBottom: 18, fontSize: 13 }}>
        <span><span aria-hidden="true" style={{ display: "inline-block", height: 10, width: 10, borderRadius: 2, background: OBSERVED, marginRight: 7 }} />IPC observado ({selectedObserved.length})</span>
        <span><span aria-hidden="true" style={{ display: "inline-block", height: 10, width: 10, borderRadius: 2, background: EXPECTED, marginRight: 7 }} />Expectativas ICAP ({selectedExpected.length})</span>
      </div>
      {chartData.length === 0 ? <p>No hay datos de IPC disponibles.</p> : (
        <div style={{ width: "100%", overflowX: "auto" }}>
          <div role="img" aria-label="Gráfico de barras del IPC observado y expectativas ICAP" style={{ height: 360, minWidth: showAll ? Math.max(780, chartData.length * 24) : 600 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 20, right: 18, left: 0, bottom: 28 }}>
                <CartesianGrid strokeDasharray="3 4" vertical={false} stroke="#64748b" strokeOpacity={0.25} />
                <XAxis dataKey="mes" angle={-40} textAnchor="end" height={62} interval={showAll ? Math.max(0, Math.ceil(chartData.length / 24) - 1) : 0} tickLine={false} axisLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis domain={domain} tickFormatter={fmt} tickLine={false} axisLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} width={58} />
                <Tooltip formatter={(value, _name, item) => [fmt(Number(value)), item.payload.tipo === "observado" ? "IPC observado" : "Expectativa ICAP"]} labelFormatter={(value) => String(value)} />
                <ReferenceLine y={0} stroke="#94a3b8" strokeOpacity={0.7} />
                <Bar dataKey="ipc" maxBarSize={52} radius={[4, 4, 0, 0]}>
                  {chartData.map((point) => <Cell key={point.fecha} fill={point.tipo === "observado" ? OBSERVED : EXPECTED} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <p style={{ fontSize: 12, opacity: 0.7, margin: "16px 0 0" }}>
        Observado: datos-mensuales.json · Esperado: Closing_Icap/inflacion.json.
        Los contratos ICAP se asignan al mes de IPC dos meses anterior al tenor. Las expectativas comienzan después del último dato observado.
      </p>
    </article>
  );
}

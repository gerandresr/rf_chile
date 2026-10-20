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

const OBSERVED = "#2f6fed";
const EXPECTED = "#f59e0b";

export function InflationMonthlyChart({
  observed, expected
}: {
  observed: InflationPoint[];
  expected: InflationPoint[];
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
    <>
      <section className="panel">
        <div className="panel-head" style={{ flexWrap: "wrap" }}>
          <div>
            <div className="eyebrow">Variación mensual (%)</div>
            <h2>IPC mensual · observado y esperado</h2>
          </div>
          <div className="segmented" role="group" aria-label="Período del gráfico">
            <button type="button" aria-pressed={!showAll} className={!showAll ? "selected" : ""} onClick={() => setShowAll(false)}>
              Últimos 12 + próximos 12
            </button>
            <button type="button" aria-pressed={showAll} className={showAll ? "selected" : ""} onClick={() => setShowAll(true)}>
              Toda la muestra
            </button>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <span className="pill"><span aria-hidden="true" style={{ display: "inline-block", height: 8, width: 8, borderRadius: 2, background: OBSERVED, marginRight: 6 }} />IPC observado ({selectedObserved.length})</span>
          <span className="pill"><span aria-hidden="true" style={{ display: "inline-block", height: 8, width: 8, borderRadius: 2, background: EXPECTED, marginRight: 6 }} />Expectativas de mercado ({selectedExpected.length})</span>
        </div>
        {chartData.length === 0 ? <div className="loading">No hay datos de IPC disponibles.</div> : (
          <div className="table-wrap">
            <div role="img" aria-label="Gráfico de barras del IPC observado y expectativas de mercado" style={{ height: 380, minWidth: showAll ? Math.max(780, chartData.length * 24) : 600 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 18, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="mes" angle={-40} textAnchor="end" height={62} interval={showAll ? Math.max(0, Math.ceil(chartData.length / 24) - 1) : 0} tick={{ fontSize: 11 }} />
                  <YAxis domain={domain} tickFormatter={fmt} tick={{ fontSize: 12 }} width={58} />
                  <Tooltip formatter={(value, _name, item) => [fmt(Number(value)), item.payload.tipo === "observado" ? "IPC observado" : "Expectativa de mercado"]} labelFormatter={(value) => String(value)} />
                  <ReferenceLine y={0} stroke="#94a3b8" />
                  <Bar dataKey="ipc" maxBarSize={52} radius={[4, 4, 0, 0]}>
                    {chartData.map((point) => <Cell key={point.fecha} fill={point.tipo === "observado" ? OBSERVED : EXPECTED} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </section>
      <div className="note">
        El IPC observado corresponde a datos publicados; las expectativas reflejan precios de mercado.
        Cada contrato se asigna al mes de IPC dos meses anterior a su vencimiento. Las expectativas comienzan después del último dato observado.
      </div>
    </>
  );
}

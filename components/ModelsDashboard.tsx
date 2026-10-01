"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "./AppShell";
import monthlyData from "@/public/data/datos-mensuales.json";
import { estimateNairu } from "@/lib/nairu";

type EstimateView = "smoothed" | "filtered";
const number = (value: number, digits = 2) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
function month(date: string, short = false) {
  return new Intl.DateTimeFormat("es-CL", { month: short ? "short" : "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function NairuModel() {
  const [view, setView] = useState<EstimateView>("smoothed");
  const estimation = useMemo(() => {
    try { return { result: estimateNairu(monthlyData, 0.05), error: null }; }
    catch (error) { return { result: null, error: error instanceof Error ? error.message : "No fue posible estimar el modelo." }; }
  }, []);
  const result = estimation.result;
  const chartRows = useMemo(() => result?.points.map((point) => {
    const nairu = point[view], lower = point[`${view}Lower`], upper = point[`${view}Upper`];
    return { ...point, nairu, lower, upper, band: [lower, upper], gap: point.unemployment - nairu };
  }) ?? [], [result, view]);
  if (!result || !chartRows.length) return <div className="model-notice" role="alert">{estimation.error ?? "Sin datos disponibles."}</div>;
  const latest = chartRows[chartRows.length - 1];
  const averageGap = chartRows.reduce((sum, row) => sum + row.gap, 0) / chartRows.length;
  const conclusive = latest.unemployment > latest.upper || latest.unemployment < latest.lower;
  const reading = !conclusive ? "Brecha no concluyente" : latest.gap > 0 ? "Holgura laboral estimada" : "Mercado laboral ajustado según el modelo";
  return (
    <div className="model-content">
      <div className="model-intro">
        <span className="pill">Experimental · {result.observations} meses · ventana de 10 años</span>
      </div>
      <div className="kpi-grid model-kpi-grid">
        <div className="kpi"><div className="kpi-label">NAIRU estimada</div><div className="kpi-value">{number(latest.nairu)}%</div><div className="kpi-foot kpi-foot-static">Dato {month(latest.date)}</div></div>
        <div className="kpi"><div className="kpi-label">Desempleo observado</div><div className="kpi-value">{number(latest.unemployment)}%</div><div className="kpi-foot kpi-foot-static">Dato {month(latest.date)}</div></div>
        <div className="kpi"><div className="kpi-label">Brecha de desempleo</div><div className="kpi-value">{latest.gap > 0 ? "+" : ""}{number(latest.gap)} pp</div><div className="kpi-foot kpi-foot-static">{reading}</div></div>
      </div>

      <div className="model-controls">
        <div className="segmented" role="group" aria-label="Tipo de estimación">
          <button className={view === "smoothed" ? "selected" : ""} aria-pressed={view === "smoothed"} onClick={() => setView("smoothed")}>Suavizada</button>
          <button className={view === "filtered" ? "selected" : ""} aria-pressed={view === "filtered"} onClick={() => setView("filtered")}>Filtrada</button>
        </div>
      </div>
      <p className="model-caption">{view === "smoothed" ? "La estimación suavizada utiliza toda la muestra y revisa el pasado con información posterior." : "El filtro actualiza el estado hacia adelante. Los parámetros y el nivel inicial se calibran con información de la muestra: esta vista no reproduce estimaciones en tiempo real."}</p>

      <section className="model-chart-section" aria-label="Gráfico de desempleo y NAIRU">
        <div className="panel-head"><h2>Desempleo y NAIRU</h2><span className="pill">{month(chartRows[0].date, true)} – {month(latest.date, true)}</span></div>
        <div className="model-chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartRows} margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
              <XAxis dataKey="date" tickFormatter={(date) => month(date, true)} minTickGap={65} tick={{ fontSize: 11 }} />
              <YAxis domain={["auto", "auto"]} tickFormatter={(value) => `${number(value, 1)}%`} width={58} tick={{ fontSize: 11 }} />
              <Tooltip content={({ active, payload }) => {
                const point = payload?.[0]?.payload;
                if (!active || !point) return null;
                return <div className="curve-tooltip"><div className="curve-tooltip-title">{month(point.date)}</div><div>Desempleo: {number(point.unemployment)}%</div><div>NAIRU: {number(point.nairu)}%</div><div>Banda 95%: {number(point.lower)}% – {number(point.upper)}%</div></div>;
              }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area dataKey="band" name="Banda condicional 95%" type="linear" fill="#2f6fed" fillOpacity={0.12} stroke="none" isAnimationActive={false} />
              <Line dataKey="unemployment" name="Desempleo" stroke="#172033" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="nairu" name={`NAIRU ${view === "smoothed" ? "suavizada" : "filtrada"}`} stroke="#2f6fed" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="model-chart-section" aria-label="Gráfico de brecha de desempleo">
        <div className="panel-head"><h2>Brecha de desempleo</h2><span className="pill">Desempleo − NAIRU · pp</span></div>
        <p className="model-caption">Una brecha positiva sugiere holgura laboral; una negativa, mayor presión laboral. El signo por sí solo no permite concluir si la incertidumbre incluye cero.</p>
        <div className="model-gap-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartRows} margin={{ top: 10, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
              <XAxis dataKey="date" tickFormatter={(date) => month(date, true)} minTickGap={65} tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(value) => number(value, 1)} width={58} tick={{ fontSize: 11 }} />
              <ReferenceLine y={0} stroke="#748096" />
              <ReferenceLine y={averageGap} stroke="#d94b4b" strokeWidth={2} label={{ value: `Brecha Promedio: ${number(averageGap)} pp`, position: "insideTopLeft", fill: "#d94b4b", fontSize: 11 }} />
              <Tooltip labelFormatter={(date) => month(String(date))} formatter={(value) => [`${number(Number(value))} pp`, "Brecha"]} />
              <Bar dataKey="gap" isAnimationActive={false}>{chartRows.map((row) => <Cell key={row.date} fill={row.gap >= 0 ? "#2f6fed" : "#d94b4b"} fillOpacity={0.7} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="model-caption">La línea roja muestra el promedio de la brecha del período completo, en puntos porcentuales.</p>
      </section>

    </div>
  );
}

export function ModelsDashboard() {
  const [open, setOpen] = useState(false);
  return <AppShell>
    <header className="page-head"><div><div className="eyebrow">Trading Propietario</div><h1>Modelos</h1><p>Selecciona un modelo para consultar sus resultados.</p></div></header>
    <details className="panel model-disclosure" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><span>NAIRU · Filtro de Kalman</span><ChevronDown size={20} aria-hidden="true" /></summary>
      {open && <NairuModel />}
    </details>
  </AppShell>;
}

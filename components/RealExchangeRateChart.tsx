"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type MonthlyRate = { fecha: string; tc_real: number };
const number = (value: number) => value.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function month(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("es-CL", { month: "short", year: "numeric", timeZone: "UTC" });
}
function RealExchangeRateContent() {
  const [rows, setRows] = useState<MonthlyRate[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/data/datos-mensuales.json", { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error("No se pudieron cargar los datos"); return response.json(); })
      .then((data: unknown) => {
        if (!Array.isArray(data)) throw new Error("Formato inválido");
        setRows(data.filter((row): row is MonthlyRate => row != null && typeof row.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.fecha) && typeof row.tc_real === "number" && Number.isFinite(row.tc_real)).map(row => ({ fecha: row.fecha, tc_real: row.tc_real })).sort((a, b) => a.fecha.localeCompare(b.fecha)));
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);
  if (error) return <div className="model-content" role="alert">No se pudo cargar el tipo de cambio real.</div>;
  if (!rows) return <div className="model-content" role="status">Cargando tipo de cambio real…</div>;
  if (!rows.length) return <div className="model-content">No hay datos de tipo de cambio real disponibles.</div>;
  const last = rows[rows.length - 1];
  return <div className="model-content">
    <div className="model-intro"><p>Serie mensual · {month(rows[0].fecha)} a {month(last.fecha)}</p><span className="pill">Último valor: {number(last.tc_real)}</span></div>
    <div className="model-chart" role="img" aria-label="Serie histórica mensual del tipo de cambio real de Chile">
      <ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ left: 8, right: 18, top: 10, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false}/>
        <XAxis dataKey="fecha" minTickGap={45} tickFormatter={month}/>
        <YAxis domain={["auto", "auto"]} tickFormatter={value => Number(value).toLocaleString("es-CL", { maximumFractionDigits: 1 })} label={{ value: "Índice", angle: -90, position: "insideLeft" }}/>
        <Tooltip labelFormatter={value => month(String(value))} formatter={value => [number(Number(value)), "Tipo de cambio real"]}/>
        <Line dataKey="tc_real" name="Tipo de cambio real" stroke="#2f6fed" strokeWidth={2.3} dot={false} type="linear" isAnimationActive={false}/>
      </LineChart></ResponsiveContainer>
    </div>
  </div>;
}
export function RealExchangeRateChart() {
  const [open, setOpen] = useState(false);
  return <details className="panel model-disclosure" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span>Tipo de Cambio Real Chile</span><ChevronDown size={20} aria-hidden="true"/></summary>
    {open && <RealExchangeRateContent/>}
  </details>;
}

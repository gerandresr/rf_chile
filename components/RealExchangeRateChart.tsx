"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { exchangeRateSeries, type ExchangeRatePoint } from "@/lib/exchange-rate";

const number = (value: number) => value.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function month(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("es-CL", { month: "short", year: "numeric", timeZone: "UTC" });
}
function RealExchangeRateContent() {
  const [rows, setRows] = useState<ExchangeRatePoint[] | null>(null);
  const [error, setError] = useState(false);
  const [period, setPeriod] = useState("MAX");
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(["/data/datos-mensuales.json", "/data/datos-diarios.json"].map(url => fetch(url, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error("No se pudieron cargar los datos"); return response.json(); })))
      .then(([monthly, daily]) => {
        if (!Array.isArray(monthly) || !Array.isArray(daily)) throw new Error("Formato inválido");
        setRows(exchangeRateSeries(monthly, daily));
      }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);
  const visible = useMemo(() => {
    if (!rows?.length || period === "MAX") return rows ?? [];
    const last = new Date(`${rows[rows.length - 1].fecha}T00:00:00Z`);
    last.setUTCFullYear(last.getUTCFullYear() - Number(period));
    return rows.filter(row => row.fecha >= last.toISOString().slice(0, 10));
  }, [rows, period]);
  if (error) return <div className="model-content" role="alert">No se pudieron cargar las series de dólar observado y tipo de cambio real.</div>;
  if (!rows) return <div className="model-content" role="status">Cargando dólar observado y tipo de cambio real…</div>;
  if (!rows.length) return <div className="model-content">No hay datos disponibles.</div>;
  const lastReal = rows.filter(r => r.tc_real !== null).at(-1);
  const lastDollar = rows.filter(r => r.usdclp !== null).at(-1);
  const gaps = visible.some(r => r.gap !== null);
  return <div className="model-content">
    <div className="model-intro"><p>Comparación mensual · {month(visible[0].fecha)} a {month(visible[visible.length - 1].fecha)}</p>
      <div className="segmented" role="group" aria-label="Período del tipo de cambio">{["1", "3", "5", "MAX"].map(p => <button key={p} className={period === p ? "selected" : ""} aria-pressed={period === p} onClick={() => setPeriod(p)}>{p === "MAX" ? "Todo" : `${p}A`}</button>)}</div>
    </div>
    <div className="panel-head"><h2>Dólar observado y tipo de cambio real</h2></div>
    <div className="model-chart" role="img" aria-label="Dólar observado promedio mensual y TCR en ejes separados">
      <ResponsiveContainer width="100%" height="100%"><LineChart data={visible} syncId="exchange-rate" margin={{ left: 4, right: 4, top: 10, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="fecha" minTickGap={55} tickFormatter={month}/>
        <YAxis yAxisId="dollar" domain={["auto", "auto"]} width={60} stroke="#2f6fed" tickFormatter={v => Number(v).toFixed(0)} label={{ value: "CLP/USD", angle: -90, position: "insideLeft", fontSize: 11 }}/>
        <YAxis yAxisId="real" orientation="right" domain={["auto", "auto"]} width={55} stroke="#f59e0b" tickFormatter={v => Number(v).toFixed(1)} label={{ value: "Índice TCR", angle: 90, position: "insideRight", fontSize: 11 }}/>
        <Tooltip labelFormatter={value => month(String(value))} formatter={(value, name) => [String(name).startsWith("Dólar") ? `$${number(Number(value))}` : number(Number(value)), String(name)]}/><Legend/>
        <Line yAxisId="dollar" dataKey="usdclp" name="Dólar observado · promedio mensual" stroke="#2f6fed" strokeWidth={2.3} dot={false} type="linear" isAnimationActive={false} connectNulls={false}/>
        <Line yAxisId="real" dataKey="tc_real" name="Índice TCR" stroke="#f59e0b" strokeWidth={2.3} strokeDasharray="6 4" dot={false} type="linear" isAnimationActive={false} connectNulls={false}/>
      </LineChart></ResponsiveContainer>
    </div>
    <p className="model-caption">Último promedio mensual disponible del dólar: {lastDollar ? `$${number(lastDollar.usdclp!)} (${month(lastDollar.fecha)}; ${lastDollar.dollarObservations} observaciones)` : "sin datos"}. Último TCR: {lastReal ? `${number(lastReal.tc_real!)} (${month(lastReal.fecha)})` : "sin datos"}. El promedio del mes en curso es parcial; las series pueden terminar en meses distintos.</p>
    <section className="model-chart-section"><div className="panel-head"><h2>Desviación del TCR respecto a su promedio</h2><span className="pill">36 meses anteriores · %</span></div>
      {gaps ? <div className="model-gap-chart" role="img" aria-label="Brecha porcentual del TCR frente al promedio de los 36 meses anteriores"><ResponsiveContainer width="100%" height="100%"><AreaChart data={visible} syncId="exchange-rate" margin={{ left: 4, right: 4, top: 10, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="fecha" minTickGap={55} tickFormatter={month}/><YAxis width={60} tickFormatter={v => `${Number(v).toFixed(1)}%`}/><ReferenceLine y={0} stroke="#748096"/>
        <Tooltip content={({ active, payload }) => { const row = payload?.[0]?.payload as ExchangeRatePoint | undefined; return active && row?.gap != null ? <div className="curve-tooltip"><strong>{month(row.fecha)}</strong><div>Brecha: {number(row.gap)}%</div><div>TCR: {number(row.tc_real!)}</div><div>Promedio previo: {number(row.reference!)}</div></div> : null; }}/><Legend/>
        <Area dataKey="positive" name="Sobre el promedio" stroke="#0f9f6e" fill="#0f9f6e" fillOpacity={0.25} type="linear" isAnimationActive={false} connectNulls={false}/>
        <Area dataKey="negative" name="Bajo el promedio" stroke="#d94b4b" fill="#d94b4b" fillOpacity={0.25} type="linear" isAnimationActive={false} connectNulls={false}/>
      </AreaChart></ResponsiveContainer></div> : <p className="model-caption" role="status">No hay meses con los 36 valores mensuales previos necesarios para calcular la brecha en este período.</p>}
      <p className="model-caption">Brecha = (TCR / promedio de los 36 meses anteriores − 1) × 100. El promedio excluye el mes actual y se calcula antes de recortar el período visible. Se requieren 36 meses consecutivos con datos. Verde indica TCR sobre su promedio y rojo bajo su promedio; no es una estimación de sobrevaloración o subvaloración del peso.</p>
    </section>
  </div>;
}
export function RealExchangeRateChart() {
  const [open, setOpen] = useState(false);
  return <details className="panel model-disclosure" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span>Tipo de Cambio Real Chile</span><ChevronDown size={20} aria-hidden="true"/></summary>
    {open && <RealExchangeRateContent/>}
  </details>;
}

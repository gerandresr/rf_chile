"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { exchangeRateSeries, type ExchangeRatePoint } from "@/lib/exchange-rate";

const number = (value: number) => value.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function month(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("es-CL", { month: "short", year: "numeric", timeZone: "UTC" });
}
type GapKey = "cumulativeGap" | "gap" | "hpGap";
function DeviationChart({ rows, gapKey, referenceKey, title, badge, caption, domain }: {
  rows: ExchangeRatePoint[]; gapKey: GapKey; referenceKey: "cumulativeReference" | "reference" | "hpReference";
  title: string; badge: string; caption: string; domain: [number, number];
}) {
  const points = rows.map(row => ({ ...row, deviation: row[gapKey], baseline: row[referenceKey],
    above: row[gapKey] === null ? null : Math.max(0, row[gapKey]!), below: row[gapKey] === null ? null : Math.min(0, row[gapKey]!) }));
  return <section className="model-chart-section"><div className="panel-head"><h2>{title}</h2><span className="pill">{badge}</span></div>
    {points.some(row => row.deviation !== null) ? <div className="model-gap-chart" role="img" aria-label={title}><ResponsiveContainer width="100%" height="100%"><AreaChart data={points} syncId="exchange-rate" margin={{ left: 4, right: 4, top: 10, bottom: 4 }}>
      <CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="fecha" minTickGap={55} tickFormatter={month}/><YAxis width={60} domain={domain} tickFormatter={v => `${Number(v).toFixed(1)}%`}/><ReferenceLine y={0} stroke="#748096"/>
      <Tooltip content={({ active, payload }) => { const row = payload?.[0]?.payload as typeof points[number] | undefined; return active && row?.deviation != null ? <div className="curve-tooltip"><strong>{month(row.fecha)}</strong><div>Desviación: {number(row.deviation)}%</div><div>TCR: {number(row.tc_real!)}</div><div>Referencia: {number(row.baseline!)}</div></div> : null; }}/><Legend/>
      <Area dataKey="above" name="Sobre la referencia" stroke="#0f9f6e" fill="#0f9f6e" fillOpacity={0.25} type="linear" isAnimationActive={false} connectNulls={false}/>
      <Area dataKey="below" name="Bajo la referencia" stroke="#d94b4b" fill="#d94b4b" fillOpacity={0.25} type="linear" isAnimationActive={false} connectNulls={false}/>
    </AreaChart></ResponsiveContainer></div> : <p className="model-caption" role="status">Historia insuficiente para calcular esta desviación en el período seleccionado.</p>}
    <p className="model-caption">{caption}</p>
  </section>;
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
  const deviations = visible.flatMap(r => [r.cumulativeGap, r.gap, r.hpGap]).filter((v): v is number => v !== null);
  const extent = Math.max(1, Math.ceil(Math.max(0, ...deviations.map(Math.abs))));
  const domain: [number, number] = [-extent, extent];
  return <div className="model-content">
    <div className="model-intro"><p>Comparación mensual · {month(visible[0].fecha)} a {month(visible[visible.length - 1].fecha)}</p>
      <div className="segmented" role="group" aria-label="Período del tipo de cambio">{["1", "3", "5", "MAX"].map(p => <button key={p} className={period === p ? "selected" : ""} aria-pressed={period === p} onClick={() => setPeriod(p)}>{p === "MAX" ? "Todo" : `${p}A`}</button>)}</div>
    </div>
    <div className="panel-head"><h2>Dólar observado y tipo de cambio real</h2></div>
    <div className="model-chart" role="img" aria-label="Último dólar observado de cada mes y TCR en ejes separados">
      <ResponsiveContainer width="100%" height="100%"><LineChart data={visible} syncId="exchange-rate" margin={{ left: 4, right: 4, top: 10, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="fecha" minTickGap={55} tickFormatter={month}/>
        <YAxis yAxisId="dollar" domain={["auto", "auto"]} width={60} stroke="#2f6fed" tickFormatter={v => Number(v).toFixed(0)} label={{ value: "CLP/USD", angle: -90, position: "insideLeft", fontSize: 11 }}/>
        <YAxis yAxisId="real" orientation="right" domain={["auto", "auto"]} width={55} stroke="#f59e0b" tickFormatter={v => Number(v).toFixed(1)} label={{ value: "Índice TCR", angle: 90, position: "insideRight", fontSize: 11 }}/>
        <Tooltip labelFormatter={value => month(String(value))} formatter={(value, name) => [String(name).startsWith("Dólar") ? `$${number(Number(value))}` : number(Number(value)), String(name)]}/><Legend/>
        <Line yAxisId="dollar" dataKey="usdclp" name="Dólar observado · último dato mensual" stroke="#2f6fed" strokeWidth={2.3} dot={false} type="linear" isAnimationActive={false} connectNulls={false}/>
        <Line yAxisId="real" dataKey="tc_real" name="Índice TCR" stroke="#f59e0b" strokeWidth={2.3} strokeDasharray="6 4" dot={false} type="linear" isAnimationActive={false} connectNulls={false}/>
      </LineChart></ResponsiveContainer>
    </div>
    <p className="model-caption">Último dato disponible del dólar: {lastDollar ? `$${number(lastDollar.usdclp!)} (${lastDollar.dollarDate})` : "sin datos"}. Último TCR: {lastReal ? `${number(lastReal.tc_real!)} (${month(lastReal.fecha)})` : "sin datos"}. En cada mes se usa el último dato válido de dólar observado; para el mes en curso, el último disponible. Las series pueden terminar en meses distintos.</p>
    <DeviationChart rows={visible} gapKey="cumulativeGap" referenceKey="cumulativeReference" domain={domain}
      title="Desviación del TCR respecto a su promedio histórico (acumulado)" badge="Desde 36 meses previos · %"
      caption="Referencia: promedio de todos los valores mensuales anteriores disponibles desde el inicio del histórico, excluyendo el mes actual. Comienza con 36 observaciones previas y se amplía cada mes." />
    <DeviationChart rows={visible} gapKey="gap" referenceKey="reference" domain={domain}
      title="Desviación del TCR respecto a su promedio de 36 meses rolling" badge="36 meses anteriores · %"
      caption="Referencia: promedio móvil de los 36 meses calendario anteriores, excluyendo el mes actual. Se requieren 36 meses consecutivos con datos." />
    <DeviationChart rows={visible} gapKey="hpGap" referenceKey="hpReference" domain={domain}
      title="Desviación del TCR respecto a su tendencia Hodrick-Prescott" badge="HP mensual · λ = 129.600 · %"
      caption="Referencia: tendencia HP del logaritmo del TCR, convertida a índice. Usa toda la muestra de cada tramo mensual continuo (mínimo 36 meses); puede revisar las desviaciones históricas al llegar nuevos datos, especialmente en los extremos." />
    <p className="model-caption">Las tres desviaciones usan (TCR / referencia − 1) × 100, se calculan antes de recortar el período visible y comparten la misma escala vertical. Verde indica TCR sobre la referencia y rojo bajo ella; no son estimaciones del tipo de cambio de equilibrio.</p>
  </div>;
}
export function RealExchangeRateChart() {
  const [open, setOpen] = useState(false);
  return <details className="panel model-disclosure" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span>Tipo de cambio real y desviaciones</span><ChevronDown size={20} aria-hidden="true"/></summary>
    {open && <RealExchangeRateContent/>}
  </details>;
}

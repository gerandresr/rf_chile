"use client";

import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import monthlyData from "@/public/data/historico_bcentral/datos-mensuales.json";
import dailyData from "@/public/data/historico_bcentral/datos-diarios.json";
import { DEFAULT_TAYLOR_PARAMETERS, NEUTRAL_RANGE_HALF_WIDTH, estimateTaylor, type TaylorParameters } from "@/lib/taylor";

export type ActivityGaps = { smoothed: Record<string, number>; filtered: Record<string, number> } | null;

const number = (value: number, digits = 2) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
const signed = (value: number, digits = 2) => `${value > 0 ? "+" : ""}${number(value, digits)}`;
const month = (date: string, long = false) => new Intl.DateTimeFormat("es-CL", { month: long ? "long" : "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const controls: { key: keyof TaylorParameters; label: string; min: number; max: number; step: number }[] = [
  { key: "neutralNominal", label: "TPM neutral (%)", min: -5, max: 20, step: 0.25 },
  { key: "inflationTarget", label: "Meta de inflación (%)", min: 0, max: 15, step: 0.25 },
  { key: "inflationWeight", label: "Peso brecha de inflación", min: 0, max: 5, step: 0.25 },
  { key: "activityWeight", label: "Peso brecha de actividad", min: 0, max: 5, step: 0.25 },
  { key: "smoothing", label: "Inercia mensual (ρ)", min: 0, max: 0.99, step: 0.05 },
];

export function TaylorModel({ gaps }: { gaps: ActivityGaps }) {
  const [parameters, setParameters] = useState(DEFAULT_TAYLOR_PARAMETERS);
  const [gapView, setGapView] = useState<"smoothed" | "filtered">("filtered");
  const estimation = useMemo(() => {
    if (!gaps) return { result: null, error: "No se pudo estimar la brecha de actividad (modelo de tasa natural)." };
    try { return { result: estimateTaylor(monthlyData, dailyData, gaps[gapView], parameters), error: null }; }
    catch (error) { return { result: null, error: error instanceof Error ? error.message : "No fue posible calcular la regla." }; }
  }, [parameters, gaps, gapView]);
  const result = estimation.result;
  const latest = result?.points.at(-1);
  const rows = result?.points.map(p => ({ ...p, band: [p.taylorLow, p.taylorHigh] as [number, number] })) ?? [];
  const currentTpm = [...dailyData].reverse().find(row => typeof row.tpm === "number" && Number.isFinite(row.tpm));
  const nextMonth = latest ? parameters.smoothing * latest.tpm + (1 - parameters.smoothing) * latest.taylor : null;
  const latestInflation = [...monthlyData].reverse().find(row => typeof row.ipc_yoy === "number" && Number.isFinite(row.ipc_yoy));
  const isLagged = !!latestInflation && latestInflation.fecha > latest?.date!;
  const inflationPart = latest ? (1 + parameters.inflationWeight) * (latest.inflation - parameters.inflationTarget) : 0;
  const activityPart = latest ? parameters.activityWeight * latest.gap : 0;

  return <div className="model-content">
    <div className="model-intro">
      <p>¿Dónde debería estar la TPM según la inflación y la holgura de la economía? La regla parte de la TPM neutral y suma {number(1 + parameters.inflationWeight, 2)} veces la desviación de la inflación respecto de la meta y {number(parameters.activityWeight, 2)} veces la brecha de actividad.</p>
      <span className="pill">Neutral IPoM dic-2025: 3,75%–4,75%</span>
    </div>
    <div className="taylor-controls">
      {controls.map(control => <label key={control.key}>{control.label}<input type="number" step={control.step} min={control.min} max={control.max} value={parameters[control.key]} onChange={event => {
        if (event.currentTarget.value === "") return;
        const value = event.currentTarget.valueAsNumber;
        if (Number.isFinite(value) && value >= control.min && value <= control.max) setParameters(previous => ({ ...previous, [control.key]: value }));
      }} /></label>)}
      <button className="taylor-reset" onClick={() => setParameters(DEFAULT_TAYLOR_PARAMETERS)}>Restablecer</button>
    </div>
    {!result || !latest ? <div className="model-notice" role="alert">{estimation.error}</div> : <>
      <div className="kpi-grid">
        <div className="kpi"><div className="kpi-label">Taylor sin inercia · {month(latest.date)}</div><div className="kpi-value">{number(latest.taylor)}%</div><div className="kpi-foot kpi-foot-static">Rango neutral: {number(latest.taylorLow)}% – {number(latest.taylorHigh)}%</div></div>
        <div className="kpi"><div className="kpi-label">TPM observada · mes del modelo</div><div className="kpi-value">{number(latest.tpm)}%</div><div className="kpi-foot kpi-foot-static">Cierre {latest.tpmDate}</div></div>
        <div className="kpi"><div className="kpi-label">Taylor − TPM · {month(latest.date)}</div><div className="kpi-value">{signed(latest.difference)} pp</div><div className="kpi-foot kpi-foot-static">{Math.abs(latest.difference) <= NEUTRAL_RANGE_HALF_WIDTH ? "Dentro del rango de incertidumbre" : latest.difference > 0 ? "La regla pide una TPM más alta" : "La regla pide una TPM más baja"}</div></div>
        <div className="kpi"><div className="kpi-label">Taylor con inercia · escenario siguiente mes</div><div className="kpi-value">{number(nextMonth!)}%</div><div className="kpi-foot kpi-foot-static">{signed((nextMonth! - latest.tpm) * 100, 0)} pb respecto del cierre de {month(latest.date)}</div></div>
      </div>
      <div className="model-notice">
        <strong>Fecha de referencia: {month(latest.date, true)}.</strong>
        <p>La tasa Taylor, su diferencia y el escenario con inercia utilizan inflación, brecha de actividad y cierre de TPM de ese mes. {isLagged ? `La inflación publicada llega hasta ${month(latestInflation!.fecha, true)}, pero aún faltan variables de actividad para ese mes.` : ""}
        {currentTpm ? ` TPM más reciente en los datos: ${number(currentTpm.tpm!)}% (${currentTpm.fecha}); es una referencia posterior y no se mezcla en la comparación histórica.` : ""}
        La brecha es una estimación estadística, no una cifra observada del Banco Central.</p>
      </div>
      <p className="model-caption">
        Descomposición {month(latest.date, true)}: neutral {number(parameters.neutralNominal)}% {inflationPart >= 0 ? "+" : "−"} inflación {number(Math.abs(inflationPart))} pp (IPC {number(latest.inflation, 1)}% vs meta {number(parameters.inflationTarget, 1)}%) {activityPart >= 0 ? "+" : "−"} actividad {number(Math.abs(activityPart))} pp (brecha {signed(latest.gap, 1)}%) = {number(latest.taylor)}%.
      </p>
      <p className="model-caption">
        <strong>Verificación:</strong> {number(parameters.neutralNominal)} + (1 + {number(parameters.inflationWeight)}) × ({number(latest.inflation)} − {number(parameters.inflationTarget)}) + {number(parameters.activityWeight)} × ({signed(latest.gap)}) = <strong>{number(latest.taylor)}%</strong>.
        <br /> <strong>Con inercia (escenario, no pronóstico):</strong> {number(parameters.smoothing)} × {number(latest.tpm)} + {number(1 - parameters.smoothing)} × {number(latest.taylor)} = <strong>{number(nextMonth!)}%</strong>.
      </p>
      <section className="model-chart-section" aria-label="Gráfico de regla de Taylor y TPM">
        <div className="panel-head" style={{ flexWrap: "wrap" }}><h2>Regla de Taylor y TPM</h2>
          <div className="segmented" role="group" aria-label="Brecha de actividad">
            <button className={gapView === "smoothed" ? "selected" : ""} aria-pressed={gapView === "smoothed"} onClick={() => setGapView("smoothed")}>Brecha suavizada</button>
            <button className={gapView === "filtered" ? "selected" : ""} aria-pressed={gapView === "filtered"} onClick={() => setGapView("filtered")}>Brecha en tiempo real</button>
          </div>
        </div>
        <div className="model-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
          <XAxis dataKey="date" tickFormatter={d => month(d)} minTickGap={65} tick={{ fontSize: 11 }} />
          <YAxis domain={["auto", "auto"]} tickFormatter={value => `${number(value, 0)}%`} width={48} tick={{ fontSize: 11 }} />
          <Tooltip content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (typeof rows)[number] | undefined;
            return active && point ? <div className="curve-tooltip"><div className="curve-tooltip-title">{month(point.date, true)}</div>
              <div>TPM: {number(point.tpm)}%</div><div>Taylor: {number(point.taylor)}% ({number(point.taylorLow)} – {number(point.taylorHigh)})</div>
              {point.inertial !== null && <div>Taylor con inercia: {number(point.inertial)}%</div>}
              <div>Inflación: {number(point.inflation, 1)}% · Brecha: {signed(point.gap, 1)}%</div></div> : null;
          }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area dataKey="band" name="Rango por TPM neutral ±0,5" type="linear" fill="#2f6fed" fillOpacity={0.1} stroke="none" isAnimationActive={false} />
          <Line dataKey="tpm" name="TPM (cierre mensual)" type="stepAfter" stroke="#172033" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line dataKey="taylor" name="Regla de Taylor" stroke="#2f6fed" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line dataKey="inertial" name={`Taylor con inercia (ρ = ${number(parameters.smoothing)})`} stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls />
        </ComposedChart></ResponsiveContainer></div>
      </section>
      <div className="model-notice">
        <strong>Cómo leerlo.</strong>
        <p>La regla usa inflación efectiva (IPC 12 meses), no proyectada, por lo que reacciona tarde a los shocks y exagera su tamaño: en 2021–2022 llegó a pedir una TPM sobre 20%, mientras el Banco Central subió de forma gradual hasta 11,25%; en 2023–2024 la TPM quedó sobre la regla porque los recortes esperaron confirmar la convergencia de la inflación.
          La brecha de actividad viene del modelo de tasa natural (ley de Okun); la versión filtrada evita usar observaciones posteriores en los estados del modelo, aunque sus parámetros se estiman con la muestra completa. La línea con inercia muestra un ajuste gradual hacia la regla, que es como opera en la práctica la política monetaria.</p>
      </div>
    </>}
  </div>;
}

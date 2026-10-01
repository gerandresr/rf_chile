"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import monthlyData from "@/public/data/datos-mensuales.json";
import dailyData from "@/public/data/datos-diarios.json";
import { DEFAULT_TAYLOR_PARAMETERS, estimateTaylor, type TaylorParameters } from "@/lib/taylor";

const number = (value: number) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const month = (date: string) => new Intl.DateTimeFormat("es-CL", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const controls: { key: keyof TaylorParameters; label: string; min: number; max: number }[] = [
  { key: "neutralReal", label: "Tasa neutral real (%)", min: -5, max: 10 },
  { key: "inflationTarget", label: "Meta de inflación (%)", min: 0, max: 15 },
  { key: "inflationWeight", label: "Peso de brecha de inflación", min: 0, max: 5 },
  { key: "activityWeight", label: "Peso de brecha de actividad", min: 0, max: 5 },
];

export function TaylorModel() {
  const [parameters, setParameters] = useState(DEFAULT_TAYLOR_PARAMETERS);
  const estimation = useMemo(() => {
    try { return { result: estimateTaylor(monthlyData, dailyData, parameters), error: null }; }
    catch (error) { return { result: null, error: error instanceof Error ? error.message : "No fue posible calcular la regla." }; }
  }, [parameters]);
  const result = estimation.result;
  const latest = result?.points.at(-1);
  return <div className="model-content">
    <div className="model-intro"><span className="pill">Regla de Taylor · Brecha de actividad estimada</span></div>
    <div className="taylor-controls">
      {controls.map(control => <label key={control.key}>{control.label}<input type="number" step="0.25" min={control.min} max={control.max} value={parameters[control.key]} onChange={event => {
        if (event.currentTarget.value === "") return;
        const value = event.currentTarget.valueAsNumber;
        if (Number.isFinite(value) && value >= control.min && value <= control.max) setParameters(previous => ({ ...previous, [control.key]: value }));
      }} /></label>)}
      <button className="taylor-reset" onClick={() => setParameters(DEFAULT_TAYLOR_PARAMETERS)}>Restablecer parámetros</button>
    </div>
    <p className="model-caption">Taylor = tasa neutral real + inflación anual + peso de inflación × (inflación − meta) + peso de actividad × brecha de actividad. La tasa neutral real inicial de 1,25% es un supuesto modificable, constante en toda la muestra.</p>
    {!result || !latest ? <div className="model-notice" role="alert">{estimation.error}</div> : <>
      <div className="kpi-grid model-kpi-grid">
        <div className="kpi"><div className="kpi-label">Tasa Taylor</div><div className="kpi-value">{number(latest.taylor)}%</div><div className="kpi-foot kpi-foot-static">Dato {month(latest.date)}</div></div>
        <div className="kpi"><div className="kpi-label">TPM observada</div><div className="kpi-value">{number(latest.tpm)}%</div><div className="kpi-foot kpi-foot-static">Último dato del mes: {latest.tpmDate}</div></div>
        <div className="kpi"><div className="kpi-label">Taylor − TPM</div><div className="kpi-value">{latest.difference > 0 ? "+" : ""}{number(latest.difference)} pp</div><div className="kpi-foot kpi-foot-static">Comparación del mismo mes</div></div>
      </div>
      <section className="model-chart-section" aria-label="Gráfico de regla de Taylor y TPM">
        <div className="panel-head"><h2>Regla de Taylor y TPM</h2><span className="pill">{month(result.points[0].date)} – {month(latest.date)}</span></div>
        <div className="model-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={result.points} margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
          <XAxis dataKey="date" tickFormatter={month} minTickGap={65} tick={{ fontSize: 11 }} />
          <YAxis domain={["auto", "auto"]} tickFormatter={value => `${number(value)}%`} width={64} tick={{ fontSize: 11 }} />
          <Tooltip content={({ active, payload }) => {
            const point = payload?.[0]?.payload;
            return active && point ? <div className="curve-tooltip"><div className="curve-tooltip-title">{month(point.date)}</div><div>Taylor: {number(point.taylor)}%</div><div>TPM: {number(point.tpm)}%</div><div>Inflación: {number(point.inflation)}%</div><div>Brecha de actividad: {number(point.gap)}%</div></div> : null;
          }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line dataKey="tpm" name="TPM de cierre mensual" type="stepAfter" stroke="#172033" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line dataKey="taylor" name="Regla de Taylor" stroke="#2f6fed" strokeWidth={2.5} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
        </ComposedChart></ResponsiveContainer></div>
      </section>
      <section className="model-chart-section" aria-label="Gráfico de brecha de actividad">
        <div className="panel-head"><h2>Brecha de actividad</h2><span className="pill">Última: {number(latest.gap)}%</span></div>
        <div className="model-gap-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={result.points}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
          <XAxis dataKey="date" tickFormatter={month} minTickGap={65} tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={value => `${number(value)}%`} width={64} tick={{ fontSize: 11 }} />
          <ReferenceLine y={0} stroke="#748096" />
          <Tooltip labelFormatter={date => month(String(date))} formatter={value => [`${number(Number(value))}%`, "Brecha de actividad"]} />
          <Bar dataKey="gap" isAnimationActive={false}>{result.points.map(point => <Cell key={point.date} fill={point.gap >= 0 ? "#2f6fed" : "#d94b4b"} fillOpacity={0.7} />)}</Bar>
        </BarChart></ResponsiveContainer></div>
      </section>
      <p className="model-caption">Brecha = 100 × (log del IMACEC desestacionalizado − tendencia HP del logaritmo). Filtro mensual con λ = 129.600 sobre {result.activityMonths} meses consecutivos ({month(result.startDate)} – {month(result.endDate)}). La tendencia utiliza toda la muestra y puede revisar resultados históricos al incorporar nuevos datos, especialmente en sus extremos. Los meses sin inflación o TPM se omiten de la comparación; no se utiliza TPM de meses posteriores.</p>
    </>}
    <p className="model-caption">Esta regla usa inflación observada y una aproximación estadística de la brecha de actividad. No reproduce el modelo del Banco Central ni constituye una proyección de sus decisiones. Fuentes metodológicas: <a href="https://www.frbsf.org/research-and-insights/publications/economic-letter/1998/12/describing-fed-behavior/" target="_blank" rel="noreferrer">regla de Taylor</a>, <a href="https://www.statsmodels.org/v0.14.3/generated/statsmodels.tsa.filters.hp_filter.hpfilter.html" target="_blank" rel="noreferrer">filtro HP mensual</a> y <a href="https://www.bcentral.cl/documents/33528/2246274/Uso_de_modelos_en_el_BCCh_2020.pdf" target="_blank" rel="noreferrer">modelos del BCCh</a>.</p>
  </div>;
}

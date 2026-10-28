"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TaylorEeeData } from "@/lib/market-models.server";
import { DEFAULT_TAYLOR_PARAMETERS } from "@/lib/taylor";
import { taylorEee, type EeeHorizon } from "@/lib/taylor-eee";
import { controls } from "./TaylorModel";

const number = (value: number, digits = 2) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
const signed = (value: number, digits = 2) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${number(Math.abs(value), digits)}`;
const month = (date: string, long = false) => new Intl.DateTimeFormat("es-CL", { month: long ? "long" : "short", year: long ? "numeric" : "2-digit", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const bp = (a: number, b: number) => { const d = 100 * (a - b); return `${d > 0 ? "+" : d < 0 ? "−" : ""}${number(Math.abs(d), 0)} pb`; };

export function TaylorEeeModel({ data, gaps, nairu, okun }: { data: TaylorEeeData; gaps: Record<string, number> | null; nairu: number; okun: number }) {
  const [parameters, setParameters] = useState(DEFAULT_TAYLOR_PARAMETERS);
  const [horizon, setHorizon] = useState<EeeHorizon>("24m");
  const estimation = useMemo(() => {
    if ("error" in data) return { result: null, error: data.error };
    if (!gaps) return { result: null, error: "No hay brecha de actividad disponible." };
    try { return { result: taylorEee(data, gaps, parameters, horizon), error: null }; }
    catch (error) { return { result: null, error: error instanceof Error ? error.message : "No fue posible calcular la regla." }; }
  }, [data, gaps, parameters, horizon]);

  const intro = <div className="model-notice">
    <strong>Para qué sirve.</strong>
    <p>Misma lógica que la versión de mercado, pero la inflación esperada sale de la <b>Encuesta de Expectativas Económicas</b> del Banco Central. Al no traer primas por riesgo ni de liquidez, muestra dónde debería estar la TPM según lo que esperan los economistas. Compara la regla con la TPM efectiva, con la <b>TPM que espera la propia encuesta a 12 meses</b> y con la que paga el mercado en los swaps Cámara: si el mercado cobra una TPM sobre la regla y sobre la encuesta, favorece recibir tasa fija en la parte corta; si queda bajo ambas, lo contrario.</p>
  </div>;

  const result = estimation.result;
  if ("error" in data || !result) return <div className="model-content">{intro}<div className="model-notice" role="alert">{estimation.error}</div></div>;

  const s = result.survey, in12 = result.in12;
  const otherHorizon = horizon === "24m" ? s.inf12 : s.inf24;
  const projection = result.projection.map(p => ({ ...p, tpm: data.currentTpm, eee: p.date === in12.date ? in12.eee : null }));
  const horizonLabel = horizon === "24m" ? "24 meses" : "12 meses";

  return <div className="model-content">
    {intro}
    <div className="model-intro">
      <p>Regla: TPM neutral + (1 + peso de inflación) × (<b>inflación esperada EEE a {horizonLabel}</b> − meta) + peso de actividad × brecha. La brecha usa la misma NAIRU ({number(nairu)}%) y Okun ({number(okun, 1)}) de la Regla de Taylor.</p>
      <span className="pill">EEE de {month(s.month, true)}</span>
    </div>
    <div className="taylor-controls">
      <label>Inflación esperada EEE<select value={horizon} onChange={event => setHorizon(event.currentTarget.value as EeeHorizon)}>
        <option value="24m">A 24 meses</option>
        <option value="12m">A 12 meses</option>
      </select></label>
      {controls.map(control => <label key={control.key}>{control.label}<input type="number" step={control.step} min={control.min} max={control.max} value={parameters[control.key]} onChange={event => {
        if (event.currentTarget.value === "") return;
        const value = event.currentTarget.valueAsNumber;
        if (Number.isFinite(value) && value >= control.min && value <= control.max) setParameters(previous => ({ ...previous, [control.key]: value }));
      }} /></label>)}
      <button className="taylor-reset" onClick={() => { setParameters(DEFAULT_TAYLOR_PARAMETERS); setHorizon("24m"); }}>Restablecer</button>
    </div>

    <div className="kpi-grid">
      <div className="kpi"><div className="kpi-label">Taylor EEE · hoy</div><div className="kpi-value">{number(result.today.taylor)}%</div><div className="kpi-foot kpi-foot-static">TPM {number(data.currentTpm)}% · diferencia {bp(data.currentTpm, result.today.taylor)}</div></div>
      <div className="kpi"><div className="kpi-label">Inflación esperada EEE {horizonLabel}</div><div className="kpi-value">{number(s.expected, 1)}%</div><div className="kpi-foot kpi-foot-static">{otherHorizon === null ? "" : `A ${horizon === "24m" ? "12" : "24"} meses: ${number(otherHorizon, 1)}%`}{s.pib === null ? "" : ` · PIB ${data.pibLabel} esperado: ${number(s.pib, 1)}%`}</div></div>
      <div className="kpi"><div className="kpi-label">TPM en {month(in12.date)}: regla / EEE / mercado</div><div className="kpi-value">{number(in12.inertial)}% <span className="muted" style={{ fontSize: 15 }}>/ {in12.eee === null ? "—" : `${number(in12.eee)}%`} / {in12.market === null ? "—" : `${number(in12.market)}%`}</span></div><div className="kpi-foot kpi-foot-static">{in12.market === null ? "" : `Mercado ${bp(in12.market, in12.inertial)} vs. regla`}{in12.market !== null && in12.eee !== null ? ` · ${bp(in12.market, in12.eee)} vs. EEE` : ""}</div></div>
      <div className="kpi"><div className="kpi-label">Brecha de actividad</div><div className="kpi-value">{signed(result.today.gap, 1)}%</div><div className="kpi-foot kpi-foot-static">Último desempleo {month(result.lastGap.month, true)}{result.meanAbsGap === null ? "" : ` · desvío medio TPM vs. regla ${number(result.meanAbsGap, 0)} pb`}</div></div>
    </div>

    <section className="model-chart-section" aria-label="Historia de la regla con la EEE">
      <div className="panel-head"><h2>Historia: TPM vs. regla con expectativas EEE</h2><span className="pill">% · mensual</span></div>
      <div className="model-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={result.history} margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
        <XAxis dataKey="date" tickFormatter={d => month(String(d))} minTickGap={50} tick={{ fontSize: 11 }} />
        <YAxis domain={["auto", "auto"]} tickFormatter={v => `${number(Number(v), 0)}%`} width={48} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v, name) => [`${number(Number(v))}%`, String(name)]} labelFormatter={v => month(String(v), true)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line dataKey="tpm" name="TPM (cierre mensual)" type="stepAfter" stroke="#172033" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="taylor" name="Regla EEE" stroke="#2f6fed" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="eeeTpm12" name="TPM esperada EEE a 12 meses" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
        <Line dataKey="expected" name={`Inflación esperada EEE ${horizonLabel}`} stroke="#0f9f6e" strokeWidth={1.25} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
      </ComposedChart></ResponsiveContainer></div>
    </section>

    <section className="model-chart-section" aria-label="Trayectoria a 12 meses">
      <div className="panel-head"><h2>Próximos 12 meses: regla vs. encuesta vs. mercado</h2><span className="pill">% · cierre de cada mes</span></div>
      <div className="model-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={projection} margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
        <XAxis dataKey="date" tickFormatter={d => month(String(d))} minTickGap={30} tick={{ fontSize: 11 }} />
        <YAxis domain={["auto", "auto"]} tickFormatter={v => `${number(Number(v), 1)}%`} width={52} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v, name) => [`${number(Number(v))}%`, String(name)]} labelFormatter={v => month(String(v), true)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line dataKey="tpm" name="TPM actual" stroke="#94a3b8" strokeDasharray="2 4" dot={false} isAnimationActive={false} />
        <Line dataKey="market" name="Mercado (swaps Cámara)" type="stepAfter" stroke="#172033" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
        <Line dataKey="inertial" name={`Regla con inercia (ρ = ${number(parameters.smoothing)})`} stroke="#2f6fed" strokeWidth={2.25} dot={false} isAnimationActive={false} />
        <Line dataKey="taylor" name="Regla sin inercia" stroke="#2f6fed" strokeWidth={1.25} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
        <Line dataKey="eee" name="TPM esperada EEE a 12 meses" stroke="#f59e0b" strokeWidth={0} dot={{ r: 5, fill: "#f59e0b" }} isAnimationActive={false} legendType="circle" />
      </ComposedChart></ResponsiveContainer></div>
    </section>

    <div className="model-notice">
      <strong>Cómo leerlo.</strong>
      <p><b>Inflación esperada</b>: mediana de la EEE a 24 meses (por defecto, el horizonte en que el Banco Central busca la meta) o a 12 meses. La de 24 meses casi siempre está en 3%, así que la regla queda guiada por la neutral y la brecha; la de 12 meses reacciona más al IPC del momento. <b>Brecha</b>: −Okun × (desempleo − NAIRU); para los meses sin desempleo publicado se cierra al ritmo de su AR(1) mensual. <b>Próximos 12 meses</b>: la expectativa se mantiene en el último dato de la encuesta y la trayectoria con inercia parte de la TPM actual, acercándose cada mes un {number(100 * (1 - parameters.smoothing), 0)}% a la regla. <b>Mercado</b>: TPM implícita en los swaps Cámara{data.marketSource ? ` (${data.marketSource})` : ""}. Escenario, no pronóstico.</p>
    </div>
  </div>;
}

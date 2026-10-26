"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TaylorForwardData } from "@/lib/market-models.server";
import { DEFAULT_TAYLOR_PARAMETERS } from "@/lib/taylor";
import { forwardTaylor } from "@/lib/taylor-forward";
import { controls } from "./TaylorModel";

const number = (value: number, digits = 2) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
const signed = (value: number, digits = 2) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${number(Math.abs(value), digits)}`;
const month = (date: string, long = false) => new Intl.DateTimeFormat("es-CL", { month: long ? "long" : "short", year: long ? "numeric" : "2-digit", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const day = (date: string) => new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

export function TaylorForwardModel({ data, gaps, nairu, okun }: { data: TaylorForwardData; gaps: Record<string, number> | null; nairu: number; okun: number }) {
  const [parameters, setParameters] = useState(DEFAULT_TAYLOR_PARAMETERS);
  const estimation = useMemo(() => {
    if ("error" in data) return { result: null, error: data.error };
    if (!gaps) return { result: null, error: "No hay brecha de actividad disponible." };
    try { return { result: forwardTaylor(data, gaps, parameters), error: null }; }
    catch (error) { return { result: null, error: error instanceof Error ? error.message : "No fue posible calcular la regla." }; }
  }, [data, gaps, parameters]);

  const intro = <div className="model-notice">
    <strong>Para qué sirve.</strong>
    <p>Indica <b>hacia dónde debería ir la TPM</b> según la inflación que se espera (no la pasada) y una brecha de actividad que se va cerrando, y lo compara con la TPM que paga el mercado en los swaps Cámara. Si la trayectoria de mercado queda sobre la de la regla, el mercado está cobrando más alzas (o menos recortes) de lo que justifican los fundamentales: favorece recibir tasa fija en la parte corta; si queda bajo, lo contrario.
      Es más útil que la regla tradicional porque el Banco Central decide mirando la inflación a 1–2 años.</p>
  </div>;

  const result = estimation.result;
  if ("error" in data || !result) return <div className="model-content">{intro}<div className="model-notice" role="alert">{estimation.error}</div></div>;

  const now = result.projection[0];
  // Punto de comparación: 12 meses adelante o el último mes con cotización de mercado.
  const withMarket = result.projection.filter(p => p.market !== null);
  const in12 = withMarket[Math.min(12, withMarket.length - 1)] ?? null;
  const gapDiff = in12 && in12.market !== null ? 100 * (in12.market - in12.inertial) : null;
  const lastBe = data.expectedHistory.at(-1);
  const chart = result.projection.map(p => ({ ...p, tpm: data.currentTpm }));
  const history = result.history;
  const table = result.projection.filter((_, i) => i % 3 === 0 || i === result.projection.length - 1);

  return <div className="model-content">
    {intro}
    <div className="model-intro">
      <p>Misma regla de la sección anterior, pero con <b>inflación esperada a 12 meses</b> (forwards de IPC de ICAP) y una <b>brecha de actividad proyectada</b> que se cierra según su persistencia histórica. La brecha parte del mismo supuesto de NAIRU ({number(nairu)}%) y Okun ({number(okun, 1)}) de la Regla de Taylor.</p>
      <span className="pill">Mercado: {data.marketSource}</span>
    </div>
    <div className="taylor-controls">
      {controls.map(control => <label key={control.key}>{control.label}<input type="number" step={control.step} min={control.min} max={control.max} value={parameters[control.key]} onChange={event => {
        if (event.currentTarget.value === "") return;
        const value = event.currentTarget.valueAsNumber;
        if (Number.isFinite(value) && value >= control.min && value <= control.max) setParameters(previous => ({ ...previous, [control.key]: value }));
      }} /></label>)}
      <button className="taylor-reset" onClick={() => setParameters(DEFAULT_TAYLOR_PARAMETERS)}>Restablecer</button>
    </div>

    <div className="kpi-grid">
      <div className="kpi"><div className="kpi-label">Taylor forward-looking · hoy</div><div className="kpi-value">{number(now.taylor)}%</div><div className="kpi-foot kpi-foot-static">{result.backwardToday === null ? "" : `Con IPC efectivo (${number(data.lastIpcYoy!.value, 1)}%): ${number(result.backwardToday)}%`} · TPM {number(data.currentTpm)}%</div></div>
      <div className="kpi"><div className="kpi-label">Inflación esperada 12 meses</div><div className="kpi-value">{number(now.expected)}%</div><div className="kpi-foot kpi-foot-static">Forwards ICAP {day(data.icapDate)}{lastBe ? ` · breakeven swap 1a ${number(lastBe.value)}%` : ""}</div></div>
      <div className="kpi"><div className="kpi-label">TPM en {in12 ? month(in12.date) : "—"}: regla vs. mercado</div><div className="kpi-value">{in12 ? `${number(in12.inertial)}%` : "—"} <span className="muted" style={{ fontSize: 15 }}>/ {in12 && in12.market !== null ? `${number(in12.market)}%` : "—"}</span></div><div className="kpi-foot kpi-foot-static">{gapDiff === null ? "" : gapDiff > 0 ? `Mercado ${number(gapDiff, 0)} pb sobre la regla` : `Mercado ${number(-gapDiff, 0)} pb bajo la regla`}</div></div>
      <div className="kpi"><div className="kpi-label">Brecha de actividad</div><div className="kpi-value">{signed(now.gap, 1)}%</div><div className="kpi-foot kpi-foot-static">Último dato {month(result.lastGap.month, true)} · vida media {result.gapHalfLifeMonths === null ? "—" : `${number(result.gapHalfLifeMonths, 0)} meses`}</div></div>
    </div>

    <section className="model-chart-section" aria-label="Trayectoria de la regla y del mercado">
      <div className="panel-head"><h2>Trayectoria de TPM: regla forward-looking vs. mercado</h2><span className="pill">% · cierre de cada mes</span></div>
      <div className="model-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chart} margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
        <XAxis dataKey="date" tickFormatter={d => month(String(d))} minTickGap={30} tick={{ fontSize: 11 }} />
        <YAxis domain={["auto", "auto"]} tickFormatter={v => `${number(Number(v), 1)}%`} width={52} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v, name) => [`${number(Number(v))}%`, String(name)]} labelFormatter={v => month(String(v), true)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line dataKey="tpm" name="TPM actual" stroke="#94a3b8" strokeDasharray="2 4" dot={false} isAnimationActive={false} />
        <Line dataKey="market" name="Mercado (swaps Cámara)" type="stepAfter" stroke="#172033" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
        <Line dataKey="inertial" name={`Regla con inercia (ρ = ${number(parameters.smoothing)})`} stroke="#f59e0b" strokeWidth={2.25} dot={false} isAnimationActive={false} />
        <Line dataKey="taylor" name="Regla sin inercia" stroke="#2f6fed" strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
      </ComposedChart></ResponsiveContainer></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Mes</th><th>Inflación esperada 12m</th><th>Brecha</th><th>Regla sin inercia</th><th>Regla con inercia</th><th>Mercado</th><th>Mercado − regla</th></tr></thead>
        <tbody>{table.map(p => <tr key={p.date}>
          <td className="strong">{month(p.date, true)}</td><td>{number(p.expected)}%</td><td>{signed(p.gap, 1)}%</td><td>{number(p.taylor)}%</td><td>{number(p.inertial)}%</td>
          <td>{p.market === null ? "—" : `${number(p.market)}%`}</td>
          <td className={p.market === null ? "muted" : ""}>{p.market === null ? "—" : `${signed(100 * (p.market - p.inertial), 0)} pb`}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="model-chart-section" aria-label="Historia de la regla forward-looking">
      <div className="panel-head"><h2>Historia: TPM vs. regla forward-looking (provisoria)</h2><span className="pill">Expectativa: {data.expectedHistorySource}</span></div>
      <div className="model-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={history} margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
        <XAxis dataKey="date" tickFormatter={d => month(String(d))} minTickGap={50} tick={{ fontSize: 11 }} />
        <YAxis domain={["auto", "auto"]} tickFormatter={v => `${number(Number(v), 0)}%`} width={48} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v, name) => [`${number(Number(v))}%`, String(name)]} labelFormatter={v => month(String(v), true)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line dataKey="tpm" name="TPM (cierre mensual)" type="stepAfter" stroke="#172033" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="taylor" name="Regla forward-looking" stroke="#2f6fed" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="expected" name="Inflación esperada (breakeven swap 1a)" stroke="#0f9f6e" strokeWidth={1.25} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
      </ComposedChart></ResponsiveContainer></div>
    </section>

    <div className="model-notice">
      <strong>Cómo leerlo.</strong>
      <p><b>Regla</b>: TPM neutral + (1 + peso de inflación) × (inflación esperada 12 meses − meta) + peso de actividad × brecha. <b>Inflación esperada</b>: variación compuesta del IPC de los 12 meses siguientes según los forwards de ICAP; si el último IPC publicado aún no cubre algún mes, se completa con su forward. <b>Brecha</b>: −Okun × (desempleo − NAIRU) del último dato, que se cierra al ritmo de su AR(1) mensual de los últimos 10 años. <b>Con inercia</b>: parte de la TPM actual y se acerca cada mes un {number(100 * (1 - parameters.smoothing), 0)}% a la regla. <b>Mercado</b>: TPM implícita en los swaps Cámara al cierre de cada mes, hasta donde llegan los plazos cotizados.
        <b> Historia provisoria</b>: mientras no se incorpore la Encuesta de Expectativas Económicas, la inflación esperada histórica es el breakeven swap Cámara a 1 año (CLP vs. UF), que incluye primas por riesgo y liquidez y es más volátil que una encuesta; en 2022 llegó a 9%. Los forwards de ICAP también incluyen primas. Escenario, no pronóstico.</p>
    </div>
  </div>;
}

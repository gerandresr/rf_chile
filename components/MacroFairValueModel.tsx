"use client";

import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MacroFairValueData } from "@/lib/market-models.server";

const number = (value: number, digits = 2) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
const signed = (value: number, digits = 1) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${number(Math.abs(value), digits)}`;
const day = (date: string) => new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const month = (date: string) => new Intl.DateTimeFormat("es-CL", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const SIGNAL = 1;

export function MacroFairValueModel({ data }: { data: MacroFairValueData }) {
  const [type, setType] = useState<"BTP" | "BTU">("BTP");
  const model = "error" in data ? null : data[type];
  const history = useMemo(() => (model && !("error" in model) ? model.history.map(h => ({ ...h, band: [h.low, h.high] as [number, number] })) : []), [model]);

  const intro = <div className="model-notice">
    <strong>Para qué sirve.</strong>
    <p>Responde <b>cuánta duración tener</b>: si el nivel de la tasa a 10 años está alto o bajo respecto de lo que justifican sus fundamentales (TPM, Treasury 10 años, riesgo país, cobre y tipo de cambio). Es una señal <b>direccional</b> para toda la curva y de horizonte más largo: las brechas suelen corregirse en semanas o meses.
      Se complementa con el modelo de valor relativo, que responde <b>qué bono</b> tener dentro de la curva sin importar si las tasas suben o bajan.</p>
  </div>;

  const selector = <div className="segmented" role="group" aria-label="Tasa" style={{ flexShrink: 0 }}>
    {(["BTP", "BTU"] as const).map(t => <button key={t} className={t === type ? "selected" : ""} aria-pressed={t === type} onClick={() => setType(t)}>{t} 10</button>)}
  </div>;

  if ("error" in data || !model || "error" in model) return <div className="model-content">{intro}<div className="model-controls" style={{ marginTop: 0, marginBottom: 16 }}>{selector}</div><div className="model-notice" role="alert">{"error" in data ? data.error : model && "error" in model ? model.error : "Sin datos."}</div></div>;

  const reading = model.z >= SIGNAL ? { text: "Barata: tasa sobre su valor justo", cls: "good" } : model.z <= -SIGNAL ? { text: "Cara: tasa bajo su valor justo", cls: "bad" } : { text: "En torno a su valor justo", cls: "muted" };
  const rate = type === "BTP" ? "BTP 10 años (nominal)" : "BTU 10 años (real)";

  return <div className="model-content">
    {intro}
    <div className="model-intro">
      <p>Valor justo de la tasa {rate} de la curva NSS: regresión contra los fundamentales en una ventana móvil de 2 años que termina en cada fecha, así cada punto usa solo la información disponible ese día. El <b>residuo</b> es la señal; positivo significa tasa alta (bono barato).</p>
      {selector}
    </div>

    <div className="kpi-grid">
      <div className="kpi"><div className="kpi-label">{type} 10 · observada vs. justa</div><div className="kpi-value">{number(model.actual)}% <span className="muted" style={{ fontSize: 15 }}>/ {number(model.fair)}%</span></div><div className="kpi-foot kpi-foot-static">Datos al {day(model.date)}</div></div>
      <div className="kpi"><div className="kpi-label">Desvío del valor justo</div><div className={`kpi-value ${reading.cls}`}>{signed(model.residualBp)} pb</div><div className="kpi-foot kpi-foot-static">z {signed(model.z, 2)} · {reading.text}</div></div>
      <div className="kpi"><div className="kpi-label">Vida media del desvío</div><div className="kpi-value">{model.halfLifeDays === null ? "—" : `${number(model.halfLifeDays, 0)} días`}</div><div className="kpi-foot kpi-foot-static">Días hábiles para corregir la mitad (AR(1))</div></div>
      <div className="kpi"><div className="kpi-label">Calidad del ajuste</div><div className="kpi-value">R² {number(model.r2, 2)}</div><div className="kpi-foot kpi-foot-static">Error típico ±{number(model.residualSdBp, 0)} pb · ventana {model.window} días</div></div>
    </div>

    <section className="model-chart-section" aria-label={`Fair value ${type} 10 años`}>
      <div className="panel-head"><h2>{type} 10 años: observada vs. valor justo</h2><span className="pill">% · banda ±1 error típico</span></div>
      <div className="chart-box"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={history} margin={{ top: 10, right: 12, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
        <XAxis dataKey="date" tickFormatter={v => month(String(v))} minTickGap={40} tick={{ fontSize: 11 }} />
        <YAxis domain={["auto", "auto"]} tickFormatter={v => `${number(Number(v), 1)}%`} width={52} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v, name) => [Array.isArray(v) ? `${number(Number(v[0]))}% – ${number(Number(v[1]))}%` : `${number(Number(v), 3)}%`, String(name)]} labelFormatter={v => day(String(v))} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Area dataKey="band" name="Banda ±1 error típico" fill="#f59e0b" fillOpacity={0.12} stroke="none" isAnimationActive={false} />
        <Line dataKey="fair" name="Valor justo" stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
        <Line dataKey="actual" name={`${type} 10 observada`} stroke="#2f6fed" strokeWidth={2} dot={false} isAnimationActive={false} />
      </ComposedChart></ResponsiveContainer></div>
    </section>

    <section className="model-chart-section" aria-label="Qué movió la tasa">
      <div className="panel-head"><h2>Qué movió la tasa en el último mes</h2><span className="pill">{signed(model.actualChangeBp)} pb observados</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Factor</th><th>Sensibilidad</th><th>t (Newey-West)</th><th>Cambio del factor</th><th>Aporte a la tasa</th></tr></thead>
        <tbody>
          {model.coefficients.map((c, i) => {
            const k = model.contributions[i];
            return <tr key={c.key}>
              <td className="strong">{c.label}</td>
              <td>{signed(c.bp)} pb <span className="muted">{c.unit}</span></td>
              <td className={c.tStat !== null && Math.abs(c.tStat) >= 2 ? "strong" : "muted"}>{c.tStat === null ? "—" : signed(c.tStat, 1)}</td>
              <td>{signed(k.change, k.changeUnit === "%" ? 1 : 0)} {k.changeUnit}</td>
              <td className={k.bp > 0.5 ? "bad" : k.bp < -0.5 ? "good" : ""}>{signed(k.bp)} pb</td>
            </tr>;
          })}
          <tr><td className="strong">Desvío propio (no explicado)</td><td /><td /><td /><td>{signed(model.residualChangeBp)} pb</td></tr>
        </tbody>
      </table></div>
    </section>

    <div className="model-notice">
      <strong>Cómo leerlo.</strong>
      <p><b>Valor justo</b>: tasa a 10 años de la curva NSS explicada por TPM, Treasury 10 años, CDS de Chile a 5 años, cobre y USD/CLP (estos dos en logaritmos), estimada con los últimos 504 días hábiles y reestimada cada semana. <b>Desvío</b>: tasa observada menos valor justo; |z| ≥ {number(SIGNAL, 0)} error típico se marca como barata o cara. <b>Vida media</b>: cuánto tarda en corregirse la mitad de un desvío según su persistencia.
        <b> Sensibilidad</b>: pb que se mueve la tasa por cada unidad del factor; |t| ≥ 2 indica un efecto estadísticamente claro (errores robustos a autocorrelación). <b>Aporte</b>: cambio del factor en el mes por su sensibilidad actual; el resto es el desvío propio de la tasa. En verde los aportes que bajaron la tasa.
        <b> Validación</b>: en la historia en tiempo real, cuando el desvío superó 1 error típico la tasa se movió hacia el valor justo en el mes siguiente el {model.backtest.hitRate === null ? "—" : `${number(model.backtest.hitRate, 0)}%`} de las veces ({model.backtest.signals} señales semanales, movimiento medio a favor {model.backtest.avgMoveBp === null ? "—" : `${signed(model.backtest.avgMoveBp)} pb`}).
        Los coeficientes cambian con el régimen y la relación no es causal; usar como contexto para la duración, no como recomendación.</p>
    </div>
  </div>;
}

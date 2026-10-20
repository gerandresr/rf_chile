"use client";

import { useMemo, useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { NairuResult } from "@/lib/nairu";

export type NairuEstimate = { result: NairuResult | null; error: string | null };
type View = "smoothed" | "filtered";

const number = (value: number, digits = 2) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
const signed = (value: number, digits = 2) => `${value > 0 ? "+" : ""}${number(value, digits)}`;
function month(date: string, short = false) {
  return new Intl.DateTimeFormat("es-CL", { month: short ? "short" : "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

export function NairuModel({ estimate }: { estimate: NairuEstimate }) {
  const [view, setView] = useState<View>("smoothed");
  const result = estimate.result;
  const rows = useMemo(() => result?.points.map((point) => {
    const natural = point[view], lower = point[`${view}Lower`], upper = point[`${view}Upper`];
    return {
      date: point.date, published: point.unemployment, adjusted: point.unemploymentSa,
      natural, lower, upper, band: [lower, upper] as [number, number],
      gap: point.unemploymentSa - natural,
      outputGap: view === "smoothed" ? point.outputGapSmoothed : point.outputGapFiltered,
    };
  }) ?? [], [result, view]);
  if (!result || !rows.length) return <div className="model-content"><div className="model-notice" role="alert">{estimate.error ?? "Sin datos disponibles."}</div></div>;

  const latest = rows[rows.length - 1];
  const conclusive = latest.adjusted > latest.upper || latest.adjusted < latest.lower;
  const reading = !conclusive ? "Dentro de la banda: brecha no concluyente" : latest.gap > 0 ? "Holgura en el mercado laboral" : "Mercado laboral estrecho";
  const p = result.parameters;
  const twelveAgo = rows.length > 12 ? rows[rows.length - 13] : null;

  return (
    <div className="model-content">
      <div className="model-intro">
        <p>
          Separa el desempleo en una <strong>tendencia</strong> (tasa natural) y un <strong>ciclo</strong>, usando que el ciclo del desempleo
          se mueve junto con la brecha de actividad del IMACEC (ley de Okun). La tasa natural es la que prevalecería con la economía en su potencial.
        </p>
        <span className="pill">{month(result.start, true)} – {month(result.end, true)} · {result.points.length} meses</span>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Tasa natural estimada</div>
          <div className="kpi-value">{number(latest.natural)}%</div>
          <div className="kpi-foot kpi-foot-static">Banda 95%: {number(latest.lower, 1)}% – {number(latest.upper, 1)}%</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Desempleo desestacionalizado</div>
          <div className="kpi-value">{number(latest.adjusted)}%</div>
          <div className="kpi-foot kpi-foot-static">Publicado: {number(latest.published)}% · {month(latest.date)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Brecha de desempleo</div>
          <div className="kpi-value">{signed(latest.gap)} pp</div>
          <div className="kpi-foot kpi-foot-static">{reading}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Brecha de actividad implícita</div>
          <div className="kpi-value">{signed(latest.outputGap, 1)}%</div>
          <div className="kpi-foot kpi-foot-static">IMACEC vs. tendencia</div>
        </div>
      </div>

      <div className="model-controls">
        <div className="segmented" role="group" aria-label="Tipo de estimación">
          <button className={view === "smoothed" ? "selected" : ""} aria-pressed={view === "smoothed"} onClick={() => setView("smoothed")}>Suavizada</button>
          <button className={view === "filtered" ? "selected" : ""} aria-pressed={view === "filtered"} onClick={() => setView("filtered")}>Filtrada</button>
        </div>
        {twelveAgo && <span className="pill">Tasa natural hace 12 meses: {number(twelveAgo.natural)}% ({signed(latest.natural - twelveAgo.natural)} pp)</span>}
      </div>
      <p className="model-caption">
        {view === "smoothed"
          ? "La suavizada usa toda la muestra: revisa el pasado con información posterior. Es la mejor lectura histórica."
          : "La filtrada usa solo la información disponible hasta cada mes (con parámetros de toda la muestra). Es la lectura que se tenía en tiempo real y la que se revisa con datos nuevos."}
      </p>

      <section className="model-chart-section" aria-label="Gráfico de desempleo y tasa natural">
        <div className="panel-head"><h2>Desempleo y tasa natural</h2><span className="pill">%</span></div>
        <div className="model-chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
              <XAxis dataKey="date" tickFormatter={(date) => month(date, true)} minTickGap={65} tick={{ fontSize: 11 }} />
              <YAxis domain={["auto", "auto"]} tickFormatter={(value) => `${number(value, 1)}%`} width={58} tick={{ fontSize: 11 }} />
              <Tooltip content={({ active, payload }) => {
                const point = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                if (!active || !point) return null;
                return <div className="curve-tooltip">
                  <div className="curve-tooltip-title">{month(point.date)}</div>
                  <div>Desempleo desest.: {number(point.adjusted)}%</div>
                  <div>Desempleo publicado: {number(point.published)}%</div>
                  <div>Tasa natural: {number(point.natural)}% ({number(point.lower, 1)} – {number(point.upper, 1)})</div>
                  <div>Brecha: {signed(point.gap)} pp</div>
                </div>;
              }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area dataKey="band" name="Banda 95% tasa natural" type="linear" fill="#2f6fed" fillOpacity={0.12} stroke="none" isAnimationActive={false} />
              <Line dataKey="published" name="Desempleo publicado" stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
              <Line dataKey="adjusted" name="Desempleo desestacionalizado" stroke="#172033" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="natural" name="Tasa natural" stroke="#2f6fed" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="model-chart-section" aria-label="Gráfico de brecha de desempleo">
        <div className="panel-head"><h2>Brecha de desempleo</h2><span className="pill">Desempleo desest. − tasa natural · pp</span></div>
        <p className="model-caption">Positiva (azul): holgura laboral, presiona la inflación a la baja. Negativa (rojo): mercado laboral estrecho. La caída de 2020 fue un shock de la pandemia, no un ciclo normal.</p>
        <div className="model-gap-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 10, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
              <XAxis dataKey="date" tickFormatter={(date) => month(date, true)} minTickGap={65} tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(value) => number(value, 1)} width={58} tick={{ fontSize: 11 }} />
              <ReferenceLine y={0} stroke="#748096" />
              <Tooltip labelFormatter={(date) => month(String(date))} formatter={(value) => [`${signed(Number(value))} pp`, "Brecha"]} />
              <Bar dataKey="gap" isAnimationActive={false}>{rows.map((row) => <Cell key={row.date} fill={row.gap >= 0 ? "#2f6fed" : "#d94b4b"} fillOpacity={0.75} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="model-chart-section" aria-label="Parámetros estimados">
        <div className="panel-head"><h2>Parámetros estimados</h2><span className="pill">Máxima verosimilitud</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Parámetro</th><th>Valor</th><th style={{ textAlign: "left" }}>Lectura</th></tr></thead>
            <tbody>
              <tr><td>Coeficiente de Okun</td><td>{number(p.okun)}</td><td style={{ textAlign: "left", whiteSpace: "normal" }}>1 pp de desempleo cíclico ≈ {number(p.okun, 1)}% de brecha de actividad</td></tr>
              <tr><td>Vida media del ciclo</td><td>{p.cycleHalfLife} meses</td><td style={{ textAlign: "left", whiteSpace: "normal" }}>Tiempo para que un shock al desempleo se reduzca a la mitad</td></tr>
              <tr><td>Volatilidad de la tasa natural</td><td>{number(p.trendSd, 3)} pp/mes</td><td style={{ textAlign: "left", whiteSpace: "normal" }}>≈ {number(p.trendSd * Math.sqrt(12), 2)} pp por año en una desviación estándar</td></tr>
              <tr><td>Shock mensual del ciclo</td><td>{number(p.cycleSd, 3)} pp</td><td style={{ textAlign: "left", whiteSpace: "normal" }}>Persistencia AR(2): φ₁ = {number(p.phi1)}, φ₂ = {number(p.phi2)}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <div className="model-notice">
        <strong>Cómo leerlo.</strong>
        <p>El desempleo publicado es un promedio móvil trimestral sin ajuste estacional; aquí se desestacionaliza con factores mensuales fijos (excluyendo la pandemia) antes de estimar.
          La banda es condicional a los parámetros estimados. No se usa una curva de Phillips: en esta muestra la relación entre desempleo e inflación no es estadísticamente detectable
          (la inflación de 2021–2023 respondió más a shocks de oferta, tipo de cambio y liquidez que a la holgura laboral), por lo que un filtro basado en inflación queda fijo en su valor inicial.
          Las estimaciones independientes recientes para Chile se ubican en torno a 8,5%–9%.</p>
      </div>
    </div>
  );
}

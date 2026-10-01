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
  const [stateSd, setStateSd] = useState(0.05);
  const estimation = useMemo(() => {
    try { return { result: estimateNairu(monthlyData, stateSd), error: null }; }
    catch (error) { return { result: null, error: error instanceof Error ? error.message : "No fue posible estimar el modelo." }; }
  }, [stateSd]);
  const result = estimation.result;
  const chartRows = useMemo(() => result?.points.map((point) => {
    const nairu = point[view], lower = point[`${view}Lower`], upper = point[`${view}Upper`];
    return { ...point, nairu, lower, upper, band: [lower, upper], gap: point.unemployment - nairu };
  }) ?? [], [result, view]);
  if (!result || !chartRows.length) return <div className="model-notice" role="alert">{estimation.error ?? "Sin datos disponibles."}</div>;
  const latest = chartRows[chartRows.length - 1];
  const conclusive = latest.unemployment > latest.upper || latest.unemployment < latest.lower;
  const reading = !conclusive ? "Brecha no concluyente" : latest.gap > 0 ? "Holgura laboral estimada" : "Mercado laboral ajustado según el modelo";
  const p = result.parameters;
  return (
    <div className="model-content">
      <div className="model-intro">
        <p>Estima una tasa de desempleo compatible con una inflación que no acelera, a partir de desempleo e inflación anual de Chile.</p>
        <span className="pill">Experimental · {result.observations} meses</span>
      </div>
      <div className="model-notice">
        <strong>{result.weakSignal ? "Señal de Phillips débil" : "Estimación experimental"}</strong>
        <p>{result.weakSignal ? "En esta muestra, la inflación aporta poca información sobre la NAIRU. El resultado depende mucho del nivel inicial y de los supuestos del modelo." : "La NAIRU es una variable no observable. Su estimación cambia con los datos y con los supuestos del modelo."} La banda refleja incertidumbre del estado con parámetros fijos; la incertidumbre total puede ser mayor.</p>
      </div>

      <div className="kpi-grid model-kpi-grid">
        <div className="kpi"><div className="kpi-label">NAIRU estimada</div><div className="kpi-value">{number(latest.nairu)}%</div><div className="kpi-foot kpi-foot-static">Dato {month(latest.date)}</div></div>
        <div className="kpi"><div className="kpi-label">Desempleo observado</div><div className="kpi-value">{number(latest.unemployment)}%</div><div className="kpi-foot kpi-foot-static">Dato {month(latest.date)}</div></div>
        <div className="kpi"><div className="kpi-label">Brecha de desempleo</div><div className="kpi-value">{latest.gap > 0 ? "+" : ""}{number(latest.gap)} pp</div><div className="kpi-foot kpi-foot-static">{reading}</div></div>
        <div className="kpi"><div className="kpi-label">Banda condicional del 95%</div><div className="kpi-value model-band-value">{number(latest.lower)}% – {number(latest.upper)}%</div><div className="kpi-foot kpi-foot-static">Incertidumbre del estado</div></div>
      </div>

      <div className="model-controls">
        <div className="segmented" role="group" aria-label="Tipo de estimación">
          <button className={view === "smoothed" ? "selected" : ""} aria-pressed={view === "smoothed"} onClick={() => setView("smoothed")}>Suavizada</button>
          <button className={view === "filtered" ? "selected" : ""} aria-pressed={view === "filtered"} onClick={() => setView("filtered")}>Filtrada</button>
        </div>
        <label className="model-sensitivity">Variación de NAIRU
          <select value={stateSd} onChange={(event) => setStateSd(Number(event.target.value))}>
            <option value={0.025}>Lenta · 0,025 pp/mes</option>
            <option value={0.05}>Base · 0,050 pp/mes</option>
            <option value={0.1}>Flexible · 0,100 pp/mes</option>
          </select>
        </label>
      </div>
      <p className="model-caption">{view === "smoothed" ? "La estimación suavizada utiliza toda la muestra y revisa el pasado con información posterior." : "El filtro actualiza el estado hacia adelante. Los parámetros y el nivel inicial se calibran con información de la muestra: esta vista no reproduce estimaciones en tiempo real."} La selección de variación indica la desviación estándar mensual del estado.</p>

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
              <Tooltip labelFormatter={(date) => month(String(date))} formatter={(value) => [`${number(Number(value))} pp`, "Brecha"]} />
              <Bar dataKey="gap" isAnimationActive={false}>{chartRows.map((row) => <Cell key={row.date} fill={row.gap >= 0 ? "#2f6fed" : "#d94b4b"} fillOpacity={0.7} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <details className="model-methodology">
        <summary>Metodología y supuestos</summary>
        <div className="model-methodology-body">
          <p>Curva de Phillips con inflación anual y un rezago de su cambio mensual. La NAIRU sigue un paseo aleatorio:</p>
          <div className="model-equation">Δπₜ = ρ Δπₜ₋₁ − κ (uₜ − NAIRUₜ) + εₜ<br />NAIRUₜ = NAIRUₜ₋₁ + ηₜ</div>
          <p>π es inflación YoY en porcentaje; u y NAIRU son tasas de desempleo en porcentaje. Δπ es el cambio mensual de la inflación anual, en puntos porcentuales. Se omite una constante libre porque se confundiría con el nivel de la NAIRU.</p>
          <p>Se ajustan κ, ρ y la desviación del error de inflación por máxima verosimilitud del filtro de Kalman mediante búsqueda numérica con varios puntos iniciales. La variación mensual de la NAIRU es un supuesto seleccionable. La estimación suavizada aplica el suavizador de Rauch–Tung–Striebel.</p>
          <div className="table-wrap"><table className="model-parameter-table"><thead><tr><th>Parámetro</th><th>Valor</th></tr></thead><tbody>
            <tr><td>Sensibilidad de inflación a la brecha · κ</td><td>{number(p.kappa, 5)}</td></tr>
            <tr><td>Persistencia del cambio de inflación · ρ</td><td>{number(p.rho, 4)}</td></tr>
            <tr><td>Desviación del error de inflación</td><td>{number(p.observationSd, 4)} pp</td></tr>
            <tr><td>Desviación mensual de NAIRU · supuesto</td><td>{number(p.stateSd, 3)} pp</td></tr>
            <tr><td>Nivel inicial · media de primeros 12 meses</td><td>{number(p.initialMean)}%</td></tr>
            <tr><td>Desviación inicial · supuesto</td><td>{number(p.initialSd)} pp</td></tr>
            <tr><td>Autocorrelación residual · un mes</td><td>{number(result.residualAutocorrelation, 3)}</td></tr>
          </tbody></table></div>
          <p>Fuente: <code>datos-mensuales.json</code>, columnas <code>fecha</code>, <code>desempleo</code> e <code>ipc_yoy</code>. Hay {result.observations} meses conjuntos y {chartRows.length} observaciones utilizables después de construir los cambios y el rezago. Actualizar ese JSON y desplegar la página recalcula el modelo.</p>
          <p>La banda del 95% es NAIRU ± 1,96 desviaciones del estado, condicionada a los parámetros y supuestos. No incluye incertidumbre de parámetros ni de especificación. Las observaciones YoY se solapan; un rezago no garantiza eliminar la correlación de los errores. Esta versión no incorpora expectativas, shocks de oferta, estacionalidad ni cambios metodológicos del desempleo. Los datos se usan tal como fueron entregados.</p>
          <p>“Señal débil” indica κ inferior a 0,03; es un umbral diagnóstico de esta versión, no un test de significancia. “Brecha no concluyente” significa que el desempleo observado queda dentro de la banda de NAIRU.</p>
          {result.warnings.filter((warning) => !warning.startsWith("Señal")).map((warning) => <p key={warning}>{warning}</p>)}
          <p>Referencias metodológicas: <a href="https://www.rba.gov.au/publications/bulletin/2017/jun/2.html" target="_blank" rel="noreferrer">RBA: estimación de NAIRU e incertidumbre</a> · <a href="https://www.rba.gov.au/publications/rdp/1999/1999-01/appendix-d.html" target="_blank" rel="noreferrer">RBA: aspectos técnicos del filtro de Kalman</a>. Esta implementación es una especificación simplificada propia, no una reproducción del modelo del RBA ni una estimación oficial de Chile.</p>
        </div>
      </details>

      <details className="model-methodology">
        <summary>Últimos 12 meses</summary>
        <div className="table-wrap"><table><thead><tr><th>Mes</th><th>Desempleo</th><th>Inflación YoY</th><th>NAIRU</th><th>Brecha · pp</th><th>Banda 95%</th></tr></thead><tbody>
          {chartRows.slice(-12).reverse().map((row) => <tr key={row.date}><td>{month(row.date)}</td><td>{number(row.unemployment)}%</td><td>{number(row.inflation)}%</td><td>{number(row.nairu)}%</td><td>{row.gap > 0 ? "+" : ""}{number(row.gap)}</td><td>{number(row.lower)}% – {number(row.upper)}%</td></tr>)}
        </tbody></table></div>
      </details>
    </div>
  );
}

export function ModelsDashboard() {
  const [open, setOpen] = useState(false);
  return <AppShell>
    <header className="page-head"><div><div className="eyebrow">Trading Propietario</div><h1>Modelos</h1><p>Selecciona un modelo para consultar sus resultados y metodología.</p></div></header>
    <details className="panel model-disclosure" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><span>NAIRU · Filtro de Kalman</span><ChevronDown size={20} aria-hidden="true" /></summary>
      {open && <NairuModel />}
    </details>
  </AppShell>;
}

"use client";

import { useMemo, useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PhillipsFit } from "@/lib/nairu-phillips";
import type { PhillipsModelData } from "@/lib/nairu-phillips.server";

type View = "smoothed" | "filtered";
const number = (value: number, digits = 2) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
const signed = (value: number, digits = 2) => `${value > 0 ? "+" : ""}${number(value, digits)}`;
const quarter = (date: string) => `${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}T ${date.slice(0, 4)}`;

export function NairuPhillipsModel({ data }: { data: PhillipsModelData }) {
  const [choice, setChoice] = useState<"ml" | number>("ml");
  const [view, setView] = useState<View>("smoothed");
  const result = "error" in data ? null : data;
  const fit: PhillipsFit | null = !result ? null : choice === "ml" ? result.ml : result.grid.find(g => g.kappa === choice) ?? result.ml;
  const rows = useMemo(() => fit?.points.map(p => {
    const natural = view === "smoothed" ? p.nairu : p.nairuFiltered;
    const half = (p.upper - p.lower) / 2;
    return { date: p.date, u: p.u, natural, band: view === "smoothed" ? [p.lower, p.upper] as [number, number] : undefined, lower: p.nairu - half, upper: p.nairu + half,
      gap: typeof p.u === "number" ? p.u - natural : null, pi: p.pi, pe: p.pe };
  }) ?? [], [fit, view]);
  if (!result || !fit) return <div className="model-content"><div className="model-notice" role="alert">{"error" in data ? data.error : "Sin datos."}</div></div>;

  const latest = [...rows].reverse().find(r => typeof r.u === "number")!;
  const gap = latest.gap ?? 0;
  const conclusive = (latest.u ?? 0) > latest.upper || (latest.u ?? 0) < latest.lower;
  const reading = !conclusive ? "Dentro de la banda: brecha no concluyente" : gap > 0 ? "Holgura laboral: presiona la inflación a la baja" : "Mercado laboral estrecho: presiona la inflación al alza";
  const yearAgo = rows[rows.indexOf(latest) - 4];
  const [kLow, kHigh] = result.kappaInterval;

  return <div className="model-content">
    <div className="model-intro">
      <p>
        La <strong>NAIRU</strong> es la tasa de desempleo que no acelera ni desacelera la inflación. Se estima con una <strong>curva de Phillips</strong>:
        la inflación se desvía de las expectativas cuando el desempleo está por debajo (presión al alza) o por encima (presión a la baja) de la NAIRU,
        controlando por la depreciación del peso. La NAIRU se deja variar lentamente en el tiempo (filtro de Kalman).
      </p>
      <span className="pill">{quarter(result.start)} – {quarter(result.end)} · trimestral</span>
    </div>

    <div className="kpi-grid">
      <div className="kpi">
        <div className="kpi-label">NAIRU estimada</div>
        <div className="kpi-value">{number(latest.natural)}%</div>
        <div className="kpi-foot kpi-foot-static">Banda 90%: {number(latest.lower, 1)}% – {number(latest.upper, 1)}%</div>
      </div>
      <div className="kpi">
        <div className="kpi-label">Desempleo desestacionalizado</div>
        <div className="kpi-value">{number(latest.u ?? 0)}%</div>
        <div className="kpi-foot kpi-foot-static">Promedio {quarter(latest.date)}</div>
      </div>
      <div className="kpi">
        <div className="kpi-label">Brecha de desempleo</div>
        <div className="kpi-value">{signed(gap)} pp</div>
        <div className="kpi-foot kpi-foot-static">{reading}</div>
      </div>
      <div className="kpi">
        <div className="kpi-label">Efecto sobre la inflación</div>
        <div className="kpi-value">{signed(-fit.kappa * gap)} pp</div>
        <div className="kpi-foot kpi-foot-static">−κ × brecha, en el IPC a 12 meses de cada trimestre</div>
      </div>
    </div>

    <div className="model-controls">
      <div className="segmented" role="group" aria-label="Pendiente de la curva de Phillips">
        <button className={choice === "ml" ? "selected" : ""} aria-pressed={choice === "ml"} onClick={() => setChoice("ml")}>Estimada κ = {number(result.ml.kappa)}</button>
        {result.grid.map(g => <button key={g.kappa} className={choice === g.kappa ? "selected" : ""} aria-pressed={choice === g.kappa} onClick={() => setChoice(g.kappa)}>{number(g.kappa, 1)}</button>)}
      </div>
      <div className="segmented" role="group" aria-label="Tipo de estimación">
        <button className={view === "smoothed" ? "selected" : ""} aria-pressed={view === "smoothed"} onClick={() => setView("smoothed")}>Suavizada</button>
        <button className={view === "filtered" ? "selected" : ""} aria-pressed={view === "filtered"} onClick={() => setView("filtered")}>Filtrada</button>
      </div>
      {yearAgo && <span className="pill">Hace 4 trimestres: {number(yearAgo.natural)}% ({signed(latest.natural - yearAgo.natural)} pp)</span>}
    </div>
    <p className="model-caption">
      κ es la pendiente: cuántos pp sube la inflación por cada pp de desempleo bajo la NAIRU. Los datos no la precisan bien (intervalo 90%: {number(kLow, 1)} a {number(kHigh, 1)}),
      por eso puedes fijarla y ver cómo cambia la NAIRU. {view === "smoothed" ? "La suavizada usa toda la muestra (mejor lectura histórica)." : "La filtrada usa solo la información disponible en cada trimestre (lectura en tiempo real)."}
    </p>

    <section className="model-chart-section" aria-label="Gráfico de desempleo y NAIRU">
      <div className="panel-head"><h2>Desempleo y NAIRU</h2><span className="pill">%</span></div>
      <div className="model-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
            <XAxis dataKey="date" tickFormatter={quarter} minTickGap={50} tick={{ fontSize: 11 }} />
            <YAxis domain={["auto", "auto"]} tickFormatter={v => `${number(v, 1)}%`} width={58} tick={{ fontSize: 11 }} />
            <ReferenceLine x={result.excluded[0]} stroke="#cbd5e1" />
            <Tooltip content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof rows)[number] | undefined;
              if (!active || !p) return null;
              return <div className="curve-tooltip">
                <div className="curve-tooltip-title">{quarter(p.date)}</div>
                {typeof p.u === "number" && <div>Desempleo desest.: {number(p.u)}%</div>}
                <div>NAIRU: {number(p.natural)}%{view === "smoothed" && ` (${number(p.lower, 1)} – ${number(p.upper, 1)})`}</div>
                {p.gap !== null && <div>Brecha: {signed(p.gap)} pp</div>}
              </div>;
            }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {view === "smoothed" && <Area dataKey="band" name="Banda 90% NAIRU" type="linear" fill="#2f6fed" fillOpacity={0.12} stroke="none" isAnimationActive={false} />}
            <Line dataKey="u" name="Desempleo desestacionalizado" stroke="#172033" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            <Line dataKey="natural" name="NAIRU" stroke="#2f6fed" strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>

    <section className="model-chart-section" aria-label="Gráfico de brecha de desempleo">
      <div className="panel-head"><h2>Brecha de desempleo</h2><span className="pill">Desempleo − NAIRU · pp</span></div>
      <p className="model-caption">Positiva (azul): holgura, presiona la inflación a la baja. Negativa (rojo): mercado laboral estrecho. 2020–2021 (pandemia) no se usa para estimar la pendiente.</p>
      <div className="model-gap-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 10, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
            <XAxis dataKey="date" tickFormatter={quarter} minTickGap={50} tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={v => number(v, 1)} width={58} tick={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="#748096" />
            <Tooltip labelFormatter={d => quarter(String(d))} formatter={v => [`${signed(Number(v))} pp`, "Brecha"]} />
            <Bar dataKey="gap" isAnimationActive={false}>{rows.map(r => <Cell key={r.date} fill={(r.gap ?? 0) >= 0 ? "#2f6fed" : "#d94b4b"} fillOpacity={0.75} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>

    <section className="model-chart-section" aria-label="Inflación y expectativas">
      <div className="panel-head"><h2>Inflación y expectativas</h2><span className="pill">%</span></div>
      <p className="model-caption">IPC a 12 meses versus la compensación inflacionaria a 1 año (swap Cámara CLP − UF) observada un año antes: lo que el mercado esperaba para ese trimestre.</p>
      <div className="model-gap-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 10, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
            <XAxis dataKey="date" tickFormatter={quarter} minTickGap={50} tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={v => `${number(v, 0)}%`} width={58} tick={{ fontSize: 11 }} />
            <ReferenceLine y={3} stroke="#94a3b8" strokeDasharray="4 4" />
            <Tooltip labelFormatter={d => quarter(String(d))} formatter={(v, n) => [`${number(Number(v))}%`, String(n)]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line dataKey="pi" name="IPC 12 meses" stroke="#d94b4b" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="pe" name="Expectativa (hace 1 año)" stroke="#0f9f6e" strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>

    <section className="model-chart-section" aria-label="Sensibilidad a la pendiente">
      <div className="panel-head"><h2>Sensibilidad a la pendiente κ</h2><span className="pill">Re-estimado para cada κ</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>κ</th><th>NAIRU actual</th><th>Banda 90%</th><th>Brecha</th><th>Ajuste (log-verosimilitud)</th></tr></thead>
          <tbody>{[result.ml, ...result.grid].map((g, i) => {
            const last = [...g.points].reverse().find(p => typeof p.u === "number")!;
            const selected = (choice === "ml" && i === 0) || (choice === g.kappa && i > 0);
            return <tr key={i} style={selected ? { background: "#eef3ff", fontWeight: 700 } : undefined}>
              <td>{i === 0 ? `${number(g.kappa)} (estimada)` : number(g.kappa, 1)}</td><td>{number(last.nairu)}%</td><td>{number(last.lower, 1)} – {number(last.upper, 1)}</td>
              <td>{signed((last.u ?? 0) - last.nairu)} pp</td><td>{number(g.logLik, 1)}{i > 0 && g.kappa >= kLow && g.kappa <= kHigh ? "" : i > 0 ? " · fuera del 90%" : ""}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>

    <section className="model-chart-section" aria-label="Parámetros estimados">
      <div className="panel-head"><h2>Parámetros</h2><span className="pill">Máxima verosimilitud · {result.observations} trimestres en la ecuación de inflación</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Parámetro</th><th>Valor</th><th style={{ textAlign: "left" }}>Lectura</th></tr></thead>
          <tbody>
            <tr><td>Pendiente κ</td><td>{number(fit.kappa)}</td><td style={{ textAlign: "left", whiteSpace: "normal" }}>1 pp de desempleo bajo la NAIRU sube el IPC a 12 meses en {number(fit.kappa)} pp ese trimestre</td></tr>
            <tr><td>Persistencia ρ</td><td>{number(fit.rho)}</td><td style={{ textAlign: "left", whiteSpace: "normal" }}>Peso de la inflación pasada; 1 − ρ = {number(1 - fit.rho)} es el peso de las expectativas</td></tr>
            <tr><td>Traspaso cambiario δ</td><td>{number(fit.delta, 3)}</td><td style={{ textAlign: "left", whiteSpace: "normal" }}>10% de depreciación anual del peso ≈ {number(fit.delta * 10)} pp más de inflación en el trimestre</td></tr>
            <tr><td>Ciclo del desempleo</td><td>φ₁ {number(fit.phi1)} · φ₂ {number(fit.phi2)}</td><td style={{ textAlign: "left", whiteSpace: "normal" }}>Persistencia AR(2) de la brecha; shock trimestral {number(fit.sigmaCycle)} pp</td></tr>
            <tr><td>Movimiento de la NAIRU</td><td>{number(result.sigmaEta, 2)} pp/trim.</td><td style={{ textAlign: "left", whiteSpace: "normal" }}>Supuesto (≈ {number(result.sigmaEta * 2, 1)} pp por año en una desviación estándar)</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <div className="model-notice">
      <strong>Cómo leerlo.</strong>
      <p>
        Desempleo publicado (trimestre móvil) desestacionalizado con factores mensuales fijos y promediado por trimestre. Curva de Phillips:
        π<sub>t</sub> = ρ·π<sub>t−1</sub> + (1−ρ)·πᵉ<sub>t</sub> − κ·(u<sub>t</sub> − u*<sub>t</sub>) + δ·Δtc<sub>t</sub> + c.
        En Chile desde 2015 la curva es plana: la inflación de 2021–2023 respondió sobre todo al tipo de cambio, a shocks de oferta y a la liquidez, no a la holgura laboral.
        Por eso la NAIRU se apoya mucho en la tendencia del propio desempleo, y la banda es amplia. Úsala como referencia de holgura, no como un dato preciso.
      </p>
    </div>
  </div>;
}

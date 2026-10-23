"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import type { FairValueModelData } from "@/lib/market-models.server";
import { nssYield } from "@/lib/nss";

const number = (value: number, digits = 2) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
const signed = (value: number, digits = 1) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${number(Math.abs(value), digits)}`;
const day = (date: string) => new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const month = (date: string) => new Intl.DateTimeFormat("es-CL", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const SIGNAL = 1.5;
type Sort = "maturity" | "z" | "residual";

export function NssFairValueModel({ data }: { data: FairValueModelData }) {
  const [type, setType] = useState<"BTP" | "BTU">("BTP");
  const [sort, setSort] = useState<Sort>("maturity");
  const result = "error" in data ? null : data;

  const rows = useMemo(() => {
    if (!result) return [];
    const list = result.rows.filter(r => r.type === type);
    if (sort === "z") return [...list].sort((a, b) => (b.z ?? -Infinity) - (a.z ?? -Infinity));
    if (sort === "residual") return [...list].sort((a, b) => b.residualBp - a.residualBp);
    return list;
  }, [result, type, sort]);

  const chart = useMemo(() => {
    const c = result?.curves[type]?.curve;
    if (!result || !c) return { line: [], bonds: [], excluded: [] };
    const maxT = Math.max(30, ...result.rows.filter(r => r.type === type).map(r => r.years));
    const minT = Math.min(...result.rows.filter(r => r.type === type).map(r => r.years));
    const line = Array.from({ length: 120 }, (_, i) => { const t = minT + (i * (maxT - minT)) / 119; return { t, curve: nssYield(c, t) }; });
    const pts = result.rows.filter(r => r.type === type).map(r => ({ t: r.years, y: r.yield, code: r.code }));
    return { line, bonds: pts.filter(p => result.rows.find(r => r.code === p.code)!.inFit), excluded: pts.filter(p => !result.rows.find(r => r.code === p.code)!.inFit) };
  }, [result, type]);

  const history = useMemo(() => (result ? result.history.filter((_, i, a) => i % 2 === 0 || i === a.length - 1) : []), [result]);

  if ("error" in data || !result) return <div className="model-content"><div className="model-notice" role="alert">{"error" in data ? data.error : "Sin datos."}</div></div>;

  const curve = result.curves[type];
  const scored = rows.filter(r => r.z !== null && r.inFit);
  const cheap = [...scored].sort((a, b) => b.z! - a.z!)[0];
  const rich = [...scored].sort((a, b) => a.z! - b.z!)[0];
  const be10 = result.breakevens.find(b => b.tenor === 10);

  return <div className="model-content">
    <div className="model-intro">
      <p>Cada día se ajusta una curva Nelson-Siegel-Svensson a los BTP y otra a los BTU. El <b>residuo</b> es cuánto rinde cada bono por sobre (+, barato) o por debajo (−, caro) de la curva a su mismo plazo. Como cada papel tiene un residuo &quot;normal&quot; propio, la señal es su <b>z-score</b> frente a su historia de 1 año.</p>
      <div className="segmented" role="group" aria-label="Tipo de bono" style={{ flexShrink: 0 }}>
        {(["BTP", "BTU"] as const).map(t => <button key={t} className={t === type ? "selected" : ""} aria-pressed={t === type} onClick={() => setType(t)}>{t}</button>)}
      </div>
    </div>

    <div className="kpi-grid">
      <div className="kpi"><div className="kpi-label">Ajuste curva {type}</div><div className="kpi-value">{curve ? `${number(curve.curve.rmseBp, 1)} pb` : "—"}</div><div className="kpi-foot kpi-foot-static">Error medio · {curve?.n ?? 0} bonos · {day(result.date)}</div></div>
      <div className="kpi"><div className="kpi-label">Más barato vs. su historia</div><div className="kpi-value">{cheap ? cheap.code : "—"}</div><div className="kpi-foot kpi-foot-static">{cheap ? `z ${signed(cheap.z!, 2)} · residuo ${signed(cheap.residualBp)} pb${cheap.z! < SIGNAL ? " · sin señal" : ""}` : ""}</div></div>
      <div className="kpi"><div className="kpi-label">Más caro vs. su historia</div><div className="kpi-value">{rich ? rich.code : "—"}</div><div className="kpi-foot kpi-foot-static">{rich ? `z ${signed(rich.z!, 2)} · residuo ${signed(rich.residualBp)} pb${rich.z! > -SIGNAL ? " · sin señal" : ""}` : ""}</div></div>
      <div className="kpi"><div className="kpi-label">Breakeven 10 años (curvas)</div><div className="kpi-value">{be10 ? `${number(be10.value)}%` : "—"}</div><div className="kpi-foot kpi-foot-static">{be10 ? `${be10.change1mBp === null ? "" : `${signed(be10.change1mBp)} pb en 1 mes · `}percentil 1a ${be10.percentile === null ? "—" : number(be10.percentile, 0)}` : ""}</div></div>
    </div>

    <section className="model-chart-section" aria-label={`Curva NSS ${type}`}>
      <div className="panel-head"><h2>Curva {type} y bonos · {day(result.date)}</h2><span className="pill">TIR % vs. años al vencimiento</span></div>
      <div className="chart-box"><ResponsiveContainer width="100%" height="100%"><ComposedChart margin={{ top: 10, right: 12, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5eaf2" />
        <XAxis type="number" dataKey="t" domain={[0, "dataMax"]} tickFormatter={v => `${Math.round(Number(v))}a`} tick={{ fontSize: 11 }} allowDuplicatedCategory={false} />
        <YAxis type="number" domain={["auto", "auto"]} tickFormatter={v => `${number(Number(v), 2)}%`} width={58} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v, name) => [`${number(Number(v), 3)}%`, String(name)]} labelFormatter={v => `${number(Number(v), 1)} años`} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line data={chart.line} dataKey="curve" name="Curva NSS" stroke="#f59e0b" strokeWidth={2.25} dot={false} isAnimationActive={false} />
        <Scatter data={chart.bonds.map(p => ({ t: p.t, y: p.y }))} dataKey="y" name="Bonos en el ajuste" fill="#2f6fed" isAnimationActive={false} />
        {chart.excluded.length > 0 && <Scatter data={chart.excluded.map(p => ({ t: p.t, y: p.y }))} dataKey="y" name="Cero cupón (fuera del ajuste)" fill="#94a3b8" isAnimationActive={false} />}
      </ComposedChart></ResponsiveContainer></div>
    </section>

    <div className="model-controls">
      <div className="segmented" role="group" aria-label="Orden">
        {([["maturity", "Por plazo"], ["z", "Por z-score"], ["residual", "Por residuo"]] as const).map(([k, l]) => <button key={k} className={k === sort ? "selected" : ""} aria-pressed={k === sort} onClick={() => setSort(k)}>{l}</button>)}
      </div>
    </div>

    <section className="model-chart-section" aria-label="Valor relativo por bono">
      <div className="table-wrap"><table className="backtest-table" style={{ minWidth: 860 }}>
        <thead><tr><th>Bono</th><th>Plazo</th><th>TIR</th><th>TIR curva</th><th>Residuo</th><th>Residuo medio 1a</th><th>Δ residuo 1M</th><th>Z-score 1a</th><th>Lectura</th></tr></thead>
        <tbody>{rows.map(r => {
          const signal = r.z === null ? "—" : r.z >= SIGNAL ? "Barato" : r.z <= -SIGNAL ? "Caro" : "Neutral";
          return <tr key={r.code} style={r.inFit ? undefined : { color: "#8b96a8" }}>
            <td className="strong">{r.code}{!r.inFit && <div className="subcell">cero cupón · fuera del ajuste</div>}</td>
            <td>{number(r.years, 1)} a</td><td>{number(r.yield, 3)}%</td><td>{number(r.fitted, 3)}%</td>
            <td>{signed(r.residualBp)} pb</td><td>{r.meanBp === null ? "—" : `${signed(r.meanBp)} pb`}</td>
            <td>{r.change1mBp === null ? "—" : `${signed(r.change1mBp)} pb`}</td>
            <td className={signal === "Barato" ? "good" : signal === "Caro" ? "bad" : ""}>{r.z === null ? "—" : signed(r.z, 2)}</td>
            <td className={signal === "Barato" ? "good" : signal === "Caro" ? "bad" : "muted"}>{signal}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>

    <section className="model-chart-section" aria-label="Breakeven de inflación">
      <div className="panel-head"><h2>Breakeven de inflación (BTP − BTU, curvas NSS)</h2><span className="pill">% anual compuesto</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Plazo</th><th>Breakeven</th><th>Δ 1 mes</th><th>Percentil 1 año</th></tr></thead>
        <tbody>{result.breakevens.map(b => <tr key={b.tenor}><td className="strong">{b.tenor} años</td><td>{number(b.value)}%</td><td>{b.change1mBp === null ? "—" : `${signed(b.change1mBp)} pb`}</td><td>{b.percentile === null ? "—" : number(b.percentile, 0)}</td></tr>)}</tbody>
      </table></div>
      <div className="chart-box"><ResponsiveContainer width="100%" height="100%"><LineChart data={history} margin={{ top: 10, right: 12, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
        <XAxis dataKey="date" tickFormatter={v => month(String(v))} minTickGap={40} tick={{ fontSize: 11 }} />
        <YAxis domain={["auto", "auto"]} tickFormatter={v => `${number(Number(v), 1)}%`} width={52} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v, name) => [`${number(Number(v), 2)}%`, String(name)]} labelFormatter={v => day(String(v))} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line dataKey="be2" name="2 años" stroke="#94a3b8" dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls />
        <Line dataKey="be5" name="5 años" stroke="#2f6fed" dot={false} strokeWidth={1.75} isAnimationActive={false} connectNulls />
        <Line dataKey="be10" name="10 años" stroke="#0f9f6e" dot={false} strokeWidth={1.75} isAnimationActive={false} connectNulls />
      </LineChart></ResponsiveContainer></div>
    </section>

    <div className="model-notice">
      <strong>Cómo leerlo.</strong>
      <p><b>Curva</b>: Nelson-Siegel-Svensson ajustada sobre TIR con los bonos con cupón de más de un año, con pesos robustos para que un papel desalineado no tuerza al resto. Los cero cupón se comparan contra la curva pero no la definen; los bonos de menos de un año se omiten (en BTU, la estacionalidad del IPC distorsiona el tramo corto). <b>Residuo</b>: TIR observada menos TIR de la curva al mismo plazo; positivo = rinde más que sus pares. <b>Z-score</b>: residuo de hoy frente a su media y desviación de los últimos 252 días (mínimo 60 observaciones); |z| ≥ {number(SIGNAL, 1)} se marca como barato o caro.
        No ajusta por cupón ni liquidez, por eso el residuo medio de cada bono no es cero y la señal se mide contra su propia historia. <b>Breakeven</b>: (1 + TIR nominal) / (1 + TIR real) − 1 de las curvas al mismo plazo; incluye prima por riesgo inflacionario y liquidez, no es la expectativa pura de IPC. Indicador de valor relativo, no una recomendación.</p>
    </div>
  </div>;
}

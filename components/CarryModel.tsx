"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CarryModelData } from "@/lib/market-models.server";

const number = (value: number, digits = 2) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
const signed = (value: number, digits = 2) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${number(Math.abs(value), digits)}`;
const day = (date: string) => new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
type Sort = "maturity" | "total" | "ratio";

export function CarryModel({ data }: { data: CarryModelData }) {
  const [index, setIndex] = useState(1);
  const [type, setType] = useState<"BTP" | "BTU">("BTP");
  const [sort, setSort] = useState<Sort>("maturity");
  const result = "error" in data ? null : data.results[index];
  const rows = useMemo(() => {
    if (!result) return [];
    const list = result.rows.filter(r => r.type === type);
    if (sort === "total") return [...list].sort((a, b) => b.totalPct - a.totalPct);
    if (sort === "ratio") return [...list].sort((a, b) => (b.ratio ?? -Infinity) - (a.ratio ?? -Infinity));
    return list;
  }, [result, type, sort]);
  if ("error" in data || !result) return <div className="model-content"><div className="model-notice" role="alert">{"error" in data ? data.error : "Sin datos."}</div></div>;

  const h = result.horizonMonths;
  const best = [...rows].filter(r => r.ratio !== null).sort((a, b) => b.ratio! - a.ratio!)[0];
  const curve = result.curves[type];
  const ufAnnual = 100 * (Math.pow(1 + result.ufGrowthPct / 100, 12 / h) - 1);
  const chart = [...result.rows.filter(r => r.type === type)].sort((a, b) => a.years - b.years).map(r => ({ code: r.code.replace(/^(BTP|BTU)/, ""), carry: r.carryPct, roll: r.rollPct, total: r.totalPct }));

  return <div className="model-content">
    <div className="model-intro">
      <p>Cuánto rinde cada bono en {h} {h === 1 ? "mes" : "meses"} si la curva no se mueve, financiado a plazo en CLP: devengo de la TIR (más la UF esperada en los BTU) menos el financiamiento, más la ganancia por deslizarse hacia plazos más cortos de la curva. No es un pronóstico de tasas.</p>
      <div className="segmented" role="group" aria-label="Horizonte" style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
        {"results" in data && data.results.map((r, i) => <button key={r.horizonMonths} className={i === index ? "selected" : ""} aria-pressed={i === index} onClick={() => setIndex(i)}>{r.horizonMonths} {r.horizonMonths === 1 ? "mes" : "meses"}</button>)}
      </div>
    </div>
    <div className="kpi-grid">
      <div className="kpi"><div className="kpi-label">Financiamiento {h}m (swap Cámara)</div><div className="kpi-value">{number(result.fundingRate)}%</div><div className="kpi-foot kpi-foot-static">Costo del período: {number(result.fundingPct, 3)}%</div></div>
      <div className="kpi"><div className="kpi-label">UF esperada al {day(result.end)}</div><div className="kpi-value">{number(result.ufGrowthPct, 2)}%</div><div className="kpi-foot kpi-foot-static">≈ {number(ufAnnual, 1)}% anualizado (IPC observado + forwards ICAP)</div></div>
      <div className="kpi"><div className="kpi-label">Mejor retorno/riesgo {type}</div><div className="kpi-value">{best ? best.code : "—"}</div><div className="kpi-foot kpi-foot-static">{best ? `${signed(best.totalPct)}% en ${h}m · breakeven ${number(best.breakevenBp, 0)} pb` : ""}</div></div>
      <div className="kpi"><div className="kpi-label">Curva {type} (Nelson-Siegel)</div><div className="kpi-value">{curve ? `${number(curve.rmseBp, 1)} pb` : "—"}</div><div className="kpi-foot kpi-foot-static">Error medio del ajuste · datos al {day(result.date)}</div></div>
    </div>

    <div className="model-controls">
      <div className="segmented" role="group" aria-label="Tipo de bono">
        {(["BTP", "BTU"] as const).map(t => <button key={t} className={t === type ? "selected" : ""} aria-pressed={t === type} onClick={() => setType(t)}>{t}</button>)}
      </div>
      <div className="segmented" role="group" aria-label="Orden">
        {([["maturity", "Por plazo"], ["total", "Por retorno"], ["ratio", "Por retorno/riesgo"]] as const).map(([k, l]) => <button key={k} className={k === sort ? "selected" : ""} aria-pressed={k === sort} onClick={() => setSort(k)}>{l}</button>)}
      </div>
    </div>

    <section className="model-chart-section" aria-label="Carry y roll-down por bono">
      <div className="panel-head"><h2>Retorno en exceso esperado · {type} · {h}m</h2><span className="pill">% sobre el período</span></div>
      <div className="model-gap-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart} margin={{ top: 10, right: 12, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
        <XAxis dataKey="code" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" height={46} />
        <YAxis tickFormatter={v => `${number(Number(v), 1)}%`} width={52} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v, name) => [`${number(Number(v), 3)}%`, name === "total" ? "Total" : String(name)]} />
        <Bar dataKey="total" isAnimationActive={false}>{chart.map(r => <Cell key={r.code} fill={r.total >= 0 ? "#2f6fed" : "#d94b4b"} fillOpacity={0.8} />)}</Bar>
      </BarChart></ResponsiveContainer></div>
      <div className="table-wrap"><table className="backtest-table">
        <thead><tr><th>Bono</th><th>Plazo</th><th>TIR</th><th>TIR curva</th><th>Dur. mod.</th><th>Carry</th><th>Roll-down</th><th>Roll-down</th><th>Total</th><th>Breakeven</th><th>Vol. período</th><th>Ret./riesgo</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.code} style={best && r.code === best.code ? { background: "#eef3fb" } : undefined}>
          <td className="strong">{r.code}</td><td>{number(r.years, 1)} a</td><td>{number(r.yield, 3)}%</td><td>{number(r.fittedYield, 3)}%</td><td>{number(r.modifiedDuration, 2)}</td>
          <td className={r.carryPct >= 0 ? "good" : "bad"}>{signed(r.carryPct, 3)}%</td><td>{signed(r.rollBp, 1)} pb</td><td>{signed(r.rollPct, 3)}%</td>
          <td className={r.totalPct >= 0 ? "good" : "bad"}>{signed(r.totalPct, 3)}%</td><td>{number(r.breakevenBp, 1)} pb</td>
          <td>{r.volPct === null ? "—" : `${number(r.volPct, 2)}%`}</td><td>{r.ratio === null ? "—" : number(r.ratio, 2)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <div className="model-notice">
      <strong>Cómo leerlo.</strong>
      <p><b>Carry</b>: devengo de la TIR en el período (en los BTU, la TIR real más la variación esperada de la UF) menos el costo de financiarse a {h} {h === 1 ? "mes" : "meses"} al swap Cámara. <b>Roll-down</b>: baja de la TIR al acortarse el plazo sobre una curva que no se mueve (Nelson-Siegel ajustada con los bonos con cupón; el bono mantiene su spread a la curva), multiplicada por la duración modificada. <b>Breakeven</b>: cuántos pb puede subir la TIR del bono antes de perder contra el financiamiento. <b>Ret./riesgo</b>: retorno total dividido por la volatilidad esperada del período (desviación de los cambios diarios de TIR de los últimos 3 meses × √días × duración).
        Entre BTP y BTU, la diferencia de carry es esencialmente una apuesta a que la inflación del período supere la compensación inflacionaria: en meses de IPC alto la UF hace que los BTU tengan más carry. Se excluyen bonos con menos de un año al vencimiento. Retornos sobre precio, sin costos de transacción ni impuestos.</p>
    </div>
  </div>;
}

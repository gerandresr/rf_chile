"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "./AppShell";
import type { BenchmarkRow, Changes, DashboardData, MonitorRow, SpreadCard, TickerItem } from "@/lib/dashboard.server";
import { chileToday, latestBenchmarkEstimate, type BenchmarkEstimate } from "@/lib/benchmark-estimates";

const fmt = (v: number, d = 2) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const sgn = (v: number, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v), d)}`;
const day = (d: string) => new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const tenorLabel = (t: number) => t < 1 ? `${Math.round(t * 12)}m` : `${t}a`;

// Convención del sitio: azul = baja de tasa (favorable para el tenedor), rojo = alza.
const BLUE = "#2f6fed", RED = "#d94b4b";
const tone = (v: number | null | undefined, goodWhenDown = true) => v == null || Math.abs(v) < 1e-9 ? "dash-flat" : (v < 0) === goodWhenDown ? "dash-down" : "dash-up";

function Sparkline({ values, width = 84, height = 24, color = "#64748b" }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return <span className="muted">—</span>;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1) * (width - 2) + 1).toFixed(1)},${(height - 1 - (v - min) / span * (height - 2)).toFixed(1)}`).join(" ");
  const last = values[values.length - 1], first = values[0];
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="dash-spark">
    <polyline points={pts} fill="none" stroke={color} strokeWidth={1.3} strokeLinejoin="round" />
    <circle cx={width - 1} cy={height - 1 - (last - min) / span * (height - 2)} r={2} fill={last >= first ? RED : BLUE} />
  </svg>;
}

function Ticker({ item }: { item: TickerItem }) {
  const goodWhenDown = item.label !== "Cobre";
  return <div className="dash-tick">
    <div className="dash-tick-label">{item.label}</div>
    <div className="dash-tick-value">{fmt(item.value, item.digits)}{item.unit === "%" ? "%" : item.unit === "pb" ? " pb" : ""}</div>
    <div className="dash-tick-foot">
      <span className={tone(item.change, goodWhenDown)}>{item.change == null ? "—" : `${sgn(item.change, item.changeUnit === "%" ? 2 : 1)}${item.changeUnit === "%" ? "%" : " pb"}`}</span>
      <Sparkline values={item.spark} width={64} height={18} />
    </div>
  </div>;
}

type Period = keyof Changes;

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return <div className="segmented" role="group" aria-label={label}>
    {options.map(([k, l]) => <button key={k} className={k === value ? "selected" : ""} aria-pressed={k === value} onClick={() => onChange(k)}>{l}</button>)}
  </div>;
}

function Benchmarks({ rows, papers }: { rows: BenchmarkRow[]; papers: DashboardData["benchmarkPapers"] }) {
  const officialDate = rows[0]?.date ?? "";
  const [estimate, setEstimate] = useState<BenchmarkEstimate | null>(null);
  const [failed, setFailed] = useState(false);
  // La estimación del día se lee en el navegador (sin caché): si el archivo trae una estimación de hoy
  // posterior al cierre oficial, reemplaza el cierre; si no, se muestra el cierre del día anterior.
  useEffect(() => {
    let cancelled = false;
    fetch("/data/cierre-estimado-rf.json", { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(json => { if (!cancelled) setEstimate(latestBenchmarkEstimate(json, officialDate, chileToday())); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [officialDate]);
  const bp = (v: number | null, d = 0) => v == null ? "—" : `${sgn(v, d)} pb`;
  return <section className="panel dash-panel">
    <div className="panel-head"><div><div className="eyebrow">Cierre oficial y estimación intradía</div><h2>Tasas Benchmark</h2></div>
      <span className={estimate ? "pill dash-live" : "pill"}>{estimate ? `Estimación ${estimate.hora} (Chile)` : `Cierre ${day(officialDate)}`}</span></div>
    <div className="table-wrap"><table className="dash-bench">
      <thead><tr><th>Benchmark</th><th>Cierre hoy est.</th><th>Δ hoy</th><th>MTD</th><th>YTD</th></tr></thead>
      <tbody>{rows.map(r => {
        const est = estimate?.benchmark[r.code as keyof BenchmarkEstimate["benchmark"]] ?? r.close;
        const dayChange = est != null && r.close != null ? (est - r.close) * 100 : null;
        const mtd = est != null && r.mtdBase != null ? (est - r.mtdBase) * 100 : null;
        const ytd = est != null && r.ytdBase != null ? (est - r.ytdBase) * 100 : null;
        return <tr key={r.code}>
          <td className="strong">{r.code}</td>
          <td className="strong">{est == null ? "—" : `${fmt(est, 2)}%`}</td>
          <td className={tone(dayChange)}>{bp(dayChange, 1)}</td>
          <td className={tone(mtd)}>{bp(mtd)}</td>
          <td className={tone(ytd)}>{bp(ytd)}</td>
        </tr>;
      })}</tbody>
    </table></div>
    <p className="dash-note">
      {estimate ? `Cierre hoy est. = estimación de las ${estimate.hora}; Δ hoy contra el cierre oficial del ${day(officialDate)}.`
        : failed ? "No se pudo leer el archivo de estimaciones: se muestra el cierre oficial." : `Sin estimación para hoy: se muestra el cierre oficial del ${day(officialDate)} (Δ hoy = 0).`}
      {" "}MTD y YTD contra el último cierre del mes y del año anteriores.
    </p>
    <div className="dash-papers">
      <strong>Papeles a considerar</strong>
      <div><b>BTP:</b> {papers.BTP.join(", ")}</div>
      <div><b>BTU:</b> {papers.BTU.join(", ")}</div>
    </div>
  </section>;
}

function Curves({ curves }: { curves: DashboardData["curves"] }) {
  const [key, setKey] = useState(curves[0].key);
  const [compare, setCompare] = useState(1);
  const curve = curves.find(c => c.key === key)!;
  const rows = curve.tenors.map((t, i) => {
    const row: Record<string, number | string | null> = { tenor: tenorLabel(t) };
    curve.lines.forEach(l => { row[l.label] = l.values[i]; });
    const today = curve.lines[0].values[i], base = curve.lines[compare].values[i];
    row.change = today != null && base != null ? (today - base) * 100 : null;
    return row;
  });
  const colors = [BLUE, "#94a3b8", "#cbd5e1", "#f59e0b"];
  return <section className="panel dash-panel">
    <div className="panel-head" style={{ flexWrap: "wrap" }}><div><div className="eyebrow">Estructura temporal</div><h2>Curvas</h2></div>
      <Segmented value={key} options={curves.map(c => [c.key, c.label] as [string, string])} onChange={setKey} label="Curva" /></div>
    <div className="dash-curve"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} syncId="dash-curve">
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
      <XAxis dataKey="tenor" tick={{ fontSize: 11 }} />
      <YAxis domain={["auto", "auto"]} tickFormatter={v => `${fmt(Number(v), 1)}%`} width={46} tick={{ fontSize: 11 }} />
      <Tooltip formatter={(v, n) => [v == null ? "—" : `${fmt(Number(v), 3)}%`, String(n)]} />
      <Legend wrapperStyle={{ fontSize: 11 }} />
      {curve.lines.map((l, i) => <Line key={l.label} dataKey={l.label} name={`${l.label} (${day(l.date)})`} stroke={colors[i]} strokeWidth={i === 0 ? 2.4 : 1.5} strokeDasharray={i === 0 ? undefined : "4 3"} dot={i === 0 ? { r: 2.5 } : false} connectNulls isAnimationActive={false} />)}
    </LineChart></ResponsiveContainer></div>
    <div className="panel-head" style={{ marginTop: 8 }}><span className="dash-note" style={{ margin: 0 }}>Cambio de hoy versus</span>
      <Segmented value={String(compare)} options={curve.lines.slice(1).map((l, i) => [String(i + 1), l.label] as [string, string])} onChange={v => setCompare(Number(v))} label="Comparar con" /></div>
    <div className="dash-curve-bars"><ResponsiveContainer width="100%" height="100%"><BarChart data={rows} margin={{ top: 4, right: 12, bottom: 0, left: 0 }} syncId="dash-curve">
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
      <XAxis dataKey="tenor" tick={{ fontSize: 11 }} />
      <YAxis tickFormatter={v => `${fmt(Number(v), 0)}`} width={46} tick={{ fontSize: 11 }} />
      <ReferenceLine y={0} stroke="#94a3b8" />
      <Tooltip formatter={v => [v == null ? "—" : `${sgn(Number(v), 1)} pb`, "Cambio"]} />
      <Bar dataKey="change" isAnimationActive={false}>{rows.map((r, i) => <Cell key={i} fill={Number(r.change) < 0 ? BLUE : RED} fillOpacity={0.75} />)}</Bar>
    </BarChart></ResponsiveContainer></div>
  </section>;
}

function Spread({ s }: { s: SpreadCard }) {
  const unit = s.unit === "pb" ? " pb" : "%";
  const digits = s.unit === "pb" ? 0 : 2;
  const pos = s.max > s.min ? (s.value - s.min) / (s.max - s.min) * 100 : 50;
  return <div className="dash-spread">
    <div className="dash-tick-label">{s.label}</div>
    <div className="dash-spread-row"><div className="dash-spread-value">{fmt(s.value, digits)}{unit}</div><Sparkline values={s.spark} width={96} height={30} /></div>
    <div className="dash-spread-detail">{s.detail}{s.reference ? ` · ${s.reference.label} ${fmt(s.reference.value, 1)}%` : ""}</div>
    <div className="dash-spread-changes"><span>1D <b className={tone(s.changes.d1)}>{s.changes.d1 == null ? "—" : sgn(s.changes.d1)}</b></span><span>1M <b className={tone(s.changes.m1)}>{s.changes.m1 == null ? "—" : sgn(s.changes.m1)}</b></span><span className="muted">pb</span></div>
    <div className="dash-range" title={`Rango 1 año: ${fmt(s.min, digits)} – ${fmt(s.max, digits)}`}>
      <div className="dash-range-track"><div className="dash-range-marker" style={{ left: `${pos}%` }} /></div>
      <div className="dash-range-labels"><span>{fmt(s.min, digits)}</span><span>Percentil 1a: {s.percentile == null ? "—" : Math.round(s.percentile)}</span><span>{fmt(s.max, digits)}</span></div>
    </div>
  </div>;
}

type SortKey = "order" | "value" | "d1" | "w1" | "m1" | "ytd" | "percentile" | "aswDuration" | "aswMaturity" | "carry1d";
function Monitor({ monitor }: { monitor: DashboardData["monitor"] }) {
  const [tab, setTab] = useState(monitor[0].key);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "order", desc: false });
  const group = monitor.find(m => m.key === tab)!;
  const rows = useMemo(() => {
    const list = group.rows.map((r, i) => ({ ...r, order: i }));
    if (sort.key === "order") return list;
    const val = (r: MonitorRow & { order: number }) => sort.key === "value" ? r.value : sort.key === "percentile" ? r.percentile ?? -Infinity
      : sort.key === "aswDuration" || sort.key === "aswMaturity" || sort.key === "carry1d" ? r[sort.key] ?? -Infinity : r.changes[sort.key as Period] ?? -Infinity;
    return list.sort((a, b) => (val(a) - val(b)) * (sort.desc ? -1 : 1));
  }, [group, sort]);
  const header = (key: SortKey, label: string) => <th><button className="dash-sort" onClick={() => setSort(s => ({ key, desc: s.key === key ? !s.desc : true }))}>{label}{sort.key === key ? (sort.desc ? " ▼" : " ▲") : ""}</button></th>;
  const digits = 3;
  const bondTab = group.key === "BTP" || group.key === "BTU";
  return <section className="panel dash-panel">
    <div className="panel-head" style={{ flexWrap: "wrap" }}><div><div className="eyebrow">Monitor</div><h2>Instrumentos</h2></div>
      <Segmented value={tab} options={monitor.map(m => [m.key, m.label] as [string, string])} onChange={k => { setTab(k); setSort({ key: "order", desc: false }); }} label="Grupo" /></div>
    <div className="table-wrap"><table className="dash-monitor">
      <thead><tr>{header("order", "Instrumento")}{bondTab && <th>Dur.</th>}{header("value", group.unit === "%" ? "Tasa" : "Tasa mensual")}
        {bondTab && <>{header("aswDuration", "ASW dur.")}{header("aswMaturity", "ASW venc.")}{header("carry1d", "Carry 1d")}</>}
        {header("d1", "1D")}{header("w1", "1S")}{header("m1", "1M")}{header("ytd", "YTD")}<th className="dash-spark-col">1 mes</th>{header("percentile", "Pctl 1a")}</tr></thead>
      <tbody>{rows.map(r => <tr key={r.code}>
        <td title={r.detail}><span className="strong">{r.code}</span>{bondTab && <div className="subcell">{r.detail}</div>}</td>
        {bondTab && <td>{r.duration == null ? "—" : fmt(r.duration, 2)}</td>}
        <td className="strong">{fmt(r.value, digits)}%</td>
        {bondTab && <>
          <td className={tone(r.aswDuration, false)}>{r.aswDuration == null ? "—" : sgn(r.aswDuration, 0)}</td>
          <td className={tone(r.aswMaturity, false)}>{r.aswMaturity == null ? "—" : sgn(r.aswMaturity, 0)}</td>
          <td className={tone(r.carry1d, false)}>{r.carry1d == null ? "—" : sgn(r.carry1d, 2)}</td>
        </>}
        {(["d1", "w1", "m1", "ytd"] as Period[]).map(p => <td key={p} className={tone(r.changes[p])}>{r.changes[p] == null ? "—" : sgn(r.changes[p]!, p === "ytd" ? 0 : 1)}</td>)}
        <td className="dash-spark-col"><Sparkline values={r.spark} width={120} height={24} /></td>
        <td><div className="dash-pctl"><div style={{ width: `${r.percentile ?? 0}%` }} /></div><span className="dash-pctl-label">{r.percentile == null ? "—" : Math.round(r.percentile)}</span></td>
      </tr>)}</tbody>
    </table></div>
    <p className="dash-note">Cambios, ASW y carry en pb. ASW = TIR − swap Cámara interpolado por duración o por plazo al vencimiento (BTP contra CLP, BTU contra UF); positivo = bono rinde sobre el swap. Carry 1d = devengo diario de la TIR (más IPC del período UF en BTU) menos TPM, dividido por la duración, como en Mercados. Percentil: posición de la tasa dentro del último año (100 = máximo). Haz clic en los encabezados para ordenar.</p>
  </section>;
}

export function DashboardRF({ data }: { data: DashboardData }) {
  return <AppShell>
    <header className="page-head">
      <div><div className="eyebrow">Trading Propietario</div><h1>Mercado RF</h1><p>Monitor de renta fija chilena: niveles, movimientos y valor relativo.</p></div>
      <div className="asof"><span>RF Chile · {day(data.asOf.bonds)}</span><strong>Bloomberg · {day(data.asOf.bloomberg)}</strong><span>BCentral · {day(data.asOf.bcentral)}</span></div>
    </header>
    <div className="dash-ticker">{data.ticker.map(t => <Ticker key={t.label} item={t} />)}</div>
    <div className="dash-macro">{data.macro.map(m => <div key={m.label}><span>{m.label}</span><strong>{m.value}</strong><em>{m.detail}</em></div>)}</div>
    <div className="dash-grid"><Benchmarks rows={data.benchmarks} papers={data.benchmarkPapers} /><Curves curves={data.curves} /></div>
    <section className="dash-spreads-section">
      <div className="panel-head"><div><div className="eyebrow">Valor relativo</div><h2>Spreads clave</h2></div><span className="pill">Rango y percentil del último año</span></div>
      <div className="dash-spreads">{data.spreads.map(s => <Spread key={s.label} s={s} />)}</div>
    </section>
    <Monitor monitor={data.monitor} />
  </AppShell>;
}

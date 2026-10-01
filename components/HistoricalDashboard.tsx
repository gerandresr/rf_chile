"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, ComposedChart, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from "recharts";
import { AppShell } from "./AppShell";
import { RFData, isActiveInstrument, observations, rollingVolatility } from "@/lib/rf";
import { calculateTechnicals, technicalOptions, Technical, TechnicalPoint } from "@/lib/technicals";

type Period = "1M" | "3M" | "YTD" | "1Y" | "MAX";
type Metric = "yield" | "change" | "vol10" | "vol30" | "vol90";
function cutoff(period: Period, lastDate: string) {
  const d = new Date(`${lastDate}T12:00:00`);
  if (period === "MAX") return new Date(1900, 0, 1);
  if (period === "YTD") return new Date(d.getFullYear(), 0, 1);
  const c = new Date(d); c.setMonth(c.getMonth() - (period === "1M" ? 1 : period === "3M" ? 3 : 12)); return c;
}
const colors = ["#2f6fed", "#10b981", "#f59e0b", "#8b5cf6"];
function DailyChangeDot({ cx, cy, value }: { cx?: number; cy?: number; value?: number | string | (number | string)[] }) {
  if (cx == null || cy == null || typeof value !== "number" || !Number.isFinite(value)) return <g/>;
  const color = value > 0 ? "#d94b4b" : value < 0 ? "#0f9f6e" : "#748096";
  return <circle cx={cx} cy={cy} r={3.5} fill={color} stroke={color}/>;
}
const indicatorSeries: Partial<Record<Technical, { key: string; name: string }[]>> = {
  rsi: [{ key: "rsi", name: "RSI 14" }],
  macd: [{ key: "macd", name: "MACD" }, { key: "signal", name: "Señal 9" }],
  zscore: [{ key: "zscore", name: "Z-score 60" }],
  momentum: [1, 5, 20].map(n => ({ key: `momentum${n}`, name: `Cambio ${n}d` })),
  volatility: [{ key: "volatility", name: "Volatilidad 20d" }],
  percentile: [{ key: "percentile", name: "Percentil 1 año" }],
};
export function HistoricalDashboard() {
  const [data, setData] = useState<RFData | null>(null);
  const [code, setCode] = useState("BTP0581029");
  const [period, setPeriod] = useState<Period>("1Y");
  const [metric, setMetric] = useState<Metric>("yield");
  const [compare, setCompare] = useState<string[]>([]);
  const [technical, setTechnical] = useState<Technical | null>(null);
  useEffect(() => { fetch("/data/rf.json").then(r => r.json()).then(setData); }, []);
  const active = useMemo(() => data ? data.instruments.filter(i => isActiveInstrument(i) && (i.type === "BTP" || i.type === "BTU")).sort((a, b) => a.type.localeCompare(b.type) || a.maturityYear - b.maturityYear || a.maturityMonth - b.maturityMonth || a.code.localeCompare(b.code)) : [], [data]);
  const selectedTechnical = metric === "yield" ? technical : null;
  const chart = useMemo(() => {
    if (!data) return [];
    const codes = [code, ...(selectedTechnical ? [] : compare.filter(c => c !== code))];
    const map = new Map<string, TechnicalPoint>();
    const start = cutoff(period, data.lastMarketDate);
    for (const c of codes) {
      const obs = observations(data, c).filter(p => Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
      const series = metric === "yield" ? obs : metric === "change" ? obs.slice(1).map((p, i) => ({ date: p.date, value: (p.value - obs[i].value) * 100 })) : rollingVolatility(obs, metric === "vol10" ? 10 : metric === "vol30" ? 30 : 90);
      for (const p of series) {
        if (new Date(`${p.date}T12:00:00`) < start) continue;
        if (!map.has(p.date)) map.set(p.date, { date: p.date });
        map.get(p.date)![c] = p.value;
      }
      if (c === code && selectedTechnical) for (const point of calculateTechnicals(obs, selectedTechnical)) {
        const row = map.get(point.date); if (row) Object.assign(row, point);
      }
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [data, code, compare, metric, period, selectedTechnical]);
  if (!data) return <AppShell><div className="loading">Cargando históricos…</div></AppShell>;
  const lines = [code, ...(selectedTechnical ? [] : compare.filter(c => c !== code))];
  const isBp = metric !== "yield";
  const option = technicalOptions.find(o => o.id === selectedTechnical);
  const overlay = selectedTechnical === "bollinger" || selectedTechnical === "ma";
  const series = selectedTechnical ? indicatorSeries[selectedTechnical] ?? [] : [];
  const unit = selectedTechnical === "zscore" ? "σ" : selectedTechnical === "percentile" ? "%" : selectedTechnical === "rsi" ? "" : " bp";
  const hasIndicatorData = chart.some(row => [...series.map(s => s.key), ...(selectedTechnical === "macd" ? ["histogram"] : []), ...(overlay ? ["ma20"] : [])].some(key => typeof row[key] === "number"));
  return <AppShell>
    <header className="page-head"><div><div className="eyebrow">Series históricas</div><h1>Históricos</h1><p>Yield, cambios diarios y volatilidad móvil calculada sobre cambios de tasa en basis points.</p></div><div className="asof"><span>Último cierre</span><strong>{data.lastMarketDate}</strong></div></header>
    <section className="panel controls-panel">
      <div className="control"><label htmlFor="history-instrument">Instrumento</label><select id="history-instrument" value={code} onChange={e => setCode(e.target.value)}>{active.map(i => <option key={i.code}>{i.code}</option>)}</select></div>
      <div className="control wide"><label>Período</label><div className="segmented">{(["1M", "3M", "YTD", "1Y", "MAX"] as Period[]).map(p => <button key={p} className={period === p ? "selected" : ""} onClick={() => setPeriod(p)}>{p}</button>)}</div></div>
      <div className="control"><label htmlFor="history-metric">Métrica</label><select id="history-metric" value={metric} onChange={e => { setMetric(e.target.value as Metric); setTechnical(null); }}><option value="yield">Yield</option><option value="change">Cambio diario</option><option value="vol10">Volatilidad 10d</option><option value="vol30">Volatilidad 30d</option><option value="vol90">Volatilidad 90d</option></select></div>
    </section>
    <section className="panel">
      <div className="panel-head"><div><div className="eyebrow">Comparación</div><h2>{isBp ? "Basis points" : "Yield (%)"}</h2></div></div>
      {(["BTP", "BTU"] as const).map(type => <div className="history-compare-group" key={type} role="group" aria-label={`Comparar instrumentos ${type}`}><h3 className="history-compare-title">{type}</h3><div className="compare-row">{active.filter(i => i.type === type && i.code !== code).map(i => {
        const on = compare.includes(i.code) && !selectedTechnical;
        return <button key={i.code} className={`chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => { setTechnical(null); setCompare(c => on ? c.filter(x => x !== i.code) : c.filter(x => x !== code).length < 3 ? [...c.filter(x => x !== code), i.code] : c); }}>{i.code.replace("BTP", "BTP ").replace("BTU", "BTU ")}</button>;
      })}</div></div>)}
      {metric === "yield" && <div className="history-compare-group" role="group" aria-label="Indicadores técnicos"><h3 className="history-compare-title">Técnicos</h3><div className="compare-row">{technicalOptions.map(o => <button key={o.id} className={`chip ${selectedTechnical === o.id ? "on" : ""}`} aria-pressed={selectedTechnical === o.id} title={o.description} onClick={() => { setTechnical(current => current === o.id ? null : o.id); setCompare([]); }}>{o.label}</button>)}</div></div>}
      {option && <p className="technical-description">{code} · {option.description} Pulsa la opción activa para quitarla.</p>}
      <div className="history-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart} syncId="historical-technicals" margin={{ left: 8, right: 18, top: 10, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="date" minTickGap={35}/><YAxis domain={["auto", "auto"]} tickFormatter={v => `${Number(v).toFixed(1)}${isBp ? "" : "%"}`}/><Tooltip formatter={(v, name) => [`${Number(v).toFixed(isBp ? 2 : 3)}${isBp ? " bp" : "%"}`, String(name)]}/><Legend/>
        {metric === "change" && <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" ifOverflow="extendDomain"/>}
        {lines.map((c, i) => <Line key={c} type="linear" dataKey={c} name={c} stroke={colors[i % colors.length]} dot={metric === "change" ? <DailyChangeDot/> : false} activeDot={metric === "change" ? <DailyChangeDot/> : undefined} strokeWidth={metric === "change" ? 0 : i === 0 ? 2.3 : 1.7} isAnimationActive={metric !== "change"} connectNulls={false}/>)}
        {overlay && <Line dataKey="ma20" name="Media 20" stroke="#f59e0b" dot={false} strokeWidth={1.8}/>}
        {selectedTechnical === "ma" && <Line dataKey="ma60" name="Media 60" stroke="#10b981" dot={false} strokeWidth={1.8}/>}
        {selectedTechnical === "bollinger" && ["upper", "lower"].map(key => <Line key={key} dataKey={key} name={key === "upper" ? "Banda superior" : "Banda inferior"} stroke="#8b5cf6" strokeDasharray="5 4" dot={false}/>)}
      </LineChart></ResponsiveContainer></div>
      {selectedTechnical && !overlay && <div className="technical-panel"><h3 className="history-compare-title">{option?.label} · {code}{unit ? ` (${unit.trim()})` : ""}</h3><div className="technical-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chart} syncId="historical-technicals" margin={{ left: 8, right: 18, top: 10, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="date" minTickGap={35}/><YAxis domain={selectedTechnical === "rsi" || selectedTechnical === "percentile" ? [0, 100] : ["auto", "auto"]} tickFormatter={v => `${Number(v).toFixed(1)}${selectedTechnical === "percentile" ? "%" : ""}`}/><Tooltip formatter={(v, name) => [`${Number(v).toFixed(2)}${unit}`, String(name)]}/><Legend/>
        {(selectedTechnical === "rsi" ? [30, 70] : selectedTechnical === "zscore" ? [-2, 0, 2] : selectedTechnical === "macd" || selectedTechnical === "momentum" ? [0] : []).map(y => <ReferenceLine key={y} y={y} stroke="#94a3b8" strokeDasharray="4 4"/>)}
        {selectedTechnical === "macd" && <Bar dataKey="histogram" name="Histograma" fill="#94a3b8"/>}
        {series.map((s, i) => <Line key={s.key} dataKey={s.key} name={s.name} stroke={colors[i]} dot={false} strokeWidth={1.8} connectNulls={false}/>)}
      </ComposedChart></ResponsiveContainer></div></div>}
      {selectedTechnical && !hasIndicatorData && <p className="technical-description" role="status">Historia insuficiente para calcular este indicador en el período seleccionado.</p>}
    </section>
    <div className="note">{selectedTechnical ? "El indicador usa solamente el instrumento principal. Seleccionar un BTP o BTU adicional desactiva el indicador y permite comparar nuevamente. Las ventanas usan observaciones disponibles y se calculan antes de recortar el período visible." : "Puedes comparar hasta 4 series simultáneamente. La volatilidad usa desviación estándar muestral de 10, 30 o 90 cambios diarios de yield."}</div>
  </AppShell>;
}

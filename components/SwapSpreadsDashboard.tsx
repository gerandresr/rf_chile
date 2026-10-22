"use client";

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "./AppShell";
import { change, DAY, interpolate, meanReversion, scenario, spreadValue, stats, time, windowPoints, type SpreadBasis, type SpreadData } from "@/lib/swap-spreads";

const fmt = (n: number | null | undefined, digits = 2) => n == null || !Number.isFinite(n) ? "—" : new Intl.NumberFormat("es-CL", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
const money = (n: number) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n);
const dateLabel = (s: string) => s ? s.split("-").reverse().join("/") : "—";
const STORE = "rfchilena.swap-spreads.positions.v1";
type Position = { id: string; code: string; currency: "CLP" | "UF"; basis: SpreadBasis; date: string; recorded: string; amount: number; yield: number; swap: number; spread: number; duration: number; target: number; stop: number; horizon: number; thesis: string; closed: string | null };
function validPosition(v: unknown): v is Position {
  if (!v || typeof v !== "object") return false;
  const p = v as Position;
  return typeof p.id === "string" && typeof p.code === "string" && ["CLP", "UF"].includes(p.currency) && ["maturity", "duration"].includes(p.basis)
    && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && typeof p.recorded === "string" && typeof p.thesis === "string" && (p.closed === null || typeof p.closed === "string")
    && [p.amount, p.yield, p.swap, p.spread, p.duration, p.target, p.stop, p.horizon].every(Number.isFinite) && p.amount > 0 && p.duration > 0;
}
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}
function Kpi({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="kpi"><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div><div className="kpi-foot">{detail}</div></div>;
}

export function SwapSpreadsDashboard({ data }: { data: SpreadData }) {
  const [currency, setCurrency] = useState<"CLP" | "UF">("CLP");
  const [basis, setBasis] = useState<SpreadBasis>("maturity");
  const [years, setYears] = useState(3), [months, setMonths] = useState(3), [code, setCode] = useState("");
  const [query, setQuery] = useState(""), [sort, setSort] = useState("term"), [minDuration, setMinDuration] = useState(""), [maxDuration, setMaxDuration] = useState("");
  const [swapShock, setSwapShock] = useState(0), [target, setTarget] = useState("");
  const [ufPct, setUfPct] = useState(0), [costs, setCosts] = useState(0), [funding, setFunding] = useState(0), [hedged, setHedged] = useState(false);
  const [amount, setAmount] = useState(100000000), [stop, setStop] = useState(""), [thesis, setThesis] = useState("");
  const [positions, setPositions] = useState<Position[]>([]), [ready, setReady] = useState(false), [storageError, setStorageError] = useState(""), [message, setMessage] = useState("");
  useEffect(() => {
    try { const raw = localStorage.getItem(STORE); if (raw) { const parsed: unknown = JSON.parse(raw); if (!Array.isArray(parsed) || !parsed.every(validPosition)) throw new Error(); setPositions(parsed); } setReady(true); }
    catch { setStorageError("No se pudo leer la bitácora local. Exporta o revisa los datos antes de guardar nuevas posiciones."); }
  }, []);
  function persist(next: Position[]) {
    try { localStorage.setItem(STORE, JSON.stringify(next)); setPositions(next); setMessage("Bitácora guardada en este navegador."); }
    catch { setStorageError("No se pudo guardar. Descarga un respaldo antes de salir."); }
  }
  const rows = useMemo(() => data.bonds.filter(b => b.currency === currency).map(b => {
    const points = windowPoints(b, years, data.asOf, basis), last = points.at(-1), summary = stats(points.map(p => spreadValue(p, basis)!));
    return { bond: b, points, last, summary };
  }).filter(r => r.last), [data, currency, years, basis]);
  const visible = rows.filter(r => r.bond.code.toLowerCase().includes(query.toLowerCase()) && (!minDuration || r.last!.macaulay / (1 + r.last!.yield / 100) >= Number(minDuration)) && (!maxDuration || r.last!.macaulay / (1 + r.last!.yield / 100) <= Number(maxDuration)))
    .sort((a, b) => sort === "spread" ? spreadValue(b.last!, basis)! - spreadValue(a.last!, basis)! : sort === "z" ? (b.summary?.z ?? -Infinity) - (a.summary?.z ?? -Infinity) : a.last!.term - b.last!.term);
  const selected = rows.find(r => r.bond.code === code) ?? rows[0];
  const last = selected?.last, summary = selected?.summary;
  const model = useMemo(() => selected ? meanReversion(selected.points, basis, months) : null, [selected, basis, months]);
  const currentSpread = last ? spreadValue(last, basis)! : 0;
  const modified = last ? last.macaulay / (1 + last.yield / 100) : 0;
  const peerCurve = rows.filter(r => r.last?.date === last?.date).map(r => ({ x: r.last!.term, y: r.last!.spread, code: r.bond.code }));
  const swapCurve = rows.filter(r => r.last?.date === last?.date).map(r => ({ x: r.last!.term, y: r.last!.swap }));
  const futureSwap = last && basis === "maturity" ? interpolate(last.term - months / 12, swapCurve) : null;
  const futureSpread = last && basis === "maturity" ? interpolate(last.term - months / 12, peerCurve) : null;
  const rollBaseBp = futureSwap === null || !last ? null : (last.swap - futureSwap) * 100;
  const rollSpreadBp = futureSpread === null || !last ? null : last.spread - futureSpread;
  const neutralSpread = currentSpread - (rollSpreadBp ?? 0);
  const targetSpread = target !== "" ? Number(target) : model?.supported ? model.forecast! : neutralSpread;
  const result = last ? scenario({ y: last.yield, duration: modified, months, rollBaseBp: rollBaseBp ?? 0, rollSpreadBp: rollSpreadBp ?? 0,
    swapBp: hedged ? 0 : swapShock, spreadBp: targetSpread - neutralSpread, ufPct: currency === "UF" ? ufPct : 0, costsBp: costs }) : null;
  // Financiamiento es una tasa efectiva anual hipotética introducida por el usuario.
  const fundingCost = (Math.pow(1 + funding / 100, months / 12) - 1) * 100;
  // Para cobertura, el carry neto exige flujos de ambas patas: no se sustituye por TIR del bono.
  const directionalTotal = result ? result.total - fundingCost : null;
  const chart = selected?.points.map(p => ({ date: p.date, spread: spreadValue(p, basis), yield: p.yield,
    swap: basis === "maturity" ? p.swap : p.yield - p.durationSpread! / 100 })) ?? [];
  function choose(next: string) { setCode(next); setTarget(""); setStop(""); setThesis(""); setMessage(""); }
  function savePosition() {
    if (!selected || !last || !ready || storageError) return;
    const stopValue = stop === "" ? currentSpread + 20 : Number(stop);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(targetSpread) || !Number.isFinite(stopValue) || !thesis.trim()) { setMessage("Ingresa un monto positivo, objetivo, límite y tesis válidos."); return; }
    if (targetSpread >= currentSpread || stopValue <= currentSpread) { setMessage("Para esta ficha de compresión, el objetivo debe ser menor al spread de entrada y el límite mayor."); return; }
    persist([...positions, { id: crypto.randomUUID(), code: selected.bond.code, currency, basis, date: last.date,
      recorded: new Date().toISOString(), amount, yield: last.yield, swap: last.yield - currentSpread / 100, spread: currentSpread, duration: modified,
      target: targetSpread, stop: stopValue, horizon: months, thesis: thesis.trim(), closed: null }]);
  }
  if (!data.bonds.length) return <AppShell><header className="page-head"><h1>Swap Spreads</h1></header><section className="panel"><p>No hay observaciones comparables disponibles.</p>{data.errors.map(e => <p key={e}>{e}</p>)}</section></AppShell>;

  return <AppShell><div className="ss-page">
    <header className="page-head"><div><div className="eyebrow">Valor relativo · Cartera propia</div><h1>Swap Spreads</h1><p>Valorización, reversión a la media y seguimiento de bonos gobierno contra Cámara.</p></div><span className="pill">Datos al {dateLabel(data.asOf)}</span></header>
    <section className="panel ss-controls" aria-label="Filtros de análisis">
      <label>Moneda<select value={currency} onChange={e => { setCurrency(e.target.value as "CLP" | "UF"); choose(""); setUfPct(0); }}><option>CLP</option><option>UF</option></select></label>
      <label>Comparación<select value={basis} onChange={e => { setBasis(e.target.value as SpreadBasis); setTarget(""); setStop(""); }}><option value="maturity">Por vencimiento</option><option value="duration">Por duración (aproximada)</option></select></label>
      <label>Ventana histórica<select value={years} onChange={e => setYears(Number(e.target.value))}><option value={1}>1 año</option><option value={3}>3 años</option><option value={5}>5 años</option></select></label>
      <label>Buscar papel<input value={query} onChange={e => setQuery(e.target.value)} placeholder="BTP / BTU…" /></label>
      <label>Dur. mod. mínima<input type="number" min="0" step="0.5" value={minDuration} onChange={e => setMinDuration(e.target.value)} placeholder="Sin mínimo" /></label>
      <label>Dur. mod. máxima<input type="number" min="0" step="0.5" value={maxDuration} onChange={e => setMaxDuration(e.target.value)} placeholder="Sin máximo" /></label>
      <label>Ordenar<select value={sort} onChange={e => setSort(e.target.value)}><option value="term">Plazo</option><option value="spread">Mayor spread</option><option value="z">Mayor z-score</option></select></label>
    </section>
    <p className="ss-caption">Spread = papel − swap, en pb. Tasas del mismo día; interpolación sin extrapolación. Son spreads indicativos, no asset swap spreads de flujos. {basis === "duration" && "La duración swap se aproxima con una pata fija par semestral."}</p>
    {data.errors.length > 0 && <p role="status" className="model-notice">{data.errors.join(" ")}</p>}
    <section className="panel"><div className="panel-head"><h2>Comparador de papeles</h2><span className="pill">{visible.length} instrumentos</span></div>
      <div className="table-wrap"><table className="market-table ss-table"><thead><tr><th>Papel</th><th>Fecha</th><th>Dur. mod.</th><th>TIR %</th><th>Swap %</th><th>Spread pb</th><th>Δ obs. pb</th><th>Δ 1S pb</th><th>Δ 1M pb</th><th>Media pb</th><th>Z-score</th><th>Percentil</th><th>Obs.</th></tr></thead>
        <tbody>{visible.map(r => { const p = r.last!, s = r.summary; return <tr key={r.bond.code} className={selected?.bond.code === r.bond.code ? "ss-selected" : ""}><td><button className="ss-paper" aria-pressed={selected?.bond.code === r.bond.code} onClick={() => choose(r.bond.code)}>{r.bond.code}</button></td><td>{dateLabel(p.date)}{p.date < data.asOf && <span className="ss-stale"> Desfasado</span>}</td><td>{fmt(p.macaulay / (1 + p.yield / 100))}</td><td>{fmt(p.yield, 3)}</td><td>{fmt(p.yield - spreadValue(p, basis)! / 100, 3)}</td><td><strong>{fmt(spreadValue(p, basis))}</strong></td><td>{fmt(change(r.points, basis, 1))}</td><td>{fmt(change(r.points, basis, 7))}</td><td>{fmt(change(r.points, basis, 30))}</td><td>{fmt(s?.mean)}</td><td>{fmt(s?.z)}</td><td>{fmt(s?.percentile, 0)}%</td><td>{s?.n ?? 0}</td></tr>; })}</tbody>
      </table></div>{visible.length === 0 && <p>No hay papeles para estos filtros.</p>}
      <button className="ss-button" onClick={() => download("swap-spreads.csv", "\uFEFF" + ["Papel;Fecha;Duracion_modificada;TIR_pct;Spread_pb;Z_score", ...visible.map(r => [r.bond.code, r.last!.date, fmt(r.last!.macaulay / (1 + r.last!.yield / 100), 6), fmt(r.last!.yield, 6), fmt(spreadValue(r.last!, basis), 6), fmt(r.summary?.z, 6)].join(";"))].join("\n"), "text/csv;charset=utf-8")}>Exportar comparador CSV</button>
    </section>
    {selected && last && <>
      <section className="panel ss-detail"><div className="panel-head"><div><div className="eyebrow">Ficha analítica</div><h2>{selected.bond.code} · {currency}</h2></div><label className="ss-picker">Papel<select value={selected.bond.code} onChange={e => choose(e.target.value)}>{rows.map(r => <option key={r.bond.code}>{r.bond.code}</option>)}</select></label></div>
        <p className="ss-caption">Vencimiento {dateLabel(selected.bond.maturity)} · Último par comparable {dateLabel(last.date)} · {selected.bond.missing} observaciones omitidas en hasta 5 años por datos incompletos o fuera de curva.</p>
        <div className="kpi-grid ss-kpis"><Kpi label="Spread actual" value={`${fmt(currentSpread)} pb`} detail={`Media: ${fmt(summary?.mean)} · Mediana: ${fmt(summary?.median)} pb`} /><Kpi label="Desviación histórica" value={`${fmt(summary?.z)} σ`} detail={`Percentil ${fmt(summary?.percentile, 0)} · ${summary?.n ?? 0} observaciones`} /><Kpi label="Vida media estimada" value={model?.halfLife != null ? `${fmt(model.halfLife, 0)} ruedas` : "—"} detail={`AR(1): φ = ${fmt(model?.phi, 4)}`} /><Kpi label="Diagnóstico AR(1)" value={model?.supported ? "Señal preliminar" : "No validada"} detail={model?.supported ? "φ distinguible de 1 y mejor RMSE diario que paseo aleatorio." : "No hay respaldo suficiente para usar reversión automáticamente."} /></div>
        <div className="ss-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" minTickGap={60} tickFormatter={dateLabel} /><YAxis domain={["auto", "auto"]} width={65} unit=" pb" /><Tooltip labelFormatter={v => dateLabel(String(v))} formatter={(v: number) => fmt(v)} /><Legend /><ReferenceLine y={summary?.mean} stroke="#94a3b8" strokeDasharray="5 5" label="Media" />{summary && <><ReferenceLine y={summary.mean + 2 * summary.sd} stroke="#cbd5e1" strokeDasharray="3 3" /><ReferenceLine y={summary.mean - 2 * summary.sd} stroke="#cbd5e1" strokeDasharray="3 3" /></>}<Line name="Papel − swap (pb)" type="linear" dataKey="spread" stroke="#2563eb" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>
        <p className="ss-caption">Bandas históricas ±2σ; no son intervalos de predicción. Historia del mismo bono con plazo decreciente, no una serie a plazo constante.</p>
        <div className="two-col"><div><h3>Tasas comparables</h3><div className="ss-chart ss-chart-small"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" minTickGap={70} tickFormatter={dateLabel} /><YAxis domain={["auto", "auto"]} unit="%" /><Tooltip formatter={(v: number) => `${fmt(v, 3)}%`} /><Legend /><Line name="Papel" dataKey="yield" stroke="#2563eb" dot={false} isAnimationActive={false} /><Line name="Swap" dataKey="swap" stroke="#0d9488" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div></div>
          <div><h3>Curva de spreads por vencimiento</h3><div className="ss-chart ss-chart-small"><ResponsiveContainer width="100%" height="100%"><ScatterChart><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" dataKey="x" name="Plazo" unit="a" /><YAxis type="number" dataKey="y" name="Spread" unit=" pb" /><Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }) => active && payload?.length ? <div className="curve-tooltip">{payload[0].payload.code}<br />{fmt(payload[0].payload.y)} pb</div> : null} /><Scatter name="Papeles misma fecha" data={peerCurve} fill="#94a3b8" /><Scatter name="Seleccionado" data={[{ x: last.term, y: last.spread, code: selected.bond.code }]} fill="#2563eb" /></ScatterChart></ResponsiveContainer></div></div></div>
      </section>
      <section className="panel"><div className="panel-head"><h2>Carry, roll-down y escenarios</h2></div>
        <div className="ss-controls"><label>Horizonte<select value={months} onChange={e => setMonths(Number(e.target.value))}>{[1, 3, 6].map(h => <option key={h} value={h}>{h} mes{h > 1 ? "es" : ""}</option>)}</select></label><label>Modalidad<select value={hedged ? "hedged" : "cash"} onChange={e => setHedged(e.target.value === "hedged")}><option value="cash">Bono sin cobertura</option><option value="hedged">Sensibilidad con cobertura DV01</option></select></label><label>Monto equivalente CLP<input type="number" min="1" value={amount} onChange={e => setAmount(Number(e.target.value))} /></label><label>Δ swap (pb)<input type="number" value={swapShock} disabled={hedged} onChange={e => setSwapShock(Number(e.target.value))} /></label><label>Spread objetivo (pb)<input type="number" step="0.1" value={target} placeholder={fmt(targetSpread)} onChange={e => setTarget(e.target.value)} /></label><label>Costos totales (pb del monto)<input type="number" min="0" value={costs} onChange={e => setCosts(Math.max(0, Number(e.target.value)))} /></label>{!hedged && <label>Financiamiento CLP anual efectivo (%)<input type="number" min="0" value={funding} onChange={e => setFunding(Math.max(0, Number(e.target.value)))} /></label>}{currency === "UF" && <label>Reajuste UF en el horizonte (%)<input type="number" step="0.1" min="-99" value={ufPct} onChange={e => setUfPct(Math.max(-99, Number(e.target.value)))} /></label>}</div>
        <p className="ss-caption">AR(1) a {months} meses: {fmt(model?.forecast)} pb; intervalo condicional aproximado 95%: {fmt(model?.forecast != null && model.band != null ? model.forecast - model.band : null)} a {fmt(model?.forecast != null && model.band != null ? model.forecast + model.band : null)} pb. Excluye incertidumbre de parámetros. Objetivo final: {fmt(targetSpread)} pb ({target !== "" ? "manual" : model?.supported ? "del modelo" : "solo roll-down, sin convergencia adicional"}).</p>
        <p className="ss-caption">Validación diaria fuera de muestra: RMSE AR {fmt(model?.rmseAR)} pb vs. paseo aleatorio {fmt(model?.rmseRW)} pb ({model?.tests ?? 0} pruebas). No valida por sí sola el retorno a {months} meses ni la estabilidad futura.</p>
        {(basis === "duration" || futureSwap === null || futureSpread === null) && <p className="model-notice">Roll-down no disponible para esta comparación u horizonte. Se omite del subtotal. Usa comparación por vencimiento dentro de la curva observable.</p>}
        {result && !hedged && <><div className="table-wrap"><table className="market-table"><thead><tr><th>Componente</th><th>% del monto</th><th>CLP aproximados</th></tr></thead><tbody>{[["Carry (devengo efectivo)", result.carry], ["Roll-down curva swap", rollBaseBp === null ? null : result.rollBase], ["Roll-down curva de spreads", rollSpreadBp === null ? null : result.rollSpread], ["Movimiento de tasa swap", result.rates], ["Convergencia adicional de spread", result.convergence], ["Reajuste UF y efecto cruzado", currency === "UF" ? result.uf : 0], ["Financiamiento CLP", -fundingCost], ["Costos", result.costs], [rollBaseBp === null || rollSpreadBp === null ? "Subtotal neto (sin roll-down)" : "Retorno neto aproximado", directionalTotal]].map(([label, value]) => <tr key={String(label)}><td>{label}</td><td>{fmt(value as number | null)}%</td><td>{value == null ? "—" : money(amount * Number(value) / 100)}</td></tr>)}</tbody></table></div><p className="ss-caption">UF: supuesto manual {fmt(ufPct)}% en el horizonte, solo aplicado a BTU. Financiamiento por defecto 0%: recursos propios. No incluye costo de oportunidad. Duración modificada = Macaulay RiskAmerica / (1 + TIR anual).</p></>}
        {hedged && <p className="model-notice">Cobertura teórica de primer orden por DV01, no contratación de un swap. Se muestra solo sensibilidad al spread: {fmt(-modified * (targetSpread - currentSpread) / 100)}% antes de costos. Para calcular carry y retorno neto cubierto faltan flujos de ambas patas, financiación, garantías y DV01 por tramo; no se presenta un total artificial.</p>}
        <p className="ss-caption">Roll-down: curvas actuales sin cambios, interpoladas entre bonos de la misma fecha; el bono conserva su desajuste particular. Spread neutral tras roll-down: {fmt(neutralSpread)} pb. La convergencia adicional es objetivo final menos spread neutral, para evitar doble conteo. Aproximación con duración actual; excluye convexidad y flujos exactos.</p>
        <h3>Sensibilidad {hedged ? "cubierta" : "sin cobertura"} · % por movimientos de tasas</h3><div className="table-wrap"><table className="market-table"><thead><tr><th>Δ swap / Δ spread</th>{[-20, -10, 0, 10, 20].map(s => <th key={s}>{s > 0 ? "+" : ""}{s} pb</th>)}</tr></thead><tbody>{(hedged ? [0] : [-50, -25, 0, 25, 50]).map(r => <tr key={r}><td>{r > 0 ? "+" : ""}{r} pb</td>{[-20, -10, 0, 10, 20].map(s => { const v = -modified * (r + s) / 100; return <td key={s} className={v < 0 ? "ss-loss" : "ss-gain"}>{fmt(v)}%</td>; })}</tr>)}</tbody></table></div><p className="ss-caption">Solo efecto de sensibilidad: −Dmod × (Δ swap + Δ spread). Excluye carry, roll-down, UF, financiación y costos.</p>
      </section>
      <section className="panel"><h2>Registrar tesis de compresión</h2><p className="ss-caption">Registro analítico con la última observación disponible, no confirmación de una ejecución. Se conservan fecha, objetivo y límite originales. La ficha registra el bono; cualquier cobertura ejecutada debe controlarse además con sus flujos reales.</p>
        <div className="ss-controls"><label>Límite de ampliación (pb)<input type="number" step="0.1" value={stop} placeholder={fmt(currentSpread + 20)} onChange={e => setStop(e.target.value)} /></label><label className="ss-thesis">Tesis y condición de salida<textarea value={thesis} onChange={e => setThesis(e.target.value)} placeholder="Por qué debería converger y qué invalidaría la tesis…" /></label></div><button className="ss-button ss-primary" disabled={!ready || !!storageError} onClick={savePosition}>Guardar posición en seguimiento</button>
      </section>
    </>}
    <section className="panel"><div className="panel-head"><h2>Bitácora de posiciones</h2><button className="ss-button" disabled={!positions.length} onClick={() => download("swap-spreads-bitacora.json", JSON.stringify(positions, null, 2), "application/json")}>Descargar respaldo</button></div><p className="ss-caption">Guardada solo en este navegador y dispositivo, sin sincronización entre usuarios. Exporta un respaldo para conservarla.</p>
      <label className="ss-import">Restaurar respaldo JSON <input type="file" accept="application/json,.json" disabled={!ready || !!storageError} onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { const incoming: unknown = JSON.parse(await file.text()); if (!Array.isArray(incoming) || !incoming.every(validPosition)) throw new Error(); const merged = new Map(positions.map(p => [p.id, p])); incoming.forEach(p => { if (!merged.has(p.id)) merged.set(p.id, p); }); persist([...merged.values()]); } catch { setMessage("Respaldo inválido; no se modificó la bitácora."); } e.target.value = ""; }} /></label>
      {storageError && <p role="alert" className="model-notice">{storageError}</p>}{message && <p role="status">{message}</p>}
      {!positions.length ? <p className="ss-caption">No hay posiciones registradas. Selecciona un papel, define objetivo y límite, y guarda tu tesis.</p> : <div className="table-wrap"><table className="market-table ss-journal"><thead><tr><th>Papel / entrada</th><th>Monto CLP</th><th>Spread entrada / actual</th><th>Objetivo / límite</th><th>Tasas / spread (CLP)</th><th>Estado / tesis</th><th>Acción</th></tr></thead><tbody>{positions.map(p => {
        const current = data.bonds.find(b => b.code === p.code)?.points.filter(v => v.date >= p.date && (!p.closed || v.date <= p.closed)).at(-1), s = current ? spreadValue(current, p.basis) : null;
        const deltaSwap = current && s !== null ? (current.yield - s / 100 - p.swap) * 100 : null;
        const deltaSpread = s === null ? null : s - p.spread;
        const elapsed = current ? (time(current.date) - time(p.date)) / DAY : 0;
        const state = p.closed ? `Cerrada ${dateLabel(p.closed)}` : s === null ? "Sin dato comparable" : s <= p.target ? "Objetivo alcanzado" : s >= p.stop ? "Límite alcanzado" : elapsed >= p.horizon * 365 / 12 ? "Revisar horizonte" : "En seguimiento";
        return <tr key={p.id}><td><strong>{p.code}</strong><br />{dateLabel(p.date)} · {p.currency}<br />{p.basis === "maturity" ? "Vencimiento" : "Duración"}</td><td>{money(p.amount)}</td><td>{fmt(p.spread)} / {fmt(s)} pb<br />{dateLabel(current?.date ?? "")}</td><td>{fmt(p.target)} / {fmt(p.stop)} pb</td><td>{deltaSwap === null ? "—" : money(-p.amount * p.duration * deltaSwap / 10000)} / {deltaSpread === null ? "—" : money(-p.amount * p.duration * deltaSpread / 10000)}</td><td><strong>{state}</strong><p className="ss-thesis-text">{p.thesis}</p></td><td>{!p.closed && current && <button className="ss-button" onClick={() => persist(positions.map(v => v.id === p.id ? { ...v, closed: current.date } : v))}>Cerrar seguimiento</button>}</td></tr>;
      })}</tbody></table></div>}<p className="ss-caption">Atribución aproximada de valorización con duración de entrada y monto equivalente CLP constante. Excluye carry, roll-down, reajuste UF, cobertura y costos; no es P&amp;L contable. Cerrar seguimiento conserva la tesis y fija la fecha del último dato disponible.</p>
    </section>
    <details className="panel ss-method"><summary>Metodología y calidad del análisis</summary><p>Bonos: RiskAmerica (TIR anual efectiva y duración Macaulay); swap: históricos Cámara Bloomberg CLP/UF. Se cruzan fechas exactas sin rellenar ausencias ni extrapolar. Vencimiento desde el nemotécnico con día 1, según la convención del proyecto.</p><p>Los z-scores usan la ventana seleccionada y mínimo dos observaciones. AR(1) exige 60 pares de ruedas consecutivas de lunes a viernes; omite saltos, pero no ajusta explícitamente feriados. Horizonte: 21 ruedas por mes. El criterio φ + 1,96 × error estándar &lt; 1 es un diagnóstico aproximado, no una prueba formal de estacionariedad. La validación walk-forward compara pronósticos diarios con paseo aleatorio y no valida estrategias netas de costos.</p><p>Las señales preliminares no garantizan convergencia. Revisa cambios de régimen, liquidez, oferta de bonos y estabilidad de parámetros entre ventanas. Un spread alto no implica automáticamente compra. Las curvas de roll-down usan la sección transversal actual; no hay backtest con integrantes actuales ni historia sintética a plazo constante.</p></details>
  </div></AppShell>;
}

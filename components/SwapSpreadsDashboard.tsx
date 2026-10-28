"use client";

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "./AppShell";
import { BondSwapStrategy } from "./BondSwapStrategy";
import { change, DAY, distinctCurve, interpolate, meanReversionSeries, referenceValue, residualValue, residualScenario, spreadValue, stats, time, windowPoints, type SpreadBasis, type SpreadData } from "@/lib/swap-spreads";

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

function ConstantMaturityPanel({ data, currency, years }: { data: SpreadData; currency: "CLP" | "UF"; years: number }) {
  const [tenor, setTenor] = useState(3);
  const series = data.constantSpreads.find(s => s.currency === currency && s.tenor === tenor);
  const points = series?.points.filter(p => time(p.date) >= time(data.asOf) - years * 365.25 * DAY && p.date <= data.asOf) ?? [];
  const last = points.at(-1), summary = points.length >= 60 ? stats(points.map(p => p.spread)) : null;
  return <section className="panel"><div className="panel-head"><div><div className="eyebrow">Valorización del tramo · {currency}</div><h2>Spreads a plazo constante</h2></div><label className="ss-picker">Plazo fijo<select value={tenor} onChange={e => setTenor(Number(e.target.value))}>{[1, 2, 3, 5, 10].map(t => <option key={t} value={t}>{t} año{t > 1 ? "s" : ""}</option>)}</select></label></div>
    <p className="ss-caption">Cada fecha compara el mismo plazo de {tenor} años, interpolando la curva de spreads CLP o UF de ese día. Cambian los papeles utilizados, no el plazo analizado. Esta sección siempre usa vencimiento, incluso si la ficha está en modo duración.</p>
    <div className="kpi-grid ss-kpis"><Kpi label={`Spread ${tenor} años`} value={`${fmt(last?.spread)} pb`} detail={`Última observación: ${dateLabel(last?.date ?? "")}`} /><Kpi label="Media del mismo plazo" value={`${fmt(summary?.mean)} pb`} detail={`${points.length} observaciones · ventana ${years} años`} /><Kpi label="Z-score del tramo" value={`${fmt(summary?.z)} σ`} detail="Comparación homogénea por vencimiento" /><Kpi label="Percentil del tramo" value={`${fmt(summary?.percentile, 0)}%`} detail="Mínimo 60 observaciones para estadísticas" /></div>
    {last && last.date < data.asOf && <p className="model-notice">No hay cobertura de curva para este plazo en la fecha de cierre. El último valor mostrado es histórico, no actual.</p>}
    {!points.length ? <p>No hay suficientes bonos para enmarcar este plazo sin extrapolar.</p> : <div className="ss-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={points}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={dateLabel} minTickGap={60} /><YAxis unit=" pb" domain={["auto", "auto"]} width={65} /><Tooltip labelFormatter={v => dateLabel(String(v))} formatter={(v: number) => fmt(v)} /><Legend /><ReferenceLine y={summary?.mean} stroke="#94a3b8" strokeDasharray="5 5" /><Line dataKey="spread" name={`Spread ${tenor} años constante (pb)`} stroke="#0d9488" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>}
    <p className="ss-caption">Cobertura observada: {dateLabel(points[0]?.date ?? "")} a {dateLabel(last?.date ?? "")}; puede ser menor que la ventana solicitada. Sin extrapolación ni arrastre de cotizaciones. Se incluyen los bonos disponibles en los archivos históricos que estaban vigentes en cada fecha, incluidos los hoy vencidos. Los cambios de composición, cupón y liquidez pueden influir en la curva.</p>
  </section>;
}

export function SwapSpreadsDashboard({ data }: { data: SpreadData }) {
  const [currency, setCurrency] = useState<"CLP" | "UF">("CLP");
  const [basis, setBasis] = useState<SpreadBasis>("maturity");
  const [years, setYears] = useState(3), [months, setMonths] = useState(3), [code, setCode] = useState("");
  const [query, setQuery] = useState(""), [sort, setSort] = useState("term"), [minDuration, setMinDuration] = useState(""), [maxDuration, setMaxDuration] = useState("");
  const [target, setTarget] = useState("");
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
    const points = windowPoints(b, years, data.asOf, basis), last = points.at(-1);
    const signals = points.flatMap(p => { const value = residualValue(p, basis); return value === null ? [] : [{ date: p.date, value }]; });
    const summary = signals.length >= 60 && signals.at(-1)?.date === last?.date ? stats(signals.map(p => p.value)) : null;
    return { bond: b, points, last, signals, summary };
  }).filter(r => r.last), [data, currency, years, basis]);
  const visible = rows.filter(r => r.bond.code.toLowerCase().includes(query.toLowerCase()) && (!minDuration || r.last!.macaulay / (1 + r.last!.yield / 100) >= Number(minDuration)) && (!maxDuration || r.last!.macaulay / (1 + r.last!.yield / 100) <= Number(maxDuration)))
    .sort((a, b) => sort === "spread" ? spreadValue(b.last!, basis)! - spreadValue(a.last!, basis)! : sort === "z" ? (b.summary?.z ?? -Infinity) - (a.summary?.z ?? -Infinity) : a.last!.term - b.last!.term);
  const selected = rows.find(r => r.bond.code === code) ?? rows.find(r => r.last?.date === data.asOf && residualValue(r.last, basis) !== null) ?? rows[0];
  const last = selected?.last, summary = selected?.summary;
  const model = useMemo(() => selected && selected.signals.at(-1)?.date === selected.last?.date ? meanReversionSeries(selected.signals, months) : null, [selected, months]);
  const currentSpread = last ? spreadValue(last, basis)! : 0;
  const currentResidual = last ? residualValue(last, basis) : null;
  const currentReference = last ? referenceValue(last, basis) : null;
  const modified = last ? last.macaulay / (1 + last.yield / 100) : 0;
  const peerCurve = rows.filter(r => r.last?.date === last?.date).map(r => ({ x: r.last!.term, y: r.last!.spread, code: r.bond.code }));
  const referenceCurve = distinctCurve(peerCurve.filter(p => p.code !== selected?.bond.code));
  const futureSpread = last && basis === "maturity" && currentReference !== null ? interpolate(last.term - months / 12, referenceCurve) : null;
  const relative = currentReference !== null && futureSpread !== null ? residualScenario(currentSpread, currentReference, futureSpread, model?.supported ? model.forecast : null) : null;
  const neutralSpread = relative?.neutralSpread ?? currentSpread;
  const targetSpread = target !== "" ? Number(target) : relative?.targetSpread ?? neutralSpread;
  const chart = selected?.points.map(p => ({ date: p.date, spread: spreadValue(p, basis), yield: p.yield,
    residual: residualValue(p, basis), reference: referenceValue(p, basis), swap: basis === "maturity" ? p.swap : p.yield - p.durationSpread! / 100 })) ?? [];
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
    {selected && last && (
      <BondSwapStrategy key={`${selected.bond.code}:${last.date}`} bond={selected.bond} last={last} universe={data.bonds} market={data.strategyMarket}
        signals={windowPoints(selected.bond, years, data.asOf, "maturity").flatMap(p => p.residual == null ? [] : [{ date: p.date, value: p.residual }])} onMarketValue={setAmount} onBondChange={choose} selectableBonds={rows.map(r => r.bond)} />
    )}
    <section className="panel ss-controls" aria-label="Filtros de análisis">
      <label>Moneda<select value={currency} onChange={e => { setCurrency(e.target.value as "CLP" | "UF"); choose(""); }}><option>CLP</option><option>UF</option></select></label>
      <label>Comparación<select value={basis} onChange={e => { setBasis(e.target.value as SpreadBasis); setTarget(""); setStop(""); }}><option value="maturity">Por vencimiento</option><option value="duration">Por duración (aproximada)</option></select></label>
      <label>Ventana histórica<select value={years} onChange={e => setYears(Number(e.target.value))}><option value={1}>1 año</option><option value={3}>3 años</option><option value={5}>5 años</option></select></label>
      <label>Buscar papel<input value={query} onChange={e => setQuery(e.target.value)} placeholder="BTP / BTU…" /></label>
      <label>Dur. mod. mínima<input type="number" min="0" step="0.5" value={minDuration} onChange={e => setMinDuration(e.target.value)} placeholder="Sin mínimo" /></label>
      <label>Dur. mod. máxima<input type="number" min="0" step="0.5" value={maxDuration} onChange={e => setMaxDuration(e.target.value)} placeholder="Sin máximo" /></label>
      <label>Ordenar<select value={sort} onChange={e => setSort(e.target.value)}><option value="term">Plazo</option><option value="spread">Mayor spread</option><option value="z">Mayor z-score ajustado</option></select></label>
    </section>
    <p className="ss-caption">Spread = papel − swap, en pb. Tasas del mismo día; interpolación sin extrapolación. Son spreads indicativos, no asset swap spreads de flujos. {basis === "duration" && "La duración swap se aproxima con una pata fija par semestral."}</p>
    {data.errors.length > 0 && <p role="status" className="model-notice">{data.errors.join(" ")}</p>}
    <section className="panel"><div className="panel-head"><h2>Comparador de papeles</h2><span className="pill">{visible.length} instrumentos</span></div>
      <div className="table-wrap"><table className="market-table ss-table"><thead><tr><th>Papel</th><th>Fecha</th><th>Dur. mod.</th><th>TIR %</th><th>Swap %</th><th>Spread pb</th><th>Δ obs. pb</th><th>Δ 1S pb</th><th>Δ 1M pb</th><th>Curva ref. pb</th><th>Desajuste pb</th><th>Z ajustado</th><th>Percentil ajustado</th><th>Obs. ajustadas</th></tr></thead>
        <tbody>{visible.map(r => { const p = r.last!, s = r.summary; return <tr key={r.bond.code} className={selected?.bond.code === r.bond.code ? "ss-selected" : ""}><td><button className="ss-paper" aria-pressed={selected?.bond.code === r.bond.code} onClick={() => choose(r.bond.code)}>{r.bond.code}</button></td><td>{dateLabel(p.date)}{p.date < data.asOf && <span className="ss-stale"> Desfasado</span>}</td><td>{fmt(p.macaulay / (1 + p.yield / 100))}</td><td>{fmt(p.yield, 3)}</td><td>{fmt(p.yield - spreadValue(p, basis)! / 100, 3)}</td><td><strong>{fmt(spreadValue(p, basis))}</strong></td><td>{fmt(change(r.points, basis, 1))}</td><td>{fmt(change(r.points, basis, 7))}</td><td>{fmt(change(r.points, basis, 30))}</td><td>{fmt(referenceValue(p, basis))}</td><td>{fmt(residualValue(p, basis))}</td><td>{fmt(s?.z)}</td><td>{fmt(s?.percentile, 0)}%</td><td>{r.signals.length}</td></tr>; })}</tbody>
      </table></div>{visible.length === 0 && <p>No hay papeles para estos filtros.</p>}
      <button className="ss-button" onClick={() => download("swap-spreads.csv", "\uFEFF" + ["Papel;Fecha;Duracion_modificada;TIR_pct;Spread_pb;Referencia_pb;Desajuste_pb;Z_ajustado", ...visible.map(r => [r.bond.code, r.last!.date, fmt(r.last!.macaulay / (1 + r.last!.yield / 100), 6), fmt(r.last!.yield, 6), fmt(spreadValue(r.last!, basis), 6), fmt(referenceValue(r.last!, basis), 6), fmt(residualValue(r.last!, basis), 6), fmt(r.summary?.z, 6)].join(";"))].join("\n"), "text/csv;charset=utf-8")}>Exportar comparador CSV</button>
    </section>
    <ConstantMaturityPanel data={data} currency={currency} years={years} />
    {selected && last && <>
      <section className="panel ss-detail"><div className="panel-head"><div><div className="eyebrow">Ficha analítica</div><h2>{selected.bond.code} · {currency}</h2></div><label className="ss-picker">Papel<select value={selected.bond.code} onChange={e => choose(e.target.value)}>{rows.map(r => <option key={r.bond.code}>{r.bond.code}</option>)}</select></label></div>
        <p className="ss-caption">Vencimiento {dateLabel(selected.bond.maturity)} · Último par comparable {dateLabel(last.date)} · {selected.bond.missing} observaciones omitidas en hasta 5 años por datos incompletos o fuera de curva.</p>
        <div className="kpi-grid ss-kpis"><Kpi label="Spread actual" value={`${fmt(currentSpread)} pb`} detail={`Referencia por plazo/duración: ${fmt(currentReference)} pb`} /><Kpi label="Desajuste frente a pares" value={`${fmt(currentResidual)} pb`} detail={`Z ajustado ${fmt(summary?.z)} · Percentil ${fmt(summary?.percentile, 0)}`} /><Kpi label="Vida media estimada" value={model?.halfLife != null ? `${fmt(model.halfLife, 0)} ruedas` : "—"} detail={`AR(1) del desajuste: φ = ${fmt(model?.phi, 4)}`} /><Kpi label="Diagnóstico AR(1)" value={model?.supported ? "Señal preliminar" : "No validada"} detail={model?.supported ? "φ distinguible de 1 y mejor RMSE diario que paseo aleatorio." : "Sin respaldo suficiente para revertir el desajuste automáticamente."} /></div>
        {currentResidual === null && <p className="model-notice">Sin referencia de pares en la última fecha: no hay bonos suficientes que enmarquen el plazo/duración sin extrapolar. No se genera señal de reversión ni objetivo automático.</p>}
        <div className="ss-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" minTickGap={60} tickFormatter={dateLabel} /><YAxis domain={["auto", "auto"]} width={65} unit=" pb" /><Tooltip labelFormatter={v => dateLabel(String(v))} formatter={(v: number) => fmt(v)} /><Legend /><ReferenceLine y={summary?.mean} stroke="#94a3b8" strokeDasharray="5 5" label="Media" />{summary && <><ReferenceLine y={summary.mean + 2 * summary.sd} stroke="#cbd5e1" strokeDasharray="3 3" /><ReferenceLine y={summary.mean - 2 * summary.sd} stroke="#cbd5e1" strokeDasharray="3 3" /></>}<Line name="Desajuste papel − curva de pares (pb)" type="linear" dataKey="residual" stroke="#2563eb" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>
        <p className="ss-caption">Bandas ±2σ del desajuste histórico; no son intervalos de predicción. La referencia se estima en cada fecha al plazo/duración que entonces tenía el papel, excluyéndolo de su propia curva. Z-score y AR(1) usan este desajuste, nunca el spread bruto. Mínimo 60 observaciones para estadísticas.</p>
        <details><summary>Spread bruto descriptivo y referencia por plazo</summary><div className="ss-chart ss-chart-small"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" minTickGap={70} tickFormatter={dateLabel} /><YAxis domain={["auto", "auto"]} unit=" pb" /><Tooltip formatter={(v: number) => fmt(v)} /><Legend /><Line name="Spread bruto del papel" dataKey="spread" stroke="#2563eb" dot={false} isAnimationActive={false} /><Line name="Referencia de pares" dataKey="reference" stroke="#0d9488" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div><p className="ss-caption">Gráfico descriptivo: el bono acorta plazo. No se compara con una media histórica bruta para generar señales.</p></details>
        <div className="two-col"><div><h3>Tasas comparables</h3><div className="ss-chart ss-chart-small"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" minTickGap={70} tickFormatter={dateLabel} /><YAxis domain={["auto", "auto"]} unit="%" /><Tooltip formatter={(v: number) => `${fmt(v, 3)}%`} /><Legend /><Line name="Papel" dataKey="yield" stroke="#2563eb" dot={false} isAnimationActive={false} /><Line name="Swap" dataKey="swap" stroke="#0d9488" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div></div>
          <div><h3>Curva de spreads por vencimiento</h3><div className="ss-chart ss-chart-small"><ResponsiveContainer width="100%" height="100%"><ScatterChart><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" dataKey="x" name="Plazo" unit="a" /><YAxis type="number" dataKey="y" name="Spread" unit=" pb" /><Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }) => active && payload?.length ? <div className="curve-tooltip">{payload[0].payload.code}<br />{fmt(payload[0].payload.y)} pb</div> : null} /><Scatter name="Papeles misma fecha" data={peerCurve} fill="#94a3b8" /><Scatter name="Seleccionado" data={[{ x: last.term, y: last.spread, code: selected.bond.code }]} fill="#2563eb" /></ScatterChart></ResponsiveContainer></div></div></div>
      </section>

      <section className="panel"><h2>Registrar tesis de compresión</h2><p className="ss-caption">Registro analítico con la última observación disponible, no confirmación de una ejecución. Se conservan fecha, objetivo y límite originales. La ficha registra el bono; cualquier cobertura ejecutada debe controlarse además con sus flujos reales.</p>
        <div className="ss-controls"><label>Horizonte de la tesis<select value={months} onChange={e => setMonths(Number(e.target.value))}><option value={1}>1 mes</option><option value={3}>3 meses</option></select></label><label>Spread objetivo del bono (pb)<input type="number" step="0.1" value={target} placeholder={fmt(targetSpread)} onChange={e => setTarget(e.target.value)} /></label><label>Monto bono CLP<input type="number" min="1" value={amount} onChange={e => setAmount(Number(e.target.value))} /></label><label>Límite de ampliación (pb)<input type="number" step="0.1" value={stop} placeholder={fmt(currentSpread + 20)} onChange={e => setStop(e.target.value)} /></label><label className="ss-thesis">Tesis y condición de salida<textarea value={thesis} onChange={e => setThesis(e.target.value)} placeholder="Por qué debería converger y qué invalidaría la tesis…" /></label></div><button className="ss-button ss-primary" disabled={!ready || !!storageError} onClick={savePosition}>Guardar posición en seguimiento</button>
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
    <details className="panel ss-method"><summary>Metodología y calidad del análisis</summary><p>Bonos: RiskAmerica (TIR anual efectiva y duración Macaulay); swap: históricos Cámara Bloomberg CLP/UF. Se cruzan fechas exactas sin rellenar ausencias ni extrapolar. Vencimiento desde el nemotécnico con día 1, según la convención del proyecto.</p><p>Los z-scores ajustados exigen 60 observaciones y usan el desajuste papel menos curva de pares. La referencia se interpola linealmente al plazo o duración de cada fecha, excluyendo el propio papel; no se extrapola. Las puntas de curva pueden no tener referencia. No se ajustan explícitamente diferencias de cupón o liquidez. AR(1) exige 60 pares de ruedas consecutivas de lunes a viernes; omite saltos, pero no ajusta explícitamente feriados. Horizonte: 21 ruedas por mes. El criterio φ + 1,96 × error estándar &lt; 1 es un diagnóstico aproximado, no una prueba formal de estacionariedad. La validación walk-forward compara pronósticos diarios con paseo aleatorio y no valida estrategias netas de costos.</p><p>Las señales preliminares no garantizan convergencia. Revisa cambios de régimen, liquidez, oferta de bonos y estabilidad de parámetros entre ventanas. Un spread alto no implica automáticamente compra. Las curvas de roll-down usan pares de la sección transversal actual. Las series a plazo constante reconstruyen cada fecha con los bonos disponibles en el archivo que estaban vigentes entonces, incluidos los hoy vencidos; la cobertura histórica puede ser incompleta. Sus estadísticas corresponden al mercado, mientras AR(1) en la ficha corresponde al desajuste particular del bono.</p></details>
  </div></AppShell>;
}

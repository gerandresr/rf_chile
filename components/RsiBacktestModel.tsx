"use client";

import { useEffect, useMemo, useState } from "react";
import { RFData, observations } from "@/lib/rf";
import { backtestRsi, BacktestParameters } from "@/lib/rsi-backtest";

const bp = (v: number | null) => v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)} pb`;
export function RsiBacktestModel() {
  const [data, setData] = useState<RFData | null>(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState("BTP0581029");
  const [parameters, setParameters] = useState<BacktestParameters>({ start: "", end: "", entryRsi: 70, exitRsi: 50, exitMode: "targets", stopBp: 5, takeBp: 15, spreadBp: 0 });
  useEffect(() => {
    fetch("/data/rf.json").then(r => { if (!r.ok) throw new Error("No fue posible cargar las tasas históricas."); return r.json(); }).then((d: RFData) => {
      setData(d); setParameters(p => ({ ...p, start: d.history[0]?.date ?? "", end: d.lastMarketDate }));
    }).catch(e => setError(e.message));
  }, []);
  const instruments = useMemo(() => data?.instruments.filter(i => i.type === "BTP" || i.type === "BTU").slice().sort((a, b) => a.type.localeCompare(b.type) || a.maturityYear - b.maturityYear || a.maturityMonth - b.maturityMonth || a.code.localeCompare(b.code)) ?? [], [data]);
  const estimation = useMemo(() => {
    if (!data) return { result: null, error: "" };
    try { return { result: backtestRsi(observations(data, code), parameters), error: "" }; }
    catch (e) { return { result: null, error: e instanceof Error ? e.message : "Revisa los parámetros." }; }
  }, [data, code, parameters]);
  const numeric = (key: "entryRsi" | "exitRsi" | "stopBp" | "takeBp" | "spreadBp", label: string, min: number, max?: number) => <div className="control">
    <label htmlFor={`backtest-${key}`}>{label}</label><input id={`backtest-${key}`} type="number" min={min} max={max} step={key.endsWith("Rsi") ? 1 : 0.1} value={Number.isFinite(parameters[key]) ? parameters[key] : ""} onChange={e => setParameters(p => ({ ...p, [key]: e.target.value === "" ? NaN : Number(e.target.value) }))}/>
  </div>;
  if (!data) return <div className="model-content" role="status">{error || "Cargando tasas históricas…"}</div>;
  const result = estimation.result;
  return <div className="model-content">
    <p className="model-caption">Compra del bono cuando el RSI 14 de su tasa cruza hacia arriba el nivel de entrada, o si su primer valor calculable ya está sobre ese nivel. Una posición a la vez; los puntos base positivos corresponden a una caída de tasa.</p>
    <div className="backtest-controls">
      <div className="control"><label htmlFor="backtest-instrument">Instrumento</label><select id="backtest-instrument" value={code} onChange={e => setCode(e.target.value)}>{instruments.map(i => <option key={i.code} value={i.code}>{i.code}</option>)}</select></div>
      <div className="control"><label htmlFor="backtest-start">Desde</label><input id="backtest-start" type="date" min={data.history[0]?.date} max={data.lastMarketDate} value={parameters.start} onChange={e => setParameters(p => ({ ...p, start: e.target.value }))}/></div>
      <div className="control"><label htmlFor="backtest-end">Hasta</label><input id="backtest-end" type="date" min={data.history[0]?.date} max={data.lastMarketDate} value={parameters.end} onChange={e => setParameters(p => ({ ...p, end: e.target.value }))}/></div>
      {numeric("entryRsi", "RSI de entrada", 1, 99)}
      <div className="control"><label htmlFor="backtest-mode">Salida</label><select id="backtest-mode" value={parameters.exitMode} onChange={e => setParameters(p => ({ ...p, exitMode: e.target.value as BacktestParameters["exitMode"] }))}><option value="rsi">RSI</option><option value="targets">Stop loss / take profit</option><option value="combined">RSI + stop / take profit</option></select></div>
      {parameters.exitMode !== "targets" && numeric("exitRsi", "RSI de salida", 0, 99)}
      {parameters.exitMode !== "rsi" && <>{numeric("stopBp", "Stop loss (pb)", 0.1)}{numeric("takeBp", "Take profit (pb)", 0.1)}</>}
      {numeric("spreadBp", "Bid/ask spread (basis points)", 0)}
    </div>
    <p className="model-caption">Las señales se ejecutan al siguiente cierre disponible, incluidos los stops y objetivos. El resultado puede exceder los umbrales por saltos de tasa. Sin datos intradía. Se liquida cualquier posición al cierre final del período. El bid/ask spread corresponde a cuánto pierdo al entrar o salir a una posición. Se aplica el valor ingresado en cada lado; stop y objetivo se evalúan incluyendo ambos castigos.</p>
    {estimation.error && <div className="model-notice" role="alert">{estimation.error}</div>}
    {result && <>
      <div className="kpi-grid model-kpi-grid">
        <div className="kpi"><div className="kpi-label">Puntos base netos acumulados</div><div className="kpi-value" style={{ color: result.netBp >= 0 ? "var(--green)" : "var(--red)" }}>{bp(result.netBp)}</div><div className="kpi-foot">Brutos: {bp(result.grossBp)}</div></div>
        <div className="kpi"><div className="kpi-label">Operaciones</div><div className="kpi-value">{result.trades.length}</div><div className="kpi-foot">Ganadoras: {result.winRate === null ? "—" : `${result.winRate.toFixed(1)}%`}</div></div>
        <div className="kpi"><div className="kpi-label">Promedio por operación</div><div className="kpi-value">{bp(result.averageBp)}</div><div className="kpi-foot">Caída máxima acumulada: {result.drawdown.toFixed(2)} pb</div></div>
      </div>
      <section className="model-chart-section"><div className="panel-head"><h2>Operaciones simuladas</h2></div>
        {result.trades.length === 0 ? <p className="model-caption" role="status">{result.rsiObservations === 0 ? "Historia insuficiente para calcular el RSI 14 en este período." : "No hubo operaciones ejecutables con estos parámetros en el período seleccionado."}</p> : <div className="table-wrap"><table className="backtest-table"><thead><tr><th>Señal compra</th><th>Compra</th><th>TIR entrada ajustada</th><th>Señal salida</th><th>Venta</th><th>TIR salida ajustada</th><th>Días</th><th>Motivo</th><th>Bruto (pb)</th><th>Neto (pb)</th></tr></thead><tbody>{result.trades.map((t, i) => <tr key={`${t.entryDate}-${i}`}><td>{t.signalDate}</td><td>{t.entryDate}</td><td>{t.entryYield.toFixed(3)}%</td><td>{t.exitSignalDate}</td><td>{t.exitDate}</td><td>{t.exitYield.toFixed(3)}%</td><td>{t.days}</td><td>{t.reason}</td><td>{bp(t.grossBp)}</td><td style={{ color: t.netBp >= 0 ? "var(--green)" : "var(--red)" }}>{bp(t.netBp)}</td></tr>)}</tbody></table></div>}
      </section>
      <p className="model-caption">La suma de pb mide movimientos de tasa capturados; no es rentabilidad ni ganancia en pesos. No incorpora cupones, carry ni financiamiento.</p>
    </>}
  </div>;
}

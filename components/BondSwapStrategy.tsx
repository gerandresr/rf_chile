"use client";

import { useEffect, useMemo, useState } from "react";
import { bootstrapSwapCurve, horizonDays, parSwapRate, projectBondSwap, swapAnnuity, tradeSizing } from "@/lib/bond-swap";
import { distinctCurve, interpolate, meanReversionSeries, referenceValue, residualValue, type SpreadBond, type SpreadPoint, type StrategyMarket } from "@/lib/swap-spreads";

const fmt = (v: number | null | undefined, d = 2) => v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const clp = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(v);
const day = (date: string) => date.split("-").reverse().join("/");

export function BondSwapStrategy({ bond, last, universe, market, signals, onMarketValue }: {
  bond: SpreadBond; last: SpreadPoint; universe: SpreadBond[]; market: StrategyMarket;
  signals: { date: string; value: number }[]; onMarketValue: (v: number) => void;
}) {
  const source = market.curves.find(c => c.currency === bond.currency && c.date === last.date);
  const quotes = source?.quotes ?? [];
  const initialTenor = quotes.filter(q => q.x >= 1).slice().sort((a,b) => Math.abs(a.x - last.term) - Math.abs(b.x - last.term))[0]?.x ?? 5;
  const [dvUSD, setDvUSD] = useState(3000), [fx, setFx] = useState(market.fx ? String(market.fx.value) : "");
  const [tenor, setTenor] = useState(initialTenor), [hedgePct, setHedgePct] = useState(100);
  const [duration, setDuration] = useState(last.macaulay / (1 + last.yield / 100)), [riskOverride, setRiskOverride] = useState("");
  const [valuePer100, setValuePer100] = useState(100), [ufSpot, setUfSpot] = useState("");
  const [funding, setFunding] = useState(market.tpm ? String(market.tpm.value) : ""), [camera, setCamera] = useState(market.tpm ? String(market.tpm.value) : "");
  const [commonShock, setCommonShock] = useState(0), [extraBond, setExtraBond] = useState(0), [extraSwap, setExtraSwap] = useState(0), [costs, setCosts] = useState(0);
  const [uf1, setUf1] = useState(0), [uf3, setUf3] = useState(0), [includeAR, setIncludeAR] = useState(false);
  const curve = useMemo(() => { try { return { nodes: bootstrapSwapCurve(quotes), error: "" }; } catch (e) { return { nodes: [], error: e instanceof Error ? e.message : "Curva no disponible." }; } }, [quotes]);
  const fixed = quotes.find(q => q.x === tenor)?.y ?? null;
  const annuity = swapAnnuity(tenor, curve.nodes);
  const risk = riskOverride === "" ? annuity : Number(riskOverride);
  const validInputs = fx !== "" && funding !== "" && camera !== "" && Number(funding) > -100 && Number(camera) > -100 && uf1 > -100 && uf3 > -100
    && [dvUSD, Number(fx), duration, hedgePct, valuePer100, Number(funding), Number(camera), commonShock, extraBond, extraSwap, costs, uf1, uf3].every(Number.isFinite)
    && fixed !== null && costs >= 0 && !curve.error;
  const sizing = validInputs && risk !== null ? tradeSizing(dvUSD, Number(fx), duration, risk, hedgePct, valuePer100) : null;
  useEffect(() => { if (sizing) onMarketValue(sizing.bondMarketValue); }, [sizing?.bondMarketValue, onMarketValue]);
  const peers = universe.filter(b => b.currency === bond.currency && b.code !== bond.code).flatMap(b => {
    const p = b.points.find(p => p.date === last.date); return p ? [{ x: p.term, y: p.spread }] : [];
  });
  const referenceCurve = distinctCurve(peers), refNow = referenceValue(last, "maturity"), residualNow = residualValue(last, "maturity");
  const baseSwap = interpolate(last.term, quotes);
  const projections = [1, 3].map(months => {
    const days = horizonDays(last.date, months), futureTerm = last.term - days / 365;
    const futureBase = interpolate(futureTerm, quotes), futureRef = interpolate(futureTerm, referenceCurve);
    const bondRollBp = baseSwap === null || futureBase === null || refNow === null || futureRef === null ? null : (baseSwap - futureBase) * 100 + refNow - futureRef;
    const futureSwap = parSwapRate(tenor - days / 365, curve.nodes);
    const swapRollBp = futureSwap === null || fixed === null ? null : (futureSwap - fixed) * 100;
    const model = signals.at(-1)?.date === last.date ? meanReversionSeries(signals, months) : null;
    const convergenceBp = includeAR && model?.supported && residualNow !== null ? model.forecast! - residualNow : 0;
    const result = sizing && fixed !== null ? projectBondSwap({ sizing, days, bondYield: last.yield, fixedSwap: fixed,
      funding: Number(funding), camera: Number(camera), currency: bond.currency, ufPct: months === 1 ? uf1 : uf3,
      bondRollBp, swapRollBp, commonShockBp: commonShock, extraBondBp: extraBond, extraSwapBp: extraSwap, convergenceBp, costsCLP: costs }) : null;
    return { months, days, bondRollBp, swapRollBp, futureSwap, convergenceBp, model, result };
  });
  const labels: [string, keyof NonNullable<typeof projections[number]["result"]>][] = [
    ["Devengo estimado del bono", "bondAccrual"], ["Reajuste UF del capital del bono", "bondUF"], ["Costo de fondeo del bono", "funding"],
    ["Swap: Cámara recibida", "floatReceived"], ["Swap: tasa fija pagada", "fixedPaid"], ["Carry neto conjunto (subtotal)", "carry"],
    ["MTM bono por roll-down", "bondRoll"], ["MTM swap por roll-down", "swapRoll"], ["MTM bono por shock de tasas", "bondMTM"],
    ["MTM swap por shock de tasas", "swapMTM"], ["Convergencia del desajuste del bono", "convergence"], ["Costos totales de la operación", "costs"],
    ["Resultado neto estimado", "total"],
  ];
  return <section className="panel ss-trade"><div className="panel-head"><div><div className="eyebrow">Comprar bono + pagar fijo / recibir Cámara</div><h2>Bono + swap: DV01, carry y escenarios</h2></div><span className="pill">{bond.code} · SPC {bond.currency}</span></div>
    <div className="ss-controls">
      <label>DV01 objetivo del bono (USD/pb)<input type="number" min="1" step="500" value={dvUSD} onChange={e => setDvUSD(Number(e.target.value))} /></label>
      <label>USD/CLP<input type="number" min="1" step="0.01" value={fx} onChange={e => setFx(e.target.value)} /></label>
      <label>Duración modificada del bono<input type="number" min="0.01" step="0.001" value={duration} onChange={e => setDuration(Number(e.target.value))} /></label>
      <label>Swap para cubrir<select value={tenor} onChange={e => { setTenor(Number(e.target.value)); setRiskOverride(""); }}>{quotes.filter(q => q.x >= 1).map(q => <option key={q.x} value={q.x}>{q.x}y · {fmt(q.y, 3)}%</option>)}</select></label>
      <label>Cobertura del DV01 (%)<input type="number" min="0" step="5" value={hedgePct} onChange={e => setHedgePct(Number(e.target.value))} /></label>
    </div>
    <p className="ss-caption">TIR bono {fmt(last.yield, 4)}% y curva swap al {day(last.date)}. USD/CLP precargado {market.fx ? `${fmt(market.fx.value)} al ${day(market.fx.date)}` : "no disponible"}; TPM {market.tpm ? `${fmt(market.tpm.value)}% al ${day(market.tpm.date)}` : "no disponible"}. Ambos editables. El USD solo expresa el DV01 objetivo: la estrategia se calcula en CLP.</p>
    {(!sizing || !source) && <p role="status" className="model-notice">{curve.error || "Completa DV01, USD/CLP, duración, fondeo y Cámara válidos. Se necesita una curva swap de la misma fecha que el bono."}</p>}
    <div className="kpi-grid ss-kpis"><div className="kpi"><div className="kpi-label">Valor de mercado del bono</div><div className="kpi-value ss-money">{clp(sizing?.bondMarketValue)}</div><div className="kpi-foot">{fmt(sizing ? sizing.bondMarketValue / 1e9 : null, 3)} mil millones CLP a fondear</div></div>
      <div className="kpi"><div className="kpi-label">Nominal estimado del bono</div><div className="kpi-value ss-money">{clp(sizing?.bondNominal)}</div><div className="kpi-foot">{valuePer100 === 100 ? "Estimación a par (factor 100/100)" : `Factor VM/nominal ${fmt(valuePer100)} por 100`}{bond.currency === "UF" && " · equivalente CLP"}</div></div>
      <div className="kpi"><div className="kpi-label">Nocional swap {tenor}y</div><div className="kpi-value ss-money">{clp(sizing?.swapNominal)}</div><div className="kpi-foot">{fmt(sizing ? sizing.swapNominal / 1e9 : null, 3)} mil millones {bond.currency === "UF" ? "equivalentes CLP" : "CLP"} · paga {fmt(fixed, 3)}%</div></div>
      <div className="kpi"><div className="kpi-label">DV01 neto inicial (USD/pb)</div><div className="kpi-value">{fmt(sizing ? sizing.residualDV01 / Number(fx) : null)}</div><div className="kpi-foot">Bono {fmt(dvUSD, 0)} − swap {fmt(dvUSD * hedgePct / 100, 0)}; positivo = pérdida ante alza</div></div></div>
    <details><summary>Supuestos de nocionales y sensibilidad</summary><div className="ss-controls ss-advanced"><label>Valor de mercado por 100 de nominal<input type="number" min="1" step="0.01" value={valuePer100} onChange={e => setValuePer100(Number(e.target.value))} /></label><label>Riesgo swap por nocional (años)<input type="number" min="0.01" step="0.001" value={riskOverride} placeholder={fmt(annuity, 5)} onChange={e => setRiskOverride(e.target.value)} /></label>{bond.currency === "UF" && <label>UF actual en CLP (opcional)<input type="number" min="1" step="0.01" value={ufSpot} onChange={e => setUfSpot(e.target.value)} /></label>}</div>
      <p className="ss-caption">DV01 CLP = DV01 USD × USD/CLP. Valor de mercado bono = DV01 CLP / (Dmod × 0,0001). Nominal bono = valor de mercado / factor VM/nominal. Sin precio sucio se asume par; no es un nominal exacto. Nocional swap = DV01 cubierto / (anualidad × 0,0001). La anualidad de flujos descontados, {fmt(annuity, 5)} años, es sensibilidad por nocional; no es la duración modificada de un bono. Puede sustituirse por una sensibilidad validada de mesa.</p>
      {bond.currency === "UF" && Number(ufSpot) > 0 && <p className="ss-caption">Nominal bono ≈ {fmt(sizing ? sizing.bondNominal / Number(ufSpot) : null)} UF; nocional swap ≈ {fmt(sizing ? sizing.swapNominal / Number(ufSpot) : null)} UF.</p>}
    </details>
    <h3>Fondeo y escenario de tasas</h3><div className="ss-controls">
      <label>Costo de fondeo CLP anual (%)<input type="number" min="0" step="0.05" value={funding} onChange={e => setFunding(e.target.value)} /></label>
      <label>Cámara promedio esperada anual (%)<input type="number" min="0" step="0.05" value={camera} onChange={e => setCamera(e.target.value)} /></label>
      <label>Δ común al cierre (pb)<input type="number" value={commonShock} onChange={e => setCommonShock(Number(e.target.value))} /></label>
      <label>Δ adicional del bono (pb)<input type="number" value={extraBond} onChange={e => setExtraBond(Number(e.target.value))} /></label>
      <label>Δ adicional del swap elegido (pb)<input type="number" value={extraSwap} onChange={e => setExtraSwap(Number(e.target.value))} /></label>
      <label>Costos totales entrada + salida (CLP)<input type="number" min="0" step="100000" value={costs} onChange={e => setCosts(Math.max(0, Number(e.target.value)))} /></label>
      {bond.currency === "UF" && <><label>Reajuste UF a 1 mes (%)<input type="number" min="-99" step="0.1" value={uf1} onChange={e => setUf1(Number(e.target.value))} /></label><label>Reajuste UF a 3 meses (%)<input type="number" min="-99" step="0.1" value={uf3} onChange={e => setUf3(Number(e.target.value))} /></label></>}
    </div>
    <label className="ss-ar-toggle"><input type="checkbox" checked={includeAR} onChange={e => setIncludeAR(e.target.checked)} /> Incorporar convergencia AR(1) del desajuste, solo cuando tenga respaldo estadístico</label>
    <p className="ss-caption">Se financia el valor de mercado del bono, no la suma de nocionales. El swap no supone desembolsar su nocional. Fondeo y Cámara parten de la TPM, pero se editan por separado. Los shocks se aplican al cierre de cada horizonte; la Cámara promedio esperada se define por separado. No son tasas anuales. Spread de esta pareja: TIR bono − swap {tenor}y = {fmt(fixed === null ? null : (last.yield - fixed) * 100)} pb; puede diferir del spread contra swap interpolado al vencimiento del bono.</p>
    <div className="table-wrap"><table className="market-table ss-trade-results"><thead><tr><th>Resultado conjunto en CLP</th>{projections.map(p => <th key={p.months}>{p.months} mes{p.months > 1 ? "es" : ""} · {p.days} días</th>)}</tr></thead><tbody>
      {labels.filter(([, k]) => bond.currency === "UF" || k !== "bondUF").map(([label, key]) => <tr key={key} className={key === "total" ? "ss-trade-total" : key === "carry" ? "ss-trade-subtotal" : ""}><td>{label}</td>{projections.map(p => <td key={p.months}>{clp(p.result ? p.result[key] as number | null : null)}</td>)}</tr>)}
      <tr><td>Resultado / valor de mercado del bono</td>{projections.map(p => <td key={p.months}>{fmt(p.result && sizing ? p.result.total / sizing.bondMarketValue * 100 : null)}%</td>)}</tr>
      <tr><td>Ampliación adicional del bono que agota el resultado (pb)</td>{projections.map(p => <td key={p.months}>{fmt(p.result?.spreadBreakevenBp)}</td>)}</tr>
    </tbody></table></div>
    {projections.some(p => p.result && !p.result.completeRoll) && <p className="model-notice">Hay horizontes sin cobertura de curva para estimar todo el roll-down. Sus filas se muestran como no disponibles y su total es parcial, sin esos componentes.</p>}
    <p className="ss-caption">Roll-down: curvas actuales sin cambios; el bono conserva su desajuste y el swap pasa a un plazo menor. Para el swap pagador fijo, una caída de su tasa par genera MTM negativo. Convergencia AR adicional: {projections.map(p => `${p.months}m: ${fmt(p.convergenceBp)} pb${includeAR && !p.model?.supported ? " (sin señal válida)" : ""}`).join(" · ")}. Un breakeven negativo indica que se requiere compresión adicional, no que exista margen para ampliar. El porcentaje es sobre el bono, no sobre capital o garantías aportados.</p>
    <h3>Prueba de cobertura · MTM en CLP, sin carry ni roll-down</h3><div className="table-wrap"><table className="market-table"><thead><tr><th>Escenario aislado</th><th>MTM bono</th><th>MTM swap</th><th>MTM neto</th></tr></thead><tbody>{[
      ["Suben ambos +5 pb", 5, 5], ["Bajan ambos −5 pb", -5, -5], ["Solo bono sube +5 pb", 5, 0], ["Solo swap sube +5 pb", 0, 5],
    ].map(([name, b, s]) => { const bondMTM = sizing ? -sizing.bondDV01 * Number(b) : null, swapMTM = sizing ? sizing.swapDV01 * Number(s) : null; return <tr key={String(name)}><td>{name}</td><td>{clp(bondMTM)}</td><td>{clp(swapMTM)}</td><td>{clp(bondMTM === null || swapMTM === null ? null : bondMTM + swapMTM)}</td></tr>; })}</tbody></table></div>
    <details className="ss-method"><summary>Convenciones del simulador</summary><p>Estimación económica de primer orden, no liquidación contractual. DV01 inicial constante: igualarlo cubre un movimiento paralelo, pero no los cambios de pendiente, convexidad ni la deriva del DV01. Elegir un swap 2y para un bono más largo mantiene riesgo entre tramos, aunque el DV01 neto inicial sea cero.</p><p>Curva swap única con descuento log-lineal, reconstruida desde tasas par. Pagos únicos hasta 1 año y semestrales después, base ACT/360 aproximada, sin feriados ni ajustes de fecha. La anualidad mide sensibilidad del swap par al inicio. El roll-down del swap usa un swap par al plazo restante como aproximación; el calendario residual real puede diferir.</p><p>Devengo del bono por TIR anual efectiva ACT/365. Fondeo y Cámara se aproximan por capitalización diaria constante base 360; tasa fija simple base 360. Se suman devengos y MTM, no solo pagos de caja efectivamente liquidados en el horizonte. En UF, Cámara nominal se convierte a retorno real mediante el factor UF supuesto y el resultado se expresa en CLP. La financiación sigue en CLP. El contrato real y sus calendarios deben coincidir con estas convenciones para afinar la estimación.</p><p>No incluye convexidad, bid/ask ni financiación de garantías salvo que se incorporen a los costos ingresados. USD/CLP convierte la unidad de riesgo y no agrega una posición cambiaria. Los resultados dependen de los supuestos de tasas cortas y de la forma de la curva; una curva constante es un escenario, no una promesa de retorno.</p></details>
  </section>;
}

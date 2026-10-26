"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Calculator, PiggyBank } from "lucide-react";
import { DEPOSIT_TENORS, interpolateDeposit, latestDepositCurve, type DepositCurve, type DepositKind } from "@/lib/deposit-interpolation";
import { depositEquivalents, depositSwapSpread, equivalenceContext, swapCurve, type EquivalenceContext, type InflationInsurance, type NdfCurve, type SwapCurveFile, type SwapPoint } from "@/lib/deposit-equivalents";

const fmt = (digits: number) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const DIGITS: Record<DepositKind, number> = { DPF: 3, DPR: 2 };

function parseInput(value: string): number | null {
  const text = value.trim().replace(",", ".");
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}
const pct = (value: number | null, digits: number) => (value === null || !Number.isFinite(value) ? "—" : `${fmt(digits).format(value)}%`);
const bp = (value: number | null, digits = 0) => {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : ""}${fmt(digits).format(rounded)} bp`;
};
const day = (date: string) => new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

function DepositCalculator({ kind, curve, status, ctx, swaps }: { kind: DepositKind; curve: DepositCurve | null; status: "loading" | "ready" | "error"; ctx: EquivalenceContext | null; swaps: SwapPoint[] | null }) {
  const [daysText, setDaysText] = useState("");
  const [rateText, setRateText] = useState("");
  const digits = DIGITS[kind];
  const isDpf = kind === "DPF";
  const days = parseInput(daysText);
  const entered = parseInput(rateText);
  const result = curve ? interpolateDeposit(days, curve.points) : null;
  const base = result?.rate ?? null;
  // Si se ingresa la tasa del depósito, reemplaza a la interpolada en todos los cálculos.
  const subject = entered ?? base;
  const swapSpread = swaps && subject !== null && days !== null ? depositSwapSpread(kind, subject, days, swaps) : null;
  const swapOf = (rate: number, d: number) => (swaps ? depositSwapSpread(kind, rate, d, swaps) : null);
  const eq = ctx && subject !== null && days !== null ? depositEquivalents(kind, subject, days, ctx) : null;
  const eqOf = (rate: number, d: number) => (ctx ? depositEquivalents(kind, rate, d, ctx) : null);
  const otherLabel = isDpf ? "Equivalente UF (% real anual)" : "Equivalente pesos (% base 30 días)";
  const other = (e: ReturnType<typeof depositEquivalents>) => (e ? (isDpf ? pct(e.uf, 2) : pct(e.clp30, 3)) : "—");
  const prefix = `interp-${kind.toLowerCase()}`; // "dpf-days" ya existe en Spread Bonos

  return (
    <details className="bond-calculator">
      <summary className="bond-calculator-summary">
        <span className="bond-calculator-summary-title"><PiggyBank size={19} aria-hidden="true" />{isDpf ? "Depósitos CLP (DPF)" : "Depósitos UF (DPR)"}</span>
        <ChevronDown size={20} className="bond-calculator-chevron" aria-hidden="true" />
      </summary>
      <div className="bond-calculator-body">
        <div className="bond-calculator-inputs">
          <div className="bond-calculator-field">
            <label htmlFor={`${prefix}-days`}>Plazo (días)</label>
            <input id={`${prefix}-days`} type="text" inputMode="numeric" value={daysText} onChange={e => setDaysText(e.target.value)} placeholder="Ej. 120" autoComplete="off" />
          </div>
          <div className="bond-calculator-field">
            <label htmlFor={`${prefix}-rate`}>{isDpf ? "Tasa del depósito (% base 30 días)" : "Tasa del depósito (% real anual)"}</label>
            <input id={`${prefix}-rate`} type="text" inputMode="decimal" value={rateText} onChange={e => setRateText(e.target.value)} placeholder={isDpf ? "Ej. 0,390" : "Ej. 0,80"} autoComplete="off" />
          </div>
        </div>

        <div className="bond-calculator-results" aria-live="polite">
          <div className="bond-calculator-result">
            <span>{entered !== null ? "Tasa del depósito" : "Tasa interpolada"}</span>
            <strong>{pct(subject, digits)}</strong>
          </div>
          <div className="bond-calculator-result bond-calculator-result-primary">
            <span>Swap Spread{swapSpread ? ` · vs swap ${isDpf ? "CLP" : "UF"} ${fmt(2).format(swapSpread.swap)}%` : ""}</span>
            <strong>{bp(swapSpread?.spreadBp ?? null)}</strong>
          </div>
        </div>
        <p className="bond-calculator-source">
          {entered !== null ? <>Tasa ingresada{base !== null && <span> · curva {kind} a ese plazo: {pct(base, digits)}</span>}</> : <>Curva {kind} · interpolación lineal por días
          {result && result.left !== result.right && <span> · entre {result.left.days} y {result.right.days} días</span>}
          {result?.extrapolated && <span> · fuera del rango cotizado ({curve!.points[0].days}–{curve!.points[curve!.points.length - 1].days} días): se usa el plazo extremo</span>}</>}
          {swapSpread && <span> · Swap Spread = {isDpf ? "tasa × 12" : "tasa"} ({fmt(2).format(swapSpread.annual)}%) − swap Cámara {isDpf ? "CLP" : "UF"} interpolado al plazo{swapSpread.extrapolated ? " (plazo fuera de la curva swap: se usa el extremo)" : ""}</span>}
          {status === "loading" && <span> · Cargando cierre…</span>}
          {status === "error" && <span> · No se pudieron cargar los datos.</span>}
        </p>

        <div className="bond-calculator-results" aria-live="polite">
          <div className="bond-calculator-result">
            <span>{otherLabel}{subject !== null && days !== null ? (entered !== null ? " · tu depósito" : " · tasa interpolada") : ""}</span>
            <strong>{other(eq)}</strong>
          </div>
          <div className="bond-calculator-result">
            <span>Equivalente USD (% anual ACT/360){subject !== null && days !== null ? (entered !== null ? " · tu depósito" : " · tasa interpolada") : ""}</span>
            <strong>{eq ? pct(eq.usd, 2) : "—"}</strong>
          </div>
        </div>
        <p className="bond-calculator-source">
          {ctx ? <>Closing derivados {day(ctx.valuationDate)} · UF hoy {fmt(2).format(ctx.uf0)}{eq && <> · UF al vencimiento {fmt(2).format(eq.ufAtMaturity)}</>} · dólar spot {fmt(2).format(ctx.spot)}{eq && <> · forward {fmt(2).format(eq.forward)}</>}</>
            : status === "ready" ? "Sin closing de derivados: no se pueden calcular los equivalentes." : ""}
          {ctx && days !== null && subject !== null && !eq && <span> · plazo fuera de los seguros de inflación o puntos forward disponibles</span>}
        </p>

        {curve && <div className="table-wrap" style={{ marginTop: 14 }}><table>
          <thead><tr><th>Plazo</th><th>{isDpf ? "Tasa base 30 días" : "Tasa real anual"}</th><th>Swap Spread</th><th>{isDpf ? "Equiv. UF" : "Equiv. pesos (b30)"}</th><th>Equiv. USD</th></tr></thead>
          <tbody>{curve.points.map(p => <tr key={p.days} style={result && (p === result.left || p === result.right) ? { background: "#eef3fb" } : undefined}>
            <td className="strong">{p.days} días</td><td>{pct(p.rate, digits)}</td><td>{bp(swapOf(p.rate, p.days)?.spreadBp ?? null)}</td><td>{other(eqOf(p.rate, p.days))}</td><td>{(() => { const e = eqOf(p.rate, p.days); return e ? pct(e.usd, 2) : "—"; })()}</td>
          </tr>)}</tbody>
        </table></div>}
      </div>
    </details>
  );
}

export function DepositInterpolator() {
  const [curves, setCurves] = useState<Partial<Record<DepositKind, DepositCurve | null>>>({});
  const [error, setError] = useState(false);
  const [ctx, setCtx] = useState<EquivalenceContext | null>(null);
  const [swaps, setSwaps] = useState<Record<DepositKind, SwapPoint[]> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async (kind: DepositKind) => {
      const entries = await Promise.all(DEPOSIT_TENORS[kind].map(async days => {
        const key = `${kind}_${days}`;
        const response = await fetch(`/data/historico_riskamerica/${key}.json`, { signal: controller.signal });
        if (!response.ok) throw new Error(`No se pudo cargar ${key}`);
        const json = JSON.parse((await response.text()).replace(/^﻿/, ""));
        return [days, json[key]] as const;
      }));
      return latestDepositCurve(Object.fromEntries(entries));
    };
    const json = async (path: string) => {
      const response = await fetch(path, { signal: controller.signal });
      if (!response.ok) throw new Error(`No se pudo cargar ${path}`);
      return JSON.parse((await response.text()).replace(/^\uFEFF/, ""));
    };
    // Closing de derivados (seguros de inflación y puntos forward), IPC observado y dólar spot del mismo día.
    Promise.all([json("/data/Closing_Icap/inflacion.json"), json("/data/Closing_Icap/ndf.json"), json("/data/historico_bcentral/datos-mensuales.json"), json("/data/historico_bloomberg/usdclp.json")])
      .then(([insurance, ndf, monthly, usd]: [InflationInsurance, NdfCurve, { fecha: string; ipc_mom: number | null }[], { usdclp: { fecha: string[]; valor: (number | null)[] } }]) => {
        const ipc = new Map(monthly.filter(r => typeof r.ipc_mom === "number").map(r => [r.fecha, r.ipc_mom as number]));
        const spot = usd.usdclp.fecha.map((f, i) => [f, usd.usdclp.valor[i]] as const).filter(([f, v]) => f <= insurance.fecha && typeof v === "number").at(-1)?.[1];
        if (!controller.signal.aborted && typeof spot === "number") setCtx(equivalenceContext(insurance, ndf, ipc, spot));
      })
      .catch(() => { /* sin equivalentes; el interpolador sigue funcionando */ });
    // Curvas swap Cámara del closing: CLP para DPF (tasa × 12) y UF para DPR.
    Promise.all([json("/data/Closing_Icap/swap_clp.json"), json("/data/Closing_Icap/swap_uf.json")])
      .then(([clp, uf]: [SwapCurveFile, SwapCurveFile]) => { if (!controller.signal.aborted) setSwaps({ DPF: swapCurve(clp), DPR: swapCurve(uf) }); })
      .catch(() => { /* sin swap spread */ });
    Promise.all([load("DPF"), load("DPR")])
      .then(([dpf, dpr]) => { if (!controller.signal.aborted) setCurves({ DPF: dpf, DPR: dpr }); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);

  const ready = "DPF" in curves;
  const status = error ? "error" : ready ? "ready" : "loading";
  const date = curves.DPF?.date ?? curves.DPR?.date;

  return (
    <details className="calculator-group">
      <summary className="calculator-group-summary">
        <span><Calculator size={20} aria-hidden="true" /> Interpolador de Depósitos</span>
        <ChevronDown size={21} className="calculator-group-chevron" aria-hidden="true" />
      </summary>
      <div className="calculator-group-content">
        <p className="calculator-group-intro">
          Ingresa el plazo en días para obtener la tasa interpolada de la curva de depósitos a plazo y, si quieres,
          la tasa de tu depósito, que reemplaza a la interpolada, para ver su swap spread y sus equivalentes. DPF en pesos (tasa base 30 días) y DPR en UF (tasa real anual).
          Los equivalentes usan el closing de derivados: seguros de inflación para la UF y puntos forward para el dólar.
        </p>
        <div className="calculator-data-date" aria-live="polite">
          {ready && date && <>Cierre de referencia: <strong>{day(date)}</strong> · RiskAmerica</>}
          {!ready && !error && "Cargando curvas de depósitos…"}
          {error && "No se pudieron cargar las curvas de depósitos."}
        </div>
        <div className="bond-calculator-list">
          <DepositCalculator kind="DPF" curve={curves.DPF ?? null} status={status} ctx={ctx} swaps={swaps?.DPF ?? null} />
          <DepositCalculator kind="DPR" curve={curves.DPR ?? null} status={status} ctx={ctx} swaps={swaps?.DPR ?? null} />
        </div>
      </div>
    </details>
  );
}

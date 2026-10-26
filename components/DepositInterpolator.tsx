"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Calculator, PiggyBank } from "lucide-react";
import { DEPOSIT_TENORS, dpfAnnual, interpolateDeposit, latestDepositCurve, type DepositCurve, type DepositKind } from "@/lib/deposit-interpolation";

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

function DepositCalculator({ kind, curve, status }: { kind: DepositKind; curve: DepositCurve | null; status: "loading" | "ready" | "error" }) {
  const [daysText, setDaysText] = useState("");
  const [rateText, setRateText] = useState("");
  const digits = DIGITS[kind];
  const isDpf = kind === "DPF";
  const days = parseInput(daysText);
  const entered = parseInput(rateText);
  const result = curve ? interpolateDeposit(days, curve.points) : null;
  const base = result?.rate ?? null;
  const spread = base !== null && entered !== null ? (entered - base) * 100 : null;
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
            <span>Tasa interpolada{isDpf && base !== null ? ` · ≈ ${fmt(2).format(dpfAnnual(base))}% anual` : ""}</span>
            <strong>{pct(base, digits)}</strong>
          </div>
          <div className="bond-calculator-result bond-calculator-result-primary">
            <span>Spread{isDpf && spread !== null ? ` · ≈ ${bp(spread * 12)} anual` : ""}</span>
            <strong>{bp(spread, isDpf ? 1 : 0)}</strong>
          </div>
        </div>
        <p className="bond-calculator-source">
          Curva {kind} · interpolación lineal por días
          {result && result.left !== result.right && <span> · entre {result.left.days} y {result.right.days} días</span>}
          {result?.extrapolated && <span> · fuera del rango cotizado ({curve!.points[0].days}–{curve!.points[curve!.points.length - 1].days} días): se usa el plazo extremo</span>}
          {status === "loading" && <span> · Cargando cierre…</span>}
          {status === "error" && <span> · No se pudieron cargar los datos.</span>}
        </p>

        {curve && <div className="table-wrap" style={{ marginTop: 14 }}><table>
          <thead><tr><th>Plazo</th><th>{isDpf ? "Tasa base 30 días" : "Tasa real anual"}</th>{isDpf && <th>Equivalente anual (×12)</th>}</tr></thead>
          <tbody>{curve.points.map(p => <tr key={p.days} style={result && (p === result.left || p === result.right) ? { background: "#eef3fb" } : undefined}>
            <td className="strong">{p.days} días</td><td>{pct(p.rate, digits)}</td>{isDpf && <td>{pct(dpfAnnual(p.rate), 2)}</td>}
          </tr>)}</tbody>
        </table></div>}
      </div>
    </details>
  );
}

export function DepositInterpolator() {
  const [curves, setCurves] = useState<Partial<Record<DepositKind, DepositCurve | null>>>({});
  const [error, setError] = useState(false);

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
          la tasa de tu depósito para ver su spread. DPF en pesos (tasa base 30 días) y DPR en UF (tasa real anual).
        </p>
        <div className="calculator-data-date" aria-live="polite">
          {ready && date && <>Cierre de referencia: <strong>{day(date)}</strong> · RiskAmerica</>}
          {!ready && !error && "Cargando curvas de depósitos…"}
          {error && "No se pudieron cargar las curvas de depósitos."}
        </div>
        <div className="bond-calculator-list">
          <DepositCalculator kind="DPF" curve={curves.DPF ?? null} status={status} />
          <DepositCalculator kind="DPR" curve={curves.DPR ?? null} status={status} />
        </div>
      </div>
    </details>
  );
}

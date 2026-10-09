"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Calculator, Landmark } from "lucide-react";
import benchmarkInstruments from "@/public/data/instrumentos-benchmark.json";
import { isActiveInstrument, type RFData } from "@/lib/rf";

type BondType = "BTP" | "BTU";
type CurvePoint = { code: string; duration: number; yield: number };

const numberFormat = new Intl.NumberFormat("es-CL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dpfNumberFormat = new Intl.NumberFormat("es-CL", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

function parsePercentInput(value: string): number | null {
  const text = value.trim().replace(",", ".");
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : numberFormat.format(value) + "%";
}

function formatDpfPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : dpfNumberFormat.format(value) + "%";
}

function formatSpread(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  return (rounded > 0 ? "+" : "") + rounded.toLocaleString("es-CL") + " bp";
}

/**
 * Misma selección y criterio de cierre de Tasas Benchmark:
 * whitelist instrumentos-benchmark.json, BTP sin cupones cero,
 * BTU con cupón cero permitido, último cierre oficial de /api/rf.
 * Para esta calculadora el eje horizontal es la duración del bono,
 * no los años al vencimiento usados en la tabla de tenores benchmark.
 */
function buildBenchmarkDurationCurve(data: RFData, type: BondType): CurvePoint[] {
  const allowed = new Set<string>(benchmarkInstruments[type]);
  const lastRow = [...data.history].reverse().find((row) => row.date <= data.lastMarketDate);
  if (!lastRow) return [];
  const marketDate = new Date(lastRow.date + "T12:00:00");

  return data.instruments
    .filter((instrument) =>
      instrument.type === type &&
      allowed.has(instrument.code) &&
      isActiveInstrument(instrument, marketDate) &&
      (type !== "BTP" || (instrument.coupon ?? 0) !== 0) &&
      typeof instrument.duration === "number" &&
      Number.isFinite(instrument.duration) &&
      instrument.duration > 0 &&
      typeof lastRow.values[instrument.code] === "number" &&
      Number.isFinite(lastRow.values[instrument.code])
    )
    .map((instrument) => ({
      code: instrument.code,
      duration: instrument.duration as number,
      yield: lastRow.values[instrument.code],
    }))
    .sort((a, b) => a.duration - b.duration);
}

/**
 * Interpolación lineal por duración. Igual que Tasas Benchmark,
 * fuera del rango se toma la yield del extremo más cercano.
 */
function interpolateDuration(duration: number | null, curve: CurvePoint[]): number | null {
  if (duration === null || !Number.isFinite(duration) || duration <= 0 || !curve.length) return null;
  if (duration <= curve[0].duration) return curve[0].yield;
  if (duration >= curve[curve.length - 1].duration) return curve[curve.length - 1].yield;

  for (let index = 1; index < curve.length; index++) {
    const left = curve[index - 1];
    const right = curve[index];
    if (duration <= right.duration) {
      if (Math.abs(right.duration - left.duration) < 1e-10) return (left.yield + right.yield) / 2;
      const weight = (duration - left.duration) / (right.duration - left.duration);
      return left.yield + weight * (right.yield - left.yield);
    }
  }
  return null;
}

/**
 * (((1 + yield_decimal) ** (vencimiento_dias / 365) - 1)
 *   * 360 / vencimiento_dias) / 12
 * Retorna porcentaje mensual para la interfaz.
 */
function compareDPF(days: number | null, annualYieldPercent: number | null): number | null {
  if (days === null || annualYieldPercent === null || days <= 0 || annualYieldPercent <= -100) return null;
  const annualYield = annualYieldPercent / 100;
  const monthlyRate = ((Math.pow(1 + annualYield, days / 365) - 1) * 360 / days) / 12;
  return Number.isFinite(monthlyRate) ? monthlyRate * 100 : null;
}

function SpreadCalculator({
  type,
  curve,
  dataStatus,
}: {
  type: BondType;
  curve: CurvePoint[];
  dataStatus: "loading" | "ready" | "error";
}) {
  const [durationText, setDurationText] = useState("");
  const [yieldText, setYieldText] = useState("");
  const [dpfDaysText, setDpfDaysText] = useState("");
  const [dpfYieldText, setDpfYieldText] = useState("");

  const duration = parsePercentInput(durationText);
  const enteredYield = parsePercentInput(yieldText);
  const base = interpolateDuration(duration, curve);
  const spread = base !== null && enteredYield !== null ? (enteredYield - base) * 100 : null;
  const dpfRate = compareDPF(parsePercentInput(dpfDaysText), parsePercentInput(dpfYieldText));
  const isCLP = type === "BTP";
  const title = isCLP ? "Bonos CLP" : "Bonos UF";
  const prefix = isCLP ? "clp" : "uf";

  return (
    <details className="bond-calculator" open={isCLP}>
      <summary className="bond-calculator-summary">
        <span className="bond-calculator-summary-title">
          <Landmark size={19} aria-hidden="true" />
          {title}
        </span>
        <ChevronDown size={20} className="bond-calculator-chevron" aria-hidden="true" />
      </summary>
      <div className="bond-calculator-body">
        <div className="bond-calculator-inputs">
          <div className="bond-calculator-field">
            <label htmlFor={prefix + "-duration"}>Duración (años)</label>
            <input id={prefix + "-duration"} type="text" inputMode="decimal"
              value={durationText} onChange={(event) => setDurationText(event.target.value)}
              placeholder="Ej. 4,00" autoComplete="off" />
          </div>
          <div className="bond-calculator-field">
            <label htmlFor={prefix + "-yield"}>Yield del bono (%)</label>
            <input id={prefix + "-yield"} type="text" inputMode="decimal"
              value={yieldText} onChange={(event) => setYieldText(event.target.value)}
              placeholder="Ej. 5,70" autoComplete="off" />
          </div>
        </div>

        <div className="bond-calculator-results" aria-live="polite">
          <div className="bond-calculator-result">
            <span>Base</span>
            <strong>{formatPercent(base)}</strong>
          </div>
          <div className="bond-calculator-result bond-calculator-result-primary">
            <span>Spread</span>
            <strong>{formatSpread(spread)}</strong>
          </div>
        </div>
        <p className="bond-calculator-source">
          Curva {type} · interpolación por duración
          {dataStatus === "loading" && <span> · Cargando cierre…</span>}
          {dataStatus === "error" && <span> · No se pudieron cargar los datos.</span>}
          {dataStatus === "ready" && curve.length === 0 && <span> · Sin cotizaciones benchmark válidas.</span>}
        </p>

        {isCLP && (
          <div className="bond-calculator-dpf">
            <h3>Comparativa DPF</h3>
            <p>Equivalencia a tasa nominal mensual, usando tu fórmula con bases de 365 y 360 días.</p>
            <div className="bond-calculator-inputs">
              <div className="bond-calculator-field">
                <label htmlFor="dpf-days">Vencimiento (días)</label>
                <input id="dpf-days" type="text" inputMode="numeric"
                  value={dpfDaysText} onChange={(event) => setDpfDaysText(event.target.value)}
                  placeholder="Ej. 180" autoComplete="off" />
              </div>
              <div className="bond-calculator-field">
                <label htmlFor="dpf-yield">Yield del bono (%)</label>
                <input id="dpf-yield" type="text" inputMode="decimal"
                  value={dpfYieldText} onChange={(event) => setDpfYieldText(event.target.value)}
                  placeholder="Ej. 5,70" autoComplete="off" />
              </div>
            </div>
            <div className="bond-calculator-results bond-calculator-dpf-result" aria-live="polite">
              <div className="bond-calculator-result bond-calculator-result-primary">
                <span>Comparativa DPF</span>
                <strong>{formatDpfPercent(dpfRate)}</strong>
              </div>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

export function BondSpreadCalculators() {
  const [data, setData] = useState<RFData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/data/rf.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("No se pudo cargar la curva benchmark");
        return response.json() as Promise<RFData>;
      })
      .then((json) => {
        if (!controller.signal.aborted) setData(json);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, []);

  const clpCurve = useMemo(() => data ? buildBenchmarkDurationCurve(data, "BTP") : [], [data]);
  const ufCurve = useMemo(() => data ? buildBenchmarkDurationCurve(data, "BTU") : [], [data]);
  const dataStatus = error ? "error" : data ? "ready" : "loading";

  return (
    <details className="calculator-group" open>
      <summary className="calculator-group-summary">
        <span><Calculator size={20} aria-hidden="true" /> Spread Bonos</span>
        <ChevronDown size={21} className="calculator-group-chevron" aria-hidden="true" />
      </summary>
      <div className="calculator-group-content">
        <p className="calculator-group-intro">
          Ingresa duración y yield para calcular el spread frente a la curva benchmark,
          utilizando los instrumentos seleccionados para Tasas Benchmark.
        </p>
        <div className="calculator-data-date" aria-live="polite">
          {data && <>Cierre de referencia: <strong>{data.lastMarketDate}</strong> · RiskAmerica</>}
          {!data && !error && "Cargando curvas de referencia…"}
          {error && "No se pudieron cargar las curvas de referencia."}
        </div>
        <div className="bond-calculator-list">
          <SpreadCalculator type="BTP" curve={clpCurve} dataStatus={dataStatus} />
          <SpreadCalculator type="BTU" curve={ufCurve} dataStatus={dataStatus} />
        </div>
      </div>
    </details>
  );
}

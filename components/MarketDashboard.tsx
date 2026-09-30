"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { AppShell } from "./AppShell";
import {
  RFData,
  Instrument,
  formatBp,
  formatPercent,
  instrumentSnapshot,
  isActiveInstrument,
  maturityLabel,
} from "@/lib/rf";

function Change({ value }: { value: number | null }) {
  if (value == null) return <span className="muted">—</span>;

  return (
    <span className={value < 0 ? "good" : value > 0 ? "bad" : "muted"}>
      {formatBp(value)} bp
    </span>
  );
}

function MarketTable({
  title,
  instruments,
  data,
}: {
  title: string;
  instruments: Instrument[];
  data: RFData;
}) {
  return (
    <section className="panel market-table-panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">Curva nominal / real</div>
          <h2>{title}</h2>
        </div>
        <span className="pill">{instruments.length} vigentes</span>
      </div>

      <div
        className="table-wrap"
        role="region"
        aria-label={`Tabla ${title}`}
        tabIndex={0}
      >
        <table className="market-table">
          <thead>
            <tr>
              <th>Instrumento</th>
              <th>Venc.</th>
              <th>Yield</th>
              <th>Δ Día</th>
              <th>MTD</th>
              <th>YTD</th>
            </tr>
          </thead>
          <tbody>
            {instruments.map((inst) => {
              const s = instrumentSnapshot(data, inst.code);

              return (
                <tr key={inst.code}>
                  <td>
                    <strong>{inst.code}</strong>
                    <div className="subcell">
                      Cupón {inst.coupon?.toFixed(1) ?? "—"}%
                    </div>
                  </td>
                  <td>{maturityLabel(inst)}</td>
                  <td className="num strong">{formatPercent(s?.value, 3)}</td>
                  <td className="num">
                    <Change value={s?.d1 ?? null} />
                  </td>
                  <td className="num">
                    <Change value={s?.mtd ?? null} />
                  </td>
                  <td className="num">
                    <Change value={s?.ytd ?? null} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const macroKpis = [
  {
    label: "TPM",
    value: "4,50%",
    description: "Tasa de Política Monetaria",
  },
  {
    label: "Inflación Anual",
    value: "4,13%",
    description: "Variación IPC 12 meses",
  },
  {
    label: "IPC Mensual",
    value: "0,60%",
    description: "Último dato mensual",
  },
  {
    label: "Desempleo",
    value: "9,40%",
    description: "Tasa de desocupación",
  },
];

type CurvePoint = {
  term: number;
  yield: number | null;
  code: string;
  name: string;
};

type NelsonSiegelFit = {
  beta0: number;
  beta1: number;
  beta2: number;
  tau: number;
};

function yearsToMaturity(inst: Instrument, marketDate: string) {
  const d = new Date(`${marketDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;

  const maturity = new Date(inst.maturityYear, inst.maturityMonth - 1, 15);
  const years =
    (maturity.getTime() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

  return Math.max(years, 0.01);
}

function nsFactors(term: number, tau: number) {
  const x = term / tau;
  const exp = Math.exp(-x);
  const f1 = (1 - exp) / x;
  const f2 = f1 - exp;
  return [1, f1, f2] as const;
}

function solve3x3(a: number[][], b: number[]) {
  const m = a.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }

    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];

    const divisor = m[col][col];
    for (let j = col; j < 4; j++) m[col][j] /= divisor;

    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const factor = m[row][col];
      for (let j = col; j < 4; j++) m[row][j] -= factor * m[col][j];
    }
  }

  return [m[0][3], m[1][3], m[2][3]] as const;
}

function fitNelsonSiegel(points: CurvePoint[]): NelsonSiegelFit | null {
  const valid = points.filter(
    (p): p is CurvePoint & { yield: number } =>
      typeof p.yield === "number" && Number.isFinite(p.yield) && p.term > 0,
  );

  if (valid.length < 4) return null;

  let best: (NelsonSiegelFit & { sse: number }) | null = null;

  for (let tau = 0.15; tau <= 15; tau += 0.05) {
    const xtx = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const xty = [0, 0, 0];

    for (const p of valid) {
      const x = nsFactors(p.term, tau);
      for (let i = 0; i < 3; i++) {
        xty[i] += x[i] * p.yield;
        for (let j = 0; j < 3; j++) xtx[i][j] += x[i] * x[j];
      }
    }

    const beta = solve3x3(xtx, xty);
    if (!beta) continue;

    let sse = 0;
    for (const p of valid) {
      const x = nsFactors(p.term, tau);
      const fitted = beta[0] * x[0] + beta[1] * x[1] + beta[2] * x[2];
      sse += (p.yield - fitted) ** 2;
    }

    if (!best || sse < best.sse) {
      best = {
        beta0: beta[0],
        beta1: beta[1],
        beta2: beta[2],
        tau,
        sse,
      };
    }
  }

  if (!best) return null;
  const { beta0, beta1, beta2, tau } = best;
  return { beta0, beta1, beta2, tau };
}

function nelsonSiegelYield(term: number, fit: NelsonSiegelFit) {
  const x = nsFactors(term, fit.tau);
  return fit.beta0 * x[0] + fit.beta1 * x[1] + fit.beta2 * x[2];
}

function interpolateMarketYield(term: number, points: CurvePoint[]) {
  const valid = points.filter(
    (p): p is CurvePoint & { yield: number } =>
      typeof p.yield === "number" && Number.isFinite(p.yield),
  );

  if (!valid.length) return null;
  if (term < valid[0].term || term > valid[valid.length - 1].term) return null;
  if (term === valid[0].term) return valid[0].yield;

  for (let i = 1; i < valid.length; i++) {
    const left = valid[i - 1];
    const right = valid[i];
    if (term <= right.term) {
      const weight = (term - left.term) / (right.term - left.term);
      return left.yield + weight * (right.yield - left.yield);
    }
  }

  return null;
}

function findHistoryOnOrBefore(data: RFData, date: string) {
  for (let i = data.history.length - 1; i >= 0; i--) {
    if (data.history[i].date <= date) return data.history[i];
  }
  return null;
}

function curveAtDate(
  data: RFData,
  curveType: "BTP" | "BTU",
  marketDate: string,
  values: Record<string, number>,
) {
  const refDate = new Date(`${marketDate}T12:00:00`);

  return data.instruments
    .filter((inst) => inst.type === curveType && isActiveInstrument(inst, refDate))
    .map((inst) => ({
      term: yearsToMaturity(inst, marketDate) ?? 0,
      yield: typeof values[inst.code] === "number" ? values[inst.code] : null,
      code: inst.code,
      name: maturityLabel(inst),
    }))
    .filter((p) => p.term > 0 && p.yield != null)
    .sort((a, b) => a.term - b.term);
}

function CurveTooltip({
  active,
  label,
  currentCurve,
  comparisonCurve,
  comparisonDate,
  nsFit,
  showNelsonSiegel,
  curveType,
  currentDate,
}: {
  active?: boolean;
  label?: number | string;
  currentCurve: CurvePoint[];
  comparisonCurve: CurvePoint[];
  comparisonDate: string | null;
  nsFit: NelsonSiegelFit | null;
  showNelsonSiegel: boolean;
  curveType: "BTP" | "BTU";
  currentDate: string;
}) {
  if (!active || label == null) return null;

  const term = Number(label);
  if (!Number.isFinite(term)) return null;

  const exactPoint = currentCurve.find((p) => Math.abs(p.term - term) < 1e-6);
  const current = interpolateMarketYield(term, currentCurve);
  const comparison = comparisonDate
    ? interpolateMarketYield(term, comparisonCurve)
    : null;
  const ns = showNelsonSiegel && nsFit ? nelsonSiegelYield(term, nsFit) : null;
  const move = current != null && comparison != null ? (current - comparison) * 100 : null;

  return (
    <div className="curve-tooltip">
      <div className="curve-tooltip-title">
        {exactPoint?.code ?? `${curveType} · ${term.toFixed(2)} años`}
      </div>
      {exactPoint?.name && <div className="curve-tooltip-sub">{exactPoint.name}</div>}
      {current != null && <div>Actual ({currentDate}): {current.toFixed(3)}%</div>}
      {comparison != null && comparisonDate && (
        <div>{comparisonDate}: {comparison.toFixed(3)}%</div>
      )}
      {move != null && (
        <div className={move < 0 ? "good" : move > 0 ? "bad" : "muted"}>
          Cambio: {formatBp(move)} bp
        </div>
      )}
      {ns != null && <div>Nelson-Siegel: {ns.toFixed(3)}%</div>}
    </div>
  );
}

export function MarketDashboard() {
  const [data, setData] = useState<RFData | null>(null);
  const [curveType, setCurveType] = useState<"BTP" | "BTU">("BTP");
  const [showNelsonSiegel, setShowNelsonSiegel] = useState(false);
  const [compareDate, setCompareDate] = useState("");

  useEffect(() => {
    fetch("/data/rf.json")
      .then((r) => r.json())
      .then(setData);
  }, []);

  const active = useMemo(
    () =>
      data
        ? data.instruments
            .filter((i) => isActiveInstrument(i))
            .sort(
              (a, b) =>
                a.maturityYear * 12 +
                a.maturityMonth -
                (b.maturityYear * 12 + b.maturityMonth),
            )
        : [],
    [data],
  );

  const btp = active.filter((i) => i.type === "BTP");
  const btu = active.filter((i) => i.type === "BTU");

  const currentCurve = useMemo<CurvePoint[]>(() => {
    if (!data) return [];
    const currentRow = findHistoryOnOrBefore(data, data.lastMarketDate);
    if (!currentRow) return [];
    return curveAtDate(data, curveType, currentRow.date, currentRow.values);
  }, [data, curveType]);

  const comparisonRow = useMemo(
    () => (data && compareDate ? findHistoryOnOrBefore(data, compareDate) : null),
    [data, compareDate],
  );

  const comparisonCurve = useMemo<CurvePoint[]>(() => {
    if (!data || !comparisonRow) return [];
    return curveAtDate(data, curveType, comparisonRow.date, comparisonRow.values);
  }, [data, comparisonRow, curveType]);

  const nsFit = useMemo(() => fitNelsonSiegel(currentCurve), [currentCurve]);

  const curveAxis = useMemo(() => {
    const allTerms = [...currentCurve, ...comparisonCurve].map((p) => p.term);
    const maxTerm = allTerms.length ? Math.max(...allTerms) : 20;
    const ticks = [1, 2, 5, 10, 15, 20];
    if (maxTerm > 20) ticks.push(30);

    return {
      ticks,
      max: maxTerm > 20 ? Math.max(30, Math.ceil(maxTerm / 10) * 10) : 20,
    };
  }, [currentCurve, comparisonCurve]);

  const chartData = useMemo(() => {
    if (!currentCurve.length) return [];

    const rows: Array<{
      term: number;
      yield?: number | null;
      compareYield?: number | null;
      nsYield?: number | null;
      code?: string;
      name?: string;
    }> = [];

    for (const point of currentCurve) {
      rows.push({
        term: point.term,
        yield: point.yield,
        code: point.code,
        name: point.name,
      });
    }

    for (const point of comparisonCurve) {
      rows.push({
        term: point.term,
        compareYield: point.yield,
        code: point.code,
        name: point.name,
      });
    }

    if (showNelsonSiegel && nsFit) {
      const minTerm = Math.max(0.05, currentCurve[0].term);
      const maxTerm = currentCurve[currentCurve.length - 1].term;
      const steps = 140;

      for (let i = 0; i <= steps; i++) {
        const term = minTerm + ((maxTerm - minTerm) * i) / steps;
        rows.push({
          term,
          nsYield: nelsonSiegelYield(term, nsFit),
        });
      }
    }

    return rows.sort((a, b) => a.term - b.term);
  }, [currentCurve, comparisonCurve, nsFit, showNelsonSiegel]);

  const movementSummary = useMemo(() => {
    if (!comparisonRow || !comparisonCurve.length) return [];
    return [2, 5, 10, 20]
      .map((term) => {
        const current = interpolateMarketYield(term, currentCurve);
        const previous = interpolateMarketYield(term, comparisonCurve);
        return {
          term,
          value:
            current != null && previous != null
              ? (current - previous) * 100
              : null,
        };
      })
      .filter((x) => x.value != null);
  }, [comparisonRow, comparisonCurve, currentCurve]);

  if (!data) {
    return (
      <AppShell>
        <div className="loading">Cargando mercado…</div>
      </AppShell>
    );
  }

  const minHistoryDate = data.history[0]?.date;
  const maxHistoryDate = data.lastMarketDate;

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <div className="eyebrow">Trading Propietario</div>
          <h1>Mercado de Renta Fija Chilena</h1>
        </div>

        <div className="asof">
          <span>Último cierre</span>
          <strong>{data.lastMarketDate}</strong>
        </div>
      </header>

      <div className="kpi-grid">
        {macroKpis.map((kpi) => (
          <div className="kpi" key={kpi.label}>
            <div className="kpi-label">{kpi.label}</div>
            <div className="kpi-value">{kpi.value}</div>
            <div className="kpi-foot kpi-foot-static">
              <span>{kpi.description}</span>
            </div>
          </div>
        ))}
      </div>

      <section className="panel curve-panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Estructura temporal</div>
            <h2>Curvas de Rendimiento</h2>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="segmented">
              <button
                className={curveType === "BTP" ? "selected" : ""}
                onClick={() => setCurveType("BTP")}
              >
                BTP
              </button>
              <button
                className={curveType === "BTU" ? "selected" : ""}
                onClick={() => setCurveType("BTU")}
              >
                BTU
              </button>
            </div>

            <label className="curve-check">
              <input
                type="checkbox"
                checked={showNelsonSiegel}
                onChange={(e) => setShowNelsonSiegel(e.target.checked)}
              />
              <span>Nelson-Siegel</span>
            </label>
          </div>
        </div>

        <div className="curve-controls">
          <div className="curve-date-control">
            <span>Comparar con</span>
            <input
              type="date"
              value={compareDate}
              min={minHistoryDate}
              max={maxHistoryDate}
              onChange={(e) => setCompareDate(e.target.value)}
            />
            {compareDate && (
              <button type="button" onClick={() => setCompareDate("")}>Quitar</button>
            )}
          </div>
        </div>

        {compareDate && comparisonRow && (
          <div className="comparison-note">
            Comparación con cierre de <strong>{comparisonRow.date}</strong>
            {comparisonRow.date !== compareDate && (
              <span> · último dato disponible anterior a {compareDate}</span>
            )}
          </div>
        )}

        {movementSummary.length > 0 && (
          <div className="curve-move-grid">
            {movementSummary.map((item) => (
              <div className="curve-move" key={item.term}>
                <span>{item.term}a</span>
                <strong className={(item.value ?? 0) < 0 ? "good" : (item.value ?? 0) > 0 ? "bad" : "muted"}>
                  {formatBp(item.value)} bp
                </strong>
              </div>
            ))}
          </div>
        )}

        <div className="chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ left: 8, right: 20, top: 10, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="term"
                type="number"
                domain={[0, curveAxis.max]}
                ticks={curveAxis.ticks}
                tickFormatter={(v) => `${Number(v).toFixed(0)}a`}
              />
              <YAxis
                domain={["auto", "auto"]}
                tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
              />
              <Tooltip
                content={
                  <CurveTooltip
                    currentCurve={currentCurve}
                    comparisonCurve={comparisonCurve}
                    comparisonDate={comparisonRow?.date ?? null}
                    nsFit={nsFit}
                    showNelsonSiegel={showNelsonSiegel}
                    curveType={curveType}
                    currentDate={data.lastMarketDate}
                  />
                }
              />
              <Legend />
              <Line
                type="linear"
                dataKey="yield"
                name={`Actual · ${data.lastMarketDate}`}
                stroke="currentColor"
                strokeWidth={2.5}
                dot={{ r: 3.5 }}
                connectNulls
              />
              {comparisonRow && (
                <Line
                  type="linear"
                  dataKey="compareYield"
                  name={`Comparación · ${comparisonRow.date}`}
                  stroke="#64748b"
                  strokeWidth={2}
                  strokeDasharray="6 5"
                  dot={{ r: 3 }}
                  connectNulls
                  isAnimationActive={false}
                />
              )}
              {showNelsonSiegel && nsFit && (
                <Line
                  type="monotone"
                  dataKey="nsYield"
                  name="Nelson-Siegel"
                  stroke="#f59e0b"
                  strokeWidth={2.25}
                  strokeDasharray="7 5"
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="two-col">
        <MarketTable
          title="Bonos de Gobierno en Pesos"
          instruments={btp}
          data={data}
        />
        <MarketTable
          title="Bonos de Gobierno en UF"
          instruments={btu}
          data={data}
        />
      </div>

      <div className="note">
        Regla de vigencia: el instrumento se mantiene visible durante su mes de
        vencimiento y el mes siguiente. Luego se oculta automáticamente.
      </div>
    </AppShell>
  );
}

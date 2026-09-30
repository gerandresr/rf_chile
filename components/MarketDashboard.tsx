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

  // Los datos solo informan mes/año de vencimiento. Se usa el día 15 como
  // aproximación neutral dentro del mes para calcular el plazo en años.
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

  // Búsqueda simple y robusta del parámetro tau. Para un tau fijo,
  // beta0/beta1/beta2 se obtienen por mínimos cuadrados lineales.
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
  if (term <= valid[0].term) return valid[0].yield;
  if (term >= valid[valid.length - 1].term) return valid[valid.length - 1].yield;

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

function CurveTooltip({
  active,
  label,
  curveData,
  nsFit,
  showNelsonSiegel,
  curveType,
}: {
  active?: boolean;
  label?: number | string;
  curveData: CurvePoint[];
  nsFit: NelsonSiegelFit | null;
  showNelsonSiegel: boolean;
  curveType: "BTP" | "BTU";
}) {
  if (!active || label == null) return null;

  const term = Number(label);
  if (!Number.isFinite(term)) return null;

  const exactPoint = curveData.find((p) => Math.abs(p.term - term) < 1e-6);
  const market = interpolateMarketYield(term, curveData);
  const ns =
    showNelsonSiegel && nsFit ? nelsonSiegelYield(term, nsFit) : null;

  return (
    <div
      style={{
        background: "var(--panel, #fff)",
        border: "1px solid rgba(148, 163, 184, 0.35)",
        borderRadius: 8,
        padding: "8px 10px",
        boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 3 }}>
        {exactPoint?.code ?? `${curveType} · ${term.toFixed(2)} años`}
      </div>
      {exactPoint?.name && (
        <div style={{ color: "var(--muted)", fontSize: 11, marginBottom: 4 }}>
          {exactPoint.name}
        </div>
      )}
      {market != null && <div>Mercado: {market.toFixed(3)}%</div>}
      {ns != null && <div>Nelson-Siegel: {ns.toFixed(3)}%</div>}
    </div>
  );
}

export function MarketDashboard() {
  const [data, setData] = useState<RFData | null>(null);
  const [curveType, setCurveType] = useState<"BTP" | "BTU">("BTP");
  const [showNelsonSiegel, setShowNelsonSiegel] = useState(false);

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

  const curveData = useMemo<CurvePoint[]>(
    () =>
      !data
        ? []
        : active
            .filter((i) => i.type === curveType)
            .map((inst) => {
              const s = instrumentSnapshot(data, inst.code);
              const term = yearsToMaturity(inst, data.lastMarketDate);
              return {
                term: term ?? 0,
                yield: s?.value ?? null,
                code: inst.code,
                name: maturityLabel(inst),
              };
            })
            .filter((x) => x.yield != null && x.term > 0)
            .sort((a, b) => a.term - b.term),
    [data, active, curveType],
  );

  const nsFit = useMemo(() => fitNelsonSiegel(curveData), [curveData]);

  const curveAxis = useMemo(() => {
    const maxTerm = curveData.length
      ? curveData[curveData.length - 1].term
      : 20;
    const ticks = [1, 2, 5, 10, 15, 20];

    if (maxTerm > 20) ticks.push(30);

    return {
      ticks,
      max: maxTerm > 20 ? Math.max(30, Math.ceil(maxTerm / 10) * 10) : 20,
    };
  }, [curveData]);

  const chartData = useMemo(() => {
    if (!curveData.length) return [];

    const rows: Array<{
      term: number;
      yield?: number | null;
      nsYield?: number | null;
      code?: string;
      name?: string;
    }> = curveData.map((point) => ({
      term: point.term,
      yield: point.yield,
      code: point.code,
      name: point.name,
      nsYield:
        showNelsonSiegel && nsFit
          ? nelsonSiegelYield(point.term, nsFit)
          : null,
    }));

    if (showNelsonSiegel && nsFit) {
      const minTerm = Math.max(0.05, curveData[0].term);
      const maxTerm = curveData[curveData.length - 1].term;
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
  }, [curveData, nsFit, showNelsonSiegel]);

  if (!data) {
    return (
      <AppShell>
        <div className="loading">Cargando mercado…</div>
      </AppShell>
    );
  }

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
            <h2>Curva de Bonos de Gobierno</h2>
          </div>

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
        </div>

        <div className="curve-options-row">
          <label className="curve-check">
            <input
              type="checkbox"
              checked={showNelsonSiegel}
              onChange={(e) => setShowNelsonSiegel(e.target.checked)}
            />
            <span>Nelson-Siegel</span>
          </label>
        </div>

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
                    curveData={curveData}
                    nsFit={nsFit}
                    showNelsonSiegel={showNelsonSiegel}
                    curveType={curveType}
                  />
                }
              />
              <Legend />
              <Line
                type="linear"
                dataKey="yield"
                name="Mercado"
                stroke="currentColor"
                strokeWidth={2.5}
                dot={{ r: 3.5 }}
                connectNulls
              />
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

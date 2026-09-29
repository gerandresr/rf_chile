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

      <div className="table-wrap" role="region" aria-label={`Tabla ${title}`} tabIndex={0}>
        <table className="market-table">
          <thead>
            <tr>
              <th>Instrumento</th>
              <th>Venc.</th>
              <th>Yield</th>
              <th>Δ Día</th>
              <th>Δ 1S</th>
              <th>Δ 1M</th>
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
                    <Change value={s?.w1 ?? null} />
                  </td>
                  <td className="num">
                    <Change value={s?.m1 ?? null} />
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

export function MarketDashboard() {
  const [data, setData] = useState<RFData | null>(null);
  const [curveType, setCurveType] = useState<"BTP" | "BTU">("BTP");

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
                a.maturityYear * 12 + a.maturityMonth -
                (b.maturityYear * 12 + b.maturityMonth),
            )
        : [],
    [data],
  );

  const btp = active.filter((i) => i.type === "BTP");
  const btu = active.filter((i) => i.type === "BTU");

  const curveData = useMemo(
    () =>
      !data
        ? []
        : active
            .filter((i) => i.type === curveType)
            .map((inst) => {
              const s = instrumentSnapshot(data, inst.code);
              return {
                name: maturityLabel(inst),
                yield: s?.value ?? null,
                code: inst.code,
              };
            })
            .filter((x) => x.yield != null),
    [data, active, curveType],
  );

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
          <div className="eyebrow">Mesa Trading Propietario BE</div>
          <h1>Resumen Mercado de Renta Fija Chilena</h1>
          <p>
            Dashboard de Renta Fija Chilena que centraliza principales indicadores
            macroeconomicos, tasas de mercado, bonos y curvas de gobierno además de
            series historicas.
          </p>
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

        <div className="chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={curveData}
              margin={{ left: 8, right: 20, top: 10, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" />
              <YAxis
                domain={["auto", "auto"]}
                tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
              />
              <Tooltip
                labelFormatter={(label, payload) =>
                  payload?.[0]?.payload?.code ?? label
                }
                formatter={(v) => [`${Number(v).toFixed(3)}%`, "Yield"]}
              />
              <Line
                type="monotone"
                dataKey="yield"
                stroke="currentColor"
                strokeWidth={2.5}
                dot={{ r: 3.5 }}
              />
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

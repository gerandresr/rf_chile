"use client";

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fitGarch11Yield } from "@/lib/garch";
import { observations, RFData } from "@/lib/rf";

type Window = "1y" | "2y" | "3y" | "all";

const number = (value: number, digits = 2) => new Intl.NumberFormat("es-CL", {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
}).format(value);

function shortDate(date: string) {
  return new Intl.DateTimeFormat("es-CL", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function longDate(date: string) {
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function filterWindow<T extends { date: string }>(rows: T[], window: Window) {
  if (window === "all" || rows.length === 0) return rows;
  const years = window === "1y" ? 1 : window === "2y" ? 2 : 3;
  const last = new Date(`${rows[rows.length - 1].date}T00:00:00Z`);
  last.setUTCFullYear(last.getUTCFullYear() - years);
  const cutoff = last.toISOString().slice(0, 10);
  return rows.filter(row => row.date >= cutoff);
}

export function GarchYieldModel() {
  const [data, setData] = useState<RFData | null>(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState("BTP0581029");
  const [window, setWindow] = useState<Window>("3y");

  useEffect(() => {
    fetch("/data/rf.json")
      .then(response => {
        if (!response.ok) throw new Error("No fue posible cargar las tasas históricas.");
        return response.json();
      })
      .then((loaded: RFData) => {
        setData(loaded);
        const preferred = loaded.instruments.find(i => i.code === "BTP0581029" && (i.type === "BTP" || i.type === "BTU"));
        const first = loaded.instruments.find(i => i.type === "BTP" || i.type === "BTU");
        setCode(preferred?.code ?? first?.code ?? "");
      })
      .catch(e => setError(e instanceof Error ? e.message : "No fue posible cargar las tasas históricas."));
  }, []);

  const instruments = useMemo(() => data?.instruments
    .filter(i => i.type === "BTP" || i.type === "BTU")
    .slice()
    .sort((a, b) => a.type.localeCompare(b.type) || a.maturityYear - b.maturityYear || a.maturityMonth - b.maturityMonth || a.code.localeCompare(b.code)) ?? [], [data]);

  const estimation = useMemo(() => {
    if (!data || !code) return { result: null, error: "" };
    try {
      const obs = filterWindow(observations(data, code), window);
      return { result: fitGarch11Yield(obs), error: "" };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : "No fue posible estimar GARCH(1,1)." };
    }
  }, [data, code, window]);

  if (!data) return <div className="model-content" role="status">{error || "Cargando tasas históricas…"}</div>;
  const result = estimation.result;

  return <div className="model-content">
    <p className="model-caption">
      GARCH(1,1) estimado exclusivamente sobre cambios diarios de yield, expresados en puntos base. El modelo pronostica volatilidad y rangos probables de la yield; no utiliza precio, cupón, carry ni duración. La dirección esperada proviene solo de la media histórica diaria de la muestra.
    </p>

    <div className="backtest-controls">
      <div className="control">
        <label htmlFor="garch-instrument">Instrumento</label>
        <select id="garch-instrument" value={code} onChange={e => setCode(e.target.value)}>
          {instruments.map(instrument => <option key={instrument.code} value={instrument.code}>{instrument.code}</option>)}
        </select>
      </div>
      <div className="control">
        <label htmlFor="garch-window">Ventana de estimación</label>
        <select id="garch-window" value={window} onChange={e => setWindow(e.target.value as Window)}>
          <option value="1y">1 año</option>
          <option value="2y">2 años</option>
          <option value="3y">3 años</option>
          <option value="all">Toda la historia</option>
        </select>
      </div>
    </div>

    {estimation.error && <div className="model-notice" role="alert">{estimation.error}</div>}

    {result && <>
      <div className="kpi-grid model-kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Yield actual</div>
          <div className="kpi-value">{number(result.latestYield, 3)}%</div>
          <div className="kpi-foot kpi-foot-static">Último dato disponible</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Volatilidad esperada 1 día</div>
          <div className="kpi-value">{number(result.nextDayVolatilityBp)} pb</div>
          <div className="kpi-foot kpi-foot-static">Desvío estándar del próximo cambio de yield</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Volatilidad de largo plazo</div>
          <div className="kpi-value">{number(result.longRunVolatilityBp)} pb</div>
          <div className="kpi-foot kpi-foot-static">Nivel diario de reversión del modelo</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Persistencia α + β</div>
          <div className="kpi-value">{number(result.persistence, 3)}</div>
          <div className="kpi-foot kpi-foot-static">{result.halfLifeDays == null ? "Persistencia no estacionaria" : `Vida media del shock: ${number(result.halfLifeDays, 1)} días`}</div>
        </div>
      </div>

      <section className="model-chart-section" aria-label="Pronósticos GARCH de yield">
        <div className="panel-head">
          <h2>Pronóstico de yield</h2>
          <span className="pill">Horizontes 1, 5 y 20 días</span>
        </div>
        <p className="model-caption">La volatilidad acumulada corresponde al desvío estándar del movimiento total de yield hasta cada horizonte. Los rangos 68% y 95% asumen innovaciones gaussianas y no son garantías.</p>
        <div className="table-wrap">
          <table className="backtest-table">
            <thead>
              <tr>
                <th>Horizonte</th>
                <th>Yield esperada</th>
                <th>Vol. acumulada</th>
                <th>Rango 68%</th>
                <th>Rango 95%</th>
              </tr>
            </thead>
            <tbody>
              {result.forecasts.map(forecast => <tr key={forecast.horizonDays}>
                <td>{forecast.horizonDays} día{forecast.horizonDays === 1 ? "" : "s"}</td>
                <td>{number(forecast.expectedYield, 3)}%</td>
                <td>{number(forecast.cumulativeVolatilityBp)} pb</td>
                <td>{number(forecast.lower68, 3)}% – {number(forecast.upper68, 3)}%</td>
                <td>{number(forecast.lower95, 3)}% – {number(forecast.upper95, 3)}%</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="model-chart-section" aria-label="Yield y volatilidad GARCH">
        <div className="panel-head">
          <h2>Yield y volatilidad condicional histórica</h2>
          <span className="pill">{result.observations} cambios diarios · α {number(result.alpha, 3)} · β {number(result.beta, 3)}</span>
        </div>
        <p className="model-caption">La línea de yield usa el eje izquierdo. La volatilidad GARCH histórica se muestra en puntos base diarios en el eje derecho.</p>
        <div className="model-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={result.points} margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
              <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={60} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="yield" domain={["auto", "auto"]} tickFormatter={value => `${number(Number(value), 2)}%`} width={62} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="vol" orientation="right" domain={[0, "auto"]} tickFormatter={value => `${number(Number(value), 1)} pb`} width={68} tick={{ fontSize: 11 }} />
              <Tooltip content={({ active, payload }) => {
                const point = payload?.[0]?.payload;
                if (!active || !point) return null;
                return <div className="curve-tooltip">
                  <div className="curve-tooltip-title">{longDate(point.date)}</div>
                  <div>Yield: {number(point.yield, 3)}%</div>
                  <div>Cambio diario: {point.changeBp > 0 ? "+" : ""}{number(point.changeBp)} pb</div>
                  <div>Volatilidad GARCH: {number(point.volatilityBp)} pb</div>
                </div>;
              }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="yield" dataKey="yield" name="Yield" stroke="#172033" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="vol" dataKey="volatilityBp" name="Volatilidad GARCH" stroke="#2f6fed" strokeWidth={2.25} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <p className="model-caption">
        Media diaria estimada del cambio de yield: {result.meanChangeBp > 0 ? "+" : ""}{number(result.meanChangeBp, 2)} pb. GARCH modela principalmente la incertidumbre, no la dirección; por eso la yield esperada debe interpretarse con cautela y los rangos son el resultado más informativo del modelo.
      </p>
    </>}
  </div>;
}

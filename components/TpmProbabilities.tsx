"use client";

import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TpmModelData } from "@/lib/market-models.server";

const number = (value: number, digits = 2) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
const signed = (value: number, digits = 0) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${number(Math.abs(value), digits)}`;
const day = (date: string) => new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const month = (date: string) => new Intl.DateTimeFormat("es-CL", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const meetingLabel = (date: string) => new Intl.DateTimeFormat("es-CL", { month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)).replace(".", "").toUpperCase() + "'" + date.slice(2, 4);

// Paleta del sitio: azul (--accent) con intensidad según la probabilidad; rojo (--red) para el nivel más probable.
const BLUE = "47, 111, 237";
const cellStyle = (prob: number, isMode: boolean): React.CSSProperties => {
  if (isMode) return { background: "rgba(217, 75, 75, 0.16)", color: "#b42323", fontWeight: 750, textAlign: "center" };
  if (prob < 0.005) return { color: "#a3adbd", textAlign: "center" };
  return { background: `rgba(${BLUE}, ${(0.08 + 0.5 * prob).toFixed(3)})`, color: "#172033", textAlign: "center" };
};

/** Probabilidades de TPM por reunión implícitas en los swaps Cámara, e historia de lo descontado. */
export function TpmProbabilities({ data }: { data: TpmModelData }) {
  const [windowIndex, setWindowIndex] = useState(2);
  if ("error" in data) return <section className="panel"><div className="model-notice" role="alert">{data.error}</div></section>;
  const { path, history, source } = data;
  const levels = [...new Set(path.distributions.flatMap(d => Object.entries(d.probabilities).filter(([, p]) => p >= 0.005).map(([l]) => l)))]
    .sort((a, b) => Number(b) - Number(a));
  const modes = path.distributions.map(d => Object.entries(d.probabilities).sort((a, b) => b[1] - a[1])[0]?.[0]);
  const selected = history[windowIndex];
  const rows = selected.points.map(p => ({ date: p.date, implied: p.implied, realized: p.realized }));

  return <>
    <section className="panel" aria-label="Distribución de probabilidad de la TPM">
      <div className="panel-head" style={{ flexWrap: "wrap" }}>
        <div><div className="eyebrow">Swaps Cámara · movimientos de 25 pb</div><h2>Distribución de probabilidad TPM</h2></div>
        <span className="pill">{source} · TPM actual {number(path.currentTpm)}%</span>
      </div>
      <p className="model-caption">Probabilidad de que la TPM quede en cada nivel después de cada reunión del Consejo. En rojo, el nivel más probable; el azul es más intenso a mayor probabilidad.</p>
      <div className="table-wrap"><table className="tpm-probability-table">
        <thead><tr><th>TPM</th>{path.distributions.map(d => <th key={d.meeting} title={day(d.meeting)}>{meetingLabel(d.meeting)}</th>)}</tr></thead>
        <tbody>{levels.map(level => <tr key={level}>
          <td className="strong">{number(Number(level))}</td>
          {path.distributions.map((d, i) => {
            const prob = d.probabilities[level] ?? 0;
            return <td key={d.meeting} style={cellStyle(prob, modes[i] === level)}>{number(prob, 2)}</td>;
          })}
        </tr>)}</tbody>
        <tfoot><tr><td className="strong">Esperada</td>{path.path.map(p => <td key={p.meeting} style={{ textAlign: "center", fontWeight: 650 }}>{number(p.expectedTpm, 2)}</td>)}</tr>
          <tr><td className="muted">Cambio</td>{path.path.map(p => <td key={p.meeting} className="muted" style={{ textAlign: "center" }}>{signed(p.change * 100, 1)} pb</td>)}</tr></tfoot>
      </table></div>

      <div className="model-chart-section" aria-label="Historia de lo descontado versus lo efectivo">
      <div className="panel-head" style={{ flexWrap: "wrap" }}>
        <div><div className="eyebrow">Historia</div><h2>¿Acierta el mercado?</h2></div>
        <div className="segmented" role="group" aria-label="Ventana">
          {history.map((h, i) => <button key={h.window} className={i === windowIndex ? "selected" : ""} aria-pressed={i === windowIndex} onClick={() => setWindowIndex(i)}>{h.window}</button>)}
        </div>
      </div>
      <p className="model-caption">TPM promedio que descontaban los swaps para la ventana indicada, versus la TPM promedio que efectivamente rigió. Sesgo medio: {selected.biasBp === null ? "—" : `${signed(selected.biasBp, 0)} pb`} · error absoluto medio: {selected.maeBp === null ? "—" : `${number(selected.maeBp, 0)} pb`} ({selected.observations} observaciones semanales). Un sesgo negativo indica que la TPM terminó sobre lo descontado.</p>
      <div className="model-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
        <XAxis dataKey="date" tickFormatter={month} minTickGap={60} tick={{ fontSize: 11 }} />
        <YAxis domain={["auto", "auto"]} tickFormatter={v => `${number(Number(v), 0)}%`} width={44} tick={{ fontSize: 11 }} />
        <Tooltip labelFormatter={d => day(String(d))} formatter={(v, name) => [`${number(Number(v), 2)}%`, String(name)]} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line dataKey="implied" name="Descontado por swaps" stroke="#2f6fed" strokeWidth={1.8} dot={false} isAnimationActive={false} />
        <Line dataKey="realized" name="TPM efectiva" stroke="#d94b4b" strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls={false} />
      </LineChart></ResponsiveContainer></div>
      </div>
    </section>

    <div className="model-notice">
      <strong>Metodología.</strong>
      <p>Los swaps Cámara de hasta 18 meses pagan una sola vez al vencimiento, por lo que el factor de descuento afecta igual a ambas patas y se cancela: la tasa fija entrega directamente el ICP esperado (1 + r·días/360), sin necesidad de doble curva. Se supone un overnight constante entre reuniones que cambia el día hábil siguiente a cada decisión (calendario en tpm-meetings.json), y ICP = TPM + {number(path.spreadBp, 1)} pb (mediana en días sin cambios de TPM). Como hay menos plazos que reuniones, la TPM esperada se ajusta por mínimos cuadrados con una penalización pequeña a los saltos. Luego, en cada reunión el cambio esperado se reparte entre los dos movimientos de 25 pb más cercanos (por ejemplo, +9 pb = 36% de alza y 64% de mantención) y las reuniones se encadenan; la media de cada columna reproduce la TPM esperada. No descuenta prima por plazo.</p>
    </div>
  </>;
}

"use client";

import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TpmModelData } from "@/lib/market-models.server";

const number = (value: number, digits = 2) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
const signed = (value: number, digits = 0) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${number(Math.abs(value), digits)}`;
const day = (date: string) => new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const month = (date: string) => new Intl.DateTimeFormat("es-CL", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

export function TpmPathModel({ data, taylor }: { data: TpmModelData; taylor: { value: number; date: string } | null }) {
  const [windowIndex, setWindowIndex] = useState(2);
  if ("error" in data) return <div className="model-content"><div className="model-notice" role="alert">{data.error}</div></div>;
  const { path, history, source } = data;
  const next = path.nextMeeting;
  const probability = path.nextMeetingProbability;
  const lastInYear = [...path.path].reverse().find(p => p.effective <= new Date(new Date(`${path.valuationDate}T00:00:00Z`).getTime() + 366 * 86400000).toISOString().slice(0, 10)) ?? path.path.at(-1);
  const chart = [{ label: "Hoy", tpm: path.currentTpm }, ...path.path.map(p => ({ label: month(p.meeting), tpm: p.expectedTpm, meeting: p.meeting, change: p.change }))];
  const maxError = Math.max(...path.fit.map(f => Math.abs(f.errorBp)));
  // Matriz de probabilidades (grilla de 25 pb): filas = niveles de TPM, columnas = reuniones.
  const levels = [...new Set(path.distributions.flatMap(d => Object.entries(d.probabilities).filter(([, p]) => p >= 0.005).map(([l]) => l)))]
    .sort((a, b) => Number(b) - Number(a));
  const modes = path.distributions.map(d => Object.entries(d.probabilities).sort((a, b) => b[1] - a[1])[0]?.[0]);
  const shortMonth = (date: string) => new Intl.DateTimeFormat("es-CL", { month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)).replace(".", "").toUpperCase() + "'" + date.slice(2, 4);
  const selected = history[windowIndex];
  const historyRows = selected.points.map(p => ({ date: p.date, implied: p.implied, realized: p.realized }));
  const moveText = (p: number) => {
    const pct = Math.round(Math.abs(p) * 100);
    if (pct < 10) return "Sin cambio descontado";
    return pct > 100 ? `Más de un movimiento de 25 pb (${p > 0 ? "alza" : "recorte"})` : `${pct}% de probabilidad de ${p > 0 ? "alza" : "recorte"} de 25 pb`;
  };

  return <div className="model-content">
    <div className="model-intro">
      <p>Qué TPM descuenta el mercado para cada reunión del Consejo, extraída de los swaps Cámara de hasta 18 meses. No descuenta prima por plazo: en la historia, los swaps quedaron bajo la TPM efectiva a 6–12 meses, en gran parte por el ciclo de alzas de 2021–2022 (ver abajo).</p>
      <span className="pill">{source}</span>
    </div>
    <div className="kpi-grid">
      <div className="kpi"><div className="kpi-label">TPM actual</div><div className="kpi-value">{number(path.currentTpm)}%</div><div className="kpi-foot kpi-foot-static">Valorización {day(path.valuationDate)}</div></div>
      <div className="kpi"><div className="kpi-label">Próxima reunión{next ? ` · ${day(next.meeting)}` : ""}</div><div className="kpi-value">{next ? `${number(next.expectedTpm)}%` : "—"}</div><div className="kpi-foot kpi-foot-static">{probability === null ? "—" : moveText(probability)}</div></div>
      <div className="kpi"><div className="kpi-label">TPM esperada en ~12 meses</div><div className="kpi-value">{lastInYear ? `${number(lastInYear.expectedTpm)}%` : "—"}</div><div className="kpi-foot kpi-foot-static">{lastInYear ? `${signed(lastInYear.cumulativeChange * 100)} pb acumulados a ${month(lastInYear.meeting)}` : ""}</div></div>
      <div className="kpi"><div className="kpi-label">Regla de Taylor</div><div className="kpi-value">{taylor ? `${number(taylor.value)}%` : "—"}</div><div className="kpi-foot kpi-foot-static">{taylor ? `Con datos a ${month(taylor.date)}` : "Sin cálculo"}</div></div>
    </div>

    <section className="model-chart-section" aria-label="Trayectoria de TPM esperada">
      <div className="panel-head"><h2>TPM esperada por reunión</h2><span className="pill">Ajuste: error máx. {number(maxError, 1)} pb</span></div>
      <div className="model-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis domain={["auto", "auto"]} tickFormatter={v => `${number(Number(v), 2)}%`} width={60} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v) => [`${number(Number(v), 3)}%`, "TPM esperada"]} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <ReferenceLine y={path.currentTpm} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "TPM actual", position: "insideBottomLeft", fontSize: 11, fill: "#748096" }} />
        {taylor && <ReferenceLine y={taylor.value} stroke="#f59e0b" strokeDasharray="6 4" label={{ value: `Taylor ${number(taylor.value)}%`, position: "insideTopLeft", fontSize: 11, fill: "#b45309" }} />}
        <Line type="stepAfter" dataKey="tpm" name="TPM descontada por el mercado" stroke="#2f6fed" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
      </LineChart></ResponsiveContainer></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Reunión</th><th>Rige desde</th><th>TPM esperada</th><th>Cambio esperado</th><th>Acumulado</th><th>Escenario más probable</th></tr></thead>
        <tbody>{path.path.map((p, i) => <tr key={p.meeting}><td>{day(p.meeting)}</td><td>{day(p.effective)}</td><td>{number(p.expectedTpm, 3)}%</td><td>{signed(p.change * 100, 1)} pb</td><td>{signed(p.cumulativeChange * 100, 0)} pb</td><td className="strong">{modes[i] ? `${number(Number(modes[i]))}% (${Math.round(path.distributions[i].probabilities[modes[i]] * 100)}%)` : "—"}</td></tr>)}</tbody>
      </table></div>
    </section>

    <section className="model-chart-section" aria-label="Distribución de probabilidad de la TPM">
      <div className="panel-head"><h2>Distribución de probabilidad TPM</h2><span className="pill">Movimientos de 25 pb</span></div>
      <p className="model-caption">Probabilidad de que la TPM quede en cada nivel después de cada reunión. En cada reunión el cambio descontado se reparte entre los dos movimientos de 25 pb más cercanos (por ejemplo, +9 pb = 36% de alza y 64% de mantención) y las reuniones se encadenan. En rosado, el nivel más probable de cada reunión.</p>
      <div className="table-wrap"><table className="tpm-probability-table">
        <thead><tr><th>TPM</th>{path.distributions.map(d => <th key={d.meeting}>{shortMonth(d.meeting)}</th>)}</tr></thead>
        <tbody>{levels.map(level => <tr key={level}>
          <td className="strong">{number(Number(level))}</td>
          {path.distributions.map((d, i) => {
            const prob = d.probabilities[level] ?? 0;
            const background = modes[i] === level ? "#f5b5cf" : prob >= 0.005 ? "#a7e3ef" : undefined;
            return <td key={d.meeting} style={{ background, textAlign: "center" }}>{number(prob, 2)}</td>;
          })}
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="model-chart-section" aria-label="Historia de lo descontado versus lo efectivo">
      <div className="panel-head" style={{ flexWrap: "wrap" }}><h2>¿Acierta el mercado?</h2>
        <div className="segmented" role="group" aria-label="Ventana">
          {history.map((h, i) => <button key={h.window} className={i === windowIndex ? "selected" : ""} aria-pressed={i === windowIndex} onClick={() => setWindowIndex(i)}>{h.window}</button>)}
        </div>
      </div>
      <p className="model-caption">TPM promedio que descontaban los swaps para la ventana indicada, versus la TPM promedio que efectivamente rigió. Sesgo medio: {selected.biasBp === null ? "—" : `${signed(selected.biasBp, 0)} pb`} · error absoluto medio: {selected.maeBp === null ? "—" : `${number(selected.maeBp, 0)} pb`} ({selected.observations} observaciones semanales). Un sesgo negativo indica que la TPM terminó sobre lo descontado.</p>
      <div className="model-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={historyRows} margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
        <XAxis dataKey="date" tickFormatter={month} minTickGap={60} tick={{ fontSize: 11 }} />
        <YAxis domain={["auto", "auto"]} tickFormatter={v => `${number(Number(v), 0)}%`} width={44} tick={{ fontSize: 11 }} />
        <Tooltip labelFormatter={d => day(String(d))} formatter={(v, name) => [`${number(Number(v), 2)}%`, String(name)]} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line dataKey="implied" name="Descontado por swaps" stroke="#2f6fed" strokeWidth={1.8} dot={false} isAnimationActive={false} />
        <Line dataKey="realized" name="TPM efectiva" stroke="#172033" strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls={false} />
      </LineChart></ResponsiveContainer></div>
    </section>

    <div className="model-notice">
      <strong>Metodología.</strong>
      <p>Los swaps Cámara de hasta 18 meses pagan una sola vez al vencimiento, por lo que el factor de descuento afecta igual a ambas patas y se cancela: la tasa fija entrega directamente el ICP esperado (1 + r·días/360), sin necesidad de doble curva. Sobre 18 meses los cupones son semestrales y sí se requiere proyectar con Cámara y descontar con la curva implícita en los puntos forward y el basis. Se supone un overnight constante entre reuniones que cambia el día hábil siguiente a cada decisión, y ICP = TPM + {number(path.spreadBp, 1)} pb (mediana en días sin cambios de TPM). Como hay menos plazos que reuniones, se ajusta por mínimos cuadrados con una penalización pequeña a los saltos: el resultado es la expectativa ponderada por probabilidad, no un escenario. La probabilidad de la próxima reunión es el cambio esperado dividido por 25 pb.</p>
    </div>
  </div>;
}

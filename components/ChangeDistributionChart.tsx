"use client";

import { useMemo } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { changeDistribution, distributionPoints } from "@/lib/change-distribution";

type Props = {
  chart: { [key: string]: string | number | null | undefined }[];
  instruments: string[];
  colors: string[];
};

export function ChangeDistributionChart({ chart, instruments, colors }: Props) {
  const distributions = useMemo(() => instruments.map(instrument => changeDistribution(instrument,
    chart.map(row => row[instrument]).filter((v): v is number => typeof v === "number"))), [chart, instruments]);
  const points = useMemo(() => distributionPoints(distributions), [distributions]);
  const format = (v: number | null) => v === null ? "—" : `${v.toFixed(2)} pb`;
  return <div className="technical-panel">
    <h3 className="history-compare-title">Distribución de cambios diarios</h3>
    {points.length > 0 && <div className="technical-chart"><ResponsiveContainer width="100%" height="100%">
      <LineChart data={points} margin={{ left: 8, right: 18, top: 10, bottom: 18 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false}/>
        <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tickFormatter={v => Number(v).toFixed(1)} label={{ value: "Cambio diario (pb)", position: "insideBottom", offset: -10 }}/>
        <YAxis domain={[0, "auto"]} tickFormatter={v => Number(v).toFixed(3)} width={65}/>
        <Tooltip labelFormatter={v => `${Number(v).toFixed(2)} pb`} formatter={(v, name) => [Number(v).toFixed(4), String(name)]}/>
        <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="4 4"/>
        <Legend verticalAlign="top" iconType="line"/>
        {distributions.map((d, i) => d.bandwidth !== null && <Line key={d.instrument} dataKey={d.instrument} name={d.instrument} type="linear" stroke={colors[i % colors.length]} strokeWidth={2.3} dot={false} isAnimationActive={false}/>)}
      </LineChart>
    </ResponsiveContainer></div>}
    <div className="table-wrap"><table>
      <thead><tr><th>Instrumento</th><th>Observaciones</th><th>Media</th><th>Desv. estándar</th></tr></thead>
      <tbody>{distributions.map((d, i) => <tr key={d.instrument}>
        <td><span style={{ color: colors[i % colors.length] }}>●</span> {d.instrument}</td><td>{d.count}</td><td>{format(d.mean)}</td><td>{format(d.deviation)}</td>
      </tr>)}</tbody>
    </table></div>
    <p className="technical-description">Curvas de densidad suavizadas de los cambios observados en el período seleccionado, incluidos los ceros. El eje vertical muestra densidad, no número de días.</p>
    {distributions.filter(d => d.bandwidth === null).map(d => <p key={d.instrument} className="technical-description" role="status">{d.instrument}: {d.count < 2 ? "se necesitan al menos dos cambios para estimar la distribución." : `todos los cambios son iguales (${format(d.mean)}); no hay dispersión para dibujar una curva.`}</p>)}
  </div>;
}

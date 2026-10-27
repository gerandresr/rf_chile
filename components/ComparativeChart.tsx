"use client";

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Catalog } from "@/lib/data-catalog.server";
import { extractSeries } from "@/lib/series-data";

type Leg = { id: string; field: string };
export type ComparableSeries = { uid: string; label: string; inverted?: boolean; source: { kind: "catalog"; leg: Leg } | { kind: "calc"; op: "diff" | "fly"; legs: Leg[] } };
type Span = 1 | 3 | 6 | 12;
type Reference = "month" | "ytd" | "year" | "custom";
const fmt = (n: number, digits = 2) => new Intl.NumberFormat("es-CL", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
const dateOffset = (date: string, months: number) => {
  const [y, m, d] = date.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, lastDay))).toISOString().slice(0, 10);
};
const days = (date: string) => Date.parse(date + "T00:00:00Z") / 86400000;

export function ComparativeChart({ catalog, candidates, period }: { catalog: Catalog; candidates: ComparableSeries[]; period: string }) {
  const [uid, setUid] = useState("");
  const [reference, setReference] = useState<Reference>("year");
  const [customStart, setCustomStart] = useState("");
  const [view, setView] = useState<"change" | "level">("change");
  const [cache, setCache] = useState<Record<string, unknown>>({});
  const catalogItems = useMemo(() => new Map(catalog.groups.flatMap(g => g.series.map(s => [s.id, s] as const))), [catalog]);
  const selected = candidates.find(s => s.uid === uid) ?? candidates[0];
  const legs = selected ? selected.source.kind === "catalog" ? [selected.source.leg] : selected.source.legs : [];
  const files = [...new Set(legs.map(l => catalogItems.get(l.id)?.file).filter((f): f is string => !!f))];
  useEffect(() => {
    let cancelled = false;
    Promise.all(files.filter(f => !(f in cache)).map(async file => {
      try { const response = await fetch(file); if (!response.ok) throw new Error("Error de fuente"); return [file, await response.json()] as const; }
      catch { return [file, null] as const; }
    })).then(entries => { if (!cancelled && entries.length) setCache(previous => ({ ...previous, ...Object.fromEntries(entries) })); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.join("|")]);

  const result = useMemo(() => {
    if (!selected || files.some(f => !(f in cache))) return null;
    const maps = legs.map(l => {
      const entry = catalogItems.get(l.id);
      return entry && cache[entry.file] ? extractSeries(cache[entry.file], entry, l.field) : new Map<string, number>();
    });
    const isRate = legs.every(l => catalogItems.get(l.id)?.fields.find(f => f.key === l.field)?.unit.includes("%"));
    const values = new Map<string, number>();
    for (const [date, value] of maps[0] ?? []) {
      if (!maps.every(map => map.has(date))) continue;
      const v = selected.source.kind === "catalog" ? value : selected.source.op === "diff"
        ? value - maps[1].get(date)! : 2 * maps[1].get(date)! - value - maps[2].get(date)!;
      if (Number.isFinite(v)) {
        const value = selected.source.kind === "calc" && isRate ? v * 100 : v;
        values.set(date, selected.inverted && value !== 0 ? -value : value);
      }
    }
    const ordered = [...values].sort(([a], [b]) => a.localeCompare(b));
    if (!ordered.length) return { rows: [], message: "La serie seleccionada no tiene observaciones disponibles." };
    const end = ordered[ordered.length - 1][0];
    const start = period === "ytd" ? end.slice(0, 4) + "-01-01" : dateOffset(end, period === "1m" ? -1 : period === "5y" ? -60 : -12);
    const durationDays = days(end) - days(start);
    const historicalStart = reference === "month" ? dateOffset(start, -1) : reference === "ytd" ? String(Number(start.slice(0,4)) - 1) + "-01-01" : reference === "year" ? dateOffset(start, -12) : customStart;
    const historicalEnd = reference === "month" ? dateOffset(end, -1) : reference === "ytd" ? new Date((days(historicalStart) + durationDays) * 86400000).toISOString().slice(0, 10) : reference === "year" ? dateOffset(end, -12) : customStart ? new Date((days(customStart) + durationDays) * 86400000).toISOString().slice(0,10) : "";
    if (!historicalStart || !historicalEnd) return { rows: [], message: "Selecciona la fecha de inicio del período histórico." };
    const current = ordered.filter(([date]) => date >= start && date <= end);
    const past = ordered.filter(([date]) => date >= historicalStart && date <= historicalEnd);
    if (current.length < 2 || past.length < 2) return { rows: [], message: "Se necesitan al menos dos observaciones en cada período." };
    // Alinear por días naturales transcurridos, no por fecha absoluta.
    const byDay = new Map<number, { day: number; current: number | null; past: number | null; currentDate?: string; pastDate?: string }>();
    const first = (list: [string, number][], key: "current" | "past", dateKey: "currentDate" | "pastDate") => {
      const base = list[0][1], firstDay = days(list[0][0]);
      for (const [date, value] of list) {
        const d = days(date) - firstDay;
        const row = byDay.get(d) ?? { day: d, current: null, past: null };
        row[key] = view === "level" ? value : isRate && selected.source.kind === "catalog" ? (value - base) * 100 : value - base;
        row[dateKey] = date;
        byDay.set(d, row);
      }
    };
    first(current, "current", "currentDate");
    first(past, "past", "pastDate");
    const rows = [...byDay.values()].sort((a, b) => a.day - b.day);
    const lastCurrent = current[current.length - 1][1] - current[0][1];
    const lastPast = past[past.length - 1][1] - past[0][1];
    const factor = isRate && selected.source.kind === "catalog" ? 100 : 1;
    return { rows, message: "", start, end, historicalStart, historicalEnd, currentChange: lastCurrent * factor, pastChange: lastPast * factor, unit: view === "change" ? isRate ? "pb" : "unidades" : selected.source.kind === "calc" && isRate ? "pb" : isRate ? "%" : "unidades" };
  }, [selected, cache, files.join("|"), period, reference, customStart, view, catalogItems]); // eslint-disable-line react-hooks/exhaustive-deps

  return <section className="panel cb-block">
    <h2>Comparativo histórico</h2>
    <p className="db-hint">Superpone una sola serie en dos períodos, alineados por los días transcurridos desde el primer dato de cada ventana. Las fechas originales se muestran al pasar el cursor.</p>
    <div className="cb-series-grid">
      <p className="db-hint">Serie: {selected?.label ?? "Selecciona una serie desde el panel Series"}. Elige el período actual en la barra superior.</p>
      <label>Comparar con<select value={reference} onChange={e => setReference(e.target.value as Reference)}><option value="month">1M antes</option><option value="ytd">YTD del año anterior</option><option value="year">1A antes</option><option value="custom">Fecha específica</option></select></label>
      {reference === "custom" && <label>Fecha histórica (calendario)<input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} /></label>}
      <label>Escala<select value={view} onChange={e => setView(e.target.value as "change" | "level")}><option value="change">Variación acumulada (pb en tasas)</option><option value="level">Niveles originales</option></select></label>
    </div>
    {result?.message ? <p className="db-hint">{result.message}</p> : !result ? <p className="db-hint">Cargando datos…</p> : "currentChange" in result && typeof result.currentChange === "number" && typeof result.pastChange === "number" ? <>
      <p className="model-caption">Actual: {result.start} a {result.end} · Histórico: {result.historicalStart} a {result.historicalEnd}</p>
      <div className="cb-chart" style={{ height: 440 }}><ResponsiveContainer width="100%" height="100%">
        <LineChart data={result.rows} margin={{ top: 18, left: 6, right: 20, bottom: 10 }}>
          <CartesianGrid stroke="#e5eaf2" strokeDasharray="3 3" vertical={false}/>
          <XAxis dataKey="day" type="number" domain={["dataMin", "dataMax"]} tickFormatter={n => String(n) + "d"} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={58} tickFormatter={v => fmt(Number(v), 1)}/>
          <Tooltip labelFormatter={label => "Día " + label} formatter={(value, name, item) => {
            const row = item.payload as { currentDate?: string; pastDate?: string };
            return [fmt(Number(value)) + " " + result.unit + " · " + (name === "Actual" ? row.currentDate : row.pastDate), String(name)];
          }}/>
          <Legend />
          <Line type="linear" dataKey="current" name="Actual" stroke="#2f6fed" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false}/>
          <Line type="linear" dataKey="past" name="Histórico" stroke="#d94b4b" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false}/>
        </LineChart>
      </ResponsiveContainer></div>
      <div className="cb-series-grid">
        <div><strong>Variación período actual</strong><p>{fmt(result.currentChange)} {result.unit === "%" || result.unit === "pb" ? "pb" : "unidades"}</p></div>
        <div><strong>Variación período histórico</strong><p>{fmt(result.pastChange)} {result.unit === "%" || result.unit === "pb" ? "pb" : "unidades"}</p></div>
        <div><strong>Diferencia de variaciones</strong><p>{fmt(result.currentChange - result.pastChange)} {result.unit === "%" || result.unit === "pb" ? "pb" : "unidades"}</p></div>
      </div>
    </> : null}
  </section>;
}

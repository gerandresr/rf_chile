"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Area, Bar, Brush, CartesianGrid, ComposedChart, Customized, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, Copy, Download, Eye, EyeOff, MousePointerClick, MoveUpRight, Plus, Save, Search, Trash2, Type, X } from "lucide-react";
import { AppShell } from "./AppShell";
import type { Catalog, CatalogSeries } from "@/lib/data-catalog.server";
import { extractSeries } from "@/lib/series-data";

// ---------------- Tipos de configuración ----------------
type ChartType = "line" | "bar" | "area" | "dots";
type Dash = "solid" | "dash" | "dot";
type Axis = "left" | "right";
type Transform = "level" | "d1" | "fromStart" | "base100";
type Leg = { id: string; field: string };
type Source = { kind: "catalog"; leg: Leg } | { kind: "calc"; op: "diff" | "fly"; legs: Leg[] };
type PlotSeries = { uid: string; label: string; source: Source; type: ChartType; color: string; width: number; dash: Dash; axis: Axis; transform: Transform; visible: boolean };
type Annotation =
  | { id: string; kind: "hline"; value: number; axis: Axis; label: string; color: string }
  | { id: string; kind: "vline"; date: string; label: string; color: string }
  | { id: string; kind: "arrow"; date: string; seriesUid: string; label: string; color: string; dir: "down" | "up" }
  | { id: string; kind: "farrow"; x1: string; y1: number; x2: string; y2: number; axis: Axis; color: string; width: number }
  | { id: string; kind: "text"; x: string; y: number; axis: Axis; text: string; color: string; size: number; bold: boolean };
type FreeAnnotation = Extract<Annotation, { kind: "farrow" | "text" }>;
type Mode = "none" | "vline" | "arrow" | "farrow" | "text";
type PngOptions = { background: "white" | "none"; text: "dark" | "light"; header: boolean };
type Period = "1m" | "3m" | "1y" | "5y" | "all" | "custom";
type Config = {
  v: 1; series: PlotSeries[]; annotations: Annotation[]; period: Period; from: string; to: string;
  title: string; subtitle: string; source: string; legend: "top" | "bottom" | "none"; grid: boolean; height: number;
  left: { min: string; max: string }; right: { min: string; max: string };
};

const PALETTE = ["#2f6fed", "#d94b4b", "#0f9f6e", "#f59e0b", "#8b5cf6", "#172033", "#0ea5e9", "#64748b"];
const DASH: Record<Dash, string | undefined> = { solid: undefined, dash: "7 4", dot: "2 3" };
const PERIODS: [Period, string][] = [["1m", "1M"], ["3m", "3M"], ["1y", "1A"], ["5y", "5A"], ["all", "Todo"]];
const TRANSFORMS: [Transform, string][] = [["level", "Nivel"], ["d1", "Cambio diario"], ["fromStart", "Cambio desde inicio"], ["base100", "Base 100"]];
const uid = () => Math.random().toString(36).slice(2, 9);
const shift = (date: string, months: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10); };
const fmt = (v: number, d = 2) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const STORAGE = "rf-graficos-guardados";

const DEFAULT_CONFIG: Config = {
  v: 1,
  series: [
    { uid: "a", label: "BTP 6,0% ene-2034", source: { kind: "catalog", leg: { id: "BTP0600134", field: "tir" } }, type: "line", color: PALETTE[0], width: 2, dash: "solid", axis: "left", transform: "level", visible: true },
    { uid: "b", label: "SPC CLP 10 años", source: { kind: "catalog", leg: { id: "bbg:clpcam_10y", field: "valor" } }, type: "line", color: PALETTE[3], width: 2, dash: "solid", axis: "left", transform: "level", visible: true },
    { uid: "c", label: "BTP0600134 − SPC 10a", source: { kind: "calc", op: "diff", legs: [{ id: "BTP0600134", field: "tir" }, { id: "bbg:clpcam_10y", field: "valor" }] }, type: "bar", color: "#94a3b8", width: 1, dash: "solid", axis: "right", transform: "level", visible: true },
  ],
  annotations: [], period: "1y", from: "", to: "",
  title: "BTP 2034 versus swap Cámara 10 años", subtitle: "TIR y swap en %, diferencia en pb (eje derecho)", source: "Fuente: Mercado, Bloomberg.",
  legend: "bottom", grid: true, height: 460, left: { min: "", max: "" }, right: { min: "", max: "" },
};

const encode = (c: Config) => btoa(unescape(encodeURIComponent(JSON.stringify(c)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decode = (s: string): Config | null => {
  try { const c = JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))))); return c?.v === 1 && Array.isArray(c.series) ? { ...DEFAULT_CONFIG, ...c } : null; } catch { return null; }
};
const readSaved = (): Record<string, Config> => { try { return JSON.parse(localStorage.getItem(STORAGE) ?? "{}"); } catch { return {}; } };

// ---------------- Capa de flechas (coordenadas desde las escalas de Recharts) ----------------
type AxisMap = Record<string, { scale: ((v: unknown) => number) & { bandwidth?: () => number } }>;
function ArrowLayer({ xAxisMap, yAxisMap, arrows, rows, series }: { xAxisMap?: AxisMap; yAxisMap?: AxisMap; arrows: Extract<Annotation, { kind: "arrow" }>[]; rows: Record<string, number | string | null>[]; series: PlotSeries[] }) {
  const xAxis = xAxisMap ? Object.values(xAxisMap)[0] : undefined;
  if (!xAxis || !yAxisMap) return null;
  return <g>{arrows.map(a => {
    const s = series.find(x => x.uid === a.seriesUid), row = rows.find(r => r.date === a.date);
    const value = row && s ? row[s.uid] : null;
    const yAxis = s ? yAxisMap[s.axis] : undefined;
    if (!s || !yAxis || typeof value !== "number") return null;
    const x0 = xAxis.scale(a.date);
    if (typeof x0 !== "number" || Number.isNaN(x0)) return null;
    const x = x0 + (xAxis.scale.bandwidth ? xAxis.scale.bandwidth() / 2 : 0), y = yAxis.scale(value);
    const up = a.dir === "up", len = 46, tipY = up ? y + 6 : y - 6, tailY = up ? y + len : y - len;
    const head = up ? `${x},${tipY} ${x - 5},${tipY + 9} ${x + 5},${tipY + 9}` : `${x},${tipY} ${x - 5},${tipY - 9} ${x + 5},${tipY - 9}`;
    return <g key={a.id}>
      <line x1={x} x2={x} y1={tailY} y2={up ? tipY + 8 : tipY - 8} stroke={a.color} strokeWidth={1.8} />
      <polygon points={head} fill={a.color} />
      {a.label && <text x={x} y={up ? tailY + 14 : tailY - 6} textAnchor="middle" fontSize={12} fontWeight={700} fill={a.color} stroke="#fff" strokeWidth={3} paintOrder="stroke">{a.label}</text>}
    </g>;
  })}</g>;
}

// ---------------- Capa libre: flechas y textos en coordenadas del gráfico ----------------
type Pt = { date: string; value: number };
type FreeLayerProps = {
  xAxisMap?: AxisMap; yAxisMap?: AxisMap & Record<string, { scale: { invert?: (v: number) => number } }>; offset?: { left: number; top: number; width: number; height: number };
  dates: string[]; items: FreeAnnotation[]; mode: Mode; axis: Axis; preview: { from: Pt; to: Pt; color: string; width: number } | null;
  onPointer: (kind: "down" | "move" | "up", pt: Pt) => void; onGrab: (id: string, pt: Pt) => void; moving: boolean;
};
function FreeLayer({ xAxisMap, yAxisMap, offset, dates, items, mode, axis, preview, onPointer, onGrab, moving }: FreeLayerProps) {
  const xAxis = xAxisMap ? Object.values(xAxisMap)[0] : undefined;
  if (!xAxis || !yAxisMap || !offset) return null;
  const band = xAxis.scale.bandwidth ? xAxis.scale.bandwidth() / 2 : 0;
  const xOf = (d: string) => { const v = xAxis.scale(d); return typeof v === "number" && !Number.isNaN(v) ? v + band : null; };
  const yScale = (a: Axis) => (yAxisMap[a] ?? yAxisMap.left)?.scale as unknown as ((v: number) => number) & { invert?: (v: number) => number };
  const visibleDates = dates.filter(d => xOf(d) !== null);
  // Píxel → fecha más cercana y valor del eje.
  const toData = (px: number, py: number, a: Axis): Pt | null => {
    if (!visibleDates.length) return null;
    let best = visibleDates[0], dist = Infinity;
    for (const d of visibleDates) { const x = xOf(d)!, dd = Math.abs(x - px); if (dd < dist) { dist = dd; best = d; } }
    const inv = yScale(a)?.invert;
    return inv ? { date: best, value: inv(py) } : null;
  };
  const point = (e: React.MouseEvent<SVGElement>) => {
    const svg = (e.currentTarget as SVGElement).ownerSVGElement ?? (e.currentTarget as unknown as SVGSVGElement);
    const r = svg.getBoundingClientRect();
    return toData(e.clientX - r.left, e.clientY - r.top, axis);
  };
  const arrow = (key: string, a: { x1: string; y1: number; x2: string; y2: number; axis: Axis; color: string; width: number }, grab?: (e: React.MouseEvent<SVGElement>) => void) => {
    const x1 = xOf(a.x1), x2 = xOf(a.x2), ys = yScale(a.axis);
    if (x1 === null || x2 === null || !ys) return null;
    const y1 = ys(a.y1), y2 = ys(a.y2), ang = Math.atan2(y2 - y1, x2 - x1), h = 8 + a.width * 2;
    const head = `${x2},${y2} ${x2 - h * Math.cos(ang - 0.45)},${y2 - h * Math.sin(ang - 0.45)} ${x2 - h * Math.cos(ang + 0.45)},${y2 - h * Math.sin(ang + 0.45)}`;
    const ex = x2 - (h * 0.7) * Math.cos(ang), ey = y2 - (h * 0.7) * Math.sin(ang);
    return <g key={key} onMouseDown={grab} style={grab ? { cursor: "move" } : undefined}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={12} />
      <line x1={x1} y1={y1} x2={ex} y2={ey} stroke={a.color} strokeWidth={a.width} strokeLinecap="round" />
      <polygon points={head} fill={a.color} />
    </g>;
  };
  const capture = mode === "farrow" || mode === "text" || moving;
  return <g>
    {items.map(it => {
      const grab = mode === "none" ? (e: React.MouseEvent<SVGElement>) => { e.stopPropagation(); const r = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect(); const pt = toData(e.clientX - r.left, e.clientY - r.top, it.axis); if (pt) onGrab(it.id, pt); } : undefined;
      if (it.kind === "farrow") return arrow(it.id, it, grab);
      const x = xOf(it.x), ys = yScale(it.axis);
      if (x === null || !ys) return null;
      return <text key={it.id} x={x} y={ys(it.y)} fontSize={it.size} fontWeight={it.bold ? 700 : 400} fill={it.color} stroke="#fff" strokeWidth={3} paintOrder="stroke" dominantBaseline="middle" onMouseDown={grab} style={grab ? { cursor: "move" } : undefined}>{it.text}</text>;
    })}
    {preview && arrow("preview", { x1: preview.from.date, y1: preview.from.value, x2: preview.to.date, y2: preview.to.value, axis, color: preview.color, width: preview.width })}
    {capture && <rect x={offset.left} y={offset.top} width={offset.width} height={offset.height} fill="transparent" style={{ cursor: moving ? "grabbing" : "crosshair" }}
      onMouseDown={e => { const pt = point(e); if (pt) onPointer("down", pt); }}
      onMouseMove={e => { const pt = point(e); if (pt) onPointer("move", pt); }}
      onMouseUp={e => { const pt = point(e); if (pt) onPointer("up", pt); }}
      onMouseLeave={e => { const pt = point(e); if (pt) onPointer("up", pt); }} />}
  </g>;
}

// ---------------- Componente principal ----------------
export function ChartBuilder({ catalog }: { catalog: Catalog }) {
  const byId = useMemo(() => new Map(catalog.groups.flatMap(g => g.series.map(s => [s.id, s] as const))), [catalog]);
  const allSeries = useMemo(() => catalog.groups.flatMap(g => g.series), [catalog]);
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const set = (patch: Partial<Config>) => setConfig(c => ({ ...c, ...patch }));
  const setSeries = (u: string, patch: Partial<PlotSeries>) => setConfig(c => ({ ...c, series: c.series.map(s => s.uid === u ? { ...s, ...patch } : s) }));
  const [query, setQuery] = useState("");
  const [calc, setCalc] = useState<{ op: "diff" | "fly"; legs: string[] }>({ op: "diff", legs: ["", "", ""] });
  const [mode, setMode] = useState<Mode>("none");
  const [draft, setDraft] = useState({ label: "", value: "3", axis: "left" as Axis, color: "#d94b4b", seriesUid: "", dir: "down" as "down" | "up", size: 13, bold: true, width: 2 });
  const [drag, setDrag] = useState<{ from: Pt; to: Pt } | null>(null);
  const [move, setMove] = useState<{ id: string; start: Pt; original: FreeAnnotation } | null>(null);
  const [png, setPng] = useState<PngOptions>({ background: "white", text: "dark", header: true });
  const [saved, setSaved] = useState<Record<string, Config>>({});
  const [saveName, setSaveName] = useState("");
  const [notice, setNotice] = useState("");
  const cache = useRef(new Map<string, unknown>());
  const [loadedTick, setLoadedTick] = useState(0);
  const chartRef = useRef<HTMLDivElement>(null);
  const hoverDate = useRef("");
  const nextColor = (list: PlotSeries[]) => PALETTE.find(c => !list.some(s => s.color === c)) ?? PALETTE[list.length % PALETTE.length];

  // Carga inicial: configuración desde el link compartido y gráficos guardados en este navegador.
  useEffect(() => {
    setSaved(readSaved());
    const m = window.location.hash.match(/^#c=(.+)$/);
    const fromLink = m ? decode(m[1]) : null;
    if (fromLink) setConfig(fromLink);
  }, []);
  const flash = (msg: string) => { setNotice(msg); window.setTimeout(() => setNotice(""), 2500); };

  // Archivos necesarios para las series del gráfico.
  const legsOf = (s: PlotSeries) => s.source.kind === "catalog" ? [s.source.leg] : s.source.legs;
  const neededFiles = [...new Set(config.series.flatMap(legsOf).map(l => byId.get(l.id)?.file).filter((f): f is string => !!f))];
  useEffect(() => {
    const missing = neededFiles.filter(f => !cache.current.has(f));
    if (!missing.length) return;
    let cancelled = false;
    Promise.all(missing.map(f => fetch(f).then(r => r.json()).then(j => cache.current.set(f, j)).catch(() => cache.current.set(f, null))))
      .then(() => { if (!cancelled) setLoadedTick(t => t + 1); });
    return () => { cancelled = true; };
  }, [neededFiles.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = neededFiles.every(f => cache.current.has(f));
  const legValues = (leg: Leg) => {
    const s = byId.get(leg.id), json = s ? cache.current.get(s.file) : null;
    return s && json ? extractSeries(json, s, leg.field) : new Map<string, number>();
  };
  const isRate = (leg: Leg) => (byId.get(leg.id)?.fields.find(f => f.key === leg.field)?.unit ?? "").includes("%");

  const { rows, lastDate, units } = useMemo(() => {
    const raw = new Map<string, Map<string, number>>(), units: Record<string, string> = {};
    if (!ready) return { rows: [] as Record<string, number | string | null>[], lastDate: "", units };
    for (const s of config.series) {
      if (s.source.kind === "catalog") {
        raw.set(s.uid, legValues(s.source.leg));
        units[s.uid] = isRate(s.source.leg) ? "%" : "";
      } else {
        const maps = s.source.legs.map(legValues), rate = s.source.legs.every(isRate), out = new Map<string, number>();
        for (const d of maps[0].keys()) {
          if (!maps.every(m => m.has(d))) continue;
          const v = s.source.op === "diff" ? maps[0].get(d)! - maps[1].get(d)! : 2 * maps[1].get(d)! - maps[0].get(d)! - maps[2].get(d)!;
          out.set(d, rate ? v * 100 : v);
        }
        raw.set(s.uid, out); units[s.uid] = rate ? "pb" : "";
      }
    }
    const lastDate = [...raw.values()].reduce((m, x) => { for (const d of x.keys()) if (d > m) m = d; return m; }, "");
    const from = config.period === "custom" ? config.from || "0000" : config.period === "all" || !lastDate ? "0000" : shift(lastDate, config.period === "1m" ? -1 : config.period === "3m" ? -3 : config.period === "1y" ? -12 : -60);
    const to = config.period === "custom" && config.to ? config.to : "9999";
    // Transformaciones dentro del rango visible.
    const shown = new Map<string, Map<string, number>>();
    for (const s of config.series) {
      if (!s.visible) continue;
      const entries = [...raw.get(s.uid)!].filter(([d]) => d >= from && d <= to).sort((a, b) => a[0].localeCompare(b[0]));
      const unit = units[s.uid], out = new Map<string, number>();
      const first = entries[0]?.[1];
      entries.forEach(([d, v], i) => {
        if (s.transform === "level") out.set(d, v);
        else if (s.transform === "base100") { if (first) out.set(d, v / first * 100); }
        else {
          const base = s.transform === "d1" ? entries[i - 1]?.[1] : first;
          if (base === undefined || (s.transform === "d1" && i === 0)) return;
          out.set(d, unit === "%" ? (v - base) * 100 : unit === "pb" ? v - base : (v / base - 1) * 100);
        }
      });
      shown.set(s.uid, out);
      units[s.uid] = s.transform === "level" ? unit : s.transform === "base100" ? "base 100" : unit === "%" || unit === "pb" ? "pb" : "%";
    }
    const dates = [...new Set([...shown.values()].flatMap(m => [...m.keys()]))].sort();
    const rows = dates.map(date => ({ date, ...Object.fromEntries([...shown].map(([u, m]) => [u, m.get(date) ?? null])) }));
    return { rows, lastDate, units };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.series, config.period, config.from, config.to, ready, loadedTick]);

  // ---------------- Acciones ----------------
  const addCatalog = (s: CatalogSeries) => {
    const field = s.fields[0].key;
    setConfig(c => ({ ...c, series: [...c.series, { uid: uid(), label: s.fields.length > 1 ? `${s.label}` : s.label, source: { kind: "catalog", leg: { id: s.id, field } }, type: "line", color: nextColor(c.series), width: 2, dash: "solid", axis: "left", transform: "level", visible: true }] }));
    setQuery("");
  };
  const addCalc = () => {
    const n = calc.op === "diff" ? 2 : 3, ids = calc.legs.slice(0, n);
    if (ids.some(id => !byId.has(id))) { flash("Elige todas las series de la fórmula."); return; }
    const legs = ids.map(id => ({ id, field: byId.get(id)!.fields[0].key }));
    const name = (id: string) => byId.get(id)!.fields.length > 1 ? id : byId.get(id)!.label;
    const label = calc.op === "diff" ? `${name(ids[0])} − ${name(ids[1])}` : `Fly 2×${name(ids[1])} − ${name(ids[0])} − ${name(ids[2])}`;
    setConfig(c => ({ ...c, series: [...c.series, { uid: uid(), label, source: { kind: "calc", op: calc.op, legs }, type: "line", color: nextColor(c.series), width: 2, dash: "solid", axis: "right", transform: "level", visible: true }] }));
  };
  const addHLine = () => {
    const value = Number(draft.value.replace(",", "."));
    if (!Number.isFinite(value)) { flash("Ingresa un valor numérico."); return; }
    set({ annotations: [...config.annotations, { id: uid(), kind: "hline", value, axis: draft.axis, label: draft.label, color: draft.color }] });
  };
  const onChartClick = (state: { activeLabel?: string | number } | null) => {
    // La fecha sale del punto bajo el cursor (se guarda al mover el mouse, por si el clic no la trae).
    const date = state?.activeLabel ? String(state.activeLabel) : hoverDate.current;
    if ((mode !== "vline" && mode !== "arrow") || !date) return;
    if (mode === "vline") set({ annotations: [...config.annotations, { id: uid(), kind: "vline", date, label: draft.label, color: draft.color }] });
    else {
      const target = draft.seriesUid || config.series.find(s => s.visible)?.uid;
      if (target) set({ annotations: [...config.annotations, { id: uid(), kind: "arrow", date, seriesUid: target, label: draft.label, color: draft.color, dir: draft.dir }] });
    }
    setMode("none");
  };
  // Flecha libre (arrastrar), texto libre (clic) y mover anotaciones libres existentes.
  const freeAxis: Axis = config.series.some(s => s.visible && s.axis === "left") ? "left" : "right";
  const dateIndex = (d: string) => rows.findIndex(r => r.date === d);
  const onFreePointer = (kind: "down" | "move" | "up", pt: Pt) => {
    if (move) {
      if (kind === "down") return;
      const shiftIdx = dateIndex(pt.date) - dateIndex(move.start.date), dv = pt.value - move.start.value;
      const shiftDate = (d: string) => { const i = dateIndex(d); const j = Math.min(rows.length - 1, Math.max(0, i + shiftIdx)); return i < 0 ? d : String(rows[j].date); };
      const o = move.original;
      const moved: FreeAnnotation = o.kind === "farrow" ? { ...o, x1: shiftDate(o.x1), x2: shiftDate(o.x2), y1: o.y1 + dv, y2: o.y2 + dv } : { ...o, x: shiftDate(o.x), y: o.y + dv };
      setConfig(c => ({ ...c, annotations: c.annotations.map(a => a.id === o.id ? moved : a) }));
      if (kind === "up") setMove(null);
      return;
    }
    if (mode === "text" && kind === "down") {
      if (!draft.label.trim()) { flash("Escribe el texto antes de hacer clic."); return; }
      set({ annotations: [...config.annotations, { id: uid(), kind: "text", x: pt.date, y: pt.value, axis: freeAxis, text: draft.label, color: draft.color, size: draft.size, bold: draft.bold }] });
      setMode("none");
    }
    if (mode === "farrow") {
      if (kind === "down") setDrag({ from: pt, to: pt });
      else if (kind === "move" && drag) setDrag({ ...drag, to: pt });
      else if (kind === "up" && drag) {
        if (drag.from.date !== pt.date || Math.abs(drag.from.value - pt.value) > 1e-9) set({ annotations: [...config.annotations, { id: uid(), kind: "farrow", x1: drag.from.date, y1: drag.from.value, x2: pt.date, y2: pt.value, axis: freeAxis, color: draft.color, width: draft.width }] });
        setDrag(null); setMode("none");
      }
    }
  };
  const onGrab = (id: string, pt: Pt) => {
    const original = config.annotations.find((a): a is FreeAnnotation => a.id === id && (a.kind === "farrow" || a.kind === "text"));
    if (original) setMove({ id, start: pt, original });
  };

  const saveChart = () => {
    const name = saveName.trim() || config.title || "Gráfico";
    const next = { ...readSaved(), [name]: config };
    try { localStorage.setItem(STORAGE, JSON.stringify(next)); setSaved(next); flash(`Guardado como “${name}”.`); } catch { flash("No se pudo guardar en este navegador."); }
  };
  const removeSaved = (name: string) => { const next = { ...readSaved() }; delete next[name]; try { localStorage.setItem(STORAGE, JSON.stringify(next)); } catch { /* sin almacenamiento */ } setSaved(next); };
  const shareLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}#c=${encode(config)}`;
    window.history.replaceState(null, "", url);
    try { await navigator.clipboard.writeText(url); flash("Link copiado: abre este mismo gráfico."); } catch { flash("Link listo en la barra de direcciones."); }
  };
  const downloadPng = async () => {
    const svg = chartRef.current?.querySelector("svg.recharts-surface") as SVGSVGElement | null;
    if (!svg) return;
    const { width, height } = svg.getBoundingClientRect();
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg"); clone.setAttribute("style", "font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"); clone.setAttribute("width", String(width)); clone.setAttribute("height", String(height));
    clone.querySelectorAll(".recharts-brush").forEach(n => n.remove());
    const light = png.text === "light";
    if (light) {
      // Texto y ejes claros para fondos oscuros (las anotaciones mantienen su color).
      const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
      style.textContent = ".recharts-cartesian-axis-tick-value,.recharts-cartesian-axis-tick-value tspan{fill:#e2e8f0!important}.recharts-cartesian-axis-line,.recharts-cartesian-axis-tick-line{stroke:#94a3b8!important}.recharts-cartesian-grid line{stroke:rgba(255,255,255,.18)!important}";
      clone.insertBefore(style, clone.firstChild);
      clone.querySelectorAll("text").forEach(t => { if (t.getAttribute("stroke") === "#fff") t.setAttribute("stroke", "rgba(15,23,42,.6)"); });
    }
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      const visible = config.series.filter(s => s.visible), scale = 2, pad = png.header ? 24 : 8;
      const header = png.header ? (config.title ? 34 : 0) + (config.subtitle ? 22 : 0) + 8 : 0, legendH = !png.header || config.legend === "none" ? 0 : 26, footer = png.header ? 30 : 0;
      const ink = light ? { title: "#f8fafc", sub: "#cbd5e1", legend: "#e2e8f0", foot: "#94a3b8" } : { title: "#172033", sub: "#748096", legend: "#31405a", foot: "#8b96a8" };
      const W = width + pad * 2, H = header + legendH + height + footer + pad;
      const canvas = document.createElement("canvas"); canvas.width = W * scale; canvas.height = H * scale;
      const ctx = canvas.getContext("2d")!; ctx.scale(scale, scale);
      if (png.background === "white") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H); }
      const font = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
      let y = pad;
      if (png.header && config.title) { ctx.fillStyle = ink.title; ctx.font = `700 20px ${font}`; ctx.fillText(config.title, pad, y + 16); y += 34; }
      if (png.header && config.subtitle) { ctx.fillStyle = ink.sub; ctx.font = `13px ${font}`; ctx.fillText(config.subtitle, pad, y + 10); y += 22; }
      if (png.header) y += 8;
      const drawLegend = () => {
        let x = pad; ctx.font = `12px ${font}`;
        for (const s of visible) {
          ctx.fillStyle = s.color; ctx.fillRect(x, y + 4, 14, s.type === "line" ? 3 : 9);
          ctx.fillStyle = ink.legend; const text = `${s.label}${units[s.uid] ? ` (${units[s.uid]})` : ""}${s.axis === "right" ? " · eje der." : ""}`;
          ctx.fillText(text, x + 20, y + 12); x += 20 + ctx.measureText(text).width + 18;
        }
        y += legendH;
      };
      if (png.header && config.legend === "top") drawLegend();
      ctx.drawImage(img, pad, y, width, height); y += height;
      if (png.header && config.legend === "bottom") drawLegend();
      if (png.header) {
        ctx.fillStyle = ink.foot; ctx.font = `11px ${font}`; ctx.fillText(config.source || "", pad, H - 14);
        ctx.textAlign = "right"; ctx.fillText("rfchilena.cl", W - pad, H - 14);
      }
      URL.revokeObjectURL(url);
      canvas.toBlob(b => { if (!b) return; const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${(config.title || "grafico").replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60)}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }, "image/png");
    };
    img.src = url;
  };

  const q = query.trim().toLowerCase();
  const results = q ? allSeries.filter(s => q.split(/\s+/).every(w => s.search.includes(w))).slice(0, 12) : [];
  const hasRight = config.series.some(s => s.visible && s.axis === "right");
  const domain = (a: { min: string; max: string }) => [a.min === "" ? "auto" : Number(a.min), a.max === "" ? "auto" : Number(a.max)] as [number | "auto", number | "auto"];
  const arrows = config.annotations.filter((a): a is Extract<Annotation, { kind: "arrow" }> => a.kind === "arrow");
  const visible = config.series.filter(s => s.visible);
  const shownFrom = config.period === "custom" ? config.from : String(rows[0]?.date ?? ""), shownTo = config.period === "custom" ? config.to : lastDate;
  const optionGroups = catalog.groups.map(g => <optgroup key={g.name} label={g.name}>{g.series.map(s => <option key={s.id} value={s.id}>{s.fields.length > 1 ? `${s.id} · ${s.label}` : s.label}</option>)}</optgroup>);

  return <AppShell>
    <header className="page-head">
      <div><div className="eyebrow">Herramientas</div><h1>Gráficos</h1><p>Arma tu propio gráfico: elige series, estilos, rango y anotaciones, y descárgalo como imagen.</p></div>
    </header>
    <div className="cb-layout">
      <aside className="cb-side">
        <section className="panel cb-block">
          <h2>Series</h2>
          <div className="db-search"><Search size={16} aria-hidden="true" /><input type="search" placeholder="Agregar: 0600134, swap 10, usd…" value={query} onChange={e => setQuery(e.target.value)} aria-label="Buscar series" /></div>
          {results.length > 0 && <ul className="cb-results">{results.map(s => <li key={s.id}><button onClick={() => addCatalog(s)}><Plus size={13} aria-hidden="true" /><span>{s.label}</span><em>{s.group}</em></button></li>)}</ul>}
          <details className="cb-calc">
            <summary>Serie calculada (diferencia o fly)</summary>
            <div className="segmented">{([["diff", "A − B"], ["fly", "Fly 2B − A − C"]] as const).map(([k, l]) => <button key={k} className={calc.op === k ? "selected" : ""} onClick={() => setCalc(c => ({ ...c, op: k }))}>{l}</button>)}</div>
            {(calc.op === "diff" ? ["A", "B"] : ["A", "B", "C"]).map((name, i) => <label key={name} className="cb-field">{name}<select value={calc.legs[i]} onChange={e => setCalc(c => ({ ...c, legs: c.legs.map((x, j) => j === i ? e.target.value : x) }))}><option value="">Elegir…</option>{optionGroups}</select></label>)}
            <button className="cb-btn" onClick={addCalc}><Plus size={14} aria-hidden="true" />Agregar serie calculada</button>
            <p className="db-hint">Tasas en pb. Ej.: BTP 10 − BTP 2 (pendiente) o fly 2×5a − 2a − 10a.</p>
          </details>
          <div className="cb-series-list">{config.series.map(s => {
            const cat = s.source.kind === "catalog" ? byId.get(s.source.leg.id) : undefined;
            return <div key={s.uid} className="cb-series" style={{ borderLeftColor: s.color }}>
              <div className="cb-series-head">
                <input className="cb-name" value={s.label} onChange={e => setSeries(s.uid, { label: e.target.value })} aria-label="Nombre de la serie" />
                <button className="cb-icon" title={s.visible ? "Ocultar" : "Mostrar"} onClick={() => setSeries(s.uid, { visible: !s.visible })}>{s.visible ? <Eye size={15} /> : <EyeOff size={15} />}</button>
                <button className="cb-icon" title="Quitar" onClick={() => set({ series: config.series.filter(x => x.uid !== s.uid), annotations: config.annotations.filter(a => a.kind !== "arrow" || a.seriesUid !== s.uid) })}><X size={15} /></button>
              </div>
              <div className="cb-series-grid">
                <label>Tipo<select value={s.type} onChange={e => setSeries(s.uid, { type: e.target.value as ChartType })}><option value="line">Línea</option><option value="bar">Barras</option><option value="area">Área</option><option value="dots">Puntos</option></select></label>
                <label>Color<input type="color" value={s.color} onChange={e => setSeries(s.uid, { color: e.target.value })} /></label>
                <label>Eje<select value={s.axis} onChange={e => setSeries(s.uid, { axis: e.target.value as Axis })}><option value="left">Izquierdo</option><option value="right">Derecho</option></select></label>
                <label>Valores<select value={s.transform} onChange={e => setSeries(s.uid, { transform: e.target.value as Transform })}>{TRANSFORMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                {(s.type === "line" || s.type === "area") && <>
                  <label>Grosor<input type="range" min={1} max={5} step={0.5} value={s.width} onChange={e => setSeries(s.uid, { width: Number(e.target.value) })} /></label>
                  <label>Trazo<select value={s.dash} onChange={e => setSeries(s.uid, { dash: e.target.value as Dash })}><option value="solid">Continuo</option><option value="dash">Rayado</option><option value="dot">Punteado</option></select></label>
                </>}
                {cat && cat.fields.length > 1 && s.source.kind === "catalog" && <label>Campo<select value={s.source.leg.field} onChange={e => setSeries(s.uid, { source: { kind: "catalog", leg: { id: cat.id, field: e.target.value } } })}>{cat.fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>}
              </div>
            </div>;
          })}</div>
        </section>

        <section className="panel cb-block">
          <h2>Anotaciones</h2>
          <div className="cb-series-grid">
            <label className="cb-wide">Texto<input value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} placeholder="Ej.: RPM, máximo del año…" /></label>
            <label>Color<input type="color" value={draft.color} onChange={e => setDraft(d => ({ ...d, color: e.target.value }))} /></label>
          </div>
          <div className="cb-annot-actions">
            <div className="cb-inline">
              <button className={`cb-btn ${mode === "farrow" ? "cb-armed" : ""}`} onClick={() => setMode(m => m === "farrow" ? "none" : "farrow")}><MoveUpRight size={14} aria-hidden="true" />Flecha libre: arrastrar</button>
              <select value={draft.width} onChange={e => setDraft(d => ({ ...d, width: Number(e.target.value) }))} aria-label="Grosor de la flecha"><option value={1.5}>Fina</option><option value={2}>Media</option><option value={3}>Gruesa</option></select>
            </div>
            <div className="cb-inline">
              <button className={`cb-btn ${mode === "text" ? "cb-armed" : ""}`} onClick={() => setMode(m => m === "text" ? "none" : "text")}><Type size={14} aria-hidden="true" />Texto libre: clic</button>
              <select value={draft.size} onChange={e => setDraft(d => ({ ...d, size: Number(e.target.value) }))} aria-label="Tamaño del texto">{[11, 13, 16, 20, 24].map(n => <option key={n} value={n}>{n} px</option>)}</select>
              <label className="cb-check"><input type="checkbox" checked={draft.bold} onChange={e => setDraft(d => ({ ...d, bold: e.target.checked }))} />Negrita</label>
            </div>
            <div className="cb-inline"><input value={draft.value} onChange={e => setDraft(d => ({ ...d, value: e.target.value }))} aria-label="Valor de la línea horizontal" /><select value={draft.axis} onChange={e => setDraft(d => ({ ...d, axis: e.target.value as Axis }))} aria-label="Eje"><option value="left">Eje izq.</option><option value="right">Eje der.</option></select><button className="cb-btn" onClick={addHLine}>Línea horizontal</button></div>
            <button className={`cb-btn ${mode === "vline" ? "cb-armed" : ""}`} onClick={() => setMode(m => m === "vline" ? "none" : "vline")}><MousePointerClick size={14} aria-hidden="true" />Línea vertical: clic en el gráfico</button>
            <div className="cb-inline"><select value={draft.seriesUid} onChange={e => setDraft(d => ({ ...d, seriesUid: e.target.value }))} aria-label="Serie de la flecha"><option value="">Primera serie</option>{visible.map(s => <option key={s.uid} value={s.uid}>{s.label}</option>)}</select><select value={draft.dir} onChange={e => setDraft(d => ({ ...d, dir: e.target.value as "down" | "up" }))} aria-label="Dirección"><option value="down">↓</option><option value="up">↑</option></select>
              <button className={`cb-btn ${mode === "arrow" ? "cb-armed" : ""}`} onClick={() => setMode(m => m === "arrow" ? "none" : "arrow")}><ArrowDownRight size={14} aria-hidden="true" />Flecha: clic</button></div>
          </div>
          <p className="db-hint">Las flechas y textos libres se pueden arrastrar para moverlos.</p>
          {config.annotations.length > 0 && <ul className="cb-annots">{config.annotations.map(a => <li key={a.id}><span className="cb-annot-text"><span className="cb-dot" style={{ background: a.color }} />{a.kind === "hline" ? `Horizontal en ${a.value}${a.label ? ` · ${a.label}` : ""}` : a.kind === "vline" ? `Vertical ${a.date}${a.label ? ` · ${a.label}` : ""}` : a.kind === "arrow" ? `Flecha ${a.date}${a.label ? ` · ${a.label}` : ""}` : a.kind === "farrow" ? `Flecha libre ${a.x1} → ${a.x2}` : `Texto “${a.text}”`}</span><button className="cb-icon" onClick={() => set({ annotations: config.annotations.filter(x => x.id !== a.id) })} title="Borrar"><Trash2 size={13} /></button></li>)}</ul>}
        </section>

        <section className="panel cb-block">
          <h2>Formato</h2>
          <label className="cb-field">Título<input value={config.title} onChange={e => set({ title: e.target.value })} /></label>
          <label className="cb-field">Subtítulo<input value={config.subtitle} onChange={e => set({ subtitle: e.target.value })} /></label>
          <label className="cb-field">Fuente / nota al pie<input value={config.source} onChange={e => set({ source: e.target.value })} /></label>
          <div className="cb-series-grid">
            <label>Leyenda<select value={config.legend} onChange={e => set({ legend: e.target.value as Config["legend"] })}><option value="bottom">Abajo</option><option value="top">Arriba</option><option value="none">Sin leyenda</option></select></label>
            <label>Alto<input type="range" min={300} max={720} step={20} value={config.height} onChange={e => set({ height: Number(e.target.value) })} /></label>
            <label>Eje izq. mín<input value={config.left.min} placeholder="auto" onChange={e => set({ left: { ...config.left, min: e.target.value } })} /></label>
            <label>Eje izq. máx<input value={config.left.max} placeholder="auto" onChange={e => set({ left: { ...config.left, max: e.target.value } })} /></label>
            <label>Eje der. mín<input value={config.right.min} placeholder="auto" onChange={e => set({ right: { ...config.right, min: e.target.value } })} /></label>
            <label>Eje der. máx<input value={config.right.max} placeholder="auto" onChange={e => set({ right: { ...config.right, max: e.target.value } })} /></label>
            <label className="cb-check"><input type="checkbox" checked={config.grid} onChange={e => set({ grid: e.target.checked })} />Grilla</label>
          </div>
        </section>
      </aside>

      <div className="cb-main">
        <section className="panel">
          <div className="cb-toolbar">
            <div className="segmented">{PERIODS.map(([k, l]) => <button key={k} className={config.period === k ? "selected" : ""} onClick={() => set({ period: k })}>{l}</button>)}</div>
            <div className="db-dates cb-dates">
              <label>Desde<input type="date" value={shownFrom} onChange={e => set({ period: "custom", from: e.target.value, to: shownTo })} /></label>
              <label>Hasta<input type="date" value={shownTo} onChange={e => set({ period: "custom", to: e.target.value, from: shownFrom })} /></label>
            </div>
            <div className="cb-actions">
              <details className="cb-png">
                <summary className="cb-btn"><Download size={14} aria-hidden="true" />PNG</summary>
                <div className="cb-png-panel">
                  <div className="cb-png-opt"><span>Fondo</span><div className="segmented">{([["white", "Blanco"], ["none", "Transparente"]] as const).map(([k, l]) => <button key={k} className={png.background === k ? "selected" : ""} onClick={() => setPng(p => ({ ...p, background: k }))}>{l}</button>)}</div></div>
                  <div className="cb-png-opt"><span>Texto y ejes</span><div className="segmented">{([["dark", "Oscuro"], ["light", "Claro (fondos oscuros)"]] as const).map(([k, l]) => <button key={k} className={png.text === k ? "selected" : ""} onClick={() => setPng(p => ({ ...p, text: k }))}>{l}</button>)}</div></div>
                  <label className="cb-check"><input type="checkbox" checked={png.header} onChange={e => setPng(p => ({ ...p, header: e.target.checked }))} />Incluir título, leyenda y fuente</label>
                  <button className="db-download" onClick={downloadPng} disabled={!rows.length}><Download size={15} aria-hidden="true" />Descargar PNG</button>
                </div>
              </details>
              <button className="cb-btn" onClick={shareLink}><Copy size={14} aria-hidden="true" />Link</button>
            </div>
          </div>
          {mode !== "none" && <div className="cb-mode">{mode === "farrow" ? "Haz clic donde nace la flecha y arrastra hasta donde apunta." : mode === "text" ? "Haz clic donde quieres el texto." : `Haz clic en el gráfico para poner la ${mode === "vline" ? "línea vertical" : "flecha"}.`} <button className="db-link" onClick={() => setMode("none")}>Cancelar</button></div>}
          {notice && <div className="cb-notice">{notice}</div>}
          <div className="cb-titles">{config.title && <h2>{config.title}</h2>}{config.subtitle && <p>{config.subtitle}</p>}</div>
          <div ref={chartRef} className={mode !== "none" ? "cb-chart cb-crosshair" : "cb-chart"} style={{ height: config.height }}>
            {!config.series.length ? <div className="loading">Agrega una serie para empezar.</div> : !ready ? <div className="loading">Cargando datos…</div> :
              <ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} margin={{ top: 16, right: 12, bottom: 4, left: 4 }} onClick={onChartClick} onMouseMove={(st: { activeLabel?: string | number } | null) => { if (st?.activeLabel) hoverDate.current = String(st.activeLabel); }}>
                {config.grid && <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />}
                <XAxis dataKey="date" minTickGap={50} tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" domain={domain(config.left)} allowDataOverflow={config.left.min !== "" || config.left.max !== ""} tick={{ fontSize: 11 }} width={56} tickFormatter={v => fmt(Number(v), Math.abs(Number(v)) >= 100 ? 0 : 2)} />
                <YAxis yAxisId="right" orientation="right" hide={!hasRight} domain={domain(config.right)} allowDataOverflow={config.right.min !== "" || config.right.max !== ""} tick={{ fontSize: 11 }} width={56} tickFormatter={v => fmt(Number(v), Math.abs(Number(v)) >= 100 ? 0 : 2)} />
                <Tooltip formatter={(v, _n, item) => { const u = units[String(item.dataKey)] ?? ""; return [`${fmt(Number(v), u === "pb" ? 1 : 3)}${u === "%" ? "%" : u ? ` ${u}` : ""}`, config.series.find(s => s.uid === item.dataKey)?.label ?? ""]; }} />
                {config.legend !== "none" && <Legend verticalAlign={config.legend} wrapperStyle={{ fontSize: 12 }} />}
                {visible.map(s => {
                  const name = `${s.label}${units[s.uid] ? ` (${units[s.uid]})` : ""}`;
                  if (s.type === "bar") return <Bar key={s.uid} yAxisId={s.axis} dataKey={s.uid} name={name} fill={s.color} isAnimationActive={false} />;
                  if (s.type === "area") return <Area key={s.uid} yAxisId={s.axis} dataKey={s.uid} name={name} stroke={s.color} fill={s.color} fillOpacity={0.15} strokeWidth={s.width} strokeDasharray={DASH[s.dash]} connectNulls isAnimationActive={false} />;
                  return <Line key={s.uid} yAxisId={s.axis} dataKey={s.uid} name={name} stroke={s.color} strokeWidth={s.type === "dots" ? 0 : s.width} strokeDasharray={DASH[s.dash]} dot={s.type === "dots" ? { r: 2.2, fill: s.color, stroke: s.color } : false} connectNulls isAnimationActive={false} legendType={s.type === "dots" ? "circle" : "line"} />;
                })}
                {config.annotations.map(a => a.kind === "hline"
                  ? <ReferenceLine key={a.id} yAxisId={a.axis === "right" && hasRight ? "right" : "left"} y={a.value} stroke={a.color} strokeDasharray="6 4" strokeWidth={1.5} label={a.label ? { value: a.label, position: "insideTopLeft", fill: a.color, fontSize: 12, fontWeight: 700 } : undefined} />
                  : a.kind === "vline" ? <ReferenceLine key={a.id} yAxisId="left" x={a.date} stroke={a.color} strokeDasharray="6 4" strokeWidth={1.5} label={a.label ? { value: a.label, position: "insideTopRight", fill: a.color, fontSize: 12, fontWeight: 700 } : undefined} />
                  : null)}
                {arrows.length > 0 && <Customized component={(p: { xAxisMap?: AxisMap; yAxisMap?: AxisMap }) => <ArrowLayer xAxisMap={p.xAxisMap} yAxisMap={p.yAxisMap} arrows={arrows} rows={rows} series={config.series} />} />}
                {rows.length > 30 && <Brush dataKey="date" height={22} stroke="#94a3b8" travellerWidth={8} />}
                <Customized component={(p: Pick<FreeLayerProps, "xAxisMap" | "yAxisMap" | "offset">) => <FreeLayer {...p} dates={rows.map(r => String(r.date))} items={config.annotations.filter((a): a is FreeAnnotation => a.kind === "farrow" || a.kind === "text")} mode={mode} axis={freeAxis} preview={drag ? { ...drag, color: draft.color, width: draft.width } : null} onPointer={onFreePointer} onGrab={onGrab} moving={!!move} />} />
              </ComposedChart></ResponsiveContainer>}
          </div>
          {config.source && <p className="dash-note">{config.source}</p>}
        </section>

        <section className="panel cb-block">
          <h2>Guardar</h2>
          <div className="cb-inline"><input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder={config.title || "Nombre del gráfico"} aria-label="Nombre para guardar" /><button className="cb-btn" onClick={saveChart}><Save size={14} aria-hidden="true" />Guardar en este navegador</button></div>
          {Object.keys(saved).length > 0 ? <ul className="cb-annots">{Object.keys(saved).sort().map(name => <li key={name}><button className="db-link" onClick={() => { setConfig({ ...DEFAULT_CONFIG, ...saved[name] }); flash(`Abierto “${name}”.`); }}>{name}</button><button className="cb-icon" onClick={() => removeSaved(name)} title="Borrar"><Trash2 size={13} /></button></li>)}</ul>
            : <p className="db-hint">Los gráficos guardados quedan solo en este navegador. Para compartir uno, usa “Link”: abre exactamente la misma configuración.</p>}
          <button className="db-link" onClick={() => { setConfig({ ...DEFAULT_CONFIG, series: [], annotations: [], title: "", subtitle: "", source: "Fuente: Mercado, Bloomberg, Banco Central." }); window.history.replaceState(null, "", window.location.pathname); }}>Empezar un gráfico en blanco</button>
        </section>
      </div>
    </div>
  </AppShell>;
}

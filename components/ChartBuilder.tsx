"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Area, Bar, Brush, CartesianGrid, ComposedChart, Customized, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Circle, Copy, Download, Eye, EyeOff, MousePointerClick, MoveUpRight, Plus, Save, Search, Square, Trash2, Type, X } from "lucide-react";
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
// Los campos opcionales mantienen compatibles los gráficos guardados antes de agregarlos.
type Annotation =
  | { id: string; kind: "hline"; value: number; axis: Axis; label: string; color: string; textColor?: string; width?: number; dash?: Dash; pos?: "left" | "right"; showValue?: boolean }
  | { id: string; kind: "vline"; date: string; label: string; fullLabel?: string; color: string; width?: number; dash?: Dash; labelY?: number; fontSize?: number; labelSide?: "left" | "right" }
  | { id: string; kind: "arrow"; date: string; seriesUid: string; label: string; color: string; dir: "down" | "up"; width?: number; dash?: Dash }
  | { id: string; kind: "farrow"; x1: string; y1: number; x2: string; y2: number; axis: Axis; color: string; width: number; dash?: Dash }
  | { id: string; kind: "shape"; shape: "ellipse" | "rect"; x1: string; y1: number; x2: string; y2: number; axis: Axis; color: string; width: number; dash: Dash; fill: boolean }
  | { id: string; kind: "text"; x: string; y: number; axis: Axis; text: string; color: string; size: number; bold: boolean };
type FreeAnnotation = Extract<Annotation, { kind: "farrow" | "shape" | "text" }>;
type ShapeTool = "arrow" | "ellipse" | "rect" | "text";
/** event = línea vertical o flecha al punto; hline = clic fija el nivel; shape = herramienta de Formas. */
type Mode = "none" | "event" | "hline" | "shape";
type PngOptions = { background: "white" | "none"; text: "dark" | "light"; header: boolean };
type Period = "1m" | "3m" | "ytd" | "1y" | "5y" | "all" | "custom";
type Config = {
  v: 1; series: PlotSeries[]; annotations: Annotation[]; period: Period; from: string; to: string;
  title: string; subtitle: string; source: string; legend: "top" | "bottom" | "right" | "inside" | "none"; legendPos?: { x: number; y: number }; grid: boolean; height: number;
  /** grid = grilla horizontal (nombre antiguo); gridV = grilla vertical; yAxis = mostrar eje vertical izquierdo. */
  gridV?: boolean; yAxis?: boolean;
  /** Etiqueta con el último dato al final de cada línea. */
  lastValue?: boolean;
  showXAxisTitle?: boolean; xAxisTitle?: string;
  showYAxisTitle?: boolean; yAxisTitle?: string;
  left: { min: string; max: string }; right: { min: string; max: string };
};

const PALETTE = ["#2f6fed", "#d94b4b", "#0f9f6e", "#f59e0b", "#8b5cf6", "#172033", "#0ea5e9", "#64748b"];
const DASH: Record<Dash, string | undefined> = { solid: undefined, dash: "7 4", dot: "2 3" };
const DASH_OPTIONS = <><option value="solid">Continua</option><option value="dash">Segmentada</option><option value="dot">Punteada</option></>;
const WIDTH_OPTIONS = <><option value={1}>Fina</option><option value={1.5}>Normal</option><option value={2.5}>Media</option><option value={3.5}>Gruesa</option></>;
/** Redondeo "limpio" para niveles elegidos con el mouse (según el rango del eje). */
const niceRound = (v: number, span: number) => { const step = Math.pow(10, Math.floor(Math.log10(Math.abs(span) || 1)) - 2); return Number((Math.round(v / step) * step).toFixed(6)); };
const PERIODS: [Period, string][] = [["1m", "1M"], ["ytd", "YTD"], ["1y", "1A"], ["5y", "5A"], ["all", "Todo"]];
const TRANSFORMS: [Transform, string][] = [["level", "Nivel"], ["d1", "Cambio diario"], ["fromStart", "Cambio desde inicio"], ["base100", "Base 100"]];
const uid = () => Math.random().toString(36).slice(2, 9);
const shift = (date: string, months: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10); };
const fmt = (v: number, d = 2) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const STORAGE = "rf-graficos-guardados";

/**
 * Textos dinámicos en título y subtítulo: {series} = nombres de las series visibles ("WTI y Brent")
 * y {s} = "s" si hay más de una serie visible (para plurales: "Contrato{s} de {series}").
 */
function resolveText(text: string, series: { label: string; visible: boolean }[]) {
  const names = series.filter(s => s.visible).map(s => s.label);
  const list = names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
  return text.replace(/\{series\}/g, list).replace(/\{s\}/g, names.length > 1 ? "s" : "");
}

const DEFAULT_CONFIG: Config = {
  v: 1,
  series: [
    { uid: "a", label: "BTP 6,0% ene-2034", source: { kind: "catalog", leg: { id: "BTP0600134", field: "tir" } }, type: "line", color: PALETTE[0], width: 2, dash: "solid", axis: "left", transform: "level", visible: true },
    { uid: "b", label: "SPC CLP 10 años", source: { kind: "catalog", leg: { id: "bbg:clpcam_10y", field: "valor" } }, type: "line", color: PALETTE[3], width: 2, dash: "solid", axis: "left", transform: "level", visible: true },
    { uid: "c", label: "BTP0600134 − SPC 10a", source: { kind: "calc", op: "diff", legs: [{ id: "BTP0600134", field: "tir" }, { id: "bbg:clpcam_10y", field: "valor" }] }, type: "bar", color: "#94a3b8", width: 1, dash: "solid", axis: "right", transform: "level", visible: true },
  ],
  annotations: [], period: "1y", from: "", to: "",
  title: "BTP 2034 versus swap Cámara 10 años", subtitle: "TIR y swap en %, diferencia en pb (eje derecho)", source: "Fuente: Mercado, Bloomberg.",
  legend: "bottom", grid: true, height: 460, showXAxisTitle: false, xAxisTitle: "Fecha", showYAxisTitle: false, yAxisTitle: "Tasa (%)", left: { min: "", max: "" }, right: { min: "", max: "" },
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
      <line x1={x} x2={x} y1={tailY} y2={up ? tipY + 8 : tipY - 8} stroke={a.color} strokeWidth={a.width ?? 1.8} strokeDasharray={DASH[a.dash ?? "solid"]} />
      <polygon points={head} fill={a.color} />
      {a.label && <text x={x} y={up ? tailY + 14 : tailY - 6} textAnchor="middle" fontSize={12} fontWeight={700} fill={a.color} stroke="#fff" strokeWidth={3} paintOrder="stroke">{a.label}</text>}
    </g>;
  })}</g>;
}

// ---------------- Capa libre: formas, textos y líneas horizontales con el mouse ----------------
type Pt = { date: string; value: number };
type Px = { x: number; y: number };
type ShapePreview = { tool: "arrow" | "ellipse" | "rect"; from: Pt; to: Pt; color: string; width: number; dash: Dash; fill: boolean };
type FreeLayerProps = {
  xAxisMap?: AxisMap; yAxisMap?: AxisMap & Record<string, { scale: { invert?: (v: number) => number } }>; offset?: { left: number; top: number; width: number; height: number };
  dates: string[]; items: FreeAnnotation[]; mode: Mode; axis: Axis; preview: ShapePreview | null;
  onPointer: (kind: "down" | "move" | "up", pt: Pt, px: Px) => void; onGrab: (id: string, pt: Pt) => void; onEditText: (id: string, px: Px) => void; moving: boolean;
  /** Franjas sobre los ejes Y: clic agrega una línea horizontal en ese nivel (como Bloomberg). */
  axes: { left: boolean; right: boolean }; hlines: Extract<Annotation, { kind: "hline" }>[]; ghost: { axis: Axis; value: number } | null;
  onAxis: (kind: "hover" | "leave" | "click", axis: Axis, value: number) => void;
  onScaleReady: (scales: { left?: (y: number) => number; right?: (y: number) => number; offset: { left: number; top: number; width: number; height: number } }) => void;
};
function FreeLayer({ xAxisMap, yAxisMap, offset, dates, items, mode, axis, preview, onPointer, onGrab, onEditText, moving, axes, hlines, ghost, onAxis, onScaleReady }: FreeLayerProps) {
  const xAxis = xAxisMap ? Object.values(xAxisMap)[0] : undefined;
  if (!xAxis || !yAxisMap || !offset) return null;
  const band = xAxis.scale.bandwidth ? xAxis.scale.bandwidth() / 2 : 0;
  const xOf = (d: string) => { const v = xAxis.scale(d); return typeof v === "number" && !Number.isNaN(v) ? v + band : null; };
  type YScale = ((v: number) => number) & { invert?: (v: number) => number; domain?: () => number[] };
  const yScale = (a: Axis) => (yAxisMap[a] ?? yAxisMap.left)?.scale as unknown as YScale;
  useEffect(() => {
    onScaleReady({ left: yScale("left")?.invert, right: yScale("right")?.invert, offset });
  }, [xAxisMap, yAxisMap, offset?.left, offset?.top, offset?.width, offset?.height, onScaleReady]);
  const visibleDates = dates.filter(d => xOf(d) !== null);
  // Píxel → fecha más cercana y valor del eje.
  const toData = (px: number, py: number, a: Axis): Pt | null => {
    if (!visibleDates.length) return null;
    let best = visibleDates[0], dist = Infinity;
    for (const d of visibleDates) { const x = xOf(d)!, dd = Math.abs(x - px); if (dd < dist) { dist = dd; best = d; } }
    const inv = yScale(a)?.invert;
    return inv ? { date: best, value: inv(py) } : null;
  };
  const local = (e: React.MouseEvent<SVGElement>): Px => {
    const svg = (e.currentTarget as SVGElement).ownerSVGElement ?? (e.currentTarget as unknown as SVGSVGElement);
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const box = (a: { x1: string; y1: number; x2: string; y2: number; axis: Axis }) => {
    const x1 = xOf(a.x1), x2 = xOf(a.x2), ys = yScale(a.axis);
    if (x1 === null || x2 === null || !ys) return null;
    return { x1, x2, y1: ys(a.y1), y2: ys(a.y2) };
  };
  const arrow = (key: string, a: { x1: string; y1: number; x2: string; y2: number; axis: Axis; color: string; width: number; dash?: Dash }, grab?: (e: React.MouseEvent<SVGElement>) => void) => {
    const b = box(a);
    if (!b) return null;
    const { x1, y1, x2, y2 } = b, ang = Math.atan2(y2 - y1, x2 - x1), h = 8 + a.width * 2;
    const head = `${x2},${y2} ${x2 - h * Math.cos(ang - 0.45)},${y2 - h * Math.sin(ang - 0.45)} ${x2 - h * Math.cos(ang + 0.45)},${y2 - h * Math.sin(ang + 0.45)}`;
    const ex = x2 - (h * 0.7) * Math.cos(ang), ey = y2 - (h * 0.7) * Math.sin(ang);
    return <g key={key} onMouseDown={grab} style={{ cursor: grab ? "move" : undefined, pointerEvents: grab ? undefined : "none" }}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={12} />
      <line x1={x1} y1={y1} x2={ex} y2={ey} stroke={a.color} strokeWidth={a.width} strokeDasharray={DASH[a.dash ?? "solid"]} strokeLinecap="round" />
      <polygon points={head} fill={a.color} />
    </g>;
  };
  const shape = (key: string, a: { shape: "ellipse" | "rect"; x1: string; y1: number; x2: string; y2: number; axis: Axis; color: string; width: number; dash: Dash; fill: boolean }, grab?: (e: React.MouseEvent<SVGElement>) => void) => {
    const b = box(a);
    if (!b) return null;
    const x = Math.min(b.x1, b.x2), y = Math.min(b.y1, b.y2), w = Math.abs(b.x2 - b.x1), h = Math.abs(b.y2 - b.y1);
    const common = { fill: a.fill ? a.color : "transparent", fillOpacity: a.fill ? 0.14 : 1, stroke: a.color, strokeWidth: a.width, strokeDasharray: DASH[a.dash], onMouseDown: grab, style: { cursor: grab ? "move" : undefined, pointerEvents: grab ? undefined : "none" } as React.CSSProperties };
    return a.shape === "rect" ? <rect key={key} x={x} y={y} width={w} height={h} rx={3} {...common} /> : <ellipse key={key} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} />;
  };
  const capture = mode === "shape" || moving;
  const axisValue = (a: Axis, py: number) => { const sc = yScale(a), d = sc?.domain?.() ?? [0, 1]; return sc?.invert ? niceRound(sc.invert(py), d[1] - d[0]) : null; };
  const strip = (a: Axis) => {
    const x = a === "left" ? offset.left - 56 : offset.left + offset.width;
    const handler = (kind: "hover" | "click") => (e: React.MouseEvent<SVGElement>) => { const v = axisValue(a, local(e).y); if (v !== null) onAxis(kind, a, v); };
    return <rect key={`axis-${a}`} x={x} y={offset.top} width={56} height={offset.height} fill="transparent" style={{ cursor: "pointer" }}
      onMouseMove={handler("hover")} onMouseLeave={() => onAxis("leave", a, 0)} onClick={e => { e.stopPropagation(); handler("click")(e); }}>
      <title>Clic para agregar una línea horizontal en este nivel</title>
    </rect>;
  };
  const ghostY = ghost ? yScale(ghost.axis)?.(ghost.value) : null;
  return <g>
    {items.map(it => {
      const grab = mode === "none" ? (e: React.MouseEvent<SVGElement>) => { e.stopPropagation(); const p = local(e); const pt = toData(p.x, p.y, it.axis); if (pt) onGrab(it.id, pt); } : undefined;
      if (it.kind === "farrow") return arrow(it.id, it, grab);
      if (it.kind === "shape") return shape(it.id, it, grab);
      const x = xOf(it.x), ys = yScale(it.axis);
      if (x === null || !ys) return null;
      return <text key={it.id} x={x} y={ys(it.y)} fontSize={it.size} fontWeight={it.bold ? 700 : 400} fill={it.color} stroke="#fff" strokeWidth={3} paintOrder="stroke" dominantBaseline="middle"
        onMouseDown={grab} onDoubleClick={e => { e.stopPropagation(); onEditText(it.id, { x, y: ys(it.y) }); }} style={{ cursor: grab ? "move" : undefined, pointerEvents: grab ? undefined : "none" }}>{it.text}</text>;
    })}
    {preview && (preview.tool === "arrow"
      ? arrow("preview", { x1: preview.from.date, y1: preview.from.value, x2: preview.to.date, y2: preview.to.value, axis, color: preview.color, width: preview.width, dash: preview.dash })
      : shape("preview", { shape: preview.tool, x1: preview.from.date, y1: preview.from.value, x2: preview.to.date, y2: preview.to.value, axis, color: preview.color, width: preview.width, dash: preview.dash, fill: preview.fill }))}
    {hlines.filter(h => h.showValue).map(h => { const y = yScale(h.axis)?.(h.value); if (typeof y !== "number" || !Number.isFinite(y) || y < offset.top || y > offset.top + offset.height) return null; const x = h.axis === "left" ? offset.left - 54 : offset.left + offset.width + 2; return <g key={`level-${h.id}`} style={{ pointerEvents: "none" }}><rect x={x} y={y - 9} width={52} height={18} rx={3} fill="#172033" /><text x={x + 26} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">{fmt(h.value, Math.abs(h.value) >= 100 ? 1 : 2)}</text></g>; })}
    {ghost && typeof ghostY === "number" && Number.isFinite(ghostY) && <g style={{ pointerEvents: "none" }}>
      <line x1={offset.left} x2={offset.left + offset.width} y1={ghostY} y2={ghostY} stroke="#64748b" strokeDasharray="4 4" />
      <rect x={ghost.axis === "left" ? offset.left - 54 : offset.left + offset.width + 2} y={ghostY - 9} width={52} height={18} rx={3} fill="#172033" />
      <text x={ghost.axis === "left" ? offset.left - 28 : offset.left + offset.width + 28} y={ghostY + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">{fmt(ghost.value, Math.abs(ghost.value) >= 100 ? 1 : 2)}</text>
    </g>}
    {capture && <rect x={offset.left} y={offset.top} width={offset.width} height={offset.height} fill="transparent" style={{ cursor: moving ? "grabbing" : "crosshair" }}
      onMouseDown={e => { e.preventDefault(); const p = local(e), pt = toData(p.x, p.y, axis); if (pt) onPointer("down", pt, p); }}
      onMouseMove={e => { const p = local(e), pt = toData(p.x, p.y, axis); if (pt) onPointer("move", pt, p); }}
      onMouseUp={e => { const p = local(e), pt = toData(p.x, p.y, axis); if (pt) onPointer("up", pt, p); }}
      onMouseLeave={e => { const p = local(e), pt = toData(p.x, p.y, axis); if (pt) onPointer("up", pt, p); }} />}
    {!moving && (mode === "none") && <>{axes.left && strip("left")}{axes.right && strip("right")}</>}
  </g>;
}

// ---------------- Componente principal ----------------
export type RecommendedChart = { nombre: string; config: Partial<Config> };
export type HistoricalEvent = { id: string; fecha: string; corto: string; nombre: string; categoria: string; descripcion: string; fuente: string };
export function ChartBuilder({ catalog, recommended = [], historicalEvents = [] }: { catalog: Catalog; recommended?: RecommendedChart[]; historicalEvents?: HistoricalEvent[] }) {
  const byId = useMemo(() => new Map(catalog.groups.flatMap(g => g.series.map(s => [s.id, s] as const))), [catalog]);
  const allSeries = useMemo(() => catalog.groups.flatMap(g => g.series), [catalog]);
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [dragVLabel, setDragVLabel] = useState<string | null>(null);
  const [dragLegend, setDragLegend] = useState(false);
  const set = (patch: Partial<Config>) => setConfig(c => ({ ...c, ...patch }));
  const setSeries = (u: string, patch: Partial<PlotSeries>) => setConfig(c => ({ ...c, series: c.series.map(s => s.uid === u ? { ...s, ...patch } : s) }));
  const [query, setQuery] = useState("");
  const [eventId, setEventId] = useState("");
  const [eventFontSize, setEventFontSize] = useState(12);
  const [eventLabelSide, setEventLabelSide] = useState<"left" | "right">("right");
  const sortedHistoricalEvents = useMemo(() => [...historicalEvents].sort((a, b) => b.fecha.localeCompare(a.fecha)), [historicalEvents]);
  const [calc, setCalc] = useState<{ op: "diff" | "fly"; legs: string[] }>({ op: "diff", legs: ["", "", ""] });
  const [mode, setMode] = useState<Mode>("none");
  // Borradores de cada bloque de anotaciones.
  const [ev, setEv] = useState({ label: "", color: "#d94b4b", dash: "dash" as Dash, width: 1.5, style: "line" as "line" | "arrow", seriesUid: "", dir: "down" as "down" | "up" });
  const [hl, setHl] = useState({ label: "", value: "", axis: "left" as Axis, color: "#d94b4b", textColor: "#d94b4b", width: 1.5, dash: "dash" as Dash, pos: "left" as "left" | "right", showValue: true });
  const [sh, setSh] = useState({ tool: "arrow" as ShapeTool, color: "#d94b4b", width: 2, dash: "solid" as Dash, fill: false, size: 13, bold: true });
  const [drag, setDrag] = useState<{ from: Pt; to: Pt } | null>(null);
  const [ghost, setGhost] = useState<{ axis: Axis; value: number } | null>(null);
  const axisScales = useRef<{ left?: (y: number) => number; right?: (y: number) => number; offset: { left: number; top: number; width: number; height: number } } | null>(null);
  const onScaleReady = useCallback((scales: NonNullable<typeof axisScales.current>) => { axisScales.current = scales; }, []);
  const moveVerticalLabel = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragVLabel || !axisScales.current) return;
    const svg = chartRef.current?.querySelector("svg.recharts-surface");
    if (!svg) return;
    const plot = axisScales.current.offset;
    const y = e.clientY - svg.getBoundingClientRect().top;
    const labelY = Math.max(0.04, Math.min(0.96, (y - plot.top) / plot.height));
    setConfig(c => ({ ...c, annotations: c.annotations.map(a => a.id === dragVLabel && a.kind === "vline" ? { ...a, labelY } : a) }));
  };
  const moveLegend = (e: React.MouseEvent<HTMLDivElement>) => {
    const svg = chartRef.current?.querySelector("svg.recharts-surface");
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const x = Math.max(0.02, Math.min(0.96, (e.clientX - box.left) / box.width));
    const y = Math.max(0.02, Math.min(0.94, (e.clientY - box.top) / box.height));
    setConfig(c => ({ ...c, legendPos: { x, y } }));
  };
  const onChartPointer = (e: React.MouseEvent<HTMLDivElement>, fix = false) => {
    if (mode !== "none" || !axisScales.current || !ready) return;
    const svg = chartRef.current?.querySelector("svg.recharts-surface");
    if (!svg) return;
    const bounds = svg.getBoundingClientRect(), x = e.clientX - bounds.left, y = e.clientY - bounds.top;
    const { offset, left, right } = axisScales.current;
    if (y < offset.top || y > offset.top + offset.height || x < offset.left - 56 || x > offset.left + offset.width + (hasRight ? 56 : 0)) { setGhost(null); return; }
    const axis: Axis = x > offset.left + offset.width && hasRight ? "right" : "left";
    const invert = axis === "right" ? right : left;
    if (!invert) return;
    const value = niceRound(invert(y), Math.abs(invert(offset.top) - invert(offset.top + offset.height)));
    if (!Number.isFinite(value)) return;
    if (fix) { addHLine(value, axis); } else { setGhost({ axis, value }); }
  };
  const [editing, setEditing] = useState<{ id?: string; pt?: Pt; x: number; y: number; text: string } | null>(null);
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
    const from = config.period === "custom" ? config.from || "0000" : config.period === "all" || !lastDate ? "0000" : config.period === "ytd" ? `${lastDate.slice(0, 4)}-01-01` : shift(lastDate, config.period === "1m" ? -1 : config.period === "1y" ? -12 : -60);
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
    setConfig(c => ({ ...c, series: [...c.series, { uid: uid(), label, source: { kind: "calc", op: calc.op, legs }, type: "line", color: nextColor(c.series), width: 2, dash: "solid", axis: "left", transform: "level", visible: true }] }));
  };
  const add = (a: Annotation) => setConfig(c => ({ ...c, annotations: [...c.annotations, a] }));
  const setAnnotation = (id: string, patch: Partial<Annotation>) => setConfig(c => ({ ...c, annotations: c.annotations.map(a => a.id === id ? { ...a, ...patch } as Annotation : a) }));
  const addHistoricalEvent = () => {
    const event = historicalEvents.find(item => item.id === eventId);
    if (!event) { flash("Selecciona un evento relevante."); return; }
    const dates = rows.map(row => String(row.date));
    const target = dates.find(date => date >= event.fecha);
    // Los mercados no siempre abren el día del evento; se utiliza la primera
    // observación disponible durante la semana siguiente.
    if (!target || (new Date(target + "T00:00:00Z").getTime() - new Date(event.fecha + "T00:00:00Z").getTime()) > 7 * 86400000) {
      flash("El evento está fuera del rango del gráfico. Amplía el período para agregarlo.");
      return;
    }
    add({ id: uid(), kind: "vline", date: target, label: event.corto, fullLabel: event.nombre, fontSize: eventFontSize, labelSide: eventLabelSide, color: ev.color, width: ev.width, dash: ev.dash });
    flash(`Evento agregado: ${event.nombre}`);
  };
  const addHLine = (value: number, axis: Axis) => add({ id: uid(), kind: "hline", value, axis, label: hl.label, color: hl.color, textColor: hl.textColor, width: hl.width, dash: hl.dash, pos: hl.pos, showValue: hl.showValue });
  const addHLineTyped = () => {
    const value = Number(hl.value.replace(",", "."));
    if (hl.value.trim() === "" || !Number.isFinite(value)) { flash("Ingresa un valor numérico o haz clic en el eje Y."); return; }
    addHLine(value, hl.axis);
  };
  const onAxis = (kind: "hover" | "leave" | "click", axis: Axis, value: number) => {
    if (kind === "leave") { setGhost(null); return; }
    if (kind === "hover") { setGhost({ axis, value }); return; }
    addHLine(value, axis); setGhost(null); setMode("none");
  };
  const onChartClick = (state: { activeLabel?: string | number } | null) => {
    // La fecha sale del punto bajo el cursor (se guarda al mover el mouse, por si el clic no la trae).
    const date = state?.activeLabel ? String(state.activeLabel) : hoverDate.current;
    if (mode !== "event" || !date) return;
    if (ev.style === "line") add({ id: uid(), kind: "vline", date, label: ev.label, color: ev.color, width: ev.width, dash: ev.dash });
    else {
      const target = ev.seriesUid || config.series.find(s => s.visible)?.uid;
      if (target) add({ id: uid(), kind: "arrow", date, seriesUid: target, label: ev.label, color: ev.color, dir: ev.dir, width: ev.width, dash: ev.dash });
    }
    setMode("none");
  };
  // Formas (arrastrar), texto (clic abre un cuadro), línea horizontal con clic y mover anotaciones libres.
  const freeAxis: Axis = config.series.some(s => s.visible && s.axis === "left") ? "left" : "right";
  const dateIndex = (d: string) => rows.findIndex(r => r.date === d);
  const onFreePointer = (kind: "down" | "move" | "up", pt: Pt, px: Px) => {
    if (move) {
      if (kind === "down") return;
      const shiftIdx = dateIndex(pt.date) - dateIndex(move.start.date), dv = pt.value - move.start.value;
      const shiftDate = (d: string) => { const i = dateIndex(d); const j = Math.min(rows.length - 1, Math.max(0, i + shiftIdx)); return i < 0 ? d : String(rows[j].date); };
      const o = move.original;
      const moved: FreeAnnotation = o.kind === "text" ? { ...o, x: shiftDate(o.x), y: o.y + dv } : { ...o, x1: shiftDate(o.x1), x2: shiftDate(o.x2), y1: o.y1 + dv, y2: o.y2 + dv };
      setConfig(c => ({ ...c, annotations: c.annotations.map(a => a.id === o.id ? moved : a) }));
      if (kind === "up") setMove(null);
      return;
    }
    if (mode !== "shape") return;
    if (sh.tool === "text") {
      if (kind === "down") { setEditing({ pt, x: px.x, y: px.y, text: "" }); setMode("none"); }
      return;
    }
    if (kind === "down") setDrag({ from: pt, to: pt });
    else if (kind === "move" && drag) setDrag({ ...drag, to: pt });
    else if (kind === "up" && drag) {
      if (drag.from.date !== pt.date || Math.abs(drag.from.value - pt.value) > 1e-9) {
        const base = { id: uid(), x1: drag.from.date, y1: drag.from.value, x2: pt.date, y2: pt.value, axis: freeAxis, color: sh.color, width: sh.width, dash: sh.dash };
        add(sh.tool === "arrow" ? { ...base, kind: "farrow" } : { ...base, kind: "shape", shape: sh.tool, fill: sh.fill });
      }
      setDrag(null); setMode("none");
    }
  };
  const commitText = () => {
    if (!editing) return;
    const text = editing.text.trim();
    if (editing.id) {
      if (text) setAnnotation(editing.id, { text } as Partial<Annotation>);
      else setConfig(c => ({ ...c, annotations: c.annotations.filter(a => a.id !== editing.id) }));
    } else if (text && editing.pt) add({ id: uid(), kind: "text", x: editing.pt.date, y: editing.pt.value, axis: freeAxis, text, color: sh.color, size: sh.size, bold: sh.bold });
    setEditing(null);
  };
  const onEditText = (id: string, px: Px) => {
    const t = config.annotations.find(a => a.id === id);
    if (t?.kind === "text") setEditing({ id, x: px.x, y: px.y, text: t.text });
  };
  const onGrab = (id: string, pt: Pt) => {
    const original = config.annotations.find((a): a is FreeAnnotation => a.id === id && (a.kind === "farrow" || a.kind === "shape" || a.kind === "text"));
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
  const title = resolveText(config.title, config.series), subtitle = resolveText(config.subtitle, config.series);
  const downloadPng = async () => {
    const svg = chartRef.current?.querySelector("svg.recharts-surface") as SVGSVGElement | null;
    if (!svg) return;
    const { width, height } = svg.getBoundingClientRect();
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg"); clone.setAttribute("style", "font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"); clone.setAttribute("width", String(width)); clone.setAttribute("height", String(height));
    clone.querySelectorAll(".recharts-brush").forEach(n => n.remove());
    // Etiquetas de último dato: se dibujan directo en el canvas (algunos navegadores no las pintan al rasterizar el SVG).
    const box = svg.getBoundingClientRect();
    const lastTags = [...svg.querySelectorAll(".cb-last")].map(g => {
      const r = g.querySelector("rect")!.getBoundingClientRect();
      return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height, fill: g.querySelector("rect")!.getAttribute("fill") ?? "#172033", text: g.querySelector("text")?.textContent ?? "" };
    });
    clone.querySelectorAll(".cb-last").forEach(n => n.remove());
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
      const header = png.header ? (title ? 34 : 0) + (subtitle ? 22 : 0) + 8 : 0, legendH = !png.header || config.legend === "none" || config.legend === "inside" || config.legend === "right" ? 0 : 26, footer = png.header ? 30 : 0;
      const ink = light ? { title: "#f8fafc", sub: "#cbd5e1", legend: "#e2e8f0", foot: "#94a3b8" } : { title: "#172033", sub: "#748096", legend: "#31405a", foot: "#8b96a8" };
      const W = width + pad * 2, H = header + legendH + height + footer + pad;
      const canvas = document.createElement("canvas"); canvas.width = W * scale; canvas.height = H * scale;
      const ctx = canvas.getContext("2d")!; ctx.scale(scale, scale);
      if (png.background === "white") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H); }
      const font = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
      let y = pad;
      if (png.header && title) { ctx.fillStyle = ink.title; ctx.font = `700 20px ${font}`; ctx.fillText(title, pad, y + 16); y += 34; }
      if (png.header && subtitle) { ctx.fillStyle = ink.sub; ctx.font = `13px ${font}`; ctx.fillText(subtitle, pad, y + 10); y += 22; }
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
      ctx.drawImage(img, pad, y, width, height);
      for (const t of lastTags) {
        ctx.fillStyle = t.fill; ctx.beginPath(); ctx.roundRect(pad + t.x, y + t.y, t.w, t.h, 3); ctx.fill();
        ctx.fillStyle = "#ffffff"; ctx.font = `700 11px ${font}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(t.text, pad + t.x + t.w / 2, y + t.y + t.h / 2 + 0.5);
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      }
      y += height;
      if (png.header && config.legend === "bottom") drawLegend();
      if (png.header) {
        ctx.fillStyle = ink.foot; ctx.font = `11px ${font}`; ctx.fillText(config.source || "", pad, H - 14);
        ctx.textAlign = "right"; ctx.fillText("rfchilena.cl", W - pad, H - 14);
      }
      URL.revokeObjectURL(url);
      canvas.toBlob(b => { if (!b) return; const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${(title || "grafico").replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60)}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }, "image/png");
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

  const describe = (a: Annotation) => a.kind === "hline" ? `${fmt(a.value, Math.abs(a.value) >= 100 ? 1 : 2)}${a.label ? ` · ${a.label}` : ""}` : a.kind === "vline" ? `Línea ${a.date}${a.label ? ` · ${a.fullLabel ?? a.label}` : ""}`
    : a.kind === "arrow" ? `Flecha ${a.date}${a.label ? ` · ${a.label}` : ""}` : a.kind === "farrow" ? "Flecha" : a.kind === "shape" ? (a.shape === "rect" ? "Cuadrado" : "Círculo") : `Texto “${a.text}”`;
  const annotationList = (filter: (a: Annotation) => boolean) => {
    const list = config.annotations.filter(filter);
    return list.length > 0 && <ul className="cb-annots">{list.map(a => <li key={a.id}>
      <input type="color" className="cb-swatch" value={a.color} onChange={e => setAnnotation(a.id, a.kind === "hline" && (a.textColor ?? a.color) === a.color ? { color: e.target.value, textColor: e.target.value } : { color: e.target.value })} title="Cambiar color" />
      <span className="cb-annot-text">{describe(a)}</span>
      <button className="cb-icon" onClick={() => set({ annotations: config.annotations.filter(x => x.id !== a.id) })} title="Borrar"><Trash2 size={13} /></button>
    </li>)}</ul>;
  };

  return <AppShell>
    <header className="page-head">
      <div><div className="eyebrow">Herramientas</div><h1>Personaliza tu gráfico</h1><p>Combina series financieras, ajusta el diseño y destaca los movimientos que quieras analizar.</p></div>
    </header>
    {recommended.length > 0 && <section className="panel cb-block cb-recommended-top">
      <h2>Gráficos recomendados</h2>
      <p className="db-hint">Empieza con un gráfico preparado y personalízalo con tus propias series y anotaciones.</p>
      <div className="cb-recs">{recommended.map(r => <button key={r.nombre} className="cb-rec" onClick={() => { setConfig({ ...DEFAULT_CONFIG, annotations: [], ...r.config, period: "1y", from: "", to: "" } as Config); window.history.replaceState(null, "", window.location.pathname); flash(`Abierto “${r.nombre}”.`); }}>
        <strong>{r.nombre}</strong>{r.config.subtitle && <span>{resolveText(r.config.subtitle, r.config.series ?? [])}</span>}
      </button>)}</div>
    </section>}
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
          <h2>Formato</h2>
          <label className="cb-field">Título<input value={config.title} onChange={e => set({ title: e.target.value })} /></label>
          <label className="cb-field">Subtítulo<input value={config.subtitle} onChange={e => set({ subtitle: e.target.value })} /></label>
          <p className="db-hint">Puedes usar {"{series}"} para los nombres de las series visibles y {"{s}"} para el plural. Ej.: “Contrato{"{s}"} de {"{series}"}”.</p>
          <label className="cb-field">Fuente / nota al pie<input value={config.source} onChange={e => set({ source: e.target.value })} /></label>
          <div className="cb-series-grid">
            <label>Leyenda<select value={config.legend} onChange={e => set({ legend: e.target.value as Config["legend"] })}><option value="bottom">Abajo</option><option value="top">Arriba</option><option value="right">Derecha</option><option value="inside">Dentro del gráfico (movible)</option><option value="none">Sin leyenda</option></select></label>
            <label>Alto<input type="range" min={300} max={720} step={20} value={config.height} onChange={e => set({ height: Number(e.target.value) })} /></label>
            <label>Eje izq. mín<input value={config.left.min} placeholder="auto" onChange={e => set({ left: { ...config.left, min: e.target.value } })} /></label>
            <label>Eje izq. máx<input value={config.left.max} placeholder="auto" onChange={e => set({ left: { ...config.left, max: e.target.value } })} /></label>
            <label>Eje der. mín<input value={config.right.min} placeholder="auto" onChange={e => set({ right: { ...config.right, min: e.target.value } })} /></label>
            <label>Eje der. máx<input value={config.right.max} placeholder="auto" onChange={e => set({ right: { ...config.right, max: e.target.value } })} /></label>
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
          {mode !== "none" && <div className="cb-mode">{mode === "event" ? `Haz clic en la fecha donde va la ${ev.style === "line" ? "línea vertical" : "flecha"}.` : sh.tool === "text" ? "Haz clic donde quieres escribir." : sh.tool === "arrow" ? "Haz clic donde nace la flecha y arrastra hasta donde apunta." : `Arrastra para dibujar el ${sh.tool === "rect" ? "cuadrado" : "círculo"}.`} <button className="db-link" onClick={() => setMode("none")}>Cancelar</button></div>}
          {notice && <div className="cb-notice">{notice}</div>}
          <div className="cb-titles">{title && <h2>{title}</h2>}{subtitle && <p>{subtitle}</p>}</div>
          <div ref={chartRef} className={mode !== "none" ? "cb-chart cb-crosshair" : "cb-chart"} style={{ height: config.height }} onMouseMove={e => { if (dragLegend) moveLegend(e); else if (dragVLabel) moveVerticalLabel(e); else onChartPointer(e); }} onMouseUp={() => { setDragVLabel(null); setDragLegend(false); }} onMouseLeave={() => { setGhost(null); setDragVLabel(null); setDragLegend(false); }} onClick={e => { if (dragVLabel) return; if (e.target instanceof SVGElement && e.target.closest(".recharts-surface")) onChartPointer(e, true); }}>
            {!config.series.length ? <div className="loading">Agrega una serie para empezar.</div> : !ready ? <div className="loading">Cargando datos…</div> :
              <ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} margin={{ top: 16, right: config.lastValue ? 64 : 12, bottom: config.showXAxisTitle ? 24 : 4, left: 4 }} onClick={onChartClick} onMouseMove={(st: { activeLabel?: string | number } | null) => { if (st?.activeLabel) hoverDate.current = String(st.activeLabel); }}>
                {(config.grid || config.gridV) && <CartesianGrid strokeDasharray="3 3" horizontal={config.grid} vertical={!!config.gridV} stroke="#e5eaf2" />}
                <XAxis dataKey="date" minTickGap={50} tick={{ fontSize: 11 }} label={config.showXAxisTitle ? { value: config.xAxisTitle ?? "Fecha", position: "insideBottom", offset: -10, fontSize: 13, fill: "#334155", fontWeight: 600 } : undefined} />
                <YAxis yAxisId="left" hide={config.yAxis === false} domain={domain(config.left)} allowDataOverflow={config.left.min !== "" || config.left.max !== ""} tick={{ fontSize: 11 }} width={config.showYAxisTitle ? 64 : 56} label={config.showYAxisTitle ? { value: config.yAxisTitle ?? "Tasa (%)", angle: -90, position: "insideLeft", fontSize: 13, fill: "#334155", fontWeight: 600 } : undefined} tickFormatter={v => fmt(Number(v), Math.abs(Number(v)) >= 10 ? 0 : 2)} />
                <YAxis yAxisId="right" orientation="right" hide={!hasRight} domain={domain(config.right)} allowDataOverflow={config.right.min !== "" || config.right.max !== ""} tick={{ fontSize: 11 }} width={56} tickFormatter={v => fmt(Number(v), Math.abs(Number(v)) >= 10 ? 0 : 2)} />
                <Tooltip formatter={(v, _n, item) => { const u = units[String(item.dataKey)] ?? ""; return [`${fmt(Number(v), u === "pb" ? 1 : 3)}${u === "%" ? "%" : u ? ` ${u}` : ""}`, config.series.find(s => s.uid === item.dataKey)?.label ?? ""]; }} />
                {config.legend !== "none" && config.legend !== "inside" && <Legend verticalAlign={config.legend === "right" ? "middle" : config.legend} align={config.legend === "right" ? "right" : "center"} layout={config.legend === "right" ? "vertical" : "horizontal"} wrapperStyle={{ fontSize: 12 }} />}
                {visible.map(s => {
                  const name = `${s.label}${units[s.uid] ? ` (${units[s.uid]})` : ""}`;
                  // Último punto con dato de la serie: ahí va la etiqueta con el valor.
                  let lastIdx = -1;
                  if (config.lastValue) for (let i = rows.length - 1; i >= 0; i--) { const v = (rows[i] as Record<string, unknown>)[s.uid]; if (typeof v === "number" && Number.isFinite(v)) { lastIdx = i; break; } }
                  const u = units[s.uid] ?? "";
                  const lastLabel = config.lastValue && lastIdx >= 0 ? (p: { x?: number | string; y?: number | string; index?: number; value?: unknown }) => {
                    if (p.index !== lastIdx || typeof p.value !== "number") return <g />;
                    const text = `${fmt(p.value, u === "pb" ? 1 : 2)}${u === "%" ? "%" : ""}`, w = text.length * 6.6 + 10, x = Number(p.x) + 6, y = Number(p.y);
                    return <g className="cb-last"><rect x={x} y={y - 9} width={w} height={18} rx={3} fill={s.color} /><text x={x + w / 2} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">{text}</text></g>;
                  } : undefined;
                  if (s.type === "bar") return <Bar key={s.uid} yAxisId={s.axis} dataKey={s.uid} name={name} fill={s.color} isAnimationActive={false} />;
                  if (s.type === "area") return <Area key={s.uid} yAxisId={s.axis} dataKey={s.uid} name={name} stroke={s.color} fill={s.color} fillOpacity={0.15} strokeWidth={s.width} strokeDasharray={DASH[s.dash]} connectNulls isAnimationActive={false} label={lastLabel} />;
                  return <Line key={s.uid} yAxisId={s.axis} dataKey={s.uid} name={name} stroke={s.color} strokeWidth={s.type === "dots" ? 0 : s.width} strokeDasharray={DASH[s.dash]} dot={s.type === "dots" ? { r: 2.2, fill: s.color, stroke: s.color } : false} connectNulls isAnimationActive={false} legendType={s.type === "dots" ? "circle" : "line"} label={lastLabel} />;
                })}
                {config.annotations.map(a => a.kind === "hline"
                  ? <ReferenceLine key={a.id} yAxisId={a.axis === "right" && hasRight ? "right" : "left"} y={a.value} stroke={a.color} strokeDasharray={DASH[a.dash ?? "dash"]} strokeWidth={a.width ?? 1.5} label={a.label ? { value: a.label, position: a.pos === "right" ? "insideTopRight" : "insideTopLeft", fill: a.textColor ?? a.color, fontSize: 12, fontWeight: 700 } : undefined} />
                  : a.kind === "vline" ? <ReferenceLine key={a.id} yAxisId="left" x={a.date} stroke={a.color} strokeDasharray={DASH[a.dash ?? "dash"]} strokeWidth={a.width ?? 1.5} label={a.label ? (p: { viewBox?: { x?: number; y?: number; width?: number; height?: number } }) => {
                      const box = p.viewBox;
                      if (!box) return <g />;
                      const y = Number(box.y ?? 0) + Number(box.height ?? 0) * (a.labelY ?? 0.06);
                      const isLeft = a.labelSide === "left";
                      const x = Number(box.x ?? 0) + (isLeft ? -5 : Number(box.width ?? 0) + 5);
                      return <text x={x} y={y} textAnchor={isLeft ? "end" : "start"} fill={a.color} fontSize={a.fontSize ?? 12} fontWeight={700} dominantBaseline="middle"
                        stroke="#fff" strokeWidth={3} paintOrder="stroke" style={{ cursor: "ns-resize", userSelect: "none" }}
                        onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setDragVLabel(a.id); }}
                        onClick={e => e.stopPropagation()}><title>{a.fullLabel ?? a.label}</title>{a.label}</text>;
                    } : undefined} />
                  : null)}
                {arrows.length > 0 && <Customized component={(p: { xAxisMap?: AxisMap; yAxisMap?: AxisMap }) => <ArrowLayer xAxisMap={p.xAxisMap} yAxisMap={p.yAxisMap} arrows={arrows} rows={rows} series={config.series} />} />}
                {rows.length > 30 && <Brush dataKey="date" height={22} stroke="#94a3b8" travellerWidth={8} />}
                {config.legend === "inside" && <Customized component={(p: { width?: number; height?: number }) => {
                  const list = visible;
                  if (!list.length) return <g />;
                  const pos = config.legendPos ?? { x: 0.72, y: 0.08 };
                  const x = (p.width ?? 800) * pos.x, y = (p.height ?? 460) * pos.y;
                  const w = Math.max(130, ...list.map(v => v.label.length * 7 + 48)), h = 16 + list.length * 21;
                  return <g transform={`translate(${x} ${y})`} style={{ cursor: "move", userSelect: "none" }}
                    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setDragLegend(true); }}
                    onClick={e => e.stopPropagation()}>
                    <rect width={w} height={h} rx={7} fill="#fff" fillOpacity={0.97} stroke="#cbd5e1" strokeWidth={1} />
                    {list.map((item, i) => <g key={item.uid} transform={`translate(12 ${19 + i * 21})`}>
                      <line x1={0} x2={20} y1={-4} y2={-4} stroke={item.color} strokeWidth={3} />
                      <text x={28} y={0} fontSize={12} fontWeight={600} fill="#172033">{item.label}</text>
                    </g>)}
                  </g>;
                }} />}
                <Customized component={(p: Pick<FreeLayerProps, "xAxisMap" | "yAxisMap" | "offset">) => <FreeLayer {...p} dates={rows.map(r => String(r.date))} items={config.annotations.filter((a): a is FreeAnnotation => a.kind === "farrow" || a.kind === "shape" || a.kind === "text")}
                  mode={mode} axis={freeAxis} preview={drag && sh.tool !== "text" ? { tool: sh.tool, ...drag, color: sh.color, width: sh.width, dash: sh.dash, fill: sh.fill } : null}
                  onPointer={onFreePointer} onGrab={onGrab} onEditText={onEditText} moving={!!move} axes={{ left: config.yAxis !== false, right: hasRight }} hlines={config.annotations.filter((a): a is Extract<Annotation, { kind: "hline" }> => a.kind === "hline")} ghost={ghost} onAxis={onAxis} onScaleReady={onScaleReady} />} />
              </ComposedChart></ResponsiveContainer>}
            {editing && <input className="cb-text-editor" autoFocus value={editing.text} placeholder="Escribe y presiona Enter"
              style={{ left: editing.x, top: editing.y, color: sh.color, fontSize: sh.size, fontWeight: sh.bold ? 700 : 400 }}
              onChange={e => setEditing(d => d && ({ ...d, text: e.target.value }))} onBlur={commitText}
              onKeyDown={e => { if (e.key === "Enter") commitText(); if (e.key === "Escape") setEditing(null); }} />}
          </div>
          {config.source && <p className="dash-note">{config.source}</p>}
        </section>

        <section className="cb-annotations-section" aria-label="Herramientas de anotación">
          <div className="cb-annotations-head"><h2>Anotaciones</h2><p>Personaliza tu gráfico con eventos, referencias y elementos visuales.</p></div>
          <div className="cb-annotations-grid">
            <section className="panel cb-block">
              <h2>Líneas verticales</h2>
              <p className="db-hint">Marca hechos relevantes con una línea vertical: selecciona un evento relevante o crea tu propia anotación.</p>
              {historicalEvents.length > 0 && <div className="cb-event-picker">
                <label className="cb-field">Eventos relevantes
                  <select value={eventId} onChange={e => setEventId(e.target.value)}>
                    <option value="">Selecciona un evento…</option>
                    {sortedHistoricalEvents.map(item => <option key={item.id} value={item.id}>{item.fecha.slice(8,10)}/{item.fecha.slice(5,7)}/{item.fecha.slice(0,4)} · {item.corto}</option>)}
                  </select>
                </label>
                {eventId && <p className="db-hint">{historicalEvents.find(item => item.id === eventId)?.descripcion}</p>}
                <div className="cb-inline"><button type="button" className="cb-btn" onClick={addHistoricalEvent}><Plus size={14} aria-hidden="true" />Agregar evento al gráfico</button><label>Tamaño letra <select value={eventFontSize} onChange={e => setEventFontSize(Number(e.target.value))}>{[10, 12, 14, 16, 18, 20, 24].map(n => <option key={n} value={n}>{n} px</option>)}</select></label><label>Posición <select value={eventLabelSide} onChange={e => setEventLabelSide(e.target.value as "left" | "right")}><option value="right">Derecha</option><option value="left">Izquierda</option></select></label></div>
              </div>}
              <div className="cb-series-grid">
                <label className="cb-wide">Texto<input value={ev.label} onChange={e => setEv(d => ({ ...d, label: e.target.value }))} placeholder="Ej.: RPM, estallido social, COVID…" /></label>
                <label>Marca<select value={ev.style} onChange={e => setEv(d => ({ ...d, style: e.target.value as "line" | "arrow" }))}><option value="line">Línea vertical</option><option value="arrow">Flecha al punto</option></select></label>
                <label>Color<input type="color" value={ev.color} onChange={e => setEv(d => ({ ...d, color: e.target.value }))} /></label>
                <label>Tipo de línea<select value={ev.dash} onChange={e => setEv(d => ({ ...d, dash: e.target.value as Dash }))}>{DASH_OPTIONS}</select></label>
                <label>Grosor<select value={ev.width} onChange={e => setEv(d => ({ ...d, width: Number(e.target.value) }))}>{WIDTH_OPTIONS}</select></label>
                {ev.style === "arrow" && <>
                  <label>Serie<select value={ev.seriesUid} onChange={e => setEv(d => ({ ...d, seriesUid: e.target.value }))}><option value="">Primera serie</option>{visible.map(s => <option key={s.uid} value={s.uid}>{s.label}</option>)}</select></label>
                  <label>Dirección<select value={ev.dir} onChange={e => setEv(d => ({ ...d, dir: e.target.value as "down" | "up" }))}><option value="down">Desde arriba ↓</option><option value="up">Desde abajo ↑</option></select></label>
                </>}
              </div>
              <button className={`cb-btn ${mode === "event" ? "cb-armed" : ""}`} onClick={() => setMode(m => m === "event" ? "none" : "event")}><MousePointerClick size={14} aria-hidden="true" />{mode === "event" ? "Haz clic en el gráfico…" : "Marcar con clic en el gráfico"}</button>
              {annotationList(a => a.kind === "vline" || a.kind === "arrow")}
            </section>

            <section className="panel cb-block">
              <h2>Líneas horizontales</h2>
              <p className="db-hint">Marca promedios, objetivos, máximos, mínimos u otros niveles de referencia para comparar las series.</p>
              <div className="cb-series-grid">
                <label className="cb-wide">Texto<input value={hl.label} onChange={e => setHl(d => ({ ...d, label: e.target.value }))} placeholder="Ej.: TPM, meta 3%, máximo…" /></label>
                <label>Texto a la<select value={hl.pos} onChange={e => setHl(d => ({ ...d, pos: e.target.value as "left" | "right" }))}><option value="left">Izquierda</option><option value="right">Derecha</option></select></label>
                <label>Eje<select value={hl.axis} onChange={e => setHl(d => ({ ...d, axis: e.target.value as Axis }))}><option value="left">Izquierdo</option><option value="right">Derecho</option></select></label>
                <label>Color línea<input type="color" value={hl.color} onChange={e => setHl(d => ({ ...d, color: e.target.value }))} /></label>
                <label>Color texto<input type="color" value={hl.textColor} onChange={e => setHl(d => ({ ...d, textColor: e.target.value }))} /></label>
                <label>Tipo de línea<select value={hl.dash} onChange={e => setHl(d => ({ ...d, dash: e.target.value as Dash }))}>{DASH_OPTIONS}</select></label>
                <label className="cb-check"><input type="checkbox" checked={hl.showValue} onChange={e => setHl(d => ({ ...d, showValue: e.target.checked }))} />Mostrar valor en el eje</label>
                <label>Grosor<select value={hl.width} onChange={e => setHl(d => ({ ...d, width: Number(e.target.value) }))}>{WIDTH_OPTIONS}</select></label>
              </div>
              <div className="cb-inline"><input value={hl.value} onChange={e => setHl(d => ({ ...d, value: e.target.value }))} placeholder="Nivel, ej. 4,5" aria-label="Nivel de la línea horizontal" onKeyDown={e => { if (e.key === "Enter") addHLineTyped(); }} /><button className="cb-btn" onClick={addHLineTyped}><Plus size={14} aria-hidden="true" />Agregar</button></div>
              <p className="db-hint">Mueve el cursor sobre el eje Y para previsualizar el nivel y haz clic para fijarlo. La guía desaparece al salir del eje.</p>
              {annotationList(a => a.kind === "hline")}
            </section>

            <section className="panel cb-block">
              <h2>Formas</h2>
              <p className="db-hint">Destaca zonas y movimientos con flechas, círculos, rectángulos o texto.</p>
              <div className="cb-tools">{([["arrow", "Flecha", MoveUpRight], ["ellipse", "Círculo", Circle], ["rect", "Cuadrado", Square], ["text", "Texto", Type]] as const).map(([k, l, Icon]) =>
                <button key={k} className={`cb-btn ${mode === "shape" && sh.tool === k ? "cb-armed" : ""}`} onClick={() => { setSh(d => ({ ...d, tool: k })); setMode(m => m === "shape" && sh.tool === k ? "none" : "shape"); }}><Icon size={14} aria-hidden="true" />{l}</button>)}</div>
              <div className="cb-series-grid">
                <label>Color<input type="color" value={sh.color} onChange={e => setSh(d => ({ ...d, color: e.target.value }))} /></label>
                {sh.tool === "text" ? <>
                  <label>Tamaño<select value={sh.size} onChange={e => setSh(d => ({ ...d, size: Number(e.target.value) }))}>{[11, 13, 16, 20, 24, 32].map(n => <option key={n} value={n}>{n} px</option>)}</select></label>
                  <label className="cb-check"><input type="checkbox" checked={sh.bold} onChange={e => setSh(d => ({ ...d, bold: e.target.checked }))} />Negrita</label>
                </> : <>
                  <label>Grosor<select value={sh.width} onChange={e => setSh(d => ({ ...d, width: Number(e.target.value) }))}>{WIDTH_OPTIONS}</select></label>
                  <label>Tipo de línea<select value={sh.dash} onChange={e => setSh(d => ({ ...d, dash: e.target.value as Dash }))}>{DASH_OPTIONS}</select></label>
                  {sh.tool !== "arrow" && <label className="cb-check"><input type="checkbox" checked={sh.fill} onChange={e => setSh(d => ({ ...d, fill: e.target.checked }))} />Relleno suave</label>}
                </>}
              </div>
              <p className="db-hint">{sh.tool === "text" ? "Elige Texto y haz clic en el gráfico: se abre un cuadro para escribir (Enter para confirmar). Doble clic sobre un texto para editarlo." : "Elige la forma y arrástrala sobre el gráfico."} Todo se puede mover arrastrándolo.</p>
              {annotationList(a => a.kind === "farrow" || a.kind === "shape" || a.kind === "text")}
            </section>

            <section className="panel cb-block">
              <h2>Otros</h2>
              <p className="db-hint">Controla la visualización de los ejes, las cuadrículas y los últimos valores.</p>
              <div className="cb-series-grid">
                <label className="cb-wide">Posición de la leyenda<select value={config.legend} onChange={e => set({ legend: e.target.value as Config["legend"] })}><option value="bottom">Abajo</option><option value="top">Arriba</option><option value="right">Derecha</option><option value="inside">Dentro del gráfico (movible)</option><option value="none">Oculta</option></select></label>
                {config.legend === "inside" && <p className="db-hint cb-wide">Arrastra el recuadro blanco sobre el gráfico para mover la leyenda. Se guarda su posición.</p>}
                <label className="cb-check"><input type="checkbox" checked={config.yAxis !== false} onChange={e => set({ yAxis: e.target.checked })} />Eje vertical</label>
                <label className="cb-check"><input type="checkbox" checked={config.grid} onChange={e => set({ grid: e.target.checked })} />Grilla horizontal</label>
                <label className="cb-check"><input type="checkbox" checked={!!config.gridV} onChange={e => set({ gridV: e.target.checked })} />Grilla vertical</label>
                <label className="cb-check"><input type="checkbox" checked={!!config.lastValue} onChange={e => set({ lastValue: e.target.checked })} />Último dato al final</label>
                <label className="cb-check"><input type="checkbox" checked={!!config.showXAxisTitle} onChange={e => set({ showXAxisTitle: e.target.checked })} />Título eje X</label>
                {config.showXAxisTitle && <label className="cb-wide">Texto del eje X<input value={config.xAxisTitle ?? "Fecha"} onChange={e => set({ xAxisTitle: e.target.value })} placeholder="Fecha" /></label>}
                <label className="cb-check"><input type="checkbox" checked={!!config.showYAxisTitle} onChange={e => set({ showYAxisTitle: e.target.checked })} />Título eje Y</label>
                {config.showYAxisTitle && <label className="cb-wide">Texto del eje Y<input value={config.yAxisTitle ?? "Tasa (%)"} onChange={e => set({ yAxisTitle: e.target.value })} placeholder="Tasa (%)" /></label>}
              </div>
            </section>

          </div>
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

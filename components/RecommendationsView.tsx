"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { AppShell } from "./AppShell";
import type { IdeaWithLive, Recommendations } from "@/lib/recommendations.server";

const fmt = (v: number, d = 1) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const sgn = (v: number, d = 1) => { const r = Number(v.toFixed(d)); return `${r > 0 ? "+" : r < 0 ? "−" : ""}${fmt(Math.abs(r), d)}`; };
const day = (d: string) => new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const level = (idea: IdeaWithLive, v: number) => idea.metrica.unidad === "%" ? `${fmt(v, 3)}%` : `${fmt(v, 1)} pb`;
const ORDER = { Alta: 0, Media: 1, Baja: 2 } as const;

function Spark({ values, entry, target, stop }: { values: number[]; entry: number; target: number; stop: number }) {
  if (values.length < 2) return null;
  const w = 220, h = 54, all = [...values, entry, target, stop];
  const min = Math.min(...all), max = Math.max(...all), span = max - min || 1;
  const y = (v: number) => (h - 4 - (v - min) / span * (h - 8)).toFixed(1);
  const pts = values.map((v, i) => `${(i / (values.length - 1) * (w - 4) + 2).toFixed(1)},${y(v)}`).join(" ");
  return <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" className="rec-spark">
    <line x1="0" x2={w} y1={y(target)} y2={y(target)} stroke="#2f6fed" strokeDasharray="3 3" strokeWidth="1" />
    <line x1="0" x2={w} y1={y(stop)} y2={y(stop)} stroke="#d94b4b" strokeDasharray="3 3" strokeWidth="1" />
    <line x1="0" x2={w} y1={y(entry)} y2={y(entry)} stroke="#94a3b8" strokeWidth="1" />
    <polyline points={pts} fill="none" stroke="#172033" strokeWidth="1.5" />
  </svg>;
}

function IdeaCard({ idea }: { idea: IdeaWithLive }) {
  // Color según el resultado redondeado, para que un 0,0 por error de punto flotante no salga rojo.
  const shown = idea.resultado == null ? null : Number(idea.resultado.toFixed(1));
  const tone = shown == null ? "" : shown > 0 ? "rec-good" : shown < 0 ? "rec-bad" : "";
  const unit = idea.metrica.unidad === "%" ? "pb" : "pb";
  return <article className="panel rec-card">
    <div className="rec-card-head">
      <span className="rec-type">{idea.tipo}</span>
      <span className={`rec-conv rec-conv-${idea.conviccion.toLowerCase()}`}>Convicción {idea.conviccion.toLowerCase()}</span>
    </div>
    <h2>{idea.titulo}</h2>
    <ul className="rec-legs">{idea.operacion.map(o => <li key={o}>{o}</li>)}</ul>
    <div className="rec-levels">
      <div><span>Entrada</span><strong>{level(idea, idea.entrada)}</strong></div>
      <div><span>Objetivo</span><strong className="rec-target">{level(idea, idea.objetivo)}</strong></div>
      <div><span>Stop</span><strong className="rec-stop">{level(idea, idea.stop)}</strong></div>
      <div><span>Horizonte</span><strong>{idea.horizonte}</strong></div>
    </div>
    <div className="rec-live">
      <div className="rec-live-text">
        <span>{idea.metrica.nombre} · gana si {idea.metrica.ganaSi}</span>
        <strong>{idea.actual == null ? "—" : level(idea, idea.actual)}</strong>
        <em className={tone}>{idea.resultado == null ? "Sin datos" : `${sgn(idea.resultado)} ${unit} desde la entrada`}{idea.actualFecha ? ` · ${day(idea.actualFecha)}` : ""}</em>
      </div>
      <Spark values={idea.spark} entry={idea.entrada} target={idea.objetivo} stop={idea.stop} />
    </div>
    <div className="rec-cols">
      <div><h3>Por qué</h3><ul>{idea.fundamentos.map(f => <li key={f}>{f}</li>)}</ul></div>
      <div><h3>Riesgos</h3><ul>{idea.riesgos.map(f => <li key={f}>{f}</li>)}</ul></div>
    </div>
  </article>;
}

function Report({ data }: { data: Recommendations }) {
  const [filter, setFilter] = useState<"Todas" | "Alta" | "Media" | "Baja">("Todas");
  const ideas = [...data.ideas].sort((a, b) => ORDER[a.conviccion] - ORDER[b.conviccion]).filter(i => filter === "Todas" || i.conviccion === filter);
  return <div className="model-content">
    <section className="panel rec-summary">
      <div className="panel-head"><h2>Lectura de mercado</h2><span className="pill">Datos: {data.datosAl}</span></div>
      <ul>{data.resumen.map(r => <li key={r}>{r}</li>)}</ul>
    </section>
    <div className="rec-toolbar">
      <span>{ideas.length} ideas</span>
      <div className="segmented" role="group" aria-label="Convicción">
        {(["Todas", "Alta", "Media", "Baja"] as const).map(k => <button key={k} className={filter === k ? "selected" : ""} aria-pressed={filter === k} onClick={() => setFilter(k)}>{k}</button>)}
      </div>
    </div>
    <div className="rec-grid">{ideas.map(i => <IdeaCard key={i.id} idea={i} />)}</div>
    {!ideas.length && <p className="dash-note">No hay ideas con convicción {filter.toLowerCase()}.</p>}
    <div className="model-notice"><strong>Advertencia.</strong><p>{data.advertencia}</p></div>
  </div>;
}

export function RecommendationsView({ reports }: { reports: Recommendations[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return <AppShell>
    <header className="page-head">
      <div><div className="eyebrow">Trading Propietario</div><h1>Recomendaciones</h1><p>Ideas de trading en renta fija local a partir de los datos del sitio.</p></div>
      {reports[0] && <div className="asof"><span>Último informe</span><strong>{day(reports[0].fecha)}</strong></div>}
    </header>
    {/* Un desplegable por informe, del más nuevo al más antiguo; los niveles actuales se recalculan para todos. */}
    {reports.map(r => <details key={r.fecha} className="panel model-disclosure" onToggle={e => { const isOpen = e.currentTarget.open; setOpen(o => ({ ...o, [r.fecha]: isOpen })); }}>
      <summary><span>{day(r.fecha)}</span><ChevronDown size={20} aria-hidden="true" /></summary>
      {open[r.fecha] && <Report data={r} />}
    </details>)}
    {!reports.length && <p className="dash-note">Aún no hay informes.</p>}
  </AppShell>;
}

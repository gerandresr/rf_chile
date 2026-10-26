import { readFileSync, readdirSync } from "fs";
import path from "path";

/** Informes de ideas de trading (content/recomendaciones/AAAA-MM-DD.json) con su métrica recalculada con los últimos datos. */
type Term = { id: string; w: number };
export type Idea = {
  id: string; titulo: string; tipo: string; conviccion: "Alta" | "Media" | "Baja";
  operacion: string[]; fundamentos: string[]; riesgos: string[];
  metrica: { nombre: string; terminos: Term[]; unidad: "pb" | "%"; ganaSi: "sube" | "baja" };
  entrada: number; objetivo: number; stop: number; horizonte: string;
};
export type IdeaWithLive = Idea & { actual: number | null; actualFecha: string | null; resultado: number | null; spark: number[] };
export type Recommendations = { fecha: string; datosAl: string; resumen: string[]; advertencia: string; ideas: IdeaWithLive[] };

const DATA = path.join(process.cwd(), "public", "data");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
function load(id: string): Map<string, number> {
  const out = new Map<string, number>();
  if (id.startsWith("bbg:")) {
    const key = id.slice(4), s = readJson(path.join(DATA, "historico_bloomberg", `${key}.json`))[key] as { fecha: string[]; valor: (number | null)[] };
    s.fecha.forEach((d, i) => { const v = s.valor[i]; if (typeof v === "number") out.set(d, v); });
  } else {
    const s = readJson(path.join(DATA, "historico_riskamerica", `${id}.json`))[id] as { fecha: string[]; tir: (number | null)[] };
    s.fecha.forEach((d, i) => { const v = s.tir[i]; if (typeof v === "number") out.set(d, v); });
  }
  return out;
}

const DIR = path.join(process.cwd(), "content", "recomendaciones");

/** Todos los informes, del más nuevo al más antiguo. */
export function recommendationReports(): Recommendations[] {
  const cache = new Map<string, Map<string, number>>();
  return readdirSync(DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse()
    .map(f => report(readJson(path.join(DIR, f)) as Omit<Recommendations, "ideas"> & { ideas: Idea[] }, cache));
}

function report(raw: Omit<Recommendations, "ideas"> & { ideas: Idea[] }, cache: Map<string, Map<string, number>>): Recommendations {
  const series = (id: string) => { if (!cache.has(id)) { try { cache.set(id, load(id)); } catch { cache.set(id, new Map()); } } return cache.get(id)!; };
  const ideas = raw.ideas.map(idea => {
    const maps = idea.metrica.terminos.map(t => series(t.id));
    // Fechas en que todas las patas tienen dato (desde 3 meses antes de la idea, para el mini-gráfico).
    const from = new Date(`${raw.fecha}T00:00:00Z`); from.setUTCMonth(from.getUTCMonth() - 3);
    const dates = [...maps[0].keys()].filter(d => d >= from.toISOString().slice(0, 10) && maps.every(m => m.has(d))).sort();
    const value = (d: string) => {
      const v = idea.metrica.terminos.reduce((s, t, i) => s + t.w * maps[i].get(d)!, 0);
      return idea.metrica.unidad === "pb" ? v * 100 : v;
    };
    const spark = dates.map(value);
    const last = dates[dates.length - 1] ?? null;
    const actual = last ? value(last) : null;
    const sign = idea.metrica.ganaSi === "baja" ? -1 : 1;
    const scale = idea.metrica.unidad === "%" ? 100 : 1;
    return { ...idea, actual, actualFecha: last, spark, resultado: actual === null ? null : sign * (actual - idea.entrada) * scale };
  });
  return { ...raw, ideas };
}

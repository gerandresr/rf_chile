import { readFileSync } from "fs";
import path from "path";
import { buildQuarters, estimatePhillipsNairu, type PhillipsResult } from "./nairu-phillips";

// Se estima al construir el sitio (datos del Banco Central y swaps de Bloomberg).
const DATA = path.join(process.cwd(), "public", "data");
const readJson = (rel: string) => JSON.parse(readFileSync(path.join(DATA, rel), "utf8").replace(/^﻿/, ""));
function bloomberg(key: string) {
  const s = readJson(`historico_bloomberg/${key}.json`)[key] as { fecha: string[]; valor: (number | null)[] };
  return new Map(s.fecha.map((f, i) => [f, s.valor[i]] as const).filter((e): e is [string, number] => typeof e[1] === "number"));
}

export type PhillipsModelData = PhillipsResult | { error: string };

export function phillipsNairuData(): PhillipsModelData {
  try {
    const clp = bloomberg("clpcam_1y"), uf = bloomberg("ufcam_1y");
    const bei = new Map([...clp].filter(([d]) => uf.has(d)).map(([d, v]) => [d, v - uf.get(d)!] as [string, number]));
    const rows = buildQuarters(readJson("historico_bcentral/datos-mensuales.json"), bei, bloomberg("usdclp"));
    return estimatePhillipsNairu(rows);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No fue posible estimar la NAIRU." };
  }
}

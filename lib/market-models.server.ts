import { readFileSync, readdirSync } from "fs";
import path from "path";
import { impliedTpmPath, estimateSpreadBp, forwardHistory, type TpmPathResult, type ForwardHistory, type SwapQuote } from "./tpm-path";
import { carryRolldown, maturityFromCode, type BondInput } from "./carry";
import { fairValue, type FvBond, type FvResult } from "./nss";

// Lectura en el servidor (al construir el sitio). Los archivos de Bloomberg vienen con BOM.
const DATA = path.join(process.cwd(), "public", "data");
const readJson = (relative: string) => JSON.parse(readFileSync(path.join(DATA, relative), "utf8").replace(/^﻿/, ""));
function bloomberg(key: string) {
  const series = readJson(`historico_bloomberg/${key}.json`)[key] as { fecha: string[]; valor: (number | null)[] };
  return new Map(series.fecha.map((f, i) => [f, series.valor[i]] as const).filter((e): e is [string, number] => typeof e[1] === "number"));
}
function tpmSeries() {
  const rows = (readJson("historico_bcentral/datos-diarios.json") as { fecha: string; tpm: number | null }[])
    .filter(r => typeof r.tpm === "number").sort((a, b) => a.fecha.localeCompare(b.fecha));
  const dates = rows.map(r => r.fecha), values = rows.map(r => r.tpm as number);
  const on = (d: string) => {
    if (d > dates[dates.length - 1]) return null;
    let lo = 0, hi = dates.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans < 0 ? null : values[ans];
  };
  return { on, last: dates[dates.length - 1], current: values[values.length - 1] };
}
const SWAP_TENORS: [string, number][] = [["clpcam_1m", 1], ["clpcam_2m", 2], ["clpcam_3m", 3], ["clpcam_6m", 6], ["clpcam_9m", 9], ["clpcam_1y", 12]];
const tenorMonths = (t: string) => (t.endsWith("m") ? Number(t.slice(0, -1)) : Number(t.slice(0, -1)) * 12);

export type TpmModelData = { path: TpmPathResult; source: string; history: ForwardHistory[]; spreadObservations: number } | { error: string };

export function tpmModelData(): TpmModelData {
  try {
    const tpm = tpmSeries();
    const swaps = Object.fromEntries(SWAP_TENORS.map(([k]) => [k, bloomberg(k)]));
    const { spreadBp, observations } = estimateSpreadBp(swaps.clpcam_1m, tpm.on);
    const meetings = (readJson("tpm-meetings.json") as { dates: string[] }).dates;
    // Fuente más reciente: Bloomberg (1m–1a, con historia) o el cierre ICAP (incluye 18 meses).
    const bbDate = [...swaps.clpcam_1y.keys()].sort().at(-1)!;
    const icap = readJson("Closing_Icap/swap_clp.json") as { fecha: string; datos: { Tenor: string; Mid: number }[] };
    const useIcap = icap.fecha >= bbDate;
    const valuationDate = useIcap ? icap.fecha : bbDate;
    const quotes: SwapQuote[] = useIcap
      ? icap.datos.map(d => ({ months: tenorMonths(d.Tenor), rate: d.Mid }))
      : SWAP_TENORS.map(([k, m]) => ({ months: m, rate: swaps[k].get(bbDate)! }));
    const path = impliedTpmPath({ valuationDate, quotes, meetings, currentTpm: tpm.current, spreadBp });
    const history = [
      forwardHistory({ label: "Próximos 3 meses", near: null, nearMonths: 0, far: swaps.clpcam_3m, farMonths: 3, tpmOn: tpm.on, lastTpmDate: tpm.last, spreadBp }),
      forwardHistory({ label: "Entre 3 y 6 meses", near: swaps.clpcam_3m, nearMonths: 3, far: swaps.clpcam_6m, farMonths: 6, tpmOn: tpm.on, lastTpmDate: tpm.last, spreadBp }),
      forwardHistory({ label: "Entre 6 y 12 meses", near: swaps.clpcam_6m, nearMonths: 6, far: swaps.clpcam_1y, farMonths: 12, tpmOn: tpm.on, lastTpmDate: tpm.last, spreadBp }),
    ];
    return { path, source: useIcap ? `Cierre Mercado ${icap.fecha}` : `Swaps Cámara Bloomberg ${bbDate}`, history, spreadObservations: observations };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No fue posible calcular la trayectoria de TPM." };
  }
}

export type CarryModelData = { results: ReturnType<typeof carryRolldown>[] } | { error: string };

export function carryModelData(): CarryModelData {
  try {
    const dir = path.join(DATA, "historico_riskamerica");
    const bonds: BondInput[] = [];
    let date = "";
    for (const file of readdirSync(dir).filter(f => /^BT[PU]\d{7}\.json$/.test(f))) {
      const code = file.slice(0, -5);
      const s = readJson(`historico_riskamerica/${file}`)[code] as { fecha: string[]; tir: (number | null)[]; duracion: (number | null)[] };
      const i = s.fecha.length - 1, maturity = maturityFromCode(code);
      if (!maturity || typeof s.tir[i] !== "number" || typeof s.duracion[i] !== "number") continue;
      const changes: number[] = [];
      for (let k = 1; k < s.tir.length; k++) { const a = s.tir[k - 1], b = s.tir[k]; if (typeof a === "number" && typeof b === "number") changes.push((b - a) * 100); }
      if (s.fecha[i] > date) date = s.fecha[i];
      bonds.push({ code, type: code.slice(0, 3) as "BTP" | "BTU", maturity, yield: s.tir[i] as number, macaulay: s.duracion[i] as number, dailyChangesBp: changes, lastDate: s.fecha[i] } as BondInput & { lastDate: string });
    }
    // Solo bonos con dato en la última fecha disponible.
    const current = bonds.filter(b => (b as BondInput & { lastDate: string }).lastDate === date);
    // IPC mensual observado + esperado (forwards ICAP: cada contrato corresponde al IPC de dos meses antes).
    const monthly = readJson("historico_bcentral/datos-mensuales.json") as { fecha: string; ipc_mom: number | null }[];
    const ipc = new Map(monthly.filter(r => typeof r.ipc_mom === "number").map(r => [r.fecha, r.ipc_mom as number]));
    const icap = readJson("Closing_Icap/inflacion.json") as { datos: { Tenor: number; IPC: number | null }[] };
    for (const r of icap.datos) {
      const d = new Date(r.Tenor);
      const month = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 2, 1)).toISOString().slice(0, 10);
      if (!ipc.has(month) && typeof r.IPC === "number") ipc.set(month, r.IPC);
    }
    // Financiamiento a plazo: swap Cámara del mismo plazo (último dato).
    const funding: Record<number, string> = { 1: "clpcam_1m", 3: "clpcam_3m", 6: "clpcam_6m" };
    const results = [1, 3, 6].map(h => {
      const series = bloomberg(funding[h]);
      const last = [...series.keys()].filter(d => d <= date).sort().at(-1)!;
      return carryRolldown({ date, horizonMonths: h, bonds: current, fundingRate: series.get(last)!, ipcByMonth: ipc });
    });
    return { results };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No fue posible calcular el carry." };
  }
}

export type FairValueModelData = FvResult | { error: string };

/** Curva NSS diaria BTP/BTU, valor relativo por bono y breakevens (≈2 años de historia). */
export function fairValueModelData(): FairValueModelData {
  try {
    const dir = path.join(DATA, "historico_riskamerica");
    const bonds: FvBond[] = [];
    for (const file of readdirSync(dir).filter(f => /^BT[PU]\d{7}\.json$/.test(f))) {
      const code = file.slice(0, -5), maturity = maturityFromCode(code);
      if (!maturity) continue;
      const s = readJson(`historico_riskamerica/${file}`)[code] as { fecha: string[]; tir: (number | null)[] };
      bonds.push({ code, type: code.slice(0, 3) as "BTP" | "BTU", maturity, dates: s.fecha, tir: s.tir });
    }
    return fairValue(bonds);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No fue posible ajustar las curvas." };
  }
}

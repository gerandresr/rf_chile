"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { AppShell } from "./AppShell";
import { TPMMeetings } from "./TPMMeetings";
import monthlyMacroData from "@/public/data/datos-mensuales.json";
import dailyMacroData from "@/public/data/datos-diarios.json";
import { dailyTpmKpi, monthlyMacroKpi } from "@/lib/macro";
import {
  RFData,
  Instrument,
  formatBp,
  formatPercent,
  instrumentSnapshot,
  isActiveInstrument,
  maturityLabel,
} from "@/lib/rf";

function Change({ value }: { value: number | null }) {
  if (value == null) return <span className="muted">—</span>;
  return (
    <span className={value < 0 ? "good" : value > 0 ? "bad" : "muted"}>
      {formatBp(value)} bp
    </span>
  );
}

function formatDuration(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function carry1d(yieldPct: number | null | undefined, tpmPct: number | null, duration: number | null | undefined, ipcMomPct = 0, ipcWindowDays: number | null = null) {
  if (yieldPct == null || tpmPct == null || duration == null || !Number.isFinite(duration) || duration === 0) return null;
  const baseCarry = (((yieldPct / 100) / 365 - (tpmPct / 100) / 360) / duration) * 10000;
  if (!ipcWindowDays || ipcWindowDays <= 0) return baseCarry;
  const ipcCarry = ((ipcMomPct / ipcWindowDays) / duration) * 100;
  return baseCarry + ipcCarry;
}

function activeIpcMom(marketDate: string) {
  const market = new Date(marketDate + "T00:00:00");
  if (Number.isNaN(market.getTime())) return { value: 0, days: null as number | null };
  const start = new Date(market.getFullYear(), market.getMonth() - (market.getDate() < 10 ? 1 : 0), 10);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 9);
  const ipcMonth = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  const key = `${ipcMonth.getFullYear()}-${String(ipcMonth.getMonth() + 1).padStart(2, "0")}-01`;
  const row = monthlyMacroData.find((item) => item.fecha === key && typeof item.ipc_mom === "number");
  const days = Math.round((end.getTime() - start.getTime()) / 86400000);
  return { value: row?.ipc_mom ?? 0, days };
}
function formatCarry(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " bp";
}
function Carry({ value }: { value: number | null }) {
  if (value == null || !Number.isFinite(value)) return <span className="muted">—</span>;
  return <span className={value > 0 ? "good" : value < 0 ? "bad" : "muted"}>{formatCarry(value)}</span>;
}
function MarketDelta({ value }: { value: number | null }) {
  if (value == null) return <span className="muted">—</span>;
  return <span className={value < 0 ? "good" : value > 0 ? "bad" : "muted"}>{formatBp(value, 0)} bp</span>;
}
function ASWValue({ value }: { value: number | null }) {
  if (value == null) return <span className="muted">—</span>;
  return <span className={value > 0 ? "good" : value < 0 ? "bad" : "muted"}>{formatBp(value, 0)} bp</span>;
}
function interpolatedSwapYield(duration: number | null | undefined, swaps: SwapRow[]) {
  if (duration == null || !Number.isFinite(duration)) return null;
  const curve = swaps.filter((s) => Number.isFinite(s.duration) && Number.isFinite(s.value)).sort((a,b)=>a.duration-b.duration);
  if (!curve.length || duration < curve[0].duration || duration > curve[curve.length-1].duration) return null;
  const exact = curve.find((s)=>Math.abs(s.duration-duration)<1e-9);
  if (exact) return exact.value;
  for (let i=1;i<curve.length;i++) {
    const left=curve[i-1], right=curve[i];
    if (duration <= right.duration) {
      const weight=(duration-left.duration)/(right.duration-left.duration);
      return left.value + weight*(right.value-left.value);
    }
  }
  return null;
}


function interpolatedSwapYieldByMaturity(inst: Instrument, marketDate: string, swaps: SwapRow[]) {
  const market = new Date(marketDate + "T00:00:00");
  if (Number.isNaN(market.getTime())) return null;
  const bondMaturity = new Date(inst.maturityYear, inst.maturityMonth - 1, 1);
  const targetYears = (bondMaturity.getTime() - market.getTime()) / (365.25 * 86400000);
  if (targetYears < 0) return null;
  const curve = swaps.filter(s => Number.isFinite(s.tenorYears) && Number.isFinite(s.value)).sort((a,b)=>a.tenorYears-b.tenorYears);
  if (!curve.length || targetYears < curve[0].tenorYears || targetYears > curve[curve.length-1].tenorYears) return null;
  const exact = curve.find(s => Math.abs(s.tenorYears-targetYears)<1e-9);
  if (exact) return exact.value;
  for (let i=1;i<curve.length;i++) {
    const left=curve[i-1], right=curve[i];
    if (targetYears <= right.tenorYears) {
      const weight=(targetYears-left.tenorYears)/(right.tenorYears-left.tenorYears);
      return left.value + weight*(right.value-left.value);
    }
  }
  return null;
}

function MarketTable({ title, instruments, data, tpm, swaps = [] }: { title: string; instruments: Instrument[]; data: RFData; tpm: number | null; swaps?: SwapRow[] }) {
  const ipc = activeIpcMom(data.lastMarketDate);
  return (
    <section className="panel market-table-panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">Curva nominal / real</div>
          <h2>{title}</h2>
        </div>
        <span className="pill">{instruments.length} vigentes</span>
      </div>
      <div className="table-wrap" role="region" aria-label={`Tabla ${title}`} tabIndex={0}>
        <table className="market-table">
          <thead><tr><th>Instrumento</th><th>Dur.</th><th>Yield</th>{swaps.length > 0 && <><th>ASW Dur.</th><th>ASW Venc.</th></>}<th>Carry 1d</th><th>Delta 1d</th><th>MTD</th><th>YTD</th></tr></thead>
          <tbody>
            {instruments.map((inst) => {
              const s = instrumentSnapshot(data, inst.code);
              const swapYield = swaps.length ? interpolatedSwapYield(inst.duration, swaps) : null;
              const aswDur = s?.value != null && swapYield != null ? (s.value - swapYield) * 100 : null;
              const swapYieldMaturity = swaps.length ? interpolatedSwapYieldByMaturity(inst, data.lastMarketDate, swaps) : null;
              const aswMaturity = s?.value != null && swapYieldMaturity != null ? (s.value - swapYieldMaturity) * 100 : null;
              return (
                <tr key={inst.code}>
                  <td><strong>{inst.code}</strong><div className="subcell">Cupón {inst.coupon?.toFixed(1) ?? "—"}%</div></td>
                  <td className="num">{formatDuration(inst.duration)}</td>
                  <td className="num strong">{formatPercent(s?.value, 2)}</td>
                  {swaps.length > 0 && <><td className="num"><ASWValue value={aswDur} /></td><td className="num"><ASWValue value={aswMaturity} /></td></>}
                  <td className="num"><Carry value={carry1d(s?.value, tpm, inst.duration, inst.type === "BTU" ? ipc.value : 0, inst.type === "BTU" ? ipc.days : null)} /></td>
                  <td className="num"><MarketDelta value={s?.d1 ?? null} /></td>
                  <td className="num"><MarketDelta value={s?.mtd ?? null} /></td>
                  <td className="num"><MarketDelta value={s?.ytd ?? null} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type DPFInstrument = { code: string; days: number; value: number; d1: number; mtd: number; ytd: number };
type DPFHistorySeries = { code: string; days: number; rows: { date: string; value: number }[] };
type DPFData = { lastMarketDate: string; rateConvention?: "monthly"; annualization: string; instruments: DPFInstrument[]; history: DPFHistorySeries[] };

async function loadDPFData(): Promise<DPFData> {
  const days = [7, 30, 90, 180, 270, 360];
  const series = await Promise.all(days.map(async (day) => {
    const code = `DPF_${day}`;
    const response = await fetch(`/data/historico_riskamerica/${code}.json`);
    if (!response.ok) return null;
    const json = await response.json();
    const item = json[code] as { fecha?: string[]; tir?: number[] } | undefined;
    if (!item?.fecha?.length || !item.tir?.length) return null;
    const rows = item.fecha.map((date, index) => ({ date, value: item.tir?.[index] })).filter((row): row is { date: string; value: number } => typeof row.value === "number" && Number.isFinite(row.value));
    return { code, days: day, rows };
  }));
  const valid = series.filter((item): item is NonNullable<typeof item> => item != null && item.rows.length > 0);
  const lastMarketDate = valid.flatMap((item) => item.rows.map((row) => row.date)).sort().at(-1) ?? "";
  const instruments = valid.map(({ code, days, rows }) => {
    const currentIndex = rows.findLastIndex((row) => row.date <= lastMarketDate);
    const current = rows[currentIndex];
    if (!current) return null;
    const previous = currentIndex > 0 ? rows[currentIndex - 1] : null;
    const d = new Date(current.date + "T00:00:00");
    const monthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const yearStart = `${d.getFullYear()}-01-01`;
    const baseFor = (start: string) => {
      const before = [...rows].reverse().find((row) => row.date < start);
      return before ?? rows.find((row) => row.date >= start) ?? null;
    };
    const mtdBase = baseFor(monthStart);
    const ytdBase = baseFor(yearStart);
    return {
      code, days, value: current.value,
      d1: previous ? (current.value - previous.value) * 100 : 0,
      mtd: mtdBase ? (current.value - mtdBase.value) * 100 : 0,
      ytd: ytdBase ? (current.value - ytdBase.value) * 100 : 0,
    };
  }).filter((item): item is DPFInstrument => item != null);
  return { lastMarketDate, rateConvention: "monthly", annualization: "monthly_rate_x12", instruments, history: valid };
}
type SwapRow = { code: string; label: string; tenorYears: number; duration: number; value: number; d1m: number | null; mtd: number | null; ytd: number | null };

const CLPCAM_TENORS = [
  { code: "clpcam_1m", label: "1mo", years: 1 / 12 },
  { code: "clpcam_3m", label: "3mo", years: 3 / 12 },
  { code: "clpcam_6m", label: "6mo", years: 6 / 12 },
  { code: "clpcam_9m", label: "9mo", years: 9 / 12 },
  { code: "clpcam_1y", label: "1yr", years: 1 },
  { code: "clpcam_2y", label: "2yr", years: 2 },
  { code: "clpcam_5y", label: "5yr", years: 5 },
  { code: "clpcam_7y", label: "7yr", years: 7 },
  { code: "clpcam_10y", label: "10yr", years: 10 },
];

function approxSwapDuration(years: number, yieldPct: number) {
  if (years <= 1) return years / (1 + yieldPct / 100);
  const frequency = 2;
  const n = Math.max(1, Math.round(years * frequency));
  const coupon = yieldPct / 100 / frequency;
  const periodYield = yieldPct / 100 / frequency;
  let price = 0, weighted = 0;
  for (let i = 1; i <= n; i++) {
    const cashFlow = coupon + (i === n ? 1 : 0);
    const pv = cashFlow / Math.pow(1 + periodYield, i);
    price += pv;
    weighted += (i / frequency) * pv;
  }
  const macaulay = weighted / price;
  return macaulay / (1 + periodYield);
}

async function loadCLPCamData(): Promise<SwapRow[]> {
  const series = await Promise.all(CLPCAM_TENORS.map(async (tenor) => {
    const response = await fetch(`/data/historico_bloomberg/${tenor.code}.json`);
    if (!response.ok) return null;
    const json = await response.json();
    const item = json[tenor.code] as { fecha?: string[]; valor?: number[] } | undefined;
    if (!item?.fecha?.length || !item.valor?.length) return null;
    const rows = item.fecha.map((date, index) => ({ date, value: item.valor?.[index] })).filter((row): row is { date: string; value: number } => typeof row.value === "number" && Number.isFinite(row.value)).sort((a,b)=>a.date.localeCompare(b.date));
    const current = rows.at(-1); if (!current) return null;
    const d = new Date(current.date + "T00:00:00");
    const monthStart = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;
    const yearStart = `${d.getFullYear()}-01-01`;
    const oneMonthAgo = new Date(d); oneMonthAgo.setMonth(oneMonthAgo.getMonth()-1);
    const oneMonthKey = oneMonthAgo.toISOString().slice(0,10);
    const base = (date:string) => [...rows].reverse().find(r=>r.date<=date) ?? rows.find(r=>r.date>=date) ?? null;
    const change = (b:{value:number}|null) => b ? (current.value-b.value)*100 : null;
    return { code: tenor.code, label: tenor.label, tenorYears: tenor.years, duration: approxSwapDuration(tenor.years,current.value), value: current.value, d1m: change(base(oneMonthKey)), mtd: change(base(monthStart)), ytd: change(base(yearStart)) };
  }));
  return series.filter((row): row is SwapRow => row != null);
}

function SwapCLPTable({ rows }: { rows: SwapRow[] }) {
  return <section className="panel market-table-panel"><div className="panel-head"><div><div className="eyebrow">Curva swap CLP</div><h2>Swap Promedio Cámara CLP</h2></div><span className="pill">{rows.length} plazos</span></div>
    <div className="table-wrap" role="region" aria-label="Tabla Swap Promedio Cámara CLP" tabIndex={0}><table className="market-table"><thead><tr><th>Instrumento</th><th>Duración app</th><th>Yield</th><th>Δ 1M</th><th>MTD</th><th>YTD</th></tr></thead><tbody>
    {rows.map(row=><tr key={row.code}><td><strong>{row.label}</strong></td><td className="num">{formatDuration(row.duration)}</td><td className="num strong">{formatPercent(row.value,2)}</td><td className="num"><MarketDelta value={row.d1m}/></td><td className="num"><MarketDelta value={row.mtd}/></td><td className="num"><MarketDelta value={row.ytd}/></td></tr>)}
    </tbody></table></div></section>;
}

type DPFRateView = "monthly" | "annual";

function DPFTable({ data }: { data: DPFData }) {
  return (
    <section className="panel market-table-panel">
      <div className="panel-head">
        <div><div className="eyebrow">Curva DPF CLP</div><h2>Depósitos a Plazo Fijo en CLP</h2></div>
        <span className="pill">{data.instruments.length} plazos</span>
      </div>
      <div className="table-wrap" role="region" aria-label="Tabla Depósitos a Plazo Fijo en CLP" tabIndex={0}>
        <table className="market-table">
          <thead><tr><th>Plazo</th><th>Tasa mensual</th><th>Δ Día</th><th>MTD</th><th>YTD</th></tr></thead>
          <tbody>
            {data.instruments.map((item) => (
              <tr key={item.code}>
                <td><strong>{item.days} días</strong><div className="subcell">{item.code}</div></td>
                <td className="num strong">{formatPercent(item.value, 3)}</td>
                <td className="num"><Change value={item.d1} /></td>
                <td className="num"><Change value={item.mtd} /></td>
                <td className="num"><Change value={item.ytd} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const latestTpm = [...dailyMacroData].reverse().find((row) => typeof row.tpm === "number")?.tpm ?? null;

const macroKpis = [
  dailyTpmKpi(dailyMacroData),
  monthlyMacroKpi(monthlyMacroData, "ipc_yoy", "Inflación Anual"),
  monthlyMacroKpi(monthlyMacroData, "ipc_mom", "IPC MoM"),
  monthlyMacroKpi(monthlyMacroData, "ipcsae_mom", "IPC SAE MoM"),
  monthlyMacroKpi(monthlyMacroData, "imacec", "IMACEC"),
  monthlyMacroKpi(monthlyMacroData, "desempleo", "Desempleo"),
];

type CurveType = "BTP" | "BTU" | "DPF";
type CurvePoint = { term: number; yield: number | null; code: string; name: string };
type NelsonSiegelFit = { beta0: number; beta1: number; beta2: number; tau: number };
type BenchmarkRow = { benchmark: string; yield: number | null; d1: number | null; mtd: number | null; ytd: number | null };
type BenchmarkMode = "maturity" | "duration";

function yearsToMaturity(inst: Instrument, marketDate: string) {
  const d = new Date(`${marketDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const maturity = new Date(inst.maturityYear, inst.maturityMonth - 1, 15);
  return Math.max((maturity.getTime() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000), 0.01);
}

function nsFactors(term: number, tau: number) {
  const x = term / tau;
  const exp = Math.exp(-x);
  const f1 = (1 - exp) / x;
  return [1, f1, f1 - exp] as const;
}

function solve3x3(a: number[][], b: number[]) {
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const divisor = m[col][col];
    for (let j = col; j < 4; j++) m[col][j] /= divisor;
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const factor = m[row][col];
      for (let j = col; j < 4; j++) m[row][j] -= factor * m[col][j];
    }
  }
  return [m[0][3], m[1][3], m[2][3]] as const;
}

function fitNelsonSiegel(points: CurvePoint[]): NelsonSiegelFit | null {
  const valid = points.filter((p): p is CurvePoint & { yield: number } => typeof p.yield === "number" && Number.isFinite(p.yield) && p.term > 0);
  if (valid.length < 4) return null;
  let best: (NelsonSiegelFit & { sse: number }) | null = null;
  for (let tau = 0.15; tau <= 15; tau += 0.05) {
    const xtx = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const xty = [0, 0, 0];
    for (const p of valid) {
      const x = nsFactors(p.term, tau);
      for (let i = 0; i < 3; i++) {
        xty[i] += x[i] * p.yield;
        for (let j = 0; j < 3; j++) xtx[i][j] += x[i] * x[j];
      }
    }
    const beta = solve3x3(xtx, xty);
    if (!beta) continue;
    let sse = 0;
    for (const p of valid) {
      const x = nsFactors(p.term, tau);
      const fitted = beta[0] * x[0] + beta[1] * x[1] + beta[2] * x[2];
      sse += (p.yield - fitted) ** 2;
    }
    if (!best || sse < best.sse) best = { beta0: beta[0], beta1: beta[1], beta2: beta[2], tau, sse };
  }
  if (!best) return null;
  const { beta0, beta1, beta2, tau } = best;
  return { beta0, beta1, beta2, tau };
}

function nelsonSiegelYield(term: number, fit: NelsonSiegelFit) {
  const x = nsFactors(term, fit.tau);
  return fit.beta0 * x[0] + fit.beta1 * x[1] + fit.beta2 * x[2];
}

function interpolateMarketYield(term: number, points: CurvePoint[]) {
  const valid = points.filter((p): p is CurvePoint & { yield: number } => typeof p.yield === "number" && Number.isFinite(p.yield));
  if (!valid.length || term < valid[0].term || term > valid[valid.length - 1].term) return null;
  if (Math.abs(term - valid[0].term) < 1e-10) return valid[0].yield;
  for (let i = 1; i < valid.length; i++) {
    const left = valid[i - 1];
    const right = valid[i];
    if (term <= right.term) {
      if (Math.abs(right.term - left.term) < 1e-10) return (left.yield + right.yield) / 2;
      const weight = (term - left.term) / (right.term - left.term);
      return left.yield + weight * (right.yield - left.yield);
    }
  }
  return null;
}

function findHistoryOnOrBefore(data: RFData, date: string) {
  for (let i = data.history.length - 1; i >= 0; i--) if (data.history[i].date <= date) return data.history[i];
  return null;
}

function findHistoryBefore(data: RFData, date: string) {
  for (let i = data.history.length - 1; i >= 0; i--) if (data.history[i].date < date) return data.history[i];
  return null;
}

function firstHistoryOnOrAfter(data: RFData, date: string) {
  return data.history.find((row) => row.date >= date) ?? null;
}

function curveAtDate(data: RFData, curveType: "BTP" | "BTU", marketDate: string, values: Record<string, number>, liquidOnly = false) {
  const refDate = new Date(`${marketDate}T12:00:00`);
  return data.instruments
    .filter((inst) => inst.type === curveType && isActiveInstrument(inst, refDate) && (!liquidOnly || (inst.coupon ?? 0) !== 0))
    .map((inst) => ({
      term: yearsToMaturity(inst, marketDate) ?? 0,
      yield: typeof values[inst.code] === "number" ? values[inst.code] : null,
      code: inst.code,
      name: maturityLabel(inst),
    }))
    .filter((p) => p.term > 0 && p.yield != null)
    .sort((a, b) => a.term - b.term);
}
function benchmarkYield(data: RFData, type: "BTP" | "BTU", term: number, row: RFData["history"][number] | null, mode: BenchmarkMode) {
  if (!row) return null;
  if (mode === "maturity") return interpolateMarketYield(term, curveAtDate(data, type, row.date, row.values, type === "BTP"));
  const refDate = new Date(row.date + "T12:00:00");
  const points: CurvePoint[] = data.instruments
    .filter((inst) => inst.type === type && isActiveInstrument(inst, refDate) && (type !== "BTP" || (inst.coupon ?? 0) !== 0))
    .map((inst) => ({ term: inst.duration ?? 0, yield: typeof row.values[inst.code] === "number" ? row.values[inst.code] : null, code: inst.code, name: maturityLabel(inst) }))
    .filter((p) => p.term > 0 && p.yield != null)
    .sort((a, b) => a.term - b.term);
  return interpolateMarketYield(term, points);
}

function buildBenchmarkRows(data: RFData, mode: BenchmarkMode): BenchmarkRow[] {
  const current = findHistoryOnOrBefore(data, data.lastMarketDate);
  if (!current) return [];
  const d1Base = findHistoryBefore(data, current.date);
  const date = new Date(`${current.date}T00:00:00`);
  const monthStart = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
  const yearStart = `${date.getFullYear()}-01-01`;
  const mtdBase = findHistoryBefore(data, monthStart) ?? firstHistoryOnOrAfter(data, monthStart);
  const ytdBase = findHistoryBefore(data, yearStart) ?? firstHistoryOnOrAfter(data, yearStart);
  const specs: Array<{ benchmark: string; type: "BTP" | "BTU"; term: number }> = [
    { benchmark: "PESOS-02", type: "BTP", term: 2 },
    { benchmark: "PESOS-05", type: "BTP", term: 5 },
    { benchmark: "PESOS-10", type: "BTP", term: 10 },
    { benchmark: "UF-02", type: "BTU", term: 2 },
    { benchmark: "UF-05", type: "BTU", term: 5 },
    { benchmark: "UF-10", type: "BTU", term: 10 },
  ];
  return specs.map(({ benchmark, type, term }) => {
    const value = benchmarkYield(data, type, term, current, mode);
    const d1Value = benchmarkYield(data, type, term, d1Base, mode);
    const mtdValue = benchmarkYield(data, type, term, mtdBase, mode);
    const ytdValue = benchmarkYield(data, type, term, ytdBase, mode);
    return {
      benchmark,
      yield: value,
      d1: value != null && d1Value != null ? (value - d1Value) * 100 : null,
      mtd: value != null && mtdValue != null ? (value - mtdValue) * 100 : null,
      ytd: value != null && ytdValue != null ? (value - ytdValue) * 100 : null,
    };
  });
}

function BenchmarkChange({ value }: { value: number | null }) {
  if (value == null) return <span className="muted">—</span>;
  return (
    <span className={value < 0 ? "good" : value > 0 ? "bad" : "muted"}>
      {formatBp(value, 0)} bp
    </span>
  );
}

function BenchmarkTable({ rows, mode, onModeChange }: { rows: BenchmarkRow[]; mode: BenchmarkMode; onModeChange: (mode: BenchmarkMode) => void }) {
  return (
    <section className="panel market-table-panel" style={{ maxWidth: 820, margin: "14px auto" }}>
      <div className="panel-head" style={{ justifyContent: "center", textAlign: "center" }}>
        <div><h2>Tasas Benchmark</h2><div className="segmented" style={{ marginTop: 10 }}><button className={mode === "maturity" ? "selected" : ""} onClick={() => onModeChange("maturity")}>Por vencimiento</button><button className={mode === "duration" ? "selected" : ""} onClick={() => onModeChange("duration")}>Por duración</button></div></div>
      </div>
      <div className="table-wrap" role="region" aria-label="Tasas Benchmark" tabIndex={0}>
        <table className="benchmark-table">
          <thead><tr><th>Benchmark</th><th style={{ textAlign: "right" }}>Yield</th><th>Δ 1 Día</th><th>MTD</th><th>YTD</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.benchmark}>
                <td><strong>{row.benchmark}</strong></td>
                <td className="num strong" style={{ textAlign: "right" }}>{formatPercent(row.yield, 2)}</td>
                <td className="num"><BenchmarkChange value={row.d1} /></td>
                <td className="num"><BenchmarkChange value={row.mtd} /></td>
                <td className="num"><BenchmarkChange value={row.ytd} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ textAlign: "center", marginTop: 10, fontSize: 12 }}>El benchmark en pesos no incluye letras en su composición.</div>
    </section>
  );
}

function CurveTooltip({ active, label, currentCurve, comparisonCurve, comparisonDate, nsFit, showNelsonSiegel, curveType, currentDate, dpfRateView }: {
  active?: boolean; label?: number | string; currentCurve: CurvePoint[]; comparisonCurve: CurvePoint[]; comparisonDate: string | null;
  nsFit: NelsonSiegelFit | null; showNelsonSiegel: boolean; curveType: CurveType; currentDate: string; dpfRateView: DPFRateView;
}) {
  if (!active || label == null) return null;
  const term = Number(label);
  if (!Number.isFinite(term)) return null;
  const exactPoint = currentCurve.find((p) => Math.abs(p.term - term) < 1e-6);
  const current = interpolateMarketYield(term, currentCurve);
  const comparison = comparisonDate ? interpolateMarketYield(term, comparisonCurve) : null;
  const ns = showNelsonSiegel && nsFit ? nelsonSiegelYield(term, nsFit) : null;
  const move = current != null && comparison != null ? (current - comparison) * 100 : null;
  const fallbackTitle = curveType === "DPF" ? `DPF · ${Math.round(term * 365.25)} días` : `${curveType} · ${term.toFixed(2)} años`;
  const currentLabel = curveType === "DPF" ? dpfRateView === "monthly" ? "Tasa mensual" : "Tasa anual" : "Actual";
  return (
    <div className="curve-tooltip">
      <div className="curve-tooltip-title">{exactPoint?.code ?? fallbackTitle}</div>
      {exactPoint?.name && <div className="curve-tooltip-sub">{exactPoint.name}</div>}
      {current != null && <div>{currentLabel} ({currentDate}): {current.toFixed(3)}%</div>}
      {comparison != null && comparisonDate && <div>{comparisonDate}: {comparison.toFixed(3)}%</div>}
      {move != null && <div className={move < 0 ? "good" : move > 0 ? "bad" : "muted"}>Cambio: {formatBp(move)} bp</div>}
      {ns != null && <div>Nelson-Siegel: {ns.toFixed(3)}%</div>}
    </div>
  );
}

export function MarketDashboard() {
  const [data, setData] = useState<RFData | null>(null);
  const [dpfData, setDpfData] = useState<DPFData | null>(null);
  const [swapCLP, setSwapCLP] = useState<SwapRow[]>([]);
  const [curveType, setCurveType] = useState<CurveType>("BTP");
  const [dpfRateView, setDpfRateView] = useState<DPFRateView>("monthly");
  const [showNelsonSiegel, setShowNelsonSiegel] = useState(false);
  const [compareDate, setCompareDate] = useState("");
  const [benchmarkMode, setBenchmarkMode] = useState<BenchmarkMode>("maturity");

  useEffect(() => {
    fetch("/data/rf.json").then((r) => r.json()).then(setData);
    loadDPFData().then(setDpfData);
    loadCLPCamData().then(setSwapCLP);
  }, []);

  const active = useMemo(() => data ? data.instruments.filter((i) => isActiveInstrument(i)).sort((a, b) => a.maturityYear * 12 + a.maturityMonth - (b.maturityYear * 12 + b.maturityMonth)) : [], [data]);
  const btp = active.filter((i) => i.type === "BTP");
  const btu = active.filter((i) => i.type === "BTU");
  const benchmarkRows = useMemo(() => data ? buildBenchmarkRows(data, benchmarkMode) : [], [data, benchmarkMode]);

  const currentCurve = useMemo<CurvePoint[]>(() => {
    if (curveType === "DPF") {
      if (!dpfData) return [];
      const factor = dpfRateView === "annual" ? 12 : 1;
      return dpfData.instruments.map((item) => ({ term: item.days / 365.25, yield: item.value * factor, code: item.code, name: `${item.days} días` })).sort((a, b) => a.term - b.term);
    }
    if (!data) return [];
    const currentRow = findHistoryOnOrBefore(data, data.lastMarketDate);
    return currentRow ? curveAtDate(data, curveType, currentRow.date, currentRow.values) : [];
  }, [data, dpfData, curveType, dpfRateView]);

  const comparisonRow = useMemo(() => data && compareDate && curveType !== "DPF" ? findHistoryOnOrBefore(data, compareDate) : null, [data, compareDate, curveType]);
  const dpfComparisonDate = useMemo(() => {
    if (!dpfData || !compareDate || curveType !== "DPF") return null;
    const dates = dpfData.history.flatMap((series) => series.rows.map((row) => row.date)).filter((date) => date <= compareDate).sort();
    return dates.at(-1) ?? null;
  }, [dpfData, compareDate, curveType]);
  const comparisonCurve = useMemo<CurvePoint[]>(() => {
    if (curveType === "DPF") {
      if (!dpfData || !dpfComparisonDate) return [];
      const factor = dpfRateView === "annual" ? 12 : 1;
      return dpfData.history.map((series) => {
        const row = [...series.rows].reverse().find((item) => item.date <= dpfComparisonDate);
        return { term: series.days / 365.25, yield: row ? row.value * factor : null, code: series.code, name: `${series.days} días` };
      }).filter((point) => point.yield != null).sort((a, b) => a.term - b.term);
    }
    return !data || !comparisonRow ? [] : curveAtDate(data, curveType, comparisonRow.date, comparisonRow.values);
  }, [data, dpfData, comparisonRow, dpfComparisonDate, curveType, dpfRateView]);
  const effectiveComparisonDate = curveType === "DPF" ? dpfComparisonDate : comparisonRow?.date ?? null;
  const nsFit = useMemo(() => curveType === "DPF" ? null : fitNelsonSiegel(currentCurve), [currentCurve, curveType]);
  const curveAxis = useMemo(() => {
    if (curveType === "DPF") return { ticks: (dpfData?.instruments ?? []).map((item) => item.days / 365.25), max: 430 / 365.25 };
    const allTerms = [...currentCurve, ...comparisonCurve].map((p) => p.term);
    const maxTerm = allTerms.length ? Math.max(...allTerms) : 20;
    const ticks = [1, 2, 5, 10, 15, 20];
    if (maxTerm > 20) ticks.push(30);
    return { ticks, max: maxTerm > 20 ? Math.max(30, Math.ceil(maxTerm / 10) * 10) : 20 };
  }, [currentCurve, comparisonCurve, curveType, dpfData]);

  const chartData = useMemo(() => {
    if (!currentCurve.length) return [];
    const rows: Array<{ term: number; yield?: number | null; compareYield?: number | null; nsYield?: number | null; code?: string; name?: string }> = [];
    for (const point of currentCurve) rows.push({ term: point.term, yield: point.yield, code: point.code, name: point.name });
    for (const point of comparisonCurve) rows.push({ term: point.term, compareYield: point.yield, code: point.code, name: point.name });
    if (curveType !== "DPF" && showNelsonSiegel && nsFit) {
      const minTerm = Math.max(0.05, currentCurve[0].term);
      const maxTerm = currentCurve[currentCurve.length - 1].term;
      for (let i = 0; i <= 140; i++) {
        const term = minTerm + ((maxTerm - minTerm) * i) / 140;
        rows.push({ term, nsYield: nelsonSiegelYield(term, nsFit) });
      }
    }
    return rows.sort((a, b) => a.term - b.term);
  }, [currentCurve, comparisonCurve, nsFit, showNelsonSiegel, curveType]);

  if (!data || !dpfData) return <AppShell><div className="loading">Cargando mercado…</div></AppShell>;

  const minHistoryDate = data.history[0]?.date;
  const maxHistoryDate = data.lastMarketDate;
  const currentDate = curveType === "DPF" ? dpfData.lastMarketDate : data.lastMarketDate;
  const currentSeriesName = curveType === "DPF" ? `${dpfRateView === "monthly" ? "Tasa mensual" : "Tasa anual"} · ${currentDate}` : `Actual · ${currentDate}`;

  return (
    <AppShell>
      <header className="page-head">
        <div><div className="eyebrow">Trading Propietario</div><h1>Mercado de Renta Fija Chilena</h1></div>
        <div className="asof"><span>Último cierre</span><strong>{data.lastMarketDate}</strong></div>
      </header>

      <div className="kpi-grid macro-kpi-grid">
        {macroKpis.map((kpi) => (
          <div className="kpi" key={kpi.label}>
            <div className="kpi-label">{kpi.label}</div>
            <div className="kpi-value">{kpi.value}</div>
            <div className="kpi-foot kpi-foot-static">
              {kpi.label === "TPM" ? <TPMMeetings /> : <span>{kpi.description}</span>}
            </div>
          </div>
        ))}
      </div>

      <section className="panel curve-panel">
        <div className="panel-head">
          <div><div className="eyebrow">Estructura temporal</div><h2>Curvas de Rendimiento</h2></div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="segmented">
              <button className={curveType === "BTP" ? "selected" : ""} onClick={() => setCurveType("BTP")}>BTP</button>
              <button className={curveType === "BTU" ? "selected" : ""} onClick={() => setCurveType("BTU")}>BTU</button>
              <button className={curveType === "DPF" ? "selected" : ""} onClick={() => { setCurveType("DPF"); setDpfRateView("monthly"); setShowNelsonSiegel(false); setCompareDate(""); }}>DPF</button>
            </div>
            {curveType !== "DPF" ? (
              <label className="curve-check"><input type="checkbox" checked={showNelsonSiegel} onChange={(e) => setShowNelsonSiegel(e.target.checked)} /><span>Nelson-Siegel</span></label>
            ) : (
              <div className="segmented">
                <button className={dpfRateView === "monthly" ? "selected" : ""} onClick={() => setDpfRateView("monthly")}>Tasa mensual</button>
                <button className={dpfRateView === "annual" ? "selected" : ""} onClick={() => setDpfRateView("annual")}>Tasa anual</button>
              </div>
            )}
          </div>
        </div>

        <div className="curve-controls"><div className="curve-date-control"><span>Comparar con</span><input type="date" value={compareDate} min={curveType === "DPF" ? dpfData.history.flatMap((series) => series.rows.map((row) => row.date)).sort()[0] : minHistoryDate} max={curveType === "DPF" ? dpfData.lastMarketDate : maxHistoryDate} onChange={(e) => setCompareDate(e.target.value)} />{compareDate && <button type="button" onClick={() => setCompareDate("")}>Quitar</button>}</div></div>
        {compareDate && effectiveComparisonDate && <div className="comparison-note"><strong>{effectiveComparisonDate}</strong></div>}

        <div className="chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ left: 8, right: 20, top: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="term" type="number" domain={[0, curveAxis.max]} ticks={curveAxis.ticks} tickFormatter={(v) => curveType === "DPF" ? `${Math.round(Number(v) * 365.25)}d` : `${Number(v).toFixed(0)}a`} />
              <YAxis domain={["auto", "auto"]} tickFormatter={(v) => `${Number(v).toFixed(curveType === "DPF" && dpfRateView === "monthly" ? 3 : 1)}%`} />
              <Tooltip content={<CurveTooltip currentCurve={currentCurve} comparisonCurve={comparisonCurve} comparisonDate={effectiveComparisonDate} nsFit={nsFit} showNelsonSiegel={showNelsonSiegel} curveType={curveType} currentDate={currentDate} dpfRateView={dpfRateView} />} />
              <Legend />
              <Line type="linear" dataKey="yield" name={currentSeriesName} stroke="currentColor" strokeWidth={2.5} dot={{ r: 3.5 }} connectNulls />
              {effectiveComparisonDate && <Line type="linear" dataKey="compareYield" name={`Comparación · ${effectiveComparisonDate}`} stroke="#64748b" strokeWidth={2} strokeDasharray="6 5" dot={{ r: 3 }} connectNulls isAnimationActive={false} />}
              {curveType !== "DPF" && showNelsonSiegel && nsFit && <Line type="monotone" dataKey="nsYield" name="Nelson-Siegel" stroke="#f59e0b" strokeWidth={2.25} strokeDasharray="7 5" dot={false} isAnimationActive={false} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <BenchmarkTable rows={benchmarkRows} mode={benchmarkMode} onModeChange={setBenchmarkMode} />

      <div className="two-col">
        <MarketTable title="Bonos de Gobierno en Pesos" instruments={btp} data={data} tpm={latestTpm} swaps={swapCLP} />
        <div style={{ display: "grid", gap: 14 }}><MarketTable title="Bonos de Gobierno en UF" instruments={btu} data={data} tpm={latestTpm} /><DPFTable data={dpfData} /></div>
      </div>

      <SwapCLPTable rows={swapCLP} />

      <div className="note">Regla de vigencia: el instrumento se mantiene visible durante su mes de vencimiento y el mes siguiente. Luego se oculta automáticamente.</div>
    </AppShell>
  );
}

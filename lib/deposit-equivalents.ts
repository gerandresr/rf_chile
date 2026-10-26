/**
 * Equivalencias de depósitos entre pesos, UF y USD con el closing de derivados (ICAP).
 *
 * Factores al vencimiento (T días):  DPF 1 + r30·T/30   ·   DPR 1 + rUF·T/360   ·   USD 1 + rUSD·T/360
 *   pesos → UF :  F_UF  = F_CLP · UF₀ / UF(T)
 *   UF → pesos :  F_CLP = F_UF · UF(T) / UF₀
 *   pesos → USD:  F_USD = F_CLP · S / F(T)        (cobertura con forward; F = S + puntos NDF en pesos)
 *
 * UF: el valor del día 9 de cada mes sale de los seguros de inflación (cada contrato es la UF de su mes y
 * su campo IPC es el IPC de dos meses antes). Hacia atrás se encadena con UF(9, M−1) = UF(9, M)/(1 + IPC(M−2)),
 * usando el IPC observado cuando el seguro no lo trae. Entre días 9 la UF se interpola geométricamente por día,
 * que es como se reajusta.
 */

const DAY = 86400000;
const time = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const ninth = (y: number, m0: number) => iso(Date.UTC(y, m0, 9));
const monthKey = (y: number, m0: number) => iso(Date.UTC(y, m0, 1));

export type UfKnot = { date: string; uf: number };
export type InflationInsurance = { fecha: string; datos: { Tenor: number | string; Mid: number | null; IPC?: number | null }[] };
export type NdfCurve = { fecha: string; datos: { Tenor: string; Mid: number | null; Dias: number }[] };

/** Nodos de UF (día 9 de cada mes) desde los seguros, extendidos hacia atrás hasta cubrir `from`. */
export function ufKnots(insurance: InflationInsurance, observedIpc: Map<string, number>, from: string): UfKnot[] {
  const ipc = new Map(observedIpc);
  const knots: UfKnot[] = [];
  for (const r of insurance.datos) {
    if (typeof r.Mid !== "number" || !Number.isFinite(r.Mid)) continue;
    const d = new Date(typeof r.Tenor === "number" ? r.Tenor : `${r.Tenor}T00:00:00Z`);
    // El contrato vence en torno al día 9 (ajustado a día hábil): se asigna al día 9 de su mes.
    knots.push({ date: ninth(d.getUTCFullYear(), d.getUTCMonth()), uf: r.Mid });
    if (typeof r.IPC === "number") ipc.set(monthKey(d.getUTCFullYear(), d.getUTCMonth() - 2), r.IPC);
  }
  knots.sort((a, b) => a.date.localeCompare(b.date));
  while (knots.length && knots[0].date > from) {
    const d = new Date(`${knots[0].date}T00:00:00Z`);
    const inflation = ipc.get(monthKey(d.getUTCFullYear(), d.getUTCMonth() - 2));
    if (typeof inflation !== "number") break;
    knots.unshift({ date: ninth(d.getUTCFullYear(), d.getUTCMonth() - 1), uf: knots[0].uf / (1 + inflation / 100) });
  }
  return knots;
}

export function ufOn(date: string, knots: UfKnot[]): number | null {
  const t = time(date);
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1], b = knots[i], ta = time(a.date), tb = time(b.date);
    if (t >= ta && t <= tb) return a.uf * Math.pow(b.uf / a.uf, (t - ta) / (tb - ta));
  }
  return null;
}

/** Forward USD/CLP a T días: spot + puntos NDF (pesos) interpolados linealmente por días; 0 puntos a 0 días. */
export function forwardRate(days: number, spot: number, ndf: NdfCurve): number | null {
  const pts = [{ days: 0, points: 0 }, ...ndf.datos.filter(r => typeof r.Mid === "number" && Number.isFinite(r.Dias)).map(r => ({ days: r.Dias, points: r.Mid as number }))].sort((a, b) => a.days - b.days);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (days >= a.days && days <= b.days) return spot + a.points + (b.points - a.points) * (days - a.days) / (b.days - a.days);
  }
  return null;
}

export type EquivalenceContext = { valuationDate: string; uf0: number; spot: number; knots: UfKnot[]; ndf: NdfCurve };

export function equivalenceContext(insurance: InflationInsurance, ndf: NdfCurve, observedIpc: Map<string, number>, spot: number): EquivalenceContext | null {
  const valuationDate = insurance.fecha;
  const knots = ufKnots(insurance, observedIpc, valuationDate);
  const uf0 = ufOn(valuationDate, knots);
  return uf0 === null || !Number.isFinite(spot) ? null : { valuationDate, uf0, spot, knots, ndf };
}

export type Equivalents = { clp30: number; uf: number; usd: number; ufAtMaturity: number; forward: number };

/** Equivalentes de un depósito: `kind` DPF (tasa base 30 días, %) o DPR (tasa real anual base 360, %). */
export function depositEquivalents(kind: "DPF" | "DPR", rate: number, days: number, ctx: EquivalenceContext): Equivalents | null {
  if (!Number.isFinite(rate) || !Number.isFinite(days) || days <= 0) return null;
  const ufT = ufOn(iso(time(ctx.valuationDate) + days * DAY), ctx.knots);
  const fwd = forwardRate(days, ctx.spot, ctx.ndf);
  if (ufT === null || fwd === null) return null;
  const clpFactor = kind === "DPF" ? 1 + (rate / 100) * days / 30 : (1 + (rate / 100) * days / 360) * ufT / ctx.uf0;
  const ufFactor = clpFactor * ctx.uf0 / ufT;
  const usdFactor = clpFactor * ctx.spot / fwd;
  return {
    clp30: 100 * (clpFactor - 1) * 30 / days,
    uf: 100 * (ufFactor - 1) * 360 / days,
    usd: 100 * (usdFactor - 1) * 360 / days,
    ufAtMaturity: ufT, forward: fwd,
  };
}

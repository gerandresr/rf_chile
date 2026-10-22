/** Modelo indicativo long bono + pagar fijo/recibir Cámara, sensibilidad de primer orden. */
export type SwapQuote = { x: number; y: number };
export type DiscountNode = { t: number; df: number };
const BASIS = 365 / 360;

function payments(t: number) {
  if (!(t > 0)) return [];
  if (t <= 1) return [{ t, accrual: t * BASIS }];
  const out: { t: number; accrual: number }[] = [];
  let previous = 0;
  for (let p = .5; p < t - 1e-9; p += .5) { out.push({ t: p, accrual: (p - previous) * BASIS }); previous = p; }
  out.push({ t, accrual: (t - previous) * BASIS }); return out;
}
export function discountAt(t: number, nodes: DiscountNode[]): number | null {
  if (t < 0 || !nodes.length || t > nodes[nodes.length - 1].t + 1e-9) return null;
  if (t === 0) return 1;
  let left = { t: 0, df: 1 };
  for (const right of nodes) {
    if (Math.abs(t - right.t) < 1e-9) return right.df;
    if (t < right.t) return Math.exp(Math.log(left.df) + (t - left.t) / (right.t - left.t) * Math.log(right.df / left.df));
    left = right;
  }
  return null;
}
/** Bootstrap de curva única. Cortos <=1a: pago único; largos: semestrales sin ajustes de calendario. */
export function bootstrapSwapCurve(quotes: SwapQuote[]) {
  const nodes: DiscountNode[] = [];
  for (const q of quotes.slice().sort((a, b) => a.x - b.x)) {
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y) || q.x <= 0 || nodes.some(n => Math.abs(n.t - q.x) < 1e-9)) continue;
    const residual = (df: number) => {
      const trial = [...nodes, { t: q.x, df }];
      return q.y / 100 * payments(q.x).reduce((s, p) => s + p.accrual * discountAt(p.t, trial)!, 0) + df - 1;
    };
    let lo = 1e-10, hi = 100;
    if (residual(lo) * residual(hi) > 0) throw new Error("Las tasas no permiten construir una curva de descuento válida.");
    for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (residual(mid) > 0) hi = mid; else lo = mid; }
    nodes.push({ t: q.x, df: (lo + hi) / 2 });
  }
  return nodes;
}
export function swapAnnuity(t: number, nodes: DiscountNode[]) {
  if (!(t > 0)) return null;
  const p = payments(t), dfs = p.map(p => discountAt(p.t, nodes));
  return dfs.some(v => v === null) ? null : p.reduce((s, p, i) => s + p.accrual * dfs[i]!, 0);
}
export function parSwapRate(t: number, nodes: DiscountNode[]) {
  const annuity = swapAnnuity(t, nodes), df = discountAt(t, nodes);
  return annuity === null || df === null || annuity <= 0 ? null : (1 - df) / annuity * 100;
}
export function horizonDays(date: string, months: number) {
  const start = new Date(`${date}T00:00:00Z`), end = new Date(start);
  const day = end.getUTCDate(); end.setUTCDate(1); end.setUTCMonth(end.getUTCMonth() + months);
  const max = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate(); end.setUTCDate(Math.min(day, max));
  return (end.getTime() - start.getTime()) / 86400000;
}
export function tradeSizing(dv01USD: number, usdclp: number, bondDuration: number, swapRiskYears: number, hedgePct = 100, bondValuePer100 = 100) {
  if (![dv01USD, usdclp, bondDuration, swapRiskYears, bondValuePer100].every(v => Number.isFinite(v) && v > 0) || !Number.isFinite(hedgePct) || hedgePct < 0) return null;
  const bondDV01 = dv01USD * usdclp, swapDV01 = bondDV01 * hedgePct / 100;
  const bondMarketValue = bondDV01 / (bondDuration * .0001);
  return { bondDV01, swapDV01, bondMarketValue, bondNominal: bondMarketValue / (bondValuePer100 / 100),
    swapNominal: swapDV01 / (swapRiskYears * .0001), residualDV01: bondDV01 - swapDV01 };
}
export type TradeSizing = NonNullable<ReturnType<typeof tradeSizing>>;
export type ProjectionInput = {
  sizing: TradeSizing; days: number; bondYield: number; fixedSwap: number; funding: number; camera: number;
  currency: "CLP" | "UF"; ufPct: number; bondRollBp: number | null; swapRollBp: number | null;
  commonShockBp: number; extraBondBp: number; extraSwapBp: number; convergenceBp: number; costsCLP: number;
};
export function projectBondSwap(p: ProjectionInput) {
  const { sizing: s } = p, ufFactor = p.currency === "UF" ? 1 + p.ufPct / 100 : 1;
  const bondAccrual = s.bondMarketValue * (Math.pow(1 + p.bondYield / 100, p.days / 365) - 1) * ufFactor;
  const bondUF = s.bondMarketValue * (ufFactor - 1);
  const funding = -s.bondMarketValue * (Math.pow(1 + p.funding / 100 / 360, p.days) - 1);
  const cameraFactor = Math.pow(1 + p.camera / 100 / 360, p.days);
  // En UF, Cámara nominal se expresa en UF: factor real = factor ICP / factor UF.
  const floatReceived = s.swapNominal * (cameraFactor / ufFactor - 1) * ufFactor;
  const fixedPaid = -s.swapNominal * p.fixedSwap / 100 * p.days / 360 * ufFactor;
  const bondRoll = p.bondRollBp === null ? null : s.bondDV01 * p.bondRollBp * ufFactor;
  const swapRoll = p.swapRollBp === null ? null : s.swapDV01 * p.swapRollBp * ufFactor;
  const bondMTM = -s.bondDV01 * (p.commonShockBp + p.extraBondBp) * ufFactor;
  const swapMTM = s.swapDV01 * (p.commonShockBp + p.extraSwapBp) * ufFactor;
  const convergence = -s.bondDV01 * p.convergenceBp * ufFactor;
  const carry = bondAccrual + bondUF + funding + floatReceived + fixedPaid;
  const costs = -p.costsCLP;
  const total = carry + (bondRoll ?? 0) + (swapRoll ?? 0) + bondMTM + swapMTM + convergence + costs;
  return { bondAccrual, bondUF, funding, floatReceived, fixedPaid, carry, bondRoll, swapRoll, bondMTM, swapMTM, convergence, costs, total,
    completeRoll: bondRoll !== null && swapRoll !== null,
    spreadBreakevenBp: total / (s.bondDV01 * ufFactor) };
}

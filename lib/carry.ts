/**
 * Carry y roll-down de BTP y BTU sobre un horizonte h, financiado a plazo en CLP.
 *
 * Retorno esperado si la curva no se mueve (en % sobre h):
 *   devengo   BTP: (1+y)^h − 1                         (TIR base anual, 365 días)
 *             BTU: (1+y_real)^h · UF(T)/UF(0) − 1      (UF esperada con IPC observado + forwards ICAP)
 *   financ.   swap Cámara del plazo h: r·días/360      (= ICP esperado, sin riesgo de refinanciamiento)
 *   roll-down D_mod · [ŷ(T) − ŷ(T−h)]                  (ŷ: curva Nelson-Siegel por tipo, ajustada al día)
 * El bono conserva su spread a la curva; no hay apuesta direccional.
 * Breakeven: alza de tasa (pb) que anula el retorno en exceso. Riesgo: vol. diaria de la TIR × √días × D_mod.
 */

export type BondInput = { code: string; type: "BTP" | "BTU"; maturity: string; yield: number; macaulay: number; dailyChangesBp: number[] };
export type CarryRow = {
  code: string; type: "BTP" | "BTU"; maturity: string; years: number; yield: number; fittedYield: number; modifiedDuration: number;
  accrualPct: number; fundingPct: number; carryPct: number;
  rollBp: number; rollPct: number; totalPct: number; breakevenBp: number;
  volPct: number | null; ratio: number | null;
};

const DAY = 86400000;
const MIN_YEARS = 1;
export const isZeroCoupon = (code: string) => /^(BTP|BTU)000/.test(code);
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const yearsBetween = (a: string, b: string) => (toDate(b).getTime() - toDate(a).getTime()) / DAY / 365;

/** Vencimiento desde el código nemotécnico: BTP0600134 → cupón 6,0%, enero de 2034 (día 1). */
export function maturityFromCode(code: string) {
  const m = code.match(/^(BTP|BTU)(\d{3})(\d{2})(\d{2})$/);
  if (!m) return null;
  const month = Number(m[3]);
  if (month < 1 || month > 12) return null;
  return `20${m[4]}-${m[3]}-01`;
}

// ---- Nelson-Siegel ----
function nsLoadings(t: number, tau: number) {
  const x = t / tau, e = Math.exp(-x), slope = x < 1e-8 ? 1 : (1 - e) / x;
  return [1, slope, slope - e];
}
export type NelsonSiegel = { beta: number[]; tau: number; rmseBp: number };
export function fitNelsonSiegel(points: { t: number; y: number }[]): NelsonSiegel {
  if (points.length < 4) throw new Error("Se necesitan al menos 4 bonos para ajustar la curva.");
  let best: NelsonSiegel | null = null;
  for (let tau = 0.3; tau <= 12; tau *= 1.05) {
    // Mínimos cuadrados 3×3 por ecuaciones normales.
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
    for (const p of points) {
      const l = nsLoadings(p.t, tau);
      for (let i = 0; i < 3; i++) { b[i] += l[i] * p.y; for (let j = 0; j < 3; j++) A[i][j] += l[i] * l[j]; }
    }
    const beta = solve3(A, b);
    if (!beta) continue;
    const sse = points.reduce((s, p) => s + (p.y - nsLoadings(p.t, tau).reduce((a, l, i) => a + l * beta[i], 0)) ** 2, 0);
    const rmseBp = 100 * Math.sqrt(sse / points.length);
    if (!best || rmseBp < best.rmseBp) best = { beta, tau, rmseBp };
  }
  if (!best) throw new Error("No fue posible ajustar la curva.");
  return best;
}
export const nsYield = (c: NelsonSiegel, t: number) => nsLoadings(Math.max(t, 1e-6), c.tau).reduce((a, l, i) => a + l * c.beta[i], 0);
function solve3(A: number[][], b: number[]) {
  const m = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) if (r !== c) { const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]; }
  }
  return m.map((r, i) => r[3] / r[i]);
}

// ---- UF esperada ----
/**
 * Factor UF(T)/UF(t0). La UF crece en forma geométrica diaria entre el día 10 de un mes y el
 * día 9 del siguiente, a la tasa del IPC del mes anterior al inicio del período.
 * `ipcByMonth`: variación mensual (%) por mes AAAA-MM-01 (observada o esperada); si falta,
 * se usa la meta (3% anual).
 */
export function ufFactor(from: string, to: string, ipcByMonth: Map<string, number>) {
  const fallback = 100 * (Math.pow(1.03, 1 / 12) - 1);
  let factor = 1;
  let t = toDate(from).getTime();
  const end = toDate(to).getTime();
  while (t < end) {
    const d = new Date(t);
    // Período UF que contiene d: [10 del mes m, 10 del mes m+1)
    const startMonth = d.getUTCDate() >= 10 ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 10)) : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 10));
    const next = new Date(Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() + 1, 10));
    const ipcMonth = new Date(Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
    const ipc = ipcByMonth.get(ipcMonth) ?? fallback;
    const periodDays = (next.getTime() - startMonth.getTime()) / DAY;
    const segmentEnd = Math.min(next.getTime(), end);
    factor *= Math.pow(1 + ipc / 100, (segmentEnd - t) / DAY / periodDays);
    t = segmentEnd;
  }
  return factor;
}

const std = (v: number[]) => {
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
};

export function carryRolldown(options: {
  date: string; horizonMonths: number; bonds: BondInput[]; fundingRate: number; ipcByMonth: Map<string, number>;
}) {
  const { date, horizonMonths, bonds, fundingRate, ipcByMonth } = options;
  const endDate = new Date(toDate(date)); endDate.setUTCMonth(endDate.getUTCMonth() + horizonMonths);
  const end = endDate.toISOString().slice(0, 10);
  const h = yearsBetween(date, end), days = Math.round(h * 365);
  const fundingPct = fundingRate * days / 360;
  const uf = ufFactor(date, end, ipcByMonth);
  const curves: Partial<Record<"BTP" | "BTU", NelsonSiegel>> = {};
  const rows: CarryRow[] = [];
  for (const type of ["BTP", "BTU"] as const) {
    // Plazo mínimo de un año (y más allá del horizonte): bajo un año la TIR, sobre todo en UF,
    // está dominada por la estacionalidad de la inflación y no por la forma de la curva.
    const set = bonds.filter(b => b.type === type && yearsBetween(date, b.maturity) >= Math.max(MIN_YEARS, h + 1 / 12));
    // La curva se ajusta con bonos con cupón: los cero cupón transan con un spread propio.
    const fitSet = set.filter(b => !isZeroCoupon(b.code));
    if (fitSet.length < 4) continue;
    const curve = fitNelsonSiegel(fitSet.map(b => ({ t: yearsBetween(date, b.maturity), y: b.yield })));
    curves[type] = curve;
    // Sin extrapolar: el plazo al final del horizonte debe quedar dentro del tramo ajustado.
    const shortest = Math.min(...fitSet.map(b => yearsBetween(date, b.maturity)));
    for (const b of set) {
      const t = yearsBetween(date, b.maturity);
      if (t - h < shortest - 1e-9) continue;
      const modifiedDuration = b.macaulay / (1 + b.yield / 100);
      const accrualPct = 100 * (Math.pow(1 + b.yield / 100, h) * (type === "BTU" ? uf : 1) - 1);
      const rollBp = 100 * (nsYield(curve, t) - nsYield(curve, t - h));
      const rollPct = modifiedDuration * rollBp / 100;
      const carryPct = accrualPct - fundingPct;
      const totalPct = carryPct + rollPct;
      const recent = std(b.dailyChangesBp.slice(-63));
      const volPct = recent === null ? null : recent * Math.sqrt(days * 252 / 365) * modifiedDuration / 100;
      rows.push({
        code: b.code, type, maturity: b.maturity, years: t, yield: b.yield, fittedYield: nsYield(curve, t), modifiedDuration,
        accrualPct, fundingPct, carryPct, rollBp, rollPct, totalPct,
        breakevenBp: modifiedDuration > 0 ? 100 * totalPct / modifiedDuration : 0,
        volPct, ratio: volPct ? totalPct / volPct : null,
      });
    }
  }
  return { date, end, horizonMonths, fundingRate, fundingPct, ufGrowthPct: 100 * (uf - 1), curves, rows: rows.sort((a, b) => a.type.localeCompare(b.type) || a.years - b.years) };
}

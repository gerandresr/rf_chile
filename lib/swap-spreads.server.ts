import { readFileSync, readdirSync } from "fs";
import path from "path";
import { maturityFromCode } from "./carry";
import { DAY, time, iso, interpolate, type SpreadData, type SpreadPoint } from "./swap-spreads";

const ROOT = path.join(process.cwd(), "public/data");
const read = (file: string) => JSON.parse(readFileSync(path.join(ROOT, file), "utf8").replace(/^\uFEFF/, ""));
const tenors: [string, number][] = [["1m", 1 / 12], ["3m", .25], ["6m", .5], ["9m", .75], ["1y", 1], ["2y", 2], ["5y", 5], ["7y", 7], ["10y", 10], ["15y", 15], ["20y", 20]];

// Solo para comparación por duración: sensibilidad aproximada de una pata fija par semestral.
function swapDuration(t: number, y: number) {
  if (t <= 1) return t / (1 + y / 100);
  const n = Math.round(t * 2), c = y / 200;
  let pv = 0, weighted = 0;
  for (let i = 1; i <= n; i++) { const cash = (c + (i === n ? 1 : 0)) / Math.pow(1 + c, i); pv += cash; weighted += cash * i / 2; }
  return weighted / pv / (1 + c);
}
const round = (v: number) => Math.round(v * 1e6) / 1e6;

export function swapSpreadData(): SpreadData {
  const errors: string[] = [];
  const curves = { CLP: new Map<string, { x: number; y: number }[]>(), UF: new Map<string, { x: number; y: number }[]>() };
  for (const currency of ["CLP", "UF"] as const) for (const [tenor, years] of tenors) {
    if (currency === "UF" && tenor === "1m") continue; // La curva UF disponible comienza en 3 meses.
    const key = `${currency === "CLP" ? "clpcam" : "ufcam"}_${tenor}`;
    try {
      const s = read(`historico_bloomberg/${key}.json`)[key] as { fecha: string[]; valor: (number | null)[] };
      s.fecha.forEach((date, i) => {
        const v = s.valor[i];
        if (typeof v !== "number" || !Number.isFinite(v)) return;
        const points = curves[currency].get(date) ?? [];
        points.push({ x: years, y: v }); curves[currency].set(date, points);
      });
    } catch { errors.push(`Sin serie swap ${key}.`); }
  }
  const files = readdirSync(path.join(ROOT, "historico_riskamerica")).filter(f => /^BT[PU]\d{7}\.json$/.test(f));
  const loaded = files.flatMap(file => {
    const code = file.slice(0, -5), maturity = maturityFromCode(code);
    if (!maturity) return [];
    try {
      const s = read(`historico_riskamerica/${file}`)[code] as { fecha: string[]; tir: (number | null)[]; duracion: (number | null)[] };
      return [{ code, maturity, s }];
    } catch { errors.push(`No se pudo leer ${code}.`); return []; }
  });
  const asOf = loaded.flatMap(b => b.s.fecha.filter((_, i) => typeof b.s.tir[i] === "number")).sort().at(-1) ?? "";
  if (!asOf) return { asOf, bonds: [], errors: [...errors, "No hay tasas de bonos disponibles."] };
  const cutoff = iso(time(asOf) - 5 * 366 * DAY);
  const bonds = loaded.filter(b => b.maturity > asOf).map(({ code, maturity, s }) => {
    const currency = code.startsWith("BTP") ? "CLP" as const : "UF" as const;
    const points: SpreadPoint[] = []; let missing = 0;
    s.fecha.forEach((date, i) => {
      if (date < cutoff || date > asOf) return;
      const y = s.tir[i], macaulay = s.duracion[i], curve = curves[currency].get(date);
      if (typeof y !== "number" || typeof macaulay !== "number" || !Number.isFinite(y) || !Number.isFinite(macaulay) || macaulay <= 0 || !curve) { missing++; return; }
      const term = (time(maturity) - time(date)) / DAY / 365;
      const swap = interpolate(term, curve);
      if (swap === null) { missing++; return; }
      const matched = interpolate(macaulay / (1 + y / 100), curve.map(p => ({ x: swapDuration(p.x, p.y), y: p.y })));
      points.push({ date, yield: round(y), swap: round(swap), spread: round((y - swap) * 100),
        durationSpread: matched === null ? null : round((y - matched) * 100), macaulay: round(macaulay), term: round(term) });
    });
    // Una fecha por observación; nunca arrastramos cotizaciones de un día distinto.
    const unique = [...new Map(points.map(p => [p.date, p])).values()].sort((a, b) => a.date.localeCompare(b.date));
    return { code, currency, maturity, points: unique, missing };
  });
  return { asOf, bonds: bonds.filter(b => b.points.length).sort((a, b) => a.currency.localeCompare(b.currency) || a.maturity.localeCompare(b.maturity)), errors };
}

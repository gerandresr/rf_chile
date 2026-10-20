import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { estimateNairu, seasonalFactors } from "../lib/nairu.ts";

const rows = JSON.parse(readFileSync(new URL("../public/data/historico_bcentral/datos-mensuales.json", import.meta.url), "utf8"));
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const jointRows = rows.filter((r) => isNumber(r.desempleo) && isNumber(r.imacec_ind_des)).sort((a, b) => a.fecha.localeCompare(b.fecha));
const close = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const result = estimateNairu(rows);

test("coincide con una implementación matricial independiente (numpy/scipy L-BFGS-B)", () => {
  // Referencia calculada con los datos 2015-01 a 2026-08; se omite si la muestra cambia.
  if (jointRows[0].fecha !== "2015-01-01" || jointRows.at(-1).fecha !== "2026-08-01") return;
  close(result.likelihood, -221.38142, 0.0001);
  close(result.parameters.okun, 1.804997, 0.0001);
  close(result.parameters.phi1, 1.672295, 0.0001);
  close(result.parameters.phi2, -0.719115, 0.0001);
  close(result.points.at(-1).smoothed, 8.725468, 0.0001);
  close(result.points.at(-1).smoothedUpper - result.points.at(-1).smoothed, 1.96 * 0.6383034, 0.0001);
});

test("parámetros con sentido económico y ciclo estacionario", () => {
  const p = result.parameters;
  assert.ok(p.okun > 0.5 && p.okun < 5, `Okun ${p.okun}`);
  assert.ok(p.phi2 > -1 && p.phi1 + p.phi2 < 1 && p.phi2 - p.phi1 < 1, "AR(2) no estacionario");
  assert.ok(p.cycleHalfLife > 0);
});

test("factores estacionales suman cero y el desestacionalizado conserva el nivel anual", () => {
  close(result.seasonalFactors.reduce((a, b) => a + b, 0), 0, 1e-12);
  const year = result.points.filter((p) => p.date.startsWith("2019-"));
  close(year.reduce((s, p) => s + p.unemployment - p.unemploymentSa, 0), 0, 1e-9);
});

test("la suavizada coincide con la filtrada al final y no aumenta la incertidumbre", () => {
  const latest = result.points.at(-1);
  close(latest.smoothed, latest.filtered, 1e-9);
  for (const point of result.points) {
    assert.ok(Number.isFinite(point.smoothed) && Number.isFinite(point.outputGapSmoothed));
    assert.ok(point.smoothedUpper - point.smoothedLower <= point.filteredUpper - point.filteredLower + 1e-9);
  }
});

test("el orden de las filas no cambia el resultado", () => {
  assert.deepEqual(estimateNairu([...rows].reverse()), result);
});

test("rechaza meses faltantes, fechas duplicadas y muestras cortas", () => {
  assert.throws(() => estimateNairu(rows.filter((_, i) => i !== 30)), /meses faltantes/);
  assert.throws(() => estimateNairu([...rows, rows[0]]), /duplicada/);
  assert.throws(() => estimateNairu(rows.slice(0, 40)), /al menos 72/);
  assert.throws(() => estimateNairu(rows.map((r, i) => i === 30 ? { ...r, imacec_ind_des: null } : r)), /meses faltantes/);
});

test("recupera Okun, estacionalidad y tasa natural conocidas en datos simulados", () => {
  let seed = 7;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const normal = () => Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());
  const season = [0.4, 0.3, 0.1, 0, -0.1, -0.2, -0.3, -0.2, -0.1, 0, 0, 0.1];
  const mean = season.reduce((a, b) => a + b, 0) / 12;
  let natural = 7, c1 = 0, c2 = 0, trend = 460;
  const sample = [];
  for (let i = 0; i < 180; i++) {
    natural += 0.05 * normal();
    const c = 1.5 * c1 - 0.6 * c2 + 0.2 * normal(); c2 = c1; c1 = c;
    trend += 0.2 + 0.5 * normal();
    const date = new Date(Date.UTC(2005, i, 1)).toISOString().slice(0, 10);
    sample.push({ fecha: date, desempleo: natural + c + season[i % 12], imacec_ind_des: Math.exp((trend - 2 * c) / 100), imacec: null, ipc_mom: null, ipcsae_mom: null, ipc_yoy: null });
  }
  const sim = estimateNairu(sample);
  close(sim.parameters.okun, 2, 0.4);
  sim.seasonalFactors.forEach((v, i) => close(v, season[i] - mean, 0.15));
  close(sim.points.at(-1).filtered, natural, 0.6);
});

test("los factores estacionales requieren al menos un año completo fuera de la pandemia", () => {
  assert.throws(() => seasonalFactors(["2020-03-01", "2020-04-01"], [1, 2]), /estacionalidad/);
});

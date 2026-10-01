import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { estimateNairu } from "../lib/nairu.ts";

const rows = JSON.parse(readFileSync(new URL("../public/data/datos-mensuales.json", import.meta.url), "utf8"));
const close = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test("Kalman likelihood and RTS smoother match an independent matrix/scipy calculation", () => {
  // Reference: independent matrix Kalman implementation fitted with scipy L-BFGS-B.
  // Run only when the supplied August 2026 data fixture is unchanged.
  if (rows.length !== 140 || rows.at(-1).fecha !== "2026-08-01") return;
  const result = estimateNairu(rows);
  close(result.likelihood, -90.3402645826111, 0.00001);
  close(result.parameters.kappa, 0.00184358, 0.000001);
  close(result.parameters.rho, 0.36503626, 0.00001);
  close(result.points[0].smoothed, 6.4109189, 0.00001);
  close(result.points.at(-1).filtered, 6.41152162, 0.00001);
  assert.equal(result.weakSignal, true);
});

test("smoothing preserves the endpoint and does not increase conditional state variance", () => {
  const result = estimateNairu(rows);
  const latest = result.points.at(-1);
  assert.equal(latest.filtered, latest.smoothed);
  for (const point of result.points) {
    assert.ok(Number.isFinite(point.smoothed));
    assert.ok(point.smoothedLower <= point.smoothed && point.smoothed <= point.smoothedUpper);
    assert.ok(point.smoothedUpper - point.smoothedLower <= point.filteredUpper - point.filteredLower + 1e-9);
  }
});

test("unsorted rows give the same estimate", () => {
  assert.deepEqual(estimateNairu([...rows].reverse()), estimateNairu(rows));
});

test("rejects missing months, duplicate dates, short samples and invalid settings", () => {
  assert.throws(() => estimateNairu(rows.filter((_, i) => i !== 30)), /meses faltantes/);
  assert.throws(() => estimateNairu([...rows, rows[0]]), /duplicada/);
  assert.throws(() => estimateNairu(rows.slice(0, 40)), /al menos 60/);
  assert.throws(() => estimateNairu(rows, 0), /positiva/);
  assert.throws(() => estimateNairu(rows.map((r, i) => i === 30 ? { ...r, ipc_yoy: null } : r)), /meses faltantes/);
});

test("recovers a useful unemployment signal and a known NAIRU in synthetic data", () => {
  let seed = 123, inflation = 3, change = 0, nairu = 7;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const sample = [];
  for (let i = 0; i < 240; i++) {
    nairu += 0.025 * (random() - 0.5);
    const unemployment = nairu + 2 * Math.sin(i / 10) + 0.2 * (random() - 0.5);
    change = 0.35 * change - 0.25 * (unemployment - nairu) + 0.2 * (random() - 0.5);
    inflation += change;
    sample.push({ fecha: new Date(Date.UTC(2000, i, 1)).toISOString().slice(0, 10), desempleo: unemployment, ipc_yoy: inflation, imacec: null, ipc_mom: null, ipcsae_mom: null });
  }
  const result = estimateNairu(sample, 0.025);
  assert.equal(result.weakSignal, false);
  assert.ok(result.parameters.kappa > 0.15 && result.parameters.kappa < 0.4);
  close(result.points.at(-1).filtered, nairu, 0.2);
});

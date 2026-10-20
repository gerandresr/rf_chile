import test from "node:test";
import assert from "node:assert/strict";
import { estimateTaylor, taylorRate, DEFAULT_TAYLOR_PARAMETERS } from "../lib/taylor.ts";

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const months = Array.from({ length: 24 }, (_, i) => `${2024 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}-01`);
const monthly = months.map(fecha => ({ fecha, ipc_yoy: 3 }));
const daily = months.map(fecha => ({ fecha: fecha.slice(0, 7) + "-28", tpm: 4.25 }));
const zeroGaps = Object.fromEntries(months.map(m => [m, 0]));

test("con inflación en la meta y brecha cero la regla es la TPM neutral", () => {
  const { points } = estimateTaylor(monthly, daily, zeroGaps);
  assert.equal(points.length, 24);
  points.forEach(p => { close(p.taylor, 4.25); close(p.taylorLow, 3.75); close(p.taylorHigh, 4.75); close(p.difference, 0); });
});

test("pesos de Taylor (1993): 1,5 por inflación y 0,5 por brecha", () => {
  close(taylorRate(4, 0, DEFAULT_TAYLOR_PARAMETERS), 4.25 + 1.5);
  close(taylorRate(3, -2, DEFAULT_TAYLOR_PARAMETERS), 4.25 - 1);
});

test("la regla con inercia combina la TPM del mes anterior y la regla del mes", () => {
  const { points } = estimateTaylor(monthly.map(r => ({ ...r, ipc_yoy: 5 })), daily, zeroGaps);
  assert.equal(points[0].inertial, null);
  close(points[1].inertial, 0.85 * 4.25 + 0.15 * (4.25 + 3));
});

test("TPM usa el último dato válido del mes, sin importar el orden", () => {
  const readings = [...daily, { fecha: "2025-12-30", tpm: 5 }, { fecha: "2025-12-31", tpm: null }, { fecha: "2026-01-01", tpm: 99 }].reverse();
  const { points } = estimateTaylor([...monthly].reverse(), readings, zeroGaps);
  assert.equal(points.at(-1).tpm, 5);
  assert.equal(points.at(-1).tpmDate, "2025-12-30");
});

test("omite meses sin brecha, inflación o TPM, y valida parámetros", () => {
  const gaps = { ...zeroGaps }; delete gaps["2024-05-01"];
  assert.equal(estimateTaylor(monthly, daily, gaps).points.length, 23);
  assert.throws(() => estimateTaylor(monthly, [], zeroGaps), /simultáneamente/);
  assert.throws(() => estimateTaylor(monthly, daily, zeroGaps, { ...DEFAULT_TAYLOR_PARAMETERS, smoothing: 1 }), /inercia/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { estimateTaylor, hpTrend } from "../lib/taylor.ts";

const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const monthly = Array.from({ length: 48 }, (_, i) => ({ fecha: `${2020 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}-01`, imacec_ind_des: 100 * Math.exp(i * .002), ipc_yoy: 3 }));
const daily = monthly.map(row => ({ fecha: row.fecha.slice(0, 7) + "-28", tpm: 4.25 }));

test("HP preserves affine log trends and agrees with an independent NumPy solution", () => {
  const linear = Array.from({ length: 48 }, (_, i) => 4 + .002 * i);
  hpTrend(linear).forEach((value, i) => close(value, linear[i]));
  // Independent numpy.linalg.solve(I + lambda D'D, x), second differences D.
  const trend = hpTrend(Array.from({ length: 60 }, (_, i) => 4 + i * .003 + Math.sin(i / 4) * .03));
  close(trend[0], 4.007011643530868);
});

test("at target inflation and zero activity gap Taylor equals the neutral nominal rate", () => {
  const result = estimateTaylor(monthly, daily);
  result.points.forEach(point => { close(point.gap, 0); close(point.taylor, 4.25); close(point.difference, 0); });
  const changed = estimateTaylor(monthly.map(row => ({ ...row, ipc_yoy: 4 })), daily);
  changed.points.forEach(point => close(point.taylor, 5.75));
});

test("TPM uses latest valid reading of the same month, independent of input order", () => {
  const readings = [...daily, { fecha: "2023-12-30", tpm: 5 }, { fecha: "2023-12-31", tpm: null }, { fecha: "2024-01-01", tpm: 99 }].reverse();
  const result = estimateTaylor([...monthly].reverse(), readings);
  assert.equal(result.points.at(-1).tpm, 5);
  assert.equal(result.points.at(-1).tpmDate, "2023-12-30");
  const missingMonth = estimateTaylor(monthly, readings.filter(row => !row.fecha.startsWith("2023-12")));
  assert.equal(missingMonth.points.at(-1).date, "2023-11-01");
});

test("missing activity months are never treated as consecutive and invalid data is rejected", () => {
  assert.throws(() => estimateTaylor(monthly.filter(row => row.fecha !== "2022-01-01"), daily), /36 meses/);
  assert.throws(() => estimateTaylor(monthly.map(row => ({ ...row, imacec_ind_des: 0 })), daily), /36 meses/);
  assert.throws(() => estimateTaylor(monthly, []), /simultáneamente/);
});

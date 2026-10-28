import test from "node:test";
import assert from "node:assert/strict";
import { taylorEee } from "../lib/taylor-eee.ts";

const close = (a, b, tol) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const months = (from, n) => Array.from({ length: n }, (_, i) => { const d = new Date(`${from}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + i); return d.toISOString().slice(0, 10); });
const P = { neutralNominal: 4.25, inflationTarget: 3, inflationWeight: 0.5, activityWeight: 0.5, smoothing: 0.85 };
const ms = months("2025-01-01", 22);
const base = (inf12, inf24) => ({
  rows: ms.map(m => ({ month: m, inf12, inf24, tpm12: 4.5, pib: 2.5 })), pibLabel: "2027",
  tpmMonthly: ms.map(m => ({ month: m, value: 5 })), currentTpm: 5, currentTpmDate: "2026-10-28",
  market: months("2026-10-01", 13).map(m => ({ month: m, value: 4.75 })), marketSource: "test",
});

test("EEE en meta y brecha cero dan la neutral; la inercia converge desde la TPM", () => {
  const gaps = Object.fromEntries(ms.slice(0, 20).map(m => [m, 0]));
  const r = taylorEee(base(3, 3), gaps, P);
  close(r.today.taylor, 4.25, 1e-12);
  close(r.history[0].taylor, 4.25, 1e-12);
  close(r.in12.inertial, 4.25 + 0.75 * Math.pow(0.85, 12), 1e-9);
  assert.equal(r.in12.date, "2027-10-01");
  assert.equal(r.in12.eee, 4.5); assert.equal(r.in12.market, 4.75);
  close(r.meanAbsGap, 75, 1e-9);
});

test("el horizonte elige la serie: 12 meses vs. 24 meses", () => {
  const gaps = Object.fromEntries(ms.map(m => [m, 0]));
  close(taylorEee(base(4, 3), gaps, P, "12m").today.taylor, 4.25 + 1.5 * 1, 1e-12);
  close(taylorEee(base(4, 3), gaps, P, "24m").today.taylor, 4.25, 1e-12);
});

test("sin datos de encuesta para el horizonte, error", () => {
  const gaps = { "2025-01-01": 0 };
  assert.throws(() => taylorEee(base(3, null), gaps, P, "24m"), /24 meses/);
});

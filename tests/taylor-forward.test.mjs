import test from "node:test";
import assert from "node:assert/strict";
import { expectedInflation12m, gapPersistence, forwardTaylor } from "../lib/taylor-forward.ts";

const close = (a, b, tol) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const months = (from, n) => Array.from({ length: n }, (_, i) => { const d = new Date(`${from}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + i); return d.toISOString().slice(0, 10); });
const P = { neutralNominal: 4.25, inflationTarget: 3, inflationWeight: 0.5, activityWeight: 0.5, smoothing: 0.85 };

test("inflación esperada: IPC mensual constante compone a 12 meses", () => {
  const ipc = new Map(months("2026-01-01", 30).map(m => [m, 0.25]));
  const r = expectedInflation12m(ipc, "2026-01-01");
  close(r[0].value, 100 * (Math.pow(1.0025, 12) - 1), 1e-9);
  assert.equal(r.length, 30 - 12); // se detiene cuando faltan meses
});

test("persistencia de la brecha AR(1)", () => {
  const g = {}; months("2015-01-01", 130).forEach((m, i) => { g[m] = 3 * Math.pow(0.95, i); });
  close(gapPersistence(g), 0.95, 1e-9);
});

test("regla forward: inflación en meta y brecha cero dan la neutral; inercia converge desde la TPM", () => {
  const ms = months("2025-01-01", 40);
  const gaps = Object.fromEntries(ms.slice(0, 20).map(m => [m, 0]));
  const input = {
    asOf: "2026-10-15", icapDate: "2026-10-15",
    expected12m: months("2026-10-01", 19).map(m => ({ month: m, value: 3 })),
    expectedHistory: ms.slice(0, 20).map(m => ({ month: m, value: 3 })), expectedHistorySource: "test",
    tpmMonthly: ms.slice(0, 20).map(m => ({ month: m, value: 5 })),
    market: months("2026-10-01", 12).map(m => ({ month: m, value: 4.5 })),
    marketSource: "test", currentTpm: 5, lastIpcYoy: { month: "2026-09-01", value: 4 },
  };
  const r = forwardTaylor(input, gaps, P);
  for (const p of r.projection) close(p.taylor, 4.25, 1e-9);
  close(r.projection[0].inertial, 5, 1e-9);
  close(r.projection[1].inertial, 0.85 * 5 + 0.15 * 4.25, 1e-9);
  assert.ok(r.projection.at(-1).inertial < 4.4);
  assert.equal(r.projection.at(-1).market, null);
  close(r.backwardToday, 4.25 + 1.5 * 1, 1e-9);
  assert.equal(r.history.length, 20);
});

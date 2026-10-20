import test from "node:test";
import assert from "node:assert/strict";
import { carryRolldown, fitNelsonSiegel, nsYield, ufFactor, maturityFromCode } from "../lib/carry.ts";

const close = (a, b, tol) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test("vencimiento desde el nemotécnico", () => {
  assert.equal(maturityFromCode("BTP0600134"), "2034-01-01");
  assert.equal(maturityFromCode("BTU0300339"), "2039-03-01");
  assert.equal(maturityFromCode("XYZ"), null);
});

test("UF con IPC constante crece a esa tasa mensual", () => {
  const ipc = new Map(Array.from({ length: 24 }, (_, i) => [new Date(Date.UTC(2026, i, 1)).toISOString().slice(0, 10), 0.3]));
  close(ufFactor("2026-03-10", "2027-03-10", ipc), Math.pow(1.003, 12), 1e-12);
});

test("Nelson-Siegel recupera una curva conocida", () => {
  const truth = { beta: [6, -1.5, 1], tau: 2 };
  const pts = [1, 2, 3, 5, 7, 10, 15, 20, 30].map(t => ({ t, y: nsYield(truth, t) }));
  const fit = fitNelsonSiegel(pts);
  assert.ok(fit.rmseBp < 0.5, `rmse ${fit.rmseBp}`);
});

test("curva plana: roll-down cero y carry = devengo − financiamiento", () => {
  const bonds = ["BTP0500128", "BTP0500129", "BTP0500130", "BTP0500132", "BTP0500135", "BTP0500140"].map((code, i) => ({
    code, type: "BTP", maturity: maturityFromCode(code), yield: 5, macaulay: 1 + i * 2, dailyChangesBp: Array.from({ length: 80 }, (_, k) => (k % 2 ? 2 : -2)),
  }));
  const r = carryRolldown({ date: "2026-10-19", horizonMonths: 3, bonds, fundingRate: 4.5, ipcByMonth: new Map() });
  assert.ok(r.rows.length >= 4);
  for (const row of r.rows) {
    close(row.rollBp, 0, 1e-6);
    close(row.carryPct, row.accrualPct - row.fundingPct, 1e-12);
    close(row.totalPct, row.carryPct, 1e-6);
  }
});

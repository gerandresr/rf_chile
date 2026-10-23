import test from "node:test";
import assert from "node:assert/strict";
import { fitNss, nssYield, breakeven, zAndPercentile, fairValue } from "../lib/nss.ts";

const close = (a, b, tol) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test("NSS recupera una curva con joroba conocida", () => {
  const truth = { beta: [6, -2, -3, 1.5], tau1: 0.8, tau2: 4, rmseBp: 0 };
  const pts = [1, 1.5, 2, 3, 4, 5, 7, 10, 12, 15, 20, 25, 30].map(t => ({ t, y: nssYield(truth, t) }));
  const fit = fitNss(pts);
  assert.ok(fit && fit.rmseBp < 1, `rmse ${fit?.rmseBp}`);
  for (const t of [2, 5, 10, 20]) close(nssYield(fit, t), nssYield(truth, t), 0.02);
});

test("un bono desalineado no tuerce la curva (pesos robustos)", () => {
  const truth = { beta: [5, -1, 1, 0.5], tau1: 1.5, tau2: 6, rmseBp: 0 };
  const pts = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 30].map(t => ({ t, y: nssYield(truth, t) }));
  pts[5].y += 0.4; // 40 pb fuera de línea
  const fit = fitNss(pts);
  close(100 * (pts[5].y - nssYield(fit, pts[5].t)), 40, 8);
});

test("pocos puntos: sin ajuste", () => assert.equal(fitNss([{ t: 1, y: 5 }, { t: 2, y: 5 }]), null));

test("breakeven de Fisher y z-score", () => {
  close(breakeven(6, 2.5), 100 * (1.06 / 1.025 - 1), 1e-12);
  assert.deepEqual(zAndPercentile([1, 2, 3], 60), { z: null, pct: null });
  const s = Array.from({ length: 100 }, (_, i) => (i % 2 ? 1 : -1));
  s.push(3);
  const r = zAndPercentile(s, 60);
  assert.ok(r.z > 2.5 && r.pct > 99);
});

test("valor relativo: bono que se abarata gana z-score positivo", () => {
  const dates = Array.from({ length: 150 }, (_, i) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10));
  const curve = { beta: [6, -1, 0.5, 0.3], tau1: 1.2, tau2: 5, rmseBp: 0 };
  const codes = ["BTP0500128", "BTP0500129", "BTP0500130", "BTP0500132", "BTP0500134", "BTP0500136", "BTP0500140", "BTP0500145", "BTP0500150"];
  const years = c => (Date.UTC(2000 + Number(c.slice(-2)), 0, 1) - Date.parse("2025-03-01")) / 86400000 / 365.25;
  const bonds = codes.map((code, k) => ({
    code, type: "BTP", maturity: `20${code.slice(-2)}-01-01`, dates,
    tir: dates.map((_, i) => nssYield(curve, years(code)) + (k === 4 ? (i === dates.length - 1 ? 0.1 : 0.01 * Math.sin(i)) : 0.002 * Math.cos(i * (k + 1)))),
  }));
  const r = fairValue(bonds);
  const row = r.rows.find(x => x.code === "BTP0500134");
  assert.ok(row.residualBp > 5, `residuo ${row.residualBp}`);
  assert.ok(row.z > 3, `z ${row.z}`);
  assert.equal(r.curves.BTU, null);
  assert.equal(r.breakevens.length, 0);
});

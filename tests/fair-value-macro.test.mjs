import test from "node:test";
import assert from "node:assert/strict";
import { ols, halfLife, alignForward, macroFairValue } from "../lib/fair-value-macro.ts";

const close = (a, b, tol) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test("OLS recupera coeficientes conocidos", () => {
  const X = Array.from({ length: 200 }, (_, i) => [Math.sin(i), Math.cos(i / 3)]);
  const y = X.map(([a, b]) => 1 + 2 * a - 0.5 * b);
  const r = ols(X, y, true);
  close(r.beta[0], 1, 1e-9); close(r.beta[1], 2, 1e-9); close(r.beta[2], -0.5, 1e-9);
  close(r.r2, 1, 1e-9);
});

test("vida media de un AR(1) con phi 0,9", () => {
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5;
  const e = [0]; for (let i = 1; i < 20000; i++) e.push(0.9 * e[i - 1] + rnd());
  close(halfLife(e), Math.log(0.5) / Math.log(0.9), 0.8);
});

test("alineación hacia adelante con brecha máxima", () => {
  const s = new Map([["2026-01-01", 1], ["2026-01-20", 2]]);
  const a = alignForward(s, ["2026-01-02", "2026-01-15", "2026-01-21"], 7);
  assert.equal(a.get("2026-01-02"), 1); assert.equal(a.has("2026-01-15"), false); assert.equal(a.get("2026-01-21"), 2);
});

test("fair value: tasa construida con los factores tiene desvío ≈ shock final", () => {
  const dates = Array.from({ length: 700 }, (_, i) => new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10));
  const f = { tpm: new Map(), ust10: new Map(), cds: new Map(), copper: new Map(), usdclp: new Map() };
  const target = new Map();
  dates.forEach((d, i) => {
    const tpm = 5 + Math.sin(i / 50), ust = 4 + 0.5 * Math.cos(i / 37), cds = 60 + 10 * Math.sin(i / 23), cu = 400 * Math.exp(0.1 * Math.sin(i / 61)), fx = 900 * Math.exp(0.05 * Math.cos(i / 29));
    f.tpm.set(d, tpm); f.ust10.set(d, ust); f.cds.set(d, cds); f.copper.set(d, cu); f.usdclp.set(d, fx);
    const noise = 0.02 * Math.sin(i * 1.7);
    target.set(d, 2 + 0.3 * tpm + 0.6 * ust + 0.01 * cds + noise + (i === dates.length - 1 ? 0.25 : 0));
  });
  const r = macroFairValue(target, f, 300, 5);
  assert.ok(r.residualBp > 18 && r.residualBp < 30, `residuo ${r.residualBp}`);
  assert.ok(r.z > 3);
  close(r.coefficients.find(c => c.key === "ust10").bp, 60, 6);
  close(r.actualChangeBp, r.contributions.reduce((s, c) => s + c.bp, 0) + r.residualChangeBp, 1e-9);
});

import test from "node:test";
import assert from "node:assert/strict";
import { interpolateDeposit, latestDepositCurve } from "../lib/deposit-interpolation.ts";

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const pts = [{ days: 90, rate: -0.1 }, { days: 180, rate: 0.9 }, { days: 360, rate: 1.5 }];

test("interpolación lineal por días", () => {
  const r = interpolateDeposit(135, pts);
  close(r.rate, 0.4); assert.equal(r.left.days, 90); assert.equal(r.right.days, 180); assert.equal(r.extrapolated, false);
  close(interpolateDeposit(180, pts).rate, 0.9);
});

test("fuera de rango usa el extremo y lo marca", () => {
  const lo = interpolateDeposit(30, pts), hi = interpolateDeposit(400, pts);
  close(lo.rate, -0.1); assert.equal(lo.extrapolated, true);
  close(hi.rate, 1.5); assert.equal(hi.extrapolated, true);
  assert.equal(interpolateDeposit(null, pts), null);
  assert.equal(interpolateDeposit(0, pts), null);
});

test("curva: último día con todos los plazos", () => {
  const c = latestDepositCurve({
    90: { fecha: ["2026-10-22", "2026-10-23"], tir: [0.1, 0.2] },
    180: { fecha: ["2026-10-22", "2026-10-23"], tir: [0.3, null] },
  });
  assert.equal(c.date, "2026-10-22");
  assert.deepEqual(c.points.map(p => p.rate), [0.1, 0.3]);
});

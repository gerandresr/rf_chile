import test from "node:test";
import assert from "node:assert/strict";
import { interpolate, stats, meanReversion, meanReversionSeries, relativeCurves, residualScenario, distinctCurve, scenario, windowPoints, change } from "../lib/swap-spreads.ts";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const point = (date, spread) => ({ date, spread, durationSpread: spread + 3, yield: 5, swap: 5 - spread / 100, macaulay: 4.2, term: 5 });

test("interpolación no extrapola y admite nodos exactos", () => {
  const curve = [{ x: 5, y: 5 }, { x: 2, y: 4 }];
  close(interpolate(3.5, curve), 4.5);
  close(interpolate(2, curve), 4);
  assert.equal(interpolate(1, curve), null);
  assert.equal(interpolate(6, curve), null);
  assert.equal(interpolate(2, []), null);
});

test("estadísticas con dispersión muestral y percentil de empates", () => {
  const s = stats([1, 2, 3]);
  close(s.mean, 2); close(s.median, 2); close(s.sd, 1); close(s.z, 1); close(s.percentile, 100 * 2.5 / 3);
  assert.equal(stats([4, 4]).z, null);
  assert.equal(stats([]), null);
});

test("ventanas sin observaciones futuras y bases de cambio sin look-ahead", () => {
  const bond = { points: [point("2023-01-01", 10), point("2026-01-02", 20), point("2026-01-09", 30), point("2026-01-12", 25), point("2027-01-01", 99)] };
  const points = windowPoints(bond, 1, "2026-01-12", "maturity");
  assert.equal(points.length, 3);
  close(change(points, "maturity", 7), 5);
  close(change(points, "duration", 1), -5);
});

test("compresión de 20 pb con Dmod 3,5 aporta 0,70%", () => {
  const r = scenario({ y: 0, duration: 3.5, months: 3, rollBaseBp: 0, rollSpreadBp: 0, swapBp: 0, spreadBp: -20, ufPct: 0, costsBp: 0 });
  close(r.total, .7);
});

test("tasas y spread pueden compensarse; costos en pb de monto", () => {
  const r = scenario({ y: 0, duration: 3.5, months: 3, rollBaseBp: 0, rollSpreadBp: 0, swapBp: 20, spreadBp: -20, ufPct: 0, costsBp: 10 });
  close(r.total, -.1);
});

test("roll-down y convergencia hacia un objetivo final no se duplican", () => {
  const current = 30, rollSpreadBp = 5, finalTarget = 10;
  const neutral = current - rollSpreadBp;
  const r = scenario({ y: 0, duration: 3.5, months: 3, rollBaseBp: 0, rollSpreadBp, swapBp: 0, spreadBp: finalTarget - neutral, ufPct: 0, costsBp: 0 });
  close(r.rollSpread + r.convergence, .7);
});

test("devengo anual efectivo y conversión UF con término cruzado", () => {
  const r = scenario({ y: 4, duration: 3.5, months: 6, rollBaseBp: 0, rollSpreadBp: 0, swapBp: 0, spreadBp: 0, ufPct: 2, costsBp: 5 });
  close(r.carry, (Math.sqrt(1.04) - 1) * 100);
  close(r.total, (Math.sqrt(1.04) * 1.02 - 1) * 100 - .05);
});

function observations(n, phi) {
  let seed = 42, value = 20, d = new Date("2022-01-03T00:00:00Z");
  return Array.from({ length: n }, () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    value = 20 + phi * (value - 20) + (seed / 4294967296 - .5) * 6;
    const p = point(d.toISOString().slice(0, 10), value);
    do { d.setUTCDate(d.getUTCDate() + 1); } while ([0, 6].includes(d.getUTCDay()));
    return p;
  });
}

test("AR recupera reversión sintética y valida contra paseo aleatorio", () => {
  const r = meanReversion(observations(800, .8), "maturity", 3);
  assert.ok(r.stable); assert.ok(r.distinguishable); assert.ok(r.supported);
  assert.ok(Math.abs(r.phi - .8) < .06);
  assert.ok(Math.abs(r.mean - 20) < 1);
  assert.ok(r.halfLife > 1 && r.halfLife < 10);
  assert.ok(r.band > 0); assert.equal(r.tests, 60);
});

test("AR no fabrica señal para series constantes o muestras insuficientes", () => {
  assert.equal(meanReversion(observations(20, .8), "maturity", 3), null);
  assert.equal(meanReversion(observations(100, .8).map(p => ({ ...p, spread: 10 })), "maturity", 3), null);
});

test("datos posteriores no alteran un pronóstico histórico recortado", () => {
  const original = observations(400, .8), future = observations(800, .8);
  const cutoff = original.at(-1).date;
  const a = meanReversion(original, "maturity", 3);
  const b = meanReversion(future.filter(p => p.date <= cutoff), "maturity", 3);
  close(a.forecast, b.forecast); close(a.rmseAR, b.rmseAR);
});

function bond(code, currency, values, maturity = "2035-01-01") {
  return { code, currency, maturity, missing: 0, points: values.map(([date, term, spread]) => ({ ...point(date, spread), term, macaulay: term * 1.05, yield: 5, durationSpread: spread })) };
}

test("curva diaria excluye el papel de su propia referencia y no mezcla monedas", () => {
  const d = "2026-01-05";
  const universe = [bond("LEFT", "CLP", [[d, 1, 10]]), bond("MID", "CLP", [[d, 3, 35]]), bond("RIGHT", "CLP", [[d, 5, 50]]), bond("UF", "UF", [[d, 3, 999]])];
  const r = relativeCurves(universe), mid = r.bonds.find(b => b.code === "MID").points[0];
  close(mid.referenceSpread, 30); close(mid.residual, 5);
  close(mid.durationReferenceSpread, 30); close(mid.durationResidual, 5);
  universe[1].points[0].spread = 999;
  close(relativeCurves(universe).bonds[1].points[0].referenceSpread, 30);
  assert.equal(r.bonds[0].points[0].referenceSpread, null);
  assert.equal(r.bonds[2].points[0].referenceSpread, null);
  assert.equal(r.bonds[3].points[0].referenceSpread, null);
});

test("envejecimiento con curva estable: cae el spread bruto, no aparece desajuste", () => {
  const universe = [bond("LEFT", "CLP", [["2025-01-02", 2, 20], ["2026-01-02", 1, 10]]),
    bond("MID", "CLP", [["2025-01-02", 4, 40], ["2026-01-02", 3, 30]]),
    bond("RIGHT", "CLP", [["2025-01-02", 6, 60], ["2026-01-02", 5, 50]])];
  const r = relativeCurves(universe), middle = r.bonds[1].points;
  assert.ok(middle[1].spread < middle[0].spread);
  close(middle[0].residual, 0); close(middle[1].residual, 0);
  const fixed = r.constantSpreads.find(s => s.currency === "CLP" && s.tenor === 3);
  assert.equal(fixed.points.length, 2); fixed.points.forEach(p => close(p.spread, 30));
});

test("historia usa pares de cada fecha, incluidos bonos hoy vencidos", () => {
  const universe = [bond("OLD", "CLP", [["2023-01-02", 1, 10]], "2024-01-01"),
    bond("MID", "CLP", [["2023-01-02", 2, 25], ["2026-01-02", 2, 99]]),
    bond("RIGHT", "CLP", [["2023-01-02", 3, 30], ["2026-01-02", 3, 30]])];
  const middle = relativeCurves(universe).bonds[1].points;
  close(middle[0].referenceSpread, 20); close(middle[0].residual, 5);
  assert.equal(middle[1].referenceSpread, null); // no rellena OLD de una fecha anterior.
  universe[1].points[1].spread = 1000;
  close(relativeCurves(universe).bonds[1].points[0].referenceSpread, 20);
});

test("plazos constantes sin extrapolar y promediando vencimientos duplicados", () => {
  assert.deepEqual(distinctCurve([{ x: 2, y: 20 }, { x: 2, y: 30 }, { x: 4, y: 40 }]), [{ x: 2, y: 25 }, { x: 4, y: 40 }]);
  const r = relativeCurves([bond("A", "CLP", [["2026-01-02", 2, 20]]), bond("B", "CLP", [["2026-01-02", 4, 40]])]);
  assert.equal(r.constantSpreads.find(s => s.currency === "CLP" && s.tenor === 1).points.length, 0);
  assert.equal(r.constantSpreads.find(s => s.currency === "CLP" && s.tenor === 5).points.length, 0);
  close(r.constantSpreads.find(s => s.currency === "CLP" && s.tenor === 3).points[0].spread, 30);
});

test("roll-down conserva desajuste y convergencia cambia solo el desajuste", () => {
  const neutral = residualScenario(35, 30, 28, null);
  close(neutral.residual, 5); close(neutral.rollSpreadBp, 2); close(neutral.neutralSpread, 33); close(neutral.targetSpread, 33); close(neutral.convergenceBp, 0);
  const convergence = residualScenario(35, 30, 28, 1);
  close(convergence.targetSpread, 29); close(convergence.convergenceBp, -4);
  const r = scenario({ y: 0, duration: 3.5, months: 3, rollBaseBp: 0, rollSpreadBp: convergence.rollSpreadBp, swapBp: 0, spreadBp: convergence.convergenceBp, ufPct: 0, costsBp: 0 });
  close(r.rollSpread + r.convergence, 3.5 * (35 - 29) / 100);
});

test("AR sobre desajustes no interpreta envejecimiento lineal como reversión", () => {
  const observations = Array.from({ length: 150 }, (_, i) => ({ date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), value: 0 }));
  assert.equal(meanReversionSeries(observations, 3), null);
});

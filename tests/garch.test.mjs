import test from "node:test";
import assert from "node:assert/strict";
import { fitGarch11Yield } from "../lib/garch.ts";

function simulate(alpha, beta, n, seed = 11) {
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return (seed + 0.5) / 4294967296; };
  const normal = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
  const longRun = 16, omega = longRun * (1 - alpha - beta);
  let h = longRun, e = 0, y = 5;
  const obs = [{ date: "2015-01-01", value: y }];
  for (let i = 1; i <= n; i++) {
    h = omega + alpha * e * e + beta * h; e = Math.sqrt(h) * normal(); y += e / 100;
    obs.push({ date: new Date(Date.UTC(2015, 0, 1 + i)).toISOString().slice(0, 10), value: y });
  }
  return obs;
}

test("recupera α y β de un GARCH(1,1) simulado", () => {
  const r = fitGarch11Yield(simulate(0.1, 0.85, 4000));
  assert.ok(Math.abs(r.alpha - 0.1) < 0.04, `alpha ${r.alpha}`);
  assert.ok(Math.abs(r.beta - 0.85) < 0.06, `beta ${r.beta}`);
  assert.ok(Math.abs(r.excessKurtosis) < 0.5, `curtosis ${r.excessKurtosis}`);
});

test("pronóstico centrado en la yield actual, rangos ordenados y crecientes con el horizonte", () => {
  const r = fitGarch11Yield(simulate(0.08, 0.9, 1500));
  for (const f of r.forecasts) {
    assert.equal(f.expectedYield, r.latestYield);
    assert.ok(f.lower95 < f.lower68 && f.lower68 < f.expectedYield && f.expectedYield < f.upper68 && f.upper68 < f.upper95);
  }
  assert.ok(r.forecasts[0].cumulativeVolatilityBp < r.forecasts[1].cumulativeVolatilityBp && r.forecasts[1].cumulativeVolatilityBp < r.forecasts[2].cumulativeVolatilityBp);
  close5(r.forecasts[0].cumulativeVolatilityBp, r.nextDayVolatilityBp);
});
function close5(a, b) { assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`); }

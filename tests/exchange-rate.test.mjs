import test from "node:test";
import assert from "node:assert/strict";
import { exchangeRateSeries } from "../lib/exchange-rate.ts";
const month = i => new Date(Date.UTC(2015, i, 1)).toISOString().slice(0, 10);
const monthly = Array.from({ length: 121 }, (_, i) => ({ fecha: month(i), tc_real: i === 120 ? 110 : 100 }));

test("monthly dollar averages ignore nulls, zeroes and duplicate dates", () => {
  const rows = exchangeRateSeries(monthly, [
    { fecha: "2015-01-02", usdclp_obs: 500 }, { fecha: "2015-01-02", usdclp_obs: 600 },
    { fecha: "2015-01-05", usdclp_obs: 700 }, { fecha: "2015-01-06", usdclp_obs: null },
    { fecha: "2015-01-07", usdclp_obs: 0 }, { fecha: "2015-02-30", usdclp_obs: 900 },
    { fecha: "2025-02-03", usdclp_obs: 1000 },
  ]);
  assert.equal(rows[0].usdclp, 650); assert.equal(rows[0].dollarObservations, 2);
  assert.equal(rows[1].usdclp, null);
  assert.equal(rows.at(-1).tc_real, null); assert.equal(rows.at(-1).usdclp, 1000);
});
test("TCR reference uses exactly 120 prior months and excludes current value", () => {
  const rows = exchangeRateSeries(monthly, []);
  assert.ok(rows.slice(0, 120).every(r => r.gap === null));
  assert.equal(rows[120].reference, 100); assert.ok(Math.abs(rows[120].gap - 10) < 1e-10);
  assert.equal(rows[120].negative, 0); assert.ok(rows[120].positive > 0);
  const lower = exchangeRateSeries([...monthly.slice(0, 120), { fecha: month(120), tc_real: 90 }], []);
  assert.ok(lower[120].negative < 0); assert.equal(lower[120].positive, 0);
  const extended = exchangeRateSeries([...monthly, { fecha: month(121), tc_real: 999 }], []);
  assert.deepEqual(extended.slice(0, 121), rows);
});
test("a missing calendar month invalidates the reference instead of compressing time", () => {
  const rows = exchangeRateSeries(monthly.filter((_, i) => i !== 40), []);
  assert.equal(rows.at(-1).reference, null); assert.equal(rows.at(-1).gap, null);
});

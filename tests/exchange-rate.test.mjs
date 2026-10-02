import test from "node:test";
import assert from "node:assert/strict";
import { exchangeRateSeries } from "../lib/exchange-rate.ts";
const month = i => new Date(Date.UTC(2015, i, 1)).toISOString().slice(0, 10);
const monthly = Array.from({ length: 37 }, (_, i) => ({ fecha: month(i), tc_real: i === 36 ? 110 : 100 }));

test("monthly dollar selects latest valid date ignoring trailing missing days", () => {
  const rows = exchangeRateSeries(monthly, [
    { fecha: "2015-01-02", usdclp_obs: 500 }, { fecha: "2015-01-02", usdclp_obs: 600 },
    { fecha: "2015-01-05", usdclp_obs: 700 }, { fecha: "2015-01-06", usdclp_obs: null },
    { fecha: "2015-01-07", usdclp_obs: 0 }, { fecha: "2015-02-30", usdclp_obs: 900 },
    { fecha: "2025-02-03", usdclp_obs: 1000 },
  ]);
  assert.equal(rows[0].usdclp, 700); assert.equal(rows[0].dollarObservations, 2);
  assert.equal(rows[0].dollarDate, "2015-01-05");
  assert.equal(rows[1].usdclp, null);
  assert.equal(rows[1].dollarDate, null);
  assert.equal(rows.at(-1).tc_real, null); assert.equal(rows.at(-1).usdclp, 1000);
});
test("TCR reference uses exactly 36 prior months and excludes current value", () => {
  const rows = exchangeRateSeries(monthly, []);
  assert.ok(rows.slice(0, 36).every(r => r.gap === null));
  assert.equal(rows[36].reference, 100); assert.ok(Math.abs(rows[36].gap - 10) < 1e-10);
  assert.equal(rows[36].negative, 0); assert.ok(rows[36].positive > 0);
  const lower = exchangeRateSeries([...monthly.slice(0, 36), { fecha: month(36), tc_real: 90 }], []);
  assert.ok(lower[36].negative < 0); assert.equal(lower[36].positive, 0);
  const extended = exchangeRateSeries([...monthly, { fecha: month(37), tc_real: 999 }], []);
  assert.deepEqual(extended.slice(0, 37), rows);
});
test("a missing calendar month invalidates the reference instead of compressing time", () => {
  const rows = exchangeRateSeries(monthly.filter((_, i) => i !== 10), []);
  assert.equal(rows.at(-1).reference, null); assert.equal(rows.at(-1).gap, null);
});

test("latest monthly dollar is independent of input order", () => {
  const daily = [{ fecha: "2026-09-30", usdclp_obs: 970 }, { fecha: "2026-09-01", usdclp_obs: 900 }, { fecha: "2026-10-02", usdclp_obs: 983.84 }, { fecha: "2026-10-03", usdclp_obs: null }];
  const result = exchangeRateSeries([], daily);
  assert.deepEqual(exchangeRateSeries([], [...daily].reverse()), result);
  assert.equal(result[0].usdclp, 970); assert.equal(result[0].dollarDate, "2026-09-30");
  assert.equal(result[1].usdclp, 983.84); assert.equal(result[1].dollarDate, "2026-10-02");
});

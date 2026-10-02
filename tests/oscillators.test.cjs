const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
function load(path) {
  const m = new Module(path);
  m.require = name => name.startsWith('./') ? load(`lib/${name.slice(2)}.ts`) : require(name);
  m._compile(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText, path);
  return m.exports;
}
const { oscillatorValues } = load('lib/oscillators.ts');
const { backtestOscillator } = load('lib/oscillator-backtest.ts');
const date = i => new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10);
const series = values => values.map((value, i) => ({ date: date(i), value }));
const ascending = series(Array.from({ length: 70 }, (_, i) => i));
const stochastic = oscillatorValues(ascending, 'stochastic');
assert.ok(stochastic.slice(0, 15).every(v => v === null)); assert.equal(stochastic[15], 100);
assert.equal(oscillatorValues(series(Array(20).fill(4)), 'stochastic')[15], 50);
assert.equal(oscillatorValues(series(Array.from({ length: 20 }, (_, i) => 20 - i)), 'stochastic')[15], 0);
const z = oscillatorValues(ascending, 'zscore');
assert.ok(z.slice(0, 59).every(v => v === null));
assert.ok(Math.abs(z[59] - 29.5 / Math.sqrt((60 ** 2 - 1) / 12)) < 1e-12);
assert.equal(oscillatorValues(series(Array(65).fill(4)), 'zscore')[59], 0);
assert.deepEqual(oscillatorValues(ascending.slice(0, 62), 'zscore'), z.slice(0, 62));
const p = { start: date(0), end: date(90), entryLevel: 80, exitLevel: 50, exitMode: 'indicator', stopBp: 5, takeBp: 15, spreadBp: 1 };
const slowTrade = backtestOscillator(series(Array.from({ length: 20 }, (_, i) => 4 + i * .01).concat([3.8, 3.7, 3.6, 3.5])), p, 'stochastic').trades[0];
assert.equal(slowTrade.signalDate, date(15)); assert.equal(slowTrade.entryDate, date(16));
assert.equal(slowTrade.exitSignalDate, date(21)); assert.equal(slowTrade.exitDate, date(22));
assert.equal(slowTrade.reason, 'Slow Stochastic');
assert.ok(Math.abs(slowTrade.grossBp - slowTrade.netBp - 2) < 1e-9);
const zObs = series(Array(59).fill(4).concat([5, 5.1, 3, 2.9, 2.8]));
const zTrade = backtestOscillator(zObs, { ...p, entryLevel: 2, exitLevel: 0 }, 'zscore').trades[0];
assert.equal(zTrade.signalDate, date(59)); assert.equal(zTrade.entryDate, date(60));
assert.equal(zTrade.exitSignalDate, date(61)); assert.equal(zTrade.exitDate, date(62));
assert.equal(zTrade.reason, 'Z-score');
assert.ok(Math.abs(zTrade.grossBp - zTrade.netBp - 2) < 1e-9);
assert.doesNotThrow(() => backtestOscillator(zObs, { ...p, entryLevel: 2, exitLevel: -.5 }, 'zscore'));
assert.equal(backtestOscillator(zObs.slice(0, 20), { ...p, entryLevel: 2, exitLevel: 0 }, 'zscore').indicatorObservations, 0);
for (const mode of ['targets', 'combined']) {
  const r = backtestOscillator(zObs, { ...p, entryLevel: 2, exitLevel: 0, exitMode: mode }, 'zscore');
  assert.ok(r.trades.length); assert.ok(Number.isFinite(r.netBp));
}
console.log('Slow %K smoothing, flat ranges, Z-score formula, warm-up, next-close trades, spread and all exit modes passed.');

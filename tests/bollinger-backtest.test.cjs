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
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const p = { start: date(0), end: date(90), entryLevel: 100, exitLevel: 50, exitMode: 'indicator', stopBp: 5, takeBp: 15, spreadBp: 1 };
const ascending = series(Array.from({ length: 30 }, (_, i) => i + 1));
const values = oscillatorValues(ascending, 'bollinger-reversion');
assert.ok(values.slice(0, 19).every(v => v === null));
close(values[19], 100 * (20 - (10.5 - 2 * Math.sqrt(399 / 12))) / (4 * Math.sqrt(399 / 12)));
assert.deepEqual(oscillatorValues(ascending.slice(0, 25), 'bollinger-reversion'), values.slice(0, 25));
assert.ok(oscillatorValues(series(Array(25).fill(4)), 'bollinger-momentum').every(v => v === null));
const baseline = Array.from({ length: 20 }, (_, i) => 4 + (i % 2 ? .01 : -.01));
const reversal = series(baseline.concat([5, 4.9, 4.2, 4.1, 3.9, 3.8, 3.7]));
const reverseResult = backtestOscillator(reversal, p, 'bollinger-reversion');
assert.equal(reverseResult.trades.length, 1);
const r = reverseResult.trades[0];
assert.equal(r.signalDate, date(22)); assert.equal(r.entryDate, date(23));
assert.equal(r.exitSignalDate, date(23)); assert.equal(r.exitDate, date(24));
assert.equal(r.reason, 'Bollinger Bands'); close(r.grossBp - r.netBp, 2);
// Being outside the band is not enough: the oscillator waits for reentry.
assert.equal(backtestOscillator(reversal.slice(0, 22), p, 'bollinger-reversion').trades.length, 0);
const continuation = series(baseline.concat([3, 2.9, 3.8, 4, 4.1, 4.2]));
const mp = { ...p, entryLevel: 0, exitLevel: 50 };
const m = backtestOscillator(continuation, mp, 'bollinger-momentum').trades[0];
assert.equal(m.signalDate, date(20)); assert.equal(m.entryDate, date(21));
assert.equal(m.exitSignalDate, date(23)); assert.equal(m.exitDate, date(24));
close(m.grossBp - m.netBp, 2); assert.ok(m.netBp < 0);
assert.throws(() => backtestOscillator(continuation, { ...mp, exitLevel: -10 }, 'bollinger-momentum'));
assert.throws(() => backtestOscillator(reversal, { ...p, exitLevel: 110 }, 'bollinger-reversion'));
assert.doesNotThrow(() => backtestOscillator(reversal, { ...p, entryLevel: 110 }, 'bollinger-reversion'));
for (const strategy of ['bollinger-reversion', 'bollinger-momentum']) for (const exitMode of ['targets', 'combined']) {
  const result = backtestOscillator(strategy === 'bollinger-momentum' ? continuation : reversal, { ...(strategy === 'bollinger-momentum' ? mp : p), exitMode }, strategy);
  assert.ok(result.trades.length); assert.ok(Number.isFinite(result.netBp));
  assert.ok(result.trades[0].exitDate > result.trades[0].exitSignalDate);
}
console.log('Bollinger %B formula, warm-up, zero dispersion, prefix invariance, distinct entries/exits, next-close execution, costs and risk exits passed.');

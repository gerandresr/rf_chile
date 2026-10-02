const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
function load(path) {
  const target = new Module(path);
  target.require = name => name === './technicals' ? load('lib/technicals.ts') : require(name);
  target._compile(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText, path);
  return target.exports;
}
const { backtestRsi } = load('lib/rsi-backtest.ts');
const date = i => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
const observations = tail => Array.from({ length: 15 }, (_, i) => 4 + i * 0.01).concat(tail).map((value, i) => ({ date: date(i), value }));
const p = { start: date(0), end: date(30), entryRsi: 70, exitRsi: 50, exitMode: 'targets', stopBp: 5, takeBp: 15, costBp: 1 };
const take = backtestRsi(observations([4.2, 4.04, 4.0, 4.01]), p);
assert.equal(take.trades.length, 1);
const trade = take.trades[0];
assert.equal(trade.signalDate, date(14)); assert.equal(trade.entryDate, date(15));
assert.equal(trade.entryYield, 4.2); assert.equal(trade.exitSignalDate, date(16));
assert.equal(trade.exitDate, date(17)); assert.equal(trade.reason, 'Take profit');
assert.ok(Math.abs(trade.grossBp - 20) < 1e-9); assert.ok(Math.abs(take.netBp - 19) < 1e-9);
assert.equal(take.equity.at(-1).netBp, take.netBp); assert.equal(take.winRate, 100);
const stop = backtestRsi(observations([4.2, 4.25, 4.3, 4.31]), p);
assert.equal(stop.trades[0].reason, 'Stop loss');
assert.ok(Math.abs(stop.netBp + 11) < 1e-9); assert.ok(stop.drawdown >= 11 - 1e-9);
const rsi = backtestRsi(observations([4.2, 3.8, 3.7, 3.6]), { ...p, exitMode: 'rsi' });
assert.equal(rsi.trades[0].reason, 'RSI'); assert.equal(rsi.trades[0].exitDate, date(17));
const combined = backtestRsi(observations([4.2, 3.8, 3.7, 3.6]), { ...p, exitMode: 'combined' });
assert.equal(combined.trades[0].reason, 'Take profit');
const final = backtestRsi(observations([4.2, 4.21]), p);
assert.equal(final.trades[0].reason, 'Fin del período'); assert.equal(final.trades[0].exitDate, date(16));
assert.equal(backtestRsi(observations([4.2]), p).trades.length, 0); // No buy on final observation.
assert.equal(backtestRsi(observations([4.2, 4.0]), { ...p, start: date(15) }).trades.length, 0); // No pre-window signal.
assert.equal(backtestRsi(observations([]).slice(0, 10), p).rsiObservations, 0);
assert.equal(backtestRsi([], p).trades.length, 0);
assert.throws(() => backtestRsi([], { ...p, stopBp: 0 }));
assert.throws(() => backtestRsi([], { ...p, start: date(20), end: date(10) }));
assert.doesNotThrow(() => backtestRsi([], { ...p, entryRsi: 40, exitRsi: 50 })); // Hidden RSI exit is irrelevant in targets mode.
// Adding future observations must not change earlier mark-to-market results.
const prefix = observations([4.2, 4.04, 4.0, 4.01]);
const future = backtestRsi(prefix.concat([{ date: date(19), value: 20 }]), { ...p, end: date(19) });
assert.deepEqual(future.equity.filter(o => o.date < date(18)), take.equity.filter(o => o.date < date(18)));
console.log('RSI entries, next-close execution, stop gaps, all exits, costs, drawdown, range and no look-ahead passed.');

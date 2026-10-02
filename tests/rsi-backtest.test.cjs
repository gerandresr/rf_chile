const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
function load(path) {
  const target = new Module(path);
  target.require = name => name.startsWith('./') ? load(`lib/${name.slice(2)}.ts`) : require(name);
  target._compile(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText, path);
  return target.exports;
}
const { backtestOscillator } = load('lib/oscillator-backtest.ts');
const date = i => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
const observations = tail => Array.from({ length: 15 }, (_, i) => 4 + i * 0.01).concat(tail).map((value, i) => ({ date: date(i), value }));
const p = { start: date(0), end: date(30), entryLevel: 70, exitLevel: 50, exitMode: 'targets', stopBp: 5, takeBp: 15, spreadBp: 0 };
const take = backtestOscillator(observations([4.2, 4.04, 4.0, 4.01]), p);
assert.equal(take.trades.length, 1);
const trade = take.trades[0];
assert.equal(trade.signalDate, date(14)); assert.equal(trade.entryDate, date(15));
assert.equal(trade.entryYield, 4.2); assert.equal(trade.exitSignalDate, date(16));
assert.equal(trade.exitDate, date(17)); assert.equal(trade.reason, 'Take profit');
assert.ok(Math.abs(trade.grossBp - 20) < 1e-9); assert.ok(Math.abs(take.netBp - 20) < 1e-9);
assert.equal(take.equity.at(-1).netBp, take.netBp); assert.equal(take.winRate, 100);
const stop = backtestOscillator(observations([4.2, 4.25, 4.3, 4.31]), p);
assert.equal(stop.trades[0].reason, 'Stop loss');
assert.ok(Math.abs(stop.netBp + 10) < 1e-9); assert.ok(stop.drawdown >= 10 - 1e-9);
const rsi = backtestOscillator(observations([4.2, 3.8, 3.7, 3.6]), { ...p, exitMode: 'indicator' });
assert.equal(rsi.trades[0].reason, 'RSI'); assert.equal(rsi.trades[0].exitDate, date(17));
const combined = backtestOscillator(observations([4.2, 3.8, 3.7, 3.6]), { ...p, exitMode: 'combined' });
assert.equal(combined.trades[0].reason, 'Take profit');
const final = backtestOscillator(observations([4.2, 4.21]), p);
assert.equal(final.trades[0].reason, 'Fin del período'); assert.equal(final.trades[0].exitDate, date(16));
assert.equal(backtestOscillator(observations([4.2]), p).trades.length, 0); // No buy on final observation.
assert.equal(backtestOscillator(observations([4.2, 4.0]), { ...p, start: date(15) }).trades.length, 0); // No pre-window signal.
assert.equal(backtestOscillator(observations([]).slice(0, 10), p).indicatorObservations, 0);
assert.equal(backtestOscillator([], p).trades.length, 0);
assert.throws(() => backtestOscillator([], { ...p, stopBp: 0 }));
assert.throws(() => backtestOscillator([], { ...p, start: date(20), end: date(10) }));
assert.doesNotThrow(() => backtestOscillator([], { ...p, entryLevel: 40, exitLevel: 50 })); // Hidden RSI exit is irrelevant in targets mode.
// Adding future observations must not change earlier mark-to-market results.
const prefix = observations([4.2, 4.04, 4.0, 4.01]);
const future = backtestOscillator(prefix.concat([{ date: date(19), value: 20 }]), { ...p, end: date(19) });
assert.deepEqual(future.equity.filter(o => o.date < date(18)), take.equity.filter(o => o.date < date(18)));
// Spread is a per-side adverse adjustment: buy yield falls, sell yield rises.
const withSpread = backtestOscillator(observations([4.2, 3.8, 3.7, 3.6]), { ...p, exitMode: 'indicator', spreadBp: 1 });
const adjusted = withSpread.trades[0];
assert.ok(Math.abs(adjusted.entryYield - 4.19) < 1e-9);
assert.ok(Math.abs(adjusted.exitYield - 3.71) < 1e-9);
assert.equal(adjusted.entryMarketYield, 4.2); assert.equal(adjusted.exitMarketYield, 3.7);
assert.ok(Math.abs(adjusted.grossBp - adjusted.netBp - 2) < 1e-9);
assert.ok(Math.abs(withSpread.equity.at(-1).netBp - withSpread.netBp) < 1e-9);
const netTarget = backtestOscillator(observations([4.2, 4.04, 4.0, 3.99, 3.98]), { ...p, spreadBp: 1 });
assert.equal(netTarget.trades[0].exitSignalDate, date(17)); // 16 gross bp minus 2 is below 15 net target.
assert.equal(netTarget.trades[0].exitDate, date(18));
const immediateStop = backtestOscillator(observations([4.2, 4.2, 4.2]), { ...p, spreadBp: 3 });
assert.equal(immediateStop.trades[0].reason, 'Stop loss');
assert.ok(Math.abs(immediateStop.netBp + 6) < 1e-9);
assert.throws(() => backtestOscillator([], { ...p, spreadBp: -1 }));
console.log('RSI entries, next-close execution, stop gaps, all exits, costs, drawdown, range and no look-ahead passed.');

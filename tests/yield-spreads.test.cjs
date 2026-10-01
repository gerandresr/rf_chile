const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const compiled = ts.transpileModule(fs.readFileSync('lib/yield-spreads.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const target = new Module('spreads'); target._compile(compiled, 'spreads.cjs');
const { spreadPair, yieldSpread } = target.exports;
const instrument = (type, year, month) => ({ code: `${type}${year}-${month}`, type, maturityYear: year, maturityMonth: month });
for (const type of ['BTP', 'BTU']) {
 const short = instrument(type, 2029, 3), long = instrument(type, 2029, 10);
 assert.equal(spreadPair(short, long).left, long.code);
 assert.equal(spreadPair(long, short).left, long.code);
 assert.equal(spreadPair(short, instrument(type, 2030, 1)).right, short.code);
 const equal = { ...short, code: 'equal' }; assert.equal(spreadPair(short, equal).left, short.code);
}
const btp = instrument('BTP', 2029, 1), btu = instrument('BTU', 2040, 1);
assert.equal(spreadPair(btp, btu).left, btp.code); assert.equal(spreadPair(btu, btp).left, btp.code);
const rows = [{ date: '2026-01-01', A: 5, B: 3 }, { date: '2026-01-02', A: 6, B: 3 }, { date: '2026-01-03', A: 7 }, { date: '2026-01-04', A: null, B: 4 }];
const spread = yieldSpread(rows, 'A', 'B'); assert.equal(spread.average, 250); assert.deepEqual(spread.points.map(p => p.spread), [200, 300, null, null]);
assert.equal(yieldSpread([], 'A', 'B').average, null); assert.equal(yieldSpread(rows, 'B', 'A').average, -250);
console.log('Spread rules, maturity ordering, basis points, missing dates and mean passed.');

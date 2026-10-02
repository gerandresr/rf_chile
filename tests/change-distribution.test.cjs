const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const compiled = ts.transpileModule(fs.readFileSync('lib/change-distribution.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const target = new Module('distribution'); target._compile(compiled, 'distribution.cjs');
const { changeDistribution, distributionPoints } = target.exports;
const d = changeDistribution('A', [-2, -1, 0, 1, 2, NaN, Infinity]);
assert.equal(d.count, 5); assert.equal(d.mean, 0); assert.equal(d.deviation, Math.sqrt(2.5));
const points = distributionPoints([d, changeDistribution('B', [3, 4, 5])]);
assert.ok(points.every(p => Number.isFinite(p.A) && p.A >= 0 && Number.isFinite(p.B)));
let area = 0;
for (let i = 1; i < points.length; i++) area += (points[i].x - points[i - 1].x) * (points[i].A + points[i - 1].A) / 2;
assert.ok(Math.abs(area - 1) < 0.005, `density integrates to ${area}`);
const symmetric = distributionPoints([d]);
assert.ok(Math.abs(symmetric[80].A - symmetric[220].A) < 1e-12);
for (const values of [[], [1], [0, 0, 0]]) {
  const flat = changeDistribution('flat', values);
  assert.equal(flat.bandwidth, null); assert.deepEqual(distributionPoints([flat]), []);
}
assert.equal(changeDistribution('zero', [0, 0, 0]).deviation, 0);
console.log('Density normalization, distinct instruments, zero changes and insufficient history passed.');

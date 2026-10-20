import test from "node:test";
import assert from "node:assert/strict";
import { impliedTpmPath, addBusinessDays, addMonths } from "../lib/tpm-path.ts";

const close = (a, b, tol) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const meetings = ["2026-10-27", "2026-12-15", "2027-01-26", "2027-03-30", "2027-04-27", "2027-06-15", "2027-07-27"];
const DAY = 86400000;
// Precio de un swap cero cupón dado un overnight escalonado (capitalización diaria).
function swapRate(valuation, months, levels, spreadBp) {
  const start = addBusinessDays(valuation, 2), end = addMonths(start, months);
  const effective = meetings.map(m => addBusinessDays(m, 1));
  let f = 1, rate = levels[0];
  for (let t = new Date(`${start}T00:00:00Z`).getTime(); t < new Date(`${end}T00:00:00Z`).getTime(); t += DAY) {
    const d = new Date(t).toISOString().slice(0, 10);
    const k = effective.filter(e => e <= d).length;
    rate = levels[k] ?? levels.at(-1);
    f *= 1 + (rate + spreadBp / 100) / 100 / 360;
  }
  const days = Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / DAY);
  return 100 * (f - 1) * 360 / days;
}

test("sin cambios esperados la trayectoria es plana en la TPM actual", () => {
  const quotes = [1, 2, 3, 6, 9, 12].map(m => ({ months: m, rate: swapRate("2026-10-20", m, [4.5], 0.2) }));
  const r = impliedTpmPath({ valuationDate: "2026-10-20", quotes, meetings, currentTpm: 4.5, spreadBp: 0.2 });
  r.path.forEach(p => close(p.expectedTpm, 4.5, 1e-6));
  r.fit.forEach(f => close(f.errorBp, 0, 1e-6));
});

test("recupera un alza de 25 pb en la próxima reunión", () => {
  const levels = [4.5, 4.75, 4.75, 4.75, 4.75, 4.75, 4.75, 4.75];
  const quotes = [1, 2, 3, 6, 9, 12].map(m => ({ months: m, rate: swapRate("2026-10-20", m, levels, 0) }));
  const r = impliedTpmPath({ valuationDate: "2026-10-20", quotes, meetings, currentTpm: 4.5, spreadBp: 0, smoothing: 1e-6 });
  close(r.nextMeetingProbability, 1, 0.05);
  close(r.path.at(-1).expectedTpm, 4.75, 0.01);
});

test("ignora plazos sobre 18 meses (cupones semestrales)", () => {
  assert.throws(() => impliedTpmPath({ valuationDate: "2026-10-20", quotes: [{ months: 24, rate: 5 }, { months: 36, rate: 5 }], meetings, currentTpm: 4.5, spreadBp: 0 }), /18 meses/);
});

import { meetingDistributions } from "../lib/tpm-path.ts";
test("distribución en grilla de 25 pb: reproduce la media y el árbol de la tabla tipo WIRP", () => {
  const path = [
    { meeting: "a", effective: "a", expectedTpm: 4.535, change: 0.035, cumulativeChange: 0.035 },
    { meeting: "b", effective: "b", expectedTpm: 4.60, change: 0.065, cumulativeChange: 0.10 },
    { meeting: "c", effective: "c", expectedTpm: 4.95, change: 0.35, cumulativeChange: 0.45 },
  ];
  const d = meetingDistributions(4.5, path);
  close(d[0].probabilities["4.50"], 0.86, 1e-9); close(d[0].probabilities["4.75"], 0.14, 1e-9);
  close(d[1].probabilities["4.50"], 0.86 * 0.74, 1e-9); close(d[1].probabilities["5.00"], 0.14 * 0.26, 1e-9);
  d.forEach((col, i) => {
    const probs = Object.entries(col.probabilities);
    close(probs.reduce((s, [, p]) => s + p, 0), 1, 1e-12);
    close(probs.reduce((s, [l, p]) => s + Number(l) * p, 0), path[i].expectedTpm, 1e-9);
  });
});

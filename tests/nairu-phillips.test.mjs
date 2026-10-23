import test from "node:test";
import assert from "node:assert/strict";
import { estimatePhillipsNairu, seasonalAdjust, buildQuarters } from "../lib/nairu-phillips.ts";

// Generador determinístico (para que el test no dependa del azar).
function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
function normal(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }

function simulate({ nairu, kappa, quarters = 60, seed = 7 }) {
  const r = rng(seed), rows = [];
  let g1 = 0, g2 = 0, piPrev = 3;
  for (let t = 0; t < quarters; t++) {
    const g = 1.3 * g1 - 0.5 * g2 + 0.5 * normal(r);
    const fx = 6 * normal(r);
    const pi = 0.8 * piPrev + 0.2 * 3 - kappa * g + 0.07 * fx + 0.3 * normal(r);
    const y = 2010 + Math.floor(t / 4), m = (t % 4) * 3 + 1;
    rows.push({ date: `${y}-${String(m).padStart(2, "0")}-01`, u: nairu + g, pi, pe: 3, fx });
    g2 = g1; g1 = g; piPrev = pi;
  }
  return rows;
}

test("recupera una NAIRU constante y una pendiente positiva", () => {
  const res = estimatePhillipsNairu(simulate({ nairu: 7, kappa: 0.6 }));
  const last = res.ml.points.at(-1);
  assert.ok(Math.abs(last.nairu - 7) < 0.8, `NAIRU ${last.nairu}`);
  assert.ok(last.lower < last.nairu && last.nairu < last.upper);
  assert.ok(res.ml.kappa > 0.2 && res.ml.kappa < 1.2, `kappa ${res.ml.kappa}`);
  assert.equal(res.grid.length, 9);
  assert.ok(res.kappaInterval[0] <= res.ml.kappa && res.ml.kappa <= res.kappaInterval[1]);
});

test("el ajuste estacional quita un patrón mensual fijo", () => {
  const dates = [], values = [];
  for (let i = 0; i < 60; i++) { const m = i % 12; dates.push(`${2015 + Math.floor(i / 12)}-${String(m + 1).padStart(2, "0")}-01`); values.push(8 + (m >= 5 && m <= 7 ? 0.6 : -0.2)); }
  const { adjusted } = seasonalAdjust(dates, values);
  const spread = Math.max(...adjusted.slice(12, 48)) - Math.min(...adjusted.slice(12, 48));
  assert.ok(spread < 0.05, `rango ${spread}`);
});

test("arma trimestres con expectativa rezagada un año y depreciación anual", () => {
  const monthly = [];
  for (let i = 0; i < 36; i++) monthly.push({ fecha: `${2015 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}-01`, desempleo: 8, ipc_yoy: 3 });
  const bei = new Map([["2015-02-15", 2.5], ["2016-02-15", 3.5]]);
  const fx = new Map([["2015-02-15", 100], ["2016-02-15", 110]]);
  const q = buildQuarters(monthly, bei, fx, "2016-01-01");
  assert.equal(q[0].date, "2016-01-01");
  assert.equal(q[0].pe, 2.5);
  assert.ok(Math.abs(q[0].fx - 100 * Math.log(1.1)) < 1e-9);
});

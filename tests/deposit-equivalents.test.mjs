import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ufKnots, ufOn, forwardRate, equivalenceContext, depositEquivalents } from "../lib/deposit-equivalents.ts";

const close = (a, b, tol) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const insurance = { fecha: "2026-10-23", datos: [
  { Tenor: Date.UTC(2026, 11, 9), Mid: 41524, IPC: 0.55 },
  { Tenor: Date.UTC(2027, 0, 8), Mid: 41720, IPC: 0.49 },
] };
const ipc = new Map([["2026-09-01", 0.4]]);
const ndf = { fecha: "2026-10-23", datos: [{ Tenor: "1m", Mid: -0.01, Dias: 33 }, { Tenor: "3m", Mid: -0.6, Dias: 95 }] };

test("UF: encadena hacia atrás con IPC del seguro y observado, e interpola geométricamente", () => {
  const k = ufKnots(insurance, ipc, "2026-10-23");
  assert.deepEqual(k.map(x => x.date), ["2026-10-09", "2026-11-09", "2026-12-09", "2027-01-09"]);
  close(k[1].uf, 41524 / 1.0055, 1e-9);
  close(k[0].uf, 41524 / 1.0055 / 1.004, 1e-9);
  close(ufOn("2026-10-23", k), k[0].uf * Math.pow(1.004, 14 / 31), 1e-9);
  close(ufOn("2026-11-09", k), k[1].uf, 1e-9);
});

test("forward: spot + puntos interpolados, 0 puntos a 0 días", () => {
  close(forwardRate(64, 995, ndf), 995 + (-0.01 + (-0.59) * (31 / 62)), 1e-12);
  close(forwardRate(10, 995, ndf), 995 - 0.01 * 10 / 33, 1e-12);
  assert.equal(forwardRate(200, 995, ndf), null);
});

test("DPF ↔ DPR: ida y vuelta consistente", () => {
  const ctx = equivalenceContext(insurance, ndf, ipc, 995.04);
  const a = depositEquivalents("DPF", 0.39, 60, ctx);
  close(a.clp30, 0.39, 1e-12);
  const b = depositEquivalents("DPR", a.uf, 60, ctx);
  close(b.clp30, 0.39, 1e-12);
  close(b.usd, a.usd, 1e-12);
});

test("cierre real del 23 oct 2026: valores revisados con el usuario", () => {
  const read = p => JSON.parse(fs.readFileSync(new URL(`../public/data/${p}`, import.meta.url), "utf8").replace(/^﻿/, ""));
  const ins = read("Closing_Icap/inflacion.json"), nd = read("Closing_Icap/ndf.json");
  if (ins.fecha !== "2026-10-23") return; // los archivos se actualizan a diario
  const obs = new Map(read("historico_bcentral/datos-mensuales.json").filter(r => typeof r.ipc_mom === "number").map(r => [r.fecha, r.ipc_mom]));
  const ctx = equivalenceContext(ins, nd, obs, 995.04);
  close(ctx.uf0, 41206.56, 0.01);
  const e = depositEquivalents("DPF", 0.436, 360, ctx);
  close(e.uf, 1.27, 0.01); close(e.usd, 5.61, 0.01);
  const r = depositEquivalents("DPR", 1.12, 250, ctx);
  close(r.clp30, 0.462, 0.001); close(r.usd, 5.89, 0.01);
});

import { swapCurve, swapAt, depositSwapSpread } from "../lib/deposit-equivalents.ts";

test("swap spread: DPF ×12 contra swap CLP y DPR directo contra swap UF", () => {
  const clp = swapCurve({ fecha: "2026-10-23", datos: [{ Tenor: "1m", Mid: 4.5 }, { Tenor: "3m", Mid: 4.6 }, { Tenor: "1.5y", Mid: 5 }] });
  assert.deepEqual(clp.map(p => p.days), [31, 92, 548]);
  close(swapAt(61.5, clp).rate, 4.55, 1e-12);
  const s = depositSwapSpread("DPF", 0.39, 92, clp);
  close(s.annual, 4.68, 1e-12); close(s.spreadBp, 8, 1e-9); assert.equal(s.extrapolated, false);
  const uf = swapCurve({ fecha: "2026-10-23", datos: [{ Tenor: "3m", Mid: -1.33 }, { Tenor: "6m", Mid: 0.28 }] });
  const r = depositSwapSpread("DPR", -0.07, 90, uf);
  close(r.spreadBp, 126, 1e-9); assert.equal(r.extrapolated, true);
});

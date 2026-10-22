import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapSwapCurve, discountAt, horizonDays, parSwapRate, swapAnnuity, tradeSizing, projectBondSwap } from "../lib/bond-swap.ts";

const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const quotes = [{ x: .25, y: 4.5 }, { x: .5, y: 4.6 }, { x: 1, y: 4.8 }, { x: 2, y: 5 }, { x: 5, y: 5.5 }, { x: 10, y: 5.8 }];
const nodes = bootstrapSwapCurve(quotes);
const sizing = tradeSizing(3000, 1000, 3, swapAnnuity(5, nodes));
const input = { sizing, days: 30, bondYield: 6, fixedSwap: 5.5, funding: 4.5, camera: 4.5, currency: "CLP", ufPct: 0,
  bondRollBp: 0, swapRollBp: 0, commonShockBp: 0, extraBondBp: 0, extraSwapBp: 0, convergenceBp: 0, costsCLP: 0 };

test("bootstrap reproduce todas las tasas par cotizadas", () => {
  for (const q of quotes) close(parSwapRate(q.x, nodes), q.y, 1e-9);
  assert.equal(discountAt(11, nodes), null);
  assert.equal(parSwapRate(11, nodes), null);
  close(discountAt(0, nodes), 1);
});

test("DV01 en USD produce VM bono, nominal a par y swap con el mismo riesgo", () => {
  close(sizing.bondDV01, 3000000);
  close(sizing.bondMarketValue, 10000000000);
  close(sizing.bondNominal, 10000000000);
  close(sizing.swapNominal * swapAnnuity(5, nodes) * .0001, 3000000);
  close(sizing.residualDV01, 0);
  const nonPar = tradeSizing(3000, 1000, 3, 4, 100, 95);
  close(nonPar.bondNominal * .95, nonPar.bondMarketValue);
});

test("cambiar 2y por 5y cambia nocional sin cambiar DV01 cubierto", () => {
  const two = tradeSizing(5000, 975, 3.4, swapAnnuity(2, nodes)), five = tradeSizing(5000, 975, 3.4, swapAnnuity(5, nodes));
  assert.ok(two.swapNominal > five.swapNominal);
  close(two.swapDV01, five.swapDV01); close(two.bondNominal, five.bondNominal);
});

test("alza paralela +5pb cancela los MTM con cobertura del 100%", () => {
  const p = projectBondSwap({ ...input, commonShockBp: 5 });
  close(p.bondMTM, -15000000); close(p.swapMTM, 15000000); close(p.bondMTM + p.swapMTM, 0);
  const base = projectBondSwap(input); close(p.total, base.total);
});

test("solo papel sube 5pb: pérdida de 15 millones; solo swap sube: ganancia", () => {
  const base = projectBondSwap(input);
  close(projectBondSwap({ ...input, extraBondBp: 5 }).total - base.total, -15000000);
  close(projectBondSwap({ ...input, extraSwapBp: 5 }).total - base.total, 15000000);
});

test("cobertura parcial deja DV01 neto y sensibilidad residual", () => {
  const s = tradeSizing(3000, 1000, 3, 4, 50), p = projectBondSwap({ ...input, sizing: s, commonShockBp: 5 });
  close(s.residualDV01, 1500000); close(p.bondMTM + p.swapMTM, -7500000);
});

test("carry paga fija, recibe Cámara y fondea solo el VM del bono", () => {
  const p = projectBondSwap(input), factor = Math.pow(1 + .045 / 360, 30) - 1;
  close(p.funding, -sizing.bondMarketValue * factor);
  close(p.fixedPaid, -sizing.swapNominal * .055 * 30 / 360);
  close(p.floatReceived, sizing.swapNominal * factor);
  close(p.carry, p.bondAccrual + p.funding + p.fixedPaid + p.floatReceived);
  close(p.total, p.carry);
});

test("bono y swap pueden tener roll-down de signo contrario sin duplicar convergencia", () => {
  const p = projectBondSwap({ ...input, bondRollBp: 2, swapRollBp: -1, convergenceBp: -3 });
  close(p.bondRoll, 6000000); close(p.swapRoll, -3000000); close(p.convergence, 9000000);
  close(p.total - p.carry, 12000000);
});

test("costos y breakeven están en CLP y pb de spread", () => {
  const base = projectBondSwap(input), p = projectBondSwap({ ...input, costsCLP: 1000000 });
  close(p.total, base.total - 1000000);
  close(p.spreadBreakevenBp * sizing.bondDV01, p.total);
});

test("reajuste UF convierte bono y pata Cámara real a CLP sin doble conteo", () => {
  const p = projectBondSwap({ ...input, currency: "UF", ufPct: 1 });
  const icp = Math.pow(1 + .045 / 360, 30);
  close(p.bondUF, sizing.bondMarketValue * .01, 1e-5);
  close(p.floatReceived, sizing.swapNominal * (icp - 1.01), 1e-5);
  close(p.fixedPaid, -sizing.swapNominal * .055 * 30 / 360 * 1.01, 1e-5);
  const shocked = projectBondSwap({ ...input, currency: "UF", ufPct: 1, commonShockBp: 5 });
  close(shocked.bondMTM + shocked.swapMTM, 0);
});

test("horizontes usan días reales y acotan fin de mes", () => {
  assert.equal(horizonDays("2026-10-21", 1), 31);
  assert.equal(horizonDays("2026-10-21", 3), 92);
  assert.equal(horizonDays("2026-01-31", 1), 28);
});

test("datos inválidos no producen nocionales ficticios; roll ausente marca total parcial", () => {
  assert.equal(tradeSizing(0, 1000, 3, 4), null);
  assert.equal(tradeSizing(3000, 0, 3, 4), null);
  assert.equal(tradeSizing(3000, 1000, 0, 4), null);
  assert.equal(tradeSizing(3000, 1000, 3, 0), null);
  const p = projectBondSwap({ ...input, bondRollBp: null }); assert.equal(p.completeRoll, false); assert.equal(p.bondRoll, null);
});

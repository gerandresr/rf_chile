import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { buildTable, toCsv, toXlsx } from "../lib/export-table.ts";

const a = { header: "A", values: new Map([["2026-01-05", 1], ["2026-01-06", 2], ["2026-01-09", 3], ["2026-02-02", 4]]) };
const b = { header: "B", values: new Map([["2026-01-06", 10], ["2026-01-31", 11]]) };

test("diaria: alinea por fecha sin rellenar", () => {
  const t = buildTable([a, b], { frequency: "daily" });
  assert.deepEqual(t.headers, ["Fecha", "A", "B"]);
  assert.deepEqual(t.rows[0], ["2026-01-05", 1, null]);
  assert.deepEqual(t.rows[1], ["2026-01-06", 2, 10]);
  assert.equal(t.rows.length, 5);
});

test("semanal y mensual toman el último dato del período, fechado al cierre", () => {
  const w = buildTable([a], { frequency: "weekly" });
  assert.deepEqual(w.rows, [["2026-01-09", 3], ["2026-02-06", 4]]);
  const m = buildTable([a, b], { frequency: "monthly" });
  assert.deepEqual(m.rows, [["2026-01-31", 3, 11], ["2026-02-28", 4, null]]);
});

test("filtra por período", () => {
  assert.deepEqual(buildTable([a], { frequency: "daily", from: "2026-01-06", to: "2026-01-09" }).rows.map(r => r[0]), ["2026-01-06", "2026-01-09"]);
});

test("CSV para Excel en español y estándar", () => {
  const t = buildTable([{ header: "X;1", values: new Map([["2026-01-05", 1.5]]) }], { frequency: "daily" });
  assert.equal(toCsv(t, true), "﻿Fecha;\"X;1\"\r\n2026-01-05;1,5\r\n");
  assert.equal(toCsv(t, false), "﻿Fecha,\"X;1\"\r\n2026-01-05,1.5\r\n");
});

test("XLSX: archivo zip válido con dos hojas y fechas como número de serie de Excel", () => {
  const t = buildTable([a], { frequency: "daily" });
  const files = unzipSync(toXlsx(t, [{ header: "A", name: "Serie A & co", source: "Test", unit: "%", frequency: "Diaria", notes: "" }]));
  assert.ok(files["xl/worksheets/sheet1.xml"] && files["xl/worksheets/sheet2.xml"] && files["[Content_Types].xml"]);
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /<c r="A2" s="1"><v>46027<\/v><\/c><c r="B2"><v>1<\/v><\/c>/);   // 2026-01-05
  assert.match(strFromU8(files["xl/worksheets/sheet2.xml"]), /Serie A &amp; co/);
});

test("mensual + diaria: una vez por mes o repetida, sobre las fechas diarias", () => {
  const daily = { header: "D", values: new Map([["2026-01-30", 1], ["2026-02-02", 2], ["2026-02-03", 3], ["2026-03-02", 4]]) };
  const monthly = { header: "M", monthly: true, values: new Map([["2026-01-01", 0.5], ["2026-02-01", 0.6], ["2026-03-01", 0.7]]) };
  const once = buildTable([daily, monthly], { frequency: "daily", monthlyMode: "once" });
  assert.deepEqual(once.rows, [["2026-01-30", 1, 0.5], ["2026-02-02", 2, 0.6], ["2026-02-03", 3, null], ["2026-03-02", 4, 0.7]]);
  const fill = buildTable([daily, monthly], { frequency: "daily", monthlyMode: "fill", from: "2026-02-02" });
  assert.deepEqual(fill.rows, [["2026-02-02", 2, 0.6], ["2026-02-03", 3, 0.6], ["2026-03-02", 4, 0.7]]);
  // Sin series diarias, las mensuales mantienen su fecha.
  assert.deepEqual(buildTable([monthly], { frequency: "daily" }).rows[0], ["2026-01-01", 0.5]);
});

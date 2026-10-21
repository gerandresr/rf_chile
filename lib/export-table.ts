import { strToU8, zipSync } from "fflate";

/** Una columna lista para exportar: valores por fecha (AAAA-MM-DD). */
export type ExportColumn = { header: string; values: Map<string, number> };
export type ExportMeta = { header: string; name: string; source: string; unit: string; frequency: string; notes: string };
export type Frequency = "daily" | "weekly" | "monthly";

const DAY = 86400000;
const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Clave del período: semana (viernes de cierre) o mes (fin de mes). */
function periodKey(date: string, frequency: Frequency) {
  if (frequency === "daily") return date;
  const d = new Date(`${date}T00:00:00Z`);
  if (frequency === "monthly") return iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  const offset = (5 - d.getUTCDay() + 7) % 7;        // días hasta el viernes
  return iso(toTime(date) + offset * DAY);
}

/**
 * Tabla ancha: una fila por fecha, una columna por serie. Sin relleno: si una serie no tiene
 * dato en una fecha, la celda queda vacía. Semanal y mensual toman el último dato de cada
 * período y fechan la fila al cierre del período (viernes / fin de mes).
 */
export function buildTable(columns: ExportColumn[], options: { from?: string; to?: string; frequency: Frequency }) {
  const { from = "0000-00-00", to = "9999-12-31", frequency } = options;
  const perColumn = columns.map(col => {
    const out = new Map<string, { date: string; value: number }>();
    for (const [date, value] of col.values) {
      if (date < from || date > to || !Number.isFinite(value)) continue;
      const key = periodKey(date, frequency), prev = out.get(key);
      if (!prev || date > prev.date) out.set(key, { date, value });
    }
    return out;
  });
  const dates = [...new Set(perColumn.flatMap(m => [...m.keys()]))].sort();
  const rows = dates.map(date => [date, ...perColumn.map(m => m.get(date)?.value ?? null)] as [string, ...(number | null)[]]);
  return { headers: ["Fecha", ...columns.map(c => c.header)], rows };
}

/** CSV. `excelChile`: separador ";" y coma decimal (Excel en español); si no, "," y punto. */
export function toCsv(table: ReturnType<typeof buildTable>, excelChile: boolean) {
  const sep = excelChile ? ";" : ",";
  const quote = (s: string) => /[";,\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const num = (v: number | null) => v === null ? "" : excelChile ? String(v).replace(".", ",") : String(v);
  const lines = [table.headers.map(quote).join(sep), ...table.rows.map(([d, ...vals]) => [d, ...vals.map(num)].join(sep))];
  return "﻿" + lines.join("\r\n") + "\r\n";      // BOM: Excel reconoce UTF-8 (tildes)
}

// ---------------- XLSX mínimo (OOXML) ----------------
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function colName(i: number) { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
const excelSerial = (date: string) => toTime(date) / DAY + 25569;   // días desde 1899-12-30
const str = (ref: string, s: string, style = 0) => `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${esc(s)}</t></is></c>`;

function sheetXml(header: string[], body: (string | number | null)[][], opts: { dateColumn?: boolean; widths: number[] }) {
  const cols = opts.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const rows: string[] = [`<row r="1">${header.map((h, i) => str(`${colName(i)}1`, h, 2)).join("")}</row>`];
  body.forEach((r, k) => {
    const n = k + 2;
    rows.push(`<row r="${n}">${r.map((v, i) => {
      const ref = `${colName(i)}${n}`;
      if (v === null || v === "") return "";
      if (i === 0 && opts.dateColumn && typeof v === "string") return `<c r="${ref}" s="1"><v>${excelSerial(v)}</v></c>`;
      return typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : str(ref, v);
    }).join("")}</row>`);
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" xSplit="${opts.dateColumn ? 1 : 0}" topLeftCell="${opts.dateColumn ? "B2" : "A2"}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${rows.join("")}</sheetData></worksheet>`;
}

export function toXlsx(table: ReturnType<typeof buildTable>, meta: ExportMeta[]) {
  const data = sheetXml(table.headers, table.rows, { dateColumn: true, widths: [12, ...table.headers.slice(1).map(h => Math.min(28, Math.max(11, h.length + 2)))] });
  const metaHeader = ["Columna", "Descripción", "Fuente", "Unidad", "Frecuencia original", "Notas"];
  const info = sheetXml(metaHeader, meta.map(m => [m.header, m.name, m.source, m.unit, m.frequency, m.notes]), { widths: [24, 36, 18, 16, 18, 60] });
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Datos" sheetId="1" r:id="rId1"/><sheet name="Descripción" sheetId="2" r:id="rId2"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
    "xl/worksheets/sheet1.xml": strToU8(data),
    "xl/worksheets/sheet2.xml": strToU8(info),
  };
  return zipSync(files, { level: 6 });
}

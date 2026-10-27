"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, Search, X } from "lucide-react";
import { AppShell } from "./AppShell";
import type { Catalog, CatalogSeries } from "@/lib/data-catalog.server";
import { buildTable, toCsv, toXlsx, type ExportColumn, type ExportMeta, type Frequency, type MonthlyMode } from "@/lib/export-table";

type Period = "1m" | "3m" | "1y" | "5y" | "all" | "custom";
type Format = "xlsx" | "csv-cl" | "csv";
// Descarga de series habilitada. Cambiar a false para deshabilitarla.
const DOWNLOAD_ENABLED = true;

const PERIODS: [Period, string][] = [["1m", "1M"], ["3m", "3M"], ["1y", "1A"], ["5y", "5A"], ["all", "Todo"]];
const BOND_FIELDS = [["tir", "TIR"], ["duracion", "Duración"], ["precio", "Precio"], ["convexidad", "Convexidad"]] as const;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const shortDate = (d: string) => d ? `${MONTHS[Number(d.slice(5, 7)) - 1]}-${d.slice(2, 4)}` : "—";
const fmtNum = (v: number | null) => v === null ? "" : new Intl.NumberFormat("es-CL", { maximumFractionDigits: 4 }).format(v);
const shift = (date: string, months: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10); };

/** Lee una serie del archivo ya descargado, para un campo dado. */
function extract(json: unknown, s: CatalogSeries, field: string): Map<string, number> {
  const out = new Map<string, number>();
  if (s.format === "rows") {
    for (const row of json as Record<string, unknown>[]) if (typeof row[field] === "number") out.set(row.fecha as string, row[field] as number);
    return out;
  }
  const obj = (json as Record<string, Record<string, unknown[]>>)[s.key];
  const dates = obj?.fecha as string[] | undefined, values = obj?.[field];
  if (!dates || !values) return out;
  dates.forEach((d, i) => { const v = values[i]; if (typeof v === "number" && Number.isFinite(v)) out.set(d, v); });
  return out;
}

export function DataDownloader({ catalog }: { catalog: Catalog }) {
  const byId = useMemo(() => new Map(catalog.groups.flatMap(g => g.series.map(s => [s.id, s] as const))), [catalog]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [period, setPeriod] = useState<Period>("1y");
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [fields, setFields] = useState<string[]>(["tir"]);
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [format, setFormat] = useState<Format>("xlsx");
  const [monthlyMode, setMonthlyMode] = useState<MonthlyMode>("once");
  const cache = useRef(new Map<string, unknown>());
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState("");

  const toggle = (id: string) => setSelected(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const addMany = (ids: string[]) => setSelected(list => [...list, ...ids.filter(id => !list.includes(id))]);
  const q = query.trim().toLowerCase();
  const groups = catalog.groups.map(g => ({ ...g, series: q ? g.series.filter(s => q.split(/\s+/).every(w => s.search.includes(w))) : g.series })).filter(g => g.series.length);

  // Descarga los archivos de las series seleccionadas (una vez cada uno).
  useEffect(() => {
    const files = [...new Set(selected.map(id => byId.get(id)!.file))].filter(f => !cache.current.has(f));
    if (!files.length) return;
    let cancelled = false;
    Promise.all(files.map(f => fetch(f).then(r => { if (!r.ok) throw new Error(f); return r.json(); }).then(j => cache.current.set(f, j))))
      .then(() => { if (!cancelled) setLoaded(n => n + 1); })
      .catch(() => { if (!cancelled) setError("No fue posible cargar alguna de las series. Intenta de nuevo."); });
    return () => { cancelled = true; };
  }, [selected, byId]);

  const series = selected.map(id => byId.get(id)!).filter(Boolean);
  const hasBonds = series.some(s => s.fields.length > 1);
  const lastDate = series.reduce((m, s) => s.last > m ? s.last : m, "");
  const firstDate = series.reduce((m, s) => !m || s.first < m ? s.first : m, "");
  const range = period === "custom" ? { from: from || undefined, to: to || undefined }
    : period === "all" || !lastDate ? {} : { from: shift(lastDate, period === "1m" ? -1 : period === "3m" ? -3 : period === "1y" ? -12 : -60) };
  const ready = series.every(s => cache.current.has(s.file));

  const { columns, meta } = useMemo(() => {
    const columns: ExportColumn[] = [], meta: ExportMeta[] = [];
    if (!ready) return { columns, meta };
    for (const s of series) {
      const json = cache.current.get(s.file);
      const chosen = s.fields.length > 1 ? s.fields.filter(f => fields.includes(f.key)) : s.fields;
      for (const f of chosen) {
        const header = s.fields.length > 1 ? `${s.id} ${f.label}` : s.label;
        columns.push({ header, values: extract(json, s, f.key), monthly: s.frequency === "Mensual" });
        meta.push({ header, name: s.fields.length > 1 ? `${s.label} · ${f.label}` : s.label, source: s.source, unit: f.unit, frequency: s.frequency,
          notes: s.id.startsWith("DPF_") ? "Tasa mensual (no anualizada)." : s.source === "Bloomberg" ? "Bloomberg repite el último valor en feriados chilenos." : s.frequency === "Mensual" ? "Dato mensual: corresponde al mes de la fecha de la fila (mes de referencia), no a la fecha de publicación." : "" });
      }
    }
    return { columns, meta };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, fields, ready, loaded]);
  const table = useMemo(() => buildTable(columns, { ...range, frequency, monthlyMode }), [columns, range.from, range.to, frequency, monthlyMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const mixedFrequencies = frequency !== "monthly" && series.some(s => s.frequency === "Mensual") && series.some(s => s.frequency === "Diaria");
  // Fechas que se muestran en los campos Desde/Hasta (las del atajo, o las elegidas).
  const shownFrom = period === "custom" ? from : (range.from ?? firstDate), shownTo = period === "custom" ? to : lastDate;

  const download = () => {
    if (!DOWNLOAD_ENABLED) return;
    const stamp = (table.rows.at(-1)?.[0] ?? lastDate).replace(/-/g, "");
    const name = `rfchilena_${stamp}.${format === "xlsx" ? "xlsx" : "csv"}`;
    const blob = format === "xlsx"
      ? new Blob([toXlsx(table, meta) as Uint8Array<ArrayBuffer>], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
      : new Blob([toCsv(table, format === "csv-cl")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <AppShell>
    <header className="page-head">
      <div><div className="eyebrow">Históricos</div><h1>Base de Datos</h1><p>Elige series, ajusta período y frecuencia, revisa y descarga en Excel o CSV.</p></div>
    </header>
    <div className="db-layout">
      <section className="panel db-picker">
        <div className="db-search"><Search size={16} aria-hidden="true" /><input type="search" placeholder="Buscar: 0600, usd, swap 10, ipc…" value={query} onChange={e => setQuery(e.target.value)} aria-label="Buscar series" /></div>
        <div className="db-shortcuts"><span>Atajos</span>{catalog.shortcuts.map(s => <button key={s.label} className="chip" onClick={() => addMany(s.ids)}>+ {s.label}</button>)}</div>
        {groups.map(g => {
          const isOpen = q ? true : !!open[g.name];
          const count = g.series.filter(s => selected.includes(s.id)).length;
          return <div key={g.name} className="db-group">
            <div className="db-group-head">
              <button className="db-group-toggle" aria-expanded={isOpen} onClick={() => setOpen(o => ({ ...o, [g.name]: !isOpen }))}>
                <ChevronDown size={16} className={isOpen ? "db-chevron open" : "db-chevron"} aria-hidden="true" />
                <span className="db-group-name">{g.name}</span>
                <span className="db-group-count">{count ? <b>{count} de {g.series.length}</b> : g.series.length}</span>
              </button>
              {isOpen && <button className="db-link" onClick={() => count === g.series.length ? setSelected(l => l.filter(id => !g.series.some(s => s.id === id))) : addMany(g.series.map(s => s.id))}>{count === g.series.length ? "Quitar todos" : "Todos"}</button>}
            </div>
            {isOpen && <ul className="db-list">{g.series.map(s => <li key={s.id}>
              <label className={selected.includes(s.id) ? "on" : ""}>
                <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
                <span className="db-name">{s.label}</span>
                <span className="db-meta">{s.detail !== s.label ? `${s.detail} · ` : ""}{s.source}</span>
                <span className="db-range">{shortDate(s.first)} → {shortDate(s.last)}</span>
              </label>
            </li>)}</ul>}
          </div>;
        })}
        {!groups.length && <p className="dash-note">Sin resultados para “{query}”.</p>}
      </section>

      <aside className="panel db-config">
        <div className="db-config-head"><h2>Selección</h2>{selected.length > 0 && <button className="db-link" onClick={() => setSelected([])}>Limpiar</button>}</div>
        {selected.length === 0 ? <p className="dash-note">Marca series en la lista o usa un atajo.</p>
          : <div className="db-chips">{series.map(s => <span key={s.id} className="db-chip">{s.fields.length > 1 ? s.id : s.label}<button aria-label={`Quitar ${s.label}`} onClick={() => toggle(s.id)}><X size={12} /></button></span>)}</div>}

        <div className="db-option"><label>Período</label>
          <div className="segmented">{PERIODS.map(([k, l]) => <button key={k} className={period === k ? "selected" : ""} aria-pressed={period === k} onClick={() => setPeriod(k)}>{l}</button>)}</div>
          <div className="db-dates">
            <label>Desde<input type="date" value={shownFrom} min={firstDate} max={lastDate} onChange={e => { setFrom(e.target.value); setTo(shownTo); setPeriod("custom"); }} /></label>
            <label>Hasta<input type="date" value={shownTo} min={firstDate} max={lastDate} onChange={e => { setTo(e.target.value); setFrom(shownFrom); setPeriod("custom"); }} /></label>
          </div>
          {period === "custom" && <p className="db-hint">Rango personalizado. Elige un atajo para volver a un período estándar.</p>}
        </div>
        {hasBonds && <div className="db-option"><label>Campos de bonos</label>
          <div className="db-checks">{BOND_FIELDS.map(([k, l]) => <label key={k}><input type="checkbox" checked={fields.includes(k)} onChange={() => setFields(f => f.includes(k) ? (f.length > 1 ? f.filter(x => x !== k) : f) : [...f, k])} />{l}</label>)}</div>
        </div>}
        <div className="db-option"><label>Frecuencia</label>
          <div className="segmented">{([["daily", "Diaria"], ["weekly", "Semanal"], ["monthly", "Mensual"]] as [Frequency, string][]).map(([k, l]) => <button key={k} className={frequency === k ? "selected" : ""} aria-pressed={frequency === k} onClick={() => setFrequency(k)}>{l}</button>)}</div>
        </div>
        {mixedFrequencies && <div className="db-option"><label>Series mensuales</label>
          <div className="segmented">{([["once", "Una vez por mes"], ["fill", "Repetir en el mes"]] as [MonthlyMode, string][]).map(([k, l]) => <button key={k} className={monthlyMode === k ? "selected" : ""} aria-pressed={monthlyMode === k} onClick={() => setMonthlyMode(k)}>{l}</button>)}</div>
          <p className="db-hint">{monthlyMode === "once" ? "El dato mensual va en el primer día con datos de su mes de referencia; el resto del mes queda vacío." : "El dato mensual se repite en todos los días de su mes de referencia."} Ojo: el IPC de un mes se publica a inicios del mes siguiente; para backtests conviene desfasarlo.</p>
        </div>}
        <div className="db-option"><label>Formato</label>
          <div className="segmented">{([["xlsx", "Excel"], ["csv-cl", "CSV (;)"], ["csv", "CSV (,)"]] as [Format, string][]).map(([k, l]) => <button key={k} className={format === k ? "selected" : ""} aria-pressed={format === k} onClick={() => setFormat(k)}>{l}</button>)}</div>
          <p className="db-hint">{format === "xlsx" ? "Hoja Datos + hoja Descripción con fuente y unidad de cada columna." : format === "csv-cl" ? "Separador ; y coma decimal: abre directo en Excel en español." : "Separador , y punto decimal: para Python, R u otros."}</p>
        </div>
        {error && <div className="model-notice" role="alert">{error}</div>}
        <button className="db-download" disabled={!DOWNLOAD_ENABLED || !selected.length || !ready || !table.rows.length} onClick={download} title={DOWNLOAD_ENABLED ? undefined : "Descarga deshabilitada"}>
          <Download size={16} aria-hidden="true" />
          {!DOWNLOAD_ENABLED ? "Descarga deshabilitada" : !selected.length ? "Elige al menos una serie" : !ready ? "Cargando datos…" : `Descargar ${columns.length} ${columns.length === 1 ? "columna" : "columnas"} · ${table.rows.length.toLocaleString("es-CL")} filas`}
        </button>
      </aside>
    </div>

    {selected.length > 0 && ready && <section className="panel">
      <div className="panel-head"><div><div className="eyebrow">Vista previa</div><h2>Últimas filas</h2></div>
        <span className="pill">{table.rows.length ? `${table.rows[0][0]} → ${table.rows.at(-1)![0]}` : "Sin datos en el período"}</span></div>
      <div className="table-wrap"><table className="db-preview">
        <thead><tr>{table.headers.map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{table.rows.slice(-10).reverse().map(r => <tr key={r[0]}>{r.map((v, i) => <td key={i}>{i === 0 ? v : fmtNum(v as number | null)}</td>)}</tr>)}</tbody>
      </table></div>
      <p className="dash-note">Una fila por fecha y una columna por serie. Las celdas vacías son días sin dato para esa serie (no se rellenan). Semanal y mensual toman el último dato de cada período, fechado al cierre (viernes o fin de mes).</p>
    </section>}
  </AppShell>;
}

module.exports = function marketCarryLoader(source) {
  let s = source;

  s = s.replace(
    'function MarketTable({ title, instruments, data }: { title: string; instruments: Instrument[]; data: RFData }) {',
    `function formatDuration(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function carry1d(yieldPct: number | null | undefined, tpmPct: number | null, duration: number | null | undefined) {
  if (yieldPct == null || tpmPct == null || duration == null || !Number.isFinite(duration) || duration === 0) return null;
  return (((yieldPct / 100) / 365 - (tpmPct / 100) / 360) / duration) * 10000;
}

function formatCarry(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : \`${value.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} bp\`;
}

function Carry({ value }: { value: number | null }) {
  if (value == null || !Number.isFinite(value)) return <span className="muted">—</span>;
  return <span className={value > 0 ? "good" : value < 0 ? "bad" : "muted"}>{formatCarry(value)}</span>;
}

function MarketDelta({ value }: { value: number | null }) {
  if (value == null) return <span className="muted">—</span>;
  return <span className={value < 0 ? "good" : value > 0 ? "bad" : "muted"}>{formatBp(value, 0)} bp</span>;
}

function MarketTable({ title, instruments, data, tpm }: { title: string; instruments: Instrument[]; data: RFData; tpm: number | null }) {`
  );

  s = s.replace(
    '<thead><tr><th>Instrumento</th><th>Venc.</th><th>Yield</th><th>Δ Día</th><th>MTD</th><th>YTD</th></tr></thead>',
    '<thead><tr><th>Instrumento</th><th>Duración</th><th>Yield</th><th>Carry 1d</th><th>Delta 1D</th><th>MTD</th><th>YTD</th></tr></thead>'
  );

  s = s.replace(
    `                  <td>{maturityLabel(inst)}</td>\n                  <td className="num strong">{formatPercent(s?.value, 3)}</td>\n                  <td className="num"><Change value={s?.d1 ?? null} /></td>\n                  <td className="num"><Change value={s?.mtd ?? null} /></td>\n                  <td className="num"><Change value={s?.ytd ?? null} /></td>`,
    `                  <td className="num">{formatDuration(inst.duration)}</td>\n                  <td className="num strong">{formatPercent(s?.value, 2)}</td>\n                  <td className="num"><Carry value={carry1d(s?.value, tpm, inst.duration)} /></td>\n                  <td className="num"><MarketDelta value={s?.d1 ?? null} /></td>\n                  <td className="num"><MarketDelta value={s?.mtd ?? null} /></td>\n                  <td className="num"><MarketDelta value={s?.ytd ?? null} /></td>`
  );

  s = s.replace(
    'const macroKpis = [\n  dailyTpmKpi(dailyMacroData),',
    'const latestTpm = [...dailyMacroData].reverse().find((row) => typeof row.tpm === "number")?.tpm ?? null;\n\nconst macroKpis = [\n  dailyTpmKpi(dailyMacroData),'
  );

  s = s.replace('<MarketTable title="Bonos de Gobierno en Pesos" instruments={btp} data={data} />','<MarketTable title="Bonos de Gobierno en Pesos" instruments={btp} data={data} tpm={latestTpm} />');
  s = s.replace('<MarketTable title="Bonos de Gobierno en UF" instruments={btu} data={data} />','<MarketTable title="Bonos de Gobierno en UF" instruments={btu} data={data} tpm={latestTpm} />');

  s = s.replace('type BenchmarkRow = { benchmark: string; yield: number | null; d1: number | null; mtd: number | null; ytd: number | null };','type BenchmarkRow = { benchmark: string; yield: number | null; d1: number | null; mtd: number | null; ytd: number | null };\ntype BenchmarkMode = "maturity" | "duration";');

  s = s.replace(
    'function benchmarkYield(data: RFData, type: "BTP" | "BTU", term: number, row: RFData["history"][number] | null) {\n  if (!row) return null;\n  return interpolateMarketYield(term, curveAtDate(data, type, row.date, row.values, type === "BTP"));\n}',
    `function benchmarkYield(data: RFData, type: "BTP" | "BTU", term: number, row: RFData["history"][number] | null, mode: BenchmarkMode) {
  if (!row) return null;
  if (mode === "maturity") return interpolateMarketYield(term, curveAtDate(data, type, row.date, row.values, type === "BTP"));
  const refDate = new Date(\`${row.date}T12:00:00\`);
  const points: CurvePoint[] = data.instruments
    .filter((inst) => inst.type === type && isActiveInstrument(inst, refDate) && (type !== "BTP" || (inst.coupon ?? 0) !== 0))
    .map((inst) => ({ term: inst.duration ?? 0, yield: typeof row.values[inst.code] === "number" ? row.values[inst.code] : null, code: inst.code, name: maturityLabel(inst) }))
    .filter((p) => p.term > 0 && p.yield != null)
    .sort((a, b) => a.term - b.term);
  return interpolateMarketYield(term, points);
}`
  );
  s = s.replace('function buildBenchmarkRows(data: RFData): BenchmarkRow[] {','function buildBenchmarkRows(data: RFData, mode: BenchmarkMode): BenchmarkRow[] {');
  s = s.replace(/benchmarkYield\(data, type, term, (current|d1Base|mtdBase|ytdBase)\)/g, 'benchmarkYield(data, type, term, $1, mode)');

  s = s.replace('function BenchmarkTable({ rows }: { rows: BenchmarkRow[] }) {','function BenchmarkTable({ rows, mode, onModeChange }: { rows: BenchmarkRow[]; mode: BenchmarkMode; onModeChange: (mode: BenchmarkMode) => void }) {');
  s = s.replace('<div><h2>Tasas Benchmark</h2></div>',`<div><h2>Tasas Benchmark</h2><div className="segmented" style={{ marginTop: 10 }}><button className={mode === "maturity" ? "selected" : ""} onClick={() => onModeChange("maturity")}>Por vencimiento</button><button className={mode === "duration" ? "selected" : ""} onClick={() => onModeChange("duration")}>Por duración</button></div></div>`);
  s = s.replace(
    '      </div>\n    </section>\n  );\n}\n\nfunction CurveTooltip',
    '      </div>\n      <div className="muted" style={{ textAlign: "center", marginTop: 10, fontSize: 12 }}>El benchmark en pesos no incluye letras en su composición.</div>\n    </section>\n  );\n}\n\nfunction CurveTooltip'
  );
  s = s.replace('const [compareDate, setCompareDate] = useState("");','const [compareDate, setCompareDate] = useState("");\n  const [benchmarkMode, setBenchmarkMode] = useState<BenchmarkMode>("maturity");');
  s = s.replace('const benchmarkRows = useMemo(() => data ? buildBenchmarkRows(data) : [], [data]);','const benchmarkRows = useMemo(() => data ? buildBenchmarkRows(data, benchmarkMode) : [], [data, benchmarkMode]);');
  s = s.replace('<BenchmarkTable rows={benchmarkRows} />','<BenchmarkTable rows={benchmarkRows} mode={benchmarkMode} onModeChange={setBenchmarkMode} />');

  return s;
};

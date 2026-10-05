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
  return value == null || !Number.isFinite(value) ? "—" : \`${'${value.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}'} bp\`;
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

  s = s.replace(
    '<MarketTable title="Bonos de Gobierno en Pesos" instruments={btp} data={data} />',
    '<MarketTable title="Bonos de Gobierno en Pesos" instruments={btp} data={data} tpm={latestTpm} />'
  );
  s = s.replace(
    '<MarketTable title="Bonos de Gobierno en UF" instruments={btu} data={data} />',
    '<MarketTable title="Bonos de Gobierno en UF" instruments={btu} data={data} tpm={latestTpm} />'
  );

  return s;
};

import { calculateTechnicals } from "./technicals";

export type BacktestParameters = {
  start: string; end: string; entryRsi: number; exitRsi: number;
  exitMode: "rsi" | "targets" | "combined";
  stopBp: number; takeBp: number; costBp: number;
};
export type Trade = {
  signalDate: string; entryDate: string; exitSignalDate: string; exitDate: string;
  entryYield: number; exitYield: number; grossBp: number; netBp: number;
  days: number; reason: "RSI" | "Stop loss" | "Take profit" | "Fin del período";
};

export function backtestRsi(input: { date: string; value: number }[], p: BacktestParameters) {
  if (!p.start || !p.end || p.start > p.end) throw new Error("Revisa las fechas del período.");
  if (![p.entryRsi, p.costBp].every(Number.isFinite) || p.entryRsi <= 0 || p.entryRsi >= 100 || p.costBp < 0
    || !["rsi", "targets", "combined"].includes(p.exitMode)
    || p.exitMode !== "targets" && (!Number.isFinite(p.exitRsi) || p.exitRsi < 0 || p.exitRsi >= p.entryRsi)
    || p.exitMode !== "rsi" && (![p.stopBp, p.takeBp].every(Number.isFinite) || p.stopBp <= 0 || p.takeBp <= 0))
    throw new Error("Revisa los niveles de RSI, stop, objetivo y costo.");
  // Warm up RSI using all earlier observations, but start the strategy flat.
  const obs = [...new Map(input.filter(o => Number.isFinite(o.value)).map(o => [o.date, o])).values()].sort((a, b) => a.date.localeCompare(b.date));
  const rsi = calculateTechnicals(obs, "rsi");
  const trades: Trade[] = [];
  const equity: { date: string; netBp: number }[] = [];
  let position: { signalDate: string; entryDate: string; entryYield: number } | null = null;
  let pending: { type: "buy"; signalDate: string } | { type: "sell"; signalDate: string; reason: Trade["reason"] } | null = null;
  let realized = 0, peak = 0, drawdown = 0;
  const eligible = obs.map((o, i) => ({ ...o, i })).filter(o => o.date >= p.start && o.date <= p.end);
  const close = (o: { date: string; value: number }, signalDate: string, reason: Trade["reason"]) => {
    if (!position) return;
    const grossBp = (position.entryYield - o.value) * 100;
    const netBp = grossBp - p.costBp;
    trades.push({ ...position, exitSignalDate: signalDate, exitDate: o.date, exitYield: o.value, grossBp, netBp,
      days: Math.round((Date.parse(o.date) - Date.parse(position.entryDate)) / 86400000), reason });
    realized += netBp; position = null;
  };
  for (let k = 0; k < eligible.length; k++) {
    const o = eligible[k], last = k === eligible.length - 1;
    let exited = false;
    // Every signal executes at the next available close, never at its own close.
    if (pending?.type === "buy" && !last) position = { signalDate: pending.signalDate, entryDate: o.date, entryYield: o.value };
    if (pending?.type === "sell") { close(o, pending.signalDate, pending.reason); exited = true; }
    pending = null;
    const currentRsi = rsi[o.i].rsi;
    const previousRsi = o.i > 0 ? rsi[o.i - 1].rsi : null;
    if (position && !last) {
      const movement: number = (position.entryYield - o.value) * 100;
      const reason: Trade["reason"] | null = p.exitMode !== "rsi" && movement <= -p.stopBp + 1e-9 ? "Stop loss"
        : p.exitMode !== "rsi" && movement >= p.takeBp - 1e-9 ? "Take profit"
        : p.exitMode !== "targets" && typeof currentRsi === "number" && currentRsi <= p.exitRsi ? "RSI" : null;
      if (reason) pending = { type: "sell", signalDate: o.date, reason };
    } else if (!position && !exited && !last && typeof currentRsi === "number" && currentRsi >= p.entryRsi
      && (previousRsi === null || typeof previousRsi === "number" && previousRsi < p.entryRsi)) {
      pending = { type: "buy", signalDate: o.date };
    }
    // An open position is liquidated at the last available close in the range.
    if (last && position) close(o, o.date, "Fin del período");
    const netBp = realized + (position ? (position.entryYield - o.value) * 100 - p.costBp : 0);
    peak = Math.max(peak, netBp); drawdown = Math.max(drawdown, peak - netBp);
    equity.push({ date: o.date, netBp });
  }
  const winners = trades.filter(t => t.netBp > 0).length;
  return { trades, equity, netBp: realized, grossBp: trades.reduce((s, t) => s + t.grossBp, 0), drawdown,
    winRate: trades.length ? winners / trades.length * 100 : null,
    averageBp: trades.length ? realized / trades.length : null,
    rsiObservations: eligible.filter(o => typeof rsi[o.i].rsi === "number").length };
}

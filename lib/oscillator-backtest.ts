import { Oscillator, oscillatorOptions, oscillatorValues } from "./oscillators";

export type BacktestParameters = {
  start: string; end: string; entryLevel: number; exitLevel: number;
  exitMode: "indicator" | "targets" | "combined";
  stopBp: number; takeBp: number; spreadBp: number;
};
export type Trade = {
  signalDate: string; entryDate: string; exitSignalDate: string; exitDate: string;
  entryYield: number; exitYield: number; entryMarketYield: number; exitMarketYield: number; grossBp: number; netBp: number;
  days: number; reason: "RSI" | "Slow Stochastic" | "Z-score" | "Bollinger Bands" | "Stop loss" | "Take profit" | "Fin del período";
};

export function backtestOscillator(input: { date: string; value: number }[], p: BacktestParameters, oscillator: Oscillator = "rsi") {
  const option = oscillatorOptions.find(o => o.id === oscillator);
  if (!option) throw new Error("Oscilador inválido.");
  if (!p.start || !p.end || p.start > p.end) throw new Error("Revisa las fechas del período.");
  const bollinger = oscillator.startsWith("bollinger-");
  const momentum = oscillator === "bollinger-momentum";
  const bounded = oscillator === "rsi" || oscillator === "stochastic";
  if (![p.entryLevel, p.spreadBp].every(Number.isFinite) || bounded && (p.entryLevel <= 0 || p.entryLevel >= 100) || p.spreadBp < 0
    || !["indicator", "targets", "combined"].includes(p.exitMode)
    || p.exitMode !== "targets" && (!Number.isFinite(p.exitLevel) || bounded && p.exitLevel < 0 || (momentum ? p.exitLevel <= p.entryLevel : p.exitLevel >= p.entryLevel))
    || p.exitMode !== "indicator" && (![p.stopBp, p.takeBp].every(Number.isFinite) || p.stopBp <= 0 || p.takeBp <= 0))
    throw new Error("Revisa los niveles del indicador, stop, objetivo y spread. La salida debe ser mayor que la entrada en momentum y menor en los osciladores.");
  // Warm up the oscillator using all earlier observations, but start the strategy flat.
  const obs = [...new Map(input.filter(o => Number.isFinite(o.value)).map(o => [o.date, o])).values()].sort((a, b) => a.date.localeCompare(b.date));
  const values = oscillatorValues(obs, oscillator);
  const trades: Trade[] = [];
  const equity: { date: string; netBp: number }[] = [];
  let position: { signalDate: string; entryDate: string; entryYield: number; entryMarketYield: number } | null = null;
  let pending: { type: "buy"; signalDate: string } | { type: "sell"; signalDate: string; reason: Trade["reason"] } | null = null;
  let realized = 0, peak = 0, drawdown = 0;
  const eligible = obs.map((o, i) => ({ ...o, i })).filter(o => o.date >= p.start && o.date <= p.end);
  const close = (o: { date: string; value: number }, signalDate: string, reason: Trade["reason"]) => {
    if (!position) return;
    const exitYield = o.value + p.spreadBp / 100;
    const grossBp = (position.entryMarketYield - o.value) * 100;
    const netBp = (position.entryYield - exitYield) * 100;
    trades.push({ ...position, exitSignalDate: signalDate, exitDate: o.date, exitYield, exitMarketYield: o.value, grossBp, netBp,
      days: Math.round((Date.parse(o.date) - Date.parse(position.entryDate)) / 86400000), reason });
    realized += netBp; position = null;
  };
  for (let k = 0; k < eligible.length; k++) {
    const o = eligible[k], last = k === eligible.length - 1;
    let exited = false;
    // Every signal executes at the next available close, never at its own close.
    if (pending?.type === "buy" && !last) position = { signalDate: pending.signalDate, entryDate: o.date, entryYield: o.value - p.spreadBp / 100, entryMarketYield: o.value };
    if (pending?.type === "sell") { close(o, pending.signalDate, pending.reason); exited = true; }
    pending = null;
    const currentValue = values[o.i];
    const previousValue = o.i > 0 ? values[o.i - 1] : null;
    if (position && !last) {
      const movement: number = (position.entryYield - (o.value + p.spreadBp / 100)) * 100;
      const reason: Trade["reason"] | null = p.exitMode !== "indicator" && movement <= -p.stopBp + 1e-9 ? "Stop loss"
        : p.exitMode !== "indicator" && movement >= p.takeBp - 1e-9 ? "Take profit"
        : p.exitMode !== "targets" && typeof currentValue === "number" && (momentum ? currentValue >= p.exitLevel : currentValue <= p.exitLevel) ? option.name as Trade["reason"] : null;
      if (reason) pending = { type: "sell", signalDate: o.date, reason };
    } else if (!position && !exited && !last && typeof currentValue === "number"
      && (bollinger
        ? typeof previousValue === "number" && (momentum
          ? previousValue >= p.entryLevel && currentValue < p.entryLevel
          : previousValue > p.entryLevel && currentValue <= p.entryLevel)
        : currentValue >= p.entryLevel && (previousValue === null || typeof previousValue === "number" && previousValue < p.entryLevel))) {
      pending = { type: "buy", signalDate: o.date };
    }
    // An open position is liquidated at the last available close in the range.
    if (last && position) close(o, o.date, "Fin del período");
    const netBp = realized + (position ? (position.entryYield - (o.value + p.spreadBp / 100)) * 100 : 0);
    peak = Math.max(peak, netBp); drawdown = Math.max(drawdown, peak - netBp);
    equity.push({ date: o.date, netBp });
  }
  const winners = trades.filter(t => t.netBp > 0).length;
  return { trades, equity, netBp: realized, grossBp: trades.reduce((s, t) => s + t.grossBp, 0), drawdown,
    winRate: trades.length ? winners / trades.length * 100 : null,
    averageBp: trades.length ? realized / trades.length : null,
    indicatorObservations: eligible.filter(o => typeof values[o.i] === "number").length };
}

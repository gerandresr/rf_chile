export type Technical = "rsi" | "bollinger" | "macd" | "ma" | "zscore" | "momentum" | "volatility" | "percentile";
export const technicalOptions: { id: Technical; label: string; description: string }[] = [
  { id: "rsi", label: "RSI 14", description: "RSI de la tasa con suavizado de Wilder: niveles de referencia 30 y 70." },
  { id: "bollinger", label: "Bollinger", description: "Media de 20 observaciones y bandas a ±2 desviaciones estándar de la tasa." },
  { id: "macd", label: "MACD", description: "EMA 12 − EMA 26, señal EMA 9 e histograma, expresados en pb." },
  { id: "ma", label: "Medias móviles", description: "Medias simples de 20 y 60 observaciones sobre la tasa." },
  { id: "zscore", label: "Z-score 60", description: "Distancia a la media de 60 observaciones, en desviaciones estándar." },
  { id: "momentum", label: "Momentum", description: "Cambios de tasa en 1, 5 y 20 observaciones, expresados en pb." },
  { id: "volatility", label: "Volatilidad 20", description: "Desviación estándar muestral de 20 cambios diarios de tasa, en pb; sin anualizar." },
  { id: "percentile", label: "Percentil 1 año", description: "Ranking de la tasa entre las observaciones del último año calendario; empates con rango medio." },
];
export type TechnicalPoint = { date: string; [key: string]: string | number | null };
function stats(values: number[], sample = false) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - (sample ? 1 : 0)));
  return { mean, sd };
}
// EMA seeded with a full-window SMA. Nulls preserve the warm-up period.
function ema(values: (number | null)[], window: number) {
  let previous: number | null = null;
  const seed: number[] = [];
  return values.map(value => {
    if (value === null) return null;
    if (previous === null) {
      seed.push(value);
      if (seed.length < window) return null;
      previous = stats(seed).mean;
    } else previous += 2 / (window + 1) * (value - previous);
    return previous;
  });
}
export function calculateTechnicals(observations: { date: string; value: number }[], technical: Technical): TechnicalPoint[] {
  const obs = observations.filter(p => Number.isFinite(p.value)).slice().sort((a, b) => a.date.localeCompare(b.date));
  const values = obs.map(p => p.value);
  const fast = technical === "macd" ? ema(values, 12) : [];
  const slow = technical === "macd" ? ema(values, 26) : [];
  const macd = technical === "macd" ? values.map((_, i) => fast[i] === null || slow[i] === null ? null : (fast[i]! - slow[i]!) * 100) : [];
  const signal = technical === "macd" ? ema(macd, 9) : [];
  let gain = 0, loss = 0;
  return obs.map((p, i) => {
    const row: TechnicalPoint = { date: p.date };
    if (technical === "rsi") {
      if (i > 0) {
        const change = p.value - values[i - 1];
        if (i <= 14) { gain += Math.max(change, 0) / 14; loss += Math.max(-change, 0) / 14; }
        else { gain = (gain * 13 + Math.max(change, 0)) / 14; loss = (loss * 13 + Math.max(-change, 0)) / 14; }
      }
      row.rsi = i < 14 ? null : loss === 0 ? gain === 0 ? 50 : 100 : 100 - 100 / (1 + gain / loss);
    }
    if (technical === "bollinger" || technical === "ma") {
      row.ma20 = i < 19 ? null : stats(values.slice(i - 19, i + 1)).mean;
      if (technical === "ma") row.ma60 = i < 59 ? null : stats(values.slice(i - 59, i + 1)).mean;
      else {
        const s = i < 19 ? null : stats(values.slice(i - 19, i + 1));
        row.upper = s ? s.mean + 2 * s.sd : null;
        row.lower = s ? s.mean - 2 * s.sd : null;
      }
    }
    if (technical === "macd") { row.macd = macd[i]; row.signal = signal[i]; row.histogram = signal[i] === null ? null : macd[i]! - signal[i]!; }
    if (technical === "zscore") {
      const s = i < 59 ? null : stats(values.slice(i - 59, i + 1));
      row.zscore = s ? s.sd === 0 ? 0 : (p.value - s.mean) / s.sd : null;
    }
    if (technical === "momentum") for (const n of [1, 5, 20]) row[`momentum${n}`] = i < n ? null : (p.value - values[i - n]) * 100;
    if (technical === "volatility") row.volatility = i < 20 ? null : stats(values.slice(i - 19, i + 1).map((v, j) => (v - values[i - 20 + j]) * 100), true).sd;
    if (technical === "percentile") {
      const start = new Date(`${p.date}T12:00:00Z`); start.setUTCFullYear(start.getUTCFullYear() - 1);
      const window = obs.slice(0, i + 1).filter(v => v.date >= start.toISOString().slice(0, 10)).map(v => v.value);
      row.percentile = window.length < 2 ? null : 100 * (window.filter(v => v < p.value).length + window.filter(v => v === p.value).length / 2) / window.length;
    }
    return row;
  });
}

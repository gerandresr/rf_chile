import { calculateTechnicals } from "./technicals";

export type Oscillator = "rsi" | "stochastic" | "zscore" | "bollinger-reversion" | "bollinger-momentum";
export const oscillatorOptions: { id: Oscillator; name: string; category?: "Momentum"; entry: number; exit: number; description: string }[] = [
  { id: "rsi", name: "RSI", entry: 70, exit: 50, description: "RSI 14 de Wilder sobre la tasa." },
  { id: "stochastic", name: "Slow Stochastic", entry: 80, exit: 50, description: "Slow Stochastic de 14 observaciones y %K suavizado en 3 observaciones, basado en el rango de tasas de cierre, sin máximos ni mínimos intradía. Las señales usan %K suavizado." },
  { id: "zscore", name: "Z-score", entry: 2, exit: 0, description: "Z-score de la tasa respecto a su media de 60 observaciones, en desviaciones estándar." },
  { id: "bollinger-reversion", name: "Bollinger Bands", entry: 100, exit: 50, description: "Bollinger sobre la TIR: media de 20 observaciones y bandas a ±2 desviaciones estándar. %B expresa la posición de la tasa entre las bandas: 0 = inferior, 50 = media, 100 = superior; puede salir de ese rango." },
  { id: "bollinger-momentum", name: "Bollinger Bands", category: "Momentum", entry: 0, exit: 50, description: "Bollinger sobre la TIR: media de 20 observaciones y bandas a ±2 desviaciones estándar. %B expresa la posición de la tasa entre las bandas: 0 = inferior, 50 = media, 100 = superior; puede salir de ese rango." },
];

export function oscillatorValues(obs: { date: string; value: number }[], oscillator: Oscillator): (number | null)[] {
  if (oscillator === "bollinger-reversion" || oscillator === "bollinger-momentum") {
    return calculateTechnicals(obs, "bollinger").map((row, i) => {
      if (typeof row.upper !== "number" || typeof row.lower !== "number") return null;
      // With no dispersion the band position is undefined; no signal is generated.
      return row.upper === row.lower ? null : 100 * (obs[i].value - row.lower) / (row.upper - row.lower);
    });
  }
  if (oscillator !== "stochastic") {
    return calculateTechnicals(obs, oscillator).map(row => typeof row[oscillator] === "number" ? row[oscillator] as number : null);
  }
  const fast = obs.map((point, i) => {
    if (i < 13) return null;
    const window = obs.slice(i - 13, i + 1).map(p => p.value);
    const low = Math.min(...window), high = Math.max(...window);
    return high === low ? 50 : 100 * (point.value - low) / (high - low);
  });
  // Slow %K is the three-observation average of fast %K. %D is another
  // three-observation average, but level-based strategies use slow %K only.
  return fast.map((_, i) => {
    const window = fast.slice(Math.max(0, i - 2), i + 1);
    return window.length < 3 || window.some(v => v === null) ? null : (window as number[]).reduce((s, v) => s + v, 0) / 3;
  });
}

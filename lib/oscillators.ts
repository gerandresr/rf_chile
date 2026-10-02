import { calculateTechnicals } from "./technicals";

export type Oscillator = "rsi" | "stochastic" | "zscore";
export const oscillatorOptions: { id: Oscillator; name: string; entry: number; exit: number; description: string }[] = [
  { id: "rsi", name: "RSI", entry: 70, exit: 50, description: "RSI 14 de Wilder sobre la tasa." },
  { id: "stochastic", name: "Slow Stochastic", entry: 80, exit: 50, description: "Slow Stochastic de 14 observaciones y %K suavizado en 3 observaciones, basado en el rango de tasas de cierre, sin máximos ni mínimos intradía. Las señales usan %K suavizado." },
  { id: "zscore", name: "Z-score", entry: 2, exit: 0, description: "Z-score de la tasa respecto a su media de 60 observaciones, en desviaciones estándar." },
];

export function oscillatorValues(obs: { date: string; value: number }[], oscillator: Oscillator): (number | null)[] {
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

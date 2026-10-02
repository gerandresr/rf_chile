export type ChangeDistribution = {
  instrument: string;
  count: number;
  mean: number | null;
  deviation: number | null;
  bandwidth: number | null;
  values: number[];
};

// Gaussian kernels smooth the observed changes without assuming normality.
export function changeDistribution(instrument: string, input: number[]): ChangeDistribution {
  const values = input.filter(Number.isFinite);
  const count = values.length;
  const mean = count ? values.reduce((sum, value) => sum + value, 0) / count : null;
  const deviation = count > 1 && mean !== null
    ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1)) : null;
  const bandwidth = deviation !== null && deviation > 1e-10
    ? Math.max(0.1, 1.06 * deviation * count ** -0.2) : null;
  return { instrument, count, mean, deviation, bandwidth, values };
}

export function distributionPoints(distributions: ChangeDistribution[]) {
  const usable = distributions.filter(d => d.bandwidth !== null);
  if (!usable.length) return [];
  const min = Math.min(0, ...usable.map(d => Math.min(...d.values) - 3 * d.bandwidth!));
  const max = Math.max(0, ...usable.map(d => Math.max(...d.values) + 3 * d.bandwidth!));
  return Array.from({ length: 301 }, (_, i) => {
    const x = min + (max - min) * i / 300;
    const point: Record<string, number> = { x };
    for (const d of usable) {
      const h = d.bandwidth!;
      point[d.instrument] = d.values.reduce((sum, v) => sum + Math.exp(-0.5 * ((x - v) / h) ** 2), 0)
        / (d.count * h * Math.sqrt(2 * Math.PI));
    }
    return point;
  });
}

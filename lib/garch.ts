export type YieldObservation = { date: string; value: number };

export type GarchPoint = {
  date: string;
  yield: number;
  changeBp: number;
  volatilityBp: number;
};

export type GarchForecast = {
  horizonDays: number;
  expectedYield: number;
  cumulativeVolatilityBp: number;
  endDayVolatilityBp: number;
  lower68: number;
  upper68: number;
  lower95: number;
  upper95: number;
};

export type GarchResult = {
  points: GarchPoint[];
  forecasts: GarchForecast[];
  alpha: number;
  beta: number;
  omega: number;
  persistence: number;
  meanChangeBp: number;
  latestYield: number;
  latestVolatilityBp: number;
  nextDayVolatilityBp: number;
  longRunVolatilityBp: number;
  halfLifeDays: number | null;
  observations: number;
};

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function sampleVariance(values: number[], mean: number) {
  if (values.length < 2) return 0;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
}

function negativeLogLikelihood(residuals: number[], variance: number, alpha: number, beta: number) {
  const persistence = alpha + beta;
  if (!(alpha >= 0 && beta >= 0 && persistence < 0.999)) return Number.POSITIVE_INFINITY;

  const omega = Math.max(variance * (1 - persistence), 1e-8);
  let h = Math.max(variance, 1e-8);
  let nll = 0;

  for (let i = 0; i < residuals.length; i++) {
    if (i > 0) h = omega + alpha * residuals[i - 1] ** 2 + beta * h;
    h = Math.max(h, 1e-8);
    nll += Math.log(h) + residuals[i] ** 2 / h;
  }

  return nll;
}

function estimateParameters(residuals: number[], variance: number) {
  let best = { alpha: 0.08, beta: 0.9, score: Number.POSITIVE_INFINITY };

  for (let alpha = 0.02; alpha <= 0.3 + 1e-9; alpha += 0.02) {
    for (let beta = 0.5; beta <= 0.97 + 1e-9; beta += 0.02) {
      if (alpha + beta >= 0.995) continue;
      const score = negativeLogLikelihood(residuals, variance, alpha, beta);
      if (score < best.score) best = { alpha, beta, score };
    }
  }

  for (const step of [0.01, 0.0025]) {
    const center = { ...best };
    for (let alpha = Math.max(0.001, center.alpha - 4 * step); alpha <= Math.min(0.5, center.alpha + 4 * step) + 1e-12; alpha += step) {
      for (let beta = Math.max(0.001, center.beta - 4 * step); beta <= Math.min(0.995, center.beta + 4 * step) + 1e-12; beta += step) {
        if (alpha + beta >= 0.999) continue;
        const score = negativeLogLikelihood(residuals, variance, alpha, beta);
        if (score < best.score) best = { alpha, beta, score };
      }
    }
  }

  return best;
}

export function fitGarch11Yield(observations: YieldObservation[]): GarchResult {
  if (observations.length < 61) throw new Error("Se necesitan al menos 61 observaciones de yield para estimar GARCH(1,1).");

  const sorted = observations.slice().sort((a, b) => a.date.localeCompare(b.date));
  const changes = sorted.slice(1).map((point, index) => (point.value - sorted[index].value) * 100);
  const meanChangeBp = average(changes);
  const residuals = changes.map(change => change - meanChangeBp);
  const variance = sampleVariance(changes, meanChangeBp);

  if (!Number.isFinite(variance) || variance <= 1e-10) throw new Error("La serie no tiene variación suficiente para estimar GARCH(1,1).");

  const { alpha, beta } = estimateParameters(residuals, variance);
  const persistence = alpha + beta;
  const omega = Math.max(variance * (1 - persistence), 1e-8);

  let h = Math.max(variance, 1e-8);
  const points: GarchPoint[] = [];
  for (let i = 0; i < residuals.length; i++) {
    if (i > 0) h = omega + alpha * residuals[i - 1] ** 2 + beta * h;
    h = Math.max(h, 1e-8);
    points.push({
      date: sorted[i + 1].date,
      yield: sorted[i + 1].value,
      changeBp: changes[i],
      volatilityBp: Math.sqrt(h),
    });
  }

  const latestYield = sorted[sorted.length - 1].value;
  const lastResidual = residuals[residuals.length - 1];
  const nextVariance = Math.max(omega + alpha * lastResidual ** 2 + beta * h, 1e-8);
  const longRunVariance = omega / Math.max(1 - persistence, 1e-8);
  const halfLifeDays = persistence > 0 && persistence < 1 ? Math.log(0.5) / Math.log(persistence) : null;

  const horizons = [1, 5, 20];
  const forecasts = horizons.map(horizonDays => {
    let cumulativeVariance = 0;
    let endVariance = nextVariance;
    for (let step = 1; step <= horizonDays; step++) {
      const stepVariance = longRunVariance + Math.pow(persistence, step - 1) * (nextVariance - longRunVariance);
      cumulativeVariance += Math.max(stepVariance, 0);
      endVariance = stepVariance;
    }
    const cumulativeVolatilityBp = Math.sqrt(cumulativeVariance);
    const expectedYield = latestYield + (meanChangeBp * horizonDays) / 100;
    const oneSigmaYield = cumulativeVolatilityBp / 100;
    const twoSigmaYield = 1.96 * oneSigmaYield;
    return {
      horizonDays,
      expectedYield,
      cumulativeVolatilityBp,
      endDayVolatilityBp: Math.sqrt(Math.max(endVariance, 0)),
      lower68: expectedYield - oneSigmaYield,
      upper68: expectedYield + oneSigmaYield,
      lower95: expectedYield - twoSigmaYield,
      upper95: expectedYield + twoSigmaYield,
    };
  });

  return {
    points,
    forecasts,
    alpha,
    beta,
    omega,
    persistence,
    meanChangeBp,
    latestYield,
    latestVolatilityBp: Math.sqrt(h),
    nextDayVolatilityBp: Math.sqrt(nextVariance),
    longRunVolatilityBp: Math.sqrt(Math.max(longRunVariance, 0)),
    halfLifeDays,
    observations: changes.length,
  };
}

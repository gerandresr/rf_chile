import type { MonthlyMacroRow } from "./macro";

export type NairuPoint = {
  date: string; unemployment: number; inflation: number;
  filtered: number; smoothed: number;
  filteredLower: number; filteredUpper: number;
  smoothedLower: number; smoothedUpper: number;
};
export type NairuResult = {
  points: NairuPoint[];
  parameters: { kappa: number; rho: number; observationSd: number; stateSd: number; initialMean: number; initialSd: number };
  observations: number; likelihood: number; weakSignal: boolean; residualAutocorrelation: number;
  warnings: string[];
};

type Observation = { date: string; unemployment: number; inflation: number; change: number; lagChange: number };
const INITIAL_VARIANCE = 4;
const MIN_OBSERVATIONS = 60;

function monthIndex(date: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(date)) return NaN;
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

function prepare(rows: MonthlyMacroRow[]) {
  const dates = new Set<string>();
  const valid = rows.filter((row) => {
    if (!Number.isFinite(monthIndex(row.fecha))) throw new Error(`Fecha mensual inválida: ${row.fecha}`);
    if (dates.has(row.fecha)) throw new Error(`Fecha duplicada: ${row.fecha}`);
    dates.add(row.fecha);
    return typeof row.desempleo === "number" && Number.isFinite(row.desempleo)
      && typeof row.ipc_yoy === "number" && Number.isFinite(row.ipc_yoy);
  }).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (valid.some((r) => r.desempleo! < 0 || r.desempleo! > 100)) throw new Error("El desempleo debe estar expresado en porcentaje: 9,6 significa 9,6%.");
  // A missing month must never be treated as a one-month change.
  for (let i = 1; i < valid.length; i++) {
    if (monthIndex(valid[i].fecha) - monthIndex(valid[i - 1].fecha) !== 1) {
      throw new Error("La muestra conjunta tiene meses faltantes. Completa desempleo e inflación para una serie mensual continua.");
    }
  }
  if (valid.length < MIN_OBSERVATIONS) throw new Error(`Se necesitan al menos ${MIN_OBSERVATIONS} meses conjuntos para ejecutar esta versión experimental.`);
  const observations = valid.slice(2).map((row, i) => ({
    date: row.fecha, unemployment: row.desempleo!, inflation: row.ipc_yoy!,
    change: row.ipc_yoy! - valid[i + 1].ipc_yoy!,
    lagChange: valid[i + 1].ipc_yoy! - valid[i].ipc_yoy!,
  }));
  return { observations, initialMean: valid.slice(0, 12).reduce((sum, r) => sum + r.desempleo!, 0) / 12, count: valid.length };
}

// Δπ_t = ρ Δπ_(t-1) − κ (u_t − n_t) + ε_t; n_t = n_(t-1) + η_t.
// No free intercept: it would be confounded with the NAIRU level.
function kalman(observations: Observation[], initialMean: number, stateSd: number, parameters: number[], capture = false) {
  const [logKappa, rho, logSd] = parameters;
  const kappa = Math.exp(logKappa), variance = Math.exp(2 * logSd), q = stateSd ** 2;
  let mean = initialMean, covariance = INITIAL_VARIANCE, nll = 0;
  const states: { mean: number; covariance: number; priorMean: number; priorCovariance: number; innovation: number }[] = [];
  for (const row of observations) {
    const priorMean = mean, priorCovariance = covariance + q;
    const innovation = row.change - rho * row.lagChange + kappa * row.unemployment - kappa * priorMean;
    const innovationVariance = kappa ** 2 * priorCovariance + variance;
    const gain = priorCovariance * kappa / innovationVariance;
    mean = priorMean + gain * innovation;
    // Joseph covariance update maintains numerical stability.
    covariance = (1 - gain * kappa) ** 2 * priorCovariance + gain ** 2 * variance;
    nll += 0.5 * (Math.log(2 * Math.PI * innovationVariance) + innovation ** 2 / innovationVariance);
    if (capture) states.push({ mean, covariance, priorMean, priorCovariance, innovation });
  }
  return { nll, states };
}

const bounds = [[Math.log(0.0001), Math.log(1.5)], [-0.98, 0.98], [Math.log(0.01), Math.log(5)]];
function constrain(parameters: number[]) {
  return parameters.map((value, i) => Math.max(bounds[i][0], Math.min(bounds[i][1], value)));
}

// Deterministic multi-start coordinate search of the Kalman likelihood.
function fit(observations: Observation[], initialMean: number, stateSd: number) {
  let best = { parameters: [Math.log(0.1), 0.3, Math.log(0.5)], nll: Infinity };
  for (const kappa of [0.002, 0.05, 0.3]) {
    for (const rho of [-0.3, 0.3, 0.8]) {
      let parameters = [Math.log(kappa), rho, Math.log(0.5)];
      let nll = kalman(observations, initialMean, stateSd, parameters).nll;
      let steps = [1, 0.2, 0.5];
      for (let iteration = 0; iteration < 350 && Math.max(...steps) > 0.00001; iteration++) {
        let improved = false;
        for (let dimension = 0; dimension < 3; dimension++) {
          for (const sign of [-1, 1]) {
            const candidate = constrain(parameters.map((v, i) => v + (i === dimension ? sign * steps[i] : 0)));
            const score = kalman(observations, initialMean, stateSd, candidate).nll;
            if (score < nll - 1e-10) { parameters = candidate; nll = score; improved = true; }
          }
        }
        if (!improved) steps = steps.map((s) => s / 2);
      }
      if (nll < best.nll) best = { parameters, nll };
    }
  }
  return best;
}

export function estimateNairu(rows: MonthlyMacroRow[], stateSd = 0.05): NairuResult {
  if (!Number.isFinite(stateSd) || stateSd <= 0) throw new Error("La variación del estado debe ser positiva.");
  const { observations, initialMean, count } = prepare(rows);
  const fitted = fit(observations, initialMean, stateSd);
  const { states } = kalman(observations, initialMean, stateSd, fitted.parameters, true);
  const smoothed = states.map((state) => ({ mean: state.mean, covariance: state.covariance }));
  // Rauch–Tung–Striebel smoother: full-sample retrospective estimate.
  for (let i = states.length - 2; i >= 0; i--) {
    const gain = states[i].covariance / states[i + 1].priorCovariance;
    smoothed[i].mean += gain * (smoothed[i + 1].mean - states[i + 1].priorMean);
    smoothed[i].covariance = Math.max(0, states[i].covariance + gain ** 2 * (smoothed[i + 1].covariance - states[i + 1].priorCovariance));
  }
  const points = observations.map((row, i) => {
    const filteredMargin = 1.96 * Math.sqrt(states[i].covariance);
    const smoothedMargin = 1.96 * Math.sqrt(smoothed[i].covariance);
    return {
      date: row.date, unemployment: row.unemployment, inflation: row.inflation,
      filtered: states[i].mean, smoothed: smoothed[i].mean,
      filteredLower: states[i].mean - filteredMargin, filteredUpper: states[i].mean + filteredMargin,
      smoothedLower: smoothed[i].mean - smoothedMargin, smoothedUpper: smoothed[i].mean + smoothedMargin,
    };
  });
  const residuals = states.map((s) => s.innovation);
  const residualMean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const total = residuals.reduce((s, r) => s + (r - residualMean) ** 2, 0);
  const ac1 = total > 0 ? residuals.slice(1).reduce((s, r, i) => s + (r - residualMean) * (residuals[i] - residualMean), 0) / total : 0;
  const kappa = Math.exp(fitted.parameters[0]);
  // A diagnostic threshold, not a significance test.
  const weakSignal = kappa < 0.03;
  const warnings = [];
  if (weakSignal) warnings.push("Señal de Phillips débil: la NAIRU depende especialmente del nivel inicial y de los supuestos de variación.");
  if (Math.abs(ac1) > 0.2) warnings.push("Los residuos presentan autocorrelación: la especificación puede requerir más rezagos o variables de oferta.");
  if (count < 120) warnings.push("Muestra corta: hay menos de diez años de datos conjuntos.");
  return {
    points, observations: count, likelihood: -fitted.nll, weakSignal, residualAutocorrelation: ac1, warnings,
    parameters: { kappa, rho: fitted.parameters[1], observationSd: Math.exp(fitted.parameters[2]), stateSd, initialMean, initialSd: Math.sqrt(INITIAL_VARIANCE) },
  };
}

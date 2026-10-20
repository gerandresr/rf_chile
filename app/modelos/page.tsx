import { ModelsDashboard } from "@/components/ModelsDashboard";
import monthlyData from "@/public/data/historico_bcentral/datos-mensuales.json";
import { estimateNairu } from "@/lib/nairu";
import type { NairuEstimate } from "@/components/NairuModel";
import dailyData from "@/public/data/historico_bcentral/datos-diarios.json";
import { estimateTaylor } from "@/lib/taylor";
import { carryModelData, tpmModelData } from "@/lib/market-models.server";

// Los modelos se estiman al construir el sitio (no en el navegador): actualizar los datos y desplegar los vuelve a estimar.
function nairuEstimate(): NairuEstimate {
  try { return { result: estimateNairu(monthlyData), error: null }; }
  catch (error) { return { result: null, error: error instanceof Error ? error.message : "No fue posible estimar el modelo." }; }
}

export default function Page() {
  const nairu = nairuEstimate();
  // La regla de Taylor usa la brecha de actividad del mismo modelo, para que ambos sean coherentes.
  const gaps = nairu.result ? {
    smoothed: Object.fromEntries(nairu.result.points.map((p) => [p.date, p.outputGapSmoothed])),
    filtered: Object.fromEntries(nairu.result.points.map((p) => [p.date, p.outputGapFiltered])),
  } : null;
  let taylor: { value: number; date: string } | null = null;
  try {
    const last = gaps ? estimateTaylor(monthlyData, dailyData, gaps.smoothed).points.at(-1) : undefined;
    if (last) taylor = { value: last.taylor, date: last.date };
  } catch { taylor = null; }
  return <ModelsDashboard nairu={nairu} activityGaps={gaps} tpmPath={tpmModelData()} carry={carryModelData()} taylor={taylor} />;
}

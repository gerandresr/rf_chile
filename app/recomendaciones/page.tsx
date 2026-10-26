import { RecommendationsView } from "@/components/RecommendationsView";
import { recommendationReports } from "@/lib/recommendations.server";

export const metadata = { title: "Recomendaciones · Mercado RF Chile" };

// Un informe por fecha en content/recomendaciones/; los niveles actuales se recalculan al publicar.
export default function Page() {
  return <RecommendationsView reports={recommendationReports()} />;
}

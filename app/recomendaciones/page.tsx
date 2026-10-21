import { RecommendationsView } from "@/components/RecommendationsView";
import { recommendations } from "@/lib/recommendations.server";

export const metadata = { title: "Recomendaciones · Mercado RF Chile" };

// Las ideas están en content/recomendaciones.json; los niveles actuales se recalculan al publicar.
export default function Page() {
  return <RecommendationsView data={recommendations()} />;
}

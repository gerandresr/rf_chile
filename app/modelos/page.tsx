import { ModelsDashboard } from "@/components/ModelsDashboard";
import { carryModelData } from "@/lib/market-models.server";

export default function Page() {
  return <ModelsDashboard carry={carryModelData()} />;
}

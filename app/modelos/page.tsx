import { ModelsDashboard } from "@/components/ModelsDashboard";
import { carryModelData } from "@/lib/market-models.server";
import { phillipsNairuData } from "@/lib/nairu-phillips.server";

export default function Page() {
  return <ModelsDashboard carry={carryModelData()} phillips={phillipsNairuData()} />;
}

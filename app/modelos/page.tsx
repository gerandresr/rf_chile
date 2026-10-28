import { ModelsDashboard } from "@/components/ModelsDashboard";
import { carryModelData, fairValueModelData, macroFairValueData, taylorForwardData, taylorEeeData } from "@/lib/market-models.server";
import { phillipsNairuData } from "@/lib/nairu-phillips.server";

export default function Page() {
  return <ModelsDashboard carry={carryModelData()} phillips={phillipsNairuData()} fairValue={fairValueModelData()} macroFairValue={macroFairValueData()} taylorForward={taylorForwardData()} taylorEee={taylorEeeData()} />;
}

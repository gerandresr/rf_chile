import { ChartBuilder } from "@/components/ChartBuilder";
import { dataCatalog } from "@/lib/data-catalog.server";

export const metadata = { title: "Gráficos · Mercado RF Chile" };

export default function Page() {
  return <ChartBuilder catalog={dataCatalog()} />;
}

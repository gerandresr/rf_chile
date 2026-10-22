import { readFileSync } from "fs";
import path from "path";
import { ChartBuilder, type RecommendedChart } from "@/components/ChartBuilder";
import { dataCatalog } from "@/lib/data-catalog.server";

export const metadata = { title: "Gráficos · Mercado RF Chile" };

// Gráficos recomendados: content/graficos-recomendados.json (mismo formato que un gráfico guardado).
function recommended(): RecommendedChart[] {
  try { return JSON.parse(readFileSync(path.join(process.cwd(), "content", "graficos-recomendados.json"), "utf8")).graficos ?? []; }
  catch { return []; }
}

type HistoricalEvent = { id: string; fecha: string; corto: string; nombre: string; categoria: string; descripcion: string; fuente: string };
function historicalEvents(): HistoricalEvent[] {
  try { return JSON.parse(readFileSync(path.join(process.cwd(), "content", "eventos-historicos.json"), "utf8")).eventos ?? []; }
  catch { return []; }
}

export default function Page() {
  return <ChartBuilder catalog={dataCatalog()} recommended={recommended()} historicalEvents={historicalEvents()} />;
}

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
  const catalog = dataCatalog();
  const configured = JSON.parse(readFileSync(path.join(process.cwd(), "public/data/instrumentos-benchmark.json"), "utf8")) as { BTP: string[]; BTU: string[] };
  const palette = ["#2f6fed", "#d94b4b", "#0f9f6e", "#f59e0b", "#8b5cf6", "#172033", "#0ea5e9", "#64748b"];
  const seriesIds = new Set(catalog.groups.flatMap(g => g.series.map(s => s.id)));
  const chart = (nombre: string, ids: string[], fuente: string) => ({
    nombre, config: {
      title: nombre, subtitle: "", source: fuente, period: "5y" as const, legend: "bottom" as const,
      lastValue: true, annotations: [],
      series: ids.filter(id => seriesIds.has(id)).map((id, i) => ({
        uid: `r${i + 1}`, label: id.startsWith("benchmark:") ? id.slice(10) : id,
        source: { kind: "catalog" as const, leg: { id, field: id.startsWith("benchmark:") ? id.slice(10) : "tir" } },
        type: "line" as const, color: palette[i % palette.length], width: 2, dash: "solid" as const,
        axis: "left" as const, transform: "level" as const, visible: true
      }))
    }
  });
  const generated = [
    chart("Tasas de Interés en CLP", configured.BTP, "Fuente: Mercado."),
    chart("Tasas de Interés en UF", configured.BTU, "Fuente: Mercado."),
    chart("Benchmark PESOS", ["benchmark:PESOS-02", "benchmark:PESOS-05", "benchmark:PESOS-10"], "Fuente: Mercado. Tasas benchmark a plazo constante."),
    chart("Benchmark UF", ["benchmark:UF-02", "benchmark:UF-05", "benchmark:UF-10"], "Fuente: Mercado. Tasas benchmark a plazo constante."),
  ];
  return <ChartBuilder catalog={catalog} recommended={[...generated, ...recommended()]} historicalEvents={historicalEvents()} />;
}

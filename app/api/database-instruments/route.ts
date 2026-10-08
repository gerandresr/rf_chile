import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const folders = [
    { path: path.join(process.cwd(), "public", "data", "historico_riskamerica"), source: "RiskAmerica" },
    { path: path.join(process.cwd(), "public", "data", "json_bbg"), source: "Bloomberg" },
    // Todos los históricos Bloomberg: swaps, monedas, índices, tasas y volatilidad.
    { path: path.join(process.cwd(), "public", "data", "historico_bloomberg"), source: "Bloomberg" },
  ];
  const instruments = folders.flatMap(({ path: folder, source }) => {
    if (!fs.existsSync(folder)) return [];
    return fs.readdirSync(folder)
      .filter((name) => name.toLowerCase().endsWith(".json"))
      .map((name) => ({ code: path.basename(name, ".json"), source }));
  });

  // Si una serie existe en más de una carpeta, mostrarla una sola vez.
  const unique = [...new Map(instruments.map((item) => [item.code.toLowerCase(), item])).values()];
  return NextResponse.json(unique.sort((a, b) => a.code.localeCompare(b.code)));
}

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const folders: Array<{ path: string; source: string; swapOnly?: boolean }> = [
    { path: path.join(process.cwd(), "public", "data", "historico_riskamerica"), source: "RiskAmerica" },
    { path: path.join(process.cwd(), "public", "data", "json_bbg"), source: "Bloomberg" },
    // Las series de swaps usadas por Mercado se guardan en esta carpeta.
    { path: path.join(process.cwd(), "public", "data", "historico_bloomberg"), source: "Bloomberg", swapOnly: true },
  ];
  const instruments = folders.flatMap(({ path: folder, source, swapOnly }) => {
    if (!fs.existsSync(folder)) return [];
    return fs.readdirSync(folder)
      .filter((name) => name.toLowerCase().endsWith(".json") &&
        (!swapOnly || /^(clpcam|ufcam)_\d+(m|y)\.json$/i.test(name)))
      .map((name) => ({ code: path.basename(name, ".json"), source }));
  });
  return NextResponse.json(instruments.sort((a, b) => a.code.localeCompare(b.code)));
}

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const folders = [
    { path: path.join(process.cwd(), "public", "data", "historicos_riskamerica"), source: "RiskAmerica" },
    { path: path.join(process.cwd(), "public", "data", "json_bbg"), source: "Bloomberg" },
  ];
  const instruments = folders.flatMap(({ path: folder, source }) => {
    if (!fs.existsSync(folder)) return [];
    return fs.readdirSync(folder).filter((name) => name.toLowerCase().endsWith(".json")).map((name) => ({ code: path.basename(name, ".json"), source }));
  });
  return NextResponse.json(instruments.sort((a, b) => a.code.localeCompare(b.code)));
}

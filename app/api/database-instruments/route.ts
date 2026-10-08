import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import dailyMacroData from "@/public/data/datos-diarios.json";

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
      // TPM Chile se obtiene únicamente del archivo diario del Banco Central.
      .filter((name) => name.toLowerCase().endsWith(".json") && name.toLowerCase() !== "tpm.json")
      .map((name) => ({ code: path.basename(name, ".json"), source }));
  });

  // Registrar TPM Chile solamente cuando hay observaciones válidas en datos-diarios.json.
  // La ruta y los campos permiten que la futura descarga use la misma serie.
  const hasCentralBankTPM = dailyMacroData.some(
    (row) => typeof row.fecha === "string" && typeof row.tpm === "number" && Number.isFinite(row.tpm),
  );
  const bankTPM = hasCentralBankTPM
    ? [{
        code: "tpm",
        source: "Banco Central de Chile",
        dataPath: "/data/datos-diarios.json",
        dateField: "fecha",
        valueField: "tpm",
      }]
    : [];

  // Si una serie existe en más de una carpeta, mostrarla una sola vez.
  const unique = [...new Map([...instruments, ...bankTPM].map((item) => [item.code.toLowerCase(), item])).values()];
  return NextResponse.json(unique.sort((a, b) => a.code.localeCompare(b.code)));
}

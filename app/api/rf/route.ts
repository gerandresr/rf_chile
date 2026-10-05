import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

type Instrument = {
  code: string;
  type: "BTP" | "BTU";
  coupon: number | null;
  maturityMonth: number;
  maturityYear: number;
};

type InstrumentHistory = {
  fecha?: string[];
  tir?: Array<number | null>;
};

function instrumentFromCode(code: string): Instrument | null {
  const match = code.match(/^(BTP|BTU)(\d{3})(\d{2})(\d{2})$/);
  if (!match) return null;
  const [, type, couponRaw, monthRaw, yearRaw] = match;
  const month = Number(monthRaw);
  if (month < 1 || month > 12) return null;
  return {
    code,
    type: type as "BTP" | "BTU",
    coupon: Number(couponRaw) / 10,
    maturityMonth: month,
    maturityYear: 2000 + Number(yearRaw),
  };
}

export async function GET() {
  try {
    const directory = path.join(process.cwd(), "public", "data", "historico");
    const files = (await fs.readdir(directory))
      .filter((name) => /^(BTP|BTU)\d{7}\.json$/.test(name))
      .sort();

    const instruments: Instrument[] = [];
    const byDate = new Map<string, Record<string, number>>();

    await Promise.all(files.map(async (file) => {
      const code = file.replace(/\.json$/, "");
      const instrument = instrumentFromCode(code);
      if (!instrument) return;

      const raw = await fs.readFile(path.join(directory, file), "utf8");
      const parsed = JSON.parse(raw) as Record<string, InstrumentHistory>;
      const series = parsed[code];
      if (!series || !Array.isArray(series.fecha) || !Array.isArray(series.tir)) return;

      instruments.push(instrument);
      const length = Math.min(series.fecha.length, series.tir.length);
      for (let i = 0; i < length; i++) {
        const date = series.fecha[i];
        const value = series.tir[i];
        if (typeof date !== "string" || typeof value !== "number" || !Number.isFinite(value)) continue;
        const values = byDate.get(date) ?? {};
        values[code] = value;
        byDate.set(date, values);
      }
    }));

    instruments.sort((a, b) => a.type.localeCompare(b.type) || a.maturityYear - b.maturityYear || a.maturityMonth - b.maturityMonth || a.code.localeCompare(b.code));
    const history = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({ date, values }));
    const lastMarketDate = history.at(-1)?.date ?? "";

    return NextResponse.json({
      sourceSheet: "public/data/historico/*.json",
      lastMarketDate,
      instruments,
      history,
    });
  } catch (error) {
    console.error("No fue posible construir los históricos de renta fija", error);
    return NextResponse.json({ error: "No fue posible cargar los históricos de renta fija." }, { status: 500 });
  }
}

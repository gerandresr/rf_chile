import { NextResponse } from "next/server";
import { benchmarkHistory } from "@/lib/dashboard.server";

export const dynamic = "force-static";

/** Series diarias para Gráficos; cálculo compartido con Dashboard RF. */
export function GET() {
  return NextResponse.json(benchmarkHistory(), {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" }
  });
}

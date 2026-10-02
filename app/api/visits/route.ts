import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(
      "https://countapi.mileshilliard.com/api/v1/hit/rf-chile-mercados",
      { cache: "no-store" },
    );

    if (!response.ok) {
      return NextResponse.json({ error: "Contador no disponible" }, { status: 502 });
    }

    const data = await response.json();
    return NextResponse.json({ value: Number(data.value ?? 0) });
  } catch {
    return NextResponse.json({ error: "Contador no disponible" }, { status: 502 });
  }
}

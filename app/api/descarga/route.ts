import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

// Clave para descargar series en Base de Datos. Se define en Vercel como variable de entorno
// DESCARGA_CLAVE (no va en el repo). Si no está definida, la descarga queda bloqueada.
export const dynamic = "force-dynamic";

const COOKIE = "rf_descarga";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 días

const secret = () => process.env.DESCARGA_CLAVE?.trim() || "";
// El token de la cookie deriva de la clave: al cambiar la clave, las sesiones anteriores dejan de valer.
const token = (clave: string) => createHmac("sha256", clave).update("rf-descarga-v1").digest("hex");
const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Indica si este navegador ya ingresó la clave. */
export async function GET(req: NextRequest) {
  const clave = secret();
  if (!clave) return NextResponse.json({ ok: false, configurada: false });
  const cookie = req.cookies.get(COOKIE)?.value ?? "";
  return NextResponse.json({ ok: same(cookie, token(clave)), configurada: true });
}

/** Valida la clave y deja una cookie para no pedirla de nuevo. */
export async function POST(req: NextRequest) {
  const clave = secret();
  if (!clave) return NextResponse.json({ ok: false, error: "Descarga no habilitada." }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const intento = typeof body?.clave === "string" ? body.clave.trim() : "";
  if (!same(intento, clave)) {
    await new Promise(r => setTimeout(r, 800)); // frena intentos por fuerza bruta
    return NextResponse.json({ ok: false, error: "Clave incorrecta." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, token(clave), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: MAX_AGE });
  return res;
}

import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Mercado RF Chile", description: "Dashboard de renta fija chilena" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="es"><body>{children}</body></html>; }

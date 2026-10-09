import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Mercado RF Chile",
  description: "Dashboard de renta fija chilena",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: ["/icon.svg"],
    apple: [{ url: "/apple-icon", sizes: "180x180", type: "image/png" }],
  },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="es"><body>{children}</body></html>; }

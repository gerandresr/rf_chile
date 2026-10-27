"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, LayoutDashboard, FlaskConical, Calculator, Lightbulb, LineChart, TrendingUp, Landmark } from "lucide-react";
import { VisitorCounter } from "./VisitorCounter";

export function AppShell({ children }: { children: React.ReactNode }) {
  const p = usePathname();

  const nav = [
    { href: "/", label: "Mercado RF", icon: LayoutDashboard },
    { href: "/mercados", label: "Mercados", icon: Landmark },
    { href: "/historicos", label: "Históricos", icon: BarChart3 },
    { href: "/graficos", label: "Gráficos", icon: LineChart },
    { href: "/swap-spreads", label: "Swap Spreads", icon: Activity },
    { href: "/inflacion", label: "Inflación y TPM", icon: TrendingUp },
    { href: "/modelos", label: "Modelos", icon: FlaskConical },
    { href: "/recomendaciones", label: "Recomendaciones", icon: Lightbulb },
    { href: "/calculadoras", label: "Calculadoras", icon: Calculator },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Activity size={20} />
          <span>Mesa Trading Propietario BE</span>
        </div>
        <div className="brand-sub">Resumen Mercado de Renta Fija Chilena</div>

        <nav>
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`nav-item ${p === href ? "active" : ""}`}
              aria-label={label}
              aria-current={p === href ? "page" : undefined}
            >
              <Icon size={17} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
      </aside>

      <main className={`main ${p === "/mercados" ? "markets-page" : ""}`}>
        {children}
        {p === "/" && <VisitorCounter />}
      </main>

      {p === "/mercados" && <style>{`.markets-page .note { display: none !important; }`}</style>}
    </div>
  );
}

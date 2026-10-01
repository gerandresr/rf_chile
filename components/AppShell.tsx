"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, Landmark, FlaskConical } from "lucide-react";

export function AppShell({ children }: { children: React.ReactNode }) {
  const p = usePathname();

  const nav = [
    { href: "/", label: "Mercados", icon: Landmark },
    { href: "/historicos", label: "Históricos", icon: BarChart3 },
    { href: "/modelos", label: "Modelos", icon: FlaskConical },
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

      <main className="main">{children}</main>
    </div>
  );
}

import { ChevronDown } from "lucide-react";
import { AppShell } from "@/components/AppShell";

export default function Page() {
  return <AppShell>
    <header className="page-head"><div><div className="eyebrow">Trading Propietario</div><h1>Flujos</h1></div></header>
    <details className="panel model-disclosure">
      <summary><span>AFP, AUM y cambios de fondo</span><ChevronDown size={20} aria-hidden="true" /></summary>
      <div className="model-content" />
    </details>
  </AppShell>;
}

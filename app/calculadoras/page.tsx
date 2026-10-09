import { AppShell } from "@/components/AppShell";
import { BondSpreadCalculators } from "@/components/BondSpreadCalculators";

export default function CalculadorasPage() {
  return (
    <AppShell>
      <header className="page-head">
        <div>
          <div className="eyebrow">Trading Propietario</div>
          <h1>Calculadoras</h1>
        </div>
      </header>
      <BondSpreadCalculators />
    </AppShell>
  );
}

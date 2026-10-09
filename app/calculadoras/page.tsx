import { AppShell } from "@/components/AppShell";

export default function CalculadorasPage() {
  return (
    <AppShell>
      <header className="page-head">
        <div>
          <div className="eyebrow">Trading Propietario</div>
          <h1>Calculadoras</h1>
        </div>
      </header>
      <section className="panel">
        <p className="muted" style={{ margin: 0 }}>
          Espacio para incorporar calculadoras financieras.
        </p>
      </section>
    </AppShell>
  );
}

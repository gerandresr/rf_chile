"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { AppShell } from "./AppShell";
import { TaylorModel, type ActivityGaps } from "./TaylorModel";
import { RealExchangeRateChart } from "./RealExchangeRateChart";
import { OscillatorBacktestModel } from "./OscillatorBacktestModel";
import { GarchYieldModel } from "./GarchYieldModel";
import { Oscillator, oscillatorOptions } from "@/lib/oscillators";
import { NairuModel, type NairuEstimate } from "./NairuModel";
import { CarryModel } from "./CarryModel";
import type { CarryModelData } from "@/lib/market-models.server";

// GARCH y Técnicos para BTP/BTU están ocultos; cambiar a true para mostrarlos de nuevo.
const SHOW_MARKET_MODELS = false;

export function ModelsDashboard({ nairu, activityGaps, carry }: {
  nairu: NairuEstimate; activityGaps: ActivityGaps; carry: CarryModelData;
}) {
  const [carryOpen, setCarryOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [taylorOpen, setTaylorOpen] = useState(false);
  const [garchOpen, setGarchOpen] = useState(false);
  const [backtestOpen, setBacktestOpen] = useState(false);
  const [oscillatorOpen, setOscillatorOpen] = useState<Partial<Record<Oscillator, boolean>>>({});
  return <AppShell>
    <header className="page-head"><div><div className="eyebrow">Trading Propietario</div><h1>Modelos</h1><p>Selecciona un modelo para consultar sus resultados.</p></div></header>
    <details className="panel model-disclosure" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><span>Tasa de desempleo natural (filtro de Kalman · Okun)</span><ChevronDown size={20} aria-hidden="true" /></summary>
      {open && <NairuModel estimate={nairu} />}
    </details>
    <details className="panel model-disclosure" onToggle={(event) => setTaylorOpen(event.currentTarget.open)}>
      <summary><span>Regla de Taylor</span><ChevronDown size={20} aria-hidden="true" /></summary>
      {taylorOpen && <TaylorModel gaps={activityGaps} />}
    </details>
    <details className="panel model-disclosure" onToggle={(event) => setCarryOpen(event.currentTarget.open)}>
      <summary><span>Carry y roll-down BTP/BTU</span><ChevronDown size={20} aria-hidden="true" /></summary>
      {carryOpen && <CarryModel data={carry} />}
    </details>
    <RealExchangeRateChart />
    {SHOW_MARKET_MODELS && <>
    <details className="panel model-disclosure" onToggle={(event) => setGarchOpen(event.currentTarget.open)}>
      <summary><span>Modelo GARCH (BTP/BTU)</span><ChevronDown size={20} aria-hidden="true" /></summary>
      {garchOpen && <GarchYieldModel />}
    </details>
    <details className="panel model-disclosure" onToggle={(event) => { setBacktestOpen(event.currentTarget.open); if (!event.currentTarget.open) setOscillatorOpen({}); }}>
      <summary><span>Técnicos para BTP/BTU</span><ChevronDown size={20} aria-hidden="true" /></summary>
      {backtestOpen && <div className="model-content">{oscillatorOptions.map(option => <details key={option.id} className="panel model-disclosure" onToggle={(event) => { const isOpen = event.currentTarget.open; setOscillatorOpen(current => ({ ...current, [option.id]: isOpen })); }}>
        <summary><span>({option.category ?? "Oscilador"}) {option.name}</span><ChevronDown size={20} aria-hidden="true" /></summary>
        {oscillatorOpen[option.id] && <OscillatorBacktestModel oscillator={option.id} />}
      </details>)}</div>}
    </details>
    </>}
  </AppShell>;
}

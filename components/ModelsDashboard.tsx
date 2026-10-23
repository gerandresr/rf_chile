"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { AppShell } from "./AppShell";
import { TaylorModel } from "./TaylorModel";
import monthlyData from "@/public/data/historico_bcentral/datos-mensuales.json";
import { useMemo } from "react";
import { RealExchangeRateChart } from "./RealExchangeRateChart";
import { OscillatorBacktestModel } from "./OscillatorBacktestModel";
import { GarchYieldModel } from "./GarchYieldModel";
import { Oscillator, oscillatorOptions } from "@/lib/oscillators";
import { CarryModel } from "./CarryModel";
import type { CarryModelData, FairValueModelData, MacroFairValueData } from "@/lib/market-models.server";
import { NssFairValueModel } from "./NssFairValueModel";
import { MacroFairValueModel } from "./MacroFairValueModel";
import { NairuPhillipsModel } from "./NairuPhillipsModel";
import type { PhillipsModelData } from "@/lib/nairu-phillips.server";

// GARCH y Técnicos para BTP/BTU están ocultos; cambiar a true para mostrarlos de nuevo.
const SHOW_MARKET_MODELS = false;

export function ModelsDashboard({ carry, phillips, fairValue, macroFairValue }: { carry: CarryModelData; phillips: PhillipsModelData; fairValue: FairValueModelData; macroFairValue: MacroFairValueData }) {
  const [nairu, setNairu] = useState(8.16);
  const [okun, setOkun] = useState(2);
  const gaps = useMemo(() => ({
    filtered: Object.fromEntries(monthlyData.filter(r => typeof r.desempleo === "number").map(r => [r.fecha, -okun * ((r.desempleo as number) - nairu)])),
    smoothed: Object.fromEntries(monthlyData.filter(r => typeof r.desempleo === "number").map(r => [r.fecha, -okun * ((r.desempleo as number) - nairu)])),
  }), [nairu, okun]);
  const recent = [...monthlyData].reverse().find(r => typeof r.desempleo === "number");
  const [carryOpen, setCarryOpen] = useState(false);
  const [fairOpen, setFairOpen] = useState(false);
  const [macroFairOpen, setMacroFairOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [taylorOpen, setTaylorOpen] = useState(false);
  const [garchOpen, setGarchOpen] = useState(false);
  const [backtestOpen, setBacktestOpen] = useState(false);
  const [oscillatorOpen, setOscillatorOpen] = useState<Partial<Record<Oscillator, boolean>>>({});
  return <AppShell>
    <header className="page-head"><div><div className="eyebrow">Trading Propietario</div><h1>Modelos</h1><p>Selecciona un modelo para consultar sus resultados.</p></div></header>
    <details className="panel model-disclosure" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><span>Nairu con Curva de Phillips (Estimación Propia)</span><ChevronDown size={20} aria-hidden="true" /></summary>
      {open && <NairuPhillipsModel data={phillips} />}
    </details>
    <details className="panel model-disclosure" onToggle={(event) => setTaylorOpen(event.currentTarget.open)}>
      <summary><span>Regla de Taylor</span><ChevronDown size={20} aria-hidden="true" /></summary>
      {taylorOpen && <>
        <div className="model-content"><p>Brecha de actividad de la regla: supuesto propio, independiente del modelo NAIRU de arriba.</p><div className="taylor-controls"><label>NAIRU supuesta (%)<input type="number" min="0" max="30" step="0.01" value={nairu} onChange={e => { const v = e.currentTarget.valueAsNumber; if (Number.isFinite(v) && v >= 0 && v <= 30) setNairu(v); }} /></label><label>Coeficiente de Okun (% de actividad por pp de desempleo)<input type="number" min="0" max="10" step="0.1" value={okun} onChange={e => { const v = e.currentTarget.valueAsNumber; if (Number.isFinite(v) && v >= 0 && v <= 10) setOkun(v); }} /></label></div>{recent && <p className="model-caption">Último desempleo registrado: {recent.desempleo!.toFixed(2).replace(".", ",")}% ({recent.fecha}). Brecha de actividad aproximada: {(-okun * (recent.desempleo! - nairu)).toFixed(2).replace(".", ",")}%, calculada como −Okun × (desempleo − NAIRU supuesta).</p>}</div>
        <TaylorModel gaps={gaps} nairu={nairu} okun={okun} />
      </>}
    </details>
    <details className="panel model-disclosure" onToggle={(event) => setCarryOpen(event.currentTarget.open)}>
      <summary><span>Carry y roll-down BTP/BTU</span><ChevronDown size={20} aria-hidden="true" /></summary>
      {carryOpen && <CarryModel data={carry} />}
    </details>
    <details className="panel model-disclosure" onToggle={(event) => setFairOpen(event.currentTarget.open)}>
      <summary><span>Modelo Fair Value · Valor relativo (curva Nelson-Siegel-Svensson)</span><ChevronDown size={20} aria-hidden="true" /></summary>
      {fairOpen && <NssFairValueModel data={fairValue} />}
    </details>
    <details className="panel model-disclosure" onToggle={(event) => setMacroFairOpen(event.currentTarget.open)}>
      <summary><span>Modelo Fair Value · Valor direccional (fundamentales macro)</span><ChevronDown size={20} aria-hidden="true" /></summary>
      {macroFairOpen && <MacroFairValueModel data={macroFairValue} />}
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

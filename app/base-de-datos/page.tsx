"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";

type Item = { code: string; source: string };

function tenorInMonths(code: string) {
  const match = code.match(/_(\d+)(m|y)$/i);
  return match ? Number(match[1]) * (match[2].toLowerCase() === "y" ? 12 : 1) : Number.MAX_SAFE_INTEGER;
}

export default function DatabasePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/database-instruments")
      .then((response) => response.json())
      .then(setItems);
  }, []);

  const groups = useMemo(() => {
    const grouped: Record<string, Item[]> = {
      "Bonos en Pesos": [],
      "Bonos en UF": [],
      "Swap Promedio Cámara CLP": [],
      "Swap Promedio Cámara UF": [],
      DPF: [],
      Otros: [],
    };

    items.forEach((item) => {
      const code = item.code.toLowerCase();
      const group = code.startsWith("btp")
        ? "Bonos en Pesos"
        : code.startsWith("btu")
          ? "Bonos en UF"
          : code.startsWith("clpcam_")
            ? "Swap Promedio Cámara CLP"
            : code.startsWith("ufcam_")
              ? "Swap Promedio Cámara UF"
              : code.startsWith("dpf")
                ? "DPF"
                : "Otros";
      grouped[group].push(item);
    });

    grouped["Swap Promedio Cámara CLP"].sort((a, b) => tenorInMonths(a.code) - tenorInMonths(b.code));
    grouped["Swap Promedio Cámara UF"].sort((a, b) => tenorInMonths(a.code) - tenorInMonths(b.code));
    return Object.entries(grouped).filter(([, instruments]) => instruments.length);
  }, [items]);

  const toggle = (code: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  return (
    <AppShell>
      <div className="page-head">
        <div>
          <div className="eyebrow">Históricos</div>
          <h1>Base de Datos</h1>
          <p className="muted">Selecciona uno o más instrumentos para preparar una descarga de datos históricos.</p>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Seleccionar instrumentos</h2>
            <div className="muted">{selected.size} seleccionados</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
          <button type="button" onClick={() => setSelected(new Set(items.map((item) => item.code)))}>
            Seleccionar todos
          </button>
          <button type="button" onClick={() => setSelected(new Set())}>
            Limpiar selección
          </button>
        </div>

        <div className="database-instrument-groups">
          {groups.map(([name, instruments]) => (
            <div key={name} className="database-instrument-group" role="group" aria-label={name}>
              <div className="database-instrument-group-head">
                <h3>{name === "Bonos en Pesos" ? "BTP · Bonos en Pesos" : name === "Bonos en UF" ? "BTU · Bonos en UF" : name}</h3>
                <span className="database-instrument-group-count">{instruments.length} instrumentos</span>
              </div>
              <div className="compare-row database-instrument-list">
                {instruments.map((item) => {
                  const isSelected = selected.has(item.code);
                  return (
                    <button
                      type="button"
                      key={item.code}
                      className={`chip database-instrument-chip ${isSelected ? "on" : ""}`}
                      aria-pressed={isSelected}
                      onClick={() => toggle(item.code)}
                    >
                      {item.code.startsWith("clpcam_") || item.code.startsWith("ufcam_")
                        ? item.code.split("_")[1].toUpperCase()
                        : item.code.replace("BTP", "BTP ").replace("BTU", "BTU ")}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {!items.length && <p className="muted">Cargando instrumentos históricos…</p>}
        <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end" }}>
          <button type="button" disabled={selected.size === 0} title="La generación del archivo se agregará después">
            Descargar
          </button>
        </div>
      </section>
    </AppShell>
  );
}

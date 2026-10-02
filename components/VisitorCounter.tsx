"use client";

import { useEffect, useState } from "react";

type CounterResponse = {
  value?: number;
};

export function VisitorCounter() {
  const [visits, setVisits] = useState<number | null>(null);

  useEffect(() => {
    fetch("https://countapi.mileshilliard.com/api/v1/hit/rf-chile-mercados", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("No se pudo cargar el contador");
        return response.json();
      })
      .then((data: CounterResponse) => {
        if (typeof data.value === "number") setVisits(data.value);
      })
      .catch(() => setVisits(null));
  }, []);

  if (visits == null) return null;

  return (
    <div
      aria-label="Contador de visitas"
      style={{
        marginTop: 18,
        padding: "10px 0 2px",
        textAlign: "center",
        fontSize: 12,
        opacity: 0.68,
      }}
    >
      {new Intl.NumberFormat("es-CL").format(visits)} visitas
    </div>
  );
}

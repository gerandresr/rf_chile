"use client";

import { useEffect, useState } from "react";

type VisitStats = {
  pageviews: number;
  visitors: number;
};

export function VisitorCounter() {
  const [stats, setStats] = useState<VisitStats | null>(null);

  useEffect(() => {
    fetch("/api/visits", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("No se pudieron cargar las visitas");
        return response.json();
      })
      .then((data: VisitStats) => setStats(data))
      .catch(() => setStats(null));
  }, []);

  if (!stats) return null;

  const format = (value: number) => new Intl.NumberFormat("es-CL").format(value);

  return (
    <div
      aria-label="Estadísticas de visitas del sitio"
      style={{
        marginTop: 18,
        padding: "10px 0 2px",
        textAlign: "center",
        fontSize: 12,
        opacity: 0.68,
      }}
    >
      {format(stats.pageviews)} visitas · {format(stats.visitors)} visitantes
    </div>
  );
}

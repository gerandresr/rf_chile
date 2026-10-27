import { MarketDashboard } from "@/components/MarketDashboard";

export const metadata = { title: "Mercados · Mercado RF Chile" };

// Antigua página de inicio: curva BTP/BTU, tasas benchmark y tablas de instrumentos vigentes.
export default function Page() {
  return <MarketDashboard />;
}

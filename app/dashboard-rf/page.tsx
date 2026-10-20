import { DashboardRF } from "@/components/DashboardRF";
import { dashboardData } from "@/lib/dashboard.server";

export const metadata = { title: "Dashboard RF · Mercado RF Chile" };

// Se calcula al construir el sitio: cada actualización de datos en GitHub lo regenera.
export default function Page() {
  return <DashboardRF data={dashboardData()} />;
}

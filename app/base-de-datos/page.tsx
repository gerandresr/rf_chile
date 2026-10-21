import { DataDownloader } from "@/components/DataDownloader";
import { dataCatalog } from "@/lib/data-catalog.server";

export const metadata = { title: "Base de Datos · Mercado RF Chile" };

// El catálogo se arma al construir el sitio; los datos se descargan en el navegador al seleccionarlos.
export default function Page() {
  return <DataDownloader catalog={dataCatalog()} />;
}

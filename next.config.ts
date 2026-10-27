import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  // Rutas antiguas.
  async redirects() {
    return [
      { source: "/nueva-base-de-datos", destination: "/base-de-datos", permanent: true },
      // El Dashboard RF es la página de inicio; la antigua portada de Mercados pasó a /mercados.
      { source: "/dashboard-rf", destination: "/", permanent: true },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/data/rf.json",
          destination: "/api/rf",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;

import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  // Rutas antiguas.
  async redirects() {
    return [
      { source: "/nueva-base-de-datos", destination: "/base-de-datos", permanent: true },
      // El Dashboard RF es la página de inicio; la antigua portada de Mercados se eliminó.
      { source: "/dashboard-rf", destination: "/", permanent: true },
      { source: "/mercados", destination: "/", permanent: true },
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

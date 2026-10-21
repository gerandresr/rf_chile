import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  // La antigua "Nueva base de datos" ahora es Base de Datos.
  async redirects() {
    return [{ source: "/nueva-base-de-datos", destination: "/base-de-datos", permanent: true }];
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

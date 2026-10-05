import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

import type { NextConfig } from "next";
import path from "path";

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
  webpack(config) {
    config.module.rules.push({
      test: /MarketDashboard\.tsx$/,
      enforce: "pre",
      use: [path.resolve(process.cwd(), "loaders/market-carry-loader.cjs")],
    });
    return config;
  },
};

export default nextConfig;

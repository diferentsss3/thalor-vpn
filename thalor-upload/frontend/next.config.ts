import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const repoName = "thalor-vpn"; // ← имя вашего репозитория на GitHub

const nextConfig: NextConfig = {
  output: "export",           // статическая сборка для GitHub Pages
  basePath: isProd ? `/${repoName}` : "",
  assetPrefix: isProd ? `/${repoName}/` : "",
  images: { unoptimized: true },
  async rewrites() {
    // Эта часть работает только в dev-режиме
    if (isProd) return [];
    return [
      { source: "/api-proxy/:path*", destination: "http://localhost:3001/:path*" },
    ];
  },
};

export default nextConfig;
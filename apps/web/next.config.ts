import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  // allow testing from phones on the local network (dev only)
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*", "*.local"],
  // same-origin API (cookies, no CORS): /api/v1/* → NestJS API
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${process.env.API_URL ?? "http://127.0.0.1:4200"}/:path*` }];
  },
};

export default nextConfig;

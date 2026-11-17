import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/** the checkout this config lives in, pinned (agent worktrees sit inside the repo: see apps/web/next.config.ts) */
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const nextConfig: NextConfig = {
  turbopack: { root: ROOT },
  outputFileTracingRoot: ROOT,
  reactStrictMode: true,
  poweredByHeader: false,
  // same-origin API (no CORS): /api/v1/* → NestJS API (admin endpoints need the x-admin-token header)
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${process.env.API_URL ?? "http://127.0.0.1:4200"}/:path*` }];
  },
};

export default nextConfig;

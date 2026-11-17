import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * The checkout this config lives in (apps/web/next.config.ts → ../..), pinned instead of inferred (P3-FGT-24).
 * Agent worktrees live INSIDE the repo (.claude/worktrees/<agent>/, each a full checkout with its own lockfile and
 * node_modules): a dev server whose root is inferred can end up resolving against another checkout, and Turbopack
 * crashed ("Could not find the Next.js package … Resolved from .claude/worktrees/agent-…/apps/web/app") when a
 * worktree was deleted. Pinned, each checkout's server compiles its own files only.
 */
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const nextConfig: NextConfig = {
  turbopack: { root: ROOT },
  outputFileTracingRoot: ROOT,
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

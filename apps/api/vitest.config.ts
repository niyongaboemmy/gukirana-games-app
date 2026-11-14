import { defineConfig } from "vitest/config";

// In-memory PGlite databases start slowly when the whole monorepo verifies in parallel (turbo): give the per-file
// DB set-up hooks and the heavier service tests room, so `pnpm verify` doesn't fail on load alone.
export default defineConfig({
  test: {
    hookTimeout: 30_000,
    testTimeout: 20_000,
  },
});

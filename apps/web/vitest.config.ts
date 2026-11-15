import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // 20 s per test: the geometry/plan tests take ~1–2 s alone but hit the 5 s default when the machine is loaded
  // (parallel turbo builds); a real failure still fails, only load no longer does
  test: { include: ["src/**/*.test.ts"], testTimeout: 20_000 },
});

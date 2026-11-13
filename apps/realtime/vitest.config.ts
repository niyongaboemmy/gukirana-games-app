import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Colyseus detects a forked child (process.send) as pm2 and writes to the IPC channel; worker threads avoid that
    pool: "threads",
  },
});

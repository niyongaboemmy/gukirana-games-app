import { loadEnv } from "@gukirana/config";
import { createLogger } from "@gukirana/observability";

/**
 * Background workers (plan §6): outbox relay, settlement, payouts, reconciliation,
 * ledger invariants, Player of the Day. Each lands as its own task (P0-LED-04/05, P1B-*).
 */
const env = loadEnv();
const logger = createLogger("workers", env.LOG_LEVEL);

const jobs: string[] = [];
logger.info({ jobs }, "workers started (no jobs registered yet)");

const keepAlive = setInterval(() => undefined, 60_000);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(keepAlive);
    logger.info("workers stopped");
    process.exit(0);
  });
}

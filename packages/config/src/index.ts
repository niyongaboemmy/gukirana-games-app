import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  API_PORT: z.coerce.number().int().default(4200),
  REALTIME_PORT: z.coerce.number().int().default(2567),
  /** postgres://… in staging/prod; pglite://<dir> for local dev without Docker; pglite://memory for tests */
  DATABASE_URL: z.string().default("pglite://.data/pglite"),
  JWT_SECRET: z.string().min(16).default("dev-only-jwt-secret-change-me-please"),
  INTERNAL_SERVICE_TOKEN: z.string().min(12).default("dev-internal-service-token"),
  /** back-office (apps/admin) → api: economy settings + reports. Header x-admin-token. */
  ADMIN_SERVICE_TOKEN: z.string().min(12).default("dev-admin-service-token"),
  RESULT_SIGNING_SEED: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  API_INTERNAL_URL: z.string().default("http://127.0.0.1:4200"),
  VALKEY_URL: z.string().url().default("redis://localhost:6379"),
  NATS_URL: z.string().default("nats://localhost:4222"),
  PAYMENTS_PROVIDER: z.enum(["fake", "momo", "airtel"]).default("fake"),
  COIN_VALUE_RWF: z.coerce.number().int().positive().default(10),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parses process env once. The app refuses to start on invalid config (plan §4.1). */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${parsed.error.message}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production") {
    // never run production with dev defaults (plan §4.1)
    if (env.JWT_SECRET.startsWith("dev-") || env.INTERNAL_SERVICE_TOKEN.startsWith("dev-") || env.ADMIN_SERVICE_TOKEN.startsWith("dev-") || !env.RESULT_SIGNING_SEED) {
      throw new Error("Production requires JWT_SECRET, INTERNAL_SERVICE_TOKEN, ADMIN_SERVICE_TOKEN and RESULT_SIGNING_SEED");
    }
  }
  return env;
}

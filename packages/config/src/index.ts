import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  API_PORT: z.coerce.number().int().default(4200),
  REALTIME_PORT: z.coerce.number().int().default(2567),
  DATABASE_URL: z.string().url().default("postgres://gukirana:gukirana@localhost:5432/gukirana"),
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
  return parsed.data;
}

import { loadEnv, type Env } from "@gukirana/config";

let cached: Env | null = null;
export const env = (): Env => (cached ??= loadEnv());

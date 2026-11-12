import { pino, type Logger } from "pino";

/** Fields that must never reach logs (plan §4.1). */
export const REDACT_PATHS = [
  "*.password",
  "*.otp",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.authorization",
  "req.headers.authorization",
  "req.headers.cookie",
  "*.nationalId",
  "*.kyc",
];

export function maskPhone(msisdn: string): string {
  if (msisdn.length < 8) return "****";
  return `${msisdn.slice(0, 5)}****${msisdn.slice(-3)}`;
}

export function createLogger(service: string, level = process.env.LOG_LEVEL ?? "info"): Logger {
  return pino({ name: service, level, redact: { paths: REDACT_PATHS, censor: "[redacted]" } });
}

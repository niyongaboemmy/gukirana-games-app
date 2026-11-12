import type { HealthResponse } from "@gukirana/contracts";

export function GET(): Response {
  const body: HealthResponse = {
    status: "ok",
    service: "web",
    version: process.env.npm_package_version ?? "0.0.0",
    time: new Date().toISOString(),
  };
  return Response.json(body);
}

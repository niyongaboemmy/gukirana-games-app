import { Controller, Get } from "@nestjs/common";
import type { HealthResponse } from "@gukirana/contracts";

@Controller()
export class HealthController {
  @Get("healthz")
  health(): HealthResponse {
    return { status: "ok", service: "api", version: process.env.npm_package_version ?? "0.0.0", time: new Date().toISOString() };
  }
}

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { loadEnv } from "@gukirana/config";
import { createLogger } from "@gukirana/observability";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger("api", env.LOG_LEVEL);
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  app.enableShutdownHooks();
  await app.listen(env.API_PORT, "0.0.0.0");
  logger.info({ port: env.API_PORT }, "api listening");
}

void bootstrap();

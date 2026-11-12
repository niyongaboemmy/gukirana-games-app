# 0002. Technology stack for Phases 0–2

- Status: Accepted
- Date: 2026-11-13

## Decision
pnpm + Turborepo monorepo, TypeScript (strict, ESM) everywhere, Rust only for deterministic pool physics (WASM).
Next.js 16 web/admin, NestJS 11 (Fastify) API as a modular monolith, Colyseus for realtime rooms, PostgreSQL + Drizzle,
Valkey, transactional outbox → NATS JetStream, LiveKit voice, Three.js/R3F/WebXR for the 3D world.

## Rationale
The simplest option that meets the SRS for Phases 0–2 with one main language. See plan §2.

## Upgrade paths
Kafka/Redpanda for higher event volume, WebTransport in Phase 3, Go/Rust room servers if Colyseus limits are reached in load tests.

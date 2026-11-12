# Gukirana Games — Claude Code rules

- Plan: docs/IMPLEMENTATION-PLAN.md (tasks by ID). Specs: docs/SRS.md, docs/DESIGN-SPEC-3D-VR.md.
- Stack: pnpm + Turborepo, Next.js 16, NestJS 11 (Fastify, ESM), Colyseus, Postgres + Drizzle, Valkey, NATS, LiveKit, R3F/Three.js, Rust (pool physics only).
- Commands: pnpm dev | pnpm verify | pnpm build | pnpm test:rust | pnpm infra:up
- ESM everywhere: relative imports in packages/api/realtime/workers use the `.js` extension.
- Money: integers only (`Coins` from @gukirana/money), only LedgerService.post() changes balances, idempotency keys, fees only from packages/money.
- Fairness: server-authoritative, randomness only from @gukirana/fairness, no Math.random in game/money code (lint-enforced), no bots in cash rooms.
- One task per PR; conventional commits with the task ID; feature flags for user-facing features; i18n keys for all UI text.
- Before claiming done: run `pnpm verify` and report the real output.

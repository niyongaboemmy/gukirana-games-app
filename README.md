# Gukirana Games

A web-based skill-gaming platform (mobile-first, desktop and VR) where players meet in a **3D virtual games world**, talk by voice or text, agree on a game and play real opponents. Games at launch: **8-Ball Pool, Ludo and Igisoro**. Players use **Stars** (free practice) or **Coins** (1 🪙 = 10 RWF, real-money, licence-gated). The winner of a challenge receives exactly **2× the stake**.

> Status: **Phase 0: Foundations** (walking skeleton). See the [implementation plan](docs/IMPLEMENTATION-PLAN.md).

## Documentation

| Document | What it covers |
|---|---|
| [docs/SRS.md](docs/SRS.md) | Software requirements: games, coin economy, wallet, fairness, 3D world, compliance |
| [docs/DESIGN-SPEC-3D-VR.md](docs/DESIGN-SPEC-3D-VR.md) | Experience and game design: world, HUD, controls, VR, performance budgets |
| [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) | Phased plan with task IDs, conventions and reference implementations |
| [docs/adr/](docs/adr/) | Architecture decision records |

## Stack

pnpm + Turborepo · Next.js 16 / React 19 / Tailwind v4 · NestJS 11 (Fastify) · Colyseus · PostgreSQL + Drizzle · Valkey · NATS JetStream · LiveKit · Three.js / React Three Fiber / WebXR · Rust (pool physics → WASM)

## Repository layout

```
apps/
  web/        Next.js PWA: lobby, wallet, 3D world, VR, game screens
  admin/      Back-office
  api/        NestJS modular monolith
  realtime/   Colyseus game and world rooms
  workers/    Background jobs (outbox, settlement, payouts, reconciliation)
packages/
  money/      Coins type + fee calculator (integer-only)
  fairness/   Provably fair commit-reveal RNG
  game-kit/   GameModule contract
  contracts/  Shared zod schemas
  config/     Typed env config
  observability/  Logger with PII redaction
  db/         Drizzle schema (ledger)
  ui/         Design tokens
  i18n/       rw / en / fr / sw messages
  games/      Game engines (from Phase 1)
crates/pool-physics/   Deterministic fixed-point physics (Rust)
infra/docker/          Local services (docker compose)
```

## Getting started

Prerequisites: Node.js ≥ 24, pnpm ≥ 10, Docker (for local services), Rust stable (optional, for `crates/`).

```bash
pnpm install
cp .env.example .env.local
pnpm infra:up          # postgres, valkey, nats, minio, livekit, unleash, mailpit, grafana-otel
pnpm dev               # web :3200 · admin :3201 · api :4200 · realtime :2567

pnpm verify            # lint + typecheck + unit tests
pnpm build             # build everything
pnpm test:rust         # pool-physics tests
```

Health checks: `GET :3200/api/health`, `GET :4200/healthz`, `GET :2567/healthz`.

## Non-negotiable rules

- **Money is integer-only.** Only the ledger module changes balances, and every money command is idempotent.
- **Fairness:** the server is authoritative, all randomness comes from `@gukirana/fairness`, and there are no bots in cash matches.
- One task per PR, Conventional Commits with the task ID, e.g. `feat(world): room overflow [P1-WLD-04]`.

See [CONTRIBUTING.md](CONTRIBUTING.md) and the plan's §4 for details.

# Games

Each game is a workspace package implementing `GameModule` from `@gukirana/game-kit`:

| Package | Task | Notes |
|---|---|---|
| `igisoro/` | P1-IGI-01 | Pure TS, integer-only, no randomness |
| `ludo/` | P1-LUD-01 | Pure TS; dice from `@gukirana/fairness` |
| `pool/` | P1-POOL-02 | TS rules around the `crates/pool-physics` WASM build (`pnpm build:wasm`) |

Every engine must pass 1M-game simulations (plan §4.5) before it is playable.

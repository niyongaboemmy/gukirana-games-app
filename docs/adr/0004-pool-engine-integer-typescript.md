# 0004. Authoritative Pool physics in integer TypeScript (instead of Rust/WASM for now)

- Status: Accepted
- Date: 2026-11-13

## Context
Plan P1-POOL-01 called for a Rust fixed-point engine compiled to WASM so the server and all browsers compute identical
shots. The local Rust toolchain is broken on the main dev machine, and the server only needs to run the simulation
(clients replay recorded frames), so cross-language sharing is not required for MVP.

## Decision
`packages/games/pool` implements 8-ball physics with integers only (positions in 0.1 mm × 1000, velocities per 1/240 s tick,
integer square root, `Math.trunc` of exact IEEE divisions of safe integers — no trig, no randomness). The server simulates
each shot to rest and sends recorded frames; clients replay them exactly. The rack is shuffled with the commit-reveal RNG.

## Consequences
- Deterministic in Node and every browser; tested for identical hashes, bounds and termination.
- `crates/pool-physics` stays as the future high-performance path (spin/english, finer collision) behind the same intent schema.
- Practice mode still uses the float renderer-physics until it is migrated to this engine.

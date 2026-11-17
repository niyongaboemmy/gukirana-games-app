# P3-FGT-24: "Boxing is not working" — root causes and fixes

Reproduced on an isolated stack from the worktree (web 3220, API 4220, realtime 2577, own PGlite; the main servers
3200 / 3201 / 4200 / 2567 untouched) with two real browser players (puppeteer-core, `qa/e2e/boxing-e2e.mjs`), desktop
1280×720 and phone 844×390 (touch, landscape). Boxing rules for the runs: 1 round of 30 s (set through the console API).

## Root causes and fixes

1. **Canvas froze as soon as a fighter entered a ring** (live or practice): about 60
   `TypeError: Cannot read properties of undefined (reading 'length')` per second in three's `setupRenderTarget`; the
   hall could fall back to "Preparing the Boxing Hall…". Cause: the ring AO (P3-FGT-18, `world/Lighting.tsx`) used
   N8AO `halfRes`; n8ao 2.0.1 renders that into its `WebGLMultipleRenderTargets` shim whose `texture` getter returns
   the textures array, and three r187 reads `texture.mipmaps.length` from it. Fix: N8AO without `halfRes`.
   Test: `apps/web/src/world/lighting-ao.test.ts`.
2. **Matched fights voided at once or never started for one player.** The live boxing client ran inside the 3D
   scene; a lazily loaded person model (the v8 fighter GLB at the bell) re-suspended the whole hall, React disconnected
   the scene's effects, the client stopped and left the fight room on purpose, and the referee voided the fight as
   `LEFT_BEFORE_START` (server log: join, join, consented leave, void). It also ran in the lobby and sent ring messages
   to the lobby room. Fix: the client runs in the DOM for the whole Boxing hall visit (`LiveBoxingNet`, mounted by
   `app/room/[game]` at a fixed position outside the HUD boot gate), and every person layer of the hall (`GymLife`,
   `FightersLayer`, `Judges`, `BagWorker`) has its own Suspense boundary. Test: `apps/web/src/fight/hall-net.test.ts`.
3. **Direct challenge to a newcomer refused** ("X can't play that right now"). The matchmaker refused when the
   recipient had not accepted the game's rules card yet, although their Accept shows the card first and the match start
   re-checks every rule. Fix: the recipient's missing rules acceptance no longer blocks delivery (the sender's still
   does). Test in `apps/realtime/src/matchmaker-v2.test.ts`.
4. **Phone: More → Quick Play opened "Go to".** The More menu opens under WorldControls' slim row (same z-index, later
   in the DOM). Fix: the HUD layer goes on top while the More menu is open (`hud/WorldHud.tsx`).
5. **First-visit guide covered the Quick Play sheet** (game tabs hidden for new players). Fix: the guide card hides
   while a Quick Play / challenge sheet is open and the first-visit guide waits for the next plaza visit
   (`hud/GoToModal.tsx`).
6. **"Go to a ring · 0 s to get there" stayed up through the fight.** Boxing meetings end with
   `boxing-assigned` / `boxing-fight-ready`, not `match-ready`. Fix: cleared on those; any meeting card is dropped 3 s
   after its time (`lib/mm-store.ts`, `match/MatchmakingV2.tsx`).
7. **HUD wallet showed the pre-fight balance after a stake fight.** Fix: `loadMe()` after the fight result
   (`fight/game/net/client.ts`), as the turn games do.
8. **Main dev server Turbopack crash when a worktree was deleted.** Agent worktrees live inside the repo and the
   Turbopack root was inferred. Fix: `turbopack.root` and `outputFileTracingRoot` pinned to each checkout's own root in
   `apps/web` and `apps/admin` `next.config.ts`; `.claude` added to the ESLint and Prettier ignores. Next 16 has no
   Turbopack watch-ignore option; tsc / nest / tsx watch only their own `src`. `next build` passes for web and admin.

Money paths are unchanged: stakes are escrowed and settled by the API (`LedgerService.post`, integer Stars); the e2e
only reads `/wallet` (winner +25, loser −25, total 1000).

## Flows that pass (final code)

| Runs | Viewport | Flow | Result |
|------|----------|------|--------|
| r1, r2 | desktop 1280×720 | Quick Play → Boxing → ring 7 → Find an opponent (25 Stars) → queue → found → accept → ring → fight → result → step out | 33/33, 33/33 |
| r3, r4 | phone 844×390 | same, through More → Quick Play | 33/33, 32/32 (r4 a draw: no stake moved) |
| r5, r6 | desktop | direct challenge in the hall (Friendly) → invite → accept → fight → result → step out | 25/25, 25/25 |
| r7, r8 | phone | same | 25/25, 25/25 |
| r9, r10 | desktop, phone | Practice vs AI: Quick Play → ring prompt → practice fight → result → step out | 15/15, 15/15 |
| r11, r12 | desktop, phone | stake flow again after the wallet fix, plus the HUD wallet check | 34/34, 34/34 |
| v7 | desktop | fallback `?boxer=v7`: v7 GLBs only, no v8 asset requested, full stake flow | 33/33 |

Every run checks: same ring, opposite corners; v8 GLBs and KTX2 skins load (200); no shader compile errors; the
server's snapshots show both fighters' punches (acts, stamina spent). All 12 matrix runs: 0 page errors, 0 failed
requests, 0 HTTP ≥ 400.

## Evidence

`desktop-1-quickplay-sheet`, `desktop-2-queue`, `desktop-3-accept`, `desktop-4-ring-entry`, `desktop-5-mid-fight`,
`desktop-6-result`, the same six as `phone-*`, `desktop-challenge-invite`, `phone-challenge-invite`,
`phone-practice-mid-fight` (JPG, each under 250 KB).

## Still open

- Chrome logs 12–36 `glGetProgramiv` GL_INVALID_* warnings per page, also on the plaza before any boxing: three polls a
  program deleted during the warm-up's `compileAsync`. Not a compile error, no visible effect.
- Boxing is `enabled: false` in the default game settings (`packages/contracts/src/games.ts`): a fresh database needs
  it switched on in the back office or every boxing action is refused (GAME_DISABLED). The user's own database was not
  inspected.
- Ring AO now runs at full resolution while a fighter is in a ring (standard tier only): watch the frame rate on
  low-end phones.

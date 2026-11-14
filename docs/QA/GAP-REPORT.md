# QA-01 gap report — Gukirana Playground end to end

Date 2026-11-14 · build: worktree rebased on `main` 95a7a6d (Tournament Arena v2) · isolated stack (web :3500 dev
build, api :4300, realtime :2600, admin :3501, scratch PGlite) · Chrome headless "new" (ANGLE Metal) · plan:
[TEST-PLAN.md](TEST-PLAN.md) · accounts: [ACCOUNTS.md](ACCOUNTS.md) · machine-readable: [gaps.json](gaps.json).

## Executive summary

| Severity | Count | Gaps |
| -------- | ----- | ---- |
| P0 blocker | 0 | — |
| P1 major   | 2 | GAP-001, GAP-002 |
| P2 minor   | 6 | GAP-003 … GAP-008 |
| P3 polish  | 10 | GAP-009 … GAP-018 |

Every core journey works end to end: gate sign-in (email and phone, dev OTP), wardrobe onboarding, walking into the
plaza and through every hall door with no frame gap over 250 ms, practice vs AI in all three games, PvP challenge /
quick match with Stars escrow and settlement (ledger nets to zero after every run), wallet (daily claim, activity,
play-safe limits, top-up / cash-out stop at "Pilot"), the Administrative Block knock protocol (Let in / Please wait /
Decline / expiry / nobody inside / full), the console for all five staff roles with the exact section map, arena
scopes and passes, and the back office with the admin token. No page errors or console errors in the world runs.

Top risks:
1. **Suspension is not immediate (GAP-001, GAP-002).** A suspended player keeps a working API token for up to 15
   minutes and an open realtime connection indefinitely: they can still chat and be staked into a match. A suspended
   staff member keeps staff powers on every RoleGuard endpoint. One fix point each (status in `AccessService.access()`
   and a suspension event to realtime) closes most of it.
2. **Privacy of responsible-play status (GAP-005).** The opponent is told the other player is "ON_A_BREAK" or at
   "DAILY_LIMIT_REACHED".
3. **Silent refusals at doors (GAP-003, GAP-004).** A suspended account sees "That doesn't look right", and a player at
   a closed building / barred from the arena is stopped with no message.
4. **Performance budgets (GAP-008).** The plaza draws ~400–460 calls and ~1M triangles per frame (Standard budget
   150 / 300k). It runs at 60 fps on the test GPU, but mid-range phones are at risk.

## Coverage matrix

`pass` = journey passed (any failing check in it is listed as a gap), `fail` = a product gap was found, `blocked` =
could not be automated (reason in notes), `n/t` = not tested on that device.

| Journey | Desktop 1280×720 | Phone 844×390 | Tablet 1180×820 | Portrait 390×844 |
| ------- | ---------------- | ------------- | --------------- | ---------------- |
| Gate: first load, intro skeleton, 3D ready | pass (2.1 s to ready) | pass (2.4 s) | n/t | n/t |
| Gate: sign-in email + dev OTP, wardrobe, walk in | pass | pass | n/t | n/t |
| Gate: returning player by phone | pass | pass | n/t | n/t |
| Gate: sign-out walk-out, session revoked | pass | pass | n/t | n/t |
| Gate: suspended refused | fail (GAP-003) | fail (GAP-003) | n/t | n/t |
| Plaza: keyboard / tap-to-walk / joystick | pass | pass (joystick + release) | n/t | rotate prompt shown |
| Plaza: benches sit / stand | pass | pass | n/t | n/t |
| Plaza: people (bot), wave, handshake consent, person menu | pass | n/t | n/t | n/t |
| Plaza: chat (T, tabs, send, filter, Esc) | pass | n/t | n/t | n/t |
| Plaza: private request UI | not confirmed (request not surfaced in DOM within 1.5 s; badge "T 1" shown) | n/t | n/t | n/t |
| Plaza: voice toggle UI | pass (UI only; no mic in headless) | n/t | n/t | n/t |
| Settings (pace, theme, sounds, Esc), avatar editor | pass (GAP-017 polish) | n/t | n/t | n/t |
| Halls: door walk in / out, URL follows | pass (pool, ludo, igisoro) | pass (pool) | n/t | n/t |
| Halls: table picker, sit, practice vs AI, how-to, pause, leave | pass (pool, ludo; igisoro see test-tool notes) | pass (pool) | n/t | n/t |
| Halls: Leave fail-safe | pass | pass | n/t | n/t |
| Closed building at the plaza door (player vs staff) | fail (GAP-004; staff pass) | n/t | n/t | n/t |
| PvP: challenge, decline, accept, expiry, escrow, settle | pass (protocol) | — | — | — |
| PvP: quick match, forfeit, queue leave | pass (protocol) | — | — | — |
| PvP: daily limit, self-exclusion | pass (enforced) · fail (GAP-005, GAP-011) | — | — | — |
| Suspension while connected | fail (GAP-001) | — | — | — |
| Wallet: open, Stars vs Coins, claim + streak, activity, play safe, pilot | pass | pass | n/t | n/t |
| Admin Block: door, office picker, no names | pass | n/t | n/t | n/t |
| Admin Block: reception (rule-based, privacy, rate limit) | pass (API) | n/t | n/t | n/t |
| Admin Block: knock protocol (all outcomes), office chat scope | pass (protocol) · GAP-012, GAP-013 | — | — | — |
| Admin Block: knock UI states (QA hook), role holder auto-enter | pass | n/t | n/t | n/t |
| Admin Block: lobby seat, officer computer → console | blocked (needs exact walk targets) | n/t | n/t | n/t |
| Console: player refused, sections per role (5 roles) | pass | n/t | pass (spot check) | n/t |
| Console: people search / detail, suspend + reactivate, protections | pass · fail (GAP-006, GAP-007) | n/t | n/t | n/t |
| Console: buildings close / reopen with message | pass | n/t | n/t | n/t |
| Console: finance vs ledger (reconciliation) | pass (17,400 Stars issued = ledger report) | n/t | n/t | n/t |
| Arena: guest → gate, closed door, close by admin walks out | pass | n/t | n/t | n/t |
| Arena: barred at the door | fail (GAP-004: kept out, no message) | n/t | n/t | n/t |
| Arena: event card + scope in plain words, get a pass | pass | n/t | n/t | n/t |
| Arena: pass rules (invite-only, participant floor, sold out, return, bars, overlap) | pass (API) | — | — | — |
| Arena v2: seat finder / venue features | blocked (script not updated to v2 flow) | n/t | n/t | n/t |
| Back office /finance /access /arena | pass (GAP-015 polish) | — | — | — |
| Security: staff endpoints, admin + internal tokens, PII | pass | — | — | — |
| Money: integers, ledger balanced after PvP, escrow released | pass | — | — | — |

Performance (median WebGL draw calls per frame / triangles, 60 fps headless on Apple GPU):

| Area | Desktop | Phone viewport |
| ---- | ------- | -------------- |
| Plaza | 398 / 995k | 457 / 1.01M |
| Pool Hall | 243 / 697k | 314 / 727k |
| Ludo Lounge | 98 / 502k | n/t |
| Igisoro Court | 141 / 403k | n/t |
| Tournament Arena (v2) | 233 / 355k | n/t |
| Administrative Block | 92 / 110k | n/t |

Door crossings: worst frame 50–217 ms walking in (admin block 200–217 ms, the others ≤ 83 ms); Leave → plaza 0.5–5.5 s
(walk-out animation), worst frame ≤ 117 ms. No freeze over 250 ms anywhere.

## Gaps

### GAP-001 · P1 · security — Suspending a player does not end their session
- **Steps:** sign in as `qa_lv30` and join the plaza; suspend `qa_lv30` from the console (reason given); with the old
  access token call `GET /me`, `GET /wallet`; from the open plaza connection send a room chat and propose a 25-Star
  match to `qa_pvp1`, who accepts.
- **Expected:** suspension takes effect at once — old tokens refused, the connection closed, no chat, no stake locked.
- **Actual:** `/me` and `/wallet` answer 200 (token valid up to 15 min); the realtime connection stays open; the chat
  is delivered; the match is created and 25 Stars of `qa_pvp1` are locked in escrow against a suspended player.
  New sign-ins and refreshes are refused (correct).
- **Evidence:** [evidence/GAP-001-suspended-player-keeps-access.txt](evidence/GAP-001-suspended-player-keeps-access.txt) (2 runs).
- **Suspected:** `apps/api/src/common/auth.ts` `AuthGuard` (JWT only); `apps/realtime/src/auth.ts` `verifyToken` +
  `world-room.ts` `onAuth` (checked once at join); `apps/api/src/modules/games/games.service.ts` `create()` (no status
  check); `console.service.ts` `setStatus()` (no token revocation / realtime notice).
- **Fix:** on suspend, revoke refresh tokens and publish a suspension event realtime uses to close the user's sessions;
  AuthGuard (cached) and `GamesService.create` refuse non-active users.

### GAP-002 · P1 · security — A suspended staff member keeps staff powers
- **Steps:** sign in as `qa_it`; `qa_super` suspends `qa_it`; `qa_it`'s token calls `GET /console/users?q=qa_`.
- **Expected:** 401/403. **Actual:** 200 — RoleGuard re-reads roles every request but ignores `users.status`.
- **Evidence:** [evidence/GAP-002-suspended-staff-keep-console.txt](evidence/GAP-002-suspended-staff-keep-console.txt) (2 runs).
- **Suspected:** `apps/api/src/modules/admin-block/role.guard.ts`; `access.service.ts` `access()`;
  `apps/realtime/src/social/office-access.ts` (office doors / answering knocks).
- **Fix:** `AccessService.access()` returns no roles for a non-active account (one place covers API + realtime).

### GAP-003 · P2 · gate — Suspended account sees "That doesn't look right"
- **Steps:** gate → `qa.suspended@example.test` → code → Verify. **Expected:** "This account is suspended…".
  **Actual:** generic validation message (desktop + phone, 3 runs). **Suspected:** `apps/web/src/world/gate/gate-store.ts`
  `GATE_MSG` lacks `ACCOUNT_INACTIVE`. **Fix:** add the message + i18n key.

### GAP-004 · P2 · plaza — Closed building / barred arena: kept out silently
- **Steps:** close Ludo from the console with a message (or use `qa_barred` at the arena); walk (click-to-walk) into
  the door. **Expected:** kept out with "Ludo Lounge is closed · back at 18:00" / the arena "You can't enter" card.
  **Actual:** kept out (correct) at visually open glass doors, no message, Interact shows no closed label; staff enter
  correctly. 2 runs each. Only click-to-walk approaches were tested.
- **Suspected:** `apps/web/src/world/Player.tsx` proximity block (~l.383–409, `nearPortal` facing / radius / re-entry
  guard); `apps/web/src/hud/WorldHud.tsx` `closedMsg` (l.89–101, 239); `apps/web/src/arena/ArenaDoorWatch.tsx` `near`.
- **Fix:** show the refusal card from the door refusal itself and keep it until the player walks away.

### GAP-005 · P2 · pvp — Responsible-play status disclosed to the opponent
- **Steps:** `qa_break` challenges `qa_pvp1` (25 Stars), who accepts; or both quick-match pool / 25.
- **Expected:** only the affected player learns why. **Actual:** both get `ON_A_BREAK` / `DAILY_LIMIT_REACHED`.
- **Suspected:** `apps/realtime/src/rooms/world-room.ts` proposal-respond catch (~l.473), quickmatch-join catch
  (~l.492). **Fix:** specific reason to the affected player, neutral reason to the other.

### GAP-006 · P2 · console — People search can't find usernames with "_"
- **Steps:** search `qa_lv30` (UI or `GET /console/users?q=qa_lv30`). **Expected:** found. **Actual:** "No accounts
  match." (the term becomes `qalv30`); `lv30` works. **Suspected:** `console.service.ts` `listUsers()` l.87 and
  `access.service.ts` `listUsers()` strip `_`/`%`. **Fix:** escape LIKE wildcards instead of deleting them.

### GAP-007 · P2 · console — Super admin can revoke their own (last) super_admin role
- **Steps:** as the only super admin, `POST /admin/access/revoke {user: self, role: super_admin}`. **Expected:**
  refused. **Actual:** 200, no super admin left. **Suspected:** `access.service.ts` `revoke()` (l.371). **Fix:** refuse
  self-revoke and removing the last super admin.

### GAP-008 · P2 · performance — Standard tier budgets exceeded
- See the performance table. **Expected (DESIGN-SPEC §16.1, Standard):** ≤ 150 draw calls, ≤ 300k triangles.
  **Suspected:** plaza / hall scene builders and tier selection (`apps/web/src/world/SceneCanvas.tsx`). **Fix:** verify
  the auto tier on a mid phone; merge / instance static props, LOD crowds and distant detail.

### P3 (polish)
| Id | Area | Title | Suspected | Fix |
| -- | ---- | ----- | --------- | --- |
| GAP-009 | console | `POST /console/users/<bad id>/status` → 500 (GET answers 400) | `console.service.ts` `setStatus()` | validate the UUID first |
| GAP-010 | gate | Username rule 3–16 (web) vs 2–16 (API) | `gate-store.ts` l.44/56, `identity.controller.ts` `ProfileSchema` | one schema in contracts |
| GAP-011 | pvp | Limit / break checked only after the opponent accepts | `world-room.ts` propose (l.432), quickmatch-join | check `assertCanStake` before delivering |
| GAP-012 | admin-block | Lobby room chat reaches people inside closed offices (confirm intent) | `world-room.ts` chat (l.310) | filter with `desk.sameRoom` or document |
| GAP-013 | admin-block | Visitors stay in an office after the last staff member leaves (confirm intent) | `office-desk.ts` `leftOffice()` (l.176) | walk visitors out / notify |
| GAP-014 | security | Movement is client-authoritative (no speed / teleport check) | `world-room.ts` move (l.233) | clamp displacement per tick |
| GAP-015 | back-office | Stale "Could not load: 401" after a good token; `/favicon.ico` 404 | `apps/admin/app/access|arena/page.tsx`, no icon | clear the error on load; add `app/icon.svg` |
| GAP-016 | console | Recent staff actions show raw ids and JSON | `console/sections-live.tsx` l.69, `access.service.ts` `auditLog()` | join usernames, words for details |
| GAP-017 | cross-cutting | Light theme muted text ≈ 3.2:1 | light theme muted token (globals.css / packages/ui) | darken to 4.5:1 |
| GAP-018 | cross-cutting | 33 hard-coded JSX strings + module catalogues not in @gukirana/i18n | SettingsModal, GateFlow, social/*, console/* | move to packages/i18n |

## Known limits (reported earlier, not new gaps)

Arena commentator mic is P2P (≈ 8 peers, LiveKit not wired); VIP voice scope is client-side only; players can't sit at
stage tables; boards show no live match data; no scarf / flag wave; seat pads always down; Stand & cheer releases the
seat.

## Checks that passed (highlights)

- Security: players get 403 on every console / access / arena admin endpoint; admin endpoints need `x-admin-token`
  (wrong token 401); internal endpoints need the internal token; forged JWT 401; no unmasked email / phone in
  `/arena/*`, `/buildings`, `/economy`, `/players/:id`, the office directory or console lists; reception never names
  who is inside (3 probing questions), needs sign-in, rate limited (1/s, 12/min).
- Money: all balances integers, fractional quotes and limits refused; stake 50 + 50 → pot 100 to the winner, escrow
  back to 0; quick-match forfeit settles; ledger reconciliation `ok`, STAR net 0 after every PvP run; finance UI =
  ledger report.
- Responsible play: limit 100 refuses a 200 stake; break refuses staked play (challenge and quick match) but allows
  free games; raising a limit waits 24 h, lowering is immediate; a break cannot be shortened.
- Console protections: reason required (≥ 3 chars), cannot change self, support cannot touch a super admin,
  accountant cannot suspend, role grant / revoke effective on the next request, unknown building 400.
- Arena: members scope, invite-only (NOT_INVITED / invited ok), participant → floor, sold out, return pass, barred
  (status + claim), arena closed (players out, staff in), console building switch closes the arena, overlap refused,
  arena staff cannot be barred, guest deep link → gate.
- UI: no emojis, no blue buttons (avatar colour swatches excluded), icon buttons labelled, Esc closes chat / person
  menu / settings / avatar editor / wallet / account drawer; tab order through the HUD is logical.

## Test-tool notes (not product bugs)

- OTP limit (3 per identifier per 10 min) and rotating refresh cookies: two QA scripts running at once overwrite each
  other's session cache (stale cookie → the browser lands on the gate). Early runs hit this; all reported results come
  from sequential re-runs.
- Igisoro practice: Esc did not open the menu in the scripted sequence after moves (2 runs) but did in isolation —
  unconfirmed, not reported.
- Arena v2 merged mid-run: the seat-finder script did not reach a seat within 45 s; it needs updating to the v2 flow.
- Admin block lobby chairs and the officer computer prompt need exact walk targets; the console was reached via
  `/console` instead (all roles pass there).
- The automated contrast check treats gradient buttons as transparent; light theme was verified on a screenshot.

## How to re-run

```bash
DATABASE_URL=pglite://$PWD/.data/qa-pglite API_INTERNAL_URL=http://127.0.0.1:4300 pnpm --filter @gukirana/api run seed:qa
# start the stack on 4300 / 2600 / 3500 / 3501 (TEST-PLAN.md §1), then, one at a time:
node qa/e2e/api.mjs && node qa/e2e/pvp.mjs && node qa/e2e/office.mjs
node qa/e2e/ui-gate.mjs desktop && node qa/e2e/ui-world.mjs desktop participant
node qa/e2e/ui-buildings.mjs desktop && node qa/e2e/ui-console.mjs desktop && node qa/e2e/ui-closed.mjs && node qa/e2e/ui-backoffice.mjs
```

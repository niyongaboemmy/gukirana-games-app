# QA-01 test plan — Gukirana Playground end to end

Scope: the whole platform as real users, from guests and players to every staff role (gate, plaza, halls, PvP,
wallet, Administrative Block, staff console, Tournament Arena, back office) plus cross-cutting checks (errors,
freezes, themes, palette, emojis, i18n readiness, accessibility, performance, money rules, security). Results and gaps:
[GAP-REPORT.md](GAP-REPORT.md) / [gaps.json](gaps.json). Accounts: [ACCOUNTS.md](ACCOUNTS.md).

## 1. Test environment (isolated)

| Service  | Port | How it runs (from the worktree)                                                         |
| -------- | ---- | --------------------------------------------------------------------------------------- |
| API      | 4300 | `node apps/api/dist/main.js` with `API_PORT=4300`, `DATABASE_URL=pglite://<worktree>/.data/qa-pglite` |
| Realtime | 2600 | `node apps/realtime/dist/index.js` with `REALTIME_PORT=2600`, `API_INTERNAL_URL=http://127.0.0.1:4300` |
| Web      | 3500 | `next dev --port 3500` (dev build: QA hooks on) with `API_URL=http://127.0.0.1:4300`, `NEXT_PUBLIC_REALTIME_URL=ws://localhost:2600` |
| Admin    | 3501 | `next dev --port 3501` with `API_URL=http://127.0.0.1:4300`                             |

Ports and URLs come from `packages/config` (`API_PORT`, `REALTIME_PORT`, `API_INTERNAL_URL`, `DATABASE_URL`) and the
Next rewrites (`API_URL`, `NEXT_PUBLIC_REALTIME_URL`). Never use the developer ports (3200 / 3201 / 4200 / 2567).

```bash
pnpm install && pnpm turbo run build --filter='./packages/**' --filter=@gukirana/api --filter=@gukirana/realtime
npm install --prefix qa/e2e                       # puppeteer-core + colyseus.js (not a workspace package)
Q=$PWD/.data/qa-pglite
DATABASE_URL=pglite://$Q API_INTERNAL_URL=http://127.0.0.1:4300 pnpm --filter @gukirana/api run seed:qa
(cd apps/api && API_PORT=4300 API_INTERNAL_URL=http://127.0.0.1:4300 DATABASE_URL=pglite://$Q node dist/main.js) &
(cd apps/realtime && REALTIME_PORT=2600 API_INTERNAL_URL=http://127.0.0.1:4300 node dist/index.js) &
(cd apps/web && API_URL=http://127.0.0.1:4300 NEXT_PUBLIC_REALTIME_URL=ws://localhost:2600 npx next dev --port 3500) &
(cd apps/admin && API_URL=http://127.0.0.1:4300 npx next dev --port 3501) &
# when done: stop the four processes, then rm -rf .data/qa-pglite
```

Browser: Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` through puppeteer-core, headless
"new", `--use-angle=metal --enable-webgl --ignore-gpu-blocklist`. One browser at a time (RAM); API / realtime checks
run without a browser where the UI is not the point.

Viewports: desktop 1280×720, phone landscape 844×390 (touch, DPR 2), tablet 1180×820 and portrait 390×844 for spot
checks (set in `qa/e2e/lib.mjs` `VIEWPORTS`).

## 2. Scripts (`qa/e2e/`)

| Script               | Kind      | Covers |
| -------------------- | --------- | ------ |
| `api.mjs`            | API       | Gate / auth (OTP, onboarding fields, logout, rate limit, phone, suspended), security (player vs staff endpoints, admin + internal tokens, forged tokens, PII in public endpoints), console section map per role, suspend / reactivate + protections, buildings, roles grant / revoke, finance vs reconciliation, wallet (claim, quotes, limits, break), arena (scopes, passes, sold out, closed, bars, overlap) |
| `pvp.mjs`            | realtime  | Challenge decline / accept / expiry, escrow + settlement, stranger refused from a match, quick match + forfeit, daily stake limit, self-exclusion, suspension while connected, ledger balanced |
| `office.mjs`         | realtime  | Admin block: role holder auto-enter, knock → Decline / Please wait / Let in / expiry / nobody inside / unknown office / guest / full, office chat scope, reception privacy + rate limit |
| `ui-gate.mjs`        | browser   | First load + intro, bad id, email sign-in with dev OTP, wardrobe (onboarding), walk in, sign-out walk-out, suspended refusal message, returning player by phone |
| `ui-world.mjs`       | browser   | Plaza keyboard / joystick / tap-to-walk, benches, realtime bot: nearby chat, chat panel (T, send, filter, Esc), DM request, handshake consent, person menu + wave, voice toggle, settings (themes + contrast, pace, sounds, Esc), tab order, avatar editor, wallet (claim, activity, play safe, top-up / cash-out pilot), halls (door walk in, table picker, sit, practice vs AI, how-to, pause, leave, Leave fail-safe, walk out), FPS + draw calls, palette / emoji / label scans |
| `ui-buildings.mjs`   | browser   | Admin block (door, office picker, reception chat, empty office knock, knock UI states via `__gkOffice`, lobby seat, staff auto-enter, officer computer → console) and Arena (barred door, event card + plain-words scope, pass, seat finder, sit / stand, close by admin → walked out, closed door, guest deep link) |
| `ui-console.mjs`     | browser   | `/console` for a player (refused) and each staff role (sections + each section renders), suspend / reactivate in the UI with reason, close / reopen a building, finance numbers vs ledger report |
| `ui-backoffice.mjs`  | browser   | apps/admin `/`, `/finance`, `/access`, `/arena`: no token, wrong token, admin token |
| `ui-closed.mjs`      | browser   | Building closed from the console: the plaza door keeps a player out (with the message), lets staff in |
| `session-race.mjs`   | browser   | Session restore from the refresh cookie: number of `/auth/refresh` calls and where the player lands |
| `explore.mjs`        | helper    | Ad-hoc page dump (buttons, inputs, text, probe, screenshot) |

**Run the scripts one at a time.** They share a session cache (`$TMPDIR/gk-qa/sessions.json`, rotating refresh
cookies, OTP limit 3 per 10 minutes); two scripts at once invalidate each other's cookies.

Each script prints `PASS / FAIL / NOTE` lines and writes `$TMPDIR/gk-qa/<suite>.json`. Evidence screenshots
(JPEG, small) go to `$TMPDIR/gk-qa/shots` (`QA_EVIDENCE` overrides); only evidence referenced by P0 / P1 gaps is committed under `docs/QA/evidence/`.

```bash
node qa/e2e/api.mjs
node qa/e2e/pvp.mjs            # --no-expiry skips the 60 s wait
node qa/e2e/office.mjs         # --no-expiry skips the 30 s wait
node qa/e2e/ui-gate.mjs desktop && node qa/e2e/ui-gate.mjs phone
node qa/e2e/ui-world.mjs desktop qa-key [plaza,people,settings,wallet,halls]
node qa/e2e/ui-world.mjs phone participant plaza,wallet,halls
node qa/e2e/ui-buildings.mjs desktop
node qa/e2e/ui-console.mjs desktop
node qa/e2e/ui-backoffice.mjs
```

## 3. Journeys and expected results

### Gate
- G1 First load `/` → `/gate`, skeleton "Arriving at the gate…", 3D ready, ID panel slides in.
- G2 Bad identifier → plain message. Email → dev code → 6 digits (keypad or tap to fill) → Verify.
- G3 New account → wardrobe (username, body style, skin / hair / outfit) → "Enter the playground" → walks into the plaza.
- G4 Returning player by phone → no wardrobe, walks straight in.
- G5 Sign out (settings) → walks out through the gate; the refresh cookie is revoked.
- G6 Suspended account → refused with a message that says the account is suspended (not a generic error).

### Plaza
- P1 Keyboard W/S walk, A/D turn; joystick on touch (release stops); click / tap the ground walks there.
- P2 Benches: near-seat prompt, sit, stand.
- P3 People: others visible, nearby counter, wave (reaches the person), handshake asks for consent and plays for both.
- P4 Chat: T opens, Nearby / Room / Private tabs, send reaches others, filter, Esc closes; private request → accept / block.
- P5 Voice toggle; person menu (Handshake … Report); settings (pace, theme light / dark readable, sounds); avatar editor.

### Halls (Pool, Ludo, Igisoro)
- H1 Continuous door walk in (no loading screen, no frame gap > 250 ms), URL follows (`/room/<game>`).
- H2 Table picker → sit → Practice vs AI → how-to → a few moves → pause (Esc) → leave the game → back at the table.
- H3 Leave (HUD) fail-safe → plaza; walking out of the door → plaza.

### PvP
- V1 Challenge (stake 0/25/50/100/200), decline, accept → both get the match; stakes escrowed; expiry after 60 s.
- V2 Result → winner gets the pot (Stars, no fee); escrow released; ledger nets to 0; activity lists stake + win.
- V3 Quick match pairs two players; leaving forfeits; the queue can be left.
- V4 Daily stake limit and self-exclusion refuse staked matches; free games still allowed.

### Wallet
- W1 3D wallet opens from the HUD Stars; Stars vs Coins explained; daily claim + streak (once per Kigali day).
- W2 Activity; play-safe limits (lowering immediate, raising after 24 h; break cannot be shortened).
- W3 Top up / cash out stop at "Pilot" (no payment).

### Administrative Block
- A1 Door walk in; office picker (four offices, "You can enter" / "Visitors knock", staff counts, no names).
- A2 Reception chat (rule-based fallback without `ANTHROPIC_API_KEY`), never names who is inside, rate limited.
- A3 Role holder walks straight in; visitor knock → Let in / Please wait / Decline / expiry / nobody inside / office full.
- A4 Office conversation reaches only the people inside; officer computer → console boot → log off back to the office.

### Staff console
- C1 `/console` refuses a player ("staff only"); each role sees exactly its sections (SECTION_ROLES).
- C2 People search / detail (masked contacts), suspend + reactivate with a reason; protections (self, super admin).
- C3 Buildings close / open; the public `/buildings` and the plaza door follow; staff still enter.
- C4 Roles grant / revoke take effect at once; finance numbers match the ledger report; reconciliation ok.

### Tournament Arena
- R1 Closed / barred / guest door behaviour in plain words; event card + scopes in plain words.
- R2 Pass claim / return / sold out / invite-only / participant floor; seat finder → sit / stand.
- R3 Admin closes the arena or bars someone → walked out to the plaza.
- R4 apps/admin `/arena` with the admin token.

### Cross-cutting
- X1 No page errors / console errors; no frame gap > 250 ms on door crossings (measured).
- X2 Dark / light window theme readable (WCAG 4.5:1 for panel text); chocolate buttons, no blue UI; no emojis.
- X3 i18n readiness (strings in catalogues, hard-coded count noted); accessibility basics (Esc closes, labels, tab order).
- X4 Performance: FPS and draw calls per frame on the plaza and each hall (WebGL draw calls counted per frame).
- X5 Money: integers only, ledger nets to zero after PvP, escrow released. Security: staff endpoints refuse players,
  admin token required, internal token required, no personal data in public endpoints.

## 4. Rules for reporting

Re-run a failure once before reporting; mark flaky ones as flaky; separate test-tool problems from product bugs;
P0 = blocks a journey, P1 = major (security, money, a core journey broken), P2 = minor, P3 = polish.

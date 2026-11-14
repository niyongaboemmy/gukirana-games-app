# QA accounts (QA-01)

Seeded by `apps/api/src/scripts/seed-qa.ts` (`pnpm --filter @gukirana/api run seed:qa`). **Dev / test only**: the
script refuses to run with `NODE_ENV=production`, and every account uses the reserved `@example.test` domain (RFC
2606: never deliverable). Sign in at the gate with the email (or the phone where listed); the dev OTP is shown on the
kiosk ("Dev code: …, tap to fill") and returned by `POST /auth/otp/request` in non-production builds.

## How the seed works

- It opens `DATABASE_URL` directly and runs the migrations, so with **PGlite run it before the API starts** (PGlite is
  single-process). It refuses to run while an API answers at `API_INTERNAL_URL` with a PGlite database.
- Idempotent: re-running updates the QA profile fields (username, phone, XP, status) back to the values below and
  never double-grants Stars.
- **Stars** only through `LedgerService.post()` with the existing `stars_grant` entry type and idempotency keys:
  `welcome:<userId>` (500, the same grant a real sign-up gets) and `qa-seed:<userId>:stars:v1` (extra Stars below).
  Coins are never touched; no payment is faked. The script prints `ledgerTotal` (must be 0).
- **XP / level** set directly on `users.xp` (`totalXpForLevel(level)`); **status** directly on `users.status`.
- **Limits / break** through `WalletService.setLimits` / `takeBreak` (same rules as the wallet).
- **Roles** through `AccessService.grant` (the grant-role CLI logic), audited as `cli`.
- **Arena** through `ArenaService` (settings, events, invites, participants, bars), audited as `qa-seed`.

```bash
# isolated QA stack: scratch PGlite + ports 4300 / 2600 / 3500 / 3501
export DATABASE_URL=pglite://$PWD/.data/qa-pglite API_INTERNAL_URL=http://127.0.0.1:4300
pnpm --filter @gukirana/api run seed:qa      # before the API starts
```

## Accounts

| Email                         | Username         | Role / state                         | Level | Stars (seed) | What it is for |
| ----------------------------- | ---------------- | ------------------------------------ | ----- | ------------ | -------------- |
| — (no account)                | —                | guest                                | —     | —            | Gate first load, plaza as a guest is not possible (gate), arena `LOGIN_REQUIRED`, realtime guest refusals |
| `qa.new@example.test`         | (none)           | new player, onboarding not done      | 1     | 500          | Gate → wardrobe (username + avatar) on first sign-in |
| `qa.lv1@example.test`         | `qa_lv1`         | player                               | 1     | 500          | Normal player, level 1; daily claim; arena member pass |
| `qa.lv5@example.test` / `0789 990 005` | `qa_lv5` | player (has a phone)               | 5     | 500          | Sign-in **by phone**; office visitor; arena uninvited |
| `qa.lv12@example.test`        | `qa_lv12`        | player                               | 12    | 500          | Normal player; role grant / revoke target |
| `qa.lv30@example.test`        | `qa_lv30`        | player                               | 30    | 500          | High level; suspend / reactivate target |
| `qa.limit@example.test`       | `qa_limit`       | daily stake limit **100** Stars      | 3     | 1,500        | Daily stake limit enforcement (stake 200 refused) |
| `qa.break@example.test`       | `qa_break`       | self-exclusion break (**7 days**)    | 3     | 1,500        | "Take a break": staked games refused, free games allowed |
| `qa.suspended@example.test`   | `qa_suspended`   | **suspended**                        | 2     | 500          | Sign-in refused (`ACCOUNT_INACTIVE`) |
| `qa.pvp1@example.test`        | `qa_pvp1`        | player                               | 6     | 2,500        | PvP challenger (stakes) |
| `qa.pvp2@example.test`        | `qa_pvp2`        | player                               | 6     | 2,500        | PvP opponent; realtime bot in UI people tests |
| `qa.super@example.test`       | `qa_super`       | `super_admin`                        | 10    | 500          | Every console section; roles grant / revoke |
| `qa.it@example.test`          | `qa_it`          | `it_admin` (IT Office)               | 8     | 500          | People, buildings, live monitor |
| `qa.accountant@example.test`  | `qa_accountant`  | `accountant` (Accountant office)     | 8     | 500          | Finance only |
| `qa.support@example.test`     | `qa_support`     | `support_agent` (Customer Support)   | 8     | 500          | People (suspend / reactivate); office role holder |
| `qa.events@example.test`      | `qa_events`      | `event_manager` (arena staff)        | 8     | 500          | Arena admin; overview / visitors only in the console |
| `qa.invited@example.test`     | `qa_invited`     | invited to the invite-only event     | 4     | 500          | Invite-only pass |
| `qa.participant@example.test` | `qa_participant` | participant of both QA events        | 9     | 500          | Floor pass (zone `floor`); main UI walk-through account |
| `qa.barred@example.test`      | `qa_barred`      | **barred** from the arena (no expiry) | 4    | 500          | Barred at the arena door / pass refused |

Levels follow `levelForXp` (`xp = 25 · L · (L − 1)`): level 5 = 500 XP, 12 = 3,300 XP, 30 = 21,750 XP.

## Arena seed

| Event                  | Status (after the sweep)             | Scope (rules)         | Times                                       | Capacity |
| ---------------------- | ------------------------------------ | --------------------- | ------------------------------------------- | -------- |
| `QA Members Night`     | `scheduled` → `doors_open` (now)     | `members`             | doors −10 min, start +3 h, end +5 h         | 40 seats + 4 VIP |
| `QA Invite-only Final` | `scheduled` (upcoming, next day)     | `invite`              | doors +20 h, start +21 h, end +23 h (no overlap) | 10 seats |

- Arena building switch: **open** (`arena_settings.open = true`).
- `qa_invited` is invited (zone `seats`) to the invite-only event; `qa_participant` is a participant of both;
  `qa_barred` is barred with reason "QA seed: barred for testing".
- Re-running reuses a non-terminal event with the same title; once an event has ended, a new one is created.

## Notes for testers

- OTP requests are limited to **3 per identifier per 10 minutes**. The QA scripts cache sessions (refresh cookie)
  under `$TMPDIR/gk-qa/sessions.json` and hand the browser's rotated cookie back after each run; if you hit
  `OTP_RATE_LIMITED`, wait 10 minutes or use another account.
- Tests change state (daily claims, PvP balances, passes). Re-run the seed to restore profile fields; Stars balances
  are not reset (ledger entries are append-only).

# Tournament Arena — access and event control (P2-ARN-02)

> Scope: who may enter the Tournament Arena building, who may sit where during an event, and how staff run it.
> Contract: `packages/contracts/src/arena.ts` (P2-ARN-01). Related: SRS §5.5 (FR-TRN), IMPLEMENTATION-PLAN P2-TRN,
> WORLD-ARENA-DESIGN.md (the bowl), the Administrative Block access module (P2-ADM-03, roles + audit).

## 1. Actors

| Actor | Who | Can |
|---|---|---|
| Guest | not signed in (no token) | enter the concourse while open; sit anywhere when no event runs; sit in an **open-seating** (public-only) event while seats remain; never claim a pass |
| Player | signed in | as guest + claim passes the event scope admits |
| Participant | on the event's participant list | pass in zone `floor` (competition floor) + seats |
| Invited guest | on the invite list (invite carries a zone: seats, vip or floor) | pass in the invited zone |
| Role holder (staff / press / VIP) | holds a role from the Admin Block role table | passes for `role` scoped events; `super_admin` and `event_manager` are **staff**: enter when closed, walk the floor, never removed by a close |
| Event manager | role `event_manager` (seeded, no offices) | everything in `/admin/arena/**` |
| Super admin | role `super_admin` or the back-office `x-admin-token` | same as event manager |

## 2. Functional requirements

### Building
- **FR-ARN-01** The arena is open only when both switches are on: the admin console's building master switch (`buildings` row `arena`, P2-CON-01; no row = open) AND the arena's own `arena_settings.open`. Closed → only staff may enter; everyone else gets `ARENA_CLOSED`.
- **FR-ARN-02** Closing the arena walks everyone inside out (`arena-removed {reason: ARENA_CLOSED}`, then the server drops them from the arena room), staff excepted. Effective within ~5 s.
- **FR-ARN-03** `GET /arena/status` works for guests (no token) and players and shows open, canEnter + denial, current/next event, the viewer's pass, canClaim + claimDenial, occupancy.
- **FR-ARN-04** Settings: `open`, `defaultCapacity` (new events, ≤ 1200 bowl seats), `maxConcourse` (people in one arena room, enforced by realtime).

### Event lifecycle
- **FR-ARN-10** Statuses: `draft → scheduled → doors_open → live → ended`; `cancelled` from any non-terminal state. Allowed manual moves: draft→scheduled|cancelled, scheduled→draft|doors_open|cancelled, doors_open→live|cancelled, live→ended|cancelled. Anything else → `400 BAD_TRANSITION`.
- **FR-ARN-11** Automatic by time (sweep every 15 s and before every read): scheduled → doors_open at `doorsOpenAt`, → live at `startsAt`, → ended at `endsAt`. Drafts never move by themselves.
- **FR-ARN-12** Times must satisfy `doorsOpenAt ≤ startsAt < endsAt`, length ≤ 24 h. Editing times/rules/capacity is allowed in draft, scheduled and doors_open; ended/cancelled events are read-only.
- **FR-ARN-13** No two non-draft, non-terminal events may overlap in `[doorsOpenAt, endsAt)` → `409 EVENT_OVERLAP` (checked on create, edit and scheduling).
- **FR-ARN-14** Deleting is allowed only for drafts; otherwise cancel. Ending or cancelling an event ends its passes' validity (realtime frees zone/seats; no money moves).

### Scopes and passes
- **FR-ARN-20** An event's `rules` (≥ 1) combine with AND. Rule kinds: public, members, min_level, invite, participants (+guests companions), role, age_verified. Denial order is fixed (first failing rule wins): LOGIN_REQUIRED, LEVEL_TOO_LOW, NOT_INVITED, NOT_PARTICIPANT, ROLE_REQUIRED, AGE_CHECK_REQUIRED.
- **FR-ARN-21** `age_verified` = identity `kyc_tier ≥ 1`. Level = `levelForXp(users.xp)`.
- **FR-ARN-22** `participants` admits registered participants; with `guests: n > 0` it also admits people on the invite list (companions, added by staff). The per-participant quota of n companions is not tracked yet (future, with self-service companion invites).
- **FR-ARN-23** Claiming a pass needs: arena open, not barred, event `scheduled | doors_open | live`, scope passes, capacity left in the zone. Zone: participant → `floor`; invite with zone → that zone; otherwise `seats`.
- **FR-ARN-24** Capacity: `seats` passes ≤ `capacity`, `vip` passes ≤ `vipCapacity`, `floor` uncapped (bounded by the participant/invite lists). Enforced with a single conditional `UPDATE … WHERE issued < capacity` inside a transaction: no oversell under concurrency.
- **FR-ARN-25** Claiming is idempotent per (user, event): a second claim returns the same pass (DB unique key).
- **FR-ARN-26** Giving the pass back frees its capacity slot. Open-seating events (rules = only `public`) need no pass in realtime; seats are first come, first served up to `capacity` minus passes issued.

### Invites, participants, bars
- **FR-ARN-30** Invites and participants are managed by identifier (user id, username, email or phone) and are idempotent (PUT adds, DELETE removes). Removing someone also revokes their pass for that event if it was issued through that list.
- **FR-ARN-31** A bar has `user`, `reason` (required, 3–200 chars) and optional `until`. Active bars deny building entry (`BARRED`) and pass claims; barring revokes the user's passes for upcoming/current events and walks them out within ~5 s (`arena-removed {reason: BARRED}`). Unbar = DELETE. Expired bars stop applying automatically.
- **FR-ARN-32** Staff cannot be barred while holding a staff role (`409 STAFF_PROTECTED`) — revoke the role first.

### Audit, anti-abuse, privacy
- **FR-ARN-40** Every admin change (settings, event create/edit/transition/delete, invite, participant, bar, unbar) and automatic transitions are written to `access_audit` (target `arena:*`).
- **FR-ARN-41** Rate limits: pass claim/return 10 per minute per user (`429 RATE_LIMITED`); realtime zone/sit/stand 6 per 3 s per session (`RATE_LIMITED`).
- **FR-ARN-42** Pass hoarding: at most 3 active passes per user across upcoming events (`409 PASS_LIMIT`).
- **FR-ARN-43** Seat squatting: one seat per person; a seat needs the person to be in the right zone; leaving the room, the zone, or losing the pass frees the seat; the seat map is per room and server-side only.
- **FR-ARN-44** Public lists (`/arena/events`, status) show counts only — no names or ids of pass holders, invitees or participants. Attendance, invites, participants and bars are admin-only and show masked email/phone.

## 3. Validations and edge cases

| Case | Behaviour |
|---|---|
| Event changes scope while people hold passes | Existing passes stay valid (grandfathered); the admin sees attendance and may remove people from lists, which revokes those passes. New claims use the new scope. |
| Capacity lowered below passes issued | Allowed (no pass is revoked); the response carries `overbooked: n`; claims fail with SOLD_OUT until returns bring it under. Capacity can never be set above the bowl (1200 / 24 VIP). |
| Barred person inside | Walked out within one poll (≤ 5 s) with `arena-removed BARRED`; their passes are revoked. |
| Guest becomes signed in | The client rejoins the room with its token; status / realtime checks re-run for the account (guests never hold passes, nothing to migrate). |
| Two events overlap | Refused with `409 EVENT_OVERLAP`. |
| Event ends / is cancelled while seated | Next state poll: the room drops pass-only zone/seat state and sends `arena-event`; people stay in the concourse. |
| API unreachable from realtime | Fail closed for zones/seats (`EVENT_NOT_OPEN`), keep the last known open/closed state for at most 30 s, then treat as closed for new joins. |
| Pass claimed just before sitting | Realtime re-fetches the user's access (cache bypass) once before answering NO_PASS. |

## 4. Out of scope (this task)
Brackets / tournament engine (P2-TRN), entry fees, prizes and refunds (later through LedgerService — **no money moves here**), streaming / big-screen video, companion quotas per participant, ticket transfer, guest bars (guests have no identity; realtime rate limits and moderation apply).

## 5. Implementation plan (followed)
1. Migration `0008_arena`: `arena_settings` (single row id=1), `arena_events` (rules jsonb validated by `ArenaScopeRuleSchema`, per-zone issued counters), `arena_passes` (PK user+event), `arena_invites` (+zone), `arena_participants`, `arena_bars`; indexes by event and user.
2. `apps/api/src/modules/arena/`: pure `rules.ts` (scope evaluation, transitions, overlap), `ArenaService` (DB, transactions, sweep, audit via `access_audit`), controllers (public with optional auth, admin with `RoleGuard` + `@RequireRole("super_admin","event_manager")`, internal with `x-internal-token`), presence store fed by realtime. Seed role `event_manager` on start.
3. Realtime: `social/arena-access.ts` (state poll every 5 s shared by all arena rooms, per-user access cache 10 s), `world-room.ts` arena section (join gate, zone/sit/stand, occupancy broadcast + report, removal on close/bar/event end). Poll was chosen over API → realtime push: no new infra, works across several realtime nodes, bounded delay.
4. apps/admin `/arena` page.
5. Tests: rules (unit), service (PGlite: transitions, capacity race, idempotency, bars, hoarding), realtime (`arena.test.ts`).

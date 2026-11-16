# Matchmaking v2: find an opponent, challenges, Quick Play (P2-MM-05)

Status: built behind `FF_MATCH_V2` (server) / `NEXT_PUBLIC_FF_MATCH_V2` (web). Both are **on by default**; set `0` to bring back the v1 Quick Match and in-room challenge flows, which are still in place.

Code:
- realtime: `apps/realtime/src/matchmaker-v2.ts`, `social/match-finder.ts`, `social/invites.ts`, `social/mm-hub.ts`, plus the changes in `rooms/world-room.ts` and `rooms/boxing-hall.ts`
- contracts: `packages/contracts/src/matchmaking.ts`
- web: `apps/web/src/match/MatchmakingV2.tsx`, `match/quick-play.ts`, `match/mm-strings.ts`, `lib/mm-store.ts`, `lib/mm-target.ts`, the seat panel in `rooms/RoomOverlay.tsx`

Evidence: `qa/e2e/matchmaking.mjs` (browser, 45 checks), `qa/e2e/matchmaking-boxing.mjs` (protocol, 6 checks), screenshots in `docs/QA/matchmaking/`.

## 1. The report

> "Find an opponent is always empty even if people are there. They do not see a request they can accept, so they never move to the hall and table to start playing. Quick Play should ask which hall, which table or ring is free, and the other details needed to start. Challenging should be easy and user friendly."

## 2. Diagnosis (with evidence)

We tested with real browsers: separate puppeteer contexts, fresh accounts, a scratch stack. We also ran protocol-level runs (`colyseus.js`) to separate server faults from UI faults.

| Check | Result |
|---|---|
| Two accounts in the same Ludo hall, both stake 0 | **paired**: `match-ready` for both, same room |
| One on the plaza, one in the Ludo hall, both stake 0 | **paired**: the v1 queue is one process-wide singleton keyed `game:stake`, so rooms and halls do not matter |
| Same hall, stakes 25 and Friendly | **never paired**: both get `quickmatch {status:"waiting"}`, and both wait for ever with no hint |
| Browser, both seated, both press Find (rules accepted) | **paired** and the match opens: the happy path works |
| Browser, first live game (rules not yet accepted) | the rules card opens first; closing it sends nothing, without a word |
| Boxing: A uses "Wait for an opponent" in a ring, B presses Quick Fight at the same stake | **never paired** (code read, then a protocol test): `BoxingHall.onQuick` only looks at the quick queue, never at rings that are already waiting |

The candidates in the brief, checked one by one:
- **Queue keyed per room or table:** no. It is per `game:stake` and process-wide.
- **Players in different Colyseus rooms:** not a cause, for the same reason.
- **Timeout too short:** there is no timeout. People wait for ever.
- **Client listening to the wrong event:** no.
- **Queue cleared on seat changes:** no.

**Root cause.** The user's "always empty" is a product gap plus one hard rule:

1. **Find an opponent was a blind queue with an exact-stake rule.** It only pairs two people who both pressed Find, in the same game, at exactly the same stake. People merely present in the hall or on the plaza receive nothing, because nothing is ever sent to them. So "people are there" does not help.
2. **Mismatched stakes wait for ever, in silence.** The seat panel defaults to 25 Stars. Players who tap Friendly, or who can't afford 25 (the chips then move them to Friendly), sit in a different queue. No one sees who else is searching, at what stake, or for how long.
3. **The UI misleads.** The seat panel said "Waiting for an opponent *at your table*…" and the table map says "Waiting · sit down to play them". But sitting down next to a waiting player did nothing. The tip "stand near another player and use Challenge" only worked inside one room.
4. **Challenges were room-local.** A proposal reached only people in the same room instance. A player on the plaza could not challenge someone in a hall. An accepted challenge sent both players straight to `/match` without any table.
5. **Boxing:** "Wait for an opponent" (a claimed ring) and "Quick Fight" (the queue) never saw each other.

## 3. Design

### 3.1 Find an opponent: queue per game, with a stake set (`social/match-finder.ts`)

- **One ticket per account,** process-wide, shared by every plaza and hall room: `{ game, stakes[] (preferred first, up to 5), since, venue? }`. A second tab replaces the ticket.
- **Pairing:** two tickets match when the game is the same and they share at least one stake. The longest-waiting ticket goes first, and the stake is the first one in **its** preference list that the newcomer also accepts. No randomness and no bots: only real tickets are paired. Blocked pairs are skipped (`hub.separated`).
- **Offer ("Opponent found"):** both players get `mm-found { opponent, game, stake, ttlMs }` and must **Accept** within the accept window.
  - If **both accept**, the rendezvous starts.
  - On a **decline**, the decliner leaves the queue. The other player is told "They said no. Still looking…" and is **requeued with their original waiting time**, so they stay first in line.
  - On a **timeout**, whoever accepted is requeued and whoever never answered is dropped.
- **Live searching state** (`mm-status`): elapsed time, the stakes being searched, and how many others search this game per stake ("1 looking at other stakes"). There is always a Cancel.
- **Widening (asked first):** after `widenAfterSeconds` with nobody found, the card asks: "Nobody at 25 Stars yet. Also accept 50 Stars, Friendly?" It offers the next stake up, the next one down, then Friendly, and only stakes the player may play. The server re-checks eligibility for each stake before accepting the widened ticket.
- **Practice:** after `practiceAfterSeconds`, the card suggests Practice vs AI (not for Boxing, whose practice is at a ring).
- **Eligibility checks:**
  - Before queueing (GAP-011), each stake is checked with the API. Stakes the player can't play are dropped from the ticket. If none is left, the player hears the reason, and only they hear it (GAP-005 privacy).
  - The friendly daily limit is part of the same API eligibility, so it still applies.

### 3.2 Challenges between accounts (`social/invites.ts`)

- **Target:** a challenge goes to an **account**, not a session, so it reaches the other person in any hall or on the plaza, on any device.
- **Who can be challenged:** people in the same room ("Here") and every signed-in account online elsewhere (`online-get`).
- **The invite card:** `invite { from, game, stake, venue, ttlMs }` arrives as a non-blocking card with a countdown, Accept and Decline. The sender sees "Waiting for X · 37 s" with Cancel.
- **On accept:** both players stop searching and the rendezvous starts.
- **On decline, expiry or cancel:** the other side is told, in plain words.
- **Edge cases** (the reason sent to the sender, then what happens):

| Case | Reason | Behaviour |
|---|---|---|
| Invitee offline | `OFFLINE` | "That person is not online right now." |
| Blocked, either way | `PLAYER_UNAVAILABLE` | The same words as for someone who isn't there, so a block is never revealed. A block made later closes open invites and offers between the two. |
| Invitee busy (live match, an open offer, or on the way to a table) | `BUSY` | "X is busy in a match. Try again when it ends." We reply "busy" rather than queueing the invite (see §6). |
| Duplicate (same sender to same person, still open) | `DUPLICATE` | Refused. |
| Crossed (they already challenged me) | `CROSSED` | "X already challenged you: accept theirs." |
| Anti-spam | `TOO_MANY_OPEN` / `RATE_LIMITED` | At most 3 open per sender, at most 6 per minute (`INVITE_LIMITS`). |
| Invitee can't afford or isn't allowed the stake | `OPPONENT_CANT_PLAY` | The sender hears this only (privacy); the words suggest a friendly game. The invitee's card shows "You can't accept this one" and disables Accept (same `games/offer` data as the stake chips). |
| My own limits | the personal reason | Shown only to me. |

### 3.3 Rendezvous: a reserved place, the walk, then the start (`matchmaker-v2.ts`)

**The place:**
1. The service picks the game's hall instance. In order of preference: the room of the place named in the ticket or invite, then the room either player is in, then any open hall. If none exists, it opens one with `matchMaker.createRoom("hall", { game })`. The room is kept alive while it holds a reservation.
2. **Table games:** `HallPort.reserve` keeps a table for the two accounts. It prefers the named table, then a table one of them already sits at (that chair stays theirs), then the first empty one.
   - Chairs are reserved in `SeatRegistry` as `~res:<accountId>`. Only that account may sit on such a chair (`claim(seat, sid, uid)`).
   - The seat map shows reserved chairs as taken, so the table reads as busy for everyone else.
3. **Boxing:** once both accounts are in the Boxing hall, `BoxingHall.assignProposal` gives them a free ring and the fight room (existing code, escrow in the API).

**The walk:**
- Both players get `mm-go { hall, roomId, table, seat, opponent, ttlMs }`.
- A player in another hall or on the plaza is taken to `/room/<hall>`. That join targets the reserved instance through `lib/mm-target.ts`, the same idea as `heldRoomFor` in place-hold.
- Inside the hall, the player is walked to the chair with the hall's own table walk (`walkToTable`, extended so a chair reserved for me counts as mine). The walk is repeated until it takes, because the hall controller drops a pending pick while it mounts. The Fight lobby uses `goToRingFromLobby`.
- The "Go to Table 12 · Ludo Lounge" card shows the countdown and a "Walk me there" button.

**The start:**
- When both are seated on their reserved chairs (the room reports `sit` to the service), the service calls the **same `startMatch`** as v1.
- `startMatch` is where `api.createMatch` locks both stakes in escrow (`LedgerService.post` with idempotency keys and fees from `packages/money`; nothing in this task touches money code). Both then get `match-ready`, and the existing match page opens.
- Rules are accepted before Accept is sent (`withRules`), so the API's `RULES_NOT_ACCEPTED` gate is never hit at the table.

**No-show:** if both are not seated within `arriveSeconds`, the meeting is called off. One side hears "You did not reach the table in time" and the other "X did not make it to the table". Nothing was staked (escrow only happens at the start), and the reserved chairs are freed.

**API refusal at the table:** if the API refuses at the start (for example, funds spent meanwhile), each player hears their own reason and the other hears "They can't play right now".

### 3.4 Presence across rooms (`social/mm-hub.ts`)

- **Registration:** every signed-in session of every plaza or hall room registers with the hub: room, hall, a `send`, its block keys, and the person card. Every game hall registers a `HallPort`.
- **Leaving a room:** this does not cancel anything, because a hall change is a leave followed by a join. An account is treated as gone only after `offlineGraceMs` (12 s) with no session. Then its search ends, its challenges close, and a meeting with it is called off.
- **A new session gets the current state again:** its search, an unanswered "found", the meeting, and the challenges sent to it.

Like the v1 queue, this is in-process. A multi-node deployment moves it to Valkey (P1-MM-01).

### 3.5 Quick Play (guided, `MatchmakingV2.tsx` / `quick-play.ts`)

**Entry points:** the HUD button (desktop, under the profile chip), "Quick Play" in the phone action bar's more menu, and the seat panel.

**One sheet, with defaults set so that one tap works.** The steps, in order:
1. **Game:** Ludo, Igisoro, 8-Ball Pool or Boxing.
2. **Hall:** the game's hall, with "N looking" live.
3. **Table or ring:**
   - The live free or busy grid (`venues-get` every 3 s while the sheet is open).
   - The **nearest free** place is preselected: nearest to me when I'm in that hall, otherwise nearest the hall door.
   - Busy places are disabled.
4. **Mode:**
   - Practice vs AI: walk there, sit, and the practice game opens.
   - Find an opponent: the search starts at once. On arrival the chosen table becomes my place, so it is offered to whoever I'm paired with.
   - Challenge someone: opens the challenge sheet with the game, stake and place filled in.
5. **Stake:** the stake chips, with the server's allowed and affordable stakes and the friendly games left today.
6. **Confirm:** one big chocolate button, "Go and practise" / "Go and find an opponent" / "Choose who to challenge".

**Phone (844×390):** the sheet uses two columns (game, mode and stake on the left; the hall's places on the right) so everything fits on one screen. Targets are at least 44 px high.

### 3.6 The seat panel (table halls)

- **Buttons:** Practice vs AI, **Find an opponent** (this table is offered as my place), **Challenge someone**, **Quick Play**, and the stake chips. A "Looking now: Friendly 1 · 25 Stars 0" line shows who is searching at which stake, so stakes can be matched on purpose.
- **Someone waiting here:** when someone sits at this table and is searching, the panel offers "Play Amani · 25 Stars". It searches at their stake, so the two pair at once and the match starts at this table. That makes the table map's "sit down to play them" true.
- **The misleading tip is replaced** with accurate guidance: "Find an opponent pairs you with anyone looking for Ludo at the same stake, here or anywhere on campus. To play someone you know, tap them and choose Challenge."

## 4. State machines

**Ticket and offer** (per account):

```
idle ──find──▶ searching ──pair──▶ offered ──both accept──▶ meeting ──both seated──▶ match (escrow, /match)
  ▲               │  ▲                │ decline                │ no-show / API refusal
  │◀──cancel──────┘  └──requeued◀─────┤ (other side)           ▼
  │◀──────────────────────────────────┤ timeout: answered → requeued, silent → idle
  └◀───────────────────────────────────────────────── called off (nothing staked)
```

**Challenge:**

```
sent ──accept──▶ meeting (as above)
  ├──decline──▶ closed (sender: "X said no this time")
  ├──expiry──▶ closed (both told)
  ├──cancel──▶ closed (invitee told)
  └──offline / block──▶ closed (the other one told)
```

**Reserved chair** (`SeatRegistry`):

```
free ──reserve(uid)──▶ ~res:uid ──sit by uid──▶ seated(session)
                           └──meeting over──▶ free
```

## 5. Timeouts and limits (`MM_TIMING`, `INVITE_LIMITS` in `packages/contracts/src/matchmaking.ts`)

| | Value | Why |
|---|---|---|
| Accept window ("Opponent found") | 20 s | Long enough to read and tap on a phone, short enough that the other person isn't kept waiting. |
| Challenge expiry | 45 s | The invitee may be mid-walk or in a menu. v1 used 60 s; shorter keeps the sender's card honest. |
| Arrival window | 90 s | A walk from the far end of the plaza into a hall and to the table takes about 30 to 60 s. |
| Offer to widen | after 30 s | |
| Suggest Practice | after 60 s | |
| Offline grace | 12 s | A hall change (leave plus join) takes 1 to 5 s; a reload about 3 to 8 s. |
| Challenges | 3 open, 6 per minute per sender | |
| Message rate limits per session | find 6, venues 20, invites 8 per 10 s | |

## 6. Decisions (and ones for the product owner)

1. **Busy invitee → we reply "busy" rather than queueing the invite.** A queued invite would land minutes later, out of context. The sender can try again.
2. **Cross-hall travel is a direct move to the hall's door**, then the auto-walk inside, not a walk across the campus. A walk across the campus would take 1 to 3 minutes and blow the arrival window. Inside the hall the existing table walk is used. Changing this means a longer `arriveSeconds` and the plaza's `walkThere` route.
3. **The accept window (20 s), challenge expiry (45 s) and arrival window (90 s)** are first guesses. They need the product owner's call.
4. **Widening is opt-in (asked first), never automatic,** because a stake is the player's money decision. Friendly is always offered last.
5. **Privacy:**
   - The sender of a refused challenge hears "can't play that right now" (with a friendly-game hint), never the invitee's account reason.
   - A block always reads as "can't be challenged right now".
6. **Boxing:**
   - Pairing in the Boxing hall still goes straight to a ring for the in-ring Quick Fight (no accept step; this was already the case).
   - The v2 Find an opponent for Boxing does have the accept step, and assigns the ring once both are in the hall.
   - The ring-waiting bug is fixed for the in-ring flow too.
7. **Place-hold (P2-NET-06):** a v2 search survives a reload through the offline grace and a resend on the new session. The v1 "waiting" seat hold still applies to v1 tickets only.
8. **The in-process hub** is fine for one realtime node. Scaling to several nodes means moving the hub and queues to Valkey (P1-MM-01 scope).

## 7. Tests

- **Unit:**
  - `social/match-finder.test.ts`: pairing, stake sets, widening, FIFO, blocks, accept / decline / timeout / requeue.
  - `social/invites.test.ts`: duplicates, crossed, caps, rate limit, expiry, forget.
  - `matchmaker-v2.test.ts`: the service end to end on fakes. Find → found → accept → reserved table → seated → `startMatch`; decline and timeout; eligibility; every challenge edge case; hall-change grace; no-show; per-player refusal privacy.
  - `rooms/boxing-hall.test.ts`: Quick Fight joins a waiting ring.
  - `apps/web/src/match/quick-play.test.ts`: place lists, nearest free, widening, reserved-chair handling, strings.
- **E2E:**
  - `qa/e2e/matchmaking.mjs`: two real browsers per scenario, desktop 1280×720 and phone 844×390. Covers:
    - find-opponent pairing across plaza and hall with a stake mismatch, then widen, then found, then both walk to the same table and the match starts;
    - a challenge from the plaza to someone in the Igisoro Court: accept, both walk to the same table, the game starts;
    - decline and expiry;
    - the Quick Play guided flow into a practice game.
  - `qa/e2e/matchmaking-boxing.mjs`: the Boxing v2 find, and the waiting-ring fix.

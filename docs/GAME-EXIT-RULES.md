# Game exit rules

**The single source of truth** for how a match ends, in every case, and what that means for Stars, rating, XP and
the friendly-games counter (task P1-GAME-06). The code follows this table exactly:

- realtime: `apps/realtime/src/rooms/match-room.ts` (every exit path), `world-room.ts` (challenges, quick match);
- API: `apps/api/src/modules/games/games.service.ts` (validations, escrow, settle, void, sweep) and
  `game-settings.service.ts` (per-game rules);
- web: `apps/web/src/match/LiveMatch.tsx` (Leave confirmation, result screen), `MatchmakingPanel.tsx`,
  `StakeChips.tsx`, `apps/web/src/rooms/RoomOverlay.tsx` (seat panel).

If this page and the code ever disagree, the code is wrong.

## Words used here

| Word | Meaning |
|---|---|
| **Practice** | You against the AI, in your browser. No stake, no rating, never counted against any limit. |
| **Friendly** | A live match against a person with **no stake** (stake 0). Counts against the friendly games per day for that game. |
| **Staked** | A live match where each player puts in the same stake in Stars. Both stakes are held in escrow by the server before the first move. |
| **Pot** | Both stakes together. The winner always receives exactly the pot (FR-ESC-03). Stars carry **no table fee** today (see `matchTableFee` in `packages/money`). |
| **First move** | The first move a player makes themselves. Automatic moves after a timeout do not count. Before the first move the match "has not really begun". |
| **Forfeit** | You lose the match. Your opponent wins: the pot (staked) and the rating points of a win. You get the rating change of a loss and **no XP**. |
| **Void** | The match is cancelled. Every player gets back exactly what they put in (stake + fee). No rating change, no XP, and a voided friendly match **does not count** against the friendly games per day. |
| **Rules of the match** | The game's settings when the match was created (time per turn, time to reconnect, …). Admin edits apply to new matches only. |

## The table

Times in *italics* are the default game settings; admins change them per game (see "Game settings" below).

| # | What happens | When | Outcome | Stake | Rating | XP | Friendly counter | What the players see |
|---|---|---|---|---|---|---|---|---|
| 1 | **Normal end** — win / loss | game over by the rules | settled by the server from a signed result | winner gets the pot | Elo update | win / loss XP | counts | result screen: winner, Stars ±, XP |
| 2 | **Draw** — by the game, or both accept "Offer a draw" (2-player games) | any time after the start | settled as a draw | each gets their stake back | draw (Elo 0.5) | draw XP | counts | "Draw: stakes returned." |
| 3 | **Leave before the first move** (menu → Leave, or closing the match with Leave) | no move made yet | **void** | refunded | none | none | not counted | "The match was cancelled before the first move." The Leave dialog says so first. |
| 4 | **Leave after the first move** (menu → Leave) | any time after the first move | **forfeit** by the leaver | opponent gets the pot | loss for the leaver | 0 for the leaver | counts | Leave dialog: "Leaving counts as a forfeit: *name* wins the *pot* Stars pot. You lose your *stake* Stars stake and rating points, and get no XP." |
| 5 | **Disconnect** (closed tab, reload, network loss, phone asleep) | after the start | the seat is kept for *90 s* (`reconnectSeconds`, the opponent's **maximum wait**; Boxing *60 s*). While the absent player is **on turn their turn clock is paused** (back on their turn: the rest of it, at least 10 s); the other player's turns run normally. Back in time — same tab, a reload, a new tab or another device (P2-NET-05 resume) — the match goes on from the server's state. | — | — | — | — | opponent: a "Your opponent lost connection" card with an *m:ss* countdown, **Keep waiting** and (friendly only) **Leave without penalty**; you: "Connection lost. Reconnecting… *n* s left" |
| 5a | **Reconnect budget used up** (P2-NET-05) | a player's *4th* connection loss in one match (`maxDisconnects` 3), or all their time away together past *180 s* (`reconnectBudgetSeconds`; Boxing *90 s*) — each wait is cut to what is left of it | as row 6 / 7: **forfeit** after the first move, **void** before it, void if nobody is left | as 6 / 7 | as 6 / 7 | as 6 / 7 | as 6 / 7 | the waiting countdown ends at once / is shorter |
| 6 | **Not back within the wait** | after the first move, opponent still connected | **forfeit** by the disconnected player | opponent gets the pot | loss | 0 | counts | the staying player: "Your opponent didn't come back in time. You win."; the absent one: "You didn't come back within 90 s, so it counts as a forfeit." |
| 7 | **Not back within the window, before the first move** | no move made yet | **void** | refunded | none | none | not counted | "The match was cancelled before the first move." |
| 8 | **Both players disconnected** | a forfeit would happen but nobody is left connected to win | **void** | refunded | none | none | not counted | "Both players lost the connection. Match voided." |
| 8a | **Leave while the opponent is away** (P2-NET-05, **friendly only**) | the opponent is disconnected and the staying player presses "Leave without penalty" | **void** (`LEFT_WHILE_WAITING`) | — (stake 0) | none | none | not counted | "A player left while the other was disconnected. Friendly match cancelled: nothing counts." A **staked** match must wait out the countdown (the server refuses `STAKED_MUST_WAIT`); a Leave there is still a forfeit (row 4). |
| 9 | **Turn timeouts** | a turn runs past *30 s* → an automatic move (or pass) and a strike; *3* timeouts **in a row** → forfeit (a move of your own resets the count) | **forfeit** by the player who timed out | opponent gets the pot | loss | 0 | counts | "Time out (1/3)" banners; then "You ran out of time 3 turns in a row." |
| 10 | **Inactivity before the first move** | the timeouts of row 9 happen before anyone has made a move | **void** | refunded | none | none | not counted | "Nobody made a first move. Match cancelled." |
| 11 | **Opponent never joins** | the match was created but a player doesn't open it within *60 s* | **void** | refunded | none | none | not counted | "Your opponent never joined. Match cancelled: stakes refunded." |
| 12 | **Match too long** | the match runs past the game's longest match (*45 / 90 / 60 min* for Igisoro / Ludo / Pool) | **void** | refunded | none | none | not counted | "The match ran past its time limit." |
| 13 | **Server error while settling** | the result can't be settled after 3 tries | **void** (the room asks the API to void instead) | refunded | none | none | not counted | "A server problem stopped this match. It was voided and the stakes refunded." |
| 14 | **API unreachable even for the void** | both settlement and void fail | left to the **stale-escrow sweep** (row 16) | refunded within ~3 min | none | none | not counted | "Stakes are refunded automatically within a few minutes." |
| 15 | **Game server crash / restart / room closed early** | room gone before a result | **void** (on close: `ROOM_CLOSED`; after a crash: the sweep, row 16) | refunded | none | none | not counted | reconnect fails → "This match is no longer available. If Stars were staked, they are refunded automatically." |
| 16 | **Stale escrow sweep** (reconciliation safety) | the API runs it on start and every minute: an active match that no game server has reported for **2 min** (heartbeat every 20 s), or that is past its longest match + 10 min | **void**, idempotent, one audit row each (`match.void` by `system:sweep`) | refunded | none | none | not counted | if a room still runs it, the room ends with "This match was lost by the server." |
| 17 | **Player suspended / banned mid-match** | staff suspends an account | **void** (the room sees the suspension feed; the API voids every active match of that account too) | refunded to **both** | none | none | not counted | the other player: "A player was removed by staff. Match voided." The suspended player's connection is closed. |
| 18 | **Practice vs AI** | leave any time | nothing to settle | no stake | no rating | practice XP as today (2 XP a game, 20 a day) | never counted | "Leaving ends this practice game." |

### After the match

- The result stays on screen until you leave it. **Rematch / Back** returns you to **the exact place you came from**
  (the return point: the hall seat or the plaza spot, `apps/web/src/lib/return-point.ts`).
- You are never sent back into a finished match: "match ready" is one-shot (`MatchmakingPanel.tsx` clears it as soon
  as it navigates, and `LiveMatch.tsx` clears a stale one for a room that no longer exists).
- The room closes 20 s after the result; reloading a finished match shows "This match is no longer available."

### Who wins a forfeit, exactly

A forfeit always goes to the opponent, **except** when the forfeit was not chosen (rows 6, 9) and the opponent is not
connected either: then nobody is there to win and the match is voided (row 8). A **Leave is always a forfeit** after
the first move, even if the opponent is briefly disconnected. Settlement, rating and XP of a forfeit are those of a
normal loss for the leaver and a win for the opponent, except the leaver earns **0 XP**.

### Why "before the first move" is a free cancel

Until somebody has moved, nobody has gained or lost anything: cancelling is the same as never having accepted.
After the first move the position matters, so leaving is a forfeit. The same rule applies whether you press Leave,
lose the connection or time out — so there is never a reason to idle instead of pressing Leave.

## Resume after a reload or a lost connection (P2-NET-05)

- **The server is the only authority.** A returning player gets the room's full state again (`init` + `state` for
  turn games: board, dice / turn, scores, the turn deadline or `paused`; `init` + `snap` for Boxing: round, clock,
  cards). The client never decides a forfeit; the room does when the wait or the budget runs out.
- **Where the client remembers the match:** `localStorage["gk-active-match"]` = match id, room id, game, seat (no
  secrets), cleared at the result / Leave / "no longer available". The Colyseus reconnection token stays in
  `sessionStorage` per tab (`apps/web/src/match/LiveMatch.tsx`, `apps/web/src/fight/game/net/client.ts`).
- **On every page load** (`apps/web/src/lib/active-match.ts`, mounted in the root layout): `GET /games/active` names my
  live match (my own seat only; the realtime server reports each match's room with `POST /internal/matches/:id/room`)
  → a table game opens `/match/<room>`, a fight the Boxing hall (`/room/boxing`, the hall re-sends my fight).
- **Rejoining:** the reconnection token inside the wait; when it expired, was lost (new tab, another device) or the
  socket died, a join with the access token — the room's `onAuth` admits only the match's players, so it re-seats the
  same user and never another. Network loss retries with backoff (0.5 s → 5 s) until the wait ends, pausing while
  the browser is offline; the banner shows the time left.
- **Waiting for the opponent:** the staying player sees the countdown card (row 5) and may keep waiting; in a
  friendly they may leave without penalty (row 8a). Boxing shows "Time-out: *name* lost connection (*m:ss*)" while the
  fight is paused for both.
- **Moderation trail:** realtime logs `match.disconnect`, `match.reconnect`, `match.no-return`, `match.budget-exhausted`,
  `match.left-waiting`, `match.<reason>` (Boxing `fight.disconnect` / `fight.reconnect`) with match and user ids; the
  API writes an `access_audit` row `match.forfeit` for every settled forfeit and `match.void` for `BOTH_DISCONNECTED`
  / `LEFT_WHILE_WAITING`.
- Kill switch: `NEXT_PUBLIC_FF_RESUME=0` (web resume on load; the server-side waits are always on).

## Holding your place (P2-NET-06)

Everything **before** a live match starts (and between matches): the place a player has chosen in a hall. Live matches
keep the "Resume" rules above; this section covers the chair, the table and the ring.

### Every chosen place, before P2-NET-06

| Place | Game / hall | Where it lived | On reload / closed tab | On network loss |
|---|---|---|---|---|
| Seated at a table (chair claimed) | Ludo Lounge, Pool hall, Igisoro court | server: hall room `SeatRegistry` (seat → session); client `useRoom.seated` | seat freed at once; you land at the hall door, standing | seat freed at once; the auto-reconnect lands you at the hall door |
| Waiting for an opponent at your table (seat + Quick Match) | same | server: seat + the in-process Quick Match queue (by account); client `useMatch.quick` | ticket dropped, seat freed | same |
| A table "reserved" by a challenge | same | nothing is reserved: a challenge is a proposal between two people (60 s), the table is not part of it | the proposal was deleted silently (the other side was not told) | same |
| Ring claimed, waiting for an opponent | Boxing hall | server: `BoxingHall` ring registry (`waiting`, red corner = session) | ring freed at once | ring freed at once |
| Practice at a ring | Boxing hall | server marks the ring `practice`; the fight itself runs in the browser (AI level is client only) | ring freed, the practice fight is gone | same |
| Fight starting / running | Boxing hall | fight room (P2-NET-05) | the ring stays the fighters' (P2-NET-05 waits) | same |
| Result on the ring (8 s) | Boxing hall | server | your corner frees; the ring frees after the result | same |
| Watching a ring (spectator) | Boxing hall | server watcher set | dropped (not a place: watching is free for all) | same |
| Plaza bench, admin office chair, arena bowl seat | plaza / admin / arena | server seats | freed at once | freed at once |
| Which hall / area you are in | all | the URL (`/room/<game>`), stage area | a reload keeps the URL: same hall, but at its door | same hall, at its door |

### The rules (decided)

1. **Who gets a hold.** Signed-in players only (the place must go back to the same account). A guest's place frees at
   once, as before.
2. **What is held.** A game-table chair (Ludo, Pool, Igisoro) with its Quick Match ticket, a Boxing ring you wait in,
   and a Boxing ring you practise in. Plaza benches, office chairs, arena seats and watching are not held.
3. **When.** The connection to the hall ends **without** a deliberate leave: reload, closed tab, network loss, the
   phone going to sleep. A deliberate leave releases at once, with no hold: Stand up, walking away from the chair,
   Leave / walking out through the door, Cancel at the ring, Step out, opening Practice vs AI or a live match from
   the table (the page change is a deliberate leave; the return point re-seats you afterwards if the chair is free).
4. **How long** (`PLACE_HOLD` in `packages/contracts/src/social.ts`; tests shorten them):

   | Place | Hold |
   |---|---|
   | Table chair (seated or waiting for an opponent) | **60 s** |
   | Boxing ring, waiting for an opponent | **60 s** |
   | Boxing ring, practice | **30 s** |

5. **Abuse limit.** At most **3 holds per account in 15 minutes**. The 4th drop in that window releases the place at
   once (as before P2-NET-06) and the returning player is told why.
6. **What others see.** The place is **Held** (not free, not waiting): the chair cannot be taken, the table shows
   "Held · returning (0:42)" in the table picker and its light band turns grey-amber, the ring sign, the ring prompt
   and the lobby status board show "Held · returning (0:42)". Nobody can join a held ring or sit in a held chair.
7. **While held, nothing can start.** The Quick Match ticket is paused (taken out of the queue) and the waiting ring
   cannot be joined, so no match can be created for an absent player and **no stake is ever locked by a hold**
   (holds never touch the ledger). A challenge sent to or from the absent player closes at once (`PLAYER_LEFT`,
   both sides told).
8. **Coming back inside the hold** (same account, a new connection to the same hall instance): the same chair or ring
   and the same state: still seated, still waiting (the Quick Match ticket goes back into the queue with its original
   waiting time), still waiting in the ring at the same stake, practice at the same AI level (a fresh practice fight:
   the old one ran in the closed page). Never another user: holds are keyed by account id, and every claim of a held
   place by anyone else is refused (`taken` / `RING_HELD`).
9. **When the hold runs out** the place is free again for everyone, the waiting state is cleared, and the player
   coming back later lands at the hall door with a short notice: "Your place at Ring 7 was released after 60 s
   away." (the server remembers a released place for 10 minutes for that notice).
10. **Hand-over to a live match.** A hold never becomes a match by itself (rule 7). Once a match starts, the match
    rules (P2-NET-05) apply and the place record is cleared: table games leave the hall for `/match/<room>` (return
    point → the same chair afterwards if it is free); in Boxing the ring belongs to the fight, then shows the result
    and frees as before.

### How it works

- **Server** (`apps/realtime/src/social/place-holds.ts`): one in-process registry of holds by account (hall, room,
  place, state, Quick Match ticket / stake, until), the abuse counter and the recent releases. The hall room
  (`world-room.ts`) holds a chair on a non-consented leave (`SeatRegistry.hold`, the seat map shows `~held`, plus
  `seat-holds` with the time left), the Boxing hall (`boxing-hall.ts`) marks the ring `held: { ms }`. The room stays
  alive while it holds a place (`autoDispose` off) and closes when the last hold ends with nobody inside. On join the
  room sends `place` = `restored` / `released` (with the reason) / `none`.
- **Ask on load:** `GET <realtime>/place` (Bearer access token) → my hold or my recent release.
- **Client** (`apps/web/src/lib/place-hold.ts`): `localStorage["gk-place"]` = hall, room id, chair or ring, state,
  stake, AI level, time (no secrets), cleared on a deliberate leave, a released place and a match start. On load the
  root layout asks the server (after the live-match check) and goes to the hall; the hall joins the same room
  (`joinById`, then the normal join) and starts you on the chair / at the ring steps; the server's `place` answer
  confirms it or shows the notice.
- Kill switches: `FF_PLACE_HOLD=0` (realtime: no holds) and `NEXT_PUBLIC_FF_PLACE_HOLD=0` (web: no restore on load).

## Rules card (P2-NET-05)

Before a **live** match of a game — challenging, accepting a challenge, Quick Match, a ring claim / join / quick
fight — the player reads that game's rules card and ticks "I have read and accept these rules". The acceptance is
stored per user, game and **rules version** (`rules_acceptances`, `POST /games/rules/accept`, `GET /games/rules`;
`GAME_RULES_VERSION` in `packages/contracts/src/games.ts`), so it is asked again only when the version changes.
**The server refuses to seat** a player without the current acceptance: `RULES_NOT_ACCEPTED`, a personal refusal
checked with the other validations below (realtime pre-check, then the API at create). Practice vs AI shows the card
once per game and version (remembered in the browser) and is never blocked by it. Kill switches:
`FF_RULES_ACCEPT=0` (API) and `NEXT_PUBLIC_FF_RULES_ACCEPT=0` (web).

The card's text lives in one place, `apps/web/src/rules/strings.ts` (i18n keys `rules.*`), with the numbers filled in
from the game's live settings and fees from the server (`packages/money` via `GET /games/offer`). It says:

| Section | Turn games (Igisoro, Ludo, 8-Ball Pool) | Boxing |
|---|---|---|
| How to play / how to win | the game's rules (same as the in-game help) | rounds, 5 judges (10-point must), KO / stoppage, warnings → DQ |
| Time limits | `turnSeconds` per turn, an automatic move = a strike, `maxTimeouts` in a row = forfeit; longest match `maxMatchMinutes` | idle `idleSeconds` in a round = a strike, `maxTimeouts` in a row = forfeit |
| Connection | seat kept `reconnectSeconds`, your clock waits while it is your turn, opponent sees a countdown | referee time-out up to `reconnectSeconds`, 3 s countdown on return |
| Budget | at most `maxDisconnects` losses and `reconnectBudgetSeconds` away per match; then forfeit (void before the first move; void if both are gone) | same |
| Leaving | rows 3, 4, 8a | rows 3, 4 |
| Stakes and fees | equal stakes in escrow before the first move, winner takes the pot, the game's stakes, the table fee (none for Stars) | same |
| Fair play | server-authoritative, provably fair randomness, no bots in live matches, one adult account per person | same |

Changing a game's rules text in substance = bump its `GAME_RULES_VERSION` (everyone accepts again). Changing numbers
in the console does not need a new acceptance: the card always shows the current numbers.

## Validations first (before any escrow)

Checked **server-side** by the API when the match is created (both players re-validated at accept time), and before
that by realtime when the challenge or quick-match request is made (so nobody is asked or queued in vain). The UI
shows the same reasons on disabled options (`GET /games/offer`), but the server always decides.

| Check | Code | Who hears the reason | Plain words (web) |
|---|---|---|---|
| Account active | `ACCOUNT_INACTIVE` | that player only | "This account is suspended. Contact support." |
| Not already in another live match (parallel creates book a player once) | `ALREADY_IN_MATCH` | that player only | "You're still in another match. Finish or leave it first." |
| The game is open for live matches | `GAME_DISABLED` | both | "Live *Ludo* matches are paused right now. Practice vs AI is open." |
| The stake is one of the game's stakes (or 0 = friendly) | `STAKE_NOT_ALLOWED` | both | "That stake isn't offered for *Ludo*. Pick another one." |
| Staked: balance covers **stake + fee** (fee from `packages/money`, 0 for Stars) | `INSUFFICIENT_FUNDS` | that player only | "Not enough Stars for that stake. Pick a smaller stake or play a friendly game." |
| Staked: not on a break (self-exclusion) | `ON_A_BREAK` | that player only | "You're on a break, so staked games are paused. Friendly games are still on." |
| Staked: under their own daily stake limit | `DAILY_LIMIT_REACHED` | that player only | "That stake is over your daily limit. Try a smaller stake or a friendly game." |
| Friendly: a friendly game of this game is left today | `FRIENDLY_LIMIT_REACHED` | that player only | "You've played your *20* friendly games of *Ludo* today — come back tomorrow or play practice vs AI." |
| The game's current rules card is accepted (P2-NET-05) | `RULES_NOT_ACCEPTED` | that player only | "Accept the *Ludo* rules first: try again and read the rules card." |

- The other player is never told a personal reason: they hear "They can't play right now." (`OPPONENT_CANT_PLAY`).
- **No Stars → friendly only:** every staked option is disabled with the reason, Friendly stays available (if
  friendly games are left), and the sheets say "Not enough Stars to stake. Friendly games are open."
- Where it shows: the challenge sheet and quick-match sheet (`MatchmakingPanel`), the hall seat panel and its
  "Play" sheet (`RoomOverlay`), and an incoming challenge (Accept is disabled with the reason; Decline always works).
- The sheets show the friendly games left today: "Friendly games left today: 3 of 20".

## Game settings (per game, admin-editable)

Stored in `game_settings` (append-only versions, like `economy_settings`), edited in the **staff console → Games**
(roles `super_admin`, `it_admin`; `SECTION_ROLES.games` in `packages/contracts/src/console.ts`) and in the **back
office → /games** (admin token). Every save is a new version with a **required reason**, recorded in `access_audit`
(`game.settings`, the changed fields "old → new" and the reason). A save applies to **new matches at once**; a running
match keeps the copy it started with (`matches.rules`).

| Setting | Default | Bounds | What it does |
|---|---|---|---|
| `enabled` | on | on / off | Live matches (friendly + staked) can start. Practice vs AI is always open. |
| `friendlyPerDay` | 20 | 0–200 | Friendly live matches one player may start per Kigali day **in this game**. 0 = no friendly live matches. |
| `stakes` | 25, 50, 100, 200 | 0–8 values, each 10–10 000 Stars | The stakes players can choose besides Friendly. Empty = friendly only. |
| `turnSeconds` | 30 | 10–120 | Time per turn before a timeout. |
| `reconnectSeconds` | 90 (Boxing 60) | 15–300 | Time a disconnected player has to come back = the opponent's maximum wait (must be shorter than the longest match). |
| `maxDisconnects` | 3 | 1–10 | Connection losses one player may have per match; the next one forfeits at once (P2-NET-05). Missing = 3. |
| `reconnectBudgetSeconds` | 180 (Boxing 90) | 15–900, ≥ `reconnectSeconds` | One player's time away per match, every drop together (P2-NET-05). Missing = 2 × `reconnectSeconds` (Boxing: `reconnectSeconds`). |
| `joinSeconds` | 60 | 15–300 | Time both players have to open the match. |
| `maxTimeouts` | 3 | 1–10 | Timeouts in a row that forfeit the match. |
| `maxMatchMinutes` | Igisoro 45, Ludo 90, Pool 60 | 5–240 | Longest a match may run (then void). |

**Friendly counter:** `friendly_plays (user, game, Kigali day, count)`. Taken inside the match-create transaction
with one conditional upsert per player (`count < friendlyPerDay`), after the players' rows are locked, so parallel
creates can never go over the limit. A voided friendly match gives its game back (count − 1). Practice vs AI is never
counted.

## Money invariants (for every row above)

- Stakes are locked in escrow before the first move (`lock:<match>`); settled once (`settle:<match>`) or refunded once
  (`void:<match>`). Each posting is idempotent; a match is **settled or voided, never both** (each path checks for
  the other's journal entry first, and the escrow account can't go negative).
- Every scenario is covered by tests that check the ledger still reconciles (every currency nets to zero and stored
  balances equal the postings) — `apps/api/src/modules/games/games.service.test.ts`.

## Tests (scenario → test)

| Row | Test |
|---|---|
| 1 | api `completed normally > win…`; realtime `match-room.test.ts > sends the deciding state before the result` |
| 2 | api `completed normally > draw…`; realtime `match-room.test.ts > draw by agreement…` |
| 3 | realtime `exit-rules.test.ts > leaving voluntarily > before the first move…` |
| 4 | realtime `exit-rules.test.ts > leaving voluntarily > after the first move…`, `match-room.test.ts > resign (after the first move)…`; api `completed normally > forfeit…` |
| 5 | realtime `match-room.test.ts > a page reload mid-game…`, `> reconnects with the reconnection token…`; `exit-rules.test.ts > resume … (P2-NET-05) > drop and come back with the token…` (state intact, clock waited), `> the token expired / the storage was lost…` (re-seat the same player only) |
| 5a | realtime `exit-rules.test.ts > resume … > reconnect budget…`; `boxing-room.test.ts > P2-NET-05: each time-out lasts at most…` |
| 6 (P2-NET-05) | realtime `exit-rules.test.ts > resume … > the opponent never comes back…` (settled exactly once); api `P2-NET-05 > … a forfeit settles once with an audit row` |
| 8a | realtime `exit-rules.test.ts > resume … > friendly: the staying player may leave without waiting…` |
| rules card | api `P2-NET-05 > rules: stored per user + game + version…`, `> the server refuses to seat a player without the current acceptance…`; realtime `stakes.test.ts > rules to accept (P2-NET-05)` |
| 6 | realtime `exit-rules.test.ts > disconnects > not back within reconnectSeconds…` |
| 7 | realtime `exit-rules.test.ts > disconnects > disconnected before the first move and not back: void` |
| 8 | realtime `exit-rules.test.ts > disconnects > both players gone…`; api `void + refund > refunds every stake exactly once…` |
| 9 | realtime `exit-rules.test.ts > turn timeouts > maxTimeouts in a row after the first move…` |
| 10 | realtime `exit-rules.test.ts > turn timeouts > nobody ever moves…` |
| 11 | realtime `exit-rules.test.ts > the opponent never joins > void + refund after joinSeconds` |
| 12 | realtime `exit-rules.test.ts > safety nets > past maxMatchMinutes…`; api `reconciliation sweep > voids + refunds…` (past maximum) |
| 13 | realtime `exit-rules.test.ts > safety nets > settlement keeps failing…`, `> a transient settlement error is retried…`; api `void + refund > settlement and void racing…`, `> a void after the settlement changes nothing` |
| 14 | realtime `exit-rules.test.ts > safety nets > API unreachable for the void too…` |
| 15–16 | api `reconciliation sweep > voids + refunds a match no game server is running, audited, idempotent`, `> the heartbeat keeps a match alive…`; realtime `exit-rules.test.ts > safety nets > heartbeat…` |
| 17 | api `void + refund > a suspended player's live matches are voided…`; realtime `match-room.test.ts > suspension during a match`, `suspension.test.ts` |
| validations | api `validations first …` (all), `friendly games per day …` (all), `the offer the sheets show …`; realtime `stakes.test.ts` (all) |
| settings | api `game settings (versioned, bounded, audited) …`; `console.service.test.ts > grants sections by role` |

## Boxing (real-time fight, P3-FGT-01)

Boxing is the first **real-time** game: no turns, a fixed 30 Hz server tick (`apps/realtime/src/rooms/boxing-room.ts`,
engine `packages/games/boxing`), rounds instead of moves. Every money rule above is unchanged — the match is created
through the same games API (`createMatch`: validations, friendly counter, escrow before the bell), the result is
Ed25519-signed and settled / voided exactly like the turn games, the heartbeat and the sweep cover it. No bots in
live fights; practice vs AI runs in the browser and is never counted (row 18). Live fights need an account.

**First move** = the opening bell rang **and** either fighter sent an input after it (engine `hasBegun`).
**Disconnect** = a **referee time-out**: the fight clock stops for both, the fighters go to neutral; back → a 3 s
countdown and the round resumes where it stopped. Each time-out lasts at most `reconnectSeconds`; each fighter has a **pause budget** of
`reconnectBudgetSeconds` (missing: `reconnectSeconds`) for the whole match (all their time-outs together), and at most
`maxDisconnects` time-outs (P2-NET-05). A connection that sends nothing (no input, no ping) for 3 s during the
fight counts as gone too.

| Row | Boxing meaning | Outcome |
|---|---|---|
| 1 | final bell: the **judges' cards** decide (5 virtual judges, 10-point must; unanimous / split / majority — docs/BOXING-SCORING.md). Early ends: **RSC** (3 knockdowns in a round or 4 in the match), **KO** (counted out: knocked down with no stamina left) | settled; winner gets the pot |
| 1a | **DQ**: the fighter's `warningsToDq`-th warning on the referee ladder (caution → warnings, −1 on every card each). Both disqualified in the same tick → no winner | settled; the opponent gets the pot (both DQ: stakes back) |
| 2 | no majority on the cards: a **staked** fight goes to the countback (judges ahead → card sums → knockdowns → fewer warnings → fewer cautions → power punches → clean punches → last round); a friendly, or a level countback, is a **draw** (no draw offers in boxing) | settled; countback winner gets the pot, a draw gives stakes back |
| 3 | Leave during gloving up / the countdown / before anyone acted | void (`LEFT_BEFORE_START`) |
| 4 | Leave after the first move (the Leave dialog shows the pot) | forfeit (`RESIGN`) |
| 5 | disconnect: referee time-out, the clock stops for both; each time-out lasts at most `reconnectSeconds` (*60 s*), drawn from the fighter's pause budget `reconnectBudgetSeconds` (*90 s*); at most `maxDisconnects` (*3*) time-outs | — |
| 6 | budget used up, after the first move, opponent connected | forfeit (`DISCONNECT`) |
| 7 | budget used up before the first move | void (`LEFT_BEFORE_START`) |
| 8 | both fighters gone | void (`BOTH_DISCONNECTED`) |
| 9 | IDLE: no input at all for `idleSeconds` (*20 s*) in a round = a strike; `maxTimeouts` (*3*) in a row → forfeit; any input resets | forfeit (`TIMEOUTS`) |
| 10 | nobody acts within `idleSeconds` after the opening bell | void (`NO_FIRST_MOVE`) |
| 11 | a fighter never opens the fight within `joinSeconds` | void (`NO_SHOW`) |
| 12 | past `maxMatchMinutes` (*15*), or past the engine's tick bound (`maxFightTicks`, watchdog) | void (`MATCH_TOO_LONG`) |
| 13–17 | settle retries, API down, room closed, stale-escrow sweep, suspension | unchanged (void, refund) |
| 18 | practice vs AI in a free ring | nothing to settle, never counted |

**Scoring + validation** (P3-FGT-06, docs/BOXING-SCORING.md): clients never send scores. The room records every
engine call (a fight log), and before signing it replays the log and re-derives every judge's card and the decision
(`auditFight`). A mismatch is never signed: the match is voided (`SERVER_ERROR`, stakes refunded). The signed
`stateHash` commits to the final state and the log, and the API settles only a result whose signature verifies.

**Inputs** (server checks, plan §3.2): schema (`BAD_INPUT`), `seq` strictly increasing per connection (`STALE_SEQ`),
at most 20 messages a second (dropped, `RATE_LIMITED` once a second), at most **one press per tick** per fighter, presses
outside a round dropped (`NOT_FIGHTING`), only the two fighters' sessions may send.

**Ring checks** (Boxing hall room, `apps/realtime/src/rooms/boxing-hall.ts`): known ring, free / waiting, near its
steps, one ring per person, not already in a live fight, signed in for live fights, game enabled + stake allowed +
funds / friendly limit / break / daily limit (games API, personal reasons only to that player), median ping ≤ 300 ms.

**Settings** (`game_settings` boxing, seeded **disabled**): the usual fields plus `fight { rounds 3, roundSeconds 60,
restSeconds 15, idleSeconds 20 }` (bounds `FIGHT_RULE_BOUNDS`: 1–5 rounds, 30–180 s, 10–60 s, 10–60 s) and the
scoring block `{ judges 5, cautions 1, warningsToDq 3, openScoring true, drawTiebreak "staked" }` (bounds
`FIGHT_SCORING_BOUNDS`: judges 3 or 5, cautions 0–3, warningsToDq 2–5; a row without them runs with the defaults). A boxing row
saved without the block runs with the defaults. `turnSeconds` is unused. Edits apply to new fights only.

| Row | Boxing test (`apps/realtime/src/rooms/boxing-room.test.ts`, api `games.service.test.ts > boxing`) |
|---|---|
| 1–2 | `rows 1-2 > escrowed match → bell → round → signed normal result`; engine `scoring.test.ts` (decisions, countback, KO, property tests) |
| 1a (DQ) | `scoring + validation > DQ on the warning ladder…`; engine `scoring.test.ts > fouls and the referee ladder` |
| audit / tamper | `scoring + validation > the signed result comes from the server's own cards…`, `> a result that fails the pre-sign audit is never signed…`; api `boxing scoring (P3-FGT-06) > … a tampered result moves no Stars` |
| 3–4 | `rows 3-4 > before the first move…`, `> after the first move…` |
| 5 | `rows 5-8 > back within the budget…`, `> a connection that goes silent…` |
| 6–8 | `rows 5-8 > budget used after the first move: forfeit; before it: void; both gone: void` |
| 9–10 | `rows 9-10 > maxTimeouts strikes…`, `> nobody acts after the bell…` |
| 11 | `row 11 > void after joinSeconds` |
| 12–17 | `rows 12-17 > past maxMatchMinutes`, `> settlement keeps failing…`, `> heartbeat … suspension voids` |
| inputs | `inputs (plan §3.2) > bad input, stale seq, presses outside a round, the rate limit; one press per tick` |
| ring checks | `boxing-hall.test.ts` (all) |
| settings | api `boxing (P3-FGT-01) > seeded disabled; the fight block is bounded…` |

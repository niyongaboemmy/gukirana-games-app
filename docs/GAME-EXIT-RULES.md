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
| 5 | **Disconnect** (closed tab, network loss, phone asleep) | after the start | the seat is kept for *60 s* (reconnect window); the **turn clock keeps running** (timeouts below still apply). Back in time (same tab or a reload) → the match goes on. | — | — | — | — | opponent sees "*name* disconnected · *n*s to return"; you see "Reconnecting…" |
| 6 | **Not back within the reconnect window** | after the first move, opponent still connected | **forfeit** by the disconnected player | opponent gets the pot | loss | 0 | counts | "You didn't come back within 60 s, so it counts as a forfeit." |
| 7 | **Not back within the window, before the first move** | no move made yet | **void** | refunded | none | none | not counted | "The match was cancelled before the first move." |
| 8 | **Both players disconnected** | a forfeit would happen but nobody is left connected to win | **void** | refunded | none | none | not counted | "Both players lost the connection. Match voided." |
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
| `reconnectSeconds` | 60 | 15–300 | Time a disconnected player has to come back (must be shorter than the longest match). |
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
| 5 | realtime `match-room.test.ts > a page reload mid-game…`, `> reconnects with the reconnection token…` |
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

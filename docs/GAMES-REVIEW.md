# Games review: rules, scoring, visuals, feel (P2-GAME-05)

Scope: 8-Ball Pool, Ludo and Igisoro, in practice (`apps/web/src/games/*`) and in live matches
(`apps/web/src/match/LiveMatch.tsx` + `apps/realtime/src/rooms/match-room.ts`). Both modes run the same engine
packages (`packages/games/{pool,ludo,igisoro}`), so every rule fix and test below covers both.

## 1. Rules and scoring

| Game | Rule (SRS) | Status | Proof |
|---|---|---|---|
| Pool | Fair rack: 8 in the centre, solid + stripe in the back corners (FR-G1-07) | OK | `pool/src/rules-edge.test.ts` (50 fair racks) |
| Pool | Open table; the first legal pot decides the groups; the shooter keeps the table | OK | rules-edge |
| Pool | Fouls: scratch, no ball hit, wrong ball first, 8 first on an open table, no rail after contact | OK | rules.test + rules-edge |
| Pool | A foul never assigns groups; ball in hand anywhere, placement validated | OK | rules-edge, rules.test |
| Pool | Calling the 8; 8 early, 8 with a foul (scratch included), 8 in the wrong pocket lose; 8 on the break re-spotted | OK | rules.test, rules-edge |
| Pool | Ball off the table | n/a | 2D physics: balls cannot leave the cloth |
| Pool | Shot clock timeout → opponent ball in hand; 3 strikes forfeit (match room) | OK | rules.test, match-room tests |
| Ludo | 6 to leave base, landing on the own (safe) start square | OK | `ludo/src/rules.test.ts` |
| Ludo | Extra roll on 6 / capture / token home; three 6s lose the turn; counter resets correctly | OK | rules.test |
| Ludo | Safe squares (4 starts + 4 stars), captures send every opponent token on the square home | OK | rules.test |
| Ludo | Home column per colour (never capturable), exact roll to finish | OK | rules.test (all 6×6 combos) |
| Ludo | Winner order | **Fixed** | `finishingOrder`: winner 1, then tokens home / squares travelled (ties share a place). Was: everyone else rank 2 |
| Ludo | Invariants over random fair games, 2 and 4 players, every bot level | OK | 60 full games, checked after every action |
| Igisoro | 4×8 board, 2 seeds per pit (64), configurable | OK (rule set v0) | `igisoro/src/rules.test.ts` |
| Igisoro | Sowing only round the player's own 16 pits, loop order | OK | rules.test |
| Igisoro | Relay sowing; capture both facing pits from the inner row when both hold seeds; captured seeds sown on from the next pit | OK | rules.test |
| Igisoro | Pits with < 2 seeds cannot be played; no legal move → loss; move cap 300 → more seeds wins, equal = draw | OK | engine.test + rules.test |
| Igisoro | Event log replays exactly to the engine board (the client animation depends on it) | OK | rules.test (60 random games) |

Bots (practice only): Ludo now has levels 1–5 (Easy races without tactics, Hard weighs the danger of the landing and
leaving squares, Expert also attacks and protects advanced tokens); strength is proven on equal dice (Hard beats
Easy, Expert beats Medium over 120 games). Igisoro Easy plays its second-best pit every third move (chosen by move
number, no Math.random). All bot moves are tested legal at every level.

Known, documented (not changed, need a product/legal decision):
- Pool: groups can be decided on the break (simplified rule, documented in the engine); WPA "four balls to a rail"
  legal-break rule is not enforced.
- Ludo: a roll-phase timeout passes the turn (no auto-roll; `onTimeout` has no RNG). SRS FR-G2-04 says "auto-move".
- Igisoro: rule set v0 is still pending cultural validation (P1-IGI-01/X8); with 2 seeds per pit, games are short
  (often under 20 moves) because the first inner-row landing usually captures.

## 2. Visual consistency

- **Ludo centre (bug, fixed):** the conic gradient was rotated one seat (top red, right green, bottom yellow, left
  blue), so no triangle matched the home column pointing into it. The centre is now four clip-path triangles placed
  from `CENTRE_SIDE`, derived from `HOME_COLUMN` (red W, green N, yellow E, blue S), unit-tested together with the
  start squares, yards, track loop and home spots (`apps/web/src/games/ludo-board.test.ts`). The 3D hall board
  texture (`rooms/ludo-textures.ts`) was already correct.
- One palette (`seatColors`) now drives yard, start square, home column, triangle, tokens, landing preview, player
  panels, die outline and home-celebration colour, in practice and live.
- Pool: ball colours / numbers / stripes match the standard set (1 yellow … 7 maroon, 8 black, stripes 9–15); the
  stripe band now turns with the roll so the number stays on it.
- Igisoro: pit counts always shown; seeds sit on fixed natural spots (up to 16 drawn per pit).

## 3. Feel

Added: dice fist + 3D tumble (outcome-first), token hop arcs, knock-back, home starburst; Igisoro hands that scoop,
sow seed by seed (falling and settling) and sweep captures, the opponent's hand from the far side; Pool bridge and
grip hands on the cue, rolling number spots, pocket drops, opening-rack animation; win starburst on the result.
Settings (per device): animation speed Relaxed / Normal / Fast + skip, AI Easy / Medium / Hard / Expert, auto-move,
tap twice to confirm, hints and legal moves, aim guide Short / Medium / Long, sound, vibration, left-handed layout,
colour-blind palette. In live matches the AI and aim-guide rows are hidden; speed, hints and sound only change the
local presentation, and server timers are untouched. All text goes through the game i18n keys.

Performance (headless Chromium, 1440×900 and 844×390 @2x): 60 fps on every game screen before and after, including
during a pool break replay and an Igisoro sowing animation. The DOM boards stay small (Ludo 528 → 596 nodes, Igisoro
321 → 332, Pool 172 → 183). The pool replay step no longer allocates per frame (preallocated buffers).

Still open: rules explainer animation for Igisoro (FR-G3-02), chess-style clock (FR-G3-03), Ludo skill variants
(FR-G2-02), Pool spin is draw/follow only (no side spin), no feature flag service exists in the web app (the new
presentation can be turned off per device with "Skip animations" / "Show hints").

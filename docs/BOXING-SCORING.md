# Boxing scoring, fouls and validation (P3-FGT-06)

This document defines how a Boxing fight is scored and refereed, and how the result is validated before Stars move.
It replaces the "points decide, no judges" rule of FIGHT-GAMES-PLAN §2.6–§2.7. Code:
`packages/games/boxing/src/{scoring,fouls,audit}.ts` (the judges, the referee and the audit), `engine.ts` (the hooks),
`packages/contracts/src/boxing.ts` (the shapes), and `apps/realtime/src/rooms/boxing-room.ts` (the room logs, audits and signs).

## 1. Research summary (real boxing, 2026)

| Topic | Olympic / amateur (IBA Technical & Competition Rules 2022; World Boxing follows the same model) | Professional (ABC Unified Rules) |
|---|---|---|
| Judges | 5 judges, 10-point must, each scores every round on their own (TCR 18) | 3 judges, 10-point must |
| Criteria | (1) number of quality blows on the target area, (2) domination by technical and tactical superiority, (3) competitiveness (TCR 18.11) | clean punching, effective aggression, ring generalship, defence |
| Round scores | 10-9 close round, 10-8 clear winner, 10-7 total dominance (TCR 18.12) | 10-9; 10-8 usually means a knockdown; 10-10 is allowed but rare |
| Decisions | Win on points by **unanimous** (all 5) or **split** (3-2, or 4-1 with draws) decision (TCR 19.2). There is no technical draw (19.4). Judges level on totals must name a winner (19.3). | Unanimous, split, **majority** (2-0-1), or a draw (unanimous / split / majority draw) |
| Knockdowns | A mandatory 8-count. Counted out at 10 = **KO** (19.9, 24.8). "The gong does not save the boxer" (24.9). | 10-count KO; the three-knockdown rule (TKO) in some commissions |
| Stoppage | **RSC**: the referee stops the contest when a boxer is outclassed (19.6). Women / youth: a maximum of 4 eight-counts per bout (24.6.3). | TKO |
| Fouls | Low blows, the head / elbow, the open glove, the back of the head or neck, kidney punches, holding and hitting, pushing, **ducking below the belt** (21.1.14), **completely passive defence** (21.1.15), **not stepping back on "break"** (21.1.17), **striking right after "break"** (21.1.18), hitting a downed opponent (21.1.13) | Similar list; the referee deducts points at their discretion |
| Penalties | **Caution** (no points; repeated cautions lead to a warning) → **warning** = −1 point on every judge's card → the **third warning disqualifies** (TCR 23.2). Both boxers not competing → both disqualified (19.8). | Point deductions, then a DQ at the referee's discretion |
| Open scoring | IBA keeps every card sealed until the winner is announced (TCR 18.6.1, 18.8). The IOC-run Olympic tournaments (Tokyo 2020, Paris 2024) showed the judges' scores after each round. | Sealed cards (some commissions announce them between rounds) |
| Injuries | RSC-I. **Out of scope here**: there are no injuries in this game (plan D3) | — |

Sources:
[IBA Technical & Competition Rules (2022, PDF)](https://czechboxing.cz/data/document/file/20220901-iba-technical-competition-rules.pdf),
[Ontario amateur boxing rules, World Boxing scoring system](https://www.ontario.ca/document/amateur-combative-sport-rules-boxing/part-iv-competition-requirements),
[Nevada / ABC Unified Championship Rules (PDF)](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/faq/UNIFIED%20CHAMPIONSHIP%20RULES.pdf),
[ABC Uniform Championship Rules (PDF)](https://www.ibfusbaregistration.com/wp-content/uploads/ABCUniformChampionshipRules.pdf),
[NBC Olympics boxing scoring explainer](https://nbcolympics.com/post/10326).

## 2. The rules we chose (and why)

We use the amateur model, because it is fair and clear for casual players. We take two ideas from the pro rules: majority decisions and 10-10 for a truly level round.

- **5 virtual judges** by default (admin: 3 or 5). Every judge scores every round 10-point must.
- **Open scoring**: each round's cards are revealed at its bell, in the snapshot and on the `roundEnd` event. The
  Olympic tournaments did this too. Players can see what they must change in the next round, and spectators can follow
  the fight. Hidden cards would let a player believe they were winning when they were not, which feels unfair in a
  game with stakes. Admins can seal the cards (`openScoring: false`). The cards are then shown only when the fight is over, as IBA does.
- **Decision**: a winner needs a majority of *all* judges (3 of 5, 2 of 3).
- **A winner must be named when there are stakes**: if no fighter has a majority, a published **countback** decides.
  Countback means comparing fixed statistics in a fixed order. This plays the role of IBA 19.3, where level judges
  must nominate a winner. A friendly may end in a draw. (`drawTiebreak`: `staked`, the default, or `always` / `never`.)
- **KO** = counted out. A fighter knocked down with no stamina left (below 100) can't beat the count. The count runs to
  10 and the fight ends. Players avoid it by managing stamina. Otherwise a fighter always rises at 8 (plan §2.4,
  no button mashing).
- **RSC** = 3 knockdowns in one round or 4 in the fight (unchanged).
- **Referee ladder**: caution → warning (−1 on every card) → the 3rd warning disqualifies. The defaults (admin-editable)
  are 1 caution (`cautions`, 0–3) and DQ on the 3rd warning (`warningsToDq`, 2–5).

## 3. The judges

Everything is a pure function of the engine's own events, in integers. Each tick, the engine folds that tick's events
into a per-round tally (`tallyEvents`):

| Tally field | From the events | Criterion |
|---|---|---|
| `value` | the `points` of the fighter's `hit` events (punch value + counter + combo bonus) | quality blows on target |
| `landed`, `power` | clean hits (`combo ≥ 1`), and the clean ones that are not jabs | quality blows, power |
| `thrown` | the fighter's hit / block / evade / whiff events | initiative, activity |
| `defended` | the opponent's punches this fighter blocked or slipped | defence |
| `forcedMiss` | the opponent's punches that fell short | footwork, ring generalship |
| `kd` | knockdowns scored | dominance |
| `ded` | warnings in this round (penalty 1) | deductions |

Each judge has fixed integer weights (`JUDGE_PROFILES`). Clean blows always weigh most (4 or 5 per point). The judges
lean a little differently on the rest. J1 is balanced, J2 likes power, J3 is a technician (defence and footwork), J4
rewards initiative, and J5 counts clean blows. A judge's round:

```
base  = clean·value + power·power + defence·defended + footwork·forcedMiss + activity·thrown
total = base + 40·kd                         (a knockdown nearly always wins the round)
equal totals            → 10-10
otherwise the winner 10, the loser 9 − min(2, netKnockdowns + dominant)   (never below 7)
dominant = winner's base ≥ 3 × loser's base and ≥ 60 ahead                 (10-8 without a knockdown)
```

So a close round is 10-9. One net knockdown or a one-sided round is 10-8. Two net knockdowns, or one knockdown plus
dominance, is 10-7. Deductions come off the round's score on every card *after* the 10-x
(`RoundCard.judges` holds the 10-x, `RoundCard.deductions` the points taken off). A fight stopped mid-round has that round scored up to the stop and
marked `partial` (IBA 19.1.2).

**Why it is fair and deterministic**

- There is no randomness and no clock, and the client sends nothing the judges read. Only server-side events count.
- Each judge's scores come from an integer function. The weights are fixed and published, so the same fight log always gives the same cards.
- It is symmetric: no step looks at the corner, so swapping the fighters swaps every number. The property test checks this.
- The judges disagree only because their weights differ. A split happens in a really close round, never at random. In
  200 bot-vs-bot fights at the same level (levels 3 and 5), about 1 in 5 decisions on points was split, and about
  1 in 25 was majority. Those bots hardly ever fouled: 5 DUCKING cautions in 200 level-5 fights, none at levels 1 and 3.

## 4. Fouls and the referee ladder

| Code | Trigger (engine, fixed thresholds) | How to avoid it | Real rule |
|---|---|---|---|
| `PASSIVITY` | no punch thrown for 15 s in a round | throw something, even a jab | IBA 21.1.15 completely passive defence |
| `HOLDING` | both in close range (≤ 90 cm) and this fighter throws nothing for 3 s → the referee calls **"Break!"**: the pair is reset to 200 cm. The first break on a fighter in a round is free; each later one in that round is a foul. | punch when you are close, or step out | 21.1.2 holding, 21.1.17 not stepping back on break |
| `HIT_ON_BREAK` | during the 1 s "Break!" every punch pressed is cancelled, because the referee holds them apart. A fighter who steps back in (closer than 200 cm) and presses a punch commits the foul, once per break. Pressing from where the referee put you is free, so mashing buttons is never punished. | wait for the break to end | 21.1.18 striking immediately after "break" |
| `DUCKING` | 5 slips in a row without a punch | slip, then punch back | 21.1.14 ducking below the belt |
| `LOW_BLOW` | reserved, never emitted: the engine has no body / head target zones yet | — | 21.1.1.1 |
| `IDLE` | no input at all for `idleSeconds`. This is the exit-rules strike (row 9), **outside** the ladder, and never a deduction. | send any input | — |

Some fouls are impossible by construction, because no such input or state exists. The fighters' actions reset at the
bell and presses outside a round are dropped, so nobody can hit after the bell. Both fighters are frozen during the
count, so nobody can hit a downed opponent. Head-butts, kicks, the open glove and pivot blows have no input.

**Ladder** (`ladderStep`, per fighter, every referee foul counts toward it):

| Foul # (defaults) | Level | Effect | Event |
|---|---|---|---|
| 1 | caution | none (cautions + 1) | `warning { level: "caution", penalty: 0 }` |
| 2, 3 | warning | −1 on every judge's card for this round, and −1 raw point (floored at 0) | `warning { level: "warning", penalty: 1, n }` |
| 4 (= the 3rd warning) | dq | −1, then **disqualified**: the opponent wins (`decision "dq"`, `method "DQ"`, `dqFoul`) | `warning { level: "dq" }` + `dq { to, foul }` |

If both fighters are disqualified in the same tick, there is no winner: the stakes come back (IBA 19.10).
A fight where neither fighter throws a punch ends this way after 60 s (IBA 19.8: both boxers not competing).

## 5. Decisions

| Method | `decision` | When |
|---|---|---|
| KO | stoppage | counted out (10) |
| RSC | stoppage | 3 knockdowns in a round / 4 in the fight. If both are stopped at once, or both counted out → decision on the cards. |
| DQ | dq | the warningsToDq-th warning |
| UD | points | every judge has the winner ahead |
| MD | points | a majority for the winner, the other judges level, none for the opponent |
| SD | points | a majority for the winner, at least one judge for the opponent |
| TB | points | no majority, and a winner must be named → countback: more judges ahead → higher sum of all cards → more knockdowns scored → fewer warnings → fewer cautions → more clean power punches → more clean punches → better last round (sum of the judges) |
| DRAW | draw | no majority, and either no countback (friendly) or a level countback, which needs a perfectly mirrored fight. Stakes come back. |
| FORFEIT / VOID | forfeit / void | exit rules (unchanged) |

## 6. Validation chain (client → room → signed result → API)

1. **Client**: sends only `FightInput { seq, a?, g }`. zod strips any other field (a `points`, `score` or `winner`
   sent along is never read). A message type the room doesn't handle (for example a fake `result`) makes Colyseus
   close that session. There is no client path to a score, a card or a result.
2. **Room** (`boxing-room.ts`): steps the pure engine at 30 Hz and records every engine call in a `FightLog`: begin,
   each tick's inputs (runs of empty ticks folded), pauses / resumes, forfeit / void.
3. **Pre-sign audit** (`auditFight`): before signing, the room replays its own log from `createFight` and checks:
   - the replay reaches the very same state hash;
   - every card is well formed (each judge 10-x, x ∈ 7..10) and equals the judges' card of that round's tally;
   - deductions are applied exactly once (cards = fighter deductions = warnings);
   - the totals are the sums of the rounds;
   - re-running the decision gives the same method and winner;
   - a DQ only comes at the warningsToDq-th warning.

   Any failure means the result is **never signed**: the match is voided (`SERVER_ERROR`) and the stakes are refunded.
4. **Signature**: Ed25519 over `{ matchId, game, ranks, reason, stateHash, finishedAt }`. `ranks` come from the engine
   outcome (`matchResultOf`). `stateHash = sha256("boxing:v2:" + sha256(hashFight(state)) + ":" + sha256(log))`, so
   the settled match commits to the cards, the decision and every input. Anyone holding the log can replay it and
   check the result.
5. **API** (unchanged money code): `GamesService.settle` verifies the signature with the realtime public key.
   Any change to ranks, reason or hash → `BAD_RESULT_SIGNATURE`, and no Stars move. Settlement still goes only through
   `LedgerService.post()` (idempotency key `settle:{matchId}`).

Tamper tests:
- `boxing-room.test.ts > scoring + validation`: a fake `result` message, score fields on inputs, a signed result that
  matches the replay and the hash, flipped ranks / hash / reason failing verification, and a forged card in the
  server state → voided, never signed.
- `games.service.test.ts > boxing scoring`: flipped winner, a forged draw, a changed reason or hash → refused, the
  balances unchanged.

## 7. Property tests (`packages/games/boxing/src/scoring.test.ts`)

- **10k seeded fights**, 3 or 5 judges, staked or friendly, with fighters that brawl, crowd, duck or stay passive. Each
  passes `auditFight`, and:
  - every round on every card is 10-x with x ∈ 7..10;
  - deductions are applied once;
  - the totals equal the sums;
  - UD / SD / MD / TB / DRAW match the votes;
  - a DQ comes only after the ladder;
  - the ranks follow the outcome.

  Every ending shows up: DQ, KO, RSC, UD, SD, MD, TB and DRAW.
- **Determinism**: replaying the JSON round-tripped log gives an identical hash and identical cards.
- **Symmetry**: mirrored inputs give mirrored cards, totals, votes, the same method and the same ranks per player.

## 8. Settings (`game_settings` boxing → `fight`, versioned, audited)

| Field | Default | Bounds |
|---|---|---|
| `judges` | 5 | 3 or 5 |
| `cautions` | 1 | 0–3 |
| `warningsToDq` | 3 | 2–5 |
| `openScoring` | true | on / off |
| `drawTiebreak` | `staked` | `staked` / `always` / `never` |

All five are optional in `FightRulesSchema`. A row saved before them runs with `DEFAULT_SCORING_RULES`
(`scoringRulesOf`). They can be edited in the staff console (Games → Fight rules → Scoring and referee) and in the
back office. Edits apply to new fights only.

## 9. Engine v2 inputs (P3-FGT-10, docs/FIGHT-GAME-V2.md)

The judges, the 10-point must, the methods, the ladder and the audit are unchanged. Engine v2 adds inputs to the
same tally. All of them are optional fields, so a v1 tally (absent = 0) scores exactly as before. v1 fights are
replayed with the frozen copies in `src/v1/`.

- **Parries** count like blocks: thrown for the puncher, `defended` for the parrier.
- **Evades** carry `how` (slip / duck / step). All of them count as `defended`.
- **Counters and body shots** are counted (`counters`, `body`) for the skill report. Their scoring weight is already
  in the hit's points: a counter is worth +1.
- **Ring generalship (`control`).** One point per 2 s of keeping the opponent on the ropes or in a corner, or per
  4 s of holding the centre. It only counts while the controller is not being outlanded in the round.
- **Judge weights (`generalship`).** J1 2, J2 1, J3 3, J4 2, J5 0. These weight IBA "domination by technical and
  tactical superiority".
- **Clinches.** A clinch the referee breaks is a "Break!" call on the clincher. The second call in a round is
  HOLDING, through the usual ladder.
- **DUCKING.** Ducks count with slips.
- **The signed result** also carries each fighter's integer skill line (`stats`, FightStatLine). The API stores it
  with the Glicko-2 rating event. Hash prefix: `boxing:v3:` for engine v2 fights, `boxing:v2:` for v1.

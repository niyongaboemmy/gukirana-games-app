# Ring fight v2 — research, design, skill rating, realism (P3-FGT-10)

Status: engine v2, rating, controls and the result card are implemented; see §11 for what is still open.
Earlier decisions: docs/FIGHT-GAMES-PLAN.md, docs/FIGHT-REDESIGN.md (P3-FGT-05/07/09), docs/BOXING-SCORING.md (P3-FGT-06).
Ideas only: no game's name, characters, art, UI or music is reproduced.

## 1. What players reported

- Boxers overlapped or walked through each other. The v1 engine only knew one number (the distance), so the
  presentation invented where the pair stood.
- People didn't look like real people. The bodies were reshaped plaza meshes, and the motion read as canned clips.
- There was no real footwork. The only moves were step in / out and slips, with no lateral movement, circling,
  cutting off the ring or ropes.
- Skill showed little. Easy assist blocked almost everything, a level 5 bot landed nothing on an idle player, and
  there was no rating, so the game could not say who was better.

## 2. Research summary

### 2.1 Boxing games (design lessons, no assets)

- **Console simulation boxing with physics-driven reactions.** Reviews praise punches whose effect follows the impact
  (location, power, momentum) and controls that "reward timing rather than button mashing", with no auto-block.
  The lesson: defence must be an action with a window, and power must come from timing and position, not from a
  boost button.
- **Recent PC simulation boxing.** Reviews ask for footwork with weight (momentum, no instant direction changes) and
  stamina that drains with output and comes back slowly. They criticise punches that clip through bodies, and
  stamina that recovers too fast. Lessons: weighty acceleration, solid bodies, a slow stamina economy, and punches
  that cost something.
- **VR boxing.** The player's body is the controller. The lesson that carries over to flat screens is that range and
  angle are the game: a punch only lands if the target is where you aimed when it arrives.
- **Ragdoll and arcade mobile boxing.** These games are simple to read: one clear outcome per action, and output
  tied to stamina.

### 2.2 Real boxing coaching

- **Footwork.** Short steps, with the lead foot first towards the direction of travel. Circle away from the
  opponent's power hand. Pivot on the lead foot to take an angle. Cut off the ring by mirroring the opponent's
  lateral movement instead of following it. The ropes and corners are traps.
- **Distance.** Long (jab), mid (straights), inside (hooks, uppercuts, body). Straights are smothered inside.
  Meeting an opponent's step in with a straight ("walking onto it") is the classic distance-control counter.
- **Punch trade-offs.**
  - Jab: fast, cheap, low damage. It measures and sets up.
  - Cross: slower, more power, needs weight transfer.
  - Hooks: short range, beat the high guard's front and catch a slip.
  - Uppercut: splits a high guard and catches a ducking head.
  - Body shots: slow the opponent down (stamina) and are hard to slip.
- **Defence.**
  - High guard: blocks head shots, leaves the body and the uppercut channel.
  - Parry: deflects straights and throws the puncher off balance.
  - Slip: beats straights, loses to hooks.
  - Duck / roll: beats hooks, loses to uppercuts.
  - Step back: beats everything with distance.
  - Clinch: stops everything for a few seconds, then the referee breaks it.
- **Counters.** The best moment to punch is right after a defence, or while the opponent is punching or recovering.
- **Stamina economy.** Output costs energy, missing costs more, and fatigue slows hands and feet. Body work lowers
  the opponent's ceiling.
- **Ring generalship.** Control of the centre, and making the opponent fight on the ropes.

### 2.3 Measuring skill

- **Elo** uses one number per player and a fixed K factor. It is simple, but it can't tell "new" from "proven".
- **Glicko / Glicko-2** (Glickman) adds the rating deviation (RD: uncertainty) and the volatility (σ: how erratic
  results are).
  - New players move fast. Established players move slowly.
  - The RD grows back with inactivity.
  - The paper's worked example (1500 / 200 / 0.06 against 1400 / 30 W, 1550 / 100 L, 1700 / 300 L, τ = 0.5) gives
    **1464.06 / 151.52 / 0.05999**. Our implementation reproduces this in rating.test.ts.
- **TrueSkill-style systems** use a Bayesian mean and σ, and rank by the conservative value μ − kσ. We borrow the
  idea for the leaderboard: rating − 2·RD.
- **Matchmaking by rating.** Match within a window that widens with the wait. RD measures how much to trust a rating
  (GW2-style practice).
- **Anti-smurfing.** Provisional players (high RD) move fast, so a strong newcomer reaches their level within a few
  fights. A conservative leaderboard means two lucky wins never top it. Ratings only come from signed, settled live
  fights.
- **In-fight skill signals (broadcast punch stats).**
  - Punches thrown and landed, and accuracy (landed ÷ thrown).
  - Power punches landed.
  - Clean-punch differential ("plus-minus").
  - The opponent's connect rate against you (defence %).
  - Output per minute.
  - Counters landed.
  - Ring control.
  - Output under fatigue.
  - Critics note that counts ignore effectiveness. We show the report next to the judges, never instead of them.
- **Amateur judging.**
  - Criteria: quality blows on target, domination by technical and tactical superiority, competitiveness, and rule
    infringements.
  - 10-point must: 10-9 close, 10-8 clear, 10-7 total dominance.

## 3. Design principles

1. **The server decides.** Deterministic, integer, tick-based (30 Hz), randomness only in the practice AI (seeded
   from @gukirana/fairness), no bots in cash rooms.
2. **Every advantage has a cost and a counter.** No action is safe to spam.
3. **Read, then act.** The fast punches are answered by the held guard. The slow ones can be read and slipped,
   ducked or parried, and the read is rewarded by a real counter window.
4. **Bodies are solid.** The engine never lets centres come closer than the body line. The presentation maps that
   line to chest-to-chest on the canvas.
5. **Skill is measurable.** The same events feed the judges, the skill report and (through the settled result) the
   rating.

## 4. Engine v2 (packages/games/boxing/src/engine.ts)

### 4.1 Geometry

Positions are in mm and velocities in mm per tick, with no trigonometry. Integer `isqrt`, scaled vectors and a
table-free integer atan for the presentation orbit.

| Item | Value |
| --- | --- |
| Canvas | 4.3 m inside the ropes; a boxer's centre stays within ±1800 mm on each axis (the ropes are walls) |
| Body line `BODY_SEP` | 640 mm. After all footwork, the pair is pushed apart half each, up to 4 passes, then a slide along the ropes when both are pinned. Closing velocity along the axis is removed: they press, they never pass. |
| Start / break / restart gaps | 1800 / 1500 / 1800 mm |
| Footwork speeds | forward 34, back 30, lateral 28 mm/tick (≈ 1.0 / 0.9 / 0.84 m/s); diagonals ¾ |
| Response | accelerate 7, brake 11 mm/tick² (weight) |
| Feet while punching | planted: windup / active 25 %, recovery 50 %, defending 50 %, tired ×¾ |
| Lateral-only movement and pivots | circle at constant distance: re-projected onto the circle round the opponent's pre-tick position |
| Bursts | step in / out 62 mm/tick × 6 ticks (≈ 37 cm); pivot 78 mm/tick × 6 lateral, with distance kept (≈ 25° at 1 m) |
| Facing | always towards the opponent |

### 4.2 Punches

Ticks are at 30 Hz. "+guard" and "+tired" add windup ticks.

| Punch | Windup | Active | Recovery | Reach | Stamina | Points | Balance taken | Stagger | Kind / line tolerance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jab | 4 | 2 | 7 | 1180 mm | 18 | 1 | 45 | 5 | straight / 150 mm |
| cross | 7 | 2 | 10 | 1120 | 40 | 2 | 95 | 8 | straight / 170 |
| lead hook | 8 | 3 | 11 | 860 | 48 | 2 | 115 | 9 | hook / 300 |
| rear hook | 10 | 3 | 13 | 840 | 60 | 3 | 145 | 11 | hook / 320 |
| uppercut | 9 | 3 | 13 | 760 | 56 | 3 | 145 | 11 | uppercut / 180 |

Modifiers:

- **Guard:** windup +2.
- **Fatigue:** tired (< 300 stamina) windup +2 and power ×¾. Exhausted (< 100) windup +4 and power ×½; hooks and
  the uppercut are refused.
- **Body shot:** windup +1 and reach −60 mm. It takes 60 % of the balance damage, drains 80 % of it as the
  target's stamina, and adds a third of it to body wear. The stamina ceiling is 1000 − bodyWear/2.
- **Smothered:** straights closer than ~700 mm score only partial.
- **Clean head hits** add wear (ceiling 1000 − wear/2). Worn fighters can't beat the count.

Punch outcomes:

- **Whiff:** +16 stamina and +4 recovery ticks (overreach). This gives the opponent a counter.
- **Clean hit:** −3 recovery (punches flow into combinations), the combo bonus from the 3rd punch, and a knock-back
  push.
- **Into it:** a defender walking into the punch (closing at more than 12 mm/tick) takes ×1.25.
- **The aim line:** a punch is aimed where the opponent stood when it was thrown. If at impact the target stands
  further off that line than the punch's tolerance, it misses (`evade` / `step`). Lateral footwork and pivots
  therefore make punches miss, and a hook's arc tracks more than a straight.

### 4.3 Defence

| Defence | Window (ticks) | Beats | Loses to |
| --- | --- | --- | --- |
| high guard (held) | while idle / not punching | head straights + hooks → block (defender −10 stamina, power punches −12 balance, small push) | uppercut and body shots → partial (1 point); angles (§4.4) |
| parry (Q) | 1–4 of 10 | head straights → the puncher +9 recovery, −20 balance; a counter window | hooks, uppercuts, body (eats them clean) |
| slip (Space + A / D) | 2–7 of 11 | head straights, uppercut | hooks (a counter), body shots |
| duck / roll (Space) | 2–8 of 13 | head hooks and straights | uppercut (a counter), body shots |
| step out / pivot | burst | everything, by distance or by the aim line | being slow |
| clinch (C) | grab at tick 3 within 900 mm | everything: both locked 2 s, the clincher recovers stamina +7 / tick | the referee: every clinch is a "Break!" call, so the second in a round is HOLDING |

Counters:

- A punch started within 12 ticks after a successful defence, or after a feint the opponent bit on, is a counter:
  +1 point, ×1.25 damage, +2 stagger.
- Landing into the opponent's windup or active frames, or into a whiff's recovery, is a counter too.
- A punch pressed while a successful slip, duck, parry or block is still playing cuts the rest of the defence short.
  Slip-then-counter is real time, not the tail of an animation.

Other rules:

- **Defence cancel:** a defence press in the last ticks of my own punch's recovery cancels it (punch, then get out).
- **Feint (F):** 8 ticks, 6 stamina. Every viewer and the AI see the start of a cross (`perceived()` disguises it in
  the snapshot). A defence started during it gives the feinter a counter window.

### 4.4 Ring generalship, fouls, knockdowns

- **Angles.** After a pivot the pivoting boxer has the angle for 12 ticks: the defender's guard does not cover it,
  unless the defender also steps or pivots.
- **Ring control.** 2 points per tick while the opponent is on the ropes or in a corner and you are not, and 1 per
  tick while you hold the centre (more than 30 cm nearer it). Every 60 points is one judges' generalship point.
  Control only counts while you are not being outlanded in the round (IBA: domination by technical superiority).
- **Fouls.** The P3-FGT-06 ladder is unchanged:
  - PASSIVITY: 15 s without a punch.
  - HOLDING: the second "Break!" call on you in a round. Calls come from a clinch, or 3 s chest to chest without
    punching.
  - HIT_ON_BREAK: pressing a punch closer than 1.4 m during "Break!".
  - DUCKING: 5 slips or ducks in a row without a punch.
  - IDLE (exit rules).
  - LOW_BLOW stays reserved: body shots land on the legal target by construction.
- **Knockdowns.** Balance 0 starts the count. You rise at 8 with 650 balance, and each further knockdown takes 100
  more off. A fighter down with under 100 stamina, or with wear ≥ 850, is counted out (KO). Three knockdowns in a
  round, or four in the fight, is RSC.

### 4.5 Determinism and symmetry

- Both boxers advance from the same pre-tick state.
- Staggers are applied after both punches resolve (order-free).
- Midpoints use truncating division (a rotation-symmetric rounding).
- 600 mirrored fights give mirrored cards (scoring.test.ts).
- 10k seeded random fights keep every scoring invariant.
- 300 random fights never overlap or leave the ring (engine.test.ts).

## 5. Skill separation (sim.test.ts)

The test runs full 3 × 60 s fights between scripted agents, 40 per pairing, half from each corner. Results are W-D-L
of the first:

| Pairing | Result |
| --- | --- |
| L2 vs L1 | 40-0-0 |
| L3 vs L2 | 40-0-0 |
| L4 vs L3 | 38-0-2 |
| L5 vs L4 | 32-1-7 (≈ 81 %) |
| L3 vs L1, L4 vs L2, L5 vs L3 | 40-0-0 each |
| L1, L2, L3 vs a button masher (walks forward, throws non-stop, never defends) | 40-0-0 each |
| Same L3, timing + defence better (react 5, defend 85 %, read 92 %) | 69-2-9 (88 %) |
| Same L3, counters better (85 %) | 40-8-32 (55 %) |
| Same L3, distance + ring craft better | 31-11-38 (46 %) |
| Same L3, all three "ring IQ" knobs | 39-9-32 (54 %) |
| L5 vs a fighter who stands still | wins; lands > 20 clean |
| L5 vs a fighter in a permanent shell | wins; the shell is warned for passivity |

The skill report agrees with the result: in 20 L5 vs L2 fights the winner had the better differential and defence %
in at least 17 (asserted).

What the numbers say:

- Reading and timing (what a better human does) dominate, and a disciplined novice beats mashing every time.
- Counters alone give a modest edge.
- With these scripted agents, footwork knobs alone do not yet win more. The engine does reward footwork (the aim
  line, ring control, walking onto punches), but the agent's footwork policy is simple. This is an open tuning item
  (§11).

Why mashing loses:

- Whiffs and blocked punches cost stamina and recovery.
- Gassed arm punches do half damage.
- Every whiff or block gives the defender a counter window.
- Walking in eats the ×1.25 "into it" damage.

## 6. The skill report

The engine's `fightStatsOf` produces each fighter's integer line. The fight room signs it with the result as
`stats`. Tampering breaks the signature (boxing-room.test).

- **Shown lines:** accuracy %, defence % (the opponent's punches that did not land clean), counters landed, ring
  control seconds, output per minute, seconds gassed, and the clean-punch differential.
- **Also stored:** landed, power, body, kd, defended, landed while tired, fouls.
- **Columns:** you, the opponent, and your average over your last 20 rated fights (from the API).
- **Headline:** "You were better on n of 6".
- **Practice:** the same report against the AI, computed by the local engine. It is never sent and never rated.

## 7. Rating: Glicko-2 (who is better)

1. **Model.**
   - Parameters: rating r (1500 start), deviation RD (350 start; floor 45), volatility σ (0.06), τ = 0.5.
   - One fight is one rating period: both boxers are updated from their pre-fight values.
   - Win 1, draw ½, loss 0.
   - A forfeit counts. A void never does, and practice never reaches the API.
   - Idle weeks grow the RD back (σ per idle week), applied before the update and when read.
2. **Where.**
   - The calculation: packages/games/boxing/src/rating.ts.
   - Storage, migration 0011:
     - `fight_ratings` (r, RD, σ, games, W-L-D, peak, last fight).
     - `fight_rating_events` (one row per match and player: before → after, the score, and the signed skill line).
       The (match, user) primary key makes the update idempotent, on top of the settlement's own once-only flip.
   - The update runs in GamesService.settle, from the signed result only.
3. **Show.**
   - Tiers by rating: Novice < 1350 ≤ Amateur < 1500 ≤ Contender < 1650 ≤ Pro < 1800 ≤ Elite < 1950 ≤ Champion.
   - Provisional ("?") until 5 rated fights and RD < 160.
   - The result card shows before → after, the delta, the tier and the provisional count.
   - The leaderboard ranks by conservative skill (r − 2·RD). It lists real accounts only, with at least 3 rated live
     fights. Bots never fight live and nothing is invented.
   - Endpoints: `GET /fight/rating/me`, `GET /fight/leaderboard`, and `GET /internal/fight/rating/:id` (matchmaking).
4. **Matchmaking.**
   - Quick fight first pairs within ±150 rating points, widening by 100 every 5 s, and anyone after ±600.
   - The closest rating wins, then the longest wait.
   - Waiting players are re-checked at every widening step.
   - FIGHT_MATCH_WINDOW lives in contracts.
5. **Anti-smurf.**
   - A provisional RD moves a strong newcomer up fast.
   - The conservative leaderboard needs proven results.
   - No client input ever reaches the rating.
6. **Flag.** FF_FIGHT_RATING / NEXT_PUBLIC_FF_FIGHT_RATING, on unless "0".

## 8. Migration v1 → v2

- The v1 engine, bot, scoring and fouls are frozen under `src/v1/` (byte-identical tallies and cards). Shared
  scoring changes can't alter old results.
- `FightLog.engine` is absent for v1 logs and `2` for new ones.
  - `replayAny` and `auditFight` pick the engine.
  - A log that claims the wrong engine returns `ENGINE_MISMATCH`.
- The room's result hash prefix is `boxing:v2:` for v1-engine fights (as before) and `boxing:v3:` for v2.
- The contracts change is additive:
  - New actions: rhook, parry, duck, clinch, feint, pivotL / pivotR.
  - Optional `mv` (held footwork) and `b` (body) on the input.
  - Optional `x` / `z` / `body` / `wear` on the fighter view.
  - `engine: 2` and `clinch` on the snapshot.
  - `parry` / `clinch` events; `body` / `angle` / `how` on hit and evade events.
- Old clients still read `dist` / `orbit`; both are derived from the positions every tick.

## 9. Controls

| Device | Mapping |
| --- | --- |
| Keyboard (rebindable) | W A S D / arrows move (A / D side-step and circle; with W / S they circle in or out). Shift + A / D pivot, Shift + W / S quick step. J jab, K cross, U lead hook, I rear hook, O uppercut. Hold E for the body, hold L for the guard. Space slips to the side held, or ducks when no side is held (steps back with S). Q parry, F feint, C clinch. The listeners run in the capture phase, so the hall's keys never act during a fight. |
| Mouse | left jab, right cross, Shift + left lead hook, Shift + right uppercut, middle rear hook |
| Gamepad | left stick moves; X / Y / B / RB / A punches; LT guard, RT body; LB evade by the stick side; right-stick flick to pivot or quick step; D-pad parry / clinch / feint |
| Phone (landscape) | Left thumb: a floating stick (touch = guard, drag = walk, quick flick = slip or step). Right thumb: four big punch buttons or strokes (↓ = rear hook to the body). |

- **Input.** A press shows at once (prediction). The engine buffers a press made while busy for 6 ticks, and never
  plays for the player.
- **Easy mode.** Practice only, and only against levels 1–2.

## 10. Realism plan and what was done

- **Bodies.** We evaluated (a) a new procedural or permissively licensed athletic base mesh, and (b) an upgrade of
  the current path. The avatar path already uses the Rocketbox (MIT) bodies with the kit-fit layer, per-channel
  wrapped-diffuse skin (a subsurface approximation), and sweat sheen. A new skinned base mesh with muscle normal maps
  is a multi-day asset task. It would also need a recorded licence (docs/ASSET-LICENSES.md), so it was not done in
  this task (§11).
- **Motion.**
  - The boxers now step: forward, back, left and right step clips follow the engine's real velocity, relative to
    where each boxer faces. No walk cycle runs inside the ring.
  - Pivots play the side steps.
  - The duck, parry and clinch have their own clips.
  - Body shots dig low (the lead and rear body clips).
  - Hit reactions follow the engine's `body` flag and partial / clean.
- **No overlap.**
  - The engine's body line maps to a chest-to-chest canvas gap (`canvasGapOf`: 640 mm → 0.64 m, a jab's reach →
    0.98 m, so the glove fits with the reach fit).
  - The referee keeps 0.75 m from both boxers, inside the ropes.
- **Camera and lights.** These are unchanged (P3-FGT-09). The camera follows the real pair axis from the engine.

## 11. Open items

- Footwork-only agent knobs don't yet beat the baseline (§5). The next tuning step is a smarter cut-off / circle
  policy in the practice AI, and possibly a larger aim-line payoff.
- Person realism: a dedicated athletic base mesh with muscle normal maps, foot IK planting and capsule-based
  arm / torso interpenetration checks were not built in this task.
- Phone has no dedicated duck button: a duck needs a keyboard, pad or mouse; touch slips and steps.

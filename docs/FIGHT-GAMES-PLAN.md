# Fight Games hall — Boxing (P3-FGT-01)

Plan + shared contracts for the Fight Games hall and its first sub-hall, **Boxing**: 50 rings, live PvP for Stars,
practice against the AI, a real boxing kit while you are in the ring. Two agents build it in parallel from this page:
**Agent W** (world) and **Agent G** (game). Their briefs are at the end (§11, §12).

Contracts already committed with this plan:

| What | Where |
|---|---|
| Boxing ids, rings, statuses, kit, inputs, snapshot, events, rules, messages, errors, capacity | `packages/contracts/src/boxing.ts` |
| `boxing` game id (seeded **disabled**), `fight` rules block in game settings + match rules | `packages/contracts/src/games.ts` |
| Hall ids `fight` (lobby) and `boxing` (sub-hall) | `packages/contracts/src/social.ts` `HALL_SEATING` / `isHallId` |
| Building `fight` (console open / close switch) | `packages/contracts/src/console.ts` `SEED_BUILDINGS` |
| Engine package skeleton: phases, clocks, rounds, decision, forfeit / void, snapshot, hash, bot signature | `packages/games/boxing` (`@gukirana/boxing`) |
| The web seam between the two agents | `apps/web/src/fight/bridge.ts` (`useFightBridge`) |

**Third agent — Boxing assets (P3-FGT-02), running in parallel.** It builds the plan-independent building blocks that
W and G only **integrate** (they never edit these folders):

| Asset | Folder (owned by the assets agent only) | Seam used by W / G |
|---|---|---|
| Motion library (procedural, Rocketbox rig): guard + footwork, jab, cross, hook L/R, uppercut L/R, block high/low, slip L/R, duck, hit reactions, knockdown + get-up, count idle, victory / defeat, stool rest, glove touch | `apps/web/src/world/human/boxing/*` (not `kit*`) | `boxingPose(state, t)` / clip names + durations; clip names = contracts `BOXING_CLIPS`; engine → clip = `clipFor(view, phase)` + `HIT_REACTION` (boxing.ts) |
| Boxing kit: gloves, trunks + waistband, boots, headgear (hair under it), optional mouthguard | `apps/web/src/world/human/boxing/kit*.ts` | `boxingKitOverride(look, corner)` → a temporary `AvatarLook` (never mutates the saved look); corner colours = `CORNER_COLORS` (red / blue) |
| Instanced ring kit: platform, printed canvas, posts + padded turnbuckles (red / blue / neutral), 3–4 sagging ropes, apron, steps, stools, bucket dressing, ring lights / status lamp, spectator rail — N rings from an array of transforms in a few draw calls | `apps/web/src/rooms/fight/ring-kit*.tsx` | a component taking `rings: { id, x, z, rotY, feature?, status }[]` (status → lamp colour, `RingStatus`) |

Ask for the assets agent: the kit must include a **corner-colour vest / sports top** (`BoxingKit.vest`) so every
body type is dressed respectfully. Until its files land, W and G code against these seams (W may keep a throwaway
placeholder inside its own folder, deleted at integration).

## 0. Key decisions

| # | Decision | Why |
|---|---|---|
| D1 | The fight is played **in the 3D ring in the hall**, not on a separate game screen. The fight HUD and controls are an overlay over a fight camera. | That is the "real" experience: spectators at the rail see the same fight. |
| D2 | **Server-authoritative fixed-tick simulation at 30 Hz**, integer-only, **no randomness at all**. Clients send presses; the server decides every hit. | Skill game, fair, replayable, no RNG to audit. |
| D3 | **Points-based sport boxing** with a *composure* (balance) meter, not health. A knockdown is a points event with a referee count; no injuries, no blood, no KO animation of harm. | Respectful tone, clear scoring. |
| D4 | 3 rounds × 60 s, 15 s rest (admin-editable within bounds). Win on points or by **stoppage** (3 knockdowns in a round or 4 in the match). Ties → knockdowns → power punches → draw. | Short sessions (≈ 4 min), transparent result. |
| D5 | A disconnect is a **referee time-out**: the clock stops for both; each fighter has a total pause budget = `reconnectSeconds`. | A real-time game can't keep running against an absent player. |
| D6 | Two hall areas: **`hall:fight`** (lobby, sub-hall doors) and **`hall:boxing`** (the 50-ring hall), each its own realtime hall room. The fight itself is a separate `boxing` room per match. | Reuses the stage/area system; future sub-halls are new areas, not a bigger room. |
| D7 | The Fight hall stands on **expansion plots plot-09 + plot-10 merged** (bearing 140°, outer promenade), close to the entry avenue. | The only place a ~95 × 30 m hall fits; very visible on arrival. |
| D8 | The boxing kit is **derived from the ring registry** on every client (`kitFor(sid, rings)`); no avatar state, no look change, never saved. | Broadcast for free, can't desync, can't corrupt the saved look. |
| D9 | **Procedural boxing animation** (IK, on the Rocketbox rig, `world/human/procedural.ts` style), driven by the engine's action + stage + tick. No licensed clips. | Deterministic, matches the frame data exactly, licence-safe (Mixamo can't be bundled; Rocketbox has no boxing clips). |
| D10 | Practice vs AI runs the engine **locally in the browser** in any free ring (ring status `practice`), no stake, never counted. Bots never in live rooms. | Same as the other games; zero server cost. |
| D11 | `boxing` is seeded **disabled** in `game_settings`; the web hall sits behind `NEXT_PUBLIC_FF_FIGHT` (default off until both agents finish). Staff switch Boxing on in the console Games section. | Feature flag + admin switch; nothing user-facing changes today. |

## 1. Vision and player journey

A floodlit sports hall in Musanze: polished concrete, timber, matte black trusses, 50 rings in clean rows, each with
its own number box and status light, two raised feature rings under a four-sided screen. People drift between the
rings, lean on the rails, cheer a knockdown, and step into a ring to fight.

1. **Plaza → Fight hall.** From the plaza you walk the avenue / outer promenade to the Fight Games Hall (plot 140°,
   red-and-charcoal facade, a big glove-and-ring sign, the live count "23 fights on now"). The door opens like the
   other halls (`buildings.fight` open + flag).
2. **Lobby — choose a sub-hall.** A short foyer with four lit portals: **Boxing** (open, live count), **Kickboxing**,
   **Wrestling**, **Karate** (shutters down, "Coming soon"). A status board lists free / fighting rings.
3. **Boxing hall.** You enter at the centre aisle facing the feature rings. Three ways to fight:
   - **Pick a free ring** — walk to any green ring; at its steps the prompt offers *Wait for an opponent* (choose
     Friendly or a stake → ring turns amber, your name on its number box) or *Practice vs AI*.
   - **Take on someone waiting** — at an amber ring: *Fight {name} · {stake} Stars*.
   - **Quick fight** — HUD button: choose a stake, the server pairs you and assigns a free ring; both walk to it
     (route arrows on the floor).
   - **Challenge someone** — the existing People / proposal flow with game Boxing; on accept the server assigns a ring.
4. **Into the ring.** You climb the steps at your corner (red / blue) and slip through the ropes: the **kit goes on**
   (vest + trunks in your corner colour, gloves, boots, headgear; your face, skin and hair stay yours). A short
   gloving-up beat at the corner stool (≈ 1.5 s, both fighters) while the server creates the match (escrow).
5. **Bell.** The camera moves to the fight camera; the referee touches gloves, 3-2-1, *bell*. Three rounds; the rest
   between rounds on the stools; the big screen and the ring's number box show the score.
6. **Result.** "Winner by points 34 – 29" (or stoppage / draw), Stars ± and XP like every game; the referee raises the
   winner's glove. The ring shows the result for 8 s.
7. **Back to your clothes.** You step out through the ropes → the kit comes off on the steps; you are back in your own
   outfit at the ring steps. *Rematch* (same ring, same opponent, both must accept) or walk away.
8. **Leave.** Back through the lobby to the plaza (the return point rules of `apps/web/src/lib/return-point.ts`).

## 2. Boxing game design (skill game)

### 2.1 Model

- Fixed tick `TICK_HZ = 30`. All times are ticks, all values integers (stamina, composure 0..1000; distance in cm).
- The two fighters always face each other. Gameplay is **1-D distance** `dist` (70..360 cm) plus timing; the pair's
  orbit around the ring centre is presentation only (derived deterministically from slips and steps).
- Each action has **windup → active → recovery** ticks. A punch lands only if, during its *active* ticks, the target
  is within reach and not defending it correctly.

### 2.2 Inputs (one-shot presses + a held guard)

| Action | Windup / active / recovery (ticks) | Reach | Stamina | Clean hit | Composure taken |
|---|---|---|---|---|---|
| Jab (lead hand, fast) | 6 / 3 / 7 | 190 | 30 | 1 pt | 40 |
| Cross (rear straight) | 9 / 3 / 11 | 180 | 55 | 2 pts | 80 |
| Hook | 11 / 4 / 13 | 130 | 70 | 3 pts | 120 |
| Uppercut | 12 / 4 / 15 | 110 | 80 | 3 pts | 140 |
| Slip left / right | 10 ticks, evasive ticks 2–7 | — | 25 | — | — |
| Step in / step out | 8 ticks, ±45 cm | — | 15 | — | — |
| Guard (held) | instant up; punches from guard +2 windup ticks | — | drains 2/tick while hit | — | — |

Starting values are in `PUNCH_SPECS` (engine). Agent G tunes them with simulations (§9) — **ranges, not identities**,
may change; the structure may not.

### 2.3 Defence matrix (what beats what)

| Incoming | Guard up | Slip (either side, in its evasive ticks) | Step out (in time, leaves reach) |
|---|---|---|---|
| Jab / Cross (straights) | **blocked**: 0 pts, defender −15 stamina | **evaded** → counter window | evaded if out of reach |
| Hook | **blocked** | **not** evaded (hooks catch a slip) | **evaded** |
| Uppercut | **partly through**: 1 pt, half composure | evaded | evaded |

- **Whiff** (nothing in reach / evaded): the attacker pays `WHIFF_EXTRA` stamina and gets the full recovery → open to a
  counter. Pressing again during recovery is buffered at most `INPUT_BUFFER_TICKS` (6), then dropped.
- **Counter:** a clean hit started within 12 ticks after evading or blocking an opponent's punch → **+1 pt**.
- **Combo:** each clean hit within 18 ticks of the previous clean hit by the same fighter raises `combo` (max 4);
  combo ≥ 3 → +1 pt per hit. Combos are visible ("3-hit combo").
- **Stamina** 0..1000, regenerates +3/tick when not punching, +5 with guard down and idle. Below 300: windups +2
  ticks, composure damage −25 %. Below 100: no hooks / uppercuts (pressed → "Too tired" hint, dropped).
- **Composure** 0..1000, regenerates +1/tick; a clean hit lowers it (table above). At 0 → **knockdown**.

### 2.4 Knockdown (a points event, not an injury)

- The downed fighter takes a knee (a sporty "balance lost" pose, no harm visuals). **+5 pts** to the other fighter.
- Referee count 1..8 (`KNOCKDOWN_COUNT_TICKS` = 8 s): both fighters frozen, the clock **stops**. On 8 the fighter
  rises automatically with composure 600. No button mashing (accessibility, fairness).
- **Stoppage** (TKO-equivalent): 3 knockdowns of the same fighter in one round, or 4 in the match → immediate win
  ("Won by stoppage").

### 2.5 Rounds and clock

- Defaults: `rounds 3`, `roundSeconds 60`, `restSeconds 15`, `idleSeconds 20` (game_settings `fight` block, bounds in
  `FIGHT_RULE_BOUNDS`). Countdown 3 s before round 1 and after every pause.
- Phases: `intro` (waiting for both "ready") → `countdown` → `round` ⇄ `rest` → `over`; `knockdown` and `paused`
  interrupt a round and resume it with the clock where it was.
- Longest match `maxMatchMinutes` = 15 (3 × 60 + 2 × 15 + counts + pause budgets, with room to spare) → void.

### 2.6 Judging (clear and live)

- **Points are the score.** Every clean hit, counter, combo bonus and knockdown adds points; a warning past the first
  subtracts. Both totals are on screen all fight, per round on the scorecard.
- **Decision order:** stoppage → more points → more knockdowns scored → more clean power punches (cross / hook /
  uppercut) → **draw** (stakes returned, exit rules row 2).
- No judges, no hidden 10-point must system, no extra round, **no draw offers** in boxing.

### 2.7 Fouls and inactivity

| Rule | Trigger | Effect |
|---|---|---|
| PASSIVITY | no punch thrown for 15 s in a round while connected | warning; from the 2nd warning of the match: −1 pt each |
| IDLE | no input at all for `idleSeconds` in a round | a timeout strike (exit rules row 9); `maxTimeouts` in a row → forfeit; any input resets |
| Flooding | inputs past `MAX_INPUTS_PER_SECOND` | dropped (never applied), counted for anti-cheat |

Holding, low blows, etc. are impossible by construction (no such inputs).

### 2.8 Controls

| Device | Punches | Defence / movement |
|---|---|---|
| **Phone landscape** | Right thumb: 4 large buttons in an arc — Jab (top-left), Cross (top-right), Hook (bottom-left), Uppercut (bottom-right). A swipe across the right pad also works: tap = jab, swipe right = cross, swipe sideways-down = hook, swipe up = uppercut. | Left thumb: big **Guard** pad (hold; "toggle guard" option), swipe left / right on it = slip, swipe up / down = step in / out. Haptic tick on hit / block. |
| **Desktop** | J jab, K cross, L hook, I uppercut; or mouse LMB jab, RMB cross, Shift+LMB hook, Shift+RMB uppercut | Space (hold) guard; A / D slip; W / S step in / out |
| **Gamepad / TV** | X/□ jab, Y/△ cross, B/○ hook, A/✕ uppercut | LT or RT hold guard; left stick flick left / right slip, up / down step |
| **VR (later)** | punch gestures classified on the client into the same presses | guard = both controllers raised; slips = head move |

All bindings remappable (local setting). Every device sends the same `FightInput` messages: **controls never change
the rules**.

### 2.9 Accessibility and settings

Hold-or-toggle guard, button size (S / M / L), left-handed layout (mirror the pads), reduced motion (no camera shake,
no hit-zoom), colour-blind safe corners (red / blue plus "R" / "B" badges and patterns), captions for the referee and
announcer, no flashing above 3 Hz, sounds / vibration switches (GameSettings). **Game speed / training speed exists
only in practice** (the local engine ticks slower in wall time; rules per tick are identical). Live fights always run
at 30 Hz with the match's rules snapshot.

## 3. Fairness and netcode

### 3.1 Authority

- The `boxing` room (Agent G, `apps/realtime/src/rooms/boxing-room.ts`) owns `FightState` and calls
  `stepFight(state, inputs)` every tick (`setSimulationInterval`, 33.3 ms, drift-corrected by tick count).
- Clients send `FightInput { seq, a?, g }` only. No positions, no hits, no damage ever come from a client.
- Randomness: **none** (`usesRandomness: false`). The practice AI may vary its choices with an rng seeded from
  `@gukirana/fairness` (practice only). `Math.random` stays lint-banned.

### 3.2 Input validation (server)

zod `FightInputSchema`; `seq` strictly increasing per connection (else `STALE_SEQ`); ≤ 20 messages / s (token bucket,
else dropped + `RATE_LIMITED` once per second); at most **one press applied per tick** per fighter; presses outside
`round` are dropped (`NOT_FIGHTING`); presses during an action are buffered ≤ 6 ticks; impossible presses (tired
power punch) are dropped by the engine. Only the two seated fighters' sessions may send inputs.

### 3.3 Prediction and presentation

- Snapshots to fighters at 15 Hz (+ events immediately, batched per tick); spectators get 10 Hz frames relayed by the
  hall room.
- My own press starts its pose at once (`bridge.mine.predicted`); the next snapshot confirms or cancels it. The
  opponent and all meters are shown from server state with a ~100 ms interpolation buffer. Hit flashes / sounds play
  on server `hit` / `block` events only — never on a predicted hit.

### 3.4 Latency

- No rewind / lag compensation: everyone is judged on server time. To keep reactions fair, the fastest punch (jab)
  has a 200 ms windup, so a defender with ≤ 150 ms one-way latency can still react.
- A live fight can't start if a fighter's median ping (hall room `ping`) > `MAX_FIGHT_PING_MS` (300) → `HIGH_LATENCY`
  (practice is always allowed).
- In a fight, no input or pong for 3 s, or RTT > 600 ms for 5 s → treated as a disconnect (pause, §3.5).

### 3.5 Disconnects and exit rules (docs/GAME-EXIT-RULES.md mapping)

| Exit rule row | Boxing meaning |
|---|---|
| "First move" | `hasBegun(state)`: the opening bell rang **and** either fighter sent an input after it. |
| 3, 7, 10 — before the first move | void + refund (incl. leaving during gloving up / countdown, nobody acting within `idleSeconds` after the bell → `NO_FIRST_MOVE`). |
| 4 — Leave after it | forfeit (Leave dialog shows the pot). |
| 5 — disconnect | **referee time-out**: `pauseFight(DISCONNECT, who)` — the clock stops for both, fighters to neutral. Back → 3 s countdown, `resumeFight`. Each fighter's pauses share one budget of `reconnectSeconds` per match. |
| 6 — not back / budget used | forfeit after the first move; void before. |
| 8 — both gone | void. |
| 9 — turn timeouts | IDLE strikes (§2.7). |
| 11, 12, 13–17 | unchanged (no-show `joinSeconds`, `maxMatchMinutes` 15, settle retries, room closed, sweep heartbeat, suspension → void). |
| 18 — practice | nothing to settle, never counted. |

Draw offers: none. Results are Ed25519-signed and settled through the existing games API (`matchResultOf`) exactly
like the other games; stakes, escrow and fees only through the existing paths (`LedgerService.post()`,
`packages/money`). Agent G adds a "Boxing" section to GAME-EXIT-RULES.md with this table.

### 3.6 Settings (game_settings `boxing`)

`enabled` (seeded **false**), `friendlyPerDay`, `stakes`, `reconnectSeconds` (pause budget), `joinSeconds`,
`maxTimeouts` (IDLE strikes), `maxMatchMinutes`, and `fight { rounds, roundSeconds, restSeconds, idleSeconds }`.
`turnSeconds` is unused by boxing. A match copies the rules when created (`rulesOf` now also copies `fight`); a row
without `fight` means `DEFAULT_FIGHT_RULES`.

### 3.7 Anti-cheat

Server authority makes speed / damage hacks impossible. On top: per-fighter stats (reaction time from opponent windup
start to block / slip, press cadence variance). Over ≥ 200 samples, median reaction < 110 ms or near-zero cadence
variance (macro) → a **risk flag** for staff review (existing reports queue), never an automatic ban. Collusion: the
same pair in staked fights more than 5 times a day, or one side never punching → flag. Guests can't fight live.

## 4. World design

### 4.1 Site and building

- **Plots plot-09 (125°) and plot-10 (155°) merge into one Fight hall site at bearing 140°** on the expansion ring
  (`EXPANSION_RING` 108, door on the outer promenade, facing the centre). `EXPANSION_PLOTS` drops those two; the site
  gets a `fight` plot type in `footprints.ts` with its own footprint (T-plan: lobby wing + wide hall).
- Envelope targets (W verifies with the footprint tests, may tune ± a few metres): lobby wing interior ≈ 30 × 10 m;
  Boxing hall interior ≈ **95 × 30 m, 11 m high**, behind the lobby. Constraints: whole footprint inside r ≤ 156 (ring
  road starts at 158 — chamfer the back corners if needed), ≥ 1.5 m from neighbours (plot-08 at 95°), avenue (180°)
  kept clear. If it doesn't fit, shrink the ring pitch to 6.2 m before dropping rings.
- Facade: charcoal render + timber slats, red and blue light lines, a large ring-and-glove sign, the live count on a
  small LED board. Interior matte (no glare): polished-but-matte concrete, timber wall slats, black trusses.

### 4.2 Lobby (`hall:fight`)

Doors in the back wall, left → right `FIGHT_SUBHALLS`: **Boxing** (lit portal, live count, opens), Kickboxing,
Wrestling, Karate (closed shutters with "Coming soon" i18n labels). A status board (ring grid with live colours), two
benches, posters. Room size small (cheap scene). Its hall room is a plain `hall` room with game `fight`.

### 4.3 Boxing hall (`hall:boxing`) — 50 rings

```
                 back wall (lockers / sponsor wall)
  ┌───────────────────────────────────────────────────────────────┐
  │ D  R39 R40 R41 R42 R43 R44   [ big screen ]  R45 R46 R47 R48 R49 R50 │
  │ C  R27 ... R32              [  R1    R2   ]  R33 ... R38      │
  │ B  R15 ... R20              [ feature zone]  R21 ... R26      │
  │ A  R3  ... R8                               R9  ... R14       │
  └──────────────────────── door (from lobby) ────────────────────┘
```

- **R1, R2 feature rings**: centre zone (≈ 14 m wide), raised platform 1.2 m, larger 6.1 m rings, a four-sided screen
  hung above showing the best live fight (or the feature fights), tiered standing rail for ≈ 60 people each.
- **R3–R50 standard rings**: two blocks of 6 columns × 4 rows (A front → D back), numbered row by row from the west
  side: row A = R3–R14, B = R15–R26, C = R27–R38, D = R39–R50 (left block first, then right block).
- Ring: training-gym size — 4.3 m inside the ropes, platform 4.9 m incl. apron, 0.9 m high, 4 ropes, corner pads red /
  blue / white / white, steps at the red and blue corners, two corner stools. Pitch **6.4 m** (1.5 m aisles); the main
  north–south aisles run either side of the feature zone, a 2.6 m cross aisle at the front.
- **Status light** on every ring: a lit band under the apron + the number box above (`RingStatus`: free green, waiting
  amber, starting / fighting red, practice white, result red blink, closed off) + the name(s) and score on the number
  box at close range. Colour plus text — never colour alone.
- **Spectators** stand in the aisles at a ring's low rail; standing within 6 m of a ring and facing it (or tapping
  *Watch*) subscribes to that ring's frames (`boxing-watch`, one ring at a time). A *Watch* camera (rail view /
  overhead) is offered. Cheers / emotes reuse the social emotes.

### 4.4 Lighting and look

Matte everything (roughness ≥ 0.6), no mirror floors. One soft key (hemisphere + a directional for shape), each ring
lit by an **emissive light panel** above it (instanced, no real light per ring) and baked-style contact shadows
under platforms. Feature rings get 2 real spot lights. Fog-free, no bloom on Standard tier.

### 4.5 Performance (Standard tier ≤ 150 draw calls, phones 60 fps)

| Group | Technique | Draw calls |
|---|---|---|
| Hall shell, walls, floor, trusses, signage | static merge (`world/static-merge.tsx`) | ≈ 10 |
| 50 rings: platform, apron skirt, canvas, posts + turnbuckles, ropes (800 rope segments), steps, stools, corner pads | one `InstancedMesh` per part, instance colours for pads / lights | ≈ 10 |
| Status bands + number boxes + light panels | instanced, label atlas (`world/label-atlas.ts`), 1 Hz texture refresh | ≈ 3 |
| Big screen | 1 CanvasTexture, 10 Hz | 1–2 |
| People | full `Avatar` only for the 12 nearest (+ the fighters of the watched ring); beyond 12 m the existing simplified LOD; beyond 30 m fighters of far rings as **two-pose impostors** animated from the 1 Hz ring summary (sparring loop) | ≤ 100 |

Culling: rings beyond the view frustum skip their per-frame work; far rings never animate fighters at full rate.
Budgets are checked with the existing frame meter (qa/e2e world-lib `installFrameMeter`) on a phone profile.

### 4.6 How it fits the hall system

- `HallGame` (web `rooms/layouts.ts`) gains `fight` and `boxing`: each a `HallLayout` (size, door, spawn, colliders,
  aisles, `walls`), with `hallHooks.boxing` for the ring platforms (`walkable`, `ground` on the ring canvas, route via
  the steps) and the fight camera / frozen walking (`frozen` while fighting).
- Stage areas `hall:fight` and `hall:boxing` (`world/stage.ts`, persistent canvas). The plaza → lobby crossing uses
  `plazaToHall`; **lobby → boxing hall is the first hall → hall crossing** — W adds a door-frame mapping like
  `plazaToHall` (same "camera past the door line" switch).
- Realtime: two `hall` rooms (`filterBy game`): `fight` (plain) and `boxing` (with the `BoxingHall` plugin, like
  `ArenaHall` in `world-room.ts`). Capacity `BOXING_HALL_CAPACITY` 160 (100 fighters + 60 spectators) with world-move
  **area of interest** `BOXING_AOI_RADIUS` 24 m (fighters inside a ring send no world moves — their pose comes from the
  fight). A full instance opens a second one ("Boxing Hall 2"): **rings belong to the hall instance** (ring keys are
  `roomId:R7`).
- Fight room `boxing`: 2 fighters (+ their second tabs), no spectators connect to it; it pushes 10 Hz spectator frames
  to its hall room (in-process registry like `live` in `match-room.ts`; Colyseus presence when sharded).

## 5. Outfit change (boxing kit)

- `BoxingKit` (contracts): corner-colour **vest** and **trunks** with a white waistband, **gloves**, black **boxing
  boots**, **headgear** (default on; amateur style, respectful for every body type). Skin, face, body, hair kept;
  hair goes under the headgear (the existing `hairHatClass` / headwear fit path).
- **Who wears it:** every client computes `kitFor(sid, rings)` from the ring registry: a fighter wears the kit while
  they hold a ring (`waiting` … `result`, and `practice`) **and** stand inside the ring bounds or on its steps. Leaving
  the ring area → own clothes. Nothing is sent, nothing is saved, the look code is untouched.
- **How:** the assets agent (P3-FGT-02) provides `boxingKitOverride(look, corner)` (temporary look + fitted gloves,
  headgear, boots, trunks). W adds an optional `kit?: BoxingKit | null` prop to `Avatar` that renders
  `boxingKitOverride(look, kit.corner)` instead of `look` (cached per (look, corner): one material rebuild per swap).
- **The change moment:** on the ring steps, a 0.4 s cloth-shimmer cross-fade (realistic but quick); in practice the
  gloving-up beat on the stool. A locker-room walk is deferred.

## 6. Animation

**Procedural, IK-driven** on the Rocketbox rig (recommended and decided, D9), built by the assets agent in
`apps/web/src/world/human/boxing/*`. Integration: W renders every fighter with `clipFor(view, phase)` at
`actT / TICK_HZ` seconds (my own fighter: `bridge.mine.predicted` first), blends `HIT_REACTION[punch]` on the target of
each `hit` event, and places the pair from `dist` / `orbit`. G only produces the snapshot + events. What the motions
must look like:

- **Guard stance:** fists at the chin, elbows in, knees bent, a light bounce (2 Hz) and weight shift; guard-down
  variant (hands lower) for tired / resting.
- **Punches:** two-bone arm IK from the shoulder to a target on the opponent (head height) following the engine's
  stage curve: windup (load the hip / shoulder), active (extend, torso rotation: jab small, cross full hip turn, hook
  horizontal arc, uppercut rising arc with knee drive), recovery (return to guard). Exact tick timing comes from
  `act` / `actT` / `stage` in the snapshot — the pose is a pure function of them (deterministic, identical for every
  viewer).
- **Defence and footwork:** slip = spine side-bend + head offset; block = forearms tighten, small recoil on
  `blockHit`; step in / out = foot plant IK on the canvas; orbit = small lateral steps.
- **Reactions:** `staggered` (head turns away, half step back — no impact gore), `down` (one knee, glove on canvas),
  `rising`, `celebrate` (arms up), `dejected` (head down, nod to opponent), glove touch at the intro.
- Base locomotion (walking to the ring) keeps the existing Rocketbox clips. Nothing new goes into ASSET-LICENSES.md
  unless a clip is added later (licence must explicitly allow bundling).

## 7. Validation and controls

### 7.1 Server checks (realtime first, API decides money)

| Action | Checks (denial code) |
|---|---|
| Enter Boxing hall | building `fight` open (else door shut), flag on, instance not full (`HALL_FULL`) |
| Claim / practice | known ring (`UNKNOWN_RING`), ring `free` (`RING_TAKEN` / `RING_CLOSED`), within `RING_REACH_M` of its steps (`TOO_FAR`), one ring per person (`ALREADY_IN_RING`), not in a live match (`ALREADY_IN_MATCH`), rate limit (`RATE_LIMITED`) |
| Claim for a live fight / join / quick | the above + signed in (`SIGN_IN_REQUIRED`), game enabled (`GAME_DISABLED`), stake allowed (`STAKE_NOT_ALLOWED`), funds / friendly limit / break / daily limit (games API eligibility, personal reasons only to that player), ping (`HIGH_LATENCY`), join: not your own ring (`OWN_RING`), stake matches (`STAKE_MISMATCH`) |
| Match creation | API `createMatch` re-validates both players and locks both stakes in escrow before the bell; failure → both told, ring back to `waiting` / `free` |
| Fight inputs | §3.2 |
| Leave the ring | waiting / practice: free at once; in a fight: the Leave dialog (void / forfeit per §3.5); after the result: free |

### 7.2 UI states (ring prompt)

`free` → *Wait for an opponent* (stake chips, Friendly) · *Practice vs AI* (level 1–5) · `waiting (mine)` → *Waiting
for an opponent… Cancel* · `waiting (other)` → *Fight {name} · {stake}* (disabled with the reason when not allowed) ·
`starting` → *Gloving up…* · `fighting` → *Watch* · `practice` → *Watch* · `result` → result card · `closed` → "Ring
closed". Every string an i18n key; reasons use the existing `reasonText` wording.

### 7.3 Admin

- Console **Games** section already lists every `GAME_IDS` game: Boxing appears (disabled) automatically. Agent G adds
  the `fight` fields (rounds, round / rest seconds, idle seconds) to the editor; same audit trail.
- Console **Buildings**: `fight` open / close switch (seeded open; the web flag keeps it hidden until launch).
- Later (deferred): close single rings, feature a fight on the big screen.

## 8. Ownership (no shared files)

| Area | Agent W | Agent G |
|---|---|---|
| Web 3D | `apps/web/src/fight/**` except `bridge.ts`, `game/` · `rooms/layouts.ts` (+ test), `rooms/RoomScene.tsx`, `rooms/hall-hooks.ts` registration, `rooms/preload.ts` · `world/layout.ts`, `footprints.ts` (+ tests), `District.ts`, `buildings.ts`, `beds.ts`, `stage.ts`, `lib/world-store.ts` (PortalId) · `world/Avatar.tsx` (the `kit` prop + boxing clip hook-up) · fight camera | — |
| Assets (P3-FGT-02 only) | **never edit** `world/human/boxing/**`, `rooms/fight/ring-kit*` | **never edit** them |
| Web game | — | `apps/web/src/fight/game/**` (boxing client, fight HUD + controls overlay, practice loop, i18n strings), `apps/web/src/lib/match-store.ts`, `match/**` (Boxing in Matchmaking / proposals / result), `games/GameSettings.tsx` / `GameShell.tsx` only if reused, `console/**` Games editor fight fields |
| Shared web seam | `fight/bridge.ts`: W reads; writes only `mock` (W's `fight/mock.ts`) | `fight/bridge.ts`: G writes |
| Engine | — | `packages/games/boxing/**` |
| Realtime | — | `apps/realtime/**` (`rooms/boxing-hall.ts`, `rooms/boxing-room.ts`, `world-room.ts` hooks + AOI, `matchmaking.ts`, `index.ts`) |
| API / admin app | — | `apps/api/src/modules/games/**` (fight rules bounds use, boxing in offer), `apps/admin/**` games page |
| Docs | `docs/FIGHT-GAMES-PLAN.md` §4–6 notes | `docs/GAME-EXIT-RULES.md` Boxing section, this plan §2–3 notes |
| Contracts | additive only, announce in the PR | additive only, announce in the PR |

Contract changes after today: **additive only**; whoever needs one adds it in their PR and notes it in this file
(§13 change log). Neither agent edits the other's files; the bridge is the only shared runtime seam.

## 9. Milestones, tests, speed plan

### Milestones

| # | Agent W | Agent G |
|---|---|---|
| M1 (day 1) | Site + building on the plaza, lobby area with 4 doors, crossing plaza → lobby → boxing hall; flag `NEXT_PUBLIC_FF_FIGHT` | Engine combat complete (punches, defence, stamina, composure, knockdown, stoppage, fouls) + property tests + bot levels 1–5 |
| M2 | 50 rings placed with the assets agent's ring kit, numbering, status lights from the bridge (mock), feature rings + big screen | `BoxingHall` plugin: registry, claim / join / leave / quick / practice / watch, denials, AOI, ring frames relay |
| M3 | Kit swap at the ring (`boxingKitOverride` via the `Avatar` `kit` prop); fighters animated with the motion library through `clipFor` | `boxing` room: tick loop, inputs, pauses, exit rules, escrow via API, signed settle, heartbeat; Exit rules doc |
| M4 | Spectator watch camera, fight camera, ring prompts (UI states 7.2), performance pass (draw calls, phone fps), screenshots | Web: boxing client into the bridge, HUD (scores, clock, meters, round cards, result), controls for touch / keys / pad, practice in a ring, console fight fields, Matchmaking entry |
| M5 | Joint: W switches from mock to G's client; one end-to-end friendly fight between two browsers; flag on in the isolated stack | (same) |

### Tests (keep them lean)

- **Engine** (G): unit tests for each defence-matrix cell, knockdown / stoppage, decision order, pauses, forfeit /
  void; **property tests**: 10k random-input fights (seeded test rng) always terminate within the tick bound, points
  ≥ 0, stamina / composure in range, determinism (same inputs → same hash), symmetry (mirrored inputs → mirrored
  result); bot level n+1 beats level n ≥ 60 % over 500 fights. No 1M sims at this stage (P3 follow-up before money).
- **Realtime** (G): boxing-hall registry (claim races, one ring per person, reach, leave), boxing-room (tick, input
  validation, rate limit, pause budget, each exit-rules row with fake API) — follow `exit-rules.test.ts`.
- **Web** (W): layout tests (ring count = `BOXING_RING_COUNT`, ids = `RING_IDS`, no overlaps, aisles walkable,
  footprint inside the site, campus tests stay green), `kitFor` / `kitLook` unit test (saved look unchanged), 4
  screenshots (plaza view of the building, lobby, boxing hall wide, a fight close-up) + a frame-meter number.
- **Contracts**: compile-time only (+ the engine stub tests already here).

### Speed plan

- **Reuse:** hall areas + RoomPlayer + hall hooks (arena precedent), `ArenaHall` plugin pattern, `match-room.ts` exit
  paths / settle / heartbeat / signing (copy the structure, swap the turn clock for the tick loop), games API escrow
  and `game_settings` (no API changes needed for money), StakeChips / reasonText, social emotes, label atlas, static
  merge, Avatar LOD.
- **Stub / mock:** W builds against `fight/mock.ts` (scripted rings + a looping fake snapshot) — no realtime needed;
  G builds the HUD against the local practice engine first, then the live room.
- **Defer:** VR gestures, locker room, kickboxing / wrestling / karate interiors, ring closing by staff, featured-fight
  director, replays, 1M-fight sim, spectator betting (never — not in scope).

## 10. User decisions (accepted 2026-11-14)

The user accepted the recommended answers:

1. **Site:** expansion plots 09 + 10 merged at 140° for a ≈ 95 × 30 m hall (D7).
2. **Headgear:** on by default.
3. **Round format:** 3 × 60 s with 15 s rest (admin-editable within the bounds).
4. **Stakes at launch:** the same defaults as the other games (25 / 50 / 100 / 200); Boxing stays seeded disabled.
5. **Guests** may practise vs AI in free rings; live fights need an account (money rules).

## 11. Agent W brief (world)

**Goal.** Build the Fight Games hall on the plaza, its lobby with the four sub-hall doors (Boxing open, the others
"Coming soon"), the Boxing sub-hall with 50 rings, the boxing kit change, spectators, ring prompts, the fight camera
and the procedural boxing poses — fast on phones. Task P3-FGT-01 (world part). Read `CLAUDE.md`, then this plan §1,
§4–§9, `docs/DESIGN-SPEC-3D-VR.md` (halls), `docs/UI-DESIGN-SYSTEM.md`, and the arena precedent
(`apps/web/src/arena/**`, `rooms/TournamentArena.tsx`, `rooms/hall-hooks.ts`).

**You own** (no one else edits them): `apps/web/src/fight/**` except `fight/bridge.ts` and `fight/game/**`;
`apps/web/src/rooms/layouts.ts` (+ test), `RoomScene.tsx`, `preload.ts`, the `hallHooks` registration for `fight` /
`boxing`; `apps/web/src/world/layout.ts`, `footprints.ts` (+ tests), `District.ts`, `buildings.ts`, `beds.ts`,
`stage.ts`, `apps/web/src/lib/world-store.ts`; `apps/web/src/world/Avatar.tsx` (the `kit` prop, boxing clip
hook-up). Don't touch `apps/realtime`, `apps/api`, `packages/games`, `apps/web/src/fight/game/**`, `match/**`,
`console/**`, and **never** the assets agent's `apps/web/src/world/human/boxing/**` or
`apps/web/src/rooms/fight/ring-kit*` (P3-FGT-02) — you integrate them: the ring kit component (rings from an array of
transforms + status), `boxingKitOverride(look, corner)`, `boxingPose` / clips via contracts `clipFor`,
`HIT_REACTION`, `BOXING_CLIPS`. If they are not there yet, code against those names with a placeholder inside
`apps/web/src/fight/` and swap it at integration.

**Contracts to use:** `@gukirana/contracts` boxing.ts (`RING_IDS`, `FEATURE_RINGS`, `RingState`, `RingStatus`,
`FIGHT_SUBHALLS`, `BoxingKit`, `boxingKit`, `kitFor`, `BoxingSnapshot`, `FighterAct`, `ActStage`, `CORNER_COLORS`,
`RING_REACH_M`, `BoxingHallMsg` names for the prompts); `HALL_SEATING.fight/boxing`; `apps/web/src/fight/bridge.ts`
(read `rings`, `watched`, `mine`, `drainMyEvents()`; write only `mock`).

**Do:**
1. Flag `apps/web/src/fight/flags.ts`: `FIGHT_ON = process.env.NEXT_PUBLIC_FF_FIGHT === "1"` (default **off**; door
   locked like the arena when off).
2. Site: merge plots 09 + 10 into the Fight hall plot at 140° (§4.1), new footprint, District geometry (facade, sign,
   live-count board), campus tests green.
3. Areas `hall:fight` (lobby, §4.2) and `hall:boxing` (§4.3) with `HallLayout`s, hall hooks (ring platforms walkable
   only via steps; `frozen` while `bridge.mine` is fighting), plaza → lobby → boxing crossings (new hall → hall door
   mapping), route `/room/fight`, `/room/boxing`.
4. 50 rings placed with the assets' ring kit (§4.5: you supply the transforms of `RING_IDS` + status from
   `bridge.rings`), number boxes, feature rings R1/R2 with the big screen.
5. `fight/mock.ts`: fills the bridge (a dozen rings in each status, two looping fake fights with scripted snapshots)
   behind `?fightmock=1` — your test bed until G's client lands.
6. Kit: `Avatar` `kit` prop rendering `boxingKitOverride(look, corner)`; applied via `kitFor` while inside the ring
   bounds / steps; 0.4 s swap shimmer. Saved look never changes (unit test on your wiring).
7. Fighters: clip = `clipFor(view, phase)` at `actT / TICK_HZ` (me: `predicted` first), `HIT_REACTION` on `hit`
   events, placed in the ring from `dist` / `orbit`; far-ring impostor loop.
8. Ring prompts (UI states §7.2, prompts call a `fightActions` interface that G implements; mock logs them), watch
   camera, fight camera.
9. Performance pass: ≤ 150 draw calls Standard tier in the boxing hall, 60 fps phone profile.

**UI rules:** PaperCard / `paper.css` for cards and sheets; **all buttons chocolate (no blue)**, success green /
danger red; dark theme near-black glass with white text; lucide icons; no emojis; every string an i18n key (English
source in `fight/strings.ts`, same pattern as `arena/strings.ts`). Ring corner red / blue are 3D colours only.

**Rules:** no money code, no `Math.random` in anything game-related (use deterministic hashes for visual variety),
ESM, one task per PR, conventional commits `feat(fight): … [P3-FGT-01]` ending with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; don't push.

**Ports / env:** web only on **:3402** (`pnpm --filter @gukirana/web exec next dev --port 3402`, env
`NEXT_PUBLIC_FF_FIGHT=1`); use the mock for ring data. Never start, stop or restart :3200, :4200, :2567, :3201 or any
other project's ports.

**Acceptance:** building visible on the plaza and enterable with the flag; lobby with 1 open + 3 "coming soon" doors;
boxing hall with exactly 50 rings R1..R50, correct numbering, live status colours from the bridge; kit on in the ring,
off outside, saved look unchanged; spectators can watch a mock fight with boxing poses; ≤ 150 draw calls and 60 fps on
the phone profile (frame-meter number in the PR); 4 screenshots; `pnpm verify` green (real output in the report).

**Tests (lean):** layout / footprint tests, kit wiring test (saved look unchanged), 4 screenshots. No new e2e
suites; the motion / kit / ring-kit tests belong to the assets agent.

## 12. Agent G brief (game)

**Goal.** Make Boxing playable: the engine's combat, the practice AI, the fight HUD + controls, the ring registry in
the Boxing hall room, the authoritative `boxing` fight room with escrowed live PvP through the games API, exit rules,
game_settings, anti-cheat validation. Task P3-FGT-01 (game part). Read `CLAUDE.md`, this plan §2, §3, §7–§9,
`docs/GAME-EXIT-RULES.md`, `apps/realtime/src/rooms/match-room.ts` + `arena-hall.ts` + `world-room.ts`,
`apps/api/src/modules/games/**`, `packages/games/igisoro` (package shape).

**You own:** `packages/games/boxing/**`; `apps/realtime/**`; `apps/api/src/modules/games/**`; `apps/admin/**` (games
page); `apps/web/src/fight/game/**`; `apps/web/src/lib/match-store.ts`, `apps/web/src/match/**`,
`apps/web/src/console/**` (Games editor fight fields); `apps/web/src/fight/bridge.ts` (you write it; keep its shape,
add fields only); `docs/GAME-EXIT-RULES.md` (Boxing section). Don't touch the world / avatar files listed for W, nor
the assets agent's `world/human/boxing/**` / `rooms/fight/ring-kit*`. Your link to the motion library is only the
data: the engine's `FighterView.act` / `actT` / `stage` and the events must be enough for contracts `clipFor` and
`HIT_REACTION` (if you add an engine action, add its `ACT_CLIP` entry in the same PR).

**Contracts to use:** boxing.ts (everything: inputs, snapshot, events, outcome, rules, messages, denials, capacity
constants), games.ts (`GAME_IDS` incl. `boxing`, `GameSettings.fight`, `MatchRules.fight`, `rulesOf`,
`MatchRefusal`), `@gukirana/boxing` (`createFight`, `beginFight`, `stepFight`, `pauseFight`, `resumeFight`,
`forfeitFight`, `voidFight`, `hasBegun`, `matchResultOf`, `snapshotOf`, `hashFight`, `boxingBotInput`).

**Do:**
1. Engine: implement combat per §2 in `stepFight` (keep it pure, integer, no randomness), fouls, knockdown count,
   stoppage, orbit; tune `PUNCH_SPECS` with simulations; bot levels 1–5 (reaction delay by level, reads windups,
   stamina management; rng injected, practice seeds it from `@gukirana/fairness`).
2. Realtime `BoxingHall` plugin (`rooms/boxing-hall.ts`, wired into `world-room.ts` for hall game `boxing` like
   `ArenaHall`): registry of `RingState`, `BoxingHallMsg` handlers with every check of §7.1, `boxing-rings` /
   `boxing-ring` / `boxing-denied` / `boxing-assigned` / `boxing-fight-ready`, quick fight queue per stake, the
   proposal flow for game boxing → ring assignment, spectator frame relay (`boxing-watch`, ≤ `RING_WATCHERS_MAX`),
   world-move AOI (`BOXING_AOI_RADIUS`), `maxClients = BOXING_HALL_CAPACITY` for this hall.
3. `boxing` room (`rooms/boxing-room.ts`, `gameServer.define("boxing", …)`): tick loop at `TICK_HZ`, `FightInput`
   validation (§3.2), snapshots at `FIGHTER_SNAPSHOT_HZ`, events, ping / pong, pause budget, every exit-rules row
   (§3.5), match creation through `api.createMatch` with game `boxing` (escrow before the bell), signed settle /
   void / heartbeat as in `match-room.ts`, ring status back to the hall.
4. API: nothing for money; make sure `boxing` offers / settings work (fight block bounds via `FightRulesSchema`, a row
   without `fight` → `DEFAULT_FIGHT_RULES`). Console + back-office Games editors show the fight fields.
5. Web `fight/game/**`: hall-room client writing the bridge; `fightActions` (claim, join, leave, quick, practice,
   watch) used by W's prompts; fight HUD (both names, corner badges, points, round + clock, stamina + composure bars,
   round cards, knockdown count, warnings, result card with Stars / XP, Leave dialog per exit rules); controls for
   touch (§2.8 layout), keyboard / mouse, gamepad; local practice loop (engine in the browser at 30 Hz, training speed
   option practice-only); the prediction field `bridge.mine.predicted`; GameSettings (sounds, vibration, guard
   toggle, button size, left-handed, reduced motion).
6. Boxing in Matchmaking / proposals / match result screens (`match-store.ts` GameId, labels).

**UI rules:** PaperCard / `paper.css`; **all buttons chocolate (no blue)**, success green / danger red; dark theme
near-black glass, white text; lucide icons; no emojis; every string an i18n key (`fight/game/strings.ts`). Fight HUD
large-touch, readable at arm's length on a phone.

**Money / fairness rules:** integers only (`Coins`), only `LedgerService.post()` changes balances (you shouldn't need
to touch it — the games API escrow does), idempotency keys, fees only from `packages/money`; server-authoritative;
**no randomness in the live fight**; practice rng only from `@gukirana/fairness`; no `Math.random`; **no bots in
live / staked rooms**; guests practice only.

**Ports / env (isolated stack, never the user's):** API **:4404**, realtime **:2704**, web **:3604**, admin **:3605**,
scratch PGlite + QA seed:
```
export DATABASE_URL=pglite://$SCRATCH/pglite API_PORT=4404 REALTIME_PORT=2704 API_INTERNAL_URL=http://127.0.0.1:4404
pnpm --filter @gukirana/api seed:qa            # once, same env
pnpm --filter @gukirana/api dev &  pnpm --filter @gukirana/realtime dev &
API_URL=http://127.0.0.1:4404 NEXT_PUBLIC_REALTIME_URL=ws://127.0.0.1:2704 NEXT_PUBLIC_FF_FIGHT=1 pnpm --filter @gukirana/web exec next dev --port 3604
API_URL=http://127.0.0.1:4404 pnpm --filter @gukirana/admin exec next dev --port 3605
```
Enable boxing in the console Games section of that stack. Never start, stop or restart :3200, :4200, :2567, :3201.

**Acceptance:** engine tests + property tests green; two browsers on :3604 fight a friendly and a staked fight in
the Boxing hall end to end (escrow → bell → 3 rounds → signed settle → Stars moved by the API); every exit-rules row
covered by realtime tests; inputs validated and rate-limited; practice vs AI levels 1–5 in a ring; HUD and controls
work on phone landscape, keyboard and gamepad; console edits of the fight block apply to new matches only;
`pnpm verify` green (real output in the report).

**Tests (lean):** as §9 — engine unit + property, boxing-hall + boxing-room realtime tests following
`exit-rules.test.ts`; one HUD component test at most. Keep test time small (no 1M sims yet).

## 13. Contract change log

- 2026-11-14 P3-FGT-01 plan: boxing.ts created; `GAME_IDS` + `boxing` (seeded disabled), `GameSettings.fight`,
  `MatchRules.fight`; `HALL_SEATING.fight/boxing`; building `fight`; `@gukirana/boxing` skeleton;
  `apps/web/src/fight/bridge.ts`.
- 2026-11-14 motion seam for the assets agent (P3-FGT-02): `BOXING_CLIPS`, `ACT_CLIP`, `HIT_REACTION`, `clipFor`.

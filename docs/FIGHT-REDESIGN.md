# Boxing fight redesign (P3-FGT-05)

Goal: a focused, readable, realistic boxing fight whose controls work on every device. Scoring and fouls are
P3-FGT-06 (separate); hall dressing is P3-FGT-04. This file records the research, the decisions and what was built.

## 1. Research (inspiration only — no names, art, UI or music copied)

| Source | What we took |
|---|---|
| VR boxing: [The Thrill of the Fight (wiki)](https://vrarwiki.com/wiki/The_Thrill_of_the_Fight), [UploadVR on TotF 2 as a spectator event](https://uploadvr.com/the-thrill-of-the-fight-2-turned-vr-boxing-into-a-live-spectator-event), [TechRadar TotF 2 preview](https://www.techradar.com/gaming/the-thrill-of-the-fight-2-vr-gaming-preview) | Realism comes from the body: fatigue you can *see* (dropped hands, mouth breathing) beats a bar alone; power must be visible in the reaction; the spectator view matters. |
| [Creed: Rise to Glory — Unreal spotlight](https://www.unrealengine.com/spotlights/how-survios-creed-rise-to-glory-revolutionizes-vr-melee-combat) | Stamina pushes players to block and pick punches; hits must read as weighty without injury visuals. |
| [Fight Night Champion controls tutorial (EA)](https://ea.com/news/controls-tutorial), [Wikipedia](https://en.wikipedia.com/wiki/Fight_Night_Champion) | Two schemes side by side (face buttons *and* directional strokes); 8-way right-stick flicks were found error-prone → we keep few, clear directions. Cinematic but grounded camera. |
| [Undisputed GDC interview (PC Gamer)](https://www.pcgamer.com/undisputed-boxing-game-interview-GDC), [Digital Trends](https://www.digitaltrends.com/gaming/undisputed-is-by-and-for-boxing-fans/), [review: movement can feel slow](https://www.godisageek.com/reviews/undisputed-review) | Weight transfer is part of the punch (load → extend → recover); but responsiveness must never be sacrificed → the motion is *time-warped to the engine* so the glove lands exactly on the engine's active window. |
| Mobile: [Election Year Knockout deep dive (Game Developer)](https://gamedeveloper.com/business/reworking-punch-out-for-mobile-an-extremely-deep-dive-into-election-year-knockout), [Prizefighters review](https://www.pocketgamer.com/articles/076286/prizefighters-review-an-entertaining-punch-out-inspired-brawler/), [Touch KO](https://www.appspy.com/touch-ko/review/), [touch input patterns](https://cursa.app/en/page/touch-controls-for-mobile-games-input-patterns-and-feedback) | Virtual buttons need large targets because fingers can't feel them; whole-zone input (not tiny buttons) for the thumbs; tap = fast punch, flick = power punch; classify a swipe on release with a distance OR velocity threshold; ≤ 4–5 directions; instant feedback or it "feels slow to register". |
| Game feel: [Lin et al. 2022, impact feedback](https://arxiv.org/abs/2208.06155), [hit stop / shake primer](https://uhiyama-lab.com/en/notes/unity/unity-game-feel-hit-feedback/) | Impact = sound coherence + camera + timing; shake only for big moments, scaled to importance, with a reduce-motion switch. |
| Amateur rules / broadcast: [standing / mandatory eight count](https://en.wikipedia.com/wiki/Mandatory_8_count), [Ontario amateur boxing rules](https://www.ontario.ca/document/amateur-combative-sport-rules-boxing/part-iv-competition-requirements) | Referee counts over the downed boxer, the other goes to a neutral corner; referee breaks clinches; bell to start, three bells / "time" to end; corner work on the stool; winner's hand raised by the referee. Broadcast side camera square to the pair, corner shots between rounds. |

## 2. Decisions

1. **Focus mode** (fight/focus.ts + FocusMode.tsx). Fade first, cull second: a near-black fog measured from the
   camera (starting just past the ring) plus the background eased to the same colour sinks the hall in ~0.9 s; only
   when it is fully dark are far objects culled and the ring-kit fields reduced to my ring; leaving un-culls on the
   first frame (still dark) and then lifts the fog (0.7 s). A spot pool over the ring (always mounted, intensity 0, so
   no shader rebuild). Spectators with a watch camera get a lighter dim (no culling). The hall HUD hides; only the
   fight HUD remains. The gym (P3-FGT-04 `useGymScene`) hides with it.
2. **Camera owns the pose** (camera.tsx). Root cause of "not focused": the old fight camera lerped 6 %/frame towards the
   ring while the follow camera lerped back every frame — the shot was never reached. Now the follow pose is the blend
   source and the shot is blended over it by an eased weight. Shots: broadcast 3/4 (my back three-quarter on, the
   opponent's face to camera), my corner during the rest, a low angle on the downed fighter, the winner close-up.
   Shake only on power punches worth 3+, counters and knockdowns; reduced motion (setting or OS) disables it.
3. **Engine-timed motion** (present.ts, fighter-avatar.tsx). Each engine act picks a motion-library clip and the clip is
   time-warped so its impact = the engine's first active tick. Hit reactions scale with power (jab 0.45, cross 0.75,
   hook / uppercut 1.0; partial uppercut 0.35; a low balance staggers). Ceremony: touch gloves, walk to the corner and
   sit on the stool, knee + referee count, neutral corner, get up, winner's raised hand, loser's nod; clinch tie-ups
   broken by the referee. Faces: focus / effort (clips) + moods: wince, fatigue breathing, dazed, relief, joy,
   disappointment. No blood, no injuries (D3). Adults only.
4. **Controls** (input-map.ts — pure and tested — controls.ts, TouchPads.tsx). One mapping per device, all into the same
   `fightInput.press / guard`; keys rebindable; first-fight tutorial; haptics (phone vibration + gamepad rumble).
5. **Feedback for every press**: the predicted pose starts at once; a press chip shows the action, then *confirmed*
   (engine shows the act), *queued* (buffered during an action) or *dropped* (with the reason, e.g. "Wait for the
   bell").
6. **Sound** (audio.ts): synthesized, deterministic variation (by tick), no beeps: punch thumps by power, glove slap on
   blocks, whoosh on whiffs, a struck-metal bell (1 ring to box, 3 to end), a crowd bed that swells on big hits and
   "oohs" on knockdowns, referee count / calls and corner advice by speech synthesis with captions always on.
7. **Replay highlights** (replay.ts): big moments keep 2 s before + 1 s after of snapshots; the result card replays them
   at half speed through the same renderer.

## 3. Control scheme

| Device | Punches | Defence / movement |
|---|---|---|
| Phone (landscape) | Right thumb zone: four 92 px buttons (fire on touch-down) or strokes anywhere in the zone: tap = jab, swipe ↑ uppercut, across (inward) hook, out cross, ↓ body hook | Left thumb zone (42 % of the width, floating pad under the thumb): hold = guard (or tap-toggle), swipe ← / → slip, ↑ / ↓ step in / out |
| Desktop | J jab · K cross · L hook · I uppercut; mouse left jab, right cross, Shift + left hook, Shift + right uppercut, middle hook | Space hold guard; A / D or ← / → slip; W / S or ↑ / ↓ step |
| Gamepad (standard) | X jab · Y cross · B hook · A uppercut · RB jab | LT / RT / LB hold guard; left stick flick or D-pad slip / step |
| VR | not in this task (WebXR hands would map gestures into the same presses) | — |

## 4. Root causes of "the controls don't work"

1. **The camera never reached the fight** (two damped cameras fighting): presses worked, but you could not see your
   fighter, so nothing seemed to happen.
2. **The hall HUD stayed on top of the fight**: the joystick sat under the guard pad, the hall's action buttons under the
   punch pad, chat / quick match / emotes over the scoreboard; the chat field could hold the keyboard focus.
3. **Key handlers raced**: fight keys were bubble-phase listeners, so the hall's walk / turn handlers saw W / A / S / D
   too; now the fight listens in the capture phase and consumes its keys; a focused text field is blurred on entry.
4. **Presses outside a round vanished silently** (countdown, rest): now the press chip says "Wait for the bell".
5. Testing note: the dev hook `__gkStage.show("hall:boxing")` from /world does not mount the hall HUD (the room page
   does); test from `/room/boxing`.

## 5. Ring realism (P3-FGT-07)

Complaint: "it looks like a person is doing nothing". Two boxers stood ~3 m apart in a near-static guard, in their
plaza clothes (hoodie / blazer, skin-coloured baggy trousers under the trunks, oversized boot blocks), and the referee
stood at the back with his hands clasped.

### Research takeaways (ideas only — no names, assets or looks copied)

- **Console boxing sims** (the long-running sim series, the recent licensed sim): the boxer is never still — a rhythm
  bounce, weight transfer and head movement run under everything; punches carry the body (hips, rear heel); critics
  of the newest sim single out *missing weight transfer* and *floaty footwork* as what breaks realism, and praise
  footwork with plant / pivot steps. Takeaway: an always-on procedural layer under the clips, punches that commit the
  body, and visible foot plants when moving.
- **VR boxing titles**: the opponent constantly paws, feints and resets range; it targets openings and punishes
  whiffs; hits read through a short freeze + head snap. Takeaway: lead-hand pawing / feints in idle, a few frames of
  hit-stop, head snap scaled to power.
- **Fighting-game feel** (genre convention): hit-stop of 2–6 frames on connection, a small camera punch, an impact
  sound and crowd swell sell power without changing timing. Takeaway: presentation-only hit-stop that catches up, so
  the engine and the screen never drift.
- **Amateur boxing footage / referee manuals**: boxers work at about an arm plus a step apart (jab range), circle,
  cut off the ring, get pushed to ropes and corners; tired boxers drop their hands, flatten their feet and clinch.
  Referees keep a "V" with both boxers in view, never behind one or between them, move constantly with hands down
  and open, step in at arm's length to break, and wear a white shirt, bow tie and dark trousers. Amateur rules: vest
  in the corner colour, headgear on.

### Decisions

- **Real exchange range** (`present.ts gapOf`): the engine's distance (game cm, reaches 110–190) maps piecewise onto
  the canvas so a jab at its engine reach lands at ~1 m root to root, hooks / uppercuts inside that, the far end ~2 m.
  Before: `dist / 100` m (2.6 m at the start, never closer than ~1.4 m in practice). Engine constants unchanged.
- **Reach fit** (`motion.ts`): the striking glove's travel is scaled to the real distance to the target (0.7–1.25×),
  so a landed punch touches the chin / body instead of stopping short or sinking in; a reach past the clip's own (a
  whiff) also carries the body after it (more lean, hips forward, rear heel up): misses over-extend.
- **Ring life** (`world/human/boxing/life.ts`): an additive layer over the stance / footwork / held-guard clips — a
  bounce on the balls of the feet (1.4–2.1 Hz, flatter when tired), front-back and side-to-side weight shifts, upper
  body slipping off the centre line, gloves breathing, the lead glove pawing and an occasional feint (shoulder dip +
  half jab), the rear glove circling, lower gloves and heavier feet when tired, alternating foot lifts on the beat
  when the root glides (circling reads as footwork). Eased in from each clip's start (no pop). Deterministic: a pure
  function of the ring clock, a per-fighter presentation seed and the meters.
- **The pair moves round the ring** (`ringLayout`): the axis circles (engine orbit + a slow, direction-changing spin),
  the pair's middle drifts to the ropes, into corners and back, clamped inside the ropes; the camera follows the
  middle. Pure function of the snapshot tick + the ring id (same on every screen).
- **Feel of a connection** (`hitFeel`, `ring-clock.ts`): hit-stop 35–85 ms (knockdown 120 ms) on clean hits, 25 ms
  on blocks, by holding the ring's motion clock and catching up 35 % faster afterwards; a 3–9 cm camera push towards
  the action (my own punches a little more), eased out; none with reduced motion. Impact sounds, crowd "ooh" / roar and
  haptics were already in `fx.ts`.
- **Sparring bot** (`packages/games/boxing/src/bot.ts`, practice only, still rng-injected and deterministic): presses
  the next punch late in its own punch (the engine's input buffer chains them): 1-2, 1-2-3, hook-uppercut; jabs to
  measure at long range; steps inside now and then for hooks / uppercuts and back out; presses harder when the
  opponent is tired or shaken, eases off when tired. Level n+1 still beats level n ≥ 60 % (test). Rate ~0.4–0.8
  punches / s (amateur-like), up from no hooks / no footwork before.
- **Fight kit that fits** (`kit-fit.ts`): the Rocketbox bodies model their everyday clothes into the mesh and the look
  shader only recolours them, so the kit used to be a hoodie in the corner colour over skin-coloured baggy trousers.
  In the ring the body's own geometry is refitted once per body model (cached): thighs / calves pulled onto an
  athletic leg profile (bare legs; the trunks and boot shafts are then fitted to the slim legs, so no boot blocks),
  sleeves pulled onto the arm and given the hand's skin (a sleeveless vest; the skin texel is picked from the recolour
  mask), torso bulk and the hood folded down. The everyday geometry comes back when the person leaves the ring (the
  kit layer's undo). Headgear on (amateur rule) as before.
- **Referee** (`kit.ts refereeLook`, `kit-mesh.ts dressReferee`, `clips.ts REF_SPEC`): always the masculine base body
  (its shirt + trousers geometry; hood folded) in a white shirt, black trousers and shoes with a black bow tie; a
  working stance (feet apart, knees bent, leaning in, hands open and apart at belt height) with calm weight shifts and
  steps; he moves with the pair at the apex of the V on the far side from the camera, closer in when they are close,
  steps in to break clinches, counts, raises the winner.
- **First-timer guidance** (`game/coach.ts`, FightHud): the existing device-specific, skippable tutorial now sits
  between the thumbs on phones (not over the boxers); after it, a coach line appears only when the player is stuck —
  idle ("Step in" / "Throw the jab"), missing ("Too far"), hitting the guard ("Mix it up"), getting slipped, getting
  hit with the hands down ("Guard up"), out of breath — one at a time, rate-limited, switchable in Settings. Pops say
  why a punch scored or not ("Clean +2", "On their guard", "They slipped it", "Missed: too far"). The result card
  says what to do next and offers "Next level" after a practice win.
- **Perf** (dev ring lab, `/fight-lab?scene=1`): focus-mode ring with two fighters + referee = 34 draw calls, ~71 k
  triangles, 60 fps desktop; 55 fps headless phone landscape at DPR 2. The kit refit is a one-off per body model.

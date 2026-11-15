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

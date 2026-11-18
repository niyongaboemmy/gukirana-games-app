# P3-FGT-25: entering the fight game, before and after

What the user reported: going into the boxing game froze the screen and showed a loading screen. The world should keep
rendering and their own person should keep moving the whole time.

Measured with `qa/e2e/fight-entry.mjs`: real headless Chrome (ANGLE Metal, M2 Pro), one new signed-in player each run,
**dev servers** (`next dev`). Before = `main` @ f9d3d27 on :3200. After = this branch on :3210. Both use the same API
(:4200) and realtime server (:2567).

- **desktop**: 1280×720, no throttling.
- **phone**: 844×390 landscape, touch, `?tier=lite`, Chrome CPU throttled ×4.
- Each row covers one transition, from the tap or the first step until the place is reached and ready, plus about 3 s.
- **longest frame gap**: the worst requestAnimationFrame delta. **long-task total**: the sum of PerformanceObserver
  long tasks.
- **boot screen**: time the full-screen "Preparing the …" cover was up. **frozen held frame**: the doorway's held
  still image. **hint**: the new small non-blocking pill.

| view | transition | longest frame gap (ms) | long-task total (ms) | frames > 100 ms | full-screen boot screen (ms) | frozen held frame (ms) | small hint shown (ms) | reached |
|---|---|---|---|---|---|---|---|---|
| desktop | campus → Boxing hall (Quick Play) | 383 → 167 | 1067 → 459 | 4 → 1 | 1883 → 0 | 0 → 0 | 0 → 483 | yes → yes |
| desktop | walk to ring 7 | 150 → 17 | 202 → 0 | 1 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | yes → yes |
| desktop | ring entry (practice vs AI) | 367 → 167 | 461 → 431 | 1 → 1 | 0 → 0 | 0 → 0 | 0 → 0 | yes → yes |
| desktop | campus → Fight lobby (walk) | 400 → 100 | 1524 → 751 | 5 → 0 | 1300 → 0 | 0 → 0 | 0 → 0 | yes → yes |
| desktop | Fight lobby → Boxing hall (walk) | 233 → 67 | 411 → 174 | 2 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | yes → yes |
| phone | campus → Boxing hall (Quick Play) | 967 → 300 | 2437 → 1027 | 7 → 5 | 3017 → 0 | 0 → 0 | 0 → 1050 | yes → yes |
| phone | walk to ring 7 | 250 → 50 | 428 → 0 | 2 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | NO → yes |
| phone | ring entry (practice vs AI) | 417 → 333 | 2404 → 1354 | 13 → 6 | 0 → 0 | 0 → 0 | 0 → 0 | yes → yes |
| phone | campus → Fight lobby (walk) | 1167 → 367 | 2859 → 1266 | 8 → 8 | 0 → 0 | 0 → 0 | 0 → 0 | yes → yes |
| phone | Fight lobby → Boxing hall (walk) | 567 → 367 | 2161 → 1100 | 7 → 5 | 0 → 0 | 0 → 0 | 0 → 0 | yes → yes |

Run-to-run spread is large on the "before" side. The first "before" runs measured worse:

- desktop campus → Boxing hall: 983 ms longest gap, 2713 ms of long tasks, 4083 ms behind the boot screen.
- phone campus → Boxing hall: 1383 ms longest gap, 5383 ms behind the boot screen.
- desktop campus → lobby: 1567 ms longest gap.

"walk to ring 7 · NO" before: on the phone, the Quick Play trip's walk to the ring was lost on the cold boot path. The
runner then walked there with the ring board's own route so that the ring entry could still be measured. The
desktop "before" run lost its walk the same way in 1 of 2 runs. The "after" runs never lost it.

Raw per-run numbers, timelines and the worst frames are in `raw/`.

## What these numbers support

- **No full-screen loader and no frozen frame in any transition** after the fix, on desktop or phone. The place you
  are in stays on screen and drawn until the cut to the next place, and your person keeps walking or idling. If the
  Boxing hall still needs time, the only sign is a small dark-glass pill at the top: "Getting the ring ready…"
  (`world.entry.ring`). On desktop it showed for about 0.5 s, on the throttled phone for about 1 s.
- **Desktop is smooth enough to call smooth**: at most one frame over 100 ms per transition, the worst being 167 ms.
- **The throttled phone is better but not fully smooth.** It still has 300–370 ms hitches, 5–8 frames over 100 ms per
  transition, and 1.0–1.4 s of long tasks. The world no longer disappears, and every worst number at least halves
  except the ring entry (417 → 333).
- These are dev-server numbers (React dev mode, three's shader error checks on). A production build does less work.
  This was not measured here.

## Screenshots taken during the transitions (after)

- `after-desktop-quick-1-to-hall-1.jpg`, `after-phone-quick-1-to-hall-2.jpg`: the plaza stays live after "Go and
  practise", with the person on screen and the small hint at the top.
- `after-desktop-quick-1-to-hall-3.jpg`: already inside the Boxing hall, walking on, with no loader in between.
- `after-desktop-walk-2-to-boxing-2.jpg`, `after-phone-walk-2-to-boxing-2.jpg`: walking through the lobby towards the
  Boxing doorway while the hall behind it is already being made ready.
- `after-desktop-quick-3-ring-entry-1.jpg`, `after-phone-quick-3-ring-entry-2.jpg`: at the ring, where the person
  stays visible until their fighter is really drawn.
- `before-desktop-quick-1-to-hall-2.jpg`, `before-phone-quick-1-to-hall-2.jpg`: the same moment before the fix, with
  the world replaced by "Preparing the Boxing Hall…".

## Root causes found (profiled with `PROFILE=1`, Chrome CPU profiles)

1. **Quick Play / meeting trips changed the route straight away.** The Boxing hall was cold (never warmed from the
   campus), so the stage switched to an area that was not ready and the boot screen covered the world for 2–5 s. Fix:
   `travelTo` in `world/stage.ts`. The place on screen stays live while the hall is mounted hidden and made GPU-ready.
   Then a live cut happens, and the URL follows the picture. Picking Boxing in the Quick Play sheet starts the warm-up
   even before "Go".
2. **The focus fog was installed only once the Boxing hall was on screen.** The FOG define changed on every hall
   material, so the whole hall recompiled on its first visible frame. Fix: `fight/FocusMode.tsx` keeps the fog (far
   away, no visual effect) installed from mount.
3. **A person streaming in suspended a whole room.** In the lobby, gym staff are drawn only once the room is on screen,
   and a body model that was not cached re-suspended the lobby's area. Its warm-up reset and the boot screen came back
   after you had already walked in. Fix: one Suspense boundary per staff member and per ring pair or member, and the
   boxer bodies are preloaded when the room mounts.
4. **The ring fighter's body was cold.** The v8 GLB, KTX2 skins and the `gk-boxer-v8` program were first requested,
   parsed and compiled on screen as you climbed into the ring. Fix: the hall preloads it and keeps one hidden,
   paused, warm-only fighter that the area warm-up compiles and uploads (`FighterWarmup`).
5. **Every person's material clone serialised its mask texture.** three's `Material.copy` deep-copies `userData` with
   JSON. The mask texture stored there was turned into a data URL (canvas `toDataURL`) on every avatar build: 40–100 ms
   per person at the door and in the ring. Fix: `world/human/materials.ts` copies without `userData` and then makes a
   shallow copy.
6. **The warm-up drew several brand-new programs in one frame.** Their first use cost 150–250 ms frames while you
   walked. Fix: a warm batch now takes at most one object whose program was never drawn, while the person is moving
   (`SceneCanvas` `programsOf` / `drawnPrograms`).
7. **Bloom switching on or off compiled every late-mounted object mid-frame.** Fix: on screen, objects that mounted
   after the warm-up are compiled for both output paths in 2 ms slices.
8. **Everything was built in one frame.** Crossing into a hall re-rendered the whole campus and the whole room, staff
   all built in one frame on arrival, and the fighters, referee and corner teams all built in one frame at the ring.
   Fix: the plaza and hall trees are memoised, staff join one per 0.5 s, and ring people are built one per frame with
   your own fighter first. Your own person stays visible until your fighter is drawn.

## Cold reload / deep link (boot screen, unchanged behaviour)

A reload of `/room/boxing` still boots behind the boot screen, because there is no live world to keep on screen. It
got shorter. Time until the HUD was up, phone viewport, no throttling, 2 runs each: **11.2–12.2 s before → 8.1–8.6 s
after** (the plaza warm-up behind it finishes 3 s sooner).

## Flow regression (qa/e2e/boxing-e2e.mjs against this branch, :3210 + API :4200)

- desktop practice: 15 pass, 0 fail
- desktop Quick Play, 25-Star stake (ledger settled, wallet pill updated): 34 pass, 0 fail
- phone direct challenge, friendly: 25 pass, 0 fail
- desktop Quick Play friendly with the v7 fallback (`BOXER=v7`, no v8 asset requested): 32 pass, 0 fail

On the first try, the challenge flow hit the boot screen 19 s after the deep link. The warm-up's one-program-per-frame
limit also applied behind the boot screen. That was fixed by commit "keep warm batches unlimited behind the boot
screen", and the rerun passed. The first v7 try failed before the fight: player A's sign-in did not hold (the page sat
on /gate). The same sign-in flake hit the "before" server too. The rerun passed.

## Remaining waits

- **Cold Boxing hall on a Quick Play trip.** It takes about 0.5 s on desktop and 1–3.5 s on the throttled phone, while
  the plaza stays live with the hint. Picking Boxing in the sheet starts this earlier.
- **Phone hitches of 300–370 ms around the cut and the route change.** These come from building the hall's own player
  avatar, the HUD swap and the realtime room join. They are not gone.
- **The cold "walk through a door before the hall was ever warmed" fallback (held frame) is still in the code** for
  very slow loads. It never showed in these runs.

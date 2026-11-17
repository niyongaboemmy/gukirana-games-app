# Boxer v9: Mixamo clips to download (P3-FGT-21)

These clips replace the hand-keyed boxing poses with real motion capture. They map onto the clip names in
`apps/web/src/world/human/boxing/clips.ts` and onto the engine's fighter acts (`FIGHTER_ACTS` and `BOXING_ACTIONS` in
`packages/contracts/src/boxing.ts`, driven by `apps/web/src/fight/`). The machine-readable copy of this table is
`apps/web/scripts/boxer-v9/mixamo-clips.json`; pipeline step 4 reads it.

About the names: Mixamo gives several animations the same card name (there are eight called "Boxing"). Each row
therefore gives the **card name**, the **description** (type it into Mixamo's search box to find the exact one) and
the **length in frames at 30 fps** as a check. The names and lengths come from a public snapshot of the Mixamo
catalogue (2,446 animations, read as metadata only, nothing downloaded). Mixamo's own site is the authority. If a
name is not found, search for the description words and pick the nearest match by preview.

## Download settings (every clip)

First, once per fighter, upload the decimated body (`work/out/m/body-for-mixamo.fbx`, made by pipeline step 2) with
**Upload Character**, place the markers, and choose skeleton "Standard Skeleton (65)". Download that character once
as **FBX Binary, T-pose, With Skin**, saved as `work/in/mixamo/m/character.fbx`.

Then, **with that character selected**, for each clip:

| Setting | Value | Why |
| --- | --- | --- |
| Format | FBX Binary (.fbx) | What step 4 imports |
| Skin | **Without Skin** | The clip only; our mesh is already rigged |
| Frames per Second | **30** | Matches the fight tick (`TICK_HZ = 30`) and the scene rate |
| Keyframe Reduction | none | Step 4 resamples per frame itself |
| In Place | **ticked** whenever the box is offered (footwork, walks) | The engine moves the root with each clip's `travel` (clips.ts) |
| Mirror | **unticked** | Mirroring is done in step 4 where the JSON says `"mirror": true`, so it is never done twice |
| Character Arm-Space | raise it until the gloveless hands clear the body by about 4 cm | A 12 oz glove is about 8 cm thick: without the clearance gloves would sink into the torso in the guard |
| Overdrive / speed | default (50) | Timing is matched in the engine |
| Trim | full clip, except where the table says to trim | |

Save each download as `work/in/mixamo/m/<clip>.fbx`, where `<clip>` is the first column (for example `jab.fbx`).
Before downloading, check the stance in Mixamo's preview: our fighters are **orthodox** (left foot and left hand
forward). If a boxing clip is southpaw, set `"mirror": true` for that row in `mixamo-clips.json`.

## Stance and footwork

| Our clip (clips.ts) | Engine act | Mixamo card | Description to search | Frames |
| --- | --- | --- | --- | --- |
| `guard` | idle (calm) | Fighting Idle | Male Fight Idle Boxing Stance | 100 |
| `guardIdle` | idle (active) | Bouncing Fight Idle | Bouncing Fight Idle With Guard Up | 90 |
| `stepForward` | stepIn, mv forward | Short Step Forward | Short Boxing Step Forward (alt: Medium / Long Boxing Step Forward) | 31 |
| `stepBack` | stepOut, mv back | Walking Backwards | One Foot At A Time In Combat Pose | 27 |
| `stepLeft` | mv left | Short Left Side Step | Short Left Boxing Side Step | 25 |
| `stepRight` | mv right | Short Right Side Step | Short Right Boxing Side Step | 27 |
| `pivot` | pivotL (pivotR = Right Pivot or mirrored) | Left Pivot | Low Left Boxing Pivot (alt: High Left Boxing Pivot, Low / High Right Boxing Pivot) | 39 |

## Punches

| Our clip | Engine act | Mixamo card | Description to search | Frames |
| --- | --- | --- | --- | --- |
| `jab` | jab | Lead Jab | Med Head Jab (alt: Short Head Jab 41, Boxing / Boxing Leading Hand Jab 53) | 46 |
| `cross` | cross | Boxing | Back Hand Cross (alt: Cross Punch / A Cross Punch 61) | 65 |
| `leadHook` | hook | Boxing | Boxing Lead Hand Hook (alt: Hook / Short Hook Punch To The Head 40) | 61 |
| `rearHook` | rhook | Boxing | Boxing Back Hand Hook (alt: Right Hook / Right Hook Punch From Idle 34) | 66 |
| `leadUppercut` | uppercut (lead variant) | Boxing | Boxing Lead Hand Uppercut (alt: Uppercut / Standing Left Uppercut Punch 41) | 67 |
| `rearUppercut` | uppercut | Boxing | Boxing Back Hand Uppercut | 67 |
| `leadBody` | hook + body (`b`) | Hook | Mid Hook Punch To The Body (alt: Short Hook Punch To The Body 58) | 73 |
| `rearBody` | cross + body (`b`) | Body Jab Cross | Boxing Body Jab Cross Medium: **trim to the cross** (the second half) | 64 |
| (feint) | feint | - | The first 40 % of `jab`, played by the runtime; no download | - |

## Defence

| Our clip | Engine act | Mixamo card | Description to search | Frames |
| --- | --- | --- | --- | --- |
| `blockHigh` | guard held (`g`) | Center Block | High Center Block | 54 |
| `blockLow` | guard held vs body | Center Block | Low Center Block (alt: Body Block / Blocking Body With Arms 104) | 49 |
| `slipRight` | slipR | Dodging Right | Dodging To The Right In Place | 44 |
| `slipLeft` | slipL | Dodging Right | the same file, mirrored by step 4 | 44 |
| `duck` | duck | Dodging | Boxing Dodge Advance (alt: Boxing Dodge Retreat 68). **Check the preview**: it must dip under a punch | 71 |
| `parry` | parry | Blocking | Blocking Inward | 37 |
| `blockImpact`, `parried` | blockHit, (parried) | - | No good match: stays keyed (current clips.ts poses, re-targeted onto v9 by bone name) | - |

## Hit reactions (head and body, both sides)

Side convention: the opponent's **lead** hook (their left) lands on our **right** cheek and turns the head to our
left. "From A Left Punch" in Mixamo means the punch came from the attacker's left hand.

| Our clip | When | Mixamo card | Description to search | Frames |
| --- | --- | --- | --- | --- |
| `hitHeadLight` | light straight to the head | Light Hit To Head | Receiving A Light Hit From A Straight Punch | 25 |
| `hitHeadHeavy` | heavy straight | Big Hit To Head | Receiving A Big Hit From A Straight Punch | 40 |
| `hitStraight` | medium straight | Head Hit | Receiving A Medium Hit To The Head From A Straight Punch | 38 |
| `hitHookFromLead` | opponent's lead hook | Medium Hit To Head | Receiving A Medium Hit From A Left Punch (heavy: Big Hit To Head / ...From A Left Punch 50) | 33 |
| `hitHookFromRear` | opponent's rear hook | Medium Hit To Head | Receiving A Medium Hit From A Right Punch (heavy: Big Hit To Head / ...From A Right Punch 48) | 31 |
| `hitUppercut` | uppercut | Big Hit To Head | Receiving A Big Hit From A Straight Punch (**stand-in**: Mixamo has no standing uppercut reaction) | 40 |
| `hitBodyLight` | body straight | Hit To Body | Receiving A Body Hit By A Straight Punch (alt: ...By A Right Uppercut 36) | 41 |
| `hitBodyHeavy` | heavy body shot | Big Stomach Hit | Receiving A Big Hit In The Stomach | 97 |
| `hitBodyLead` | lead hook to our right side | Side Hit | Receiving A Hit In The Side (heavy: Big Rib Hit / Receiving A Big Hit In The Ribs 49) | 30 |
| `hitBodyRear` | rear hook to our left side | Side Hit | the same file, mirrored by step 4 | 30 |

## Stagger, knockdown, count, get-up, KO

| Our clip | Engine act | Mixamo card | Description to search | Frames |
| --- | --- | --- | --- | --- |
| `stagger` | staggered (one-shot) | Standing React Large From Front | Large Hit Reaction From The Front | 42 |
| `groggy` (new) | staggered (loop) | Injured Stumble Idle | Injured Stumbling Idle (alt: Dizzy Idle / Rocking Back And Forth As If Dizzy 129) | 153 |
| `knockdown` | down (heavy) | Stunned | Male Knocked Down From A Punch | 126 |
| `kneeDown` (new) | down (takes a knee) | Dying | Dying With Front Hit To The Head And Fall On One Knee | 134 |
| `count` | down, during the count | Kneeling | Kneeling On One Knee Idle | 141 |
| `getUp` | rising (from the canvas) | Getting Up | Getting Up From Being Knocked Down On The Ground | 82 |
| `kneeUp` (new) | rising (from a knee) | Standing | Standing Up From A Kneeling Position | 84 |
| `koFall` (new) | KO | Knocked Out | Knocked Out Falling To Back (alt: Livershot Knockdown / Receiving A Hit To The Liver 85) | 149 |

## Clinch

Mixamo has **no clinch** (it is a two-person move). Keep the current keyed `clinch` (arm-fk keep-out wraps the arms
round the opponent and never through). See the CMU table for the only partial backup.

## Ceremony, corner, walkout

| Our clip | When | Mixamo card | Description to search | Frames |
| --- | --- | --- | --- | --- |
| `touchGloves` | glove touch before round 1 | Shaking Hands 2 | 2 People Shaking Hands Part 2 - Male: **stand-in**. Better: three keyed poses (reach, touch, back to guard), about 30 minutes in Blender, or keep the current keyed clip | 132 |
| `walkout` (new) | ring walk | Walking | Walking With A Swagger (alt: Swagger Walk 85) | 32 |
| `warmUp` (new) | corner idle before the bell | Warming Up | Boxing Warm Up Exercise | 190 |
| `cornerExit` (new) | leaving the corner | Walking | Side Step From Corner Of Ring | 31 |
| `walk` | ring people walking | Walking | Male Standard Walk | 38 |
| `cornerSit` | sitting on the stool | Stand To Sit | Standing To Sitting Transition | 68 |
| `cornerRest` | between rounds | Sitting Idle | Sitting In Chair Hands Resting On Thighs | 193 |
| `cornerStand` | the bell | Sit To Stand | Sitting To Standing | 69 |
| `victory` | celebrate | Victory | Victory From A Boxing Win | 136 |
| `victoryHold` | celebrate (loop) | Victory Idle | Aj Victory Idle | 51 |
| `winnerRaised` | referee raises the winner's arm | Hand Raising | Raising A Hand | 123 |
| `defeat` | dejected | Defeat | Defeat From A Boxing Loss | 144 |
| `defeatHold` | dejected (loop) | Defeat Idle | Aj Defeat Idle | 50 |

Respect note: skip Mixamo's "Taunt" and "Illegal Knee / Elbow" clips. Taunting and fouls are not part of the game's
tone, and the referee would stop them.

Referee (optional, staff NPC, bare hands): `refCount` = Counting / Referee 10 Count (481), `refBreak` = Intercepting /
Intercept And Wave To Stop (60), `refIdle` = Idle / Standing Idle (251).

## CMU backups (for what Mixamo lacks or does badly)

CMU terms: LICENCES.md (c). Download the BVH conversions of the takes (the CMU site links to them under
"Resources"). Their bone names are Mixamo-like (Hips, Spine, Spine1, LeftArm ...), so step 4 retargets them unchanged
(`"file": "<take>.bvh"` in `mixamo-clips.json`, 120 fps scaled to 30). The site asks not to be crawled: fetch only
these takes.

| Need | CMU takes | Notes |
| --- | --- | --- |
| Duck / bob and weave, extra shadow-boxing | 13_17, 13_18, 14_01, 14_02, 14_03, 15_13, 17_10, 79_08, 80_10 ("boxing") | Amateur subjects in street clothes, with parallel feet and bare-hand guards (docs/ASSET-LICENSES.md notes this). Use them for the trunk and head motion of ducks; keep the arms from Mixamo. |
| Step back with a counter | 76_01 "walk backwards then attack with a punch" | |
| Getting up from the canvas | 77_16, 77_17, 77_18 "laying down, getting up, careful ready pose" | A good alternative to Mixamo "Getting Up" |
| Falls | 90_16 "fall on face", 90_18 "RugPullFall" | Heavy KO variants |
| Glove touch (base) | 141_23 "Shake Hands"; 18_01 / 19_01 "walk, shake hands" (two-subject) | Re-key the hands to touch gloves |
| Clinch (arms only, partial) | 18_05 / 19_05 "A pulls B by the elbow; B resists" (two-subject) | Weak. The keyed clinch stays the plan. |

## After downloading

Run `node apps/web/scripts/boxer-v9/run.mjs --from rig`. Step 4 writes `work/out/m/clips-report.json` with each
clip's length, its root travel (`travel` for clips.ts) and a first guess at the `impact` time of each punch (the
moment of peak wrist speed). Those numbers update the clip table in a later runtime task. Missing files are skipped
with a message, so you can download in batches.

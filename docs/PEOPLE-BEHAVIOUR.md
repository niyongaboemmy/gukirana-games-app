# People behaviour: what a person in the playground does, and why

Plan tasks P1-WLD-02 (avatars, people) and P1-COM-04 (social actions). This document has two parts. First,
research on how real people behave in a public plaza, a café and a games hall, and on how good games make
avatars feel alive. Second, the catalogue of actions built from it: what triggers each action, its priority, and
how it is animated. The code lives in `apps/web/src/world/human/*`, `apps/web/src/social/*` and
`apps/realtime/src/social/pairs.ts`. The shared action codes are `ACT` in `packages/contracts/src/social.ts`.

## 1. Research findings

### 1.1 Idle micro-behaviour (standing, waiting)

- **People are never perfectly still.** Over time, standing people shift their weight and fidget more often
  and more widely. In a seating study, people changed posture 8 ± 4 times in 20 minutes
  ([Tam et al., RESNA 2014](https://www.resna.org/sites/default/files/conference/2014/PDF%20Versions/Seating/Tam.pdf);
  [NIOSH, prolonged standing](https://stacks.cdc.gov/view/cdc/224976/cdc_224976_DS1.pdf)).
  - Built: a seeded idle director picks a fidget every 7–14 s. Each person's idle clip starts at its own
    offset and plays at 0.92–1.09× speed, so a crowd never breathes or sways in lockstep.
- **Breathing at rest** is 12–20 breaths a minute, a 3–5 s cycle
  ([American Lung Association](https://www.lung.org/blog/respiratory-rate-vital-signs)). The Rocketbox idle
  clips are motion capture, so their chest motion already sits in this range.
- **Phone checks are short and frequent.** Logged data shows about 58 pickups a day, and more than half of
  phone sessions last under 30 s
  ([Asurion](https://www.asurion.com/about/press-releases/americans-check-their-phones-96-times-a-day/);
  [Electronics360 / RescueTime](https://electronics360.globalspec.com/article/11868/video-we-may-not-be-addicted-to-our-smartphones-after-all)).
  - Built: a 6–8 s "take the phone out, look, put it away" clip. It plays often when alone, rarely in company.
- **Crossed arms carry no fixed meaning.** They can mean comfort, cold or waiting
  ([changingminds](https://www.changingminds.org/techniques/body/parts_body_language/arm_body_language.htm)).
  - Built: hands on hips (the licensed clip has no crossed arms) is a neutral idle fidget and the "watching"
    pose. It is never used as a hostile signal; real crossed arms need a new clip (P2).

### 1.2 Conversation: distance, facing, listening

- **Hall's distances.** Intimate space is 0–0.46 m, personal 0.46–1.2 m, social 1.2–3.6 m
  ([EBSCO, proxemics](https://www.ebsco.com/research-starters/social-sciences-and-humanities/proxemics)).
  - Built: remote people keep a soft 0.8 m personal space. Turning to face someone triggers within 1.7 m.
  - Contact actions place the two people at a set distance: 0.95 m for a handshake, 0.98 m for a fist bump,
    0.42 m for a hug.
- **Kendon's F-formations.** Two people stand face to face (vis-à-vis), in an L-shape or side by side;
  three or more form a circle ([EMCA wiki](https://emcawiki.net/F-formation); [arXiv 2108.06181](https://arxiv.org/pdf/2108.06181)).
  - Built: when someone stops next to you, you turn to face them once.
  - Gestures aimed at a person (wave, nod, thumbs-up …) first turn you towards them, or towards the nearest
    person within 4 m.
- **Gaze.** Listeners look at the speaker about 75 % of the time; speakers look at listeners about 41 %
  ([Argyle & Ingham 1972, via typeset.io](https://typeset.io/pdf/eye-gaze-patterns-in-conversations-there-is-more-to-asm4ams5qb.pdf)).
  - Built: the head turns towards the nearest person talking on voice (within 5–6 m).
  - Otherwise there is a 2 s glance at someone close by every 5–9 s. This is the same rule for your own avatar
    and for everyone else's.
- **Nodding.** Listeners nod about 6.9 times a minute; for virtual listeners, 6–12 backchannels a minute look
  natural ([Novick](https://www.cs.utep.edu/nigel/feedback/pdf/P15novick.pdf);
  [Frontiers in Communication 2025](https://www.frontiersin.org/journals/communication/articles/10.3389/fcomm.2025.1655049/full)).
  - Built: while someone talks nearby, the idle director switches to a "listening" mix: a listening pose plus
    a nod clip, every 3–6 s.

### 1.3 Greetings and manners in Rwanda

- **Handshake.** Shake with the right hand. Placing the left hand on your own right forearm or elbow shows
  respect, especially to elders ([Rwanda Chamber](https://rwandachamber.org/?p=22);
  [heyloons, Rwandan handshakes](https://heyloons.com/2017/06/01/a-rough-guide-to-the-various-forms-of-rwandan-handshakes/)).
  - Built: the handshake does exactly this. The left hand supports the right forearm, the head makes a small
    bow, and the hands pump twice.
- **Embrace.** Close friends embrace, with one hand on the other's shoulder and the other at the side or hip
  ([Remitly](https://www.remitly.com/blog/lifestyle-culture/how-to-greet-people-in-rwanda/)).
  - Built: the hug puts the right hand over the other person's left shoulder, the left hand at their side, and
    turns the head to one side.
  - It always needs the other person's consent. Between men and women in public, a handshake is the norm,
    which is why the hug is an explicit choice behind an accept prompt.
- **Pointing.** Pointing at people with one finger is rude, so people point with the whole open hand
  ([Smith College, Becoming Foreign](https://sites.smith.edu/becoming-foreign/2018/04/08/reflection-3/)).
  - Built: "Point" is an open-hand gesture, palm turned slightly up.
- **Demeanour.** People are calm and respectful. Nothing in the catalogue is rude, aggressive or comic; the
  "angry" mocap was cut down to its calm hands-on-hips part only.

### 1.4 Plazas and cafés

- **People sit where there are places to sit,** and where there is something to watch; the corners and edges
  of steps fill first ([PPS on William H. Whyte](https://www.pps.org/article/what-holly-whytes-social-life-film-can-teach-us-today)).
- **The edge effect.** People prefer to stay at the edges of a space, where they have their back covered and a
  good view ([Jan Gehl, via GSA](https://webarchive.library.unt.edu/web/20120925200015/http://www.gsa.gov/graphics/pbs/JanGehl_UrbanDesign_article.pdf)).
  - Built: lean spots are at the lamp posts on the plaza ring and at the café glass, both edges facing the
    fountain.
  - Benches give each person their own way of sitting (upright or leaning back), with an occasional look
    around.

### 1.5 Locomotion

- **Speeds.** Normal walking runs from about 1.43 m/s (men in their 40s) down to 0.94 m/s
  ([Bohannon & Andrews 2011](https://bacpar.csp.org.uk/node/338279)). Adults switch from walking to running
  at about 2.0 m/s, with a mixed zone from 1.9 to 3.0 m/s ([PubMed 16286854](https://pubmed.ncbi.nlm.nih.gov/16286854/)).
  The existing gait blend already followed this; it is kept.
- **Starting and turning.** Gait is steady by about the third step. Planned turns are made as step turns, not
  as a spin on one foot ([PMC6151057](https://pmc.ncbi.nlm.nih.gov/articles/PMC6151057)).
  - Built: the gait blends in at 10/s from the measured speed.
  - Turning on the spot plays small walk steps, at most 45 % weight, driven by the yaw rate.
  - Stopping freezes the cycle and settles it into the nearest double-support foot plant.
- **Avoiding others.** The social force model (Helbing & Molnár 1995) repels people from each other and from
  walls ([arXiv cond-mat/9805244](https://arxiv.org/abs/cond-mat/9805244)). Small groups walk abreast and bend
  into a V as the crowd gets denser ([Moussaïd et al. 2010](https://www.research-collection.ethz.ch/entities/publication/a69c0402-583b-4ac6-aa18-5a0a7705d81c)).
  - Built: a soft, eased 0.8 m separation between rendered people. Walking in pairs is not built yet.

### 1.6 How games make people feel alive

- **Motion matching** (Clavet, GDC 2016; Naughty Dog, GDC 2021) picks the best-matching mocap pose every
  frame. It needs large data and heavy CPU, too heavy for a phone web client
  ([GDC Vault](https://www.gdcvault.com/play/1022985/Motion-Matching-and-The-Road)).
  - Built instead: phase-synced blends, seeded idle variety, procedural look-at and arm IK, the same layered
    approach used for ambient characters.
- **Idle variety** makes a still character read as a person
  ([Kotaku on idle animations](https://kotaku.com/the-quiet-importance-of-idle-animations-1834564079)).
- **Consent for contact in social VR.** Horizon Worlds keeps a 1.2 m personal boundary
  ([Engadget](https://www.engadget.com/meta-quest-horizon-worlds-horizon-venues-personal-boundary-harassment-174140461.html)).
  In Rec Room, both players have to make the handshake or fist-bump gesture
  ([Rec Room ship notes](https://recroom.com/ship-notes/2022/10/11/rec-room-update-the-off-the-old-block-edition)).
  - Built: every contact action is ask, then accept. The server pairs the two people and only then allows the
    contact animation code.

### 1.7 Pool hall manners

- **Spectators** stand back from the table, out of the shooter's line of sight
  ([APA league](https://league.poolplayers.com/874/post/2405)).
- **Chalking** happens between shots, on your own turn
  ([PoolDawg](https://www.pooldawg.com/article/pool-etiquette-5-ways-to-avoid-being-that-guy/)).
- **Handshakes** before and after a game are expected ([CSU handout](https://billiards.colostate.edu/resource_files/pool_etiquette_handout.pdf)).
- Built: standing still near a table where people sit makes you a spectator (hands on hips, watching). In the pool
  hall you chalk a cue now and then. After a match you celebrate a win, or shake your head after a loss.

## 2. Action catalogue

**Trigger types:**
- **Idle**: automatic. Seeded per person and not sent over the network; every client derives it from the same id.
- **Emote**: the player picks it in the emote picker or the person menu.
- **Context**: offered at a place, or happens naturally there.
- **Social**: with a nearby person.

**Priority:** P0 = shipped and core; P1 = shipped; P2 = later.

**Animation sources:**
- **mocap**: Rocketbox clips (MIT), in `life-*.glb` or `anim-*.glb`.
- **proc**: procedural layers on the same skeleton (arm IK, finger curls, head/spine offsets, body tilt).

### Locomotion and seats

| Action | Trigger | Pri | Animation |
| --- | --- | --- | --- |
| Walk / run blend (walk → fast walk → run → sprint) | movement | P0 | mocap, phase-synced to ground speed (existing; kept) |
| Start (gait blends in from the measured speed) | movement | P0 | animator: 10/s blend-in, no full stride at 0 m/s |
| Stop (settle into a foot plant) | movement | P0 | animator: phase frozen and eased to the nearest heel strike (0.25 / 0.75) while fading out |
| Turn on the spot (small steps) | A/D keys, auto-facing | P0 | animator: walk clip at ≤ 45 % weight, phase advanced 0.18 m per radian |
| Walk backwards (S key) | movement | P0 | animator: walk cycle played in reverse |
| Sit on a bench: walk up, turn, step back, sit | bench prompt / E | P0 | bench.ts phases; trimmed sit-down clip with its own root motion |
| Stand up from a bench, step clear, walk on | walking input | P0 | trimmed stand-up clip; the origin is already at the standing spot |
| Seated variants: upright or leaning back, a look around | idle, seated | P1 | mocap `sitb`, `sitlook` |
| Footsteps (stone, plank, herringbone, terracotta; walk / run / brushed turn) | foot plants | P1 | synthesised noise bursts, distance-attenuated, max 8 per 250 ms |
| Fade in / out at doors; leaving people walk on through the door | join / leave | P1 | dithered alpha (alphaHash) and a "ghost" that walks on for up to 1.3 s |
| Walking in pairs, side-step, stairs | movement | P2 | not built: there are no strafe clips, and the plaza is flat |

### Automatic idle life

| Action | Trigger | Pri | Animation |
| --- | --- | --- | --- |
| Breathing, weight shift (per-person offset and pace) | idle | P0 | mocap `idle` / `idle2` |
| Look around | idle | P0 | mocap `look` |
| Check the phone (phone prop in the hand) | idle, alone more often | P0 | mocap `phone` |
| Hands on hips | idle, also "watch" | P1 | mocap `fold` |
| Brush down clothes / adjust | idle | P1 | mocap `dust` |
| Stretch | idle, rare | P1 | mocap `stretch` |
| Face someone who stops next to you | social, idle | P0 | Player turns in place (≤ 6 rad/s, step turn) |
| Listening pose and nods while someone talks nearby | social, voice | P0 | mocap `listen` and `nod`, chosen 3–6 s apart |
| Head turns to a speaker; glances at people close by | social | P0 | proc head look-at (existing; extended to the local avatar) |
| Hands in pockets | idle | P2 | not built: no licensed clip; IK into a pocket clips through the mesh |

### Emotes (player-chosen, synced)

All emotes are in the HUD emote picker. Gestures aimed at a person turn you towards them first.

| Action | Trigger | Pri | Animation |
| --- | --- | --- | --- |
| Wave | emote / person menu | P0 | mocap |
| Nod / shake head | emote | P0 | mocap `nod`, `shake` |
| Thumbs-up | emote / person menu | P0 | proc: arm IK, fist with the thumb rolled up |
| Clap | emote | P0 | mocap |
| Laugh | emote | P0 | mocap `laugh` |
| Point (open hand) | emote | P1 | proc: arm IK, open hand |
| Shrug | emote | P1 | mocap `shrug` |
| Celebrate | emote, after a won match | P0 | mocap `cheer` |
| Oh no (disappointed) | after a lost match | P1 | mocap `shake` |
| Think | emote, halls | P1 | mocap `think` |
| Take a photo of the volcanoes (phone prop, turns north) | emote | P0 | mocap `photo` |
| Check phone | emote | P1 | mocap `phone` |
| Dance | emote | P1 | mocap (existing) |

### Context actions

| Action | Trigger | Pri | Animation |
| --- | --- | --- | --- |
| Lean back against a lamp post or the café glass | context prompt "Lean here" | P0 | walk into place, body tilted 5° back from the ankles, relaxed weight-shift idle |
| Coffee at the café window (paper cup, sips), standing by it facing the plaza | context prompt "Get a coffee" | P0 | mocap `drink`; cup prop |
| Watch a table (spectator) | halls: stand still near a busy table, facing it | P1 | mocap `fold` |
| Chalk a cue | pool hall, while watching | P1 | proc: cue upright in the left hand, right hand twists the chalk |
| Win celebration / loss reaction | back in a room after a match | P1 | mocap `cheer` / `shake` |

### Social actions with a nearby person (consent first)

| Action | Trigger | Pri | Animation |
| --- | --- | --- | --- |
| Handshake, Rwandan style (left hand on the right forearm, small bow) | person menu → the other person accepts | P0 | both walk into place 0.95 m apart; proc arm IK, two pumps |
| Fist bump | person menu → accept | P1 | 0.98 m apart; proc: quick reach, touch, back |
| Hug (friends) | person menu → accept | P1 | 0.42 m apart; proc: arms around, head to the side, spine leans in |

## 3. Network and safety rules

- Every action is visible to everyone: the action code travels in the `anim` field of the existing `moves`
  batches. One-shot emotes also send `emote {emote, to?}` for an instant start and the "… waved at you" notice.
- **Server validation** (`apps/realtime/src/rooms/world-room.ts`):
  - Unknown `anim` codes become 0.
  - Contact codes (21–23) are allowed only for two people the server has paired, and only that pair's code,
    for the action's duration plus 1.5 s.
  - The `emote` schema refuses locomotion, sitting and contact codes.
- **Pairing** (`pair-request` → `pair-invite` → `pair-respond` → `pair-start`):
  - Both people must be signed in, visible to each other (not blocked), standing (not seated) and within 3 m.
  - Each person can send at most 6 invitations a minute, and an invitation expires after 15 s.
  - The server sends both clients their spots face to face, and the time to walk there at about 1.15 m/s.
- Idle life is cosmetic and seeded (mulberry32 from the person id). It is never used in game or money code;
  there is no `Math.random` in any of these files.

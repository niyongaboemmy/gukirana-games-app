# Design Specification: 3D / VR Virtual Games World and Game Design
## Gukirana Games — "Gukirana Playground"

| Item | Value |
|---|---|
| Document | Experience and Game Design Specification (3D / VR) |
| Version | 1.0 (Draft for review) |
| Date | 12 November 2026 |
| Companion to | [SRS.md](SRS.md) v1.4, mainly §4 (games), §6 (coins), §8.4 (3D world and VR) |
| Audience | Product designers, 3D artists, game designers, front-end / XR engineers, QA |
| Status | Draft — needs art-direction, cultural and usability review |

> **How to read this document:** the SRS says *what* the system must do. This document says *how it should look, feel and behave*: world layout, metrics, art direction, HUD, controls, game screens, VR interaction, audio, comfort, performance budgets and the client architecture that delivers them. Requirement IDs here use the prefix **DS-** and refer back to SRS IDs where relevant.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Analysis: 3D and VR on the Web in 2026+](#2-analysis-3d-and-vr-on-the-web-in-2026)
3. [Design Pillars](#3-design-pillars)
4. [Device and Platform Matrix](#4-device-and-platform-matrix)
5. [Art Direction and Visual Language](#5-art-direction-and-visual-language)
6. [World Design](#6-world-design)
7. [Avatar System](#7-avatar-system)
8. [Camera, Movement and Controls](#8-camera-movement-and-controls)
9. [HUD and UI System](#9-hud-and-ui-system)
10. [Core Experience Flows](#10-core-experience-flows)
11. [Game Design Specifications](#11-game-design-specifications)
12. [Social, Voice and Safety UX](#12-social-voice-and-safety-ux)
13. [Money UX in 3D and Ethical Design](#13-money-ux-in-3d-and-ethical-design)
14. [Audio and Haptics](#14-audio-and-haptics)
15. [Accessibility and Comfort](#15-accessibility-and-comfort)
16. [Performance Budgets](#16-performance-budgets)
17. [Client Architecture for 3D / VR](#17-client-architecture-for-3d--vr)
18. [Localisation in 3D](#18-localisation-in-3d)
19. [Design QA and Acceptance](#19-design-qa-and-acceptance)
20. [Design Production Plan](#20-design-production-plan)
21. [Open Design Questions](#21-open-design-questions)
22. [References](#22-references)

---

## 1. Executive Summary

**Gukirana Playground** is a shared, stylised 3D world where players meet, talk and play skill games for Stars (free) or Coins (real money). One world runs on three kinds of device:

| Device | How it's played | Share of players (expected, Rwanda Year 1) |
|---|---|---|
| **Phone (landscape)** | Third-person 3D, two-thumb controls, full-screen | **~85%**: the main experience |
| **Desktop / laptop** | Third-person 3D, keyboard + mouse, 3-pane layout | ~12% |
| **VR headset** | First-person immersive VR (WebXR), hands / controllers | ~3%, but the **flagship and marketing** experience |

**Key design decisions:**
1. **Design for the phone in landscape first, then scale up to desktop and out to VR.** The phone sets the budget; VR sets the ambition.
2. **One world, many views.** All devices share rooms, voice and games. Only the camera, input and HUD change.
3. **The world is a lobby; games are focused.** The world is for meeting and agreeing. When a match starts, the camera moves into a clean, readable game view. Fairness and readability matter more than spectacle during play.
4. **Server decides; client performs.** Animations (dice throws, seed sowing, ball rolls) *show* results the server has already decided. Device or gesture never changes an outcome.
5. **Local soul.** Rwandan art (Imigongo patterns, Agaseke shapes, the hills) and a local game (Igisoro) give the world an identity global competitors can't copy.
6. **Ethical by design.** No casino tricks: no near-miss effects, no fake activity, no slot-machine celebrations. Money moments are clear and calm.

---

## 2. Analysis: 3D and VR on the Web in 2026+

### 2.1 Platform Reality

| Technology | Status (late 2026) | Design implication |
|---|---|---|
| **WebXR (immersive-vr)** | Supported in the Meta Quest Browser (full, including hand tracking, anchors, passthrough), Chrome on Android XR headsets (hand input, anchors, depth, hit-test), and Safari on visionOS (immersive-vr). Chrome / Edge on desktop support it for PC VR. | VR through the browser is viable on all major headsets. **No app store needed.** |
| **WebXR on iPhone / iPad / Mac Safari** | **Not supported.** | iPhone users get the **screen 3D** experience only. Never show an "Enter VR" button that doesn't work. Detect support at runtime. |
| **WebXR in Firefox** | Unclear / limited. Sources disagree. | Treat as no VR. Feature detection decides. |
| **WebGPU** | Shipped in Chrome / Edge. Safari 26 shipped support (Sept 2025). Three.js `WebGPURenderer` falls back to WebGL 2 automatically. | Use WebGPU when present, with **WebGL 2 as the guaranteed baseline** for low-end Android. |
| **Three.js r186+** | Native Gaussian-splat renderer (TSL, works on WebGPU and WebGL), released Sept 2026. | Photoreal **backdrops** (for example the Rwandan hills skyline) on high tiers, with a cheap fallback (HDRI / billboard) on low tiers. |
| **Hand tracking** | Mature on Quest and Android XR. More tiring than controllers for long sessions. | Support hands for natural actions (scoop seeds, throw dice, wave). Keep **controllers as the default** for long play and money confirmation. |
| **Spatial audio** | Web Audio API (HRTF panner) on all target browsers. | Proximity voice and positional sound with no plugins. |
| **On-device AI** | WebGPU / WebNN inference is practical for small models. | Avatar-from-selfie (on device, photo never uploaded), live captions, AI practice bots that run offline. |

### 2.2 Lessons from Social VR and Mobile Games

| Lesson | Source pattern | Our design response |
|---|---|---|
| Comfort decides session length | Meta locomotion and comfort guidance: teleport by default, opt-in smooth turn, vignettes, tiered comfort settings | Teleport + snap turn by default; comfort presets (§15.2) |
| Hands need different design from controllers | Meta hand-tracking guidance: one-handed, sequential actions; physically more tiring | Hands for short natural gestures; big targets; controllers for precise or long play |
| Not everyone has room-scale space | Room-scale designs exclude players | **Seated mode is a first-class mode**: every game can be played seated |
| Empty worlds kill social products | Social worlds feel dead with few people | **Density control**: small room instances (fill one before opening the next), Plaza "busy" signals from real data only, bots never pretend to be people |
| Mobile landscape games use two-thumb controls | Popular mobile 3D games | Left joystick + right camera / actions; big round buttons; HUD in the corners (matches the reference design) |
| Lobbies should be one tap from playing | Mobile competitive games | "Quick Play" button always visible. Walking is optional, never required |

### 2.3 What "Modern" Means for This Product
1. **Spatial, social presence** (see and hear real people) instead of menus.
2. **Instant access** (a URL, no install, works on a cheap phone).
3. **Cross-reality** (phone, desktop and headset players share one room).
4. **AI-assisted, not AI-faked** (captions, translation, coaching, moderation, but never fake players or fake activity).
5. **Trust you can see** (fair-roll badges, visible escrow, clear fees).

---

## 3. Design Pillars

| # | Pillar | Means | We will NOT |
|---|---|---|---|
| P1 | **Play in two taps** | Quick Play is always one tap away. Walking the world is optional fun | Force players to walk through the world to start a game |
| P2 | **Readable at a glance** | Clear silhouettes, high contrast, big numbers, colour + shape coding | Let effects or decoration hide game information |
| P3 | **Comfort first** | Stable horizon, no forced camera moves in VR, seated play | Shake the camera, or move the VR camera without the player's input |
| P4 | **Trust is visible** | Escrow, pot, fees, fair-roll proofs shown in the world | Hide fees or outcome logic behind effects |
| P5 | **Local soul, global quality** | Rwandan motifs, local game, local languages, world-class polish | Use cultural symbols as decoration without cultural review |
| P6 | **One world, every device** | Same rooms, voice and games across phone, desktop and VR | Make features VR-only that affect money or competition |
| P7 | **Respect time and money** | Session clock, calm money moments, easy exits | Use casino dark patterns (§13.3) |

---

## 4. Device and Platform Matrix

### 4.1 Targets

| Class | Example devices | Browser | Renderer | Default tier | VR |
|---|---|---|---|---|---|
| Low-end Android | 2–3 GB RAM, budget chipsets | Chrome | WebGL 2 | **Lite** | — |
| Mid-range Android | 4–8 GB RAM (2023+) | Chrome / Samsung Internet | WebGPU or WebGL 2 | **Standard** | Phone AR (Phase 2) |
| iPhone | iPhone 12+ | Safari | WebGPU (Safari 26+) / WebGL 2 | Standard | **No WebXR** |
| Desktop / laptop | Integrated or discrete GPU | Chrome / Edge / Safari / Firefox | WebGPU / WebGL 2 | Standard / Ultra | PC VR via Chrome / Edge |
| Standalone VR | Quest 3 / 3S, Android XR headsets, Pico | Quest Browser / Chrome | WebGL 2 / WebGPU | **VR** | ✅ |
| Premium spatial | Apple Vision Pro | Safari (visionOS) | WebGL 2 / WebGPU | VR | ✅ (immersive-vr) |

### 4.2 Orientation and Layout Rules
| Context | Phone | Tablet | Desktop | VR |
|---|---|---|---|---|
| 3D world | **Landscape only** (portrait shows "Rotate your phone" + Classic 2D option) | Landscape (portrait allowed with a side-panel layout) | Any window ≥ 1024 × 600, 3-pane | Immersive |
| Games | **Landscape only** | Landscape | Any | Immersive (seated or standing) |
| Wallet / KYC / settings | Side sheet over the world (landscape); full page if opened outside the world (either orientation) | Side sheet | Right panel / modal | Floating panel (wrist menu → panel) |

### 4.3 Capability Detection (Start-up)
```
on start:
  gpu      = navigator.gpu ? 'webgpu' : (webgl2 ? 'webgl2' : 'none')
  xr       = navigator.xr && await navigator.xr.isSessionSupported('immersive-vr')
  ar       = navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')
  memory   = navigator.deviceMemory (if available)
  network  = navigator.connection?.effectiveType, saveData
  tier     = pickTier(gpu, memory, network, short GPU benchmark ≤ 1 s)
  → show "Enter VR 🥽" only if xr === true
  → if gpu === 'none' or saveData → Classic 2D
  → player can change the tier anytime in Settings → Graphics
```

---

## 5. Art Direction and Visual Language

### 5.1 Style
- **Stylised, warm, optimistic 3D:** soft shading, bright sky, rounded architecture, lush plants, glowing neon accents. The reference design sets the mood.
- **"Kigali tomorrow":** a clean, green, modern city plaza on a hill, with glass, wood and terracotta, and views of the thousand hills.
- **Readability over realism:** strong silhouettes, limited material count, no visual noise near game surfaces.
- **Day / night cycle linked to Kigali time (CAT):** morning light, afternoon sun, evening neon. Neon portals become the hero at night. (VR: no fast sky changes; the change happens over hours.)

### 5.2 Cultural Motifs (Requires Cultural Review Before Use)

| Motif | Where it's used | Rule |
|---|---|---|
| **Imigongo** (geometric spirals, zig-zags and diamonds; black, white, red-ochre) | Portal frames, hall walls, Igisoro Court floor inlays, loading patterns | Use authentic geometry developed with Imigongo artists / cooperatives. Credit them in the Hall of Champions / About |
| **Agaseke** (woven basket with a conical lid) | Plaza fountain sculpture, trophy for Player of the Day, Ludo token "pawn" skin | Respectful, celebratory use only |
| **The thousand hills** | Skyline backdrop (Gaussian splat on Ultra, painted HDRI elsewhere) | — |
| **Igisoro boards** (carved wood) | Igisoro Court tables, VR seeds and board | Board proportions and rules validated by experts (SRS FR-G3-01) |
| **Intore-inspired celebration** | Optional "victory dance" emote | **Only** with cultural advisers' approval. Can be removed if inappropriate |

### 5.3 Colour Tokens

**Brand and environment:**

| Token | Hex | Use |
|---|---|---|
| `brand.indigo` | `#22266E` | Signs, panels, HUD backgrounds (with 80% opacity) |
| `brand.sky` | `#3DA9FC` | Accents, links, selection rings |
| `brand.gold` | `#FFC83D` | Title text, highlights, level stars |
| `imigongo.ochre` | `#B5532A` | Cultural accents, Igisoro Court |
| `imigongo.black` | `#1B1B1B` | Pattern lines |
| `imigongo.white` | `#F4EFE6` | Pattern fills, warm UI surfaces |
| `env.hill` | `#4E9F5B` | Vegetation, landscape |

**Game portal colours (neon frames and hall themes):**

| Token | Hex | Game |
|---|---|---|
| `game.pool` | `#2F80ED` (neon blue) | 🎱 Pool Hall |
| `game.ludo` | `#FF8A1F` (neon orange) | 🎲 Ludo Lounge |
| `game.igisoro` | `#27AE60` (neon green) | 🌰 Igisoro Court |
| `game.arena` | `#9B51E0` (neon purple) | 🏆 Tournament Arena |
| `game.soon` | `#8A94A6` (dim grey, pulsing) | Coming-soon portals |

**Semantic (UI):**

| Token | Hex | Use |
|---|---|---|
| `coin` | `#F5B301` | Coins only. Never used for decoration, so it always means money |
| `star` | `#7CC4FF` | Stars (practice currency). Must look clearly different from coins |
| `success` | `#22C55E` | Win, confirmed |
| `warning` | `#F59E0B` | Timers below 10 s, low balance |
| `danger` | `#EF4444` | Errors, report, leave match |
| `surface` | `#FFFFFF` @ 92% / `#0F1222` @ 88% (dark) | HUD panels (light / dark) |

- **Contrast:** HUD text ≥ 4.5:1 against its panel (WCAG AA). Never put HUD text directly over the 3D scene without a panel or a strong shadow.
- **Colour is never the only signal:** Ludo players also use **shapes** (● ▲ ■ ◆), pool balls show **numbers and stripes**, timers use **ring shape + number**.

### 5.4 Typography

| Role | Typeface | Notes |
|---|---|---|
| Display (signs, titles, celebrations) | **Baloo 2** (ExtraBold) | Rounded, friendly, matches the reference sign style |
| UI text | **Inter** | High legibility at small sizes, full French accents, Latin script for Kinyarwanda / Swahili |
| Numbers (coins, timers, scores) | Inter, **tabular figures** | Numbers don't jump when they change |

- Phone landscape UI: body 14–16 px, labels ≥ 12 px, coin amount 18 px semi-bold.
- **3D signs** use SDF / MSDF text (sharp at any distance) with 2–3 LOD sizes.
- **VR text:** body text at least ~1° of visual angle (about 17 mm of letter height per metre of distance). World panels sit at 1.0–1.5 m. Validate on real devices.

### 5.5 Iconography and Shapes
- Rounded, filled icons with 2 px outlines (matching the round action buttons in the reference design).
- Game icons: 🎱 cue ball with blue ring, 🎲 die with orange ring, 🌰 seed with green ring.
- Corners: panels 16 px radius, buttons fully round (actions) or 12 px (text buttons).

### 5.6 Motion Principles

| Motion | Duration | Easing |
|---|---|---|
| HUD panel in / out | 180–220 ms | ease-out / ease-in |
| Proposal card appear | 240 ms, spring (slight overshoot) | spring(1, 80, 12) |
| Camera room → table (screen) | 1,200 ms | ease-in-out (cubic) |
| Camera room → table (VR) | **300 ms fade** to black and back, never a fly-through | linear fade |
| Coin flow to pot / to winner | 600–900 ms arc | ease-out |
| Level-up celebration | ≤ 2.5 s, skippable | — |

`prefers-reduced-motion` (and the in-app setting): replace movement with fades, disable particles, no camera dolly.

---

## 6. World Design

### 6.1 World Metrics (Units in Metres)

| Metric | Value | Why |
|---|---|---|
| Avatar height | 1.70 m (range 1.55–1.90) | Real-scale in VR |
| Walk / run speed (screen) | 3.0 / 5.5 m/s | Stylised, faster than real so the Plaza never feels slow |
| VR smooth locomotion speed | 2.0 m/s max (optional mode) | Comfort |
| Plaza diameter | 60 m | Run across in about 11 s |
| Max portal-to-portal distance | 25 m | Any game is 5 s away |
| Interaction radius (prompt appears) | 2.5 m | Comfortable on phone and VR |
| Proximity voice | Full volume ≤ 2 m, fades to silent at 8 m | Natural conversations, private enough |
| Personal space bubble | 0.6 m (screen), 0.9 m (VR) | Anti-harassment |
| Door / portal size | 3.0 m wide × 4.0 m high | Readable from far, comfortable to walk through in VR |
| Pool table (playing surface) | 2.54 × 1.27 m (9 ft) | Real size in VR |
| Pool table footprint incl. cue zone | 5.5 × 4.2 m | Space to walk around and stroke in VR |
| Ludo / Igisoro table | 1.2 × 1.2 m (Ludo), 1.4 × 0.7 m (Igisoro), height 0.75 m | Seated reach in VR |

### 6.2 Gukirana Plaza (Hub) Layout

```
                                N (view of the hills, Gaussian-splat backdrop on Ultra)
                 ┌───────────────────────────────────────────────────┐
                 │        🏆 ARENA PORTAL (purple)                   │
                 │                                                   │
   🔜 Coming     │   🎱 POOL          ⛲ AGASEKE          🎲 LUDO     │  🔜 Coming
   soon portal   │   PORTAL (blue)   FOUNTAIN + POTD    PORTAL       │  soon portal
                 │                   HOLOGRAM          (orange)      │
                 │                                                   │
                 │   📋 WELCOME       🌰 IGISORO        🏧 WALLET     │
                 │   BOARD (news,     PORTAL (green)    KIOSK +      │
                 │   events)                            ❓ HELP DESK  │
                 │                                                   │
                 │              ◉ SPAWN CIRCLE (south)               │
                 └───────────────────────────────────────────────────┘
                                         S
```

| Zone | Content | Interaction |
|---|---|---|
| **Spawn circle** | Arrival point facing north, so the big title sign and portals are in view (as in the reference design) | Glowing floor paths lead to each portal |
| **Title sign** | "GUKIRANA PLAYGROUND · Play · Meet · Win" (localised) | Landmark for orientation |
| **Portals** | Neon frames (Imigongo-pattern inlay), with a live / cached preview of the room inside and a live player count | Walk through, or tap / click → enter. Prompt "E · Enter Pool Hall" |
| **Agaseke fountain + Player of the Day hologram** | The day's champion as a rotating avatar hologram with stats (SRS §5.10) | Tap → profile / share card |
| **Welcome board** | News, events, new games, tournaments | Tap → details |
| **Wallet kiosk** | A glowing coin ATM-style kiosk | Opens the wallet side sheet (top-up / withdraw) |
| **Help desk** | AI assistant host (clearly labelled "AI Guide"), and an "ask a human" button | Opens support |
| **Coming-soon portals** | Dim, pulsing frames for future games | "Notify me" |

**Wayfinding:** floor paths in each game's colour; a mini-map in the joystick (phone) or bottom-left (desktop); "Quick travel" (tap a portal on the map → short fade → arrive).

### 6.3 Game Halls

| Hall | Theme | Mood / Music | Signature element |
|---|---|---|---|
| 🎱 **Pool Hall** | Night-club pool lounge: dark wood, blue neon, hanging lamps over tables | Smooth Afro-house, low tempo | Lamp above each table lights up when a match is live |
| 🎲 **Ludo Lounge** | Rooftop garden at sunset with view of the hills, colourful cushions | Upbeat Afrobeat / Amapiano-inspired | Giant floating die over the lounge shows the latest "fair roll" verification count |
| 🌰 **Igisoro Court** | Traditional-modern courtyard: Imigongo walls, carved wooden benches, a big tree in the middle | Acoustic, traditional instruments, calm | Elders' tree: Hall of Masters (top Igisoro players) carved on the trunk as name plaques |
| 🏆 **Tournament Arena** | Stage, stands, big screen | Event music, crowd ambience | Live finals on a giant table with the camera feed |

Each hall: an entrance foyer → room doors labelled by stake band (Free ⭐ / Bronze / Silver / Gold / VIP) and language, with live counts. Doors to rooms you can't enter (not enough coins, not verified) are visible but **locked with a reason** ("Needs 200 🪙 · Top up").

### 6.4 Room Layout (Typical: 24 × 18 m)

```
 ┌──────────────────────────────────────────────────────────┐
 │ 📋 CHALLENGE BOARD WALL (open challenges, tap → walk)    │
 │                                                          │
 │   [T1]        [T2]        [T3]          🛋️ LOUNGE        │
 │                                         (chat area,      │
 │   [T4]        [T5]        [T6]          bean bags,       │
 │                                          screen showing  │
 │   👀 spectator rail around each table     live matches)  │
 │                                                          │
 │ 🚪 DOOR (back to hall)            🏧 mini wallet kiosk     │
 └──────────────────────────────────────────────────────────┘
```

**Table states (visible from across the room):**

| State | Visual |
|---|---|
| Free | Soft white light, "Sit to post a challenge" when close |
| Open challenge | **Floating coin badge** "100 🪙" in the game colour + creator's avatar waiting. Pulse every 4 s |
| In play | Lamp at full brightness, spectator count "👀 5", a ring on the floor marking the playing area (spectators can't step in) |
| Reserved (proposal accepted, players walking) | Amber glow with both players' names, 30 s |

### 6.5 Instance Density
- Room instance capacity: about 50. **Fill instances to ~70% before opening a new one**, so rooms feel alive.
- Plaza instance: up to about 80 avatars (simplified distant avatars).
- Player counts on portals and doors are **always real**. No fake numbers.

---

## 7. Avatar System

### 7.1 Style and Proportions
- Stylised semi-realistic (as in the reference design): about 1:6 head-to-body ratio, expressive faces, clean shapes.
- **Representation:** a wide range of African skin tones and features by default. Authentic hair styles (afro, locs, braids, twists, cornrows, fades, headwraps / igitambaro), plus modest-wear options.
- Outfits: casual / streetwear / traditional (Imishanana-inspired), sports jerseys (licensing permitting), branded cosmetics (§6.7 of the SRS).

### 7.2 Customisation Slots
`body`, `skinTone`, `face`, `eyes`, `brows`, `hair`, `facialHair`, `top`, `bottom`, `shoes`, `headwear`, `glasses`, `accessory`, `headsetSkin` (decorative VR headset as in the reference image, optional), `entranceEffect`, `nameplateFrame` (from levels / awards).

- **Avatar from selfie (optional):** on-device AI proposes face shape / skin tone / hair; the photo never leaves the device.
- No avatar may impersonate a real public figure. Names and avatars are moderated (SRS FR-SOC-07).

### 7.3 Technical Budgets

| LOD | Distance | Triangles | Materials | Bones |
|---|---|---|---|---|
| LOD0 | < 5 m | ≤ 20k (Ultra) / 12k (Standard) | ≤ 3 | ≤ 65 |
| LOD1 | 5–12 m | ≤ 6k | 2 | ≤ 40 |
| LOD2 | 12–25 m | ≤ 2k | 1 | ≤ 20 |
| Impostor | > 25 m | Billboard | 1 atlas | — |

Lite tier: max 10 avatars at LOD1, the rest as impostors or hidden (the names list still shows everyone).

### 7.4 Animation Set
| Category | Clips |
|---|---|
| Locomotion | idle (3 variants), walk, run, turn-in-place, sit-down, sit-idle, stand-up, teleport-in / out |
| Social | wave, clap, thumbs-up, point, laugh, think, shrug, "GG" handshake (2-person), dance ×3 |
| Game | lean-over-table, chalk-cue, aim (pool), throw-dice, scoop-seeds, celebrate (small / big), console (opponent comforts) |
| Talk | Mouth visemes from voice amplitude (screen), viseme blend + head nod (VR) |
| VR | Upper-body IK (head + 2 hands → arms / spine), procedural legs |

### 7.5 Name Tag and Status
```
        ◉27  Aline_K  🇷🇼
      ⭐1,720 · 🎱 Looking for 100🪙
              🎙️ (pulses when talking)
```
- Shown ≤ 12 m (screen), ≤ 8 m (VR). Text scales to keep a constant on-screen size.
- Status chip colours: Available (green), Looking for game (game colour + stake), In game (grey + game icon), Do not disturb (red).

---

## 8. Camera, Movement and Controls

### 8.1 Third-Person Camera (Phone and Desktop)

| Parameter | Phone landscape | Desktop |
|---|---|---|
| Distance behind avatar | 4.0 m (zoom 2.5–7 m) | 4.5 m (zoom 2–10 m) |
| Height offset | 1.6 m | 1.7 m |
| Default pitch | −12° | −10° |
| Vertical FOV | 60° | 55° |
| Collision | Sphere cast; the camera moves in, never through walls | Same |
| Auto-follow | Recenters behind the avatar after 2 s of walking without camera input | Off by default (mouse controls camera) |
| First-person toggle | Yes | Yes |

### 8.2 Control Mapping

**Phone (landscape):**
```
┌──────────────────────────────────────────────────────────────┐
│ [profile chip]                               [🪙 250] [⚙️]   │
│                                                              │
│  LEFT HALF: touch anywhere →       RIGHT HALF: drag = camera │
│  floating joystick appears          pinch = zoom             │
│  (fixed joystick option)            tap object = interact    │
│                                                              │
│ ┌─────┐ joystick                     [💬][🎙️]               │
│ │ ◎ ▲ │ + mini-map ring             [🏃] [🙋] [✋]            │
│ └─────┘                              run emote interact      │
└──────────────────────────────────────────────────────────────┘
```
| Action | Gesture |
|---|---|
| Move | Left joystick (floating or fixed), or **tap the floor to walk there** |
| Look | Drag on the right half |
| Zoom | Pinch |
| Interact | Tap the object / avatar, or the ✋ button when a prompt shows |
| Run | Hold 🏃 or push the joystick to its edge |
| Emote | 🙋 → radial emote wheel |
| Talk | 🎙️ hold to talk (push-to-talk), or toggle |
| Chat | 💬 → side sheet with the keyboard |

**Desktop:**

| Action | Key / mouse |
|---|---|
| Move | WASD / arrows, or click the floor |
| Look | Right-drag (or locked pointer mode) |
| Zoom | Wheel |
| Interact | **E** or left-click |
| Run | Shift |
| Emote wheel | **G** |
| Push-to-talk | **V** (hold) |
| Chat | **T** / Enter |
| Map | **M** |
| Quick Play | **Q** |
| Wallet | **B** |
| Gamepad | Supported (Gamepad API): left stick move, right stick look, A interact, Y emote |

**VR controllers / hands:**

| Action | Controllers | Hands |
|---|---|---|
| Teleport | Thumbstick forward → arc → release | Palm-down pinch → arc → release |
| Snap turn | Thumbstick left / right (30° / 45°) | Pinch + flick left / right |
| Select / interact | Trigger | Pinch |
| Grab (dice, seeds, tokens) | Grip | Grab / close hand |
| Wrist menu | Look at the left wrist / menu button | Palm up |
| Push-to-talk | B / Y hold (or open mic) | — (open mic + mute toggle on the wrist) |
| Emote | Hold A → radial | Gesture presets (wave = wave) |

### 8.3 Haptics
| Event | Phone (Vibration API) | VR controllers |
|---|---|---|
| Button press | 10 ms | Light tick |
| Ball contact (pool) | 15 ms (strength ∝ impact) | Pulse ∝ impact |
| Dice landing | 20 ms | Double tick |
| Seed drop (Igisoro) | 8 ms per seed (capped) | Soft tick per seed |
| Your turn | 2 × 30 ms | Pulse |
| Win | 3 short pulses | Rising pattern |
| Money confirmation | 40 ms on confirm | Strong single pulse |

All haptics can be switched off.

---

## 9. HUD and UI System

### 9.1 Landscape HUD Grid (Phone)
- Safe areas: respect `env(safe-area-inset-*)` (notches, rounded corners, gesture bar).
- **Four corners + edges:**

| Zone | Content |
|---|---|
| Top-left | Profile chip: avatar thumbnail, username, level ring / star, tier |
| Top-centre | Location breadcrumb ("Pool Hall · Gold room 3"), alerts (toasts drop from here) |
| Top-right | Coin pill (🪙 250 → tap for wallet), Stars pill (in free areas), settings ⚙️ |
| Bottom-left | Joystick + mini-map ring |
| Bottom-right | Action cluster: Run · Emote · Interact (+ mic, chat) |
| Right edge | Side sheets slide in: chat, people nearby, proposals, wallet |
| Centre | Interaction prompts close to the target object (screen-space, anchored to the 3D position) |

### 9.2 Component Specifications

| Component | Size (phone landscape) | States | Notes |
|---|---|---|---|
| **Profile chip** | 200 × 56 px | default, level-up glow | Tap → profile sheet |
| **Coin pill** | min 96 × 40 px | default, increasing (count-up), decreasing, pending (spinner dot) | Tap → wallet. Long-press → RWF value |
| **Action button** | 64 px round (Interact 72 px) | idle, pressed, disabled, highlighted (prompt available) | ≥ 48 px touch target guaranteed |
| **Joystick** | 120 px base, 52 px knob | hidden (floating), active | Mini-map inside the ring (north arrow) |
| **Interaction prompt** | Pill, 44 px high | near, active, cooldown | "E · Enter Pool Hall" / "Tap · Propose to Aline" |
| **Side sheet** | 360–420 px wide, full height | open, half, closed | Swipe right to close |
| **Proposal card** | 340 × 260 px (sheet), world-space in VR | new, countered, accepted, expired, declined | See §10.3 |
| **Toast** | max 360 px wide | info, success, warning, error | Max 2 visible; 3 s |
| **Rotate screen** | Full screen | — | Animation of a phone turning + "Use Classic lobby" button |
| **Timer ring** | 48–64 px | normal, < 10 s (amber pulse), < 5 s (red + haptic) | Number in the centre |

### 9.3 Desktop Layout
3-pane (SRS §8.4.3): left = map / rooms, centre = world view with the same corner HUD (smaller), right = chat / people / proposals / wallet summary. Panels collapse below 1280 px.

### 9.4 VR UI
| Element | Placement | Rules |
|---|---|---|
| **Wrist menu** | Left wrist, appears when you look at the palm / wrist | Coins, level, friends, proposals, mute, settings, leave |
| **World panels** | 1.0–1.5 m away, slightly below eye level, curved for wide panels | Follow the head *lazily* (only after 30° offset), never locked to the head |
| **Proposal card** | Floats between both players at chest height | Two-step confirm (press + hold 1 s) |
| **Game HUD** | Attached to the table edge (diegetic): timers, pot, scores on small stands | No HUD floating in the face |
| **Name tags** | Above heads, always facing the viewer | Fade with distance |
| **Pointer** | Laser from the controller / hand ray, with a dot cursor on panels | Snap to buttons |

---

## 10. Core Experience Flows

### 10.1 First Launch and Onboarding (Target ≤ 90 s to the First Practice Match)

| Step | Screen / scene | Duration |
|---|---|---|
| 1 | Brand splash (logo + hills), language picker (Kinyarwanda / English / Français / Kiswahili) | 5 s |
| 2 | Phone number + OTP (or "Explore as guest") | 20 s |
| 3 | **Quick avatar**: choose 1 of 8 presets → optional "customise later" (or selfie assist) | 15 s |
| 4 | **Rotate your phone** (if in portrait) | — |
| 5 | Spawn in the Plaza. The AI Guide waves: "Muraho! Walk to the blue portal to play pool" (floor path lights up) | 15 s |
| 6 | Walk tutorial (joystick hint) → enter the Pool Hall → sit at the practice table | 20 s |
| 7 | Practice match vs AI with inline hints → Stars reward + Level 2 | — |
| 8 | Soft prompts later: install PWA, verify for cash rooms, invite friends | — |

"Skip" is available at every step. "Quick Play" is visible from step 5.

### 10.2 Enter a Room
```
Plaza → walk into a portal (or Quick Travel from the map)
 → 0.4 s fade → Hall foyer → doors with live counts
 → tap / walk through a door → room
   (VR: fade 300 ms; screen: short walk-through + fade)
Preload rule: when the player is within 10 m of a portal, prefetch that hall's assets.
```

### 10.3 Propose → Agree → Play (Storyboard)
```
[1] You walk near Aline. Prompt: "✋ Interact"
[2] Tap → radial menu: 👋 Wave · 💬 Message · 🎙️ Talk · ⚔️ Propose · 👤 Profile · 🚫 Block/Report
[3] ⚔️ Propose → Proposal card:
      Game 🎱 8-Ball (Best of 3) · Stake [100 🪙] · Fee 8 🪙 · Winner gets 200 🪙 · Table T4
      [Send]
[4] Aline sees the card float in front of her (sheet on phone / panel in VR)
      [Accept]  [Counter]  [Decline]      ← countdown 60 s
[5] Counter → she changes the stake to 50 🪙 → you see "Aline countered: 50 🪙" → Accept
[6] Accept → confirmation: "You pay 54 🪙 (50 stake + 4 fee)" → slide-to-confirm (VR: press-and-hold)
[7] Coins animate from both players into a glowing POT above table T4 (escrow made visible)
[8] Both avatars walk / auto-path to T4 (screen) or teleport (VR) → sit → the camera moves to the game view
[9] Match → result → POT flies to the winner → emotes → [Rematch] [Leave table]
```

### 10.4 Top-Up from Inside the World
Coin pill / wallet kiosk → side sheet → choose a pack (50 / 100 / 500 / 1,000 🪙) → "1,000 RWF → 100 🪙, fee 0" → MoMo / Airtel → "Approve on your phone" (animated phone icon) → success toast + coin count-up. The world keeps running behind the sheet, and voice stays connected.

### 10.5 Player of the Day Ceremony (10:00 CAT)
- The Plaza hologram changes to the new champion with a short fanfare (≤ 5 s) and confetti (reduced-motion: a simple glow).
- The champion gets a notification + their share card; their avatar wears the daily-champion frame for 24 h.
- Ceremony visuals celebrate **skill** ("15 wins · beat 3 Gold players"), never the prize amount.

### 10.6 Spectating
Walk to the spectator rail around a live table, or tap "Watch" on a table. Screen: the camera switches to a spectator view of the game with a delay badge "Live · 10 s delay" (cash matches). VR: stand at the rail and watch the real table.

### 10.7 Error and Edge States
| Situation | Design |
|---|---|
| Lost connection in the world | Avatar greys out for others; for you: "Reconnecting…" banner, the world freezes softly, auto-retry |
| Lost connection in a match | Full-screen "Reconnecting · 0:45 left to rejoin" with the rules (SRS FR-GS-03/04) |
| Low frame rate for 10 s | Toast: "Switch to Lite mode for smoother play?" [Switch] [Keep] |
| Not enough coins | Locked door / disabled Accept with a reason + "Top up" |
| Proposal expired | Card fades with "Expired", one-tap "Send again" |
| VR session ends unexpectedly | Return to the screen view in the same room, same position |

---

## 11. Game Design Specifications

### 11.1 Common Game Screen Framework (Landscape)

```
┌──────────────────────────────────────────────────────────────────────┐
│ [◀ Leave]   🎱 8-Ball · Best of 3 · Game 1      POT 200 🪙   🛡️ Fair   │
├───────────┬──────────────────────────────────────────────┬───────────┤
│ 🧑 YOU     │                                              │ 🧑 ALINE   │
│ Lvl 5     │                                              │ Lvl 27    │
│ ⭐1,540    │            GAME SURFACE (board / table)       │ ⭐1,720    │
│ ◔ 0:24    │            centered, max size, letterboxed     │ ◔ —       │
│ Solids ●  │                                              │ Stripes ◐ │
│           │                                              │           │
├───────────┴──────────────────────────────────────────────┴───────────┤
│ [😀 emotes] [💬 quick chat] [🎙️ table voice: off]     game controls → │
└──────────────────────────────────────────────────────────────────────┘
```

| Element | Rule |
|---|---|
| Player panels | Left = you, right = opponent (4-player: panels in the 4 corners, matching board seats) |
| Turn indicator | Active panel glows in your colour + timer ring counts down |
| POT banner | Always visible in cash matches: "POT 200 🪙". Tap → "100 + 100 in escrow · Fees paid: 8 each" |
| Fair badge 🛡️ | Tap → seed commit hash now, full verification after the match (SRS §7.2) |
| Leave | Confirmation with consequences ("Leaving = forfeit. You lose 100 🪙") |
| Game surface | Never covered by HUD. Panels shrink on small screens (avatar + timer only) |
| Spectator count | Small "👀 5" near the POT |

**Result screen:** winner avatar celebration (2 s), POT flies to the winner, summary card: result, coins won / lost, fees paid, tax withheld (if any), rating change, XP gained, level progress, best moment clip → [Rematch] [Share] [Back to room].
**Loss screen tone:** neutral and respectful ("Good game. Rating −12"), with a coaching tip in free mode. No "so close!" or near-miss messaging (§13.3).

### 11.2 🎱 8-Ball Pool

#### Camera modes
| Mode | Device | Description |
|---|---|---|
| **Top-down (2D-like)** | Phone default (clearest for aiming), Lite tier | Orthographic or near-orthographic view, whole table visible |
| **3D aim camera** | Desktop default, phone option | Behind the cue ball, low angle; orbit by drag; switches to an overview during ball movement |
| **VR** | Headset | Real-size table; walk around it; seated mode = a lower table + "snap viewpoint" positions around the table |

#### Aiming UX
| Control | Phone landscape | Desktop | VR (laser-aim) |
|---|---|---|---|
| Aim direction | Drag anywhere on the table to rotate the cue around the cue ball | Mouse position | Point the controller ray at the target |
| Fine aim | **Fine-aim wheel** on the left edge (drag up / down = ±0.1°) | Scroll wheel / arrow keys | Thumbstick micro-adjust |
| Power | **Vertical power bar on the right edge**: pull down, release to shoot | Hold left button + drag back, release | Hold trigger: pull-back distance = power; release |
| Spin | Cue-ball widget (tap a point: top / back / side spin) | Same widget (click) | Same widget on the table edge panel |
| Guide line | Length by room tier (SRS FR-G1-03); shows the first contact + object-ball direction | Same | Same, drawn on the table |

#### Feel and feedback
- Physics: deterministic engine (SRS FR-G1-05/06). The client predicts; the server confirms.
- Ball contact sound: pitch and volume ∝ impact speed; pocket "drop" sound + net / wooden rattle.
- Camera: a gentle follow of the cue ball during the shot (screen), overview when many balls move.
- Fouls: a big, clear banner "Foul: scratch · Ball in hand for Aline" + the rule in one line.
- **Ball in hand:** a ghost cue ball follows the finger / mouse / ray; green = valid spot, red = invalid.
- **Accessibility:** numbers on all balls, stripe / solid patterns, a high-contrast table cloth option, a colour-blind palette.

#### Readability
- Table cloth default: deep blue-green (`#1F6F78`), high contrast with all balls.
- Pocket rims glow in the game colour when the 8-ball is called.

### 11.3 🎲 Ludo

#### Board design
- Classic cross layout, 15 × 15 grid. Default skin: modern clean. Unlockable skins: Imigongo board, Kigali-skyline board, night neon.
- Player colours + shapes: **Red ●, Green ▲, Yellow ■, Blue ◆**. Shapes on tokens, home areas and the path start squares.
- Safe squares: a star icon + subtle shield glow.

#### Dice (fairness-first animation)
```
1. Player taps "Roll" (phone/desktop) or throws the die (VR)
2. Client sends roll intent → server returns value v (provably fair, SRS §7.2)
3. Client plays a throw animation that lands on v:
     - screen: one of ~24 pre-baked throw animations per face (seeded variety)
     - VR: the hand's throw velocity starts a short physics flight, then the die
           settles on face v (the solver blends to the final pose in the last 300 ms)
4. Info tooltip (first time and in Help): "Your throw style doesn't change the result.
   Every roll is generated fairly by the server and can be verified."
```
- **Never fake physics outcomes.** The animation is presentation only, and that is said openly.

#### Move UX
- After a roll, movable tokens bounce gently. Tap a token → its destination square previews (ghost token + path dots). Tap again (or the destination) to confirm.
- One legal move only → auto-select it with a 1 s preview, unless the "Always confirm" setting is on.
- **Capture:** the captured token flies home in an arc, with a short sound. No humiliating effects.
- Timer ring per turn (15 s default). Auto-move on timeout (SRS FR-G2-04).

#### Skill variants UI (SRS FR-G2-02)
| Variant | Extra UI |
|---|---|
| **Ludo Sprint** (fixed moves) | Moves-left counter per player + live score bar |
| **Ludo Timed** | Big match clock + live score |
| **Ludo Dice Draft** (duplicate dice) | "Same dice for everyone" badge; a preview strip of the next 3 shared dice values (if the variant shows them) |

#### 4-player layout
Board centred; 4 player panels in the corners next to their home base; the active player's corner glows.

#### VR
The board sits on a table; players sit around it; pick up the die and throw it into a tray; grab and place tokens (snapping to valid squares only, with an invalid-move shake).

### 11.4 🌰 Igisoro

#### Board
- 4 rows × 8 pits (each player owns 2 rows). Carved wood with Imigongo inlays. Seeds as smooth, slightly varied shapes.
- **Seed count labels** on every pit (toggle; on by default for new players), so strategy doesn't depend on counting tiny objects.

#### Move UX
- Tap a pit you own → **move preview**: ghost path showing where the last seed lands and, if it captures, which pits flash. Tap again to confirm. (Preview is allowed in free mode and practice; in **cash matches it is allowed for all players equally** or disabled by room rule, so no one gets more help than another.)
- **Sowing animation:** seeds hop pit by pit with a soft wooden "tok" per seed. Speed setting: Normal / Fast / Instant. Long relay sowing can be fast-forwarded with a tap.
- **Captures:** captured pits glow ochre, seeds slide to the capturing player's side in an arc.
- Chess-style clock (for example 5 + 3) shown as two timer rings.

#### Learning
- Interactive tutorial (3 short lessons: sowing, capturing, relay sowing) with the AI Guide.
- "Rules" button in every match. Optional "Elder tips" hints (practice only).
- The AI practice opponent has 5 levels (SRS FR-G3-05).

#### VR
Scoop seeds with a grab gesture from a pit; seeds are automatically sown one by one along the path as the hand moves (or a release triggers auto-sow). Seated mode is the default for Igisoro.

### 11.5 Template for Future Games
Each new game (SRS §10) must deliver this design pack:
1. Portal / hall concept (theme, colour token, music mood)
2. Table / board model at real scale + 3 LODs
3. Camera modes for phone landscape, desktop, VR (seated + standing)
4. Control mapping for all 3 device classes, with **identical intents**
5. HUD layout on the common framework (§11.1)
6. Animation list + sound list + haptics map
7. Accessibility sheet (colour-blind, reduced motion, captions)
8. Tutorial script + AI Guide lines
9. Fairness notes (randomness presentation, input-class parity)
10. Performance budget proof on the reference devices

---

## 12. Social, Voice and Safety UX

### 12.1 Voice
| Element | Design |
|---|---|
| Speaking indicator | 🎙️ pulse above the head + a soft ring on the floor around the speaker |
| Range visual (optional) | Faint circle showing your hearing range when you hold push-to-talk |
| Channels | Selector in the chat sheet: Nearby · Table · Party · Private. The current channel is shown on the mic button |
| Mute states | Mic button: on (green) / push-to-talk (white) / muted (red slash). Muted-by-moderator shows a reason |
| Volume per person | Tap avatar → slider |
| Captions | Optional live captions under the speaker's name tag and in the chat log (translated if enabled) |

### 12.2 Text
- Chat bubbles above avatars (max 2 lines, 6 s), full log in the chat sheet.
- Translated messages show a small 🌐 icon + "Show original".
- Blocked content shows: "Message hidden: contains a phone number or payment request. Never pay anyone outside Gukirana."

### 12.3 Safety Tools (Always 1 Tap Away)
| Tool | Design |
|---|---|
| **Personal bubble** | Others fade out when they enter it. On by default |
| **Block** | Instantly invisible and silent to each other |
| **Report** | Tap avatar → Report → reason → evidence auto-attached (last 30 s of audio on the reporter's device + chat), confirmation "Thanks, our team will review" |
| **Safe zone** | 🛡️ button on the wrist (VR) / in settings (screen) → teleport to a private quiet room |
| **Moderator** | Visible badge + distinct nameplate colour; can't be impersonated (reserved styles) |

---

## 13. Money UX in 3D and Ethical Design

### 13.1 Making Escrow Visible
- When a match starts, both players' coins **fly into a glowing pot above the table**. Spectators see the pot. Tap the pot → "100 + 100 locked in escrow".
- At settlement, the pot flies to the winner and the winner's coin pill counts up. Fees are **not** shown as part of this animation (they were paid at confirmation and are listed on the result card).

### 13.2 Confirmation Patterns
| Device | Pattern |
|---|---|
| Phone | Bottom sheet → slide-to-confirm (above a stake threshold), otherwise a primary button |
| Desktop | Modal with the breakdown → primary button (Enter doesn't confirm money by default) |
| VR | Floating card → **press and hold 1 s** (a ring fills) — prevents accidental pinches |

The breakdown is always: **stake + fee = total to pay · winner gets · balance after**, in coins with RWF on tap.

### 13.3 Ethical Design Rules (Design Must NOT)
| # | Rule |
|---|---|
| E1 | No near-miss effects ("so close!", slow-motion near wins) in cash games |
| E2 | No "losses disguised as wins" (celebration effects when the player lost money overall) |
| E3 | No slot-machine or casino sounds / visuals on coin flows. Coin sounds are soft and short |
| E4 | No fake activity: player counts, "X just won" feeds and busy rooms always reflect real data |
| E5 | No bots presented as people. AI hosts are clearly labelled "AI" and never play cash matches |
| E6 | No pressure timers on money decisions (top-up, accepting high stakes) except the normal proposal expiry |
| E7 | Withdraw is as easy to find as top-up (same sheet, same prominence) |
| E8 | Reality checks are visible in the world: a **session watch** on the avatar's wrist / HUD shows time played today; reminders every 60 min (configurable) |
| E9 | Celebrations are proportional and about skill (shots, streaks, ratings), not about money amounts |

---

## 14. Audio and Haptics

### 14.1 Music and Ambience
| Area | Music | Ambience |
|---|---|---|
| Plaza | Light Afro-pop / ambient, by day-part | Birds, fountain, distant chatter (real voices are separate) |
| Pool Hall | Smooth Afro-house | Ball clicks from other tables (spatial), low murmur |
| Ludo Lounge | Upbeat Afrobeat / Amapiano-inspired | Wind, dice rattles nearby |
| Igisoro Court | Traditional instruments, calm | Leaves, seeds clicking |
| Arena | Event stingers | Crowd |

- Music by licensed or commissioned **Rwandan / East African artists** (marketing value and local identity).
- During a match, music ducks −12 dB; game SFX and table voice have priority.

### 14.2 Mix Levels (Default)
Voice 0 dB (reference) · Game SFX −3 dB · UI −8 dB · Ambience −14 dB · Music −16 dB (−28 dB in matches). The player can adjust each in Settings.

### 14.3 Spatial Audio
- HRTF panning for voice and world SFX.
- Distance model: inverse, refDistance 2 m, maxDistance 8 m (voice) / 20 m (SFX), rolloff 1.5.
- Room acoustics: light reverb preset per hall (club / rooftop / courtyard).

---

## 15. Accessibility and Comfort

### 15.1 Accessibility
| Need | Support |
|---|---|
| Low vision | HUD scale 100–150%, high-contrast mode, large-text mode, screen-reader support in **Classic 2D** (full feature parity) |
| Colour blindness | Shape + number coding everywhere; colour-blind palettes (protan / deutan / tritan) |
| Hearing | Captions for voice and important sounds ("Your turn", "Foul"), visual timer pulses |
| Motor | Tap-to-walk, auto-path to tables, adjustable timers in free mode, one-handed phone layout option for turn-based games, hold-vs-toggle choice for all held actions |
| Cognitive | Simple mode (fewer HUD elements), tutorials repeatable, consistent icons |
| Motion sensitivity | Reduced motion, no camera bob, Classic 2D |

### 15.2 VR Comfort Presets
| Preset | Locomotion | Turning | Vignette | Other |
|---|---|---|---|---|
| **Comfortable** (default) | Teleport only | Snap 45° | Strong | Seated mode suggested |
| **Moderate** | Teleport + smooth (2 m/s) | Snap 30° | Medium | — |
| **Experienced** | Smooth | Smooth turn (opt-in) | Off | — |

Always: stable horizon, no forced camera movement, fade (not fly) transitions, a break reminder every 30–45 min, a "recenter" button.

---

## 16. Performance Budgets

### 16.1 Per Tier

| Budget | Lite (low-end phone) | Standard (mid phone / laptop) | Ultra (desktop GPU) | VR (standalone) |
|---|---|---|---|---|
| Target fps | 30 | 60 (phones may cap at 30–45 with dynamic resolution) | 60+ | **72 min / 90 target** |
| Visible triangles | ≤ 80k | ≤ 300k | ≤ 1M | ≤ 150k |
| Draw calls | ≤ 60 | ≤ 150 | ≤ 400 | ≤ 100 |
| Texture memory | ≤ 96 MB | ≤ 256 MB | ≤ 768 MB | ≤ 256 MB |
| Full-detail avatars | 10 | 25 | 50 | 15 |
| Shadows | Blob shadows | 1 shadow map (1024) | Cascaded (2048) | Baked + blob |
| Post-processing | None | Bloom (low), tone mapping | Bloom, SSAO, AA | Tone mapping only; foveation on |
| Backdrop | Painted skybox | HDRI | **Gaussian splat** hills | HDRI |
| JS heap + GPU memory | ≤ 250 MB | ≤ 400 MB | — | ≤ 400 MB |

### 16.2 Loading
| Asset | Budget |
|---|---|
| 2D lobby shell (first paint) | ≤ 200 KB JS gzipped (SRS NFR-PERF-02) |
| 3D core (engine + Plaza, Standard) | ≤ 8 MB, streamed in the background while the 2D lobby is usable |
| 3D core (Lite) | ≤ 3 MB |
| Each hall | ≤ 4 MB (Standard), ≤ 1.5 MB (Lite), prefetched within 10 m of its portal |
| Each game | ≤ 1.5 MB including assets |
| Avatar (LOD0 + textures) | ≤ 600 KB (Standard) |

All assets: glTF 2.0 + meshopt, KTX2 textures, content-hashed URLs, service-worker cache.

### 16.3 Dynamic Quality
- Monitor frame time. If the average is above budget for 5 s: lower the resolution scale (down to 0.6), then reduce the avatar count, then suggest a lower tier.
- Thermal / battery: Lite mode when battery < 20% or the device reports thermal stress. Idle → cap at 20 fps.

---

## 17. Client Architecture for 3D / VR

### 17.1 Layers
```
┌──────────────────────────────────────────────────────────────────┐
│ UI layer (React 19 DOM): HUD, sheets, wallet, chat  (Zustand)    │
├──────────────────────────────────────────────────────────────────┤
│ Scene layer: React Three Fiber + Three.js WebGPURenderer (TSL)   │
│   - World scenes (Plaza, halls, rooms)  - Game scenes (modules)  │
│   - @react-three/xr for WebXR sessions                           │
├──────────────────────────────────────────────────────────────────┤
│ Simulation: ECS (e.g. koota / bitECS) for avatars, tables, props │
│   - Character controller (Rapier, client-only, world movement)   │
│   - Animation (glTF clips + IK for VR upper body)                │
├──────────────────────────────────────────────────────────────────┤
│ Input abstraction: touch / mouse / keyboard / gamepad / XR       │
│   → Actions (Move, Look, Interact, Emote, Talk, Aim, Power,      │
│              Confirm…) → Game Intents (identical on all devices) │
├──────────────────────────────────────────────────────────────────┤
│ Networking: World sync (WebTransport datagrams, 10–20 Hz,        │
│   interest management) · Game channel (authoritative server)     │
│   · Voice (LiveKit WebRTC SFU) · Chat (realtime channel)         │
├──────────────────────────────────────────────────────────────────┤
│ Asset streaming: manifest per area, glTF/meshopt/KTX2 loaders,   │
│   priority queue (distance + direction), service-worker cache    │
└──────────────────────────────────────────────────────────────────┘
```

### 17.2 Key Rules
| ID | Rule |
|---|---|
| DS-ARC-01 | **Game modules are renderer-agnostic.** The WASM rules engine (SRS §10) is shared. Each game provides a 2D renderer (Classic / Lite) and a 3D renderer (Standard / Ultra / VR) on the same state. |
| DS-ARC-02 | **Input → Intent mapping is the fairness boundary.** All devices produce the same intent schema. The server validates intents only. |
| DS-ARC-03 | World movement is client-predicted and server-reconciled (positions are not authoritative for money; only presence). |
| DS-ARC-04 | XR session handling: `requestSession('immersive-vr', { optionalFeatures: ['hand-tracking', 'local-floor', 'bounded-floor', 'layers'] })`; graceful fallback when a feature is missing. |
| DS-ARC-05 | Text: MSDF fonts for 3D text; DOM for HUD on screens; world-space UI (uikit-style) in VR. |
| DS-ARC-06 | A single render loop. UI updates outside React render for per-frame values (refs / signals). |
| DS-ARC-07 | Gaussian splats only for static backdrops on Ultra; never for interactive or gameplay objects. |

### 17.3 Asset Pipeline
```
Concept (artists, AI-assisted moodboards allowed) → Blender (modelling, UVs, LODs, baking)
 → glTF export → glTF-Transform (meshopt, dedupe, KTX2 via Basis, LOD packaging)
 → automated checks (triangle / draw-call / texture budgets per tier, naming, scale = metres)
 → content-hashed CDN upload → area manifest
```
- AI-generated textures / concepts are allowed **only with human art direction**, an IP check, and never to recreate existing games' art or real people's likeness.

### 17.4 Testing
- **Device lab:** low-end Android (2 GB), mid Android, iPhone (screen only), Windows / Mac browsers, Quest 3 / 3S, an Android XR headset, Vision Pro (if available).
- **Performance CI:** scripted fly-through of each area per tier, fps / memory capture, fail the build on budget regressions.
- **Visual regression:** screenshots of HUD states in 4 languages × 3 layouts.
- **Comfort playtests** for every VR change (10+ participants, including first-time VR users).

---

## 18. Localisation in 3D
- All in-world text (signs, portal names, room labels) comes from the translation files, rendered as MSDF text. **No text baked into textures.**
- Sign layouts allow +40% text length (French and Swahili are often longer than English).
- Voice prompts of the AI Guide in Kinyarwanda, English, French, Swahili (recorded or high-quality TTS, reviewed by native speakers).
- Greeting by language: "Muraho!" / "Hello!" / "Bonjour !" / "Habari!"

---

## 19. Design QA and Acceptance

### 19.1 Checklist per Release
- [ ] Phone landscape (640×360 → 932×430) verified: HUD in safe areas, no overlap with notches or gesture bars
- [ ] Portrait shows the rotate screen + Classic 2D option
- [ ] Desktop 1280 / 1440 / 1920 widths verified, panels collapse correctly
- [ ] VR: 72 fps minimum on Quest 3S in the busiest room; comfort presets work; seated mode works for every game
- [ ] "Enter VR" button only appears where `immersive-vr` is supported
- [ ] All money confirmations show stake + fee + total + winner gets; VR uses press-and-hold
- [ ] Ethical rules E1–E9 checked by design review
- [ ] Colour-blind simulations pass for all game boards
- [ ] Captions and reduced-motion work in world and games
- [ ] Performance budgets pass in CI for all tiers
- [ ] All in-world text localised in 4 languages, no clipping

### 19.2 Usability Targets
| Metric | Target |
|---|---|
| First-time user reaches first practice match | ≤ 90 s (median) |
| User finds and enters a specific room without help | ≥ 90% success |
| User completes a proposal → match | ≥ 85% success in the first try |
| User correctly states stake, fee and pot after confirming | ≥ 95% |
| VR first-timers reporting discomfort (SSQ / simple scale) after 15 min | ≤ 10% |
| SUS (System Usability Scale) | ≥ 75 |

---

## 20. Design Production Plan

| Stage | Weeks | Output |
|---|---|---|
| **1. Discovery** | 1–3 | Moodboards, cultural advisory sessions (Imigongo, Igisoro), player interviews in Kigali (and outside Kigali), device survey |
| **2. Style frames + design system** | 3–6 | Key art of Plaza / Pool Hall, colour / type tokens, HUD component library (Figma), icon set |
| **3. Greybox** | 4–8 | Plaza + Pool Hall + one room in engine, using real metrics (§6.1), phone + desktop + VR navigation |
| **4. Vertical slice** | 8–14 | Plaza + Pool Hall + Pool game fully designed and working on phone landscape, desktop and Quest; voice + proposals |
| **5. Usability round 1** | 14–15 | 20+ participants (phone), 10+ (VR), fixes |
| **6. Full content** | 15–24 | Ludo Lounge, Igisoro Court, Arena, avatars and cosmetics, all tiers |
| **7. Beta polish** | 24–28 | Performance pass, accessibility audit, localisation QA, round 2 usability |

**Team (suggested):** 1 design lead, 1 product / UX designer, 1 UI designer, 2 3D artists (environment + characters), 1 technical artist, 1 game designer, 1 sound designer (contract), plus cultural advisers.

---

## 21. Open Design Questions
1. Final world name: "Gukirana Playground" or something else? (Trademark check.)
2. Which Imigongo cooperative / artists will we partner with, and how are they credited and paid?
3. Is the Intore-inspired celebration emote appropriate? (Cultural advisers' decision.)
4. Pool on phones: should top-down or 3D aim be the default? (A/B test in the vertical slice.)
5. Igisoro move preview in cash matches: allowed for everyone or off for everyone? (Game design + fairness decision.)
6. Music: commission local artists or license existing tracks?
7. VR Lounge partners (gaming cafés, hubs): which headsets, and who provides them?
8. Should spectators in VR be able to stand closer to live tables than screen spectators? (Fairness review.)

---

## 22. References

**Platform research (accessed November 2026; check primary sources before final decisions):**
- WebXR support: [Android XR: WebXR in Chrome](https://developer.android.com/develop/xr/web), [Meta: WebXR overview](https://developers.meta.com/vr/documentation/web/webxr-overview/), [Road to VR: Vision Pro WebXR in Safari](https://roadtovr.com/apple-vision-pro-webxr-support-safari-model/), [Mixed News: Vision Pro WebXR](https://mixed-news.com/en/apple-vision-pro-supports-webxr-for-immersive-browser-experiences/), [WebKit WebXR tracking bug](https://webkit.org/b/208988), [VR.org: WebXR Interop 2026](https://vr.org/articles/webxr-interop-2026-cross-browser-standard), [VR.org: WebGPU baseline 2026](https://vr.org/articles/webgpu-baseline-2026-three-js-webxr-default), [Wikipedia: WebXR](https://en.wikipedia.org/wiki/WebXR)
- VR design guidance: [Meta: Locomotion best practices](https://developers.meta.com/vr/design/locomotion-best-practices/), [Meta: Hands best practices](https://developers.meta.com/vr/design/hands-best-practices/), [Meta: Locomotion design guide](https://developers.meta.com/horizon/blog/now-available-vr-locomotion-design-guide/), [Meta: MR design guidelines](https://developers.meta.com/horizon/design/mr-design-guideline/)
- Rendering: [Radiance Fields: Three.js r186 native Gaussian splat renderer](https://radiancefields.com/three.js-merges-a-native-gaussian-splat-renderer-for-webgpu-in-r186), [Spark Radix WebGPU splats](https://radiancefields.com/spark-radix-brings-webgpu-splat-rendering-to-threejs), [Three.js WebGPU guide](https://www.svilenkovic.com/3d/webgpu-three-js), [Three.js performance tips 2026](https://www.utsubo.com/blog/threejs-best-practices-100-tips)

---

*End of document. Next steps: (1) design kickoff with the cultural advisers, (2) greybox the Plaza and Pool Hall with the §6.1 metrics, (3) test pool aiming on phones in landscape (top-down vs 3D), (4) VR comfort test plan.*

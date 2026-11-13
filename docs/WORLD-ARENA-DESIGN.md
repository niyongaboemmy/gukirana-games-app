# World & Arena Design: the Gukirana Arena District (Musanze)

> Companion to `DESIGN-SPEC-3D-VR.md` (§5 art direction, §6 world, §7 avatars, §16 budgets). This document holds the research, the design concept and an implementation log for the 3D world, the arrival gate and the avatars.
> Status: **v1 implemented** in `apps/web/src/world/**`. Cultural motifs still need the review required by DESIGN-SPEC §5.2 before launch.

---

## 1. Summary

We turned the stylised plaza into an original **arena district at the foot of the Virunga volcanoes**, near Musanze in northern Rwanda. It has four parts:

- **An arrival gate.** Players show their ID (phone or email, then a one-time code) at a kiosk, and the turnstile opens with light and sound.
- **An entry plaza** around the Agaseke fountain.
- **Four game buildings** whose doors are the interaction points: the Pool Hall, Ludo Lounge, Igisoro Court and Tournament Arena. The Tournament Arena is a bowl inspired by BK Arena.
- **A procedural backdrop** of terraced farmland, eucalyptus and bamboo, the Twin Lakes, morning mist, and the five Rwandan Virunga cones on the skyline.

All geometry and textures are generated in code, with no runtime downloads, and the world works offline. The performance tiers still work: Lite and Standard, plus XR-safe rules.

---

## 2. Research

### 2.1 BK Arena, Kigali (primary local reference)

- **Facts.** It is a multipurpose indoor arena next to Amahoro Stadium. It holds about 10,000 seats (record attendance 10,152), cost about $104M and opened on 9 Aug 2019 after a build of about 6 months, with 1,000–2,000 workers on day and night shifts. It was renamed BK Arena in 2022. [Wikipedia](https://en.wikipedia.org/wiki/BK_Arena) · [Global Construction Review](https://www.globalconstructionreview.com/turkish-contractor-completes-east-africas-largest)
- **Team.** SUMMA built it, Rwanda Housing Authority (RHA) supervised, and about 70% of the workforce was Rwandan. [MININFRA](https://www.mininfra.gov.rw/updates/news-details/president-kagame-inaugurates-newly-built-kigali-arena) Yazgan Design Architecture was the lead designer. [ENR](https://www.enr.com/articles/50102-award-of-merit-sportsentertainment-kigali-arena) · [Yazgan award entry](https://theplantest.maggiolicloud.it/award-2020-sportleisure/kigali-arena-a-multi-functional-sports-hall-in-rwanda-yazgan-design-architecture)
- **Facade idea.** A glass envelope is wrapped in an outer shell of **Imigongo patterns**. The shell adds depth, and its shadows give the circulation a rhythm. The stated aim was to make the building feel familiar to local people. [Yazgan award entry](https://theplantest.maggiolicloud.it/award-2020-sportleisure/kigali-arena-a-multi-functional-sports-hall-in-rwanda-yazgan-design-architecture)
- **Structure.** Reinforced concrete at the lower tier, structural steel at the upper tier, and a **space-frame roof**. Gross floor area is about 21,000 m². [Meinhardt](https://meinhardtgroup.com/portfolio-item/kigali-arena/) LED screens and lighting were long-lead items. [ENR](https://www.enr.com/articles/50102-award-of-merit-sportsentertainment-kigali-arena)
- **Precinct.** It sits in the Remera "sports city" with Amahoro Stadium, Petit Stade and a gymnasium. These buildings got matching facades. Amahoro reopened in 2024 with 45,000 seats and an Imigongo facade. [RHA](https://www.rha.gov.rw/updates/news-details/building-bridges-of-unity-and-progress-inside-remarkable-development-of-rwandas-stadiums) · [KT Press](https://ktpress.rw/2024/07/president-kagame-inaugurates-the-newly-refurbished-amahoro-stadium) · [StadiumDB](https://stadiumdb.com/designs/rwa/stade_amahoro)
- **Not verified:** the exact roof profile, facade colours, bowl rake and screen layout. We therefore borrow only the *ideas*: a patterned shell over glass, a space-frame roof and LED ribbons. We copy no form or branding.

**Local landmark: Kigali Convention Centre.** Its dome draws on the King's Palace at Nyanza. At night it is lit, often in the national colours. [New Times](https://www.newtimes.co.rw/article/130969/News/tracing-the-story-behind-the-kigali-convention-complex/amp) · [Google Arts & Culture](https://artsandculture.google.com/asset/kigali-convention-centre-office-of-the-government-spokesperson/DQGcWNECAbbgLQ) · [Radisson Blu](https://www.radissonhotels.com/en-us/hotels/radisson-blu-convention-kigali/activities)
This inspired the conical roof of the **Igisoro Court**.

### 2.2 What makes premium arenas feel premium

| Venue | What we take from it | Sources |
|---|---|---|
| **Intuit Dome** (AECOM, 2024) | A public **entry plaza** with a big screen and native planting; the steep single-tier "Wall"; the double-sided **Halo** board | [SeatGeek](https://seatgeek.com/blog/intuit-dome-seatgeeks-complete-guide-to-the-home-of-the-la-clippers) · [Archinect](https://archinect.com/news/article/150441568/aecom-s-2-billion-intuit-dome-opens-in-fast-changing-inglewood) · [Stadia](https://www.stadia-magazine.com/news/stadium-sustainability/sustainable-design-key-to-la-clippers-intuit-dome.html) |
| **Chase Center** (MANICA, 2019) | A soft round massing with a **sail-like perforated skin**; a spiral motif that carries from the building into the **paving**; a generous plaza shielded from wind | [Architect's Newspaper](https://www.archpaper.com/2020/05/facades-manicas-chase-center-references-san-franciscos-mission-bay-aluminum-panels/) · [NorCal APA](https://norcalapa.org/2019/09/can-a-sports-arena-be-a-mixed-use-multiplex-urban-park/) |
| **Sphere** (Las Vegas, 2023) | The building as a media surface; the night-time **LED skin** as the landmark | [Jon Peddie](https://www.jonpeddie.com/news/the-sphere-in-las-vegas/) · [NVIDIA](https://blogs.nvidia.com/blog/sphere-las-vegas) |
| **Tottenham Hotspur Stadium** (Populous, 2019) | Food-hall **concourses** as social space; an intimate single-tier stand | [Populous](https://www.populous.com/project/tottenham-hotspur-stadium) · [BD+C](https://www.bdcnetwork.com/home/news/55163413/tottenham-hotspur-stadium-has-its-own-brewery-europes-longest-bar) |
| **Allianz Arena** (Herzog & de Meuron) | A **colour-changing facade** made of cushions that are lit one by one | [Arup](https://www.arup.com/projects/allianz-arena/) · [Britannica](https://britannica.com/topic/Allianz-Arena) |
| **LoL Park, Seoul** | Coliseum-like seats in a semicircle around a stage, under a three-sided screen | [Inven Global](https://invenglobal.com/articles/6238/riot-games-reveals-new-lck-esports-stadium-lol-park) · [Figueras](https://figueras.com/project/lol-park-riot-games/) |
| **Esports Stadium Arlington / HyperX Arena** | A giant LED wall above the players; broadcast-style lighting | [Populous](https://populous.com/project/esports-stadium-arlington) · [Live Design](https://www.livedesignonline.com/excellence-installation-awards/hyperx-esports-arena-las-vegas) |

**Common premium cues:**
- a generous arrival plaza;
- one hero media surface;
- a patterned or perforated skin over glass, which reads as depth and rhythm;
- continuous LED ribbons that trace the architecture;
- warm lit concourses seen through glass;
- landscape planted right up to the doors;
- wayfinding that is built into the paving.

### 2.3 Northern Rwanda setting (Musanze / Volcanoes National Park)

- **The five volcanoes on the Rwandan skyline.** Karisimbi (4,507 m, the highest), Muhabura (4,127 m), Bisoke (about 3,711 m), Sabyinyo (about 3,674 m, the oldest, with a jagged ridge) and Gahinga (about 3,474 m). Gahinga and Sabyinyo sit on the Uganda border. Karisimbi and Bisoke sit on the DR Congo border. [Wikipedia: Virunga Mountains](https://en.wikipedia.org/wiki/Virunga_Mountains) · [WorldAtlas](https://worldatlas.com/articles/important-facts-about-the-virunga-mountains-in-east-africa.html)
- **Bisoke** has a summit **crater lake** about 400 m across, the largest crater lake in the chain. [Wikipedia: Mount Bisoke](https://wikipedia.com/wiki/Visoke) · [Trek Africa](https://trekafricatours.com/mount-bisoke-crater-lake/)
- **The Twin Lakes**, Burera and Ruhondo, formed when lava dammed river valleys. Their shores are heavily **terraced and cultivated**. [Silverback Gorilla Tours](https://silverbackgorillatours.com/lake-burera-and-ruhondo) · [Trek Africa](https://trekafricatours.com/twin-lakes-of-ruhondo-and-burera-in-rwanda/) · [ATTA](https://atta.travel/resource/investors-set-sights-on-rwanda-s-beloved-twin-lakes.html)
- **Park edge.** Hikers cross farmland and then a **stone wall** to enter the park. Vegetation climbs from bamboo to montane forest to Hagenia/heath and bare summits. Mist and low cloud are typical. [Trek Africa: Bisoke](https://trekafricatours.com/mount-bisoke-crater-lake/) · [Wikipedia: Volcanoes NP](https://en.wikipedia.org/wiki/Volcanoes_National_Park)
- **Volcanic stone** (dark, vesicular basalt) is used locally for walls and buildings, and the Musanze caves show it raw. [GoWithGuide](https://gowithguide.com/rwanda/tour/ruhengeri-musanze-caves-traditional-banana-beer-and-crafts-experience-at-red-rocks-culture-history-tour-25879) The sources on black lava-rock *field walls* are thin, so treat that as observed regional character rather than a cited fact.

### 2.4 Rwandan motifs (all need cultural review, DESIGN-SPEC §5.2)

- **Imigongo** is relief art made from cow dung and ash, with black, white and red-ochre zig-zags, spirals and diamonds. It comes from the Kakira cooperative at Nyakarambi, Kirehe District. [Wikipedia](https://en.wikipedia.org/wiki/Imigongo) · [Atlas Obscura](https://atlasobscura.com/places/kakira-imigongo-cooperative) · [National Geographic](https://www.nationalgeographic.com/culture/article/imigongo-cow-dung-art-rwandan-widows-recover-genocide)
- **Agaseke** is a woven peace basket with a conical lid, and it appears on the national seal. [Wikipedia](https://en.wikipedia.org/wiki/Agaseke) · [NC Museum of Art](https://collection.ncartmuseum.org/objects/10237/basket-agaseke)
- **Umushanana** is a wrapped skirt with a sash over one shoulder. **Kitenge** is the local name for wax prints. [Wikipedia: Mushanana](https://en.wikipedia.org/wiki/Mushanana) · [Google Arts & Culture](https://artsandculture.google.com/story/0AXhd6Bj8G1ZHQ) · [Azizi Life](https://www.azizilife.com/ankara-beloved-african-design/) · [Quartz](https://qz.com/africa/1624510/the-made-in-rwanda-policy-is-boosting-kigalis-fashion-sector)

All the patterns in the code are **original procedural drawings** "inspired by" these motifs. None reproduces a specific artwork or fabric.

### 2.5 Realistic but fast: WebGL and WebXR practice (2025–26)

- **Draw calls.** Aim for about 100 per frame on mobile and Quest. Every Mesh is at least one call. Merge static geometry, and use `InstancedMesh` or BatchedMesh for repeats. [three.js manual](https://threejs.org/manual/en/optimize-lots-of-objects.html) · [Utsubo, 100 tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips) · [Meta WebXR perf](https://developers.meta.com/horizon/documentation/web/webxr-perf-workflow/)
- **Lighting.** Use three or fewer dynamic lights, preferably one directional light. Fill with image-based light (`scene.environment`). Bake where possible. [Meta WebXR best practices](https://developers.meta.com/horizon/documentation/web/webxr-perf-bp/) · [Utsubo](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- **Local environment maps.** drei `<Environment>` can render children (a sky plus `<Lightformer>` emitters) into a cube map *once*, so no HDRI download is needed. [drei Environment](https://drei.docs.pmnd.rs/staging/environment) · [drei Lightformer](https://drei.docs.pmnd.rs/staging/lightformer)
- **Shadows.** Use 1024–2048 maps with a tight frustum, follow the camera, and snap to texels. Use blob shadows on low tiers. [Utsubo](https://www.utsubo.com/blog/threejs-best-practices-100-tips) · [drei ContactShadows](https://drei.docs.pmnd.rs/staging/contact-shadows)
- **Post-processing.** Use one merged pass and a threshold-based mip bloom. **Avoid it in WebXR**, because it breaks fixed foveation and adds about 1–1.5 ms. [Meta FFR](https://developers.meta.com/vr/documentation/unreal/os-fixed-foveated-rendering/) · [Needle forum](https://forum.needle.tools/t/postprocessing-in-vr-browsers/2692)
- **Assets.** For future authored assets, use KTX2/Basis textures (4–8× less VRAM) and meshopt geometry. [three.js KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html) · [Utsubo](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- **Social VR.** Keep real-world scale. Use one big landmark for orientation. Use billboard labels sized by viewing angle. Teleport or snap-turn comfort should be the default, and every world needs a spawn point. [Meta locomotion](https://developers.meta.com/horizon/design/locomotion-best-practices/) · [Meta MR design](https://developers.meta.com/horizon/design/mr-design-guideline/) · [Meta Connect world](https://www.meta.com/blog/meta-connect-horizon-worlds-behind-the-scenes/) · [VRChat Quest optimisation](https://creators.vrchat.com/platforms/android/quest-content-optimization)

---

## 3. Design concept: "Arena District at the foot of the Virungas"

1. **Arrive, then belong.** You enter from the south through a gate (security plus ritual), walk an avenue, reach the plaza, and then a door.
2. **One landmark per direction.**
   - North: the Tournament Arena drum with its LED screen, with the volcano chain behind it.
   - West: Igisoro Court's royal-hut cone.
   - East: the Ludo Lounge's floating die.
   - South: the gate's welcome screen.
3. **Rwandan materials, modern detailing.**
   - black lava-stone plinths and walls;
   - timber fins and soffits;
   - terracotta brick;
   - Imigongo shells over glass;
   - aluminium and white concrete as the modern counterpoint.
4. **Light as wayfinding.** Each game's colour (DESIGN-SPEC §5.3) runs as an LED line in the paving, from the fountain to that game's door. The same colour traces the building's roofline and its door trim.
5. **Morning in Musanze.** A low sun from the east-south-east, cool haze, mist banks in the valleys and a cloud cap on Karisimbi. LEDs still read in daylight, and bloom on the Standard tier makes them glow.

---

## 4. Backdrop (procedural, offline): `world/Landscape.tsx`

| Element | Technique |
|---|---|
| **Terrain** | One polar-grid mesh (Standard 256 segments × ~100 rings; Lite 128 × ~55). It uses FBM hills and **terracing** (a stepped height function blended 80%). Vertex-coloured field patches per terrace band, with darker riser lines, carry the terraces even where the geometry is coarse. The terrain stays flat in the district (r < 88 m) and at the gate forecourt, stays low towards the north so the volcanoes stay visible, and rises into southern ridges that close the horizon |
| **Virunga chain** | Five radial-grid cones merged into one mesh. Each has a profile exponent (Muhabura is almost a straight cone, Karisimbi is broad), erosion gullies, Bisoke and Gahinga have craters (Bisoke's with a lake disc), and Sabyinyo has a ridge of jagged "teeth". Altitude bands: farmland → bamboo → montane forest → Hagenia/heath → bare rock. Azimuths follow the real view from Musanze (Karisimbi WNW to Muhabura NE). Distances are compressed (~25 km → 0.8–1 km) and heights slightly exaggerated in angular size |
| **Twin Lakes** | Basins carved into the terrain function. Water planes sit at two levels: Burera is higher and further away, Ruhondo lower |
| **Atmosphere** | `FogExp2` matched to the sky horizon gives atmospheric perspective: near hills stay crisp and the far cones fade to blue-grey. drei `Sky` gives a hazy morning (turbidity 7) |
| **Mist** | Soft procedural canvas sprites: slope bands on every volcano, cloud caps on Karisimbi and Muhabura, and valley banks over the lakes. They drift slowly and their opacity breathes. Lite uses 4 planes |
| **Vegetation** | Instanced (one draw call per set): broadleaf plaza trees (smooth canopies), eucalyptus woodlots (pale trunks, stacked narrow crowns), bamboo groves (thin culms with feathery plumes), shrubs, and iron-roofed farmhouses on the hills |

---

## 5. Site plan

```
                         N  (Virunga skyline: Karisimbi · Bisoke · Sabyinyo · Gahinga · Muhabura)
                                     ┌──────────────────────┐
                                     │  TOURNAMENT ARENA    │ elliptical drum 42×34 m, h≈25 m
                                     │  Imigongo pleated    │ LED ribbons · space-frame dome
                                     │  skin · LED screen   │ "GUKIRANA PLAYGROUND" crown
                                     └─────────┬────────────┘
                     POOL HALL  ╲    canopy + door (0°)    ╱  LUDO LOUNGE
               (−38°) timber fins ╲          │           ╱ (+38°) brick + rooftop garden
                 IGISORO COURT ─── ╲ ·  ·  · │ ·  ·  · ╱ ─── COMING SOON (Chess, +76°)
          (−76°) royal-hut cone  ·   planters ◯  lamps   ·      hoarding · tower crane
                                ·     ┌──────────────┐     ·
     COMING SOON (Draughts) ──  ·     │   AGASEKE    │     ·  ── HELP DESK · CAFE (+112°)
          (−112°)               ·     │   FOUNTAIN   │     ·
                                 ·    └──────────────┘    ·      LED lines in each game colour
                                  ·  WELCOME ▣   ▣ WALLET ·      run fountain → door
                                    ·      ◎ SPAWN      ·        plaza r = 28 m walkable,
                                      · · · ·║· · · · ·          paving r = 32.5 m
                         ═══════════ ring road (r 74–81 m) ═══════════
                                             ║ avenue (8 m, tree-lined)
                     ┌────── lava-stone wall ═╬═ ARRIVAL GATE (z ≈ 96 m) ═══════┐
                     │  WARDROBE ▤ (inside)   ║  canopy · 5 turnstile lanes      │
                     │                guard ▢ ║ ▣ ID kiosk · welcome LED screen  │
                     └────────────────────────╨──────────────────────────────────┘
                                         forecourt r 19 m
                                             ▲ arrival
                         S  (terraced hills · eucalyptus · farmhouses)
```

The metrics follow DESIGN-SPEC §6.1:
- doors are 3.0 × 4.0 m and the interaction radius is 3.0 m;
- the plaza is 60 m across and the walk/run speed is 3.0/5.5 m/s;
- avatars are about 1.70 m tall, scaled per body type (0.965–1.0).

Every building faces the fountain, and its door is the interaction point. `nearPortal`, the E key and the Interact button work unchanged, and the routes stay `/play/pool`, `/play/ludo` and `/play/igisoro`.

---

## 6. Buildings and per-arena themes

| Building | Massing and materials | Signature | Colour |
|---|---|---|---|
| **Pool Hall** | Dark board-formed concrete; full-height curtain wall with **timber fins**; lava base course; deep roof fascia | Blue LED ribbon on the fascia; warm "lounge" glow through the glass (emissive interior map) | `#2F80ED` |
| **Ludo Lounge** | Terracotta brick piers, glass shopfront, **rooftop garden** (glass balustrade, timber pergola with LED strings, umbrellas, planters) | Giant floating **die** above the roof (DESIGN-SPEC §6.3) | `#FF8A1F` |
| **Igisoro Court** | Round white-plaster hall with a lava base and an **Imigongo frieze**; tall **conical thatch roof** (the royal hut at Nyanza and the Agaseke lid); timber porch with carved benches | The elders' tree (a large umuvumu) beside the porch; green LED ring at the eaves | `#27AE60` |
| **Tournament Arena** | Elliptical drum: lava plinth → glass concourse level (lit) → **pleated Imigongo diamond skin** (64 tilted panels) over a dark inner drum → white fascia → aluminium **space-frame dome** with ring trusses. Cantilevered entrance canopy on slender columns with LED soffit lines | 16 × 5 m **LED screen** (scrolling messages); colour-cycling halo ribbons (purple → sky → gold); "GUKIRANA PLAYGROUND" crown; flagpoles | `#9B51E0` |
| **Coming soon** ×2 | Printed hoardings with a gate, half-built concrete frame, scaffold, **tower crane** with an aviation light | Notify-me door (no route) | `#8A94A6` |
| **Help desk / café** | Glass pavilion, timber roof, lava back wall | Sky LED edge | `#3DA9FC` |
| **Plaza** | Large-format stone paving, basalt bands, timber benches on lava plinths, 12 lamp posts with warm LED heads, lava planters with trees, two digital totems (Welcome and Wallet), low **dry lava-stone walls** between the buildings, ring road and tree-lined avenue | Agaseke basket fountain (lathe shape plus a woven zig-zag texture), water jets, Player of the Day hologram | — |

---

## 7. Arrival gate and ID check (`world/gate/**`, route `/gate`)

**Flow:**
1. **Arrival.** The camera flies in from above while the avatar walks to the kiosk (about 4 s, skippable).
2. **"Show your ID".** The player enters a phone or email. `requestOtp(identifier)` is called, and in dev the kiosk shows **"Dev code: 123456"**.
3. **6-digit code.** `verifyOtp` is called, followed by `loadMe`.
4. **Access granted.** A two-note chime plays, the flaps swing open and the LEDs turn from red to green.
5. **The avatar walks through.** New players, or anyone without a username, go to the **wardrobe**: they pick a username, choose a body type explicitly, and can open the full Avatar Creator. This calls `updateMe({ username, color, bodyType, look })`. The app then **enters `/world`**.

**Session restore.** An authenticated player with a username skips straight inside (`/world`). An authenticated player without one goes straight to the wardrobe.

**Errors.** `VALIDATION_ERROR`, `OTP_INVALID`, `OTP_RATE_LIMITED` and `USERNAME_TAKEN` are shown on both the kiosk screen and the DOM card, together with a buzz sound.

**Screens (desktop and phone landscape).** A frosted, accessible DOM card is anchored to the right of the 3D kiosk. It uses real inputs with `autocomplete="one-time-code"`, labels and `role="alert"`. The 3D kiosk screen mirrors what you type, so the check stays diegetic.

**VR.** The DOM card is hidden. The kiosk shows a **world-space keyboard**: one canvas-texture plane (one draw call) where keys are found from the hit UV, which works with controller rays and pinch. It is a full layout for phone or email and a digit pad for the code. At the wardrobe there is a VR panel with a username keyboard, three body-type buttons and Enter. The full outfit editor stays on screens for now.

Gate materials are the same palette as the district: lava pylons with Imigongo inlays, a timber-batten canopy soffit, aluminium turnstile cabinets with glass flaps, a glass and timber guard booth, and a welcome LED screen ("MURAKAZA NEZA · WELCOME · SHOW YOUR ID TO ENTER").

---

## 8. Materials and lighting palette

| Key | Material (MeshStandard unless noted) | Use |
|---|---|---|
| `lava` | Procedural basalt blocks with vesicles; bump map; roughness 0.92 | Plinths, walls, planters, pylons |
| `paving` | Honed stone slabs, 1 m grid; roughness 0.62 | Plaza, avenue, forecourt |
| `concrete` / `concreteDark` | Board-formed concrete | Halls, slabs |
| `wood` / `woodDark` | Procedural battens and grain | Fins, soffits, benches, lockers |
| `brick` | Terracotta stretcher bond | Ludo Lounge |
| `glass` / `glassCool` | Metalness 0.85, roughness 0.06–0.08, mullion map plus **emissive interior map** (warm lit bays) | Curtain walls, booth |
| `alu` / `steel` | Metalness 1/0.9, roughness 0.32/0.4 | Frames, dome, lamps, mirror |
| `diamond` / `diamondDark` | Imigongo diamond lattice | Arena skin, inlays |
| `imigongo`, `agaseke`, `thatch` | Procedural motif textures | Friezes, fountain, Igisoro roof |
| `led-*` | `MeshBasic`, not tone-mapped, colour × 2.6 (Standard) / × 1.15 (Lite) | Ribbons, wayfinding, door trims |

UVs are re-projected to **world metres** by the batcher, so texel density stays constant on walls of any size.

**Lighting:**
- **Sun:** one directional light, colour `#ffe4c4`, intensity 2.9, azimuth 104°, elevation 17°.
- **Sun shadows:** a 2048 PCF map (Standard only) whose frustum (±46 m) **follows the camera** and snaps to texels.
- **Fill:** a hemisphere light, `#c9def0` / `#56643a`.
- **Environment:** a local procedural environment map (`Sky` plus Lightformers: sun disc, sky panel, warm bounce, dark ground) rendered **once** at 128 px (Lite: 32 px).
- **Fog:** `FogExp2 #c4d2dc`, density 0.00085 (Lite: 0.0012).
- **Tone mapping:** ACES Filmic.
- **Bloom:** mip-blur bloom, threshold 1.0 (LEDs only), intensity 0.55. Standard tier only, never in XR, and dropped by `PerformanceMonitor` when frames decline.

---

## 9. Avatar and outfit system

- **Body.**
  - **Proportions:** parametric, about 1:7, with three **body types chosen by the player** (`feminine` / `neutral` / `masculine`). These change shoulder, chest, waist and hip widths, limb girth and height, plus a modest bust shape for `feminine`.
  - **Never inferred:** the type is not guessed from a name, phone number or anything else. The UI copy says so.
  - **Geometry:** a lathe-shaped torso and pelvis with elliptical cross-sections, tapered limbs with a muscle bulge, and shoulder/elbow and hip/knee joints.
- **Face hint:** eyes (whites and iris), brows in the hair colour, nose, lips and ears.
- **Hands and shoes:** palm plus thumb; sneakers, runners, boots, loafers and sandals.
- **Skin and hair.**
  - **Skin tones:** 11, from deep to light.
  - **Hair styles:** 10 (short, fade, afro, afro puffs, box braids, locs, bun, cornrows, headwrap (igitambaro), bald).
  - **Hair colours:** 8.
- **Outfit catalogue (`world/outfits.ts`).** Slots are top, bottom, shoes, accessory and headwear.
  - **Styles:** casual, sport, smart, traditional-inspired and street.
  - **Traditional-inspired pieces:** Kitenge shirts (sun and leaf prints), an Imigongo print top, an Umushanana-inspired sash and wrap, a Kitenge sash, a Kitenge long wrap and a Kitenge skirt.
  - **Accessories:** VR headset, glasses, sunglasses, gold earrings, smart watch.
  - **Headwear:** cap, beanie, bucket hat.
  - **Suggestions:** items carry `suggestedFor` tags. The picker lists **suggested items first and filters by them**. A **"Show all items"** toggle lists everything with a "Suggested" badge, and anyone may wear anything.
- **Avatar Creator (`components/AvatarCreator.tsx`).**
  - A portal modal with a live R3F preview: turntable, drag to rotate, Wave button, and a studio Lightformer environment.
  - Tabs: Body (plus accent colour), Skin, Hair, Top, Bottom, Shoes, Extras.
  - It opens from onboarding (lazy-loaded, so three.js stays out of the lobby's first paint), from the world HUD (shirt button on the profile chip) and from the gate wardrobe.
- **Profile store (add-only).**
  - Fields: `bodyType`, `skinTone`, `hairStyle`, `hairColor`, `outfit`.
  - Setters: `setBodyType`, `setSkinTone`, `setHairStyle`, `setHairColor`, `setOutfit`, `setLook`.
  - Helper: `lookOf()`. The accent remains the existing `color`.
- **Wire format.** `encodeLook()` produces a string like `1|f|6E4530|braids|141010|kitenge-sun|jeans|sneakers|earrings|no-hat|E53935` (≤ 90 chars, `|`-separated, which the API regex `[\w.:;,|#=-]` allows). `decodeLook()` validates every field and falls back to defaults, and also accepts the legacy `~` separator. `realtime.ts` sends `look` in the join options. Remote avatars render `look` when the server passes it through, use a sent `bodyType` otherwise, and fall back to the default look in the player's colour.
- **Remote-avatar LOD:**
  - full avatar under 16 m;
  - a 6-mesh low-poly LOD beyond that (drei `Detailed`);
  - a blob contact shadow on every avatar.
- **Spawn:** spread on a ring around the arrival point (username hash plus jitter).
- **Interaction target:** `nearPlayer` is the **nearest verified** player.

---

## 10. Performance budget per tier (targets vs DESIGN-SPEC §16.1)

| Budget | Lite | Standard | VR (standalone) |
|---|---|---|---|
| Static district | ~35 merged meshes (one per material) | same | same |
| Terrain + volcanoes | ~14k + ~4k tris | ~52k + ~18k tris | Lite path recommended |
| Instanced vegetation and houses | 9 draw calls, ~half the instances | 9 draw calls | 9 |
| Text (troika SDF) | ~20 signs | ~20 | ~20 |
| Lights | 1 directional (no shadows) + hemisphere | 1 directional with 2048 PCF follow-shadow + hemisphere | 1 directional, no shadows recommended |
| Env map | 32 px, once | 128 px, once | once |
| Post-processing | none | bloom (one pass, mip blur), dropped on decline | **none** |
| Mist planes | 4 | ~15 | 4 recommended |
| Avatars | blob shadows, LOD beyond 16 m | + shadow casting | — |
| Measured | — | **60 fps** at 1280×720 headless Chrome (Apple M2 Pro, Metal); 60 fps at the spawn and while walking, with 2–3 remote players | not measured on device yet |

---

## 11. Implemented vs future work

**Implemented (this branch):**
- the district, landscape, lighting, bloom and tiers;
- the arrival gate and ID flow (screens and VR keyboard);
- the wardrobe setup;
- avatars with looks, LOD and spawn spread;
- the outfit catalogue and Avatar Creator;
- `look` and `bodyType` on the wire (client side);
- HUD icons moved to lucide (no emojis anywhere in world/HUD/components; 3D glyphs are canvas-drawn).

**Future work:**
- **Authored assets:**
  - authored glTF hero assets (arena, avatars with skinned rigs and the §7.4 animation set) with meshopt and KTX2;
  - baked lightmaps and AO for the district;
  - Gaussian-splat Virunga backdrop on Ultra.
- **World behaviour:**
  - day/night cycle linked to Kigali time (night LED hero mode);
  - hall interiors behind the doors (the doors currently route to the 2D/3D game pages);
  - a live `look` update message when a player restyles mid-session (needs a server message);
  - Player of the Day hologram data.
- **VR:**
  - a VR outfit editor;
  - device testing on Quest 3/3S (draw calls, the Lite path inside XR).
- **Before launch:**
  - i18n keys for gate and creator strings (`gate.*`, `avatar.*`), currently local string tables;
  - cultural review of the Imigongo/Agaseke/Umushanana uses, with credit to the artisans' cooperatives.

---

## 12. Packages added (`apps/web`)

| Package | Why | Cost |
|---|---|---|
| `@react-three/postprocessing` ^3.2 + `postprocessing` ^6.39 | One merged bloom and tone-mapping pass on the Standard tier only (DESIGN-SPEC §16.1 "Bloom (low)"). `ToneMappingMode` comes from `postprocessing` | Only in the lazily loaded world chunk |
| `lucide-react` ^1.72 | MIT line icons replacing emojis in the HUD, creator and gate (no SF Symbols on the web) | Tree-shaken per icon |

---

## 13. Realism pass (real people, real trees)

Feedback addressed: "make the person a real person, enable all person functions; real trees". All third-party
files are listed with source, licence and modifications in `docs/ASSET-LICENSES.md`.

### 13.1 People (`world/Avatar.tsx`, `world/human/*`)

- **Bodies.** Photographic, rigged Microsoft Rocketbox avatars (MIT licence): feminine = `Business_Female_01`,
  masculine = `Male_Adult_12`, neutral = `Male_Adult_17`. Each is about 7–8k triangles with real faces,
  hands, eyes, lashes and hair cards, and 1024 px WebP textures. A `lod1` mesh simplified to about 30 % is
  used beyond 12 m and always on the Lite tier.
- **Player look on real textures.** A per-texel mask (built offline from skin weights, UV islands and
  skin-colour classification) drives a small shader patch:
  - skin tone: per-channel ratio blended into a luminance transfer;
  - hair colour: luminance transfer on the scalp and hair cards; "bald" turns scalp hair into skin;
  - top, bottom and shoe colours and kitenge prints: luminance transfer, so fabric folds and stitching survive.
- **Extra pieces attached to bones** through a "neutral frame":
  - hair volumes the bases lack (afro, puffs, bun, braids, locs, headwrap);
  - cap, beanie and bucket hat;
  - glasses, sunglasses, earrings, watch;
  - skirt and long wrap (legs become skin under them).
- **Motion.** Motion-captured Rocketbox clips in one animation glb per skeleton set (about 1 MB each):
  - **Locomotion:** a speed-driven, phase-synced blend (walk → fast walk → run → sprint) in which the shared gait
    phase advances by ground speed / stride length, so the feet don't slide. It stays a walk up to ~2.0 m/s,
    becomes a run from ~2.8 m/s and cross-fades in between. Ground speed is measured from the avatar's own
    world motion, so local, remote and scripted avatars all get it.
  - **Other states:** turning on the spot (small steps), idle (breathing, weight shift), wave (10), dance (11),
    clap (12), and sit (13) with sit-down / stand-up transitions. The seated loop is re-based for a 0.46 m seat
    centred on the avatar origin.
  - **Voice:** a talk-gesture layer and jaw motion while speaking (`useVoice().talking[id]` / `selfTalking`),
    plus a green three-bar speaking indicator above the name tag.
  - **Gaze:** a ±55° head turn towards a nearby speaker.
- **Budgets.** Characters total 4.06 MB. Mixer update rate drops with distance (every frame < 15 m, then
  1/2, 1/4, 1/8). Skinned bounding spheres are padded so animated poses are not culled.
- **Staff.** A uniformed security guard (`Security_Male_01`, keeps his own clothes) stands at the arrival gate
  and at the plaza entry gate. He is scenery: no name tag, never in `players`, never counted (rules E4/E5).

### 13.2 Trees, plants, ground (`world/Vegetation.tsx`, `world/Landscape.tsx`)

- **Species:** Poly Haven CC0 models converted for the web.
  - jacaranda → "acacia" umbrella tree on planters and lawns;
  - island_tree_02 → broadleaf shade tree and the elders' fig;
  - tree_small_02 → eucalyptus woodlots on the hills;
  - searsia lucida / burchellii → bushes and shrubs;
  - grass_medium_02 → grass tufts; fern_02 → planter ferns;
  - rock_07 and namaqualand_boulder_04 → lava stones and boulders.
- **Conversion.** Leaves are thinned by keeping a deterministic subset of individual leaves and enlarging each
  about its centroid, so the crown keeps its volume. Wood is sloppy-simplified after a position-only weld.
- **LODs.** Each species is instanced with LOD0 / LOD1 / far impostor, re-bucketed by camera distance a few
  times per second. The impostors are 8-view atlases baked offline with the world's light rig and drawn on
  camera-facing quads that pick the view by angle.
- **Wind sway** in the vertex shader on every foliage material (one shared time uniform).
- **Grass tufts follow the camera** on a toroidally wrapped grid (1,500 on Standard, 450 on Lite) and only grow
  on lawns: not on paving, the ring road, the avenue, the gate or lakes.
- **Ground:** Poly Haven `leafy_grass` (CC0, 1024 px WebP + normal map) tinted per field by the existing vertex
  colours. The volcano backdrop, mist and sky are unchanged.
- **Budget:** 8.8 MB of environment assets (limit 15 MB). The Lite tier uses LOD1 near the player, 60 % LOD
  distances, fewer placements and no foliage shadows.

### 13.3 Arrival, doors, exit

- **Entry gate.** The arrival gate structure (turnstiles, canopy, guard booth, kiosk) also stands at the plaza
  end of the avenue (`ENTRY_Z` 31.5). Players spawn just inside it (`SPAWN` z 25) with the gate behind them.
  The camera stays under the canopy instead of clipping through it.
- **Doors.** Playable buildings have sensor doors: sliding glass at Pool Hall and Ludo Lounge, carved timber
  double doors at Igisoro Court.
  - They open within 4.6 m and close behind you.
  - The doorway becomes walkable; crossing the threshold fades out and opens `/room/<game>`.
  - Tapping a doorway walks you through; E / Interact still works.
  - The plaza pose is saved just outside the door, so returning from a room puts you back there.
  - Tournament Arena and the "coming soon" buildings stay closed.
- **Exit kiosk.** "Exit · Sign out" kiosk inside the entry gate. Within 2.5 m `nearGateExit` is set and a prompt
  "Sign out at the gate" appears (E / tap). A confirm sheet follows; on confirm it calls `logout()` and goes to
  `/gate`.

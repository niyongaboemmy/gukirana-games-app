# Boxer v9: real-looking boxers for free (P3-FGT-21)

## The idea in one paragraph

The v8 boxers were built in code: a MakeHuman body plus cloth and gloves made by our scripts. You rated them about
0 % real, with plastic, faceted cloth, torn edges, jagged gloves, shiny skin and stiff bodies. v9 stops inventing
humans in code. It uses **real sources** and only adapts them for phones:
- a MetaHuman body and face (Epic, free);
- **real motion capture** from Mixamo (Adobe, free), with CMU mocap as a backup;
- **real cloth simulation** in Blender for the singlet and trunks;
- **real 3D-scanned gloves** and other gear from Sketchfab (CC BY, free with credit).

Everything is free. This round (P3-FGT-21) is research, specs and scripts only. **Nothing in the game has changed.**

## The documents

| File | What it answers |
| --- | --- |
| [LICENCES.md](LICENCES.md) | May we use MetaHuman, Mixamo, CMU, CC0 and CC BY in a commercial, cash-stakes web game? (Yes, with conditions; read the "Public repository" rule.) |
| [ASSET-SOURCES.md](ASSET-SOURCES.md) | Which free scanned bodies, gloves, headgear and shoes to download, ranked |
| [METAHUMAN-SPEC.md](METAHUMAN-SPEC.md) | Click-by-click: make the male boxer (and later the female) in MetaHuman Creator and export him |
| [MIXAMO-MOVES.md](MIXAMO-MOVES.md) | Exactly which Mixamo animations to download, with which settings, for every fight move |
| [BLENDER-PIPELINE.md](BLENDER-PIPELINE.md) | What the Blender scripts do, and in what order |
| [CHECKLIST.md](CHECKLIST.md) | How we judge "real": by eye, game render next to a real boxing photo |

## Who does what

| You (the owner) | The agent |
| --- | --- |
| Install Blender (free) and Unreal Engine 5.7+ (free; needed because the MetaHuman web app closed on 2026-11-05) | Wrote the specs and the Blender scripts (this task) |
| Create the free accounts: Epic (MetaHuman), Adobe ID (Mixamo), Sketchfab (gear downloads). The agent never logs in or uses them | Runs the Blender pipeline once the files are in place, and fixes the scripts on their first real run |
| Make the boxer in MetaHuman Creator and export him (METAHUMAN-SPEC.md) | Judges the results with CHECKLIST.md and reports honestly |
| Upload the body to Mixamo's auto-rigger, then download the clips (MIXAMO-MOVES.md) | Prepares the runtime task (feature flag, clip mapping, credits) for your approval |
| Download the approved gear from Sketchfab | |
| Approve the licence policy change and pick private storage for the final files | |

## Order of work

1. **Approve this plan.** In particular: change the asset policy so it allows MetaHuman and Mixamo, and keep the
   generated GLBs **out of the public Git repo** (LICENCES.md, "Public repository").
2. **Install** Blender (4.5 LTS) and Unreal Engine 5.7+. Run `node apps/web/scripts/boxer-v9/run.mjs --check` and
   `--init`.
3. **MetaHuman**: make `MH_Boxer_M` and export the FBX and textures into `work/in/metahuman/m/`
   (METAHUMAN-SPEC.md). About 1–2 hours the first time.
4. **Agent**: runs pipeline steps 1–2 (import, decimate), which gives `body-for-mixamo.fbx`.
5. **Mixamo**: upload that file, auto-rig it, download the rigged character and about 45 clips
   (MIXAMO-MOVES.md). About 1–2 hours; it is many clicks.
6. **Sketchfab**: download the top glove, shoe and (for the female boxer) headgear picks (ASSET-SOURCES.md) into
   `work/in/gear/`.
7. **Agent**: runs steps 3–10 (rig, clips, cloth, gear, bake, export, KTX2), fixes whatever the untested scripts
   trip on, and produces `boxer-m.glb`, `boxer-m-lod1.glb` and `boxer-clips.glb`.
8. **Agent**: side-by-side review against real photos (CHECKLIST.md), and you see the composites.
9. **You approve.** Then a separate runtime task puts v9 in the game behind a feature flag.
10. Later: the female boxer, same steps.

## The honest realism ceiling of the free route

What this route can reach:
- **Body and face**: MetaHuman is close to film quality in Unreal. In a phone web game at about 20k triangles,
  with 1–2k textures and no Unreal skin shader, expect "a good modern sports game at broadcast distance". It will
  look clearly better than v8: real anatomy, a real face shape, matte skin with pores.
- **Motion**: Mixamo is real mocap and fixes "stiff bodies". It is generic, though: some clips are more "action
  game" than amateur boxing, and a few moves have no match (clinch, glove touch, uppercut reaction). Those stay
  keyed or use CMU, which is real but recorded by amateurs in street clothes.
- **Cloth**: a real simulation baked into a handful of poses. Between poses it blends, so it is not live
  simulation. In fast exchanges it reads well at a distance; up close it is good but not perfect.
- **Gloves**: real scans look real once the logos are painted out and the material is fixed.

What it cannot reach for free:
- MetaHuman strand hair and the full face rig (RigLogic) do not exist outside Unreal. Short hair is therefore a
  texture plus cards, and the face starts rigid, with blinks and jaw added later. Close-ups of the face will look
  "game", not "film".
- Phone GPUs cannot do Unreal's subsurface skin, so skin is approximated with a tuned standard material.
- Two fighters of the same build share most motion: real boxers each move in their own way.

A fair target: in the side-by-side test, a viewer needs more than 2 seconds to tell the game from a photo at
broadcast distance in most pairs. Close-ups will still give it away. That is the ceiling without paid tools (custom
mocap, paid scans, a paid skin shader) or a studio.

Risks to know about:
- the user's M2 Pro is below Epic's recommended hardware for MetaHuman Creator, so it may be slow; a Windows PC is
  the fallback;
- every Blender script is untested until Blender is installed, so expect a debugging session on the first run;
- the Mixamo web-delivery question is not settled by Adobe (LICENCES.md (b)).

## Your exact next actions

1. Read LICENCES.md (10 minutes). Reply "approved": allow MetaHuman and Mixamo, and keep the v9 GLBs in private
   storage, not in Git.
2. Install **Blender 4.5 LTS** from blender.org into `/Applications`.
3. Install **Unreal Engine 5.7 or newer** from the Epic Games Launcher.
4. Make sure you can sign in to: Epic Games, Adobe (mixamo.com), Sketchfab.
5. In this repo, run:
   `node apps/web/scripts/boxer-v9/run.mjs --check` (all green except perhaps Blender's path) and
   `node apps/web/scripts/boxer-v9/run.mjs --init`.
6. Follow METAHUMAN-SPEC.md §1–§5 for the male boxer and put the export in
   `apps/web/scripts/boxer-v9/work/in/metahuman/m/`.
7. Tell the agent: "MetaHuman export is in place". The agent runs steps 1–2 and hands you the Mixamo upload file.

# Boxer v9: scan a real boxer with an iPhone (P3-FGT-23)

This guide is for you, the owner. It explains how to scan a real, willing adult boxer in Musanze with an iPhone and a
free app, so that our game boxer is a real person instead of a body made in code. Plan about one hour on the day:
20 minutes to set up, 10 to 15 minutes of photos, then the upload.

Before anything else, the boxer reads and signs [SCAN-CONSENT.md](SCAN-CONSENT.md). No signature, no scan.

## 1. What you need

- An iPhone 12 or newer with at least 10 GB free. A Pro model with LiDAR helps, but is not required.
- One of these free apps:
  - **RealityScan** by Epic Games (App Store, free; it needs a free Epic account, which you make yourself). It does
    the processing in the cloud and exports a textured model.
  - **Apple Object Capture**: through an app that uses it, such as Reality Composer (free, from Apple). Its
    "Object Capture" mode processes on the phone itself. On a Mac it also works through Apple's free
    sample tools.
    Use whichever one works best for you. RealityScan is the one we recommend for a person.
- A helper to take the photos. The boxer cannot move, so someone else walks around him.
- A small piece of tape or a sticker for the gaze target (see section 4).
- Optional: a second phone or a friend to keep time, and a stool for the photographer to stand on for the top ring.

## 2. Where and when

The camera needs soft, even light with no hard shadows. Choose one of:

- **Outdoors on an overcast day.** A cloudy sky is perfect: it lights the body evenly from all sides. Avoid direct
  sun, which makes hard shadows and shiny highlights that get "painted" into the skin.
- **Outdoors in open shade.** The shadow side of a building, not under a tree (leaf shadows move).
- **Indoors in an evenly lit room.** A gym or hall with many ceiling lights, or a room with big windows on several
  sides. Turn on every light. Do not use the phone's flash.

The space must be big enough to walk all the way round the boxer at about 1.5 to 2 m distance. The floor should have
some texture (concrete, wood, a patterned mat), not shiny tiles. A plain, non-shiny background is best; avoid
mirrors, glass and moving people behind him.

## 3. What the boxer wears

- **Tight sports clothing**: tight shorts or boxing trunks and either bare chest or a tight, matte sports top. Loose
  clothes cannot be removed later and get in the way of the game singlet and trunks.
- Matte colours. Avoid shiny satin, reflective logos and pure black or pure white (they hide shape).
- **Barefoot or in plain trainers.** Socks are fine.
- **Hair short, or tied back tightly.** Loose hair, beards that move and fly-away strands scan badly.
- **No shiny items**: take off watches, chains, earrings, rings, glasses and phone. Cover shiny tattoos or jewellery
  only if they move.
- **Skin**: no oil or lotion that day. If he is sweaty, let him dry off and wipe with a towel. Shiny skin scans as
  holes or bumps.
- No gloves, no wraps, no headgear: we add real glove models in the game.

## 4. The pose

- A **relaxed A-pose**: standing straight, feet a little wider than the hips (about 25 to 30 cm between the heels),
  toes pointing forward, arms out to the sides and down at about 45 degrees, elbows almost straight, hands open and
  relaxed with the fingers slightly apart. Palms face down or towards the thighs.
- Weight on both feet equally, knees soft but straight.
- Mouth closed, relaxed face, eyes open, looking straight ahead.
- **The gaze target**: put a piece of tape on a wall or a post at his eye height, straight ahead. He looks at it the
  whole time. This keeps the head still.
- **Holding still**: this is the hard part. Tips:
  - he breathes slowly and gently through the nose, with small breaths into the belly, not big chest breaths;
  - arms at 45 degrees get tired: let him rest his arms between the rings (section 5) and come back to the same pose.
    Mark his feet with tape on the floor before you start so he stands in exactly the same place;
  - no talking during a ring. Count out loud for him instead ("ring one, 20 seconds left").
  - If he moves a lot during one ring, redo that ring. A small sway is fine; a turned head is not.

## 5. Taking the photos

Aim for **about 150 photos**, then **about 40 close-ups**. Hold the phone in portrait (upright). Keep the whole body,
or the part you are shooting, in the frame with a little space round it. Keep the phone still for each photo: stop,
shoot, step, shoot. Do not use zoom. Every photo should overlap the previous one by about two thirds, which means one
small step (about 10 degrees, or 36 photos per full circle) between photos.

The three rings:

| Ring      | Phone height                                      | Angle              | Photos                      |
| --------- | ------------------------------------------------- | ------------------ | --------------------------- |
| 1, low    | about knee height (crouch)                        | tilted slightly up | about 40, all the way round |
| 2, middle | about chest height                                | straight           | about 50, all the way round |
| 3, high   | above his head (arms raised, or stand on a stool) | tilted down        | about 50, all the way round |

Walk round at the same distance (about 1.5 to 2 m) for each ring. Pause between rings so he can drop his arms for a
moment, then return to the tape marks and the pose.

Then the close passes (about 40 photos, at about 50 to 70 cm):

- **Face**: a slow half-circle from ear to ear at eye height (about 15 photos), then a few from slightly below and
  slightly above. The face matters most for realism, so take your time here.
- **Hands**: each hand from the back, the front and the side (about 6 photos per hand).
- **Feet and ankles**: one low pass round each foot (about 6 photos per foot).
- **Under the arms and between the legs**: a few photos from low and from the side, so these are not holes.

Check on the phone: photos must be sharp, not blurry. Delete blurry ones and retake them.

## 6. Processing and export

**RealityScan**: follow the app to upload and process. When the model is ready:

- check it in the app: is the whole body there, are there holes in the face or the hands?
- export in **OBJ** (preferred) or **FBX** or **GLB**, with the textures;
- choose the **highest mesh quality** the app offers (at least about 200,000 triangles) and the **largest texture**
  (4K or 8K, often called 4096 or 8192);
- keep the real-world scale (metres) if the app asks.

**Apple Object Capture**: choose the "Full" or "Raw" detail level, then export **USDZ** or **OBJ**. If you get USDZ,
convert it to OBJ on a Mac (Reality Converter, free from Apple), or just send the USDZ and tell the agent.

## 7. Where to put the files

On your computer, put everything the app exported (the model file plus every texture image and any .mtl file, all in
one folder, without renaming the texture files) into:

```
apps/web/scripts/boxer-v9/work/in/scan/m/
```

Rename only the model file itself to `body.obj` (or `body.fbx`, `body.glb`). If the export came as a zip, unzip it
there. For a female boxer use `work/in/scan/f/` instead.

This folder is git-ignored: the scan **never** goes into the public repository. Keep a backup copy in private
storage (an external drive or a private cloud folder), together with the signed consent form.

Then tell the agent: "the scan is in work/in/scan/m".

## 8. What the agent does next

1. Checks the scan in Blender: complete, the right way up, real size, no big holes. If something is wrong it will tell
   you exactly what to reshoot.
2. Runs the pipeline in scan mode: `node apps/web/scripts/boxer-v9/run.mjs --body scan --clips cmu`. Step 0 makes him
   stand upright in metres, rigs him onto our skeleton offline (no upload to any website) and, if needed, moves his
   arms into the game's A-pose. Then it reduces him to the phone budget, adds the recorded boxing motion, simulates the
   singlet and trunks on his body, fits the gloves and bakes the textures.
3. Renders review pictures in the dev-only boxer lab: guard, jab, hook, a face close-up and a side-by-side with the
   current v8 boxer, and judges them against real boxing photos (CHECKLIST.md).
4. Shows you the pictures. Nothing changes in the live game until you approve the boxer and a separate task puts him
   in the game behind a feature flag.

## Quick checklist for the day

- [ ] Consent form read and signed (SCAN-CONSENT.md); the boxer is 18 or older
- [ ] Overcast sky or an evenly lit room; no flash
- [ ] Tight matte clothes; no jewellery, watch or glasses; hair short or tied; skin dry
- [ ] Tape marks for the feet; gaze target at eye height
- [ ] A-pose, arms at 45 degrees, hands open and relaxed
- [ ] Ring 1 low (about 40), ring 2 middle (about 50), ring 3 high (about 50)
- [ ] Face close pass, hands, feet, under the arms
- [ ] No blurry photos
- [ ] Export OBJ (or FBX / GLB), highest quality, 4K or 8K texture
- [ ] Files in `apps/web/scripts/boxer-v9/work/in/scan/m/`, model renamed to `body.obj`
- [ ] Backup and signed form in private storage

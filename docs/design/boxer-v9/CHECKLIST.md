# Boxer v9: realism checklist (judge by eye, against real photos)

v8 passed its metrics and was still rated about 0 % real. So this checklist is judged **by eye, against real amateur
boxing photos**, side by side. Metrics only support it. A "no" on any item marked **(K)**, a knockout item, fails the
round.

## The side-by-side method

1. **Reference set** (once): 12–20 licensed photos of real amateur bouts and gyms, kept internal and never shipped
   (docs/AVATAR-REFERENCE-RWANDA.md, "Photo references"). Use Wikimedia Commons with a free licence, stock under a
   reference licence, or your own photos with consent. Cover: guard front and 3/4, the jab at full extension, a hook,
   a clinch, a knockdown, a corner rest, a victory, and close-ups of gloves, a singlet edge, skin under arena light,
   and feet.
2. **Match the shot**: render the game at the same camera angle, about the same focal length (a broadcast view is
   about 50–85 mm equivalent; FPV is the game's own), the same framing and similar light, warm and overhead like a
   ring. Use the existing Playwright harness in `qa/e2e/fighter-v8/` (static and in-page capture), pointed at a v9
   build. Capture desktop at 1920 px and a phone viewport at 390 px wide.
3. **Compose**: photo on the left, game on the right, same height, no labels on the first pass.
4. **Blind pass**: show the pairs to someone who did not build them (ideally a Rwandan player or staff member, per
   the cultural review in DESIGN-SPEC §5.2). Ask "which side is the game?" and "what looks wrong?". Write down their
   words.
5. **Score** each line below as yes or no per pair. Then mark the share of pairs where the viewer needed more than 2
   seconds to tell the game apart. That share is the honest realism number to report.
6. Keep the composites in `docs/QA/boxer-v9/` (game renders and internal composites only; never commit third-party
   photos to the public repo, so keep the photo side local or blur it in the committed copy).

## Anatomy and guard

- [ ] **(K)** It reads as a real adult athlete aged 18–50 at broadcast distance: thick neck into the trapezius,
  shoulders wider than the hips, lean waist, defined but not bodybuilder arms.
- [ ] The face is a believable invented person: no doll eyes, natural brows and lashes, lips with colour variation,
  ears with real cartilage shape. It resembles no real person.
- [ ] Guard: chin down behind the lead shoulder, lead glove at eye or cheek height a forearm in front of the face,
  rear glove at the cheek, elbows tucked onto the ribs.
- [ ] Stance: orthodox, feet about shoulder width plus half a foot, lead toe pointing at the opponent, rear heel
  slightly up, knees soft.
- [ ] Hands and wrists straight inside the glove: no bent-back wrists at impact.

## Arms outside the singlet

- [ ] **(K)** Upper arms and shoulders pass **outside** the singlet's armholes in every pose: no skin through the
  fabric, no fabric through the arm.
- [ ] The armpit and shoulder deform plausibly with the arm raised (jab, hook): no collapse, no candy-wrapper twist
  at the forearm.
- [ ] Elbows never bend backwards or sideways (arm-fk limits hold over the mocap).

## Cloth (singlet and trunks)

- [ ] **(K)** No torn, jagged or paper-thin edges: every hem shows a thickness and a smooth line, at the neck,
  armholes, singlet bottom, waistband and leg openings.
- [ ] **(K)** No facets: silhouettes are smooth at broadcast distance and at 1 m.
- [ ] Folds where real kit folds: at the waistband, behind the lead armpit in the guard, over the hip in a rotated
  cross. No folds where it is stretched (chest in a jab).
- [ ] The fabric reads as polyester or satin jersey (soft sheen, weave detail up close), not plastic, and not
  painted on the skin.
- [ ] No interpenetration with the body or the gloves in any of the corrective poses, or in between them.

## Gloves

- [ ] **(K)** They read as real leather or synthetic gloves: creases at the knuckles and wrist, stitched seams,
  matte-to-satin sheen, an attached thumb, a real cuff (laced or velcro).
- [ ] Correct size: a 10–12 oz glove is about 0.28–0.31 m long, wider than the face's half width.
- [ ] Red or blue matches the corner. A white knuckle target area for competition. No brand logos.
- [ ] The glove follows the wrist without popping. The cuff overlaps the forearm, with no gap of skin.

## Skin

- [ ] **(K)** Not shiny: the sheen is soft and broad (forehead, nose, shoulders) and the rest is matte. Sweat
  appears late in the round, not from round 1.
- [ ] Colour variation: warmer cheeks, nose and ears; lighter palms; darker creases. Pores visible up close.
- [ ] Deep skin tones still show form (cheekbones, nose, lips) under the ring light.

## Feet planted

- [ ] **(K)** No foot sliding during punches and blocks: the planted foot stays planted, and the rear heel lifts
  on straights.
- [ ] Footwork steps push off the rear foot and land on the ball of the foot. No moonwalking.
- [ ] Shoes: high-top boxing boots with laces, flexing at the ball of the foot.

## Moves and reactions

- [ ] **(K)** Punches look like mocap of a trained boxer: hip and shoulder rotation, the rear foot pivots on the
  cross and rear hook, and the glove returns along the same line to the guard.
- [ ] Impact timing matches the hit sound and the opponent's reaction (within 1 frame at 30 fps).
- [ ] Head reactions go the right way: the opponent's lead hook turns our head to our left; straights snap it back.
- [ ] Body shots fold the torso and drop the elbow to cover. Heavy ones can bend a knee.
- [ ] Stagger, knockdown, count and get-up are believable and not ragdoll-floppy. The fighter takes a knee or sits,
  then rises facing the referee.
- [ ] Clinch: arms go round the opponent, never through.
- [ ] Ceremony: a respectful glove touch, a corner rest on the stool, victory with arms raised, defeat with dignity
  (no taunts).

## Phone check

- [ ] The same verdicts hold on a 390 px phone viewport at 60 fps, with LOD1 and the 1k textures, at 2–4 m camera
  distance.
- [ ] Triangle and texture budgets hold (08_export prints them; `qa/e2e/fighter-v8` metrics can measure the GLB).

## Report format

Per round: the composites, the yes/no grid, the blind-pass quotes, the share of "took more than 2 s to tell", and
the three worst problems in order. Never report "real" from metrics alone.

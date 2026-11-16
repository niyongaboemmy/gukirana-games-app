// P3-FGT-19B fighter-v8 harness: the standard shot list. Every path gets `&boxer=<phase>` appended (the dev-build
// override in world/human/boxer/generation.ts), so one dev server renders the before (v7) and after (v8) people.
//
// A shot: { id, group, label, path, wait (ms after the page is live), vps: ["desktop", "phone"], measure: [...] }
// measure: "perf" (fps, draw calls, triangles, texture MB, the fighter alone), "cavity" (id render from this camera),
// "joints" (joint-limit checks of every person), "garments" (garment vertices inside the skin, per person).

export const VIEWPORTS = {
  desktop: { width: 1280, height: 720, deviceScaleFactor: 1 },
  phone: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true },
};

const DUEL_F = "body=boxer&headgear=1&red=feminine&blue=feminine&rtone=5&btone=1&light=ring";
const DUEL_M = "body=boxer&headgear=1&red=masculine&blue=masculine&rtone=9&btone=1&light=ring";
const LAB = "mode=boxer&clip=guard&at=0.5";
const FIGHT = "/fight-lab?scene=1&auto=1&level=1&rounds=3&secs=60&name=Aline";
const duel = (q, extra) => `/play/boxing-lab?${q}&cam=side&gap=1.1&${extra}`;

const ACTIONS = [
  ["guard", "guard", "clip=guard&at=0.5"],
  ["jab", "jab at impact", "clip=jab&at=impact"],
  ["cross", "cross at impact", "clip=cross&at=impact"],
  ["hook", "lead hook at impact", "clip=leadHook&at=impact&gap=0.9"],
  ["uppercut", "lead uppercut at impact", "clip=leadUppercut&at=impact&gap=0.9"],
  ["body", "lead body shot at impact", "clip=leadBody&at=impact&gap=0.95"],
  ["block", "high block", "clip=blockHigh&at=0.3"],
  ["clinch", "clinch with the referee", "clip=clinch&at=1.7"],
  ["hit", "hit reaction (cross landed, 0.12 s on)", "clip=cross&at=impact&dt=0.12"],
  ["knockdown", "knockdown", "clip=knockdown&at=1.1"],
];

export const SHOTS = [
  // the user's view: the practice ring in the fight lab, the broadcast side camera
  { id: "broadcast", group: "broadcast", label: "practice ring, broadcast side camera", path: FIGHT, wait: 9000, vps: ["desktop", "phone"], measure: ["perf", "cavity", "joints", "garments"] },
  { id: "broadcast-later", group: "broadcast", label: "practice ring, a few seconds on", path: FIGHT, wait: 14000, vps: ["desktop", "phone"], measure: ["cavity", "joints"] },
  // two fighters under the ring rig
  { id: "duel-f", group: "duel", label: "duel f/f, guard, side", path: duel(DUEL_F, "clip=guard&at=0.5"), wait: 900, vps: ["desktop", "phone"], measure: ["perf", "cavity"] },
  { id: "duel-m", group: "duel", label: "duel m/m, guard, side", path: duel(DUEL_M, "clip=guard&at=0.5"), wait: 900, vps: ["desktop"], measure: ["cavity"] },
  { id: "duel-close", group: "duel", label: "duel f/f, guard, close camera", path: `/play/boxing-lab?${DUEL_F}&clip=guard&at=0.5&cam=close&gap=1.1`, wait: 900, vps: ["desktop"], measure: ["cavity"] },
  // turnarounds (studio light), both genders
  ...["m", "f"].flatMap((g) =>
    [
      [0, "front"],
      [90, "left side"],
      [180, "back"],
      [-90, "right side"],
    ].map(([az, name]) => ({ id: `turn-${g}-${az}`, group: "turnaround", label: `${g} ${name}, guard`, path: `/play/boxing-lab?${LAB}&gender=${g}&tone=${g === "m" ? 2 : 5}&cam=full&az=${az}&dist=3.0`, wait: 700, vps: ["desktop"], size: [560, 760], measure: ["garments", "joints"] })),
  ),
  // close-ups
  { id: "cu-shoulder", group: "closeup", label: "shoulder + strap (f)", path: `/play/boxing-lab?${LAB}&gender=f&tone=5&headgear=0&cam=shoulderL`, wait: 600, vps: ["desktop"], size: [600, 600], measure: ["cavity"] },
  { id: "cu-armhole", group: "closeup", label: "arm hole in a hook (m)", path: `/play/boxing-lab?mode=boxer&clip=leadHook&at=impact&gender=m&tone=1&headgear=0&cam=backL&dist=0.55`, wait: 600, vps: ["desktop"], size: [600, 600], measure: ["cavity", "garments"] },
  { id: "cu-waistband", group: "closeup", label: "waistband + trunks (f)", path: `/play/boxing-lab?${LAB}&gender=f&tone=5&cam=full&dist=1.15&az=-35&el=-4`, wait: 600, vps: ["desktop"], size: [600, 600], measure: ["cavity"] },
  { id: "cu-gloves", group: "closeup", label: "gloves (f)", path: `/play/boxing-lab?${LAB}&gender=f&tone=9&cam=face&dist=0.95&az=40`, wait: 600, vps: ["desktop"], size: [600, 600] },
  { id: "cu-headgear", group: "closeup", label: "headgear 3/4 (m)", path: `/play/boxing-lab?${LAB}&gender=m&tone=1&cam=face34&dist=0.95`, wait: 600, vps: ["desktop"], size: [600, 600] },
  { id: "cu-face", group: "closeup", label: "face, no headgear (f)", path: `/play/boxing-lab?${LAB}&gender=f&tone=5&headgear=0&cam=face`, wait: 600, vps: ["desktop"], size: [600, 600] },
  { id: "cu-face-m", group: "closeup", label: "face, no headgear (m)", path: `/play/boxing-lab?${LAB}&gender=m&tone=2&headgear=0&cam=face34`, wait: 600, vps: ["desktop"], size: [600, 600] },
  // action frames: the duel under the ring rig, side camera
  ...ACTIONS.map(([id, label, q]) => ({ id: `act-${id}`, group: "action", label, path: duel(DUEL_F, q), wait: 900, vps: id === "guard" || id === "jab" ? ["desktop", "phone"] : ["desktop"], measure: ["garments", "joints", "cavity"] })),
];

/**
 * P3-FGT-19B acceptance checks (SPEC §15) on one fighter (the boxing lab's boxer view): stand (the bind pose), guard,
 * jab and hook at impact, the high block; the T1 close shot for the chroma check.
 */
const CHK = (g, q, kinds, id, label) => ({ id: `chk-${g}-${id}`, group: "checks", label: `${g} ${label}`, path: `/play/boxing-lab?mode=boxer&gender=${g}&tone=${g === "m" ? 1 : 5}&cam=full&az=30&dist=3.0&${q}`, wait: 700, vps: ["desktop"], size: [560, 760], measure: kinds });
SHOTS.push(
  ...["m", "f"].flatMap((g) => [
    CHK(g, "clip=guard&at=0.5&bind=1", ["garments8", "face"], "stand", "stand (bind pose)"),
    CHK(g, "clip=guard&at=0.5", ["garments8", "pose:guard", "arms"], "guard", "guard"),
    CHK(g, "clip=jab&at=impact", ["garments8", "pose:jab", "arms"], "jab", "jab at impact"),
    CHK(g, "clip=leadHook&at=impact", ["garments8", "pose:hook", "arms"], "hook", "lead hook at impact"),
    CHK(g, "clip=blockHigh&at=0.3", ["arms"], "block", "high block"),
  ]),
  { id: "chk-t1-close", group: "checks", label: "T1 deep tone, guard, close camera (ring light)", path: `/play/boxing-lab?body=boxer&headgear=1&red=masculine&blue=masculine&rtone=1&btone=1&light=ring&clip=guard&at=0.5&cam=close&gap=1.1`, wait: 900, vps: ["desktop"], measure: ["chroma", "f0"] },
  { id: "chk-tones", group: "checks", label: "two tones (F0 per tone)", path: `/play/boxing-lab?${DUEL_F}&clip=guard&at=0.5&cam=side&gap=1.1&rtone=9`, wait: 900, vps: ["desktop"], measure: ["f0", "deltoid"] },
);

/** foot sliding: the duel playing in real time, the toes sampled every frame */
export const FEET = [
  { id: "steps", label: "step forward / back loop", path: `/play/boxing-lab?${DUEL_F}&clip=stepForward&cam=side`, seconds: 6 },
  { id: "library", label: "the motion library cycling", path: `/play/boxing-lab?${DUEL_F}&cam=side`, seconds: 10 },
];

export const GROUP_COLS = { broadcast: 1, duel: 1, turnaround: 4, closeup: 3, action: 2, checks: 4 };

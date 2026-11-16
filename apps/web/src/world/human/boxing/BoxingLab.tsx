"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Avatar } from "../../Avatar";
import { DEFAULT_LOOK, HAIR_COLORS, SKIN_TONES, type AvatarLook, type BodyType, type HairStyle } from "../../outfits";
import { RingKit, type RingKitStats } from "@/rooms/fight/ring-kit";
import { RingMood } from "@/fight/ring-lights";
import { EffectComposer, N8AO, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { BOXER_V7 } from "../boxer/body-v6";
import { fightSpots, PUNCH_RANGE, RING, refereeSpot, stoolSpot, toHall, type RingSpec, type Spot } from "@/rooms/fight/ring-kit-core";
import { BOXING_CLIPS, BOXING_CLIP_NAMES, REF_RAISE, TOUCH_DISTANCE, type BoxingClipName } from "./clips";
import { boxingKitOverride, refereeLook, type Corner } from "./kit";
import { boxingLayer } from "./layer";
import { BoxingMotion } from "./motion";
import { BX } from "./strings";
import { BoxerLab } from "../boxer/BoxerLab";
import { BoxerAvatar, type BoxerProbe } from "../boxer/BoxerAvatar";
import { canvasGapOf, refereeSpot as presentRefereeSpot } from "@/fight/present";

/**
 * Dev-only boxing lab (/play/boxing-lab, development builds; P3-FGT-02): two fighters in kit in a feature ring cycling
 * through the motion library (the other fighter reacts at the impact frame), a kit line-up, and a 50-ring field for
 * the draw-call / triangle budget. Deterministic: the clock is the page clock, or frozen with ?t= / ?at=impact.
 *
 * Query: mode=duel|kit|field|boxer (boxer: the boxer-body debug view, boxer/BoxerLab.tsx) · clip=<name> (one clip, looping every few seconds; default: the whole library) ·
 * at=impact|<s> (freeze there) · dt=<s> (offset from that) · red / blue = feminine|masculine|neutral ·
 * southpaw=red|blue · headgear=1 · corner=red|blue (kit) · cam=side|front|back|close|low|corner|ring|top|field|kit|
 * gloves|head|boots · tier=lite|standard · ref=1 · rate=<x> (slow motion)
 * window.__gkProbe: { calls, tris, rings: { near, far, culled, drawCalls, triangles }, clip, t }.
 */

const LOOKS: Record<BodyType, AvatarLook> = {
  masculine: { ...DEFAULT_LOOK, bodyType: "masculine", skinTone: SKIN_TONES[2]!, hairStyle: "fade", hairColor: HAIR_COLORS[0]!, face: { ...DEFAULT_LOOK.face } },
  feminine: { ...DEFAULT_LOOK, bodyType: "feminine", skinTone: SKIN_TONES[4]!, hairStyle: "cornrowbun", hairColor: HAIR_COLORS[1]!, face: { ...DEFAULT_LOOK.face } },
  neutral: { ...DEFAULT_LOOK, bodyType: "neutral", skinTone: SKIN_TONES[6]!, hairStyle: "short" as HairStyle, hairColor: HAIR_COLORS[0]!, face: { ...DEFAULT_LOOK.face } },
};

const LAB_RING: RingSpec = { id: "lab", x: 0, z: 0, rotY: 0, status: "fighting", number: 1 };

/* ---------------- clock ---------------- */

interface LabClock {
  now: () => number;
}
function makeClock(q: URLSearchParams, freezeAt: number | null): LabClock {
  const t0 = performance.now() / 1000;
  const rate = Number(q.get("rate") ?? 1) || 1;
  return { now: () => (freezeAt !== null ? freezeAt : (performance.now() / 1000 - t0) * rate) };
}

/* ---------------- the schedule (who plays what, when) ---------------- */

interface Cue {
  who: "red" | "blue" | "ref";
  clip: BoxingClipName;
  start: number;
  hold?: number;
}

const DEFENCE_FOR: Partial<Record<BoxingClipName, BoxingClipName>> = { blockHigh: "jab", blockLow: "rearBody", slipLeft: "jab", slipRight: "cross", duck: "leadHook" };
const REACTION_FOR: Partial<Record<BoxingClipName, BoxingClipName>> = {
  jab: "hitHeadLight",
  cross: "hitHeadHeavy",
  leadHook: "hitHeadHeavy",
  rearHook: "hitHeadLight",
  leadUppercut: "hitHeadLight",
  rearUppercut: "hitHeadHeavy",
  leadBody: "hitBodyLight",
  rearBody: "hitBodyHeavy",
};

/** cues for one clip shown with its partner, starting at `t` (red is the one showing the clip) */
function cuesFor(clip: BoxingClipName, t: number): { cues: Cue[]; length: number; scene: "fight" | "touch" | "corner" | "result" | "clinch" } {
  const info = BOXING_CLIPS[clip];
  const cues: Cue[] = [{ who: "red", clip, start: t }];
  let scene: "fight" | "touch" | "corner" | "result" | "clinch" = "fight";
  if (info.kind === "punch") {
    const r = REACTION_FOR[clip];
    if (r) cues.push({ who: "blue", clip: r, start: t + info.impact! });
  } else if (info.kind === "defence") {
    const p = DEFENCE_FOR[clip]!;
    cues.push({ who: "blue", clip: p, start: t + info.impact! - BOXING_CLIPS[p].impact! });
  } else if (["hitHeadLight", "hitHeadHeavy", "hitBodyLight", "hitBodyHeavy", "stagger", "knockdown"].includes(clip)) {
    const p: BoxingClipName = clip.startsWith("hitBody") ? "rearBody" : clip === "hitHeadLight" ? "jab" : "cross";
    cues[0]!.start = t + BOXING_CLIPS[p].impact!;
    cues.push({ who: "blue", clip: p, start: t });
    if (clip === "knockdown") cues.push({ who: "ref", clip: "refCount", start: t + 1.6 });
  } else if (clip === "count" || clip === "getUp") {
    cues.push({ who: "ref", clip: "refCount", start: t });
  } else if (clip === "clinch") {
    // both tie up; the referee steps in to break it (fight/present.ts refereeSpot, breaking)
    cues.push({ who: "blue", clip, start: t }, { who: "ref", clip: "refBreak", start: t + 1.1 });
    scene = "clinch";
  } else if (clip === "touchGloves") {
    cues.push({ who: "blue", clip, start: t });
    scene = "touch";
  } else if (clip === "cornerSit" || clip === "cornerRest" || clip === "cornerStand") {
    cues.push({ who: "blue", clip, start: t });
    scene = "corner";
  } else if (clip === "victory" || clip === "victoryHold") {
    cues.push({ who: "blue", clip: "defeat", start: t });
    scene = "result";
  } else if (clip === "defeat" || clip === "defeatHold") {
    cues.push({ who: "blue", clip: "victory", start: t });
    scene = "result";
  } else if (clip === "winnerRaised") {
    cues.push({ who: "ref", clip: "refRaise", start: t }, { who: "blue", clip: "defeatHold", start: t });
    scene = "result";
  } else if (info.kind === "referee") {
    cues[0] = { who: "ref", clip, start: t };
  }
  const length = Math.max(info.loop ? 3 : info.duration + 1.1, 2.2);
  return { cues, length, scene };
}

/* ---------------- one fighter ---------------- */

function Fighter({ look, corner, motion, clock, at, kitOn, headgear, referee, resetKey = 0, probe, opponent }: { look: AvatarLook; corner: Corner; motion: BoxingMotion; clock: LabClock; at: Spot; kitOn: boolean; headgear: boolean; referee?: boolean; resetKey?: number; probe?: React.MutableRefObject<BoxerProbe | null>; opponent?: React.MutableRefObject<BoxerProbe | null> }) {
  const kit = useMemo(() => (kitOn && !referee ? boxingKitOverride(look, corner, { headgear }) : null), [look, corner, kitOn, headgear, referee]);
  const shown = useMemo(() => (referee ? refereeLook(look) : (kit?.look ?? look)), [kit, look, referee]);
  const weight = useMemo(() => ({ current: Number(new URLSearchParams(location.search).get("w") ?? 1) }), []);
  const layer = useMemo(() => boxingLayer({ motion, clock: clock.now, kit, weight }), [motion, clock, kit, weight]);
  const anim = useRef(0);
  const g = useRef<THREE.Group>(null);
  const base = useRef({ x: at.x, z: at.z, yaw: at.yaw, key: -1 as number, clip: "" as string, mirrored: false });
  const tr = useMemo(() => [0, 0, 0] as [number, number, number], []);
  useEffect(() => {
    base.current = { x: at.x, z: at.z, yaw: at.yaw, key: -1, clip: "", mirrored: false };
  }, [at.x, at.z, at.yaw, resetKey]);
  // the root follows the clip's travel (footwork, being pushed back); travels add up clip after clip
  useFrame(() => {
    const t = clock.now();
    const cur = motion.current(t);
    const b = base.current;
    if (cur.start !== b.key) {
      // the previous clip's travel is now part of the base
      if (b.key >= 0 && b.clip && BOXING_CLIPS[b.clip as BoxingClipName].travel) {
        const prev = BOXING_CLIPS[b.clip as BoxingClipName].travel!;
        const c = Math.cos(b.yaw),
          sn = Math.sin(b.yaw);
        const px = prev[0] * (b.mirrored ? -1 : 1),
          pz = prev[1],
          py = prev[2] * (b.mirrored ? -1 : 1);
        b.x += px * c + pz * sn;
        b.z += -px * sn + pz * c;
        b.yaw += py;
      }
      b.key = cur.start;
      b.clip = cur.clip;
      b.mirrored = !!cur.mirrored;
    }
    motion.travel(t, tr);
    const c = Math.cos(b.yaw),
      sn = Math.sin(b.yaw);
    if (g.current) {
      g.current.position.set(b.x + tr[0] * c + tr[1] * sn, at.y, b.z - tr[0] * sn + tr[1] * c);
      g.current.rotation.set(0, b.yaw + tr[2], 0);
    }
  });
  // body=boxer: the ring people's realistic body (BoxerAvatar), the one the hall and the fight lab use
  const boxerBody = useMemo(() => new URLSearchParams(location.search).get("body") === "boxer", []);
  // P3-FGT-17 evidence: glb=before (the P3-FGT-16 bodies and shading), rtone / btone = a skin tone index per corner
  const lab = useMemo(() => {
    const qq = new URLSearchParams(location.search);
    const tone = qq.get(corner === "red" ? "rtone" : "btone");
    const g = look.bodyType === "feminine" ? "f" : "m";
    return { before: qq.get("glb") === "before", v6: qq.get("glb") === "v6", tone: tone !== null ? SKIN_TONES[Number(tone)] : undefined, g };
  }, [corner, look.bodyType]);
  const boxerLook = lab.tone && !referee ? { ...look, skinTone: lab.tone } : look;
  return (
    <group ref={g} position={[at.x, at.y, at.z]} rotation={[0, at.yaw, 0]}>
      {boxerBody ? (
        <BoxerAvatar look={boxerLook} outfit={referee ? "referee" : "boxer"} kit={corner === "red" ? "#b3242b" : "#1f4fb0"} motion={motion} clock={clock.now} weight={weight} seed={corner === "red" ? 11 : 23} noHeadgear={!headgear} probe={probe} opponent={opponent} src={lab.before ? `/assets/characters/boxer-${lab.g}-v5.glb` : lab.v6 ? `/assets/characters/boxer-${lab.g}-v6.glb` : undefined} v5={lab.before} v6={lab.v6} />
      ) : (
        <Avatar look={shown} animRef={anim} showTag={false} shadows rigLayer={layer} seedId={`lab-${corner}-${look.bodyType}`} />
      )}
    </group>
  );
}

/* ---------------- scenes ---------------- */

function useQuery() {
  return useMemo(() => new URLSearchParams(typeof location !== "undefined" ? location.search : ""), []);
}

function Duel({ q, setInfo }: { q: URLSearchParams; setInfo: (s: string) => void }) {
  const one = q.get("clip") as BoxingClipName | null;
  const list = useMemo(() => (one && BOXING_CLIPS[one] ? [one] : BOXING_CLIP_NAMES.filter((n) => !["guard", "guardIdle", "refIdle"].includes(n))), [one]);
  const southpaw = q.get("southpaw");
  const headgear = q.get("headgear") === "1";
  const redBody = (q.get("red") as BodyType) ?? "masculine";
  const blueBody = (q.get("blue") as BodyType) ?? "neutral";
  // the schedule: each clip in turn, with its partner's cue
  const plan = useMemo(() => {
    const segs: { t0: number; length: number; cues: Cue[]; clip: BoxingClipName; scene: string }[] = [];
    let t = 0.6;
    for (const c of list) {
      const s = cuesFor(c, t);
      segs.push({ t0: t, length: s.length, cues: s.cues, clip: c, scene: s.scene });
      t += s.length;
    }
    return { segs, total: t };
  }, [list]);
  const atQ = q.get("at");
  const freeze = useMemo(() => {
    if (atQ === null) return null;
    const seg = plan.segs[0]!;
    const red = seg.cues.find((c) => c.who === "red" || c.who === "ref")!;
    const imp = BOXING_CLIPS[red.clip].impact;
    const base = atQ === "impact" ? red.start + (imp ?? 0) : red.start + Number(atQ);
    return base + Number(q.get("dt") ?? 0);
  }, [atQ, plan, q]);
  const clock = useMemo(() => makeClock(q, freeze), [q, freeze]);
  const motions = useMemo(
    () => ({ red: new BoxingMotion({ mirrored: southpaw === "red" }), blue: new BoxingMotion({ mirrored: southpaw === "blue" }), ref: new BoxingMotion({ base: "refIdle" }) }),
    [southpaw],
  );
  const [seg, setSeg] = useState(0);
  const st = useRef({ played: -1, loop: 0, lastT: 0 });
  // feed the cues (stamped with their own start times: frame timing never matters)
  const probeRed = useRef<BoxerProbe | null>(null);
  const probeBlue = useRef<BoxerProbe | null>(null);
  const aimed = useRef(false);
  /** contact IK as the hall does it (fighters.tsx aimFor): the other's face / body, a glove radius short, in my root frame */
  const aimOf = (who: "red" | "blue", clip: BoxingClipName): [number, number, number] | undefined => {
    const att = (who === "red" ? probeRed : probeBlue).current;
    const def = (who === "red" ? probeBlue : probeRed).current;
    const info = BOXING_CLIPS[clip];
    if (!att || !def || info.kind !== "punch") return undefined;
    const w = info.target === "body" ? def.body(new THREE.Vector3()) : def.head(new THREE.Vector3());
    const r = att.inst.root;
    r.updateMatrixWorld(true);
    const from = r.getWorldPosition(new THREE.Vector3()).setY(w.y);
    w.addScaledVector(w.clone().sub(from).normalize(), -0.1);
    r.worldToLocal(w);
    const k = att.rig.kArm || 1;
    return [w.x / k, w.y / k, w.z / k];
  };
  const feed = (t: number) => {
    const s = st.current;
    const loopT = freeze !== null ? t : t % plan.total;
    const loop = freeze !== null ? 0 : Math.floor(t / plan.total);
    if (loop !== s.loop) {
      s.loop = loop;
      s.played = -1;
    }
    const off = loop * plan.total;
    plan.segs.forEach((sg, i) => {
      if (i <= s.played || loopT < sg.t0 - 0.0001) return;
      s.played = i;
      setSeg(i);
      for (const c of sg.cues) {
        const m = motions[c.who];
        // each segment starts from the guard at the fighters' spots
        m.play({ clip: c.who === "ref" ? "refIdle" : "guardIdle", start: off + sg.t0 - 0.0001, mirrored: c.who === "red" ? southpaw === "red" : c.who === "blue" ? southpaw === "blue" : false, blend: 0 });
      }
      for (const c of [...sg.cues].sort((a, b) => a.start - b.start)) {
        const m = motions[c.who];
        const aim = c.who === "ref" ? undefined : aimOf(c.who, c.clip);
        m.play({ clip: c.clip, start: off + c.start, hold: c.hold, mirrored: c.who === "red" ? southpaw === "red" : c.who === "blue" ? southpaw === "blue" : false, ...(aim ? { aim } : {}) });
      }
    });
  };
  // prime the frozen scene before the first frame
  useLayoutEffect(() => {
    if (freeze !== null) feed(freeze);
  }, [freeze]);
  useFrame(() => {
    const t = clock.now();
    if (freeze === null) feed(t);
    else if (!aimed.current && probeRed.current && probeBlue.current) {
      // frozen: replay the segment once both bodies exist, with the contact targets
      aimed.current = true;
      st.current.played = -1;
      feed(freeze);
    }
    const cur = motions.red.current(t);
    (window as unknown as { __gkLab?: object }).__gkLab = { clip: plan.segs[seg]?.clip, red: cur.clip, blue: motions.blue.current(t).clip, t: Number(t.toFixed(3)) };
  });
  const sg = plan.segs[seg] ?? plan.segs[0]!;
  useEffect(() => setInfo(`${BX.clip}: ${sg.clip}`), [sg.clip, setInfo]);
  const scene = sg.scene;
  // (a clinch stands at the engine's tie-up distance: fight/present.ts canvasGapOf(640 mm))
  const gap = scene === "touch" ? TOUCH_DISTANCE : scene === "clinch" ? Number(q.get("gap") ?? canvasGapOf(640)) : Number(q.get("gap") ?? PUNCH_RANGE);
  const spots = useMemo(() => {
    if (scene === "corner") return { red: stoolSpot(LAB_RING, "red"), blue: stoolSpot(LAB_RING, "blue") };
    if (scene === "result") {
      // facing the judges' side (−z), the referee by the winner's raised hand
      const red = toHall(LAB_RING, 0.55, RING.deck, -0.6, Math.PI);
      const blue = toHall(LAB_RING, -1.2, RING.deck, 0.2, Math.PI);
      return { red, blue };
    }
    return fightSpots(LAB_RING, gap);
  }, [scene, gap]);
  const refAt = useMemo(() => {
    if (scene === "result") {
      // REF_RAISE.offset is in the winner's frame (winner faces −z here: the offset's x flips)
      return toHall(LAB_RING, 0.55 - REF_RAISE.offset[0], RING.deck, -0.6 + REF_RAISE.offset[2], Math.PI);
    }
    // over a downed red fighter: on the far side from the side camera, facing them
    const red = spots.red;
    const x = red.x - 0.85,
      z = red.z + 0.45;
    if (sg.cues.some((c) => c.clip === "refCount")) return { x, y: RING.deck, z, yaw: Math.atan2(red.x - x, red.z - z) };
    if (scene === "clinch") {
      // the hall's own rule (fight/present.ts refereeSpot while breaking): off the pair line on the far side from the
      // side camera, facing the pair
      const blue = spots.blue;
      const mx = (red.x + blue.x) / 2,
        mz = (red.z + blue.z) / 2;
      const s = presentRefereeSpot("round", { dist: 640, down: -1, winner: null, breaking: true, half: RING.post, gap });
      const ax = (blue.x - red.x) / gap,
        az = (blue.z - red.z) / gap;
      // perpendicular, away from the side camera (+x, −z)
      const px = -az,
        pz = ax;
      const sgn = px * 1 + pz * -1 > 0 ? -1 : 1;
      const rx = mx + s.x * ax + sgn * s.z * px,
        rz = mz + s.x * az + sgn * s.z * pz;
      return { x: rx, y: RING.deck, z: rz, yaw: Math.atan2(mx - rx, mz - rz) };
    }
    const s = refereeSpot(LAB_RING);
    return { ...s, x: s.x - 2.2, z: s.z + 2.2, yaw: s.yaw + Math.PI };
  }, [scene, spots, sg]);
  const showRef = q.get("ref") === "1" || sg.cues.some((c) => c.who === "ref");
  return (
    <>
      <Fighter look={LOOKS[redBody] ?? LOOKS.masculine} corner="red" motion={motions.red} clock={clock} at={spots.red} kitOn headgear={headgear} resetKey={seg} probe={probeRed} opponent={probeBlue} />
      <Fighter look={LOOKS[blueBody] ?? LOOKS.neutral} corner="blue" motion={motions.blue} clock={clock} at={spots.blue} kitOn headgear={headgear} resetKey={seg} probe={probeBlue} opponent={probeRed} />
      {showRef && <Fighter look={{ ...LOOKS.masculine, skinTone: SKIN_TONES[1]!, hairStyle: "buzz" }} corner="red" motion={motions.ref} clock={clock} at={refAt} kitOn={false} headgear={false} referee resetKey={seg} />}
    </>
  );
}

/** three bodies in the kit side by side (kit close-ups) */
function KitLineup({ q, setInfo }: { q: URLSearchParams; setInfo: (s: string) => void }) {
  const corner = (q.get("corner") as Corner) ?? "red";
  const headgear = q.get("headgear") === "1";
  const clip = (q.get("clip") as BoxingClipName) ?? "guard";
  const clock = useMemo(() => makeClock(q, q.get("at") !== null ? Number(q.get("at")) : null), [q]);
  const motions = useMemo(
    () =>
      (["feminine", "masculine", "neutral"] as const).map(() => {
        const m = new BoxingMotion();
        m.play({ clip: BOXING_CLIPS[clip] ? clip : "guard", start: 0, blend: 0 });
        return m;
      }),
    [clip],
  );
  useEffect(() => setInfo(`kit: ${corner}${headgear ? " + headgear" : ""}`), [corner, headgear, setInfo]);
  return (
    <>
      {(["feminine", "masculine", "neutral"] as const).map((b, i) => (
        <Fighter key={b} look={LOOKS[b]} corner={corner} motion={motions[i]!} clock={clock} at={{ x: (i - 1) * 1.05, y: RING.deck, z: -1, yaw: 0 }} kitOn headgear={headgear} />
      ))}
    </>
  );
}

/** the 50-ring field (10 × 5 on a 12 m grid), statuses cycling */
function fieldRings(): RingSpec[] {
  const st = ["free", "waiting", "fighting", "fighting", "free"] as const;
  return Array.from({ length: 50 }, (_, i) => ({ id: i === 0 ? "lab" : `ring-${i + 1}`, number: i + 1, x: (i % 10) * 12 - 54 + 54, z: Math.floor(i / 10) * 12, rotY: 0, status: st[(i * 7) % 5]!, rest: i % 4 === 1 }));
}

/* ---------------- camera + probe ---------------- */

function CameraRig({ preset, mode }: { preset: string; mode: string }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const d = RING.deck;
    const P: Record<string, [number, number, number, number, number, number]> = {
      side: [2.6, d + 1.55, -2.6, 0, d + 1.25, 0],
      back: [-2.6, d + 1.55, 2.6, 0, d + 1.25, 0],
      front: [-1.55, d + 1.65, -1.85, 0.25, d + 1.4, 0.25],
      close: [1.45, d + 1.6, -1.45, 0, d + 1.35, 0],
      low: [2.2, d + 0.6, -2.2, 0, d + 0.9, 0],
      corner: [0.2, d + 1.6, 0.2, -2.4, d + 0.8, -2.4],
      ring: [8.5, 4.2, -9.5, 0, 1.3, 0],
      top: [0.01, 13, 0.01, 0, 0, 0],
      field: [-18, 30, -20, 50, 0, 26],
      hall: [30, 1.7, -9, 50, 1.2, 22],
      kit: [0, d + 1.15, 2.55, 0, d + 0.92, -1],
      gloves: [0.15, d + 1.5, 0.6, 0, d + 1.35, -1],
      head: [0, d + 1.62, 0.15, 0, d + 1.58, -1],
      boots: [0.3, d + 0.45, 0.8, 0, d + 0.2, -1],
      trunks: [0.2, d + 0.95, 0.9, 0, d + 0.85, -1],
      result: [0.2, d + 1.6, -4.2, 0, d + 1.35, 0],
    };
    const p = P[preset] ?? (mode === "field" ? P.field! : mode === "kit" ? P.kit! : P.side!);
    camera.position.set(p[0], p[1], p[2]);
    camera.lookAt(p[3], p[4], p[5]);
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = mode === "field" ? 55 : mode === "kit" && preset === "" ? 50 : 38;
    cam.far = 600;
    cam.updateProjectionMatrix();
  }, [camera, preset, mode, size.width, size.height]);
  return null;
}

function Probe({ ringStats }: { ringStats: React.RefObject<RingKitStats | null> }) {
  const gl = useThree((s) => s.gl);
  const probe = useMemo(() => ({ calls: 0, tris: 0, frames: 0, rings: null as RingKitStats | null }), []);
  useEffect(() => {
    (window as unknown as { __gkProbe?: typeof probe }).__gkProbe = probe;
  }, [probe]);
  useFrame(() => {
    // renderer.info of the previous frame (reset at the start of each render)
    probe.calls = gl.info.render.calls;
    probe.tris = gl.info.render.triangles;
    probe.frames++;
    probe.rings = ringStats.current;
  });
  return null;
}

/**
 * P3-FGT-18: `light=ring` — the hall's fight-night rig instead of the studio lights (fight/ring-lights.tsx RingMood:
 * the dark room, the overhead key with the ring's shadow, rims and camera-side fills; with BOXER_V7 also the N8AO post
 * pass of the hall's composer), so a lab shot is lit as the user sees the ring.
 */
function RingLights() {
  return (
    <>
      <hemisphereLight args={["#fbf1e4", "#57504a", 1.55]} />
      <ambientLight color="#ffe9d0" intensity={0.28} />
      <directionalLight position={[14, 30, 10]} intensity={1.1} color="#fff1df" />
      <RingMood k={() => 1} ring={() => ({ x: LAB_RING.x, z: LAB_RING.z, canvasY: RING.deck })} withKey />
      {BOXER_V7 && (
        <EffectComposer multisampling={4} enableNormalPass={false}>
          <N8AO quality="performance" aoRadius={0.55} distanceFalloff={0.9} intensity={2.4} color="black" />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}
    </>
  );
}

function Lights({ field }: { field: boolean }) {
  if (typeof location !== "undefined" && new URLSearchParams(location.search).get("light") === "ring") return <RingLights />;
  return (
    <>
      <hemisphereLight args={["#eef0f4", "#24262b", 0.75]} />
      <directionalLight position={field ? [30, 40, 10] : [4, 9, -3]} intensity={2.0} castShadow={!field} shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02}>
        <orthographicCamera attach="shadow-camera" args={[-6, 6, 6, -6, 0.5, 30]} />
      </directionalLight>
      <directionalLight position={[-3, 3.5, 4]} intensity={0.85} color="#fbf7f2" />
      <directionalLight position={[-4, 5, -5]} intensity={0.5} color="#dfe6f2" />
    </>
  );
}

/* ---------------- page ---------------- */

export default function BoxingLab() {
  const q = useQuery();
  const mode = q.get("mode") ?? "duel";
  const tier = (q.get("tier") as "lite" | "standard") ?? "standard";
  const preset = q.get("cam") ?? "";
  const [info, setInfo] = useState("");
  const [hud, setHud] = useState("");
  const ringStats = useRef<RingKitStats | null>(null);
  const rest = (q.get("clip") ?? "").startsWith("corner");
  const rings = useMemo(() => (mode === "field" ? fieldRings() : [{ ...LAB_RING, rest }]), [mode, rest]);
  useEffect(() => {
    const id = setInterval(() => {
      const p = (window as unknown as { __gkProbe?: { calls: number; tris: number; rings: RingKitStats | null } }).__gkProbe;
      if (!p) return;
      const r = p.rings;
      setHud(`${BX.drawCalls} ${p.calls} · ${BX.triangles} ${p.tris.toLocaleString("en")}${r ? ` · ${BX.rings}: ${BX.near} ${r.near} / ${BX.far} ${r.far} / ${BX.culled} ${r.culled} · kit ${r.drawCalls} calls, ${r.triangles.toLocaleString("en")} tris` : ""}`);
    }, 400);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="fixed inset-0 bg-[#0e0f11] text-white">
      <Canvas
        shadows="percentage"
        dpr={[1, 1.75]}
        camera={{ fov: 38, position: [3, 2.5, -3], near: 0.05, far: 600 }}
        gl={{ antialias: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.0 }}
      >
        <color attach="background" args={["#16171a"]} />
        <fog attach="fog" args={["#16171a", 60, 220]} />
        <Lights field={mode === "field"} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[400, 400]} />
          <meshStandardMaterial color="#26282d" roughness={0.95} />
        </mesh>
        {mode !== "boxer" && <RingKit rings={rings} featureRing="lab" tier={tier} statsRef={ringStats} />}
        {mode === "boxer" && <BoxerLab q={q} setInfo={setInfo} />}
        {mode === "duel" && <Duel q={q} setInfo={setInfo} />}
        {mode === "field" && <Duel q={q} setInfo={setInfo} />}
        {mode === "kit" && <KitLineup q={q} setInfo={setInfo} />}
        {mode !== "boxer" && <CameraRig preset={preset} mode={mode} />}
        <Probe ringStats={ringStats} />
      </Canvas>
      <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/45 px-3 py-2 font-display text-xs leading-5 backdrop-blur">
        <div className="font-bold">{BX.lab}</div>
        <div data-lab-info>{info}</div>
        <div data-lab-hud className="opacity-70">
          {hud}
        </div>
      </div>
    </div>
  );
}

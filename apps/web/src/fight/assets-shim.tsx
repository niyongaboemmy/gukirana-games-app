"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { BoxingClip, Corner, RingId, RingStatus } from "@gukirana/contracts";
import { Avatar } from "@/world/Avatar";
import type { AvatarLook } from "@/world/outfits";
import { boxingKitOverride, KitSwap } from "@/world/human/boxing/kit";
import { boxingLayer } from "@/world/human/boxing/layer";
import { BoxingMotion } from "@/world/human/boxing/motion";
import type { BoxingClipName } from "@/world/human/boxing/clips";
import { RingKit } from "@/rooms/fight/ring-kit";
import type { RingSize, RingSpec, RingStatus as KitStatus } from "@/rooms/fight/ring-kit-core";

/**
 * The world's adapter onto the Boxing assets (P3-FGT-02, merged): the ONE place fight/** touches
 *   rooms/fight/ring-kit*            (RingKit: the feature rings),
 *   world/human/boxing/{kit,layer,motion,clips}  (kit look + dressing, motion library, through Avatar `rigLayer`).
 * It maps the contracts' names (RingStatus, BOXING_CLIPS) onto the assets' names. Never edit the assets files.
 */

/* ------------------------------------------------------------ rings ------------------------------------------------------------ */

/** status → lamp colour for the hall's own status signs (colour is never the only signal: the boxes say it in words) */
export const STATUS_LAMP: Record<RingStatus, string> = {
  free: "#2E9D57",
  waiting: "#E3A21A",
  starting: "#C8322A",
  fighting: "#C8322A",
  result: "#C8322A",
  practice: "#EDEDE8",
  closed: "#3a3a3c",
};
/** the ring kit knows four lamp states */
export const kitStatus = (s: RingStatus): KitStatus => (s === "free" || s === "waiting" || s === "closed" ? s : "fighting");

export interface HallRing {
  id: RingId;
  x: number;
  z: number;
  rotY: number;
  status: RingStatus;
  number: number;
  rest?: boolean;
}
/** LOD distances of the small training rings (their near kit is detailed; far ones read fine as the far kit) */
const TRAINING_LOD = { standard: { near: 15 }, lite: { near: 9 } } as const;

/**
 * A field of hall rings with the assets ring kit (P3-FGT-03): `size` "pro" (the feature rings R1 / R2, on the raised
 * stage `y`, with the feature extras) or "training" (the 48 standard rings). The lamps take the hall's status
 * colours (practice white, closed dark); the number signs are the hall's own (fight/ring-signs), so no boards here.
 * `rest` puts the stools in the corners.
 */
export function HallRingKit({ rings, size, y = 0, lite }: { rings: HallRing[]; size: RingSize; y?: number; lite: boolean }) {
  const specs = useMemo<RingSpec[]>(
    // the front feature ring (R1) turns its extras so its third judges' table faces the stage front, not R2
    () => rings.map((r) => ({ id: r.id, x: r.x, z: r.z, rotY: r.rotY, status: kitStatus(r.status), lamp: STATUS_LAMP[r.status], number: r.number, rest: r.rest, size, extrasYaw: r.id === "R1" ? Math.PI : 0 })),
    [rings, size],
  );
  const tier = lite ? "lite" : "standard";
  return (
    <group position={[0, y, 0]} userData={{ noMerge: true }}>
      <RingKit rings={specs} size={size} featureRing={size === "pro" ? (specs[0]?.id ?? null) : null} tier={tier} lod={size === "training" ? TRAINING_LOD[tier] : undefined} shadows={false} boards={false} />
    </group>
  );
}

/* ------------------------------------------------------------ motion ------------------------------------------------------------ */

/** contracts clip (BOXING_CLIPS, what `clipFor` returns) → the motion library's clip */
export const CLIP_MAP: Record<BoxingClip, BoxingClipName> = {
  guard: "guardIdle",
  guardLow: "guard",
  stepIn: "stepForward",
  stepOut: "stepBack",
  sideStepL: "stepLeft",
  sideStepR: "stepRight",
  pivot: "pivot",
  jab: "jab",
  cross: "cross",
  hookL: "leadHook",
  hookR: "rearHook",
  uppercutL: "leadUppercut",
  uppercutR: "rearUppercut",
  blockHigh: "blockHigh",
  blockLow: "blockLow",
  slipL: "slipLeft",
  slipR: "slipRight",
  duck: "duck",
  hitHeadLight: "hitHeadLight",
  hitHeadHeavy: "hitHeadHeavy",
  hitBodyLight: "hitBodyLight",
  hitBodyHeavy: "hitBodyHeavy",
  knockdown: "knockdown",
  getUp: "getUp",
  countIdle: "guardIdle",
  victory: "victory",
  defeat: "defeat",
  stoolRest: "cornerRest",
  gloveTouch: "touchGloves",
};

/** what the renderer asks for, per fighter per frame */
export interface FighterPose {
  clip: BoxingClip;
  /** seconds into the clip (actT / TICK_HZ) */
  t: number;
  /** a hit reaction on top (HIT_REACTION[punch]), with its own time (s since the hit) */
  react: { clip: BoxingClip; t: number } | null;
}

const LOOPS = new Set<BoxingClip>(["guard", "guardLow", "countIdle", "stoolRest"]);
const now = () => performance.now() / 1000;

/**
 * A fighter in the ring: the person in their corner's kit (boxingKitOverride: a new look, the saved one is never
 * touched; the kit dressing comes with the boxing rig layer), posed by ONE BoxingMotion that outlives look swaps.
 * Every frame the pose request (clip + time into it, from the snapshot) becomes a `play` when it changes; a hit
 * reaction is played over it. The kit fades in with the KitSwap timing as they step in (≈ 0.5 s, dithered).
 */
/** climbing the ring steps (fight/climb): walking uses the base walk clip (layer off), ducking blends the duck pose in */
export interface ClimbBlend {
  walk: boolean;
  duck: number;
}

export function FighterAvatar({ look, corner, poseRef, lite = false, climbRef }: { look: AvatarLook; corner: Corner; poseRef: React.RefObject<FighterPose | null>; lite?: boolean; climbRef?: React.RefObject<ClimbBlend | null> }) {
  const motion = useMemo(() => new BoxingMotion(), []);
  const kit = useMemo(() => boxingKitOverride(look, corner, { headgear: true }), [look, corner]);
  const weight = useMemo(() => ({ current: 1 }), []);
  const layer = useMemo(() => boxingLayer({ motion, kit, weight }), [motion, kit, weight]);
  // fade IN only (P3-FGT-04): the default swap first fades the figure OUT, which on a fresh mount (you step into the
  // ring, a spectated pair replaces its impostors) read as a blink — visible, gone, back. Dithered in over 0.35 s.
  const swap = useMemo(() => new KitSwap(0, 0.35), []);
  const fade = useRef(0);
  const anim = useRef(0);
  const last = useRef({ key: "", react: "" });
  useEffect(() => swap.enter(now()), [swap]);
  useFrame(() => {
    const t = now();
    fade.current = swap.sample(t).fade;
    // on the steps: the normal walk clip, the boxing layer eased out; through the ropes: the duck pose eased in
    const cl = climbRef?.current;
    const target = cl?.walk ? 0 : 1;
    weight.current += (target - weight.current) * 0.25;
    anim.current = cl?.walk ? 1 : 0;
    const p = poseRef.current;
    if (!p) return;
    // a hit reaction plays once, over whatever was showing
    if (p.react) {
      const rk = `${p.react.clip}@${Math.round((t - p.react.t) * 20)}`;
      if (rk !== last.current.react) {
        last.current.react = rk;
        motion.play({ clip: CLIP_MAP[p.react.clip], start: t - p.react.t, blend: 0.05 });
      }
      return;
    }
    // an action (re)starts when its start time moves; loops keep running
    const start = t - p.t;
    const key = LOOPS.has(p.clip) ? p.clip : `${p.clip}@${Math.round(start * 10)}`;
    if (key !== last.current.key) {
      last.current.key = key;
      motion.play({ clip: CLIP_MAP[p.clip], start: LOOPS.has(p.clip) ? t : start });
    }
  });
  return <Avatar look={kit.look} animRef={anim} showTag={false} shadows={!lite} quality={lite ? "lite" : "standard"} lod rigLayer={layer} fadeRef={fade} />;
}


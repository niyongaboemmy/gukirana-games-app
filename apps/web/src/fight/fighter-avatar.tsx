"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Corner } from "@gukirana/contracts";
import { Avatar } from "@/world/Avatar";
import type { AvatarLook } from "@/world/outfits";
import { boxingKitOverride, KitSwap, refereeLook } from "@/world/human/boxing/kit";
import { boxingLayer } from "@/world/human/boxing/layer";
import { BoxingMotion } from "@/world/human/boxing/motion";
import { BOXING_CLIPS, type BoxingClipName } from "@/world/human/boxing/clips";
import type { Mood, PoseCmd } from "./present";

/**
 * Ring people driven by fight/present.ts (P3-FGT-05): a fighter in the corner's kit and the referee in white shirt,
 * each posed by one BoxingMotion that outlives look swaps. The renderer writes a `RingBody` per frame:
 *  - `cmd`: the clip, time-warped to the engine (restarts only when the instance really changes, so a confirmed
 *    prediction does not restart the punch);
 *  - `react`: a power-scaled hit reaction played over it (the command resumes when it ends);
 *  - `mood`: face moods on top of the clips' expressions;
 *  - `walk`: walking to the corner / the neutral corner (the base walk clip, the boxing layer eased out).
 */
export interface RingBody {
  cmd: PoseCmd | null;
  react: { clip: BoxingClipName; intensity: number; at: number } | null;
  mood: Mood | null;
  walk: boolean;
  /** through the ropes (climb in / out): the duck pose */
  duck?: boolean;
}
export const newBody = (): RingBody => ({ cmd: null, react: null, mood: null, walk: false });

const now = () => performance.now() / 1000;
const LOOP = (c: BoxingClipName) => BOXING_CLIPS[c].loop;

function useBodyDriver(motion: BoxingMotion, body: React.RefObject<RingBody | null>, weight: { current: number }, anim: React.RefObject<number>) {
  const last = useRef({ clip: "" as string, key: "", start: 0, reactAt: -1, reactEnd: 0 });
  useFrame(() => {
    const t = now();
    const b = body.current;
    if (!b) return;
    const target = b.walk ? 0 : 1;
    weight.current += (target - weight.current) * 0.2;
    anim.current = b.walk ? 1 : 0;
    if (b.mood) motion.setMood(b.mood);
    const L = last.current;
    const c = b.cmd;
    // a hit reaction plays once over whatever was showing (a knockdown overrides it)
    if (b.react && b.react.at !== L.reactAt && c?.clip !== "knockdown") {
      L.reactAt = b.react.at;
      const start = b.react.at / 1000;
      L.reactEnd = start + BOXING_CLIPS[b.react.clip].duration * 0.85;
      motion.play({ clip: b.react.clip, start, intensity: b.react.intensity, blend: 0.05 });
      L.key = "";
      return;
    }
    if (t < L.reactEnd && c?.clip !== "knockdown") return;
    if (!c) return;
    const start = t - c.offset / Math.max(0.1, c.speed);
    const same = c.clip === L.clip && (LOOP(c.clip) || c.key === L.key || Math.abs(start - L.start) < 0.12);
    if (same) {
      L.key = c.key;
      return;
    }
    L.clip = c.clip;
    L.key = c.key;
    L.start = LOOP(c.clip) ? t : start;
    motion.play({ clip: c.clip, start: L.start, speed: c.speed, intensity: c.intensity, hold: c.hold });
  });
}

export function FightAvatar({ look, corner, body, lite = false }: { look: AvatarLook; corner: Corner; body: React.RefObject<RingBody | null>; lite?: boolean }) {
  const motion = useMemo(() => new BoxingMotion(), []);
  const kit = useMemo(() => boxingKitOverride(look, corner, { headgear: true }), [look, corner]);
  const weight = useMemo(() => ({ current: 1 }), []);
  const layer = useMemo(() => boxingLayer({ motion, kit, weight }), [motion, kit, weight]);
  const swap = useMemo(() => new KitSwap(), []);
  const fade = useRef(0);
  const anim = useRef(0);
  useEffect(() => swap.enter(now()), [swap]);
  useFrame(() => {
    fade.current = swap.sample(now()).fade;
  });
  useBodyDriver(motion, body, weight, anim);
  return <Avatar look={kit.look} animRef={anim} showTag={false} shadows={!lite} quality={lite ? "lite" : "standard"} lod rigLayer={layer} fadeRef={fade} />;
}

/** the referee: staff NPC in white shirt, bare hands, the motion library's referee clips (count, break, raise) */
export function RefereeAvatar({ look, body, lite = false }: { look: AvatarLook; body: React.RefObject<RingBody | null>; lite?: boolean }) {
  const motion = useMemo(() => new BoxingMotion({ base: "refIdle" }), []);
  const refLook = useMemo(() => refereeLook(look), [look]);
  const weight = useMemo(() => ({ current: 1 }), []);
  const layer = useMemo(() => boxingLayer({ motion, kit: null, weight }), [motion, weight]);
  const anim = useRef(0);
  useBodyDriver(motion, body, weight, anim);
  return <Avatar look={refLook} animRef={anim} showTag={false} shadows={!lite} quality={lite ? "lite" : "standard"} lod rigLayer={layer} />;
}

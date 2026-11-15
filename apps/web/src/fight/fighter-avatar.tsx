"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CORNER_COLORS, type Corner } from "@gukirana/contracts";
import { Avatar } from "@/world/Avatar";
import type { AvatarLook } from "@/world/outfits";
import { boxingKitOverride, KitSwap, refereeLook } from "@/world/human/boxing/kit";
import { boxingLayer } from "@/world/human/boxing/layer";
import { BoxingMotion } from "@/world/human/boxing/motion";
import { BOXING_CLIPS, type BoxingClipName } from "@/world/human/boxing/clips";
import type { RingLife } from "@/world/human/boxing/life";
import type { Mood, PoseCmd } from "./present";
import { ringNow } from "./ring-clock";
import { BoxerAvatar, type BoxerProbe } from "@/world/human/boxer/BoxerAvatar";

/** P3-FGT-13: the ring people on the dedicated boxer body (on unless NEXT_PUBLIC_FF_BOXER_BODY=0) */
export const BOXER_BODY = process.env.NEXT_PUBLIC_FF_BOXER_BODY !== "0";

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
  /** ring life (P3-FGT-07): bounce, weight shifts, pawing, feints, shuffle while the round is live (null = off) */
  life?: RingLife | null;
  /** through the ropes (climb in / out): the duck pose */
  duck?: boolean;
  /** skin sheen 0…1 (P3-FGT-09: builds as stamina is spent) */
  sweat?: number;
  /** P3-FGT-13: redness where punches landed [head, torso] 0…1 (no blood, no injury) */
  red?: [number, number];
}
export const newBody = (): RingBody => ({ cmd: null, react: null, mood: null, walk: false });

/** the ring motion clock (hit-stops hold it for a few frames; fight/ring-clock) */
const now = ringNow;
const LOOP = (c: BoxingClipName) => BOXING_CLIPS[c].loop;

function useBodyDriver(motion: BoxingMotion, body: React.RefObject<RingBody | null>, weight: { current: number }, anim: React.RefObject<number>, walkClip: BoxingClipName | null = null) {
  const last = useRef({ clip: "" as string, key: "", start: 0, reactAt: -1, reactEnd: 0 });
  useFrame(() => {
    const t = now();
    const b = body.current;
    if (!b) return;
    // the boxer body walks with the motion library (no plaza mocap underneath): the layer stays on
    if (walkClip) {
      const L0 = last.current;
      if (b.walk) {
        if (L0.clip !== walkClip) {
          L0.clip = walkClip;
          L0.key = "";
          motion.play({ clip: walkClip, start: t, blend: 0.2 });
        }
        motion.setLife(null);
        return;
      }
      if (L0.clip === walkClip) L0.clip = "";
    }
    const target = b.walk && !walkClip ? 0 : 1;
    weight.current += (target - weight.current) * 0.2;
    anim.current = b.walk ? 1 : 0;
    if (b.mood) motion.setMood(b.mood);
    motion.setLife(b.life ?? null);
    const L = last.current;
    const c = b.cmd;
    // a hit reaction plays once over whatever was showing (a knockdown overrides it)
    if (b.react && b.react.at !== L.reactAt && c?.clip !== "knockdown") {
      L.reactAt = b.react.at;
      // starts on the ring clock now: during a hit-stop the clock holds, so the head snaps once the stop lets go
      const start = t;
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
    motion.play({ clip: c.clip, start: L.start, speed: c.speed, intensity: c.intensity, hold: c.hold, reach: c.reach, ...(c.aim ? { aim: c.aim } : {}) });
  });
}

export function FightAvatar({
  look,
  corner,
  body,
  lite = false,
  seed = 0,
  klass = 0,
  probe,
}: {
  look: AvatarLook;
  corner: Corner;
  body: React.RefObject<RingBody | null>;
  lite?: boolean;
  seed?: number;
  klass?: number;
  probe?: React.MutableRefObject<BoxerProbe | null>;
}) {
  if (BOXER_BODY) return <FightBoxer look={look} corner={corner} body={body} lite={lite} seed={seed} klass={klass} probe={probe} />;
  return <FightAvatarPlaza look={look} corner={corner} body={body} lite={lite} />;
}

/** a fighter on the boxer body (P3-FGT-13): kit in the corner colour, sweat and redness from the meters */
function FightBoxer({
  look,
  corner,
  body,
  lite,
  seed,
  klass,
  probe,
}: {
  look: AvatarLook;
  corner: Corner;
  body: React.RefObject<RingBody | null>;
  lite: boolean;
  seed: number;
  klass: number;
  probe?: React.MutableRefObject<BoxerProbe | null>;
}) {
  const motion = useMemo(() => new BoxingMotion(), []);
  const weight = useMemo(() => ({ current: 1 }), []);
  const sweat = useMemo(() => ({ current: 0.3 }), []);
  const red = useMemo(() => ({ current: [0, 0] as [number, number] }), []);
  const anim = useRef(0);
  useFrame(() => {
    const b = body.current;
    if (b?.sweat !== undefined) sweat.current += (b.sweat - sweat.current) * 0.02;
    if (b?.red) {
      red.current[0] += (b.red[0] - red.current[0]) * 0.08;
      red.current[1] += (b.red[1] - red.current[1]) * 0.08;
    }
  });
  useBodyDriver(motion, body, weight, anim, "walk");
  return <BoxerAvatar look={look} outfit="boxer" kit={CORNER_COLORS[corner]} motion={motion} clock={ringNow} weight={weight} sweat={sweat} red={red} klass={klass} seed={seed} lite={lite} probe={probe} />;
}

function FightAvatarPlaza({ look, corner, body, lite = false }: { look: AvatarLook; corner: Corner; body: React.RefObject<RingBody | null>; lite?: boolean }) {
  const motion = useMemo(() => new BoxingMotion(), []);
  const kit = useMemo(() => boxingKitOverride(look, corner, { headgear: true }), [look, corner]);
  const weight = useMemo(() => ({ current: 1 }), []);
  const sweat = useMemo(() => ({ current: 0.35 }), []);
  const layer = useMemo(() => boxingLayer({ motion, kit, weight, clock: ringNow, sweat }), [motion, kit, weight, sweat]);
  const swap = useMemo(() => new KitSwap(), []);
  const fade = useRef(0);
  const anim = useRef(0);
  useEffect(() => swap.enter(now()), [swap]);
  useFrame(() => {
    fade.current = swap.sample(now()).fade;
    const s = body.current?.sweat;
    if (s !== undefined) sweat.current += (s - sweat.current) * 0.02;
  });
  useBodyDriver(motion, body, weight, anim);
  return <Avatar look={kit.look} animRef={anim} showTag={false} shadows={!lite} quality={lite ? "lite" : "standard"} lod rigLayer={layer} fadeRef={fade} />;
}

/** the referee: staff NPC in white shirt, bare hands, the motion library's referee clips (count, break, raise) */
export function RefereeAvatar({ look, body, lite = false, seed = 0 }: { look: AvatarLook; body: React.RefObject<RingBody | null>; lite?: boolean; seed?: number }) {
  if (BOXER_BODY) return <RefereeBoxer look={look} body={body} lite={lite} seed={seed} />;
  return <RefereePlaza look={look} body={body} lite={lite} />;
}

/** the referee on the boxer body (P3-FGT-13): white short-sleeved shirt, black bow tie, black trousers and shoes */
function RefereeBoxer({ look, body, lite, seed }: { look: AvatarLook; body: React.RefObject<RingBody | null>; lite: boolean; seed: number }) {
  const motion = useMemo(() => new BoxingMotion({ base: "refIdle" }), []);
  const weight = useMemo(() => ({ current: 1 }), []);
  const anim = useRef(0);
  useBodyDriver(motion, body, weight, anim, "refWalk");
  return <BoxerAvatar look={look} outfit="referee" motion={motion} clock={ringNow} weight={weight} seed={seed} lite={lite} />;
}

function RefereePlaza({ look, body, lite = false }: { look: AvatarLook; body: React.RefObject<RingBody | null>; lite?: boolean }) {
  const motion = useMemo(() => new BoxingMotion({ base: "refIdle" }), []);
  const refLook = useMemo(() => refereeLook(look), [look]);
  const weight = useMemo(() => ({ current: 1 }), []);
  const layer = useMemo(() => boxingLayer({ motion, kit: null, weight, referee: true, clock: ringNow }), [motion, weight]);
  const anim = useRef(0);
  useBodyDriver(motion, body, weight, anim);
  // white shirt / black trousers / bow tie on the masculine body (refereeLook), the hood trimmed (referee dressing)
  return <Avatar look={refLook} animRef={anim} showTag={false} shadows={!lite} quality={lite ? "lite" : "standard"} lod rigLayer={layer} />;
}

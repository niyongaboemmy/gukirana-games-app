"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import { create } from "zustand";
import { selfPose, useWorld } from "@/lib/world-store";
import { lookOf, useProfile } from "@/lib/profile-store";
import { Avatar } from "@/world/Avatar";
import { BoxingMotion } from "@/world/human/boxing/motion";
import { boxingLayer } from "@/world/human/boxing/layer";
import { boxingKitOverride } from "@/world/human/boxing/kit";
import { BOXING_CLIPS } from "@/world/human/boxing/clips";
import { keyTable, mouseAction, PAD_BUTTONS } from "./game/input-map";
import { useFightPrefs } from "./game/prefs";
import { hiddenPeople, SELF_ID } from "@/rooms/hall-hooks";
import { AUTO_COMBOS, BAG_HIT, bagClip, bagStance, SPEED_BAG, stepOrbit, type BagClip, type BagPunch } from "./bag-plan";
import type { GymProp } from "./gym-plan";
import { hitBag } from "./training-zone";
import { bagSound } from "./gym-life";

/**
 * Bag work (P3-FGT-08): at a heavy bag, the speed bag or the mirror your own avatar trains — gloves on, into a stance
 * square to the bag, and every punch you throw (J / K / L / I, the mouse, the gamepad, the touch buttons, or the auto
 * combo) is the motion library's punch, landing on the bag at the clip's impact moment: the bag swings and thuds in
 * the same frame. A / D (slip keys) circle the bag; E, Esc or Stop walk you back out and your usual avatar returns.
 *
 * While you train, the hall's controller is frozen (fight/hooks `frozen`) and your ordinary avatar is hidden
 * (hiddenPeople, like a fighter in a ring); this layer draws you. Cosmetic only: no Stars, no score, no server state —
 * other people see you standing at the bag (presence has no boxing action code; not added: a contract change).
 */

type Pose2 = { x: number; z: number; yaw: number };
interface BagWork {
  prop: GymProp | null;
  phase: "in" | "work" | "out" | null;
  /** clock (s) the phase started */
  t0: number;
  /** where you stood (you walk back there) */
  from: Pose2;
  auto: boolean;
}
export const useBagWork = create<BagWork>()(() => ({ prop: null, phase: null, t0: 0, from: { x: 0, z: 0, yaw: 0 }, auto: false }));
const clock = () => performance.now() / 1000;
/** input waiting for the boxer (a short buffer: punches chain like in the ring) */
const input = { queue: [] as BagPunch[], step: null as "L" | "R" | null };

export const bagActive = () => !!useBagWork.getState().prop;
export function startBagWork(prop: GymProp) {
  if (useBagWork.getState().prop) return;
  input.queue.length = 0;
  input.step = null;
  useBagWork.setState({ prop, phase: "in", t0: clock(), from: { x: selfPose.x, z: selfPose.z, yaw: selfPose.yaw }, auto: false });
}
export function stopBagWork() {
  const s = useBagWork.getState();
  if (s.phase === "in" || s.phase === "work") useBagWork.setState({ phase: "out", t0: clock(), auto: false });
}
export function bagPress(p: BagPunch) {
  if (useBagWork.getState().phase !== "work" && useBagWork.getState().phase !== "in") return;
  if (input.queue.length < 2) input.queue.push(p);
}
export const bagStep = (d: "L" | "R") => void (useBagWork.getState().phase === "work" && (input.step = d));
export const toggleBagAuto = () => useBagWork.setState((s) => ({ auto: !s.auto }));

/* ---------------- devices (the fight's own bindings: fight/game/input-map) ---------------- */

/** keys (rebindable fight keys), mouse on the 3D view, gamepad: while you train */
export function useBagControls() {
  const active = useBagWork((s) => !!s.prop);
  useEffect(() => {
    if (!active) return;
    const table = keyTable(useFightPrefs.getState().keys);
    const act = (a: string | null | undefined) => {
      if (a === "jab" || a === "cross" || a === "hook" || a === "uppercut") bagPress(a);
      else if (a === "slipL") bagStep("L");
      else if (a === "slipR") bagStep("R");
      else if (a === "stepOut") stopBagWork();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || e.repeat) return;
      if (e.code === "Escape" || e.code === "KeyE") return stopBagWork();
      act(table.get(e.code));
    };
    const onMouse = (e: PointerEvent) => {
      if ((e.target as HTMLElement)?.tagName !== "CANVAS" || e.pointerType === "touch") return;
      act(mouseAction(e.button, e.shiftKey));
    };
    const noMenu = (e: MouseEvent) => (e.target as HTMLElement)?.tagName === "CANVAS" && e.preventDefault();
    // gamepad: edge-triggered buttons, polled per animation frame
    const was = new Set<number>();
    let raf = 0;
    const poll = () => {
      raf = requestAnimationFrame(poll);
      const pad = navigator.getGamepads?.().find((g) => g && g.connected);
      if (!pad) return;
      pad.buttons.forEach((b, i) => {
        if (b.pressed && !was.has(i)) {
          was.add(i);
          if (i === 9 || i === 8) stopBagWork(); // Start / Back
          else act(PAD_BUTTONS[i]);
        } else if (!b.pressed) was.delete(i);
      });
    };
    raf = requestAnimationFrame(poll);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onMouse);
    window.addEventListener("contextmenu", noMenu);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onMouse);
      window.removeEventListener("contextmenu", noMenu);
    };
  }, [active]);
}

/* ---------------- the boxer at the bag ---------------- */

const IN_S = 0.75;
const OUT_S = 0.55;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

/** your avatar at the bag (mounted only while you train) */
export function BagWorker({ lite }: { lite: boolean }) {
  const prop = useBagWork((s) => s.prop);
  if (!prop) return null;
  return <Boxer key={prop.id} prop={prop} lite={lite} />;
}

function Boxer({ prop, lite }: { prop: GymProp; lite: boolean }) {
  const profile = useProfile();
  const look = useMemo(() => lookOf(profile), [profile]);
  // training kit with red bag gloves (a copy of your look: the saved one is never touched)
  const kit = useMemo(() => boxingKitOverride(look, "red", { headgear: false, mouthguard: false }), [look]);
  const motion = useMemo(() => new BoxingMotion(), []);
  const weight = useMemo(() => ({ current: 0 }), []);
  const layer = useMemo(() => boxingLayer({ motion, kit, weight }), [motion, kit, weight]);
  const g = useRef<THREE.Group>(null);
  const anim = useRef(1);
  const st = useRef({ orbit: 0, from: 0, to: 0, stepT: -1, nextAt: 0, n: {} as Record<string, number>, hits: [] as { at: number; clip: BagClip }[], combo: 0, comboLeft: [] as BagPunch[], pendingStep: "" as "" | "L" | "R", side: 0 });
  // hide your ordinary avatar while this one stands in for it
  useEffect(() => {
    const id = useWorld.getState().you ?? SELF_ID;
    hiddenPeople.add(id);
    return () => void hiddenPeople.delete(id);
  }, []);
  useFrame(() => {
    const grp = g.current;
    const s = useBagWork.getState();
    if (!grp || !s.prop) return;
    const t = clock();
    const S = st.current;
    const stance = bagStance(prop, S.orbit);
    let pose: Pose2 = stance;
    if (s.phase === "in") {
      // walk from where you stood into the stance, the guard coming up as you arrive
      const k = smooth((t - s.t0) / IN_S);
      pose = { x: lerp(s.from.x, stance.x, k), z: lerp(s.from.z, stance.z, k), yaw: s.from.yaw + wrap(stance.yaw - s.from.yaw) * k };
      anim.current = k < 0.85 ? 1 : 0;
      weight.current = Math.max(0, (k - 0.55) / 0.45);
      if (t - s.t0 >= IN_S) {
        motion.play({ clip: "guardIdle", start: t, blend: 0.15 });
        S.nextAt = t + 0.1;
        useBagWork.setState({ phase: "work", t0: t });
      }
    } else if (s.phase === "out") {
      const k = smooth((t - s.t0) / OUT_S);
      pose = { x: lerp(stance.x, s.from.x, k), z: lerp(stance.z, s.from.z, k), yaw: stance.yaw + wrap(s.from.yaw - stance.yaw) * k };
      weight.current = Math.max(0, 1 - k * 2);
      anim.current = k > 0.3 && k < 0.95 ? 1 : 0;
      if (t - s.t0 >= OUT_S) useBagWork.setState({ prop: null, phase: null });
    } else {
      anim.current = 0;
      weight.current = 1;
      // a side step in progress: circle the bag over the footwork clip
      if (S.stepT >= 0) {
        const k = smooth((t - S.stepT) / BOXING_CLIPS.stepLeft.duration);
        S.orbit = lerp(S.from, S.to, k);
        if (k >= 1) S.stepT = -1;
        pose = bagStance(prop, S.orbit);
      }
      // auto combo: the next combination after a breath
      if (s.auto && !input.queue.length && !S.comboLeft.length && !S.pendingStep && S.stepT < 0 && t > S.nextAt + 0.45) {
        const c = AUTO_COMBOS[S.combo++ % AUTO_COMBOS.length]!;
        S.comboLeft = [...c.punches];
        S.pendingStep = c.step;
      }
      if (!input.queue.length && S.comboLeft.length) input.queue.push(S.comboLeft.shift()!);
      if (input.queue.length && t >= S.nextAt && S.stepT < 0) {
        const p = input.queue.shift()!;
        const speedBag = prop.kind === "speedBag";
        // the speed bag: quick light alternating strikes; otherwise the punch you asked for (hands alternate)
        const clip: BagClip = speedBag ? (S.side++ % 2 ? "cross" : "jab") : bagClip(p, (S.n[p] = (S.n[p] ?? -1) + 1));
        const speed = speedBag ? SPEED_BAG.speed : 1;
        motion.play({ clip, start: t, blend: 0.07, speed, intensity: speedBag ? SPEED_BAG.intensity : 1 });
        const info = BOXING_CLIPS[clip];
        const imp = (info.impact ?? 0.15) / speed;
        if (prop.kind !== "mirror") S.hits.push({ at: t + imp, clip });
        S.nextAt = t + imp + (speedBag ? 0.05 : 0.14);
        if (!S.comboLeft.length && !input.queue.length && S.pendingStep) {
          input.step = S.pendingStep;
          S.pendingStep = "";
        }
      } else if (input.step && S.stepT < 0 && t >= S.nextAt && prop.kind === "heavyBag") {
        const to = stepOrbit(S.orbit, input.step);
        // stepLeft moves the root to its left (+x facing the wall): that is a smaller orbit angle
        motion.play({ clip: to < S.orbit ? "stepLeft" : "stepRight", start: t, blend: 0.06 });
        S.from = S.orbit;
        S.to = to;
        S.stepT = t;
        S.nextAt = t + BOXING_CLIPS.stepLeft.duration;
        input.step = null;
      } else if (input.step && prop.kind !== "heavyBag") input.step = null;
    }
    // impacts land on the bag in the frame the glove arrives: swing + thud together
    for (let i = S.hits.length - 1; i >= 0; i--) {
      const h = S.hits[i]!;
      if (t < h.at) continue;
      S.hits.splice(i, 1);
      const hit = BAG_HIT[h.clip];
      if (prop.kind === "speedBag") {
        hitBag(prop.id, 0.3, S.side % 2 ? 1 : -1);
        bagSound("tick", 0.9);
      } else {
        hitBag(prop.id, hit.power, hit.side);
        bagSound("thud", 0.6 + 0.4 * hit.power);
      }
    }
    grp.position.set(pose.x, 0, pose.z);
    grp.rotation.y = pose.yaw;
  });
  return (
    <group ref={g}>
      <Avatar look={kit.look} animRef={anim} showTag={false} shadows={!lite} quality={lite ? "lite" : "standard"} lod rigLayer={layer} />
    </group>
  );
}

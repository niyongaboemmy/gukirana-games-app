"use client";
import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { BoxingSnapshot } from "@gukirana/contracts";
import { isOnScreen, useArea } from "@/world/stage";
import { useFightBridge } from "./bridge";
import { RING_BY_ID, type RingPlace } from "./plan";
import { useFightUi } from "./ui-store";
import { useFightUi as useGameUi } from "./game/ui-store";
import { useFightPrefs } from "./game/prefs";
import { clampInRing, layoutOf, ringSeed, shakeFor } from "./present";
import { cameraKick } from "./ring-clock";
import { replaySnap } from "./game/replay";
import { RING_SIZES } from "@/rooms/fight/ring-kit-core";

/**
 * Fight camera + watch cameras (P3-FGT-01 §4.3, redesigned in P3-FGT-05). Runs after the hall's follow camera (frame
 * priority 0.5) and OWNS the camera while a fight / watch camera is on: the follow camera has already placed the
 * camera this frame, so its pose is the blend source and the shot is blended over it by a weight that eases 0 → 1 on
 * entering and 1 → 0 on leaving (no tug of war between two damped cameras, no cut, no swing through the ropes).
 *
 * Shots (broadcast conventions): a 3/4 side view square to the pair, my fighter near-side so I read my opponent's
 * face; the corner during the rest; a low angle on the downed fighter during a count; the winner close-up at the end.
 * Shake only on big hits (power punches, knockdowns), never with reduced motion.
 */
const _eye = new THREE.Vector3();
const _look = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _fpos = new THREE.Vector3();
const _flook = new THREE.Vector3();
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** the shot for my fight (eye + look, world space) */
/**
 * Broadcast framing of the pair (P3-FGT-09): the camera's distance from the pair's middle so both boxers fill ~65 % of
 * the frame height (a 1.75 m boxer at a 55° vertical field of view: frame height ≈ 1.04 × distance), a little wider
 * when they are apart so both stay in frame; eye a touch below the chins (a slight low angle), looking at the chests.
 */
export function broadcastFrame(gap: number, aspect = 16 / 9): { dist: number; eyeY: number; lookY: number } {
  const byHeight = 1.75 / 0.65 / 1.04;
  // both boxers + a glove's reach either side across the frame width
  const byWidth = (gap + 1.3) / (1.04 * Math.max(1, aspect) * 0.8);
  return { dist: Math.max(byHeight, byWidth), eyeY: 1.22, lookY: 1.3 };
}

export function fightShot(ring: RingPlace, snap: BoxingSnapshot | null, me: 0 | 1, side: number, mode: "fight" | "behind", eye: THREE.Vector3, look: THREE.Vector3, aspect = 16 / 9): void {
  shot(ring, snap, me, side, mode, eye, look, aspect);
  // stay inside the ropes by coming CLOSER along the line of the shot (P3-FGT-13): the side view stays square to the
  // pair and both fighters get bigger, instead of sliding sideways into an oblique view behind one of them
  const lim = CAM_LIM(ring);
  const co = Math.cos(ring.rotY);
  const sn = Math.sin(ring.rotY);
  const loc = (x: number, z: number) => ({ u: (x - ring.x) * co - (z - ring.z) * sn, v: (x - ring.x) * sn + (z - ring.z) * co });
  const e = loc(eye.x, eye.z);
  const l = loc(look.x, look.z);
  let k = 1;
  for (const [a, b] of [
    [e.u, l.u],
    [e.v, l.v],
  ] as const) {
    if (Math.abs(a) > lim && Math.abs(a - b) > 1e-6) k = Math.min(k, (Math.sign(a) * lim - b) / (a - b));
  }
  k = Math.max(0.55, Math.min(1, k));
  eye.x = look.x + (eye.x - look.x) * k;
  eye.z = look.z + (eye.z - look.z) * k;
  const c = clampInRing(eye.x - ring.x, eye.z - ring.z, ring.rotY, lim);
  eye.x = ring.x + c.x;
  eye.z = ring.z + c.z;
}

/**
 * Ropes out of the shot (P3-FGT-14): when the eye is outside the ropes, the line of sight crosses the rope line on its
 * way in; if it does so within ROPE_CLEAR of a rope, a rope runs across the middle of the frame. The eye then rises or
 * drops (the least it takes) so the sight line goes through the middle of a gap between two ropes, or over the top
 * rope. Applied to the shot target, before the operator's damping: a smooth adjustment, never a jump.
 * Rope heights / post line from the ring's own kit (rooms/fight/ring-kit-core).
 */
export const ROPE_CLEAR = 0.11;
export function clearRopes(ring: Pick<RingPlace, "x" | "z" | "rotY" | "canvasY" | "feature">, eye: THREE.Vector3, look: THREE.Vector3): number {
  const D = RING_SIZES[ring.feature ? "pro" : "training"];
  const co = Math.cos(ring.rotY);
  const sn = Math.sin(ring.rotY);
  const loc = (x: number, z: number) => [(x - ring.x) * co - (z - ring.z) * sn, (x - ring.x) * sn + (z - ring.z) * co] as const;
  const [eu, ev] = loc(eye.x, eye.z);
  const [lu, lv] = loc(look.x, look.z);
  const P = D.post;
  // where the sight line enters the rope square (largest t of the planes it must cross); none if the eye is inside
  let t = -1;
  for (const [a, b] of [
    [eu, lu],
    [ev, lv],
  ] as const) {
    if (Math.abs(a) <= P) continue;
    if (Math.abs(b) >= P || Math.abs(a - b) < 1e-6) return 0;
    t = Math.max(t, (a - Math.sign(a) * P) / (a - b));
  }
  if (t < 0 || t >= 0.98) return 0;
  const yAt = (ey: number) => ey + t * (look.y - ey) - ring.canvasY;
  const ropes = D.ropes;
  const y = yAt(eye.y);
  if (ropes.every((h) => Math.abs(y - h) >= ROPE_CLEAR)) return 0;
  // the candidate crossings: the middle of each gap, over the top rope; the nearest one wins
  const targets = [...ropes.slice(1).map((h, i) => (h + ropes[i]!) / 2), ropes[ropes.length - 1]! + 0.32];
  let best = targets[0]!;
  for (const c of targets) if (Math.abs(c - y) < Math.abs(best - y)) best = c;
  // eye height that puts the crossing there: y_c = e(1 − t) + look·t
  const ey = (best + ring.canvasY - t * look.y) / (1 - t);
  const dy = Math.max(ring.canvasY + 0.45, Math.min(ring.canvasY + 3.2, ey)) - eye.y;
  eye.y += dy;
  return dy;
}

/** how far from the ring centre (each axis, ring frame) the fight camera may stand */
const CAM_LIM = (ring: RingPlace) => ring.half - 0.5;
/** how far a shot's eye would stand outside the camera limit (m; 0 = inside) */
export function shotOutside(ring: RingPlace, snap: BoxingSnapshot | null, me: 0 | 1, side: number, mode: "fight" | "behind", aspect: number): number {
  shot(ring, snap, me, side, mode, _probe, _probeL, aspect);
  const c = Math.cos(ring.rotY);
  const sn = Math.sin(ring.rotY);
  const x = _probe.x - ring.x;
  const z = _probe.z - ring.z;
  const lim = CAM_LIM(ring);
  return Math.max(0, Math.abs(x * c - z * sn) - lim, Math.abs(x * sn + z * c) - lim);
}
const _probe = new THREE.Vector3();
const _probeL = new THREE.Vector3();

function shot(ring: RingPlace, snap: BoxingSnapshot | null, me: 0 | 1, side: number, mode: "fight" | "behind", eye: THREE.Vector3, look: THREE.Vector3, aspect: number): void {
  // the pair as the fighters layer places it (P3-FGT-07 ringLayout: circling, drifting round the ring); the shots
  // frame the pair's middle, which moves, so the camera operator follows it (the corner shot stays on the ring)
  const lay = snap ? layoutOf(snap, ring.half, ringSeed(ring.id), ring.rotY) : { cx: 0, cz: 0, th: 0, half: 0.75 };
  const ax = Math.cos(lay.th);
  const az = Math.sin(lay.th);
  const px = -az * side;
  const pz = ax * side;
  const cy = ring.canvasY;
  const half = lay.half;
  const ms = me === 0 ? -1 : 1; // my fighter's side along the pair axis
  const phase = snap?.phase ?? "intro";
  const r = phase === "rest" ? ring : { ...ring, x: ring.x + lay.cx, z: ring.z + lay.cz };
  if (phase === "rest") {
    // my corner on the ring's own diagonal (a turned ring turns its corners: P3-FGT-13 fix), from across the ring
    const c = r.half - 1.0;
    const co = Math.cos(r.rotY);
    const sn = Math.sin(r.rotY);
    const cx = r.x + ms * c * (co + sn);
    const cz = r.z + ms * c * (co - sn);
    // the eye on the ring's centre side of the corner, a little off the diagonal (the corner team in view)
    const ex = r.x + (cx - r.x) * -0.25 + (cz - r.z) * 0.22;
    const ez = r.z + (cz - r.z) * -0.25 - (cx - r.x) * 0.22;
    eye.set(ex, cy + 1.75, ez);
    look.set(cx, cy + 0.95, cz);
    return;
  }
  if (phase === "knockdown" && snap) {
    const down = snap.fighters.findIndex((f) => f.act === "down");
    const sd = down === 0 ? -1 : 1;
    const dx = r.x + sd * half * ax;
    const dz = r.z + sd * half * az;
    const d = r.half + 0.9;
    eye.set(r.x + px * d + sd * ax * 0.4, cy + 1.95, r.z + pz * d + sd * az * 0.4);
    look.set(dx, cy + 0.55, dz);
    return;
  }
  if (phase === "over" && snap) {
    const w = snap.fighters.findIndex((f) => f.act === "celebrate");
    const who = w >= 0 ? w : me;
    const s = who === 0 ? -1 : 1;
    const wx = r.x + s * half * ax;
    const wz = r.z + s * half * az;
    eye.set(wx - s * ax * 1.6 + px * 1.5, cy + 1.6, wz - s * az * 1.6 + pz * 1.5);
    look.set(wx, cy + 1.45, wz);
    return;
  }
  if (mode === "behind") {
    const mx = r.x + ms * half * ax;
    const mz = r.z + ms * half * az;
    // over my shoulder, close (P3-FGT-09): my back and gloves in the near third, the opponent big beyond them
    eye.set(mx + ms * ax * 1.45 + px * 0.5, cy + 1.72, mz + ms * az * 1.45 + pz * 0.5);
    look.set(r.x - ms * half * ax, cy + 1.32, r.z - ms * half * az);
    return;
  }
  // side-on broadcast (P3-FGT-09): close, square to the pair's axis, both boxers big in frame and tracked at their middle,
  // a slight low angle; nudged a little towards my corner so my opponent's face turns to the camera. The intro /
  // countdown start wider and ease in.
  const wide = phase === "intro" || phase === "countdown" ? 1.2 : 0;
  const f = broadcastFrame(half * 2, aspect);
  const d = f.dist + wide;
  eye.set(r.x + px * d + ms * ax * 0.3, cy + f.eyeY + wide * 0.35, r.z + pz * d + ms * az * 0.3);
  look.set(r.x - ms * ax * 0.05, cy + f.lookY, r.z - ms * az * 0.05);
}

/**
 * Which shot a camera choice gives right now: side (default) / behind as picked; auto = the side broadcast with an
 * over-the-shoulder view for ~5 s of every 20 s of round time (deterministic from the tick: the same on replays).
 */
/** how far (share of the eye → look distance) the impact camera pushes in, `t` s after a big hit (0 outside its window) */
export const IMPACT_S = 0.75;
export function impactPush(t: number): number {
  if (t < 0 || t > IMPACT_S) return 0;
  const u = t / IMPACT_S;
  return 0.22 * Math.sin(Math.PI * Math.min(1, u * 1.6)) * (u < 0.625 ? 1 : 1 - (u - 0.625) / 0.375);
}

export function autoShot(mode: string | null, snap: { tick: number; phase: string } | null): "fight" | "behind" {
  if (mode === "behind") return "behind";
  if (mode !== "auto" || !snap || snap.phase !== "round") return "fight";
  return (snap.tick / 30) % 20 > 15 ? "behind" : "fight";
}

export function FightCamera() {
  const area = useArea();
  const camera = useThree((s) => s.camera);
  const w = useRef(0);
  const eye = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());
  const seeded = useRef(false);
  const side = useRef(1);
  const ringRef = useRef<RingPlace | null>(null);
  const trauma = useRef(0);
  const kick = useRef(0);
  const seen = useRef(0);
  const clock = useRef(0);
  const lastCut = useRef(-10);
  /** P3-FGT-13: the impact camera — a short push-in on a big hit (0 → 1 → 0 over IMPACT_S) */
  const impact = useRef(-10);
  useFrame((_, raw) => {
    if (!isOnScreen(area)) {
      w.current = 0;
      seeded.current = false;
      return;
    }
    const dt = Math.min(raw, 0.05);
    clock.current += dt;
    const b = useFightBridge.getState();
    const ui = useFightUi.getState();
    const mine = b.mine;
    const ringId = mine ? mine.ring : ui.watchCam && b.watched ? b.watched.ring : null;
    const on = !!ringId;
    if (ringId && ringRef.current?.id !== ringId) {
      ringRef.current = RING_BY_ID[ringId] ?? null;
      seeded.current = false;
    }
    // blend weight: ~1.1 s in, ~0.8 s out
    w.current = Math.max(0, Math.min(1, w.current + (on ? dt / 1.1 : -dt / 0.8)));
    const r = ringRef.current;
    if (w.current <= 0 || !r) {
      seeded.current = false;
      return;
    }
    // the follow camera's pose this frame (blend source)
    camera.getWorldDirection(_fwd);
    _fpos.copy(camera.position);
    _flook.copy(camera.position).addScaledVector(_fwd, 5);
    const snap = mine ? (replaySnap() ?? mine.snap) : (b.watched?.snap ?? null);
    const th = snap ? layoutOf(snap, r.half, ringSeed(r.id), r.rotY).th : 0;
    const ax = Math.cos(th);
    const az = Math.sin(th);
    if (!seeded.current) {
      // the side of the ring the camera already is on (no swing through the ropes)
      side.current = (camera.position.x - r.x) * -az + (camera.position.z - r.z) * ax >= 0 ? 1 : -1;
    }
    const me: 0 | 1 = mine?.corner === "blue" ? 1 : 0;
    const mode = mine ? ui.fightCam : ui.watchCam;
    const aspect = (camera as THREE.PerspectiveCamera).aspect ?? 16 / 9;
    const shotMode = autoShot(mode, snap);
    if (mine && shotMode === "fight" && clock.current - lastCut.current > 2.5) {
      // the pair works the ropes on our side: cut to the open side (a broadcast cut, not a swing through the boxers)
      const out = shotOutside(r, snap, me, side.current, shotMode, aspect);
      if (out > 0.35 && shotOutside(r, snap, me, -side.current, shotMode, aspect) < out * 0.5) {
        side.current = -side.current;
        seeded.current = false;
        lastCut.current = clock.current;
      }
    }
    if (mine) fightShot(r, snap, me, side.current, shotMode, _eye, _look, aspect);
    else if (mode === "overhead") {
      _eye.set(r.x + -az * side.current * 2.2, r.canvasY + 6.8, r.z + ax * side.current * 2.2);
      _look.set(r.x, r.canvasY + 0.6, r.z);
    } else {
      const d = r.half + 1.8;
      _eye.set(r.x + -az * side.current * d, r.canvasY + 1.25, r.z + ax * side.current * d);
      _look.set(r.x, r.canvasY + 1.2, r.z);
    }
    // ropes out of the middle of the frame (every shot whose eye is outside the ropes)
    clearRopes(r, _eye, _look);
    if (!seeded.current) {
      seeded.current = true;
      eye.current.copy(_eye);
      look.current.copy(_look);
    }
    // shots move like a camera operator: damped, never cut
    const k = 1 - Math.exp(-dt * 2.6);
    eye.current.lerp(_eye, k);
    look.current.lerp(_look, 1 - Math.exp(-dt * 4));

    // shake on big hits only (my fight / watched ring), never with reduced motion
    const feed = useGameUi.getState().feed;
    for (const f of feed) {
      if (f.id <= seen.current) continue;
      seen.current = f.id;
      trauma.current = Math.min(1, trauma.current + shakeFor(f.e));
      if (shakeFor(f.e) >= 0.5 && useFightPrefs.getState().impactCam) impact.current = clock.current;
    }
    const reduced = useFightPrefs.getState().reducedMotion || (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    // the impact camera: a quick push towards the action and back (both fighters stay in frame), never with reduced motion
    const ip = reduced ? 0 : impactPush(clock.current - impact.current);
    trauma.current = Math.max(0, trauma.current - dt * 1.8);
    const a = reduced ? 0 : trauma.current * trauma.current * 0.06;
    const t = clock.current;
    const s = smooth(w.current);
    camera.position.lerpVectors(_fpos, eye.current, s);
    if (ip > 0) camera.position.lerp(look.current, ip * s);
    if (a > 0) camera.position.add(_eye.set(Math.sin(t * 47.3) * a, Math.sin(t * 59.1 + 1.3) * a * 0.7, Math.sin(t * 41.7 + 2.1) * a));
    _look.lerpVectors(_flook, look.current, s);
    // the camera punch on a connection (P3-FGT-07): a quick push towards the action, eased back; never with reduced motion
    kick.current = Math.max(kick.current * Math.exp(-dt * 11), reduced ? 0 : cameraKick.v);
    cameraKick.v = 0;
    if (kick.current > 0.001) camera.position.add(_eye.subVectors(_look, camera.position).normalize().multiplyScalar(kick.current * s));
    camera.lookAt(_look);
  }, 0.5);
  return null;
}

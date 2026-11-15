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
import { shakeFor } from "./present";
import { replaySnap } from "./game/replay";

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
export function fightShot(r: RingPlace, snap: BoxingSnapshot | null, me: 0 | 1, side: number, mode: "fight" | "behind", eye: THREE.Vector3, look: THREE.Vector3): void {
  const th = snap ? ((snap.orbit / 10) * Math.PI) / 180 : 0;
  const ax = Math.cos(th);
  const az = Math.sin(th);
  const px = -az * side;
  const pz = ax * side;
  const cy = r.canvasY;
  const half = snap ? Math.min(snap.dist / 200, r.half - 0.8) : 0.75;
  const ms = me === 0 ? -1 : 1; // my fighter's side along the pair axis
  const phase = snap?.phase ?? "intro";
  if (phase === "rest") {
    // my corner: from the ring centre, a little high, looking at the stool
    const c = r.half - 1.0;
    const cx = r.x + ms * c;
    const cz = r.z + ms * c;
    eye.set(r.x + ms * 0.2 + px * 0.9, cy + 1.75, r.z + ms * 0.2 + pz * 0.9);
    look.set(cx, cy + 0.85, cz);
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
    eye.set(mx + ms * ax * 2.0 + px * 0.55, cy + 1.95, mz + ms * az * 2.0 + pz * 0.55);
    look.set(r.x - ms * half * ax, cy + 1.35, r.z - ms * half * az);
    return;
  }
  // the broadcast 3/4: outside the ropes, square to the pair, shifted towards my corner (my back three-quarter on, the
  // opponent's face to the camera); a wider frame when they are far apart, tighter in close
  const wide = phase === "intro" || phase === "countdown" ? 0.9 : 0;
  const d = r.half + 1.05 + (snap ? (snap.dist - 150) / 260 : 0.3) + wide;
  eye.set(r.x + px * d + ms * ax * 1.1, cy + 2.05 + wide * 0.4, r.z + pz * d + ms * az * 1.1);
  look.set(r.x - ms * ax * 0.15, cy + 1.2, r.z - ms * az * 0.15);
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
  const seen = useRef(0);
  const clock = useRef(0);
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
    const th = snap ? ((snap.orbit / 10) * Math.PI) / 180 : 0;
    const ax = Math.cos(th);
    const az = Math.sin(th);
    if (!seeded.current) {
      // the side of the ring the camera already is on (no swing through the ropes)
      side.current = (camera.position.x - r.x) * -az + (camera.position.z - r.z) * ax >= 0 ? 1 : -1;
    }
    const me: 0 | 1 = mine?.corner === "blue" ? 1 : 0;
    const mode = mine ? ui.fightCam : ui.watchCam;
    if (mine) fightShot(r, snap, me, side.current, mode === "behind" ? "behind" : "fight", _eye, _look);
    else if (mode === "overhead") {
      _eye.set(r.x + -az * side.current * 2.2, r.canvasY + 6.8, r.z + ax * side.current * 2.2);
      _look.set(r.x, r.canvasY + 0.6, r.z);
    } else {
      const d = r.half + 1.8;
      _eye.set(r.x + -az * side.current * d, r.canvasY + 1.25, r.z + ax * side.current * d);
      _look.set(r.x, r.canvasY + 1.2, r.z);
    }
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
    }
    const reduced = useFightPrefs.getState().reducedMotion || (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    trauma.current = Math.max(0, trauma.current - dt * 1.8);
    const a = reduced ? 0 : trauma.current * trauma.current * 0.06;
    const t = clock.current;
    const s = smooth(w.current);
    camera.position.lerpVectors(_fpos, eye.current, s);
    if (a > 0) camera.position.add(_eye.set(Math.sin(t * 47.3) * a, Math.sin(t * 59.1 + 1.3) * a * 0.7, Math.sin(t * 41.7 + 2.1) * a));
    _look.lerpVectors(_flook, look.current, s);
    camera.lookAt(_look);
  }, 0.5);
  return null;
}

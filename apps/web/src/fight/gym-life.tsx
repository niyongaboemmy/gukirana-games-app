"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { create } from "zustand";
import { selfPose } from "@/lib/world-store";
import { uiAudio } from "@/lib/audio";
import { useGamePrefs } from "@/games/feedback";
import { Avatar } from "@/world/Avatar";
import { seededLook, type AvatarLook } from "@/world/outfits";
import { isOnScreen, useArea } from "@/world/stage";
import { BoxingMotion } from "@/world/human/boxing/motion";
import { boxingLayer } from "@/world/human/boxing/layer";
import { BOXING_CLIPS, type BoxingClipName } from "@/world/human/boxing/clips";
import { alongPath, GYM_PROPS, STAFF, type GymProp, type StaffSpot } from "./gym-plan";
import { gymTimer, hitBag } from "./training-zone";
import { F } from "./strings";
import { softBodies } from "@/rooms/soft-bodies";
import { isBagStation } from "./bag-plan";
import { startBagWork } from "./bag-work";

/**
 * Gym life (P3-FGT-04): the hall's staff and trainers, and the cosmetic training props players can use.
 *
 * Honesty: staff are local scenery, deterministic loops of the wall clock (no randomness). They wear the venue's
 * uniform (red jersey: staff / coaches; white tee: referee), show their ROLE (never a name) up close, are never in the
 * world store's players (not in counts, lists or the People panel), can't be joined, and never stand in a ring.
 * Only the nearest few are drawn (distance culled, sticky), the rest cost nothing. `hidden` / `dim` let the fight focus
 * mode clear them.
 *
 * Players: at a heavy bag / the speed bag / the water station a prompt (fight/GymPrompt) offers a short cosmetic action
 * — the bag swings with a thud — no Stars, no score. Sounds are quiet, by distance, and follow the game sound setting.
 */

/* ---------------- sound (quiet, by distance, the sound setting) ---------------- */

const soundOn = () => useGamePrefs.getState().sound;
function level(x: number, z: number, range: number) {
  const d = Math.hypot(x - selfPose.x, z - selfPose.z);
  return d > range ? 0 : (1 - d / range) ** 2;
}
/** a soft low thump (a bag hit) */
function thud(gain: number) {
  const ctx = soundOn() ? uiAudio() : null;
  if (!ctx || gain < 0.01) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(55, t + 0.16);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09 * gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.2);
}
/** a tiny tick (rope on the floor, speed bag rebound) */
function tick(gain: number, freq = 2400) {
  const ctx = soundOn() ? uiAudio() : null;
  if (!ctx || gain < 0.01) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "triangle";
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.025 * gain, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.05);
}
/** the distant gym bell (round / rest change of the gym timer) */
function bell(gain: number) {
  const ctx = soundOn() ? uiAudio() : null;
  if (!ctx || gain < 0.01) return;
  const t = ctx.currentTime;
  for (const [f, a] of [
    [1320, 0.03],
    [1980, 0.012],
  ] as const) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(a * gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 1.25);
  }
}

/** your own bag work's sounds (fight/bag-work): a thud on the heavy bag, the speed bag's rebound tick */
export function bagSound(kind: "thud" | "tick", gain: number) {
  if (kind === "thud") thud(gain);
  else tick(gain, 1600);
}

/* ---------------- player interactions (cosmetic) ---------------- */

interface GymUi {
  /** the prop you stand at (prompt target) */
  prop: GymProp | null;
  /** an action is playing (the prompt waits) */
  busyUntil: number;
}
export const useGymUi = create<GymUi>()(() => ({ prop: null, busyUntil: 0 }));

/**
 * The fight focus mode's handle on the gym (P3-FGT-05 drives it): `hidden` removes the staff and the training wall,
 * `dim` (0…1) fades the training wall. The Boxing hall scene passes these to <TrainingZone> / <GymLife>.
 */
export const useGymScene = create<{ hidden: boolean; dim: number }>()(() => ({ hidden: false, dim: 1 }));
/** use a prop (from the prompt): the bags and the mirror start your bag work (fight/bag-work); the water a sip */
export function actOnProp(p: GymProp) {
  const now = performance.now();
  if (now < useGymUi.getState().busyUntil) return;
  useGymUi.setState({ busyUntil: now + 1300 });
  if (isBagStation(p.kind)) startBagWork(p);
  else if (p.kind === "water") tick(0.6, 900);
}
const PROP_IN = 0.75;
const PROP_OUT = 1.2;

/* ---------------- staff ---------------- */

/** the venue uniform over a seeded adult look (deterministic per staff id) */
function staffLook(s: StaffSpot): AvatarLook {
  const base = seededLook(`gym-staff-${s.id}`, "#C8322A");
  const age = s.role === "coach" || s.role === "timekeeper" || s.role === "reception" ? "middle" : base.age;
  const sport = s.role === "trainee" || s.role === "skipper" || s.role === "shadow";
  const outfit =
    s.role === "referee"
      ? {
          ...base.outfit,
          top: "tee-white",
          bottom: "joggers",
          shoes: "runners",
          headwear: "no-hat",
          accessory: "none",
        }
      : sport
        ? {
            ...base.outfit,
            top: "tee",
            bottom: "shorts",
            shoes: "runners",
            headwear: "no-hat",
            accessory: "none",
          }
        : {
            ...base.outfit,
            top: "jersey",
            bottom: "joggers",
            shoes: "runners",
            headwear: "no-hat",
            accessory: s.role === "timekeeper" ? "watch" : "none",
          };
  return {
    ...base,
    age: age as AvatarLook["age"],
    outfit,
    accent: "#C8322A",
    // every member of staff wears the venue red (P3-FGT-08: staff read as staff, never as other players)
    topColor: "#B3242B",
  };
}

/** each role's motion loop: [clip, seconds]; the motion library plays it, the loop restarts from the wall clock */
const LOOPS: Partial<Record<StaffSpot["role"], [BoxingClipName, number][]>> = {
  shadow: [
    ["guardIdle", 1.1],
    ["jab", 0.5],
    ["cross", 0.6],
    ["slipLeft", 0.6],
    ["leadHook", 0.7],
    ["guardIdle", 0.8],
    ["stepForward", 0.5],
    ["jab", 0.5],
    ["jab", 0.5],
    ["rearUppercut", 0.8],
    ["stepBack", 0.5],
  ],
  trainee: [
    ["guardIdle", 0.9],
    ["jab", 0.55],
    ["jab", 0.55],
    ["cross", 0.7],
    ["guardIdle", 1.2],
    ["leadHook", 0.75],
    ["rearBody", 0.75],
    ["guardIdle", 1.4],
  ],
  coach: [
    ["blockHigh", 1.0],
    ["guard", 0.8],
    ["blockHigh", 1.4],
    ["guard", 1.0],
  ],
  referee: [["refIdle", 2.4]],
  timekeeper: [["refIdle", 3.0]],
};
const loopLen = (l: [BoxingClipName, number][]) => l.reduce((s, [, d]) => s + d, 0);
function loopAt(l: [BoxingClipName, number][], t: number) {
  let k = ((t % loopLen(l)) + loopLen(l)) % loopLen(l);
  for (let i = 0; i < l.length; i++) {
    const [clip, d] = l[i]!;
    if (k < d) return { i, clip, start: t - k };
    k -= d;
  }
  return { i: 0, clip: l[0]![0], start: t };
}
/** a deterministic per-staff phase offset (s), so two trainees never move in step */
const phase = (id: string) => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 100;
};
const clock = () => performance.now() / 1000;

function StaffNpc({ spot, lite }: { spot: StaffSpot; lite: boolean }) {
  const look = useMemo(() => staffLook(spot), [spot]);
  const g = useRef<THREE.Group>(null);
  const anim = useRef(0);
  const loop = LOOPS[spot.role];
  const motion = useMemo(() => (loop ? new BoxingMotion() : null), [loop]);
  const weight = useMemo(() => ({ current: 1 }), []);
  const layer = useMemo(
    () => (motion ? boxingLayer({ motion, kit: null, weight, face: false }) : undefined),
    [motion, weight],
  );
  const last = useRef(-1);
  const rope = useRef<THREE.Group>(null);
  const label = useRef<THREE.Group>(null);
  const off = useMemo(() => phase(spot.id), [spot.id]);
  useEffect(
    () => () => {
      softBodies.delete(`staff-${spot.id}`);
      lanyards.delete(spot.id);
      mitts.delete(`${spot.id}0`);
      mitts.delete(`${spot.id}1`);
    },
    [spot.id],
  );
  const neck = useRef<THREE.Object3D | null>(null);
  const hands = useRef<THREE.Object3D[]>([]);
  useFrame(() => {
    const t = clock() + off;
    const grp = g.current;
    if (!grp) return;
    let x = spot.x;
    let z = spot.z;
    let yaw = spot.yaw;
    let y = 0;
    anim.current = 0;
    if (spot.path) {
      // walking rounds; the referee stops for a few seconds at each corner to watch the rings
      const len = spot.path.reduce(
        (s, a, i) =>
          s +
          Math.hypot(
            spot.path![(i + 1) % spot.path!.length]!.x - a.x,
            spot.path![(i + 1) % spot.path!.length]!.z - a.z,
          ),
        0,
      );
      const pause = spot.role === "referee" ? 4 : 2.5;
      const cycle = len / spot.speed! + pause * spot.path.length;
      let k = ((t % cycle) + cycle) % cycle;
      let d = 0;
      let walking = true;
      for (let i = 0; i < spot.path.length; i++) {
        const a = spot.path[i]!;
        const b = spot.path[(i + 1) % spot.path.length]!;
        const legT = Math.hypot(b.x - a.x, b.z - a.z) / spot.speed!;
        if (k < legT) {
          d += k * spot.speed!;
          break;
        }
        d += legT * spot.speed!;
        k -= legT;
        if (k < pause) {
          walking = false;
          break;
        }
        k -= pause;
      }
      const p = alongPath(spot.path, d);
      x = p.x;
      z = p.z;
      yaw = walking ? p.yaw : p.yaw + Math.PI / 2;
      anim.current = walking ? 1 : 0;
      weight.current = walking ? 0 : 1;
    }
    if (spot.role === "skipper") {
      // skipping: a light double-bounce and the rope turning about 2 turns a second
      const ph = t * Math.PI * 2 * 2.1;
      y = Math.abs(Math.sin(ph)) * 0.07;
      if (rope.current) rope.current.rotation.x = ph;
      if (Math.cos(ph) > 0.995 && level(x, z, 10) > 0) tick(level(x, z, 10), 2600);
    }
    grp.position.set(x, y, z);
    grp.rotation.y = yaw;
    softBodies.set(`staff-${spot.id}`, { x, z, r: 0.3 });
    // the staff lanyard hangs from the neck bone (one instanced mesh for all staff: StaffLanyards)
    if (!neck.current) neck.current = grp.getObjectByName("Bip01_Neck") ?? null;
    if (neck.current) {
      neck.current.getWorldPosition(_neck);
      const m = lanyards.get(spot.id) ?? new THREE.Matrix4();
      lanyards.set(spot.id, m.compose(_neck, _lq.setFromAxisAngle(_up, yaw), _one));
    }
    // the pads coach wears focus mitts on both hands (facing the trainee)
    if (spot.role === "coach") {
      if (hands.current.length < 2) hands.current = ["Bip01_L_Hand", "Bip01_R_Hand"].map((n) => grp.getObjectByName(n)).filter((b): b is THREE.Object3D => !!b);
      hands.current.forEach((h, k) => {
        h.getWorldPosition(_neck);
        _neck.x += Math.sin(yaw) * 0.05;
        _neck.z += Math.cos(yaw) * 0.05;
        const m = mitts.get(`${spot.id}${k}`) ?? new THREE.Matrix4();
        mitts.set(`${spot.id}${k}`, m.compose(_neck, _lq.setFromAxisAngle(_up, yaw), _one));
      });
    }
    if (label.current) label.current.visible = Math.hypot(x - selfPose.x, z - selfPose.z) < 5;
    if (motion && loop && weight.current > 0.5) {
      const cur = loopAt(loop, t);
      if (cur.i !== last.current) {
        last.current = cur.i;
        motion.play({
          clip: cur.clip,
          start: clock() - (t - cur.start),
          hold: cur.clip === "blockHigh" ? 0.6 : undefined,
        });
        // the trainee's punches land on the bag in front of them
        if (spot.id === "trainee" && BOXING_CLIPS[cur.clip].kind === "punch") {
          const imp = BOXING_CLIPS[cur.clip].impact ?? 0.2;
          setTimeout(() => {
            hitBag("bag-trainee", cur.clip === "jab" ? 0.45 : 0.85, cur.clip === "leadHook" ? -0.8 : 0.3);
            thud(level(x, z, 14) * 0.6);
          }, imp * 1000);
        }
      }
    }
  });
  return (
    <group ref={g}>
      <Avatar
        look={look}
        animRef={anim}
        showTag={false}
        shadows={!lite}
        quality={lite ? "lite" : "standard"}
        lod
        rigLayer={layer}
        seedId={`gym-${spot.id}`}
      />
      {spot.role === "skipper" && (
        <group ref={rope} position={[0, 0.98, 0]}>
          <mesh scale={[0.62, 1, 1]}>
            <torusGeometry args={[0.95, 0.008, 4, 40]} />
            <meshStandardMaterial color="#1c1c1e" roughness={0.6} />
          </mesh>
        </group>
      )}
      {/* the role (never a name), up close only */}
      <group ref={label} position={[0, 2.12, 0]} visible={false}>
        <Text
          font="/fonts/Baloo2.ttf"
          fontSize={0.12}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.01}
          outlineColor="#000000"
          letterSpacing={0.08}
        >
          {(F.role[spot.role] ?? "").toUpperCase()}
          <meshBasicMaterial color="#f2e9dc" toneMapped={false} />
        </Text>
      </group>
      {spot.role === "cleaner" && <MopCart />}
    </group>
  );
}

/* ---------------- staff lanyards ---------------- */

const lanyards = new Map<string, THREE.Matrix4>();
const mitts = new Map<string, THREE.Matrix4>();
/** a focus mitt: a round padded face (red, black rim) on a short black cuff, facing +z */
function mittGeometry(): THREE.BufferGeometry {
  const pad = new THREE.SphereGeometry(0.11, 14, 10);
  pad.scale(1, 1.15, 0.45);
  pad.translate(0, 0.02, 0.03);
  const cuff = new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10).rotateX(Math.PI / 2).translate(0, -0.03, -0.04);
  const tint = (g: THREE.BufferGeometry, col: string) => {
    const c = new THREE.Color(col);
    const n = g.getAttribute("position").count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.Float32BufferAttribute(a, 3));
    return g;
  };
  const g = mergeGeometries([tint(pad, "#a8262a"), tint(cuff, "#1b1c1f")])!;
  pad.dispose();
  cuff.dispose();
  return g;
}
const _neck = new THREE.Vector3();
const _lq = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _one = new THREE.Vector3(1, 1, 1);
/** strap V from the neck down to an ID card on the chest (origin at the neck, facing +z), vertex coloured */
function lanyardGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, col: string) => {
    const c = new THREE.Color(col);
    const n = g.getAttribute("position").count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.Float32BufferAttribute(a, 3));
    parts.push(g);
  };
  for (const sx of [-1, 1]) {
    const a = new THREE.Vector3(sx * 0.06, -0.03, 0.06);
    const b = new THREE.Vector3(sx * 0.016, -0.21, 0.125);
    const g = new THREE.BoxGeometry(0.012, a.distanceTo(b), 0.003);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    add(g, "#C8322A");
  }
  add(new THREE.BoxGeometry(0.068, 0.095, 0.004).translate(0, -0.262, 0.128), "#f2efe8");
  add(new THREE.BoxGeometry(0.068, 0.022, 0.005).translate(0, -0.226, 0.129), "#B3242B");
  const g = mergeGeometries(parts)!;
  parts.forEach((x) => x.dispose());
  return g;
}
/** every drawn staff member's lanyard (one draw call) */
function StaffLanyards() {
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(lanyardGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), 8);
    m.count = 0;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return m;
  }, []);
  useEffect(() => () => (mesh.geometry.dispose(), (mesh.material as THREE.Material).dispose(), mesh.dispose()), [mesh]);
  const mitt = useMemo(() => {
    const m = new THREE.InstancedMesh(mittGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65 }), 4);
    m.count = 0;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return m;
  }, []);
  useEffect(() => () => (mitt.geometry.dispose(), (mitt.material as THREE.Material).dispose(), mitt.dispose()), [mitt]);
  useFrame(() => {
    for (const [im, src, cap] of [
      [mesh, lanyards, 8],
      [mitt, mitts, 4],
    ] as const) {
      let n = 0;
      for (const m of src.values()) if (n < cap) im.setMatrixAt(n++, m);
      im.count = n;
      im.visible = n > 0;
      im.instanceMatrix.needsUpdate = true;
      // culled with the view like any mesh (a tiny strap must not cost a draw call while it is behind the camera)
      if (n) im.computeBoundingSphere();
    }
  });
  return (
    <>
      <primitive object={mesh} />
      <primitive object={mitt} />
    </>
  );
}

/** the cleaner's mop bucket on wheels, pushed in front */
function MopCart() {
  return (
    <group position={[0, 0, 0.75]}>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[0.38, 0.3, 0.32]} />
        <meshStandardMaterial color="#d6a21e" roughness={0.6} />
      </mesh>
      <mesh position={[0.05, 0.7, -0.18]} rotation={[0.35, 0, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 1.1, 6]} />
        <meshStandardMaterial color="#8a8d93" roughness={0.5} />
      </mesh>
    </group>
  );
}

/* ---------------- the layer ---------------- */

/** draw at most this many staff, and only within DRAW_IN m (kept until DRAW_OUT) */
const MAX_DRAWN = { standard: 3, lite: 2 } as const;
/** fewer when the view is long (many rings and fighters in frame already): the hall budget is 150 draw calls */
const MAX_DRAWN_FAR = 2;
const BUDGET_HIGH = 138;
const BUDGET_LOW = 118;
const DRAW_IN = 18;
const DRAW_OUT = 21;

export function GymLife({
  room,
  lite,
  hidden = false,
}: {
  room: "boxing" | "fight";
  lite: boolean;
  hidden?: boolean;
}) {
  const area = useArea();
  const staff = useMemo(() => STAFF.filter((s) => s.room === room), [room]);
  const [drawn, setDrawn] = useState<string[]>([]);
  const acc = useRef(1);
  const bellPhase = useRef<string | null>(null);
  const gl = useThree((s) => s.gl);
  const cap = useRef<number>(MAX_DRAWN[lite ? "lite" : "standard"]);
  useEffect(() => () => useGymUi.setState({ prop: null }), []);
  useFrame(({ camera }, dt) => {
    if (!isOnScreen(area)) return;
    // interaction target with hysteresis (only props not used by the staff)
    if (room === "boxing") {
      const cur = useGymUi.getState().prop;
      let best: GymProp | null = null;
      let bd = PROP_IN;
      for (const p of GYM_PROPS) {
        if (p.npc) continue;
        const d = Math.hypot(selfPose.x - p.stand.x, selfPose.z - p.stand.z);
        if (p === cur && d < PROP_OUT) {
          best = p;
          break;
        }
        if (d < bd) [best, bd] = [p, d];
      }
      if (best !== cur) useGymUi.setState({ prop: best });
      // the distant bell when the gym timer turns
      const ph = gymTimer(Date.now() / 1000).phase;
      if (bellPhase.current && ph !== bellPhase.current) bell(0.6);
      bellPhase.current = ph;
    }
    acc.current += dt;
    if (acc.current < 0.5) return;
    acc.current = 0;
    // which staff to draw: nearest to the camera (moving ones by where they are now), sticky at the edge
    const t = clock();
    const where = (s: StaffSpot) => (s.path ? alongPath(s.path, (t + phase(s.id)) * (s.speed ?? 1)) : s);
    const dist = (s: StaffSpot) => {
      const p = where(s);
      return Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
    };
    const keep = staff.filter((s) => drawn.includes(s.id) && dist(s) < DRAW_OUT);
    const add = staff
      .filter((s) => !drawn.includes(s.id) && dist(s) < DRAW_IN)
      .sort((a, b) => dist(a) - dist(b));
    // budget-aware: the previous frame's draw calls (the compositor resets the counter at its start, after this
    // runs) — over BUDGET_HIGH one staff member fewer, under BUDGET_LOW back up to the cap
    const calls = gl.info.render.calls;
    if (calls > BUDGET_HIGH) cap.current = Math.max(MAX_DRAWN_FAR - 2, Math.min(cap.current, drawn.length) - 1);
    else if (calls < BUDGET_LOW) cap.current = Math.min(MAX_DRAWN[lite ? "lite" : "standard"], cap.current + 1);
    const next = [...keep, ...add].slice(0, Math.max(0, cap.current)).map((s) => s.id);
    if (next.join() !== drawn.join()) setDrawn(next);
  });
  return (
    <group visible={!hidden} userData={{ noMerge: true }}>
      <StaffLanyards />
      {staff
        .filter((s) => drawn.includes(s.id))
        .map((s) => (
          <StaffNpc key={s.id} spot={s} lite={lite} />
        ))}
    </group>
  );
}

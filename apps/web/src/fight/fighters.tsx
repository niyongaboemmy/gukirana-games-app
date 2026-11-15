"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { clipFor, CORNER_COLORS, HIT_REACTION, TICK_HZ, type BoxingSnapshot, type Corner, type FightEvent, type RingFighter, type RingId, type RingState } from "@gukirana/contracts";
import { selfPose, useWorld } from "@/lib/world-store";
import { decodeLook, seededLook, type AvatarLook } from "@/world/outfits";
import { lookOf, useProfile } from "@/lib/profile-store";
import { hiddenPeople, SELF_ID } from "@/rooms/hall-hooks";
import { isOnScreen, useArea } from "@/world/stage";
import { damp } from "@/rooms/stability";
import { FighterAvatar, type ClimbBlend, type FighterPose } from "./assets-shim";
import { CLIMB_S, climbPose } from "./climb";
import { IMPOSTOR_POSES, impostorGeometry, impostorMaterial } from "./impostor-geometry";
import { drainMyEvents, useFightBridge } from "./bridge";
import { RING_BY_ID, RINGS, type RingPlace } from "./plan";

/**
 * Fighters in the rings (P3-FGT-01 §6, §4.5):
 *  - full avatars (in the corner's kit, posed by the motion library) for MY ring, the WATCHED ring and the two nearest
 *    other live rings within 14 m: clip = clipFor(view, phase) at actT / TICK_HZ (my own press: `predicted` first),
 *    HIT_REACTION blended on the target of each `hit` event, the pair placed from `dist` / `orbit`;
 *  - every other live ring: low-poly boxer impostors in kit (three instanced pose meshes, a sparring loop from the 1 Hz
 *    registry), so 50 busy rings stay within the people budget;
 *  - these people's ordinary avatars are hidden meanwhile (rooms/hall-hooks hiddenPeople): their pose is the fight's.
 */
/** full avatars for live rings nearer than FULL_IN m; kept until FULL_OUT (hysteresis: no swap churn at the edge) */
const FULL_IN = 14;
const FULL_OUT = 17;
/** a full pair fades in over this long; its impostors stay drawn until then (cross-fade, no blink) */
const FULL_FADE_S = 0.4;
/** rings whose full pair has faded in (their impostors are no longer drawn) */
const fullReady = new Set<RingId>();
/** set when the full pairs change: the impostors re-plan on the next frame instead of the next 6 Hz tick */
const impostorDirty = { v: true };
/** impostor fighters drawn right now (QA / perf readout) */
export const impostorCount = { n: 0 };
const LIVE = new Set(["fighting", "practice", "starting", "result", "waiting"]);

interface Slot {
  ring: RingId;
  /** the snapshot source: mine / watched (real frames), none (a local sparring loop), or my climb out after a fight */
  src: "mine" | "watched" | "loop" | "exit";
}

/**
 * My climb into / out of the ring (P3-FGT-03): starts when my fight starts (in) and when it ends (out). While it runs
 * my fighter walks the ring kit's corner steps and ducks through the ropes (fight/climb climbPose); after a fight the
 * exit slot keeps drawing me until I am down the steps.
 */
export const myClimb: { run: { ring: RingId; corner: Corner; dir: "in" | "out"; t0: number; from: { x: number; z: number; yaw: number } } | null } = { run: null };
/** the first / last BLEND_S of a climb glide from / to where you actually stood (no jump to the step foot) */
const BLEND_S = 0.45;
const smooth01 = (k: number) => {
  const u = Math.min(1, Math.max(0, k));
  return u * u * (3 - 2 * u);
};
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** a corner of a (possibly turned) ring, `k` m out from the centre on its diagonal: red s = −1, blue s = +1 */
export function cornerAt(r: RingPlace, s: number, k: number) {
  const c = Math.cos(r.rotY);
  const sn = Math.sin(r.rotY);
  return { x: r.x + s * k * (c + sn), z: r.z + s * k * (c - sn) };
}
const climbing = (dir: "in" | "out") => !!myClimb.run && myClimb.run.dir === dir && performance.now() - myClimb.run.t0 < CLIMB_S * 1000;

export function FightersLayer({ lite }: { lite: boolean }) {
  const area = useArea();
  const [slots, setSlots] = useState<Slot[]>([]);
  const acc = useRef(1);
  const hidden = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const id of hidden.current) hiddenPeople.delete(id);
    },
    [],
  );
  useEffect(
    () =>
      useFightBridge.subscribe((s, prev) => {
        // (the in-climb waits a moment for the fighter avatar to mount; the layer re-plans on the next frame)
        const from = { x: selfPose.x, z: selfPose.z, yaw: selfPose.yaw };
        if (s.mine && (!prev.mine || prev.mine.ring !== s.mine.ring)) myClimb.run = { ring: s.mine.ring, corner: s.mine.corner, dir: "in", t0: performance.now() + 300, from };
        else if (!s.mine && prev.mine) myClimb.run = { ring: prev.mine.ring, corner: prev.mine.corner, dir: "out", t0: performance.now(), from };
        else return;
        acc.current = 1;
      }),
    [],
  );
  useFrame(({ camera }, dt) => {
    acc.current += dt;
    if (acc.current < 0.5 || !isOnScreen(area)) return;
    acc.current = 0;
    const b = useFightBridge.getState();
    // everyone fighting in a live ring is drawn by this layer (full or impostor): hide their ordinary avatars
    const now = new Set<string>();
    for (const r of RINGS) {
      const st = b.rings[r.id];
      if (!st || !LIVE.has(st.status)) continue;
      if (st.red) now.add(st.red.sid);
      if (st.blue) now.add(st.blue.sid);
    }
    // in my own fight (live or practice) this layer draws me too
    const you = useWorld.getState().you ?? SELF_ID;
    if (b.mine || climbing("out")) now.add(you);
    for (const id of hidden.current) if (!now.has(id)) hiddenPeople.delete(id);
    for (const id of now) hiddenPeople.add(id);
    hidden.current = now;
    const out: Slot[] = [];
    if (b.mine) out.push({ ring: b.mine.ring, src: "mine" });
    else if (climbing("out")) out.push({ ring: myClimb.run!.ring, src: "exit" });
    if (b.watched && b.watched.ring !== b.mine?.ring) out.push({ ring: b.watched.ring, src: "watched" });
    // the nearest live rings get full pairs: a ring keeps its pair until FULL_OUT, new ones join inside FULL_IN while
    // there is room (sticky: two rings at almost the same distance do not swap pairs back and forth)
    const cap = lite ? 1 : 2;
    const dist = (r: RingPlace) => Math.hypot(r.x - camera.position.x, r.z - camera.position.z);
    const free = (r: RingPlace) => LIVE.has(b.rings[r.id]?.status ?? "free") && !out.some((s) => s.ring === r.id);
    const kept = slots.filter((s) => s.src === "loop").map((s) => RING_BY_ID[s.ring]!).filter((r) => free(r) && dist(r) < FULL_OUT);
    const fresh = RINGS.filter((r) => free(r) && !kept.includes(r) && dist(r) < FULL_IN).sort((a, c) => dist(a) - dist(c));
    for (const r of [...kept, ...fresh].slice(0, cap)) out.push({ ring: r.id, src: "loop" });
    const key = out.map((s) => `${s.ring}:${s.src}`).join(",");
    if (key !== slots.map((s) => `${s.ring}:${s.src}`).join(",")) setSlots(out);
  });
  return (
    <group>
      {slots.map((s) => (
        <RingPair key={`${s.ring}:${s.src}`} slot={s} lite={lite} />
      ))}
      <Impostors exclude={slots.filter((s) => s.src === "mine" || s.src === "exit").map((s) => s.ring)} />
    </group>
  );
}

/** a fighter's look: the person's own (hall player / me), else a seeded adult look */
function useFighterLook(f: RingFighter | undefined, fallback: string): AvatarLook {
  const you = useWorld((s) => s.you) ?? SELF_ID;
  const code = useWorld((s) => (f ? s.players[f.sid]?.look : undefined));
  const profile = useProfile();
  return useMemo(() => {
    if (f && f.sid === you) return lookOf(profile);
    if (code) return decodeLook(code, "#7a7a7a", f?.sid);
    return seededLook(f?.sid ?? fallback, "#7a7a7a");
  }, [f?.sid, code, you, profile, fallback]);
}

const _a = new THREE.Vector3();
/** the two fighters of one ring, driven by its snapshot */
function RingPair({ slot, lite }: { slot: Slot; lite: boolean }) {
  const place = RING_BY_ID[slot.ring]!;
  const entry = useFightBridge((s) => s.rings[slot.ring]);
  const liveCorner = useFightBridge((s) => (slot.src === "mine" ? (s.mine?.corner ?? null) : null));
  const myCorner = liveCorner ?? (slot.src === "exit" ? (myClimb.run?.corner ?? null) : null);
  const you = useWorld((s) => s.you) ?? SELF_ID;
  // my own fight: me in my corner (my look), the opponent from the registry (or the practice AI)
  const fighterOf = (c: Corner): RingFighter | undefined => (myCorner === c ? { sid: you, name: "", corner: c } : entry?.[c]);
  const red = useFighterLook(fighterOf("red"), `${slot.ring}-red`);
  const blue = useFighterLook(fighterOf("blue"), `${slot.ring}-blue`);
  const g = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)] as const;
  const poses = [useRef<FighterPose | null>(null), useRef<FighterPose | null>(null)] as const;
  const climbs = [useRef<ClimbBlend | null>(null), useRef<ClimbBlend | null>(null)] as const;
  const react = useRef<[{ clip: FighterPose["clip"]; at: number } | null, { clip: FighterPose["clip"]; at: number } | null]>([null, null]);
  const loopT0 = useMemo(() => performance.now() - ((hashOf(slot.ring) % 997) * 1000) / 3, [slot.ring]);
  // smoothed placement per fighter: snapshots arrive at 10–15 Hz and phases jump (corner ↔ centre); the figures glide
  const sm = useRef([
    { x: 0, z: 0, yaw: 0, on: false },
    { x: 0, z: 0, yaw: 0, on: false },
  ]);
  // a spectated pair takes over from its impostors once faded in; the impostors come back the moment it goes
  useEffect(() => {
    const ring = slot.ring;
    const crossfade = slot.src === "loop" || slot.src === "watched";
    const t = crossfade ? setTimeout(() => (fullReady.add(ring), (impostorDirty.v = true)), FULL_FADE_S * 1000) : null;
    return () => {
      if (t) clearTimeout(t);
      fullReady.delete(ring);
      impostorDirty.v = true;
    };
  }, [slot.ring, slot.src]);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const b = useFightBridge.getState();
    let snap: BoxingSnapshot | null = null;
    let events: FightEvent[] = [];
    if (slot.src === "mine") {
      snap = b.mine?.snap ?? null;
      events = drainMyEvents();
    } else if (slot.src === "watched") {
      snap = b.watched?.snap ?? null;
      events = b.watched?.events ?? [];
    }
    if (!snap) snap = loopSnapshot(slot.ring, performance.now() - loopT0, b.rings[slot.ring]);
    const now = performance.now();
    for (const e of events) if (e.k === "hit") react.current[(1 - e.by) as 0 | 1] = { clip: HIT_REACTION[e.punch], at: now };
    // placement from dist (cm) and orbit (deg × 10) around the ring centre, on the canvas
    const th = ((snap.orbit / 10) * Math.PI) / 180;
    const half = Math.min(snap.dist / 200, place.half - 0.8);
    const ax = Math.cos(th);
    const az = Math.sin(th);
    const waiting = b.rings[slot.ring]?.status === "waiting";
    const rest = snap.phase === "rest" || snap.phase === "intro" || waiting ? 1 : 0;
    snap.fighters.forEach((f, i) => {
      const s = i === 0 ? -1 : 1;
      const grp = g[i]!.current;
      if (!grp) return;
      // between rounds (and waiting for an opponent): in their own corner (the ring may be turned), facing the centre
      const at = rest ? cornerAt(place, s, place.half - 1.0) : { x: place.x + s * half * ax, z: place.z + s * half * az };
      _a.set(place.x - at.x, 0, place.z - at.z);
      if (!rest) _a.set(-s * ax, 0, -s * az);
      const yaw = Math.atan2(_a.x, _a.z);
      const S = sm.current[i]!;
      if (!S.on) Object.assign(S, { x: at.x, z: at.z, yaw, on: true });
      else {
        const k = damp(rest ? 4 : 12, dt);
        S.x += (at.x - S.x) * k;
        S.z += (at.z - S.z) * k;
        S.yaw += wrapA(yaw - S.yaw) * damp(10, dt);
      }
      grp.position.set(S.x, place.canvasY, S.z);
      grp.rotation.y = S.yaw;
      // my own press shows at once (prediction), the next snapshot corrects it
      const pred = slot.src === "mine" && b.mine && b.mine.predicted && f.corner === b.mine.corner && now - b.mine.predicted.at < 400 ? b.mine.predicted : null;
      const view = pred ? { ...f, act: pred.act, actT: Math.floor(((now - pred.at) / 1000) * TICK_HZ) } : f;
      const r = react.current[i as 0 | 1];
      poses[i]!.current = {
        clip: clipFor(view, snap!.phase),
        t: view.actT / TICK_HZ,
        react: r && now - r.at < 500 ? { clip: r.clip, t: (now - r.at) / 1000 } : null,
      };
    });
    // my climb in / out over the corner steps overrides my fighter's place and pose
    const run = myClimb.run;
    const ci: 0 | 1 | -1 = run && run.ring === slot.ring && (slot.src === "mine" || slot.src === "exit") ? (run.corner === "red" ? 0 : 1) : -1;
    for (const k of [0, 1] as const) if (k !== ci) climbs[k].current = null;
    if (run && ci !== -1) {
      const t = (now - run.t0) / 1000;
      const grp = g[ci]!.current;
      if (t < CLIMB_S || slot.src === "exit") {
        const cp = climbPose(place, run.corner, run.dir, Math.max(0, Math.min(t, CLIMB_S)));
        // glide from where you stood to the step foot (in), or from the foot back to that spot (out)
        const kb = run.dir === "in" ? 1 - smooth01(t / BLEND_S) : smooth01((t - (CLIMB_S - BLEND_S)) / BLEND_S);
        const x = cp.x + (run.from.x - cp.x) * kb;
        const z = cp.z + (run.from.z - cp.z) * kb;
        const yaw = cp.yaw + wrapA(run.from.yaw - cp.yaw) * kb;
        grp?.position.set(x, cp.y * (1 - kb), z); // (from the hall floor: the feature rings stand on the 1.2 m stage)
        if (grp) grp.rotation.y = yaw;
        Object.assign(sm.current[ci]!, { x: cp.x, z: cp.z, yaw: cp.yaw, on: true });
        climbs[ci]!.current = { walk: cp.walk && t >= 0 && t < CLIMB_S, duck: cp.duck };
        poses[ci]!.current = { clip: cp.duckT >= 0 ? "duck" : "guard", t: cp.duckT >= 0 ? cp.duckT * 0.7 : 0, react: null };
      } else climbs[ci]!.current = null;
    }
  });
  const showRed = slot.src !== "exit" || myCorner === "red";
  const showBlue = slot.src === "exit" ? myCorner === "blue" : !!(entry?.blue || entry?.status === "practice" || slot.src === "mine");
  return (
    <group>
      {showRed && (
        <group ref={g[0]}>
          <FighterAvatar look={red} corner="red" poseRef={poses[0]} lite={lite} climbRef={climbs[0]} />
        </group>
      )}
      {showBlue && (
        <group ref={g[1]}>
          <FighterAvatar look={blue} corner="blue" poseRef={poses[1]} lite={lite} climbRef={climbs[1]} />
        </group>
      )}
    </group>
  );
}

function hashOf(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * A ring with no frames (not watched): a deterministic sparring loop from the registry alone, so a live ring never
 * stands still. Same snapshot shape as the real one (the renderer has one path).
 */
const LOOP: [BoxingSnapshot["fighters"][number]["act"], number][] = [
  ["idle", 20],
  ["jab", 12],
  ["idle", 10],
  ["cross", 16],
  ["slipL", 12],
  ["idle", 14],
  ["hook", 18],
  ["blockHit", 9],
  ["stepIn", 10],
  ["uppercut", 18],
  ["stepOut", 10],
];
const LOOP_LEN = LOOP.reduce((a, [, n]) => a + n, 0);
function loopAct(t: number) {
  let k = ((t % LOOP_LEN) + LOOP_LEN) % LOOP_LEN;
  for (const [act, n] of LOOP) {
    if (k < n) return { act, actT: k };
    k -= n;
  }
  return { act: "idle" as const, actT: 0 };
}
export function loopSnapshot(ring: RingId, ms: number, st: RingState | undefined): BoxingSnapshot {
  const tick = Math.floor((ms / 1000) * TICK_HZ);
  const phase: BoxingSnapshot["phase"] = st?.status === "result" ? "over" : st?.status === "starting" ? "intro" : st?.status === "waiting" ? "countdown" : "round";
  const f = (i: 0 | 1, corner: Corner) => {
    const a = phase === "round" ? loopAct(tick + i * 41) : { act: phase === "over" ? (i === 0 ? ("celebrate" as const) : ("dejected" as const)) : ("idle" as const), actT: tick % 60 };
    return { id: `${ring}-${corner}`, corner, act: a.act, actT: a.actT, stage: "none" as const, guard: true, stamina: 800, composure: 800, points: 0, knockdowns: 0, warnings: 0, connected: true };
  };
  return { ring, tick, phase, round: st?.round ?? 1, rounds: st?.rounds ?? 3, left: 0, dist: 150 + Math.round(25 * Math.sin(tick / 40)), orbit: Math.round((tick * 0.8) % 3600), fighters: [f(0, "red"), f(1, "blue")] };
}

/* ------------------------------------------------------------ far rings: boxer impostors ------------------------------------------------------------ */

/** adult skin tones for the far fighters (picked by a hash of the fighter's id: deterministic) */
const SKIN = ["#3B2219", "#4A2C1E", "#5C3A26", "#6E4530", "#85562C", "#9A6A44"];

/**
 * Every other live ring: both fighters as low-poly boxers in kit (fight/impostor-geometry: headgear, gloves, vest,
 * trunks, boots, an orthodox stance) in their corner colour and their own skin tone. Three poses (guard, jab, cross),
 * one instanced mesh each: a fighter is written into the mesh of its current pose, so three draw calls draw every far
 * fighter of the hall. Updated at 6 Hz (far rings never animate at full rate), with a small bounce and footwork.
 */
function Impostors({ exclude }: { exclude: RingId[] }) {
  const N = RINGS.length * 2;
  const area = useArea();
  const res = useMemo(() => {
    const mat = impostorMaterial();
    const meshes = IMPOSTOR_POSES.map((pose) => {
      const geo = impostorGeometry(pose);
      geo.setAttribute("aKit", new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3));
      const m = new THREE.InstancedMesh(geo, mat, N);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      m.name = `boxer-impostor-${pose}`;
      return m;
    });
    return { mat, meshes };
  }, [N]);
  useEffect(
    () => () => {
      res.mat.dispose();
      for (const m of res.meshes) {
        m.geometry.dispose();
        m.dispose();
      }
    },
    [res],
  );
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const one = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const c = useMemo(() => new THREE.Color(), []);
  const kitCol = useMemo(() => ({ red: new THREE.Color(CORNER_COLORS.red), blue: new THREE.Color(CORNER_COLORS.blue) }), []);
  const acc = useRef(1);
  const exKey = exclude.join(",");
  useEffect(() => void (impostorDirty.v = true), [exKey]);
  useFrame(({ clock }, dt) => {
    acc.current += dt;
    if ((acc.current < 1 / 6 && !impostorDirty.v) || !isOnScreen(area)) return;
    impostorDirty.v = false;
    acc.current = 0;
    const rings = useFightBridge.getState().rings;
    const t = clock.elapsedTime;
    const counts = [0, 0, 0];
    RINGS.forEach((r: RingPlace, ri) => {
      const st = rings[r.id];
      if (!st || !LIVE.has(st.status) || exclude.includes(r.id) || fullReady.has(r.id)) return;
      const rest = st.status === "waiting" || st.status === "starting";
      for (let k = 0; k < 2; k++) {
        const corner = k === 0 ? "red" : "blue";
        const who = k === 0 ? st.red : st.blue;
        if (!who && !(k === 1 && st.status === "practice")) continue;
        const h = hashOf(r.id + corner);
        const s = k === 0 ? -1 : 1;
        // the pair circles the centre; between rounds / waiting they stand in their corners
        const th = ((t * 4.8 + (hashOf(r.id) % 360)) * Math.PI) / 180;
        const half = rest ? r.half - 1.0 : 0.62 + 0.1 * Math.sin(t * 0.9 + ri);
        const corner0 = cornerAt(r, s, half);
        const x = rest ? corner0.x : r.x + s * half * Math.cos(th);
        const z = rest ? corner0.z : r.z + s * half * Math.sin(th);
        const yaw = rest ? Math.atan2(r.x - x, r.z - z) : Math.atan2(-s * Math.cos(th), -s * Math.sin(th));
        // pose: mostly guard, a jab or a cross now and then (offset per fighter so the pair interleaves)
        const beat = Math.floor(t * 2.2 + (h % 7));
        const roll = (beat * 2654435761 + h) >>> 0;
        const pose = rest || st.status === "result" ? 0 : roll % 5 === 0 ? 1 : roll % 7 === 0 ? 2 : 0;
        const bounce = rest ? 0 : Math.abs(Math.sin(t * 6.3 + h)) * 0.03;
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
        m4.compose(p.set(x, r.canvasY + bounce, z), q, one);
        const mesh = res.meshes[pose]!;
        const i = counts[pose]!++;
        mesh.setMatrixAt(i, m4);
        mesh.setColorAt(i, c.set(SKIN[h % SKIN.length]!));
        (mesh.geometry.getAttribute("aKit") as THREE.InstancedBufferAttribute).setXYZ(i, kitCol[corner].r, kitCol[corner].g, kitCol[corner].b);
      }
    });
    res.meshes.forEach((m, k) => {
      m.count = counts[k]!;
      m.visible = m.count > 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.geometry.getAttribute("aKit").needsUpdate = true;
    });
    impostorCount.n = counts[0]! + counts[1]! + counts[2]!;
  });
  return (
    <group userData={{ noMerge: true }}>
      {res.meshes.map((m) => (
        <primitive key={m.name} object={m} />
      ))}
    </group>
  );
}

"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { clipFor, CORNER_COLORS, HIT_REACTION, TICK_HZ, type BoxingSnapshot, type Corner, type FightEvent, type RingFighter, type RingId, type RingState } from "@gukirana/contracts";
import { useWorld } from "@/lib/world-store";
import { decodeLook, seededLook, type AvatarLook } from "@/world/outfits";
import { lookOf, useProfile } from "@/lib/profile-store";
import { hiddenPeople, SELF_ID } from "@/rooms/hall-hooks";
import { isOnScreen, useArea } from "@/world/stage";
import { FighterAvatar, type FighterPose } from "./assets-shim";
import { drainMyEvents, useFightBridge } from "./bridge";
import { RING_BY_ID, RINGS, type RingPlace } from "./plan";

/**
 * Fighters in the rings (P3-FGT-01 §6, §4.5):
 *  - full avatars (in the corner's kit, posed by the motion library) for MY ring, the WATCHED ring and the two nearest
 *    other live rings within 14 m: clip = clipFor(view, phase) at actT / TICK_HZ (my own press: `predicted` first),
 *    HIT_REACTION blended on the target of each `hit` event, the pair placed from `dist` / `orbit`;
 *  - every other live ring: two-pose impostors (one instanced body + head batch, a sparring loop from the 1 Hz
 *    registry), so 50 busy rings stay within the people budget;
 *  - these people's ordinary avatars are hidden meanwhile (rooms/hall-hooks hiddenPeople): their pose is the fight's.
 */
const FULL_R = 14;
/** impostor fighters drawn right now (QA / perf readout) */
export const impostorCount = { n: 0 };
const LIVE = new Set(["fighting", "practice", "starting", "result", "waiting"]);

interface Slot {
  ring: RingId;
  /** the snapshot source: mine / watched (real frames) or none (a local sparring loop) */
  src: "mine" | "watched" | "loop";
}

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
    if (b.mine) now.add(you);
    for (const id of hidden.current) if (!now.has(id)) hiddenPeople.delete(id);
    for (const id of now) hiddenPeople.add(id);
    hidden.current = now;
    const out: Slot[] = [];
    if (b.mine) out.push({ ring: b.mine.ring, src: "mine" });
    if (b.watched && b.watched.ring !== b.mine?.ring) out.push({ ring: b.watched.ring, src: "watched" });
    const near = RINGS.filter((r) => LIVE.has(b.rings[r.id]?.status ?? "free") && !out.some((s) => s.ring === r.id))
      .map((r) => ({ r, d: Math.hypot(r.x - camera.position.x, r.z - camera.position.z) }))
      .filter((x) => x.d < FULL_R)
      .sort((a, c) => a.d - c.d)
      .slice(0, lite ? 1 : 2);
    for (const n of near) out.push({ ring: n.r.id, src: "loop" });
    const key = out.map((s) => `${s.ring}:${s.src}`).join(",");
    if (key !== slots.map((s) => `${s.ring}:${s.src}`).join(",")) setSlots(out);
  });
  return (
    <group>
      {slots.map((s) => (
        <RingPair key={`${s.ring}:${s.src}`} slot={s} lite={lite} />
      ))}
      <Impostors exclude={slots.map((s) => s.ring)} />
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
  const myCorner = useFightBridge((s) => (slot.src === "mine" ? (s.mine?.corner ?? null) : null));
  const you = useWorld((s) => s.you) ?? SELF_ID;
  // my own fight: me in my corner (my look), the opponent from the registry (or the practice AI)
  const fighterOf = (c: Corner): RingFighter | undefined => (myCorner === c ? { sid: you, name: "", corner: c } : entry?.[c]);
  const red = useFighterLook(fighterOf("red"), `${slot.ring}-red`);
  const blue = useFighterLook(fighterOf("blue"), `${slot.ring}-blue`);
  const g = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)] as const;
  const poses = [useRef<FighterPose | null>(null), useRef<FighterPose | null>(null)] as const;
  const react = useRef<[{ clip: FighterPose["clip"]; at: number } | null, { clip: FighterPose["clip"]; at: number } | null]>([null, null]);
  const loopT0 = useMemo(() => performance.now() - ((hashOf(slot.ring) % 997) * 1000) / 3, [slot.ring]);
  useFrame(() => {
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
      // between rounds (and waiting for an opponent): in the corners (red −x,−z / blue +x,+z), facing the centre
      const cx = rest ? s * (place.half - 1.0) : s * half * ax;
      const cz = rest ? s * (place.half - 1.0) : s * half * az;
      grp.position.set(place.x + cx, place.canvasY, place.z + cz);
      _a.set(place.x - grp.position.x, 0, place.z - grp.position.z);
      if (!rest) _a.set(-s * ax, 0, -s * az);
      grp.rotation.y = Math.atan2(_a.x, _a.z);
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
  });
  return (
    <group>
      <group ref={g[0]}>
        <FighterAvatar look={red} corner="red" poseRef={poses[0]} lite={lite} />
      </group>
      {(entry?.blue || entry?.status === "practice" || slot.src === "mine") && (
        <group ref={g[1]}>
          <FighterAvatar look={blue} corner="blue" poseRef={poses[1]} lite={lite} />
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

/* ------------------------------------------------------------ far rings: two-pose impostors ------------------------------------------------------------ */

/**
 * Every other live ring: both fighters as simple instanced figures (torso + head + gloves) in the corner colours,
 * switching between two sparring poses at ~2 Hz (a lead / a guard), placed like the real pair. Three draw calls for the
 * whole hall.
 */
function Impostors({ exclude }: { exclude: RingId[] }) {
  const N = RINGS.length * 2;
  const body = useRef<THREE.InstancedMesh>(null);
  const head = useRef<THREE.InstancedMesh>(null);
  const glove = useRef<THREE.InstancedMesh>(null);
  const area = useArea();
  const geo = useMemo(
    () => ({
      body: new THREE.CapsuleGeometry(0.2, 0.9, 2, 8).translate(0, 0.85, 0),
      head: new THREE.SphereGeometry(0.12, 10, 8).translate(0, 1.62, 0),
      glove: new THREE.SphereGeometry(0.075, 8, 6),
    }),
    [],
  );
  const mats = useMemo(
    () => ({
      body: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8 }),
      head: new THREE.MeshStandardMaterial({ color: "#5a3a28", roughness: 0.7 }),
      glove: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.5 }),
    }),
    [],
  );
  useEffect(() => () => (Object.values(geo).forEach((g) => g.dispose()), Object.values(mats).forEach((m) => m.dispose())), [geo, mats]);
  useLayoutEffect(() => {
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      c.set(i % 2 === 0 ? CORNER_COLORS.red : CORNER_COLORS.blue);
      body.current!.setColorAt(i, c);
      glove.current!.setColorAt(i * 2, c);
      glove.current!.setColorAt(i * 2 + 1, c);
      head.current!.setColorAt(i, c.set(["#3B2219", "#5C3A26", "#6E4530", "#85562C"][hashOf(String(i)) % 4]!));
    }
    for (const m of [body, head, glove]) if (m.current!.instanceColor) m.current!.instanceColor.needsUpdate = true;
  }, [N]);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const one = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const zero = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const acc = useRef(1);
  useFrame(({ clock }, dt) => {
    // far rings never animate at full rate: 6 Hz pose updates
    acc.current += dt;
    if (acc.current < 1 / 6 || !isOnScreen(area)) return;
    acc.current = 0;
    const rings = useFightBridge.getState().rings;
    const t = clock.elapsedTime;
    let shown = 0;
    RINGS.forEach((r: RingPlace, ri) => {
      const st = rings[r.id];
      const live = st && LIVE.has(st.status) && !exclude.includes(r.id);
      for (let k = 0; k < 2; k++) {
        const i = ri * 2 + k;
        const has = live && (k === 0 ? !!st!.red : !!st!.blue || st!.status === "practice");
        if (!has) {
          m4.compose(p.set(r.x, -10, r.z), q.identity(), zero);
          body.current!.setMatrixAt(i, m4);
          head.current!.setMatrixAt(i, m4);
          glove.current!.setMatrixAt(i * 2, m4);
          glove.current!.setMatrixAt(i * 2 + 1, m4);
          continue;
        }
        shown++;
        const s = k === 0 ? -1 : 1;
        const th = ((t * 4.8 + (hashOf(r.id) % 360)) * Math.PI) / 180;
        const ph = Math.floor(t * 2 + (hashOf(r.id + k) % 4)) % 2; // the two poses
        const half = 0.72 + 0.08 * Math.sin(t * 0.9 + ri);
        const x = r.x + s * half * Math.cos(th);
        const z = r.z + s * half * Math.sin(th);
        const yaw = Math.atan2(-s * Math.cos(th), -s * Math.sin(th));
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
        m4.compose(p.set(x, r.canvasY, z), q, one);
        body.current!.setMatrixAt(i, m4);
        head.current!.setMatrixAt(i, m4);
        // gloves: guard at the chin, the lead hand out on pose 1
        const fx = Math.sin(yaw);
        const fz = Math.cos(yaw);
        const rx = Math.cos(yaw);
        const rz = -Math.sin(yaw);
        for (const [gi, side] of [
          [0, 1],
          [1, -1],
        ] as const) {
          const reachOut = ph === 1 && gi === 0 ? 0.5 : 0.22;
          m4.compose(p.set(x + fx * reachOut + rx * side * 0.14, r.canvasY + 1.42, z + fz * reachOut + rz * side * 0.14), q, one);
          glove.current!.setMatrixAt(i * 2 + gi, m4);
        }
      }
    });
    for (const m of [body, head, glove]) m.current!.instanceMatrix.needsUpdate = true;
    impostorCount.n = shown;
  });
  return (
    <group userData={{ noMerge: true }}>
      <instancedMesh ref={body} args={[geo.body, mats.body, N]} frustumCulled={false} />
      <instancedMesh ref={head} args={[geo.head, mats.head, N]} frustumCulled={false} />
      <instancedMesh ref={glove} args={[geo.glove, mats.glove, N * 2]} frustumCulled={false} />
    </group>
  );
}

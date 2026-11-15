"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CORNER_COLORS, TICK_HZ, type BoxingSnapshot, type Corner, type FightEvent, type RingFighter, type RingId, type RingState } from "@gukirana/contracts";
import { selfPose, useWorld } from "@/lib/world-store";
import { decodeLook, seededLook, type AvatarLook } from "@/world/outfits";
import { lookOf, useProfile } from "@/lib/profile-store";
import { hiddenPeople, SELF_ID } from "@/rooms/hall-hooks";
import { isOnScreen, useArea } from "@/world/stage";
import { FightAvatar, newBody, RefereeAvatar, type RingBody } from "./fighter-avatar";
import { clampInRing, hitFeel, moodOf, presentFighter, reactionFor, refereeSpot, ringLayout, ringSeed } from "./present";
import { cameraKick, hitStop } from "./ring-clock";
import { focusNow, ringCulled } from "./focus";
import { replayFrame } from "./game/replay";
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
const COARSE = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
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
/** a neutral corner (the other diagonal) of a (possibly turned) ring: where the standing fighter waits out a count */
export function neutralCornerAt(r: RingPlace, s: number, k: number) {
  const c = Math.cos(r.rotY);
  const sn = Math.sin(r.rotY);
  return { x: r.x + s * k * (c - sn), z: r.z - s * k * (c + sn) };
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
    // phones: one full pair at a time (≈ 11 draws + a mount hitch each; P3-FGT-04 found 157 calls with two)
    const cap = lite || COARSE ? 1 : 2;
    const dist = (r: RingPlace) => Math.hypot(r.x - camera.position.x, r.z - camera.position.z);
    const free = (r: RingPlace) => LIVE.has(b.rings[r.id]?.status ?? "free") && !out.some((s) => s.ring === r.id);
    const kept = slots.filter((s) => s.src === "loop").map((s) => RING_BY_ID[s.ring]!).filter((r) => free(r) && dist(r) < FULL_OUT);
    const fresh = RINGS.filter((r) => free(r) && !kept.includes(r) && dist(r) < FULL_IN).sort((a, c) => dist(a) - dist(c));
    // focus mode (fighter): the neighbours sink into the dark, no full avatars for them
    if (!(focusNow.mode && focusNow.k > 0)) for (const r of [...kept, ...fresh].slice(0, cap)) out.push({ ring: r.id, src: "loop" });
    const key = out.map((s) => `${s.ring}:${s.src}`).join(",");
    if (key !== slots.map((s) => `${s.ring}:${s.src}`).join(",")) setSlots(out);
  });
  return (
    <group userData={{ focusKeep: true }}>
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

/** walking speed in the ring (to the corner / the neutral corner), m/s */
const WALK_V = 1.5;

interface Track {
  key: string;
  since: number;
  x: number;
  z: number;
  yaw: number;
  init: boolean;
  hitAt: number;
  /** smoothed ground speed (m/s): drives the shuffle */
  spd: number;
}
const newTrack = (): Track => ({ key: "", since: 0, x: 0, z: 0, yaw: 0, init: false, hitAt: -1e9, spd: 0 });

function turn(a: number, b: number, k: number) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * Math.min(1, k);
}
/** move a tracked body towards (tx, tz): walk when far (facing the way), glide when close; returns "walking" */
function moveTo(tr: Track, tx: number, tz: number, faceYaw: number, dt: number, snap: boolean): boolean {
  if (!tr.init || snap) {
    tr.x = tx;
    tr.z = tz;
    tr.yaw = faceYaw;
    tr.init = true;
    return false;
  }
  const dx = tx - tr.x;
  const dz = tz - tr.z;
  const d = Math.hypot(dx, dz);
  if (d > 0.45) {
    const step = Math.min(d, WALK_V * dt);
    tr.x += (dx / d) * step;
    tr.z += (dz / d) * step;
    tr.yaw = turn(tr.yaw, Math.atan2(dx, dz), dt * 8);
    return true;
  }
  const k = 1 - Math.exp(-dt * 14);
  tr.x += dx * k;
  tr.z += dz * k;
  tr.yaw = turn(tr.yaw, faceYaw, dt * 10);
  return false;
}

/** the two fighters (and, in a real fight, the referee) of one ring, driven by its snapshot through fight/present.ts */
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
  const refLookV = useMemo(() => seededLook(`referee-${slot.ring}`, "#7a7a7a"), [slot.ring]);
  const withRef = slot.src === "mine" || slot.src === "watched";
  const g = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)] as const;
  const refG = useRef<THREE.Group>(null);
  const bodies = [useRef<RingBody | null>(newBody()), useRef<RingBody | null>(newBody())] as const;
  const refBody = useRef<RingBody | null>(newBody());
  const tracks = useRef([newTrack(), newTrack(), newTrack()]);
  const phaseRef = useRef({ phase: "", since: 0, clinchSince: -1, refSide: 0 });
  const loopT0 = useMemo(() => performance.now() - ((hashOf(slot.ring) % 997) * 1000) / 3, [slot.ring]);
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
  useFrame(({ camera }, raw) => {
    const dt = Math.min(raw, 0.05);
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
    const replay = slot.src === "mine" ? replayFrame() : null;
    if (replay) {
      snap = replay.snap;
      events = replay.events;
    }
    if (!snap) snap = loopSnapshot(slot.ring, performance.now() - loopT0, b.rings[slot.ring]);
    const now = performance.now();
    const t = now / 1000;
    const ph = phaseRef.current;
    if (snap.phase !== ph.phase) {
      ph.phase = snap.phase;
      ph.since = t;
    }
    const phaseSince = t - ph.since;
    const trs = tracks.current;
    const myIdx = slot.src === "mine" && b.mine ? (b.mine.corner === "red" ? 0 : 1) : -1;
    for (const e of events) {
      if (e.k === "hit") {
        const to = (1 - e.by) as 0 | 1;
        const r = reactionFor(e, snap.fighters[to].composure);
        bodies[to].current!.react = { clip: r.clip, intensity: r.intensity, at: now };
        trs[to]!.hitAt = t;
      }
      // the connection lands with weight: a few frames of hit-stop, a small camera punch (P3-FGT-07)
      if (!replay && (e.k === "hit" || e.k === "block" || e.k === "knockdown")) {
        const feel = hitFeel(e, e.k !== "knockdown" && e.by === myIdx);
        hitStop(feel.stop);
        cameraKick.v = Math.max(cameraKick.v, feel.kick);
      }
    }
    // placement (P3-FGT-07 ringLayout): the canvas gap from the engine distance, the pair circling and drifting round
    // the ring (ropes, corners, centre), presentation only
    const lay = ringLayout(snap, place.half, ringSeed(slot.ring));
    const half = lay.half;
    const ax = Math.cos(lay.th);
    const az = Math.sin(lay.th);
    const inside = place.half - 0.3 - 0.38;
    const waiting = b.rings[slot.ring]?.status === "waiting";
    const rest = snap.phase === "rest" || waiting;
    const corner = place.half - 1.0;
    const winner = snap.phase === "over" ? snap.fighters.findIndex((f) => f.act === "celebrate") : -1;
    const down = snap.fighters.findIndex((f) => f.act === "down") as 0 | 1 | -1;
    // a clinch: in close, both idle (presentation; the engine's break field, when present, makes it official)
    const breakLeft = (snap as { breakLeft?: number }).breakLeft ?? 0;
    const close = snap.phase === "round" && snap.dist <= 80 && snap.fighters.every((f) => f.act === "idle");
    if (close || breakLeft > 0) {
      if (ph.clinchSince < 0) ph.clinchSince = t;
    } else ph.clinchSince = -1;
    const clinch = ph.clinchSince >= 0 && t - ph.clinchSince > 0.35;
    const breaking = breakLeft > 0 || (clinch && t - ph.clinchSince > 1.1);
    const tick = snap.tick;
    const phase = snap.phase;
    snap.fighters.forEach((f, i) => {
      const s = i === 0 ? -1 : 1;
      const grp = g[i]!.current;
      const tr = trs[i]!;
      // where to stand: the stool between rounds, a neutral corner while the other one is counted, else the fight
      let tx: number, tz: number;
      const counted = phase === "knockdown" && down !== -1 && down !== i;
      if (rest) {
        const at = cornerAt(place, s, corner);
        tx = at.x - place.x;
        tz = at.z - place.z;
      } else if (counted) {
        const at = neutralCornerAt(place, s, corner);
        tx = at.x - place.x;
        tz = at.z - place.z;
      } else {
        const at = clampInRing(lay.cx + s * half * ax, lay.cz + s * half * az, place.rotY, inside);
        tx = at.x;
        tz = at.z;
      }
      const faceYaw = rest || counted ? Math.atan2(-tx, -tz) : Math.atan2(-s * ax, -s * az);
      const px0 = tr.x;
      const pz0 = tr.z;
      const walking = moveTo(tr, tx, tz, faceYaw, dt, false);
      tr.spd += ((dt > 0 ? Math.hypot(tr.x - px0, tr.z - pz0) / dt : 0) - tr.spd) * Math.min(1, dt * 8);
      grp?.position.set(place.x + tr.x, place.canvasY, place.z + tr.z);
      if (grp) grp.rotation.y = tr.yaw;
      // my own press shows at once (prediction), the next snapshot corrects it
      const pred = slot.src === "mine" && !replay && b.mine && b.mine.predicted && f.corner === b.mine.corner && now - b.mine.predicted.at < 400 ? b.mine.predicted : null;
      const view = pred ? { ...f, act: pred.act, actT: Math.floor(((now - pred.at) / 1000) * TICK_HZ) } : f;
      const key = `${view.act}:${phase}`;
      if (key !== tr.key) {
        tr.key = key;
        tr.since = t;
      }
      const won = winner === -1 ? null : winner === i;
      const body = bodies[i]!.current!;
      body.walk = walking;
      body.cmd = walking ? null : presentFighter(view, phase, { actSince: t - tr.since, phaseSince, clinch, tick, gap: half * 2 }, won);
      body.mood = moodOf(view, phase, t - tr.hitAt, won);
      // ring life while the round is live: fresher = bouncier; tired late in the round = heavier feet, lower gloves
      const live = (phase === "round" || phase === "countdown") && !walking && view.act !== "down" && !clinch;
      body.life = live ? { seed: hashOf(slot.ring) + i * 7919, energy: Math.min(1, view.stamina / 800), tired: view.stamina < 450 ? (450 - view.stamina) / 450 : 0, move: tr.spd } : null;
    });
    // the referee: on the far side of the pair from the camera, stepping in to count, break and raise the winner
    if (withRef && refG.current) {
      // stay on the far side of the pair from the camera (he walks round when the camera changes sides)
      const camSide = (camera.position.x - place.x) * -az + (camera.position.z - place.z) * ax >= 0 ? 1 : -1;
      if (!ph.refSide || ph.refSide === camSide) ph.refSide = -camSide;
      const spot = refereeSpot(phase, { dist: snap.dist, down, winner: winner === -1 ? null : (winner as 0 | 1), breaking, half: place.half, t: tick / TICK_HZ });
      const px = -az * ph.refSide;
      const pz = ax * ph.refSide;
      // round the pair's middle (it drifts round the ring), never through the ropes
      const mid = phase === "rest" ? { x: 0, z: 0 } : { x: lay.cx, z: lay.cz };
      const ra = clampInRing(mid.x + spot.x * ax + spot.z * px, mid.z + spot.x * az + spot.z * pz, place.rotY, inside);
      const rx = ra.x;
      const rz = ra.z;
      const tr = trs[2]!;
      // face the action: the pair's middle, the downed fighter, or the camera side when raising a hand
      const fx = mid.x + (spot.face ? spot.face * half * ax : 0);
      const fz = mid.z + (spot.face ? spot.face * half * az : 0);
      const faceYaw = phase === "over" ? Math.atan2(-px, -pz) : Math.atan2(fx - rx, fz - rz);
      const rx0 = tr.x;
      const rz0 = tr.z;
      const walking = moveTo(tr, rx, rz, faceYaw, dt, false);
      tr.spd += ((dt > 0 ? Math.hypot(tr.x - rx0, tr.z - rz0) / dt : 0) - tr.spd) * Math.min(1, dt * 8);
      refG.current.position.set(place.x + tr.x, place.canvasY, place.z + tr.z);
      refG.current.rotation.y = tr.yaw;
      const rb = refBody.current!;
      rb.walk = walking;
      rb.cmd = walking ? null : { clip: spot.clip, offset: phaseSince, speed: 1, intensity: 1, hold: 0, key: `${spot.clip}:${phase}` };
      rb.life = walking ? null : { seed: hashOf(slot.ring) + 31, energy: 0, tired: 0, move: tr.spd, official: true };
    }
    // my climb in / out over the corner steps overrides my fighter's place and pose
    const run = myClimb.run;
    const ci: 0 | 1 | -1 = run && run.ring === slot.ring && (slot.src === "mine" || slot.src === "exit") ? (run.corner === "red" ? 0 : 1) : -1;
    if (run && ci !== -1) {
      const tt = (now - run.t0) / 1000;
      const grp = g[ci]!.current;
      if (tt < CLIMB_S || slot.src === "exit") {
        const cp = climbPose(place, run.corner, run.dir, Math.max(0, Math.min(tt, CLIMB_S)));
        // glide from where you stood to the step foot (in), or from the foot back to that spot (out)
        const kb = run.dir === "in" ? 1 - smooth01(tt / BLEND_S) : smooth01((tt - (CLIMB_S - BLEND_S)) / BLEND_S);
        const x = cp.x + (run.from.x - cp.x) * kb;
        const z = cp.z + (run.from.z - cp.z) * kb;
        const yaw = cp.yaw + wrapA(run.from.yaw - cp.yaw) * kb;
        grp?.position.set(x, cp.y * (1 - kb), z); // (from the hall floor: the feature rings stand on the 1.2 m stage)
        if (grp) grp.rotation.y = yaw;
        const tr = trs[ci]!;
        tr.x = cp.x - place.x;
        tr.z = cp.z - place.z;
        tr.yaw = cp.yaw;
        tr.init = true;
        const body = bodies[ci]!.current!;
        body.walk = cp.walk && tt >= 0 && tt < CLIMB_S;
        body.cmd = cp.duckT >= 0 ? { clip: "duck", offset: cp.duckT * 0.7, speed: 1, intensity: 1, hold: 0, key: "duck" } : body.walk ? null : { clip: "guardIdle", offset: 0, speed: 1, intensity: 1, hold: 0, key: "guard" };
      }
    }
  });
  const showRed = slot.src !== "exit" || myCorner === "red";
  const showBlue = slot.src === "exit" ? myCorner === "blue" : !!(entry?.blue || entry?.status === "practice" || slot.src === "mine");
  return (
    <group>
      {showRed && (
        <group ref={g[0]}>
          <FightAvatar look={red} corner="red" body={bodies[0]} lite={lite} />
        </group>
      )}
      {showBlue && (
        <group ref={g[1]}>
          <FightAvatar look={blue} corner="blue" body={bodies[1]} lite={lite} />
        </group>
      )}
      {withRef && (
        <group ref={refG}>
          <RefereeAvatar look={refLookV} body={refBody} lite={lite} />
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
      if (!st || !LIVE.has(st.status) || exclude.includes(r.id) || fullReady.has(r.id) || ringCulled(r.id)) return;
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

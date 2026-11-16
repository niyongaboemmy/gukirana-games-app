"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Avatar } from "./Avatar";
import { seededLook } from "./outfits";
import { selfPose } from "@/lib/world-store";
import { planRoute, plazaObstacles } from "./obstacles";
import { PLAZA_RADIUS } from "./layout";
import { tod } from "./time-of-day/store";
import {
  campusNpcs,
  COMPOUND_LIFE_ON,
  laneZ,
  poseAt,
  schedule,
  TRAFFIC_X,
  vehicles,
  vehicleX,
  type Npc,
  type Pose,
  type Schedule,
  type Stander,
  type Stroller,
} from "./campus-life";
import {
  carGeometry,
  minibusGeometry,
  motoGeometry,
  riderGeometry,
  CAR_COLOURS,
  MOTO_COLOURS,
} from "./campus-props";
import { terrainHeight } from "./Landscape";
import { isOnScreen, useArea } from "./stage";
import type { Tier } from "./materials";

/**
 * Campus life on screen (P2-WLD-22; data and rules in world/campus-life.ts): ambient people on the plaza and the
 * district walks, and the traffic on Musanze Road. People use the same human models as the players (Avatar, distance
 * LOD, no name tag, never clickable); the traffic is three instanced meshes (cars, motorbikes + riders, minibuses)
 * drawn only while the road is in view. Everything follows the wall clock (identical on every screen); at night most
 * of the people go home (a fade), a few stay on the lit plaza.
 */
export function CampusLife({ tier }: { tier: Tier }) {
  if (!COMPOUND_LIFE_ON) return null;
  return (
    <group name="campus-life" userData={{ noMerge: true }}>
      <People tier={tier} />
      <RoadTraffic tier={tier} />
    </group>
  );
}

/** clock shared by every screen (s), offset so the loops are not all at their start at midnight */
const wallClock = () => (Date.now() / 1000) % 86400;

/** frame counter (one frustum per frame for all the people) */
let frameNo = 0;
function FrameCount() {
  useFrame(() => void frameNo++, -1);
  return null;
}

function People({ tier }: { tier: Tier }) {
  const npcs = useMemo(() => campusNpcs(), []);
  // phones keep fewer people around (each one is a skinned body)
  const list = tier === "lite" ? npcs.filter((_, i) => i % 2 === 0) : npcs;
  return (
    <>
      <FrameCount />
      {list.map((n) =>
        n.kind === "stroll" ? (
          <StrollPerson key={n.id} n={n} tier={tier} />
        ) : (
          <StandPerson
            key={n.id}
            n={n}
            tier={tier}
            partner={
              npcs.find((m) => m.kind === "stand" && m !== n && m.talks && n.talks) as Stander | undefined
            }
          />
        ),
      )}
    </>
  );
}

/** a route between two plaza points round the furniture; out on the campus the walks are straight and clear */
function routeBetween(a: { x: number; z: number }, b: { x: number; z: number }) {
  const inPlaza = Math.hypot(a.x, a.z) < PLAZA_RADIUS - 0.6 && Math.hypot(b.x, b.z) < PLAZA_RADIUS - 0.6;
  return inPlaza ? planRoute(a, b, plazaObstacles()) : [b];
}

/** fade in / out with the day (dayOnly people leave once the lamps are on), 0 … 1 */
const presence = (n: Npc) => (n.dayOnly ? 1 - Math.min(1, Math.max(0, (tod.look.lights - 0.3) / 0.5)) : 1);

function useLook(n: Npc) {
  return useMemo(() => ({ ...seededLook(`campus:${n.id}`, "#8a6a4a") }), [n.id]);
}

/** step aside (m) from the player walking into this person: a soft push, eased back when they have passed */
function avoid(x: number, z: number, off: THREE.Vector2, dt: number) {
  const dx = x + off.x - selfPose.x;
  const dz = z + off.y - selfPose.z;
  const d = Math.hypot(dx, dz);
  const want = d < 1.25 && d > 1e-3 ? (1.25 - d) / d : 0;
  const k = 1 - Math.exp(-dt * 4);
  off.x += ((want ? dx * want + off.x : 0) - off.x) * k * (want ? 0.5 : 0.6);
  off.y += ((want ? dz * want + off.y : 0) - off.y) * k * (want ? 0.5 : 0.6);
  off.clampLength(0, 0.9);
}

const turnTo = (cur: number, want: number, k: number) =>
  cur + (((want - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * k;

/**
 * Culling for an ambient person (the human meshes are not frustum-culled one by one: they follow animated bones).
 * Drawn only in view and within DRAW_M; casts a shadow only within SHADOW_M (each person is ~20 meshes: the shadow
 * pass doubles that). Re-checked a few times a second.
 */
const DRAW_M = { lite: 32, standard: 48 } as const;
const SHADOW_M = 16;
const _f = new THREE.Frustum();
const _pm = new THREE.Matrix4();
const _sph = new THREE.Sphere(new THREE.Vector3(), 1.3);
let _fFrame = -1;
function inView(camera: THREE.Camera, frame: number, x: number, z: number) {
  if (_fFrame !== frame) {
    _fFrame = frame;
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _f.setFromProjectionMatrix(_pm);
  }
  _sph.center.set(x, 0.9, z);
  return _f.intersectsSphere(_sph);
}
/** at most this many ambient people drawn at once (the nearest in view): each is ~20 draw calls */
const MAX_SHOWN = { lite: 3, standard: 6 } as const;
/** last frame's camera distance of every person in view (Infinity = not drawable) */
const dists = new Map<object, number>();
function cull(
  g: THREE.Group,
  camera: THREE.Camera,
  frame: number,
  tier: Tier,
  st: { shadow: boolean | null },
): boolean {
  const d = Math.hypot(camera.position.x - g.position.x, camera.position.z - g.position.z);
  const can = d < DRAW_M[tier] && camera.position.y < 30 && inView(camera, frame, g.position.x, g.position.z);
  dists.set(st, can ? d : Infinity);
  let nearer = 0;
  if (can) for (const [k, v] of dists) if (k !== st && v < d) nearer++;
  const show = can && nearer < MAX_SHOWN[tier];
  g.visible = show;
  const sh = show && tier !== "lite" && d < SHADOW_M;
  if (show && sh !== st.shadow) {
    st.shadow = sh;
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = sh;
    });
  }
  return show;
}

function StrollPerson({ n, tier }: { n: Stroller; tier: Tier }) {
  const look = useLook(n);
  const group = useRef<THREE.Group>(null);
  const anim = useRef(0);
  const fade = useRef(1);
  const sched = useRef<Schedule | null>(null);
  const pose = useRef<Pose>({ x: n.stops[0]!.x, z: n.stops[0]!.z, yaw: n.stops[0]!.yaw, moving: false });
  const off = useRef(new THREE.Vector2());
  const yaw = useRef(n.stops[0]!.yaw);
  const cs = useRef({ shadow: null as boolean | null });
  useEffect(() => {
    const k = cs.current;
    return () => void dists.delete(k);
  }, []);
  const area = useArea();
  useFrame(({ camera }, dt) => {
    const g = group.current;
    if (!g || !isOnScreen(area)) return;
    // routes are planned on first use (the plaza's obstacle list is complete by then)
    sched.current ??= schedule(n, routeBetween);
    const p = poseAt(sched.current, wallClock() + n.phase, pose.current);
    avoid(p.x, p.z, off.current, Math.min(dt, 0.1));
    const pr = presence(n);
    fade.current = pr;
    g.position.set(p.x + off.current.x, 0, p.z + off.current.y);
    if (pr < 0.02) dists.set(cs.current, Infinity);
    if (pr < 0.02 || !cull(g, camera, frameNo, tier, cs.current)) {
      g.visible = false;
      return;
    }
    yaw.current = turnTo(yaw.current, p.yaw, 1 - Math.exp(-Math.min(dt, 0.1) * (p.moving ? 7 : 3)));
    g.rotation.y = yaw.current;
    anim.current = p.moving ? 1 : 0;
  });
  return (
    <group ref={group} userData={{ noMerge: true, gkAmbient: true }}>
      <Avatar
        look={look}
        animRef={anim}
        showTag={false}
        lod
        shadows={tier !== "lite"}
        quality={tier}
        seedId={`campus:${n.id}`}
        fadeRef={fade}
      />
    </group>
  );
}

function StandPerson({ n, partner, tier }: { n: Stander; partner?: Stander; tier: Tier }) {
  const look = useLook(n);
  const group = useRef<THREE.Group>(null);
  const anim = useRef(0);
  const fade = useRef(1);
  const talk = useRef(false);
  const social = useRef({ listening: false, company: !!partner });
  const lookAt = useRef<THREE.Vector3 | null>(partner ? new THREE.Vector3(partner.x, 1.6, partner.z) : null);
  const area = useArea();
  const first = n.id.endsWith("-a");
  const cs = useRef({ shadow: null as boolean | null });
  useEffect(() => {
    const k = cs.current;
    return () => void dists.delete(k);
  }, []);
  useFrame(({ camera }) => {
    const g = group.current;
    if (!g || !isOnScreen(area)) return;
    const pr = presence(n);
    fade.current = pr;
    if (pr < 0.02) dists.set(cs.current, Infinity);
    if (pr < 0.02 || !cull(g, camera, frameNo, tier, cs.current)) {
      g.visible = false;
      return;
    }
    if (!n.talks) return;
    // turns in a conversation: 4–9 s each, alternating (a pure function of the clock)
    const t = wallClock();
    const turn = Math.floor(t / 6.5) + (Math.sin(Math.floor(t / 6.5) * 12.9898) > 0.3 ? 1 : 0);
    const mine = (turn % 2 === 0) === first;
    talk.current = mine;
    social.current.listening = !mine;
  });
  return (
    <group
      ref={group}
      position={[n.x, n.id === "bus-wait" ? 0.12 : 0, n.z]}
      rotation={[0, n.yaw, 0]}
      userData={{ noMerge: true, gkAmbient: true }}
    >
      <Avatar
        look={look}
        animRef={anim}
        showTag={false}
        lod
        shadows={tier !== "lite"}
        quality={tier}
        seedId={`campus:${n.id}`}
        fadeRef={fade}
        talkRef={talk}
        socialRef={social}
        lookAtRef={lookAt}
      />
    </group>
  );
}

/* ---------------------------------------------------------------- traffic ---------------------------------------------------------------- */

const ROAD_BOUNDS = new THREE.Box3(
  new THREE.Vector3(TRAFFIC_X.x0, -2, 84),
  new THREE.Vector3(TRAFFIC_X.x1, 5, 98),
);

function RoadTraffic({ tier }: { tier: Tier }) {
  const list = useMemo(() => vehicles().filter((_, i) => tier !== "lite" || i % 2 === 0), [tier]);
  const parts = useMemo(() => {
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
      m.frustumCulled = false;
      m.count = 0;
      m.castShadow = tier !== "lite";
      return m;
    };
    const paint = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.35,
      metalness: 0.35,
      envMapIntensity: 0.9,
    });
    const matte = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    const n = (k: string) => list.filter((v) => v.kind === k).length;
    return {
      car: mk(carGeometry(), paint, n("car")),
      bus: mk(minibusGeometry(), paint, n("bus")),
      moto: mk(motoGeometry(), paint, n("moto")),
      rider: mk(riderGeometry(), matte, n("moto")),
      mats: [paint, matte],
    };
  }, [list, tier]);
  useEffect(
    () => () => {
      for (const m of [parts.car, parts.bus, parts.moto, parts.rider]) {
        m.geometry.dispose();
        m.dispose();
      }
      parts.mats.forEach((m) => m.dispose());
    },
    [parts],
  );
  // per-vehicle colours (seeded)
  useEffect(() => {
    const c = new THREE.Color();
    const idx = { car: 0, bus: 0, moto: 0 };
    for (const v of list) {
      const i = idx[v.kind]++;
      if (v.kind === "moto") {
        parts.moto.setColorAt(i, c.set(MOTO_COLOURS[v.colour % MOTO_COLOURS.length]!));
        parts.rider.setColorAt(i, c.set(v.colour % 2 ? "#ffffff" : "#e6d9cf"));
      } else if (v.kind === "bus") parts.bus.setColorAt(i, c.set(v.colour % 3 ? "#f2f2ef" : "#d8d2c2"));
      else parts.car.setColorAt(i, c.set(CAR_COLOURS[v.colour % CAR_COLOURS.length]!));
    }
    for (const m of [parts.car, parts.bus, parts.moto, parts.rider])
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [list, parts]);
  const group = useRef<THREE.Group>(null);
  const frustum = useMemo(
    () => ({ f: new THREE.Frustum(), m: new THREE.Matrix4(), o: new THREE.Object3D() }),
    [],
  );
  const area = useArea();
  useFrame(({ camera }) => {
    const g = group.current;
    if (!g) return;
    frustum.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.f.setFromProjectionMatrix(frustum.m);
    g.visible = isOnScreen(area) && camera.position.y < 160 && frustum.f.intersectsBox(ROAD_BOUNDS);
    if (!g.visible) return;
    const t = wallClock();
    const o = frustum.o;
    const idx = { car: 0, bus: 0, moto: 0 };
    for (const v of list) {
      const x = vehicleX(v, t);
      const z = laneZ(v.dir);
      o.position.set(x, terrainHeight(x, z) + 0.02, z);
      o.rotation.set(0, v.dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      o.updateMatrix();
      const i = idx[v.kind]++;
      if (v.kind === "moto") {
        parts.moto.setMatrixAt(i, o.matrix);
        parts.rider.setMatrixAt(i, o.matrix);
      } else (v.kind === "bus" ? parts.bus : parts.car).setMatrixAt(i, o.matrix);
    }
    parts.car.count = idx.car;
    parts.bus.count = idx.bus;
    parts.moto.count = parts.rider.count = idx.moto;
    for (const m of [parts.car, parts.bus, parts.moto, parts.rider]) m.instanceMatrix.needsUpdate = true;
  });
  return (
    <group ref={group} name="road-traffic">
      <primitive object={parts.car} />
      <primitive object={parts.bus} />
      <primitive object={parts.moto} />
      <primitive object={parts.rider} />
    </group>
  );
}

"use client";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, Text } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { HallLayout, Table } from "./layouts";
import { GltfInstances, Instanced, model, type Xform } from "./interior-kit";
import { SouthWall } from "./shell";
import { imigongo } from "./room-textures";
import { PoolTables } from "./PoolHall";
import { LudoTables } from "./LudoLounge";
import { IgisoroTables } from "./IgisoroCourt";
import { isOnScreen, useArea } from "@/world/stage";
import { updateSeatWalk } from "@/arena/hooks"; // also registers the arena's hall hooks
import { bindArenaRealtime, fetchArenaStatus, useArena } from "@/arena/arena-client";
import { bowlSeat } from "@/arena/bowl";
import {
  BOWL_SEATS,
  COMMENTATORS,
  CONCESSIONS,
  CONCOURSE,
  FEATURE_TABLES,
  FLOOR_R,
  FLOOR_Y,
  KIOSK,
  LOBBY,
  LOWER,
  LOWER_AISLES,
  LOWER_BACK,
  OUTER_R,
  PLAYERS_TUNNEL_HW,
  PORTAL_HW,
  SECTIONS,
  STAGE,
  UPPER,
  UPPER_AISLES,
  UPPER_BACK,
  VIP,
  lowerTreadY,
  polar,
  upperTreadY,
} from "@/arena/bowl";
import { eventBoardTexture, floorTexture, paintEventBoard, paintScoreboard, ribbonTexture, scoreboardTexture } from "@/arena/textures";

/**
 * Tournament Arena interior (P2-ARN-03) — a modern indoor arena in the spirit of Kigali's great venues (patterned
 * shell, space-frame roof, LED ribbon rings), an original design with no real branding:
 *   lobby (ticket & info kiosk, event board, concessions, restrooms) → entry portal → concourse ring (cross-aisle)
 *   → lower bowl A–L (stairs down) / upper tier U1–U8 (stairs up) / VIP boxes V1–V4
 *   → competition floor: feature stage (Pool, Ludo, Igisoro tables from the halls), players' walk-in tunnel,
 *     commentator desk, 4-sided centre-hung scoreboard showing the current / next event.
 *
 * Eye comfort (no glare): every surface is matte (roughness ≥ 0.85, metalness 0, envMapIntensity ≤ 0.2), no bare
 * bright sources: the light is one soft overhead key + sky fill like broadcast arena lighting, screens and LED
 * ribbons are mid-bright and tone-mapped (below the bloom threshold).
 *
 * Performance: the bowl (treads, risers, aisle steps, walls, parapets) is ONE merged geometry per material; the
 * 1,224 seats are ONE InstancedMesh (per-instance colour); rails, nosings and the space frame are instanced.
 * About 100 draw calls in all, most of them the drei Text signs. Lite drops the roof diagonals and the shadows.
 */
const FONT = "/fonts/Baloo2.ttf";
const D2R = Math.PI / 180;
const LOBBY_H = 4.6;
const PORTAL_H = 3.4;
const ROOF_Y = 15.2;
const SHELL_TOP = 15.6;

/* ---------------- procedural bowl geometry ---------------- */

/** Accumulates quads into one non-indexed geometry (position, normal, uv). */
class Geo {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  quad(a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, c: THREE.Vector3Tuple, d: THREE.Vector3Tuple, n: THREE.Vector3Tuple, uv: [number, number, number, number] = [0, 0, 1, 1]) {
    const [u0, v0, u1, v1] = uv;
    for (const [p, t] of [
      [a, [u0, v0]],
      [b, [u1, v0]],
      [c, [u1, v1]],
      [a, [u0, v0]],
      [c, [u1, v1]],
      [d, [u0, v1]],
    ] as const) {
      this.pos.push(...p);
      this.nor.push(...n);
      this.uv.push(...t);
    }
  }
  /** flat ring sector at height y (normal up / down) */
  top(r0: number, r1: number, a0: number, a1: number, y: number, down = false, uvScale = 1) {
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 3));
    for (let i = 0; i < n; i++) {
      const b0 = a0 + ((a1 - a0) * i) / n;
      const b1 = a0 + ((a1 - a0) * (i + 1)) / n;
      const p = (r: number, a: number): THREE.Vector3Tuple => [r * Math.sin(a * D2R), y, r * Math.cos(a * D2R)];
      const u0 = (b0 * D2R * r1) / uvScale;
      const u1 = (b1 * D2R * r1) / uvScale;
      if (down) this.quad(p(r0, b0), p(r1, b0), p(r1, b1), p(r0, b1), [0, -1, 0], [u0, r0 / uvScale, u1, r1 / uvScale]);
      else this.quad(p(r0, b0), p(r0, b1), p(r1, b1), p(r1, b0), [0, 1, 0], [u0, r0 / uvScale, u1, r1 / uvScale]);
    }
  }
  /** vertical cylindrical strip at radius r, facing the centre (`inward`) or away from it */
  wall(r: number, a0: number, a1: number, y0: number, y1: number, inward = true, uvScale = 1, ring = false) {
    if (y1 - y0 < 1e-4) return;
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 3));
    for (let i = 0; i < n; i++) {
      const b0 = a0 + ((a1 - a0) * i) / n;
      const b1 = a0 + ((a1 - a0) * (i + 1)) / n;
      const bm = ((b0 + b1) / 2) * D2R;
      const s = inward ? -1 : 1;
      const nn: THREE.Vector3Tuple = [s * Math.sin(bm), 0, s * Math.cos(bm)];
      const p = (a: number, y: number): THREE.Vector3Tuple => [r * Math.sin(a * D2R), y, r * Math.cos(a * D2R)];
      // ring: u = the angle around the ring (one turn = 0…1), v = 0…1 over the height (LED ribbons)
      // (inward faces run against the angle, so text reads left-to-right from inside the ring)
      const u0 = ring ? (inward ? -b0 : b0) / 360 : (b0 * D2R * r) / uvScale;
      const u1 = ring ? (inward ? -b1 : b1) / 360 : (b1 * D2R * r) / uvScale;
      const v0 = ring ? 0 : y0 / uvScale;
      const v1 = ring ? 1 : y1 / uvScale;
      if (inward) this.quad(p(b1, y0), p(b0, y0), p(b0, y1), p(b1, y1), nn, [u1, v0, u0, v1]);
      else this.quad(p(b0, y0), p(b1, y0), p(b1, y1), p(b0, y1), nn, [u0, v0, u1, v1]);
    }
  }
  /** radial wall (a side wall of a box / tunnel) at angle a, facing towards +angle (`ccw`) or −angle */
  radial(a: number, r0: number, r1: number, y0: number, y1: number, ccw: boolean) {
    const ar = a * D2R;
    const n: THREE.Vector3Tuple = ccw ? [Math.cos(ar), 0, -Math.sin(ar)] : [-Math.cos(ar), 0, Math.sin(ar)];
    const p = (r: number, y: number): THREE.Vector3Tuple => [r * Math.sin(ar), y, r * Math.cos(ar)];
    if (ccw) this.quad(p(r1, y0), p(r0, y0), p(r0, y1), p(r1, y1), n, [r1, y0, r0, y1]);
    else this.quad(p(r0, y0), p(r1, y0), p(r1, y1), p(r0, y1), n, [r0, y0, r1, y1]);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

/** arcs (deg) where the lower rows run: everything except the players' tunnel gap */
const LOWER_SPAN: [number, number] = [190, 530];
const UPPER_SPANS: [number, number][] = [
  [18, 70],
  [110, 162],
  [198, 250],
  [290, 342],
];
const VIP_SECTIONS = SECTIONS.filter((s) => s.tier === "vip");
/** angular half width (deg) of an aisle opening of `m` metres (lateral) at radius r */
const halfDeg = (m: number, r: number) => (m / r) / D2R;
/** split [a0, a1] at the given openings (centre angle, half width deg) */
function cut(a0: number, a1: number, holes: [number, number][]) {
  const out: [number, number][] = [];
  let s = a0;
  const hs = holes
    .map(([c, h]) => {
      let cc = c;
      while (cc < a0 - h) cc += 360;
      return [cc - h, cc + h] as [number, number];
    })
    .filter(([x0, x1]) => x1 > a0 && x0 < a1)
    .sort((a, b) => a[0] - b[0]);
  for (const [x0, x1] of hs) {
    if (x0 > s) out.push([s, x0]);
    s = Math.max(s, x1);
  }
  if (s < a1) out.push([s, a1]);
  return out;
}

function buildBowl() {
  const concrete = new Geo(); // treads, risers, cheek walls
  const finish = new Geo(); // concourse + lobby side of the bowl, parapets (lighter render)
  const shell = new Geo(); // inner face of the outer wall (Imigongo shell)
  const dark = new Geo(); // soffits, box roofs, gantry
  const frost = new Geo(); // VIP frosted fronts
  const warm = new Geo(); // VIP interiors

  // lower bowl: treads + risers, front barrier
  const y1 = lowerTreadY(1);
  for (let i = 1; i <= LOWER.rows; i++) {
    const r0 = LOWER.front + LOWER.depth * (i - 1);
    const r1 = r0 + LOWER.depth;
    const y = lowerTreadY(i);
    concrete.top(r0, r1, LOWER_SPAN[0], LOWER_SPAN[1], y, false, 4);
    concrete.wall(r0, LOWER_SPAN[0], LOWER_SPAN[1], i === 1 ? FLOOR_Y : lowerTreadY(i - 1), y, true, 4);
    // aisle half-steps (two steps per row in the stair aisles)
    for (const a of LOWER_AISLES) {
      const h = halfDeg(0.55, r0);
      const yy = y + (LOWER.depth * LOWER.slope) / 2;
      if (i < LOWER.rows) {
        concrete.top(r0 + LOWER.depth / 2, r1, a - h, a + h, yy);
        concrete.wall(r0 + LOWER.depth / 2, a - h, a + h, y, yy);
      }
    }
  }
  concrete.wall(LOWER_BACK, LOWER_SPAN[0], LOWER_SPAN[1], lowerTreadY(LOWER.rows), 0);
  // the front barrier (padded wall round the floor) + its cap
  finish.wall(FLOOR_R, LOWER_SPAN[0], LOWER_SPAN[1], FLOOR_Y, y1 + 0.95, true, 4);
  finish.top(FLOOR_R, LOWER.front, LOWER_SPAN[0], LOWER_SPAN[1], y1 + 0.95);
  finish.wall(LOWER.front, LOWER_SPAN[0], LOWER_SPAN[1], y1, y1 + 0.95, false, 4);
  // players' tunnel: cheek walls either side of the stair, closing the gap to the row ends
  for (const s of [-1, 1]) {
    const aEdge = s < 0 ? 190 : 170;
    concrete.top(FLOOR_R, CONCOURSE.r0, Math.min(aEdge, aEdge + s * 4), Math.max(aEdge, aEdge + s * 4), 0.9);
    concrete.radial(aEdge, FLOOR_R, CONCOURSE.r0, FLOOR_Y, 0.9, s > 0);
  }
  // concourse ring (y = 0) and the VIP fore-court
  finish.top(CONCOURSE.r0 - 0.03, CONCOURSE.r1, 0, 360, 0, false, 2);
  for (const v of VIP_SECTIONS) finish.top(CONCOURSE.r1, VIP.front, v.a0, v.a1, 0, false, 2);
  // south gap: the portal blocks either side of the entry portal; north gap: the media gantry
  for (const [a0, a1] of [
    [342, 351],
    [9, 18],
  ] as [number, number][]) {
    finish.top(CONCOURSE.r1, OUTER_R, a0, a1, PORTAL_H);
    finish.wall(CONCOURSE.r1, a0, a1, 0, PORTAL_H, true, 2);
  }
  finish.top(CONCOURSE.r1, OUTER_R + 0.7, -9, 9, 0, false, 2); // portal floor
  finish.top(CONCOURSE.r1, OUTER_R, -9, 9, PORTAL_H + 1.0); // lintel over the portal
  finish.wall(CONCOURSE.r1, -9, 9, PORTAL_H, PORTAL_H + 1.0, true, 2);
  dark.top(CONCOURSE.r1, OUTER_R, -9, 9, PORTAL_H, true); // portal soffit
  dark.top(CONCOURSE.r1, OUTER_R, 162, 198, 1.6);
  dark.wall(CONCOURSE.r1, 162, 198, 0, 1.6, true);

  // upper tier: treads + risers in the four upper arcs, the parapet at the concourse (openings at the aisles)
  for (const [a0, a1] of UPPER_SPANS) {
    for (let j = 1; j <= UPPER.rows; j++) {
      const r0 = UPPER.r0 + UPPER.depth * (j - 1);
      const r1 = j === UPPER.rows ? OUTER_R : r0 + UPPER.depth;
      const y = upperTreadY(j);
      concrete.top(r0, r1, a0, a1, y, false, 4);
      concrete.wall(r0, a0, a1, j === 1 ? 0 : upperTreadY(j - 1), y, true, 4);
      for (const a of UPPER_AISLES) {
        if (a < a0 - 0.1 || a > a1 + 0.1 || j === UPPER.rows) continue;
        const h = halfDeg(0.6, r0);
        const yy = y + (UPPER.depth * UPPER.slope) / 2;
        concrete.top(r0 + UPPER.depth / 2, r1, Math.max(a0, a - h), Math.min(a1, a + h), yy);
        concrete.wall(r0 + UPPER.depth / 2, Math.max(a0, a - h), Math.min(a1, a + h), y, yy);
      }
    }
    // parapet (concourse side) with openings at the stair aisles
    const holes = UPPER_AISLES.map((a) => [a, halfDeg(0.62, CONCOURSE.r1)] as [number, number]);
    for (const [b0, b1] of cut(a0, a1, holes)) {
      finish.wall(CONCOURSE.r1, b0, b1, 0, 1.05, true, 2);
      finish.top(CONCOURSE.r1, CONCOURSE.r1 + 0.15, b0, b1, 1.05);
      finish.wall(CONCOURSE.r1 + 0.15, b0, b1, upperTreadY(1), 1.05, false, 2);
    }
    // side walls where an upper arc meets a gap (portal blocks, gantry) or a VIP box
    finish.radial(a0, CONCOURSE.r1, OUTER_R, 0, upperTreadY(UPPER.rows) + 1.0, false);
    finish.radial(a1, CONCOURSE.r1, OUTER_R, 0, upperTreadY(UPPER.rows) + 1.0, true);
  }
  // VIP boxes: raised floor, frosted front with its stair opening, side walls, roof slab, warm back panel
  for (const v of VIP_SECTIONS) {
    const sa = v.a0 + VIP.stairOff;
    const hole = halfDeg(0.5, VIP.front);
    finish.top(VIP.front, OUTER_R, v.a0, v.a1, VIP.floorY, false, 2);
    finish.wall(VIP.front, v.a0, v.a1, 0, VIP.floorY, true, 2);
    for (const [b0, b1] of cut(v.a0, v.a1, [[sa, hole]])) {
      frost.wall(VIP.front, b0, b1, VIP.floorY, VIP.floorY + 1.05, true);
      frost.wall(VIP.front + 0.06, b0, b1, VIP.floorY, VIP.floorY + 1.05, false);
    }
    // the stair up from the fore-court: four steps
    for (let k = 1; k <= 4; k++) {
      const r = CONCOURSE.r1 + ((VIP.front - CONCOURSE.r1) * (k - 1)) / 4;
      const y = (VIP.floorY * k) / 4;
      concrete.top(r, VIP.front, sa - hole, sa + hole, y);
      concrete.wall(r, sa - hole, sa + hole, y - VIP.floorY / 4, y);
    }
    for (const [a, ccw] of [
      [v.a0, true],
      [v.a1, false],
    ] as [number, boolean][]) {
      warm.radial(a, VIP.front, OUTER_R, VIP.floorY, VIP.floorY + 3.0, ccw);
      finish.radial(a, VIP.front, OUTER_R, VIP.floorY, VIP.floorY + 3.0, !ccw);
    }
    dark.top(VIP.front - 0.4, OUTER_R, v.a0, v.a1, VIP.floorY + 3.0, true);
    finish.top(VIP.front - 0.4, OUTER_R, v.a0, v.a1, VIP.floorY + 3.15);
    finish.wall(VIP.front - 0.4, v.a0, v.a1, VIP.floorY + 3.0, VIP.floorY + 3.15, true);
    warm.wall(OUTER_R - 0.05, v.a0, v.a1, VIP.floorY, VIP.floorY + 3.0, true, 2);
  }
  // the shell (inner face of the outer wall): all round above the portal, beside it below
  shell.wall(OUTER_R, 7, 353, 0, SHELL_TOP, true, 6);
  shell.wall(OUTER_R, -7, 7, PORTAL_H + 1.0, SHELL_TOP, true, 6);
  // lobby face of the drum (outside the bowl): beside the portal and above it, up to the lobby ceiling
  const lobbyA = Math.asin(LOBBY.hw / OUTER_R) / D2R;
  // (the Imigongo-patterned shell continues outside: the lobby sees the drum as a patterned wall)
  for (const [a0, a1] of [
    [-lobbyA, -7],
    [7, lobbyA],
  ] as [number, number][])
    shell.wall(OUTER_R + 0.02, a0, a1, 0, LOBBY_H, false, 6);
  shell.wall(OUTER_R + 0.02, -7, 7, PORTAL_H + 1.0, LOBBY_H, false, 6);
  // portal side walls (straight, |x| = PORTAL_HW)
  return {
    concrete: concrete.build(),
    finish: finish.build(),
    shell: shell.build(),
    dark: dark.build(),
    frost: frost.build(),
    warm: warm.build(),
  };
}

/** The lobby floor / ceiling: the rectangle between the drum and the entrance wall. */
function lobbyShape() {
  const zc = Math.sqrt(OUTER_R * OUTER_R - LOBBY.hw * LOBBY.hw);
  const s = new THREE.Shape();
  s.moveTo(-LOBBY.hw, LOBBY.z1);
  s.lineTo(LOBBY.hw, LOBBY.z1);
  s.lineTo(LOBBY.hw, zc);
  const a = Math.atan2(zc, LOBBY.hw);
  s.absarc(0, 0, OUTER_R, a, Math.PI - a, false);
  s.lineTo(-LOBBY.hw, LOBBY.z1);
  // shape is in (x, y) = (x, z); rotate so +y becomes +z
  const g = new THREE.ShapeGeometry(s, 24);
  g.rotateX(Math.PI / 2);
  return g;
}

/** one bowl seat (pan + back + pedestal), local +z = facing the floor */
function seatGeometry() {
  const parts = [
    new THREE.BoxGeometry(0.44, 0.06, 0.4).translate(0, 0.43, -0.04),
    new THREE.BoxGeometry(0.44, 0.46, 0.05).rotateX(-0.12).translate(0, 0.72, -0.25),
    new THREE.BoxGeometry(0.1, 0.4, 0.12).translate(0, 0.2, -0.12),
  ];
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
}

/** members (tubes) between two points as instanced unit cylinders */
const _up = new THREE.Vector3(0, 1, 0);
function member(a: THREE.Vector3, b: THREE.Vector3, r: number, out: THREE.Matrix4[]) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(_up, d.normalize());
  out.push(new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(r, len, r)));
}
function MatrixInstances({ geometry, matrices, children, castShadow = false }: { geometry: THREE.BufferGeometry; matrices: THREE.Matrix4[]; children: React.ReactNode; castShadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const im = ref.current;
    if (!im) return;
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, [matrices]);
  if (!matrices.length) return null;
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, matrices.length]} castShadow={castShadow} receiveShadow={false}>
      {children}
    </instancedMesh>
  );
}

/** deterministic 0…1 hash (no Math.random in game code) */
const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/* ---------------- matte materials ---------------- */

function useMats() {
  const shellTex = useMemo(() => imigongo([2, 2], "#2b2733", "#6e4f8f", "#d9d2c6"), []);
  return useMemo(() => {
    const m = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, envMapIntensity: 0.12, ...extra });
    return {
      concrete: m("#7b7877", { side: THREE.DoubleSide }),
      finish: m("#b9b3aa", { side: THREE.DoubleSide }),
      shell: m("#ffffff", { map: shellTex, roughness: 0.95 }),
      dark: m("#2a282e", { side: THREE.DoubleSide, roughness: 1 }),
      frost: m("#d9dde0", { roughness: 1, side: THREE.DoubleSide }),
      warm: m("#7a5a40", { side: THREE.DoubleSide }),
      rail: m("#3a3a40", { roughness: 0.85 }),
      nosing: m("#b08b3e", { roughness: 0.95 }),
      seat: m("#ffffff", { roughness: 0.88 }),
      frame: m("#4a4752", { roughness: 0.9 }),
    };
  }, [shellTex]);
}

/* ---------------- the interior ---------------- */

export function TournamentArena({ layout, lite }: { layout: HallLayout; lite: boolean }) {
  const bowl = useMemo(() => buildBowl(), []);
  useEffect(() => () => Object.values(bowl).forEach((g) => g.dispose()), [bowl]);
  const M = useMats();
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const cyl = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, lite ? 5 : 7), [lite]);
  const seatGeo = useMemo(() => seatGeometry(), []);
  const lobby = useMemo(() => lobbyShape(), []);
  const scene = useThree((s) => s.scene);
  const area = useArea();

  // the arena is enclosed: a deep neutral background behind any gap (the plaza's sky shows through the door only)
  useLayoutEffect(() => {
    if (!scene.background) scene.background = new THREE.Color("#141218");
  }, [scene]);
  useEffect(() => {
    bindArenaRealtime();
    void fetchArenaStatus();
  }, []);

  /* --- seats: one instanced mesh, colour per section tier with a calm deterministic tone variation --- */
  const seats = useMemo(() => {
    const items: Xform[] = BOWL_SEATS.map((s) => ({ p: [s.x, s.y, s.z], r: s.yaw, s: s.table.startsWith("V") ? [1.25, 1.05, 1.15] : 1 }));
    const colors = BOWL_SEATS.map((s, i) => {
      const k = hash(i) * 0.06;
      const base = s.table.startsWith("V") ? new THREE.Color("#7c5a3a") : s.table.startsWith("U") ? new THREE.Color("#3f4670") : new THREE.Color("#55407c");
      return `#${base.offsetHSL(0, 0, k - 0.03).getHexString()}`;
    });
    return { items, colors };
  }, []);

  /* --- rails, nosings, lights: instanced --- */
  const X = useMemo(() => {
    const nosings: Xform[] = [];
    for (const a of LOWER_AISLES)
      for (let i = 1; i <= LOWER.rows; i++) {
        const r0 = LOWER.front + LOWER.depth * (i - 1);
        for (const [rr, y] of [
          [r0 + 0.03, lowerTreadY(i)],
          [r0 + LOWER.depth / 2 + 0.03, lowerTreadY(i) + (LOWER.depth * LOWER.slope) / 2],
        ] as [number, number][]) {
          if (i === LOWER.rows && rr > r0 + 0.1) continue;
          const p = polar(rr, a);
          nosings.push({ p: [p.x, y + 0.006, p.z], r: a * D2R, s: [1.0, 0.012, 0.06] });
        }
      }
    for (const a of UPPER_AISLES)
      for (let j = 1; j < UPPER.rows; j++) {
        const r0 = UPPER.r0 + UPPER.depth * (j - 1);
        for (const [rr, y] of [
          [r0 + 0.18, upperTreadY(j)],
          [r0 + UPPER.depth / 2 + 0.03, upperTreadY(j) + (UPPER.depth * UPPER.slope) / 2],
        ] as [number, number][]) {
          const p = polar(rr, a);
          nosings.push({ p: [p.x, y + 0.006, p.z], r: a * D2R, s: [1.1, 0.012, 0.06] });
        }
      }
    // centre handrails down every stair aisle (lower + upper), concourse rail posts and top rail
    const rails: THREE.Matrix4[] = [];
    const v = (r: number, a: number, y: number) => {
      const p = polar(r, a);
      return new THREE.Vector3(p.x, y, p.z);
    };
    // (the rail runs along one side of the aisle, 0.45 m off its centre line: the walking line stays clear)
    const lowY = (r: number) => (r - LOWER_BACK) * LOWER.slope;
    const upY = (r: number) => (r - UPPER.r0) * UPPER.slope;
    for (const a of LOWER_AISLES) {
      const r0 = LOWER.front + 0.4;
      const r1 = LOWER_BACK - 0.2;
      const at = (r: number) => a + halfDeg(0.45, r);
      member(v(r0, at(r0), lowY(r0) + 0.95), v(r1, at(r1), lowY(r1) + 0.95), 0.025, rails);
      for (const r of [r0, (r0 + r1) / 2, r1]) member(v(r, at(r), lowY(r)), v(r, at(r), lowY(r) + 0.95), 0.022, rails);
    }
    for (const a of UPPER_AISLES) {
      const r0 = UPPER.r0 + 0.3;
      const r1 = UPPER_BACK - 0.3;
      const at = (r: number) => a + halfDeg(0.48, r);
      member(v(r0, at(r0), upY(r0) + 0.95), v(r1, at(r1), upY(r1) + 0.95), 0.025, rails);
      for (const r of [r0, r1]) member(v(r, at(r), upY(r)), v(r, at(r), upY(r) + 0.95), 0.022, rails);
    }
    // concourse inner rail (top of the lower bowl): posts + top rail, open at the aisles and the players' tunnel
    const holes: [number, number][] = [...LOWER_AISLES.map((a) => [a, halfDeg(0.6, CONCOURSE.r0)] as [number, number]), [180, 6.2]];
    for (const [b0, b1] of cut(0, 360, holes)) {
      const n = Math.max(1, Math.round(((b1 - b0) * D2R * CONCOURSE.r0) / 2.2));
      for (let k = 0; k <= n; k++) {
        const a = b0 + ((b1 - b0) * k) / n;
        member(v(CONCOURSE.r0 + 0.05, a, 0), v(CONCOURSE.r0 + 0.05, a, 1.05), 0.03, rails);
        if (k < n) {
          const a2 = b0 + ((b1 - b0) * (k + 1)) / n;
          member(v(CONCOURSE.r0 + 0.05, a, 1.05), v(CONCOURSE.r0 + 0.05, a2, 1.05), 0.035, rails);
          member(v(CONCOURSE.r0 + 0.05, a, 0.55), v(CONCOURSE.r0 + 0.05, a2, 0.55), 0.018, rails);
        }
      }
    }
    // players' tunnel stair: handrails both sides
    for (const s of [-1, 1]) member(new THREE.Vector3(s * (PLAYERS_TUNNEL_HW - 0.05), 0.95, -CONCOURSE.r0), new THREE.Vector3(s * (PLAYERS_TUNNEL_HW - 0.05), FLOOR_Y + 0.95, -FLOOR_R), 0.03, rails);
    // tunnel stair treads
    const steps: Xform[] = [];
    const N = 12;
    for (let k = 0; k < N; k++) {
      const z0 = -CONCOURSE.r0 + ((CONCOURSE.r0 - FLOOR_R) * (k + 0.5)) / N;
      const y = -(-FLOOR_Y * (k + 1)) / N;
      steps.push({ p: [0, (y + FLOOR_Y) / 2, z0], s: [PLAYERS_TUNNEL_HW * 2, y - FLOOR_Y, (CONCOURSE.r0 - FLOOR_R) / N + 0.01] });
    }
    // cheek walls of the players' tunnel
    const cheeks: Xform[] = [-1, 1].map((s) => ({ p: [s * (PLAYERS_TUNNEL_HW + 0.5), (FLOOR_Y + 0.9) / 2, -(FLOOR_R + CONCOURSE.r0) / 2], s: [1.0, 0.9 - FLOOR_Y, CONCOURSE.r0 - FLOOR_R] }));
    // portal side walls (lobby → concourse)
    const portal: Xform[] = [-1, 1].map((s) => ({ p: [s * (PORTAL_HW + 0.5), PORTAL_H / 2, (CONCOURSE.r1 + OUTER_R) / 2 + 0.2], s: [1.0, PORTAL_H, OUTER_R - CONCOURSE.r1 + 0.6] }));
    return { nosings, rails, steps, cheeks, portal };
  }, []);

  /* --- space-frame roof --- */
  const roof = useMemo(() => {
    const top: THREE.Matrix4[] = [];
    const diag: THREE.Matrix4[] = [];
    const S = 3.2;
    const R = OUTER_R + 0.4;
    const yT = ROOF_Y + 1.4;
    const yB = ROOF_Y;
    const inside = (x: number, z: number) => Math.hypot(x, z) < R;
    const n = Math.ceil(R / S);
    for (let i = -n; i <= n; i++)
      for (let j = -n; j <= n; j++) {
        const x = i * S;
        const z = j * S;
        if (inside(x, z)) {
          if (inside(x + S, z)) member(new THREE.Vector3(x, yT, z), new THREE.Vector3(x + S, yT, z), 0.05, top);
          if (inside(x, z + S)) member(new THREE.Vector3(x, yT, z), new THREE.Vector3(x, yT, z + S), 0.05, top);
        }
        const bx = x + S / 2;
        const bz = z + S / 2;
        if (!inside(bx, bz)) continue;
        if (inside(bx + S, bz)) member(new THREE.Vector3(bx, yB, bz), new THREE.Vector3(bx + S, yB, bz), 0.06, top);
        if (inside(bx, bz + S)) member(new THREE.Vector3(bx, yB, bz), new THREE.Vector3(bx, yB, bz + S), 0.06, top);
        if (!lite)
          for (const [dx, dz] of [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ] as [number, number][])
            if (inside(bx + (dx * S) / 2, bz + (dz * S) / 2)) member(new THREE.Vector3(bx, yB, bz), new THREE.Vector3(bx + (dx * S) / 2, yT, bz + (dz * S) / 2), 0.035, diag);
      }
    return { top, diag };
  }, [lite]);

  /* --- LED ribbons, floor, scoreboard, event board --- */
  const ribbons = useMemo(() => {
    const words = ["TOURNAMENT ARENA", "PLAY · MEET · WIN", "GUKIRANA PLAYGROUND", "MUSANZE", "POOL · LUDO · IGISORO", "FAIR PLAY"];
    return {
      lower: ribbonTexture(words, "#33284f"),
      upper: ribbonTexture([...words].reverse(), "#2c2a52"),
      high: ribbonTexture(words.map(() => ""), "#3a2c5c"),
    };
  }, []);
  useEffect(() => {
    ribbons.lower.repeat.set(4, 1);
    ribbons.upper.repeat.set(5, 1);
    ribbons.high.repeat.set(6, 1);
  }, [ribbons]);
  const ribbonGeo = useMemo(() => {
    const g = (r: number, y0: number, y1: number, spans: [number, number][]) => {
      const geo = new Geo();
      for (const [a0, a1] of spans) geo.wall(r, a0, a1, y0, y1, true, 1, true);
      return geo.build();
    };
    const upperHoles = UPPER_AISLES.map((a) => [a, halfDeg(0.62, CONCOURSE.r1)] as [number, number]);
    return {
      lower: g(FLOOR_R - 0.02, FLOOR_Y + 0.35, FLOOR_Y + 1.05, [[LOWER_SPAN[0], 360], [0, LOWER_SPAN[1] - 360]]),
      upper: g(CONCOURSE.r1 - 0.02, 0.3, 0.85, UPPER_SPANS.flatMap(([a0, a1]) => cut(a0, a1, upperHoles))),
      high: g(OUTER_R - 0.05, 12.6, 12.95, [[0, 360]]),
    };
  }, []);
  const floorTex = useMemo(() => floorTexture(), []);
  const board = useMemo(() => scoreboardTexture(), []);
  const lobbyBoard = useMemo(() => eventBoardTexture(), []);
  const status = useArena((s) => s.status);
  useEffect(() => {
    paintScoreboard(board.g, status);
    board.texture.needsUpdate = true;
    paintEventBoard(lobbyBoard.g, status);
    lobbyBoard.texture.needsUpdate = true;
  }, [status, board, lobbyBoard]);
  useFrame((_, dt) => {
    if (!isOnScreen(area)) return;
    // the ribbons drift slowly (a calm crawl, never a flicker)
    ribbons.lower.offset.x = (ribbons.lower.offset.x + dt * 0.004) % 1;
    ribbons.upper.offset.x = (ribbons.upper.offset.x - dt * 0.003) % 1;
    updateSeatWalk();
  });

  /* --- feature tables (the halls' own table models) --- */
  const feature = useMemo(() => {
    const t = (id: string, v: { x: number; z: number; w: number; d: number; h: number }): Table => ({ id, ...v });
    const igi = t("t0", FEATURE_TABLES.igisoro);
    const igiLayout = { ...layout, tables: [igi], seats: [-1, 1].map((s, i) => ({ id: `t0s${i}`, table: "t0", x: igi.x, z: igi.z + s * 1.18, yaw: s > 0 ? Math.PI : 0 })) } as HallLayout;
    return { pool: [t("t0", FEATURE_TABLES.pool)], ludo: [t("t0", FEATURE_TABLES.ludo)], igiLayout };
  }, [layout]);

  const cables = useMemo(() => {
    const out: THREE.Matrix4[] = [];
    for (const [x, z] of [
      [-3, -3],
      [3, -3],
      [3, 3],
      [-3, 3],
    ] as [number, number][])
      member(new THREE.Vector3(x, 1.75, z), new THREE.Vector3(x * 0.6, ROOF_Y - (FLOOR_Y + 12.4), z * 0.6), 0.015, out);
    return out;
  }, []);
  const lobbyLights: Xform[] = useMemo(() => [-9, -4.5, 0, 4.5, 9].map((x) => ({ p: [x, LOBBY_H - 0.03, 30.5], s: [0.08, 0.02, 6.5] }) as Xform), []);
  const southLayout = useMemo(() => ({ ...layout, size: { ...layout.size, w: LOBBY.hw * 2 + 0.6, h: LOBBY_H } }), [layout]);
  const plaster = <meshStandardMaterial color="#cfc8bd" roughness={0.95} metalness={0} envMapIntensity={0.1} />;

  const signs = useMemo(
    () =>
      SECTIONS.map((s) => {
        const mid = (s.a0 + s.a1) / 2;
        if (s.tier === "lower") {
          const p = polar(CONCOURSE.r0 + 0.12, mid);
          return { id: s.id, x: p.x, y: 1.55, z: p.z, ry: mid * D2R, size: 0.42 };
        }
        if (s.tier === "upper") {
          const p = polar(CONCOURSE.r1 - 0.04, mid);
          return { id: s.id, x: p.x, y: 1.5, z: p.z, ry: mid * D2R + Math.PI, size: 0.4 };
        }
        const p = polar(VIP.front - 0.04, mid);
        return { id: s.id, x: p.x, y: VIP.floorY + 2.55, z: p.z, ry: mid * D2R + Math.PI, size: 0.3 };
      }),
    [],
  );

  return (
    <group>
      {/* -------- lighting: soft overhead key (broadcast-even on the floor), sky fill; no hot spots -------- */}
      {!lite && (
        <Environment resolution={32} frames={1} environmentIntensity={0.35}>
          <Lightformer intensity={1.0} position={[0, ROOF_Y, 0]} rotation-x={Math.PI / 2} scale={[40, 40, 1]} color="#f4eefc" />
          <Lightformer intensity={0.4} position={[0, 1, 0]} rotation-x={-Math.PI / 2} scale={[40, 40, 1]} color="#6a6270" />
        </Environment>
      )}
      <hemisphereLight args={["#f2eefa", "#4c4652", lite ? 1.5 : 1.15]} />
      <ambientLight intensity={lite ? 0.35 : 0.22} />
      <directionalLight
        position={[2, 30, 6]}
        intensity={lite ? 1.0 : 1.15}
        color="#fff4e8"
        castShadow={!lite}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-13}
        shadow-camera-right={13}
        shadow-camera-top={13}
        shadow-camera-bottom={-13}
        shadow-camera-near={20}
        shadow-camera-far={40}
        shadow-bias={-0.0005}
        shadow-normalBias={0.04}
        shadow-radius={4}
      />
      {/* a gentle warm fill from the lobby side (the entrance glazing) */}
      <directionalLight position={[0, 8, 40]} intensity={0.25} color="#f5ead8" />

      {/* -------- bowl -------- */}
      <mesh geometry={bowl.concrete} material={M.concrete} receiveShadow={!lite} />
      <mesh geometry={bowl.finish} material={M.finish} receiveShadow={!lite} />
      <mesh geometry={bowl.shell} material={M.shell} />
      <mesh geometry={bowl.dark} material={M.dark} />
      <mesh geometry={bowl.frost} material={M.frost} />
      <mesh geometry={bowl.warm} material={M.warm} />
      <Instanced geometry={seatGeo} items={seats.items} colors={seats.colors} receiveShadow={false}>
        <primitive object={M.seat} attach="material" />
      </Instanced>
      <Instanced geometry={box} items={X.nosings} receiveShadow={false}>
        <primitive object={M.nosing} attach="material" />
      </Instanced>
      <MatrixInstances geometry={cyl} matrices={X.rails}>
        <primitive object={M.rail} attach="material" />
      </MatrixInstances>
      <Instanced geometry={box} items={[...X.steps, ...X.cheeks, ...X.portal]}>
        <primitive object={M.concrete} attach="material" />
      </Instanced>

      {/* LED ribbon rings: barrier band, upper fascia, a slim high ring on the shell (mid-bright, tone-mapped) */}
      <mesh geometry={ribbonGeo.lower}>
        <meshBasicMaterial map={ribbons.lower} color="#b8b0c8" />
      </mesh>
      <mesh geometry={ribbonGeo.upper}>
        <meshBasicMaterial map={ribbons.upper} color="#b8b0c8" />
      </mesh>
      <mesh geometry={ribbonGeo.high}>
        <meshBasicMaterial map={ribbons.high} color="#9c8cc0" />
      </mesh>

      {/* -------- competition floor, stage, walk-in path, commentators -------- */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} receiveShadow={!lite}>
        <circleGeometry args={[FLOOR_R + 0.05, lite ? 48 : 96]} />
        <meshStandardMaterial map={floorTex} roughness={0.95} metalness={0} envMapIntensity={0.1} />
      </mesh>
      <mesh position={[0, FLOOR_Y + STAGE.h / 2, STAGE.z]} castShadow={!lite} receiveShadow={!lite}>
        <boxGeometry args={[STAGE.hw * 2, STAGE.h, STAGE.hd * 2]} />
        <meshStandardMaterial color="#25222b" roughness={0.95} metalness={0} envMapIntensity={0.1} />
      </mesh>
      {/* stage edge: a low lit fascia in the arena's purple (soft, below the bloom threshold) */}
      {[
        [0, STAGE.z + STAGE.hd + 0.005, STAGE.hw * 2, 0],
        [0, STAGE.z - STAGE.hd - 0.005, STAGE.hw * 2, Math.PI],
      ].map(([x, z, w, ry], i) => (
        <mesh key={i} position={[x!, FLOOR_Y + STAGE.h / 2, z!]} rotation={[0, ry!, 0]}>
          <planeGeometry args={[w!, STAGE.h * 0.5]} />
          <meshBasicMaterial color="#5b4486" />
        </mesh>
      ))}
      <group position={[0, FLOOR_Y + STAGE.h, 0]}>
        <PoolTables tables={feature.pool} lite={lite} />
        <LudoTables tables={feature.ludo} status={["playing"]} lite={lite} />
        <IgisoroTables layout={feature.igiLayout} status={{ t0: "playing" }} lite={lite} />
      </group>
      {/* players' walk-in path: from the tunnel to the stage */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y + 0.006, (-FLOOR_R + (STAGE.z - STAGE.hd)) / 2]}>
        <planeGeometry args={[1.8, FLOOR_R + (STAGE.z - STAGE.hd)]} />
        <meshStandardMaterial color="#4a3570" roughness={1} metalness={0} envMapIntensity={0.05} />
      </mesh>
      <Instanced
        geometry={box}
        items={[-1, 1].map((s) => ({ p: [s * 0.95, FLOOR_Y + 0.01, (-FLOOR_R + (STAGE.z - STAGE.hd)) / 2], s: [0.05, 0.012, FLOOR_R + (STAGE.z - STAGE.hd)] }) as Xform)}
        receiveShadow={false}
      >
        <meshBasicMaterial color="#8a73b8" />
      </Instanced>
      <Text font={FONT} fontSize={0.34} position={[0, 1.3, -CONCOURSE.r0 + 0.1]} rotation={[0, Math.PI, 0]} anchorX="center" anchorY="middle" letterSpacing={0.1}>
        PLAYERS ONLY
        <meshStandardMaterial color="#e9e3d6" roughness={0.9} metalness={0} />
      </Text>
      {/* commentator desk */}
      <group position={[COMMENTATORS.x, FLOOR_Y, COMMENTATORS.z]}>
        <mesh position={[0, 0.5, 0]} castShadow={!lite}>
          <boxGeometry args={[COMMENTATORS.w, 1.0, COMMENTATORS.d]} />
          <meshStandardMaterial color="#2c2734" roughness={0.92} metalness={0} />
        </mesh>
        <mesh position={[0, 1.02, 0]}>
          <boxGeometry args={[COMMENTATORS.w + 0.1, 0.04, COMMENTATORS.d + 0.1]} />
          <meshStandardMaterial color="#4a4255" roughness={0.9} metalness={0} />
        </mesh>
        {[-1, 0, 1].map((k) => (
          <mesh key={k} position={[k * 0.95, 1.22, -0.2]} rotation={[-0.15, 0, 0]}>
            <boxGeometry args={[0.5, 0.32, 0.03]} />
            <meshStandardMaterial color="#1a1a1e" emissive="#3c4a66" emissiveIntensity={0.35} roughness={0.9} />
          </mesh>
        ))}
        <Text font={FONT} fontSize={0.2} position={[0, 0.62, COMMENTATORS.d / 2 + 0.01]} anchorX="center" anchorY="middle" letterSpacing={0.14}>
          COMMENTARY
          <meshStandardMaterial color="#d8cfe8" roughness={0.9} metalness={0} />
        </Text>
      </group>

      {/* -------- centre-hung scoreboard: four faces, the current / next event -------- */}
      <group position={[0, FLOOR_Y + 12.4, 0]}>
        <mesh>
          <boxGeometry args={[7.2, 3.5, 7.2]} />
          <primitive object={M.frame} attach="material" />
        </mesh>
        {[0, 1, 2, 3].map((k) => (
          <mesh key={k} rotation={[0, (k * Math.PI) / 2, 0]} position={[Math.sin((k * Math.PI) / 2) * 3.61, 0, Math.cos((k * Math.PI) / 2) * 3.61]}>
            <planeGeometry args={[6.8, 3.2]} />
            <meshBasicMaterial map={board.texture} color="#c9c4d2" />
          </mesh>
        ))}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[0, s * 1.95, 0]}>
            <cylinderGeometry args={[3.0, 3.0, 0.32, 32, 1, true]} />
            <meshBasicMaterial map={ribbons.lower} color="#a79cc0" side={THREE.DoubleSide} />
          </mesh>
        ))}
        {/* hung from the roof on four cables */}
        <MatrixInstances geometry={cyl} matrices={cables}>
          <primitive object={M.rail} attach="material" />
        </MatrixInstances>
      </group>

      {/* -------- roof: space frame over the bowl, dark deck above -------- */}
      <MatrixInstances geometry={cyl} matrices={roof.top}>
        <meshStandardMaterial color="#8d8a92" roughness={0.9} metalness={0} envMapIntensity={0.1} />
      </MatrixInstances>
      <MatrixInstances geometry={cyl} matrices={roof.diag}>
        <meshStandardMaterial color="#77737d" roughness={0.9} metalness={0} envMapIntensity={0.1} />
      </MatrixInstances>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, ROOF_Y + 1.9, 0]}>
        <circleGeometry args={[OUTER_R + 0.5, 64]} />
        <meshStandardMaterial color="#1f1d24" roughness={1} metalness={0} envMapIntensity={0} />
      </mesh>
      <mesh position={[0, (SHELL_TOP + ROOF_Y + 1.9) / 2, 0]}>
        <cylinderGeometry args={[OUTER_R - 0.02, OUTER_R - 0.02, ROOF_Y + 1.9 - SHELL_TOP, 64, 1, true]} />
        <meshStandardMaterial color="#2a2830" roughness={1} metalness={0} side={THREE.BackSide} />
      </mesh>

      {/* -------- wayfinding: section letters on the concourse rail / parapet / box fronts -------- */}
      {signs.map((s) => (
        <group key={s.id} position={[s.x, s.y, s.z]} rotation={[0, s.ry, 0]}>
          <mesh position={[0, 0, -0.012]}>
            <planeGeometry args={[s.id.length > 1 ? 0.86 : 0.62, 0.56]} />
            <meshStandardMaterial color="#3b2f58" roughness={0.95} metalness={0} />
          </mesh>
          <Text font={FONT} fontSize={s.size} anchorX="center" anchorY="middle">
            {s.id}
            <meshStandardMaterial color="#f1ece2" roughness={0.9} metalness={0} />
          </Text>
        </group>
      ))}
      {/* over the portal, bowl side: the way back out */}
      <Text font={FONT} fontSize={0.36} position={[0, PORTAL_H + 0.5, CONCOURSE.r1 - 0.03]} rotation={[0, Math.PI, 0]} anchorX="center" anchorY="middle" letterSpacing={0.1}>
        EXIT · LOBBY · PLAZA
        <meshStandardMaterial color="#e9e3d6" roughness={0.9} metalness={0} />
      </Text>
      <Text font={FONT} fontSize={0.3} position={[0, 1.15, -(CONCOURSE.r1 - 0.05)]} anchorX="center" anchorY="middle" letterSpacing={0.1}>
        MEDIA
        <meshStandardMaterial color="#b8b0c4" roughness={0.9} metalness={0} />
      </Text>

      {/* -------- lobby -------- */}
      <mesh geometry={lobby} position={[0, 0.002, 0]} rotation={[0, 0, 0]} receiveShadow={!lite}>
        <meshStandardMaterial color="#9a948c" roughness={0.95} metalness={0} envMapIntensity={0.1} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={lobby} position={[0, LOBBY_H, 0]}>
        <meshStandardMaterial color="#e4e0d8" roughness={1} metalness={0} envMapIntensity={0.05} side={THREE.DoubleSide} />
      </mesh>
      <Instanced geometry={box} items={lobbyLights} receiveShadow={false}>
        <meshStandardMaterial color="#000000" emissive="#fff3e2" emissiveIntensity={0.65} roughness={1} />
      </Instanced>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * LOBBY.hw, LOBBY_H / 2, (LOBBY.z1 + 20.6) / 2]} rotation={[0, -s * (Math.PI / 2), 0]}>
          <planeGeometry args={[LOBBY.z1 - 20.6, LOBBY_H]} />
          {plaster}
        </mesh>
      ))}
      <SouthWall layout={southLayout}>{plaster}</SouthWall>
      {/* the patterned panel band on the drum's lobby face (the shell over glass, seen from inside) */}
      <mesh position={[0, PORTAL_H + 0.55, OUTER_R + 0.08]}>
        <planeGeometry args={[10.6, 0.72]} />
        <meshStandardMaterial color="#2c2636" roughness={0.95} metalness={0} />
      </mesh>
      <Text font={FONT} fontSize={0.32} position={[0, PORTAL_H + 0.55, OUTER_R + 0.1]} anchorX="center" anchorY="middle" letterSpacing={0.1}>
        BOWL · LOWER A–L · UPPER U1–U8 · VIP V1–V4
        <meshStandardMaterial color="#efe9dc" roughness={0.9} metalness={0} />
      </Text>
      {/* ticket & info kiosk */}
      <group position={[KIOSK.x, 0, KIOSK.z]}>
        <mesh position={[0, 0.55, 0]} castShadow={!lite}>
          <boxGeometry args={[KIOSK.w, 1.1, KIOSK.d]} />
          <meshStandardMaterial color="#4a3a63" roughness={0.92} metalness={0} />
        </mesh>
        <mesh position={[0, 1.12, 0]}>
          <boxGeometry args={[KIOSK.w + 0.1, 0.05, KIOSK.d + 0.1]} />
          <meshStandardMaterial color="#d8d2c8" roughness={0.9} metalness={0} />
        </mesh>
        <mesh position={[0, 2.4, -0.4]}>
          <boxGeometry args={[KIOSK.w, 0.7, 0.08]} />
          <meshStandardMaterial color="#2c2636" roughness={0.95} metalness={0} />
        </mesh>
        <Text font={FONT} fontSize={0.3} position={[0, 2.4, -0.35]} anchorX="center" anchorY="middle" letterSpacing={0.12}>
          TICKETS · INFO
          <meshStandardMaterial color="#efe9dc" roughness={0.9} metalness={0} />
        </Text>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * (KIOSK.w / 2 - 0.1), 1.75, -0.4]}>
            <boxGeometry args={[0.06, 1.3, 0.06]} />
            <primitive object={M.rail} attach="material" />
          </mesh>
        ))}
      </group>
      {/* event board: today's events and their scope */}
      <group position={[6.8, 0, 27.6]}>
        <mesh position={[0, 1.95, 0]}>
          <boxGeometry args={[3.35, 1.95, 0.12]} />
          <primitive object={M.frame} attach="material" />
        </mesh>
        <mesh position={[0, 1.95, 0.065]}>
          <planeGeometry args={[3.2, 1.8]} />
          <meshBasicMaterial map={lobbyBoard.texture} color="#c9c4d2" />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 1.4, 0.5, 0]}>
            <boxGeometry args={[0.08, 1.0, 0.08]} />
            <primitive object={M.rail} attach="material" />
          </mesh>
        ))}
      </group>
      {/* concession counters (set dressing) */}
      {CONCESSIONS.map((c, i) => {
        const s = Math.sign(c.x);
        return (
          <group key={i}>
            <mesh position={[c.x, 0.55, c.z]} castShadow={!lite}>
              <boxGeometry args={[c.w, 1.1, c.d]} />
              <meshStandardMaterial color="#5a4436" roughness={0.9} metalness={0} />
            </mesh>
            <mesh position={[c.x, 1.12, c.z]}>
              <boxGeometry args={[c.w + 0.15, 0.05, c.d + 0.1]} />
              <meshStandardMaterial color="#d6cfc4" roughness={0.9} metalness={0} />
            </mesh>
            <mesh position={[s * (LOBBY.hw - 0.03), 2.9, c.z]} rotation={[0, -s * (Math.PI / 2), 0]}>
              <planeGeometry args={[c.d, 0.9]} />
              <meshStandardMaterial color="#2c2636" roughness={0.95} metalness={0} />
            </mesh>
            <Text font={FONT} fontSize={0.36} position={[s * (LOBBY.hw - 0.05), 2.9, c.z]} rotation={[0, -s * (Math.PI / 2), 0]} anchorX="center" anchorY="middle" letterSpacing={0.12}>
              {i ? "DRINKS · COFFEE" : "SNACKS · BROCHETTES"}
              <meshStandardMaterial color="#e8c77a" roughness={0.9} metalness={0} />
            </Text>
          </group>
        );
      })}
      {/* restrooms (closed doors + signs) by the entrance */}
      {[-1, 1].map((s) => (
        <group key={`wc${s}`} position={[s * (LOBBY.hw - 0.04), 0, 33.0]} rotation={[0, -s * (Math.PI / 2), 0]}>
          <mesh position={[0, 1.1, 0]}>
            <boxGeometry args={[1.1, 2.2, 0.05]} />
            <meshStandardMaterial color="#4b4552" roughness={0.92} metalness={0} />
          </mesh>
          <Text font={FONT} fontSize={0.22} position={[0, 2.55, 0.03]} anchorX="center" anchorY="middle" letterSpacing={0.12}>
            RESTROOMS
            <meshStandardMaterial color="#3b3346" roughness={0.9} metalness={0} />
          </Text>
          {[-0.2, 0.2].map((x) => (
            <group key={x} position={[x, 1.65, 0.03]}>
              <mesh position={[0, 0.17, 0]}>
                <circleGeometry args={[0.05, 16]} />
                <meshStandardMaterial color="#f1ece2" roughness={0.9} />
              </mesh>
              <mesh position={[0, -0.02, 0]}>
                <planeGeometry args={[x < 0 ? 0.1 : 0.16, 0.24]} />
                <meshStandardMaterial color="#f1ece2" roughness={0.9} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
      <GltfInstances
        url={model("potted_plant_02")}
        items={[
          { p: [-LOBBY.hw + 0.8, 0, 22.2], s: 1.5, r: 0.3 },
          { p: [LOBBY.hw - 0.8, 0, 22.2], s: 1.5, r: 2.1 },
          { p: [-3.2, 0, LOBBY.z1 - 0.8], s: 1.4, r: 1.2 },
          { p: [3.2, 0, LOBBY.z1 - 0.8], s: 1.4, r: 4.0 },
        ]}
        matOverride={(m) => {
          m.roughness = Math.max(0.85, m.roughness);
          m.metalness = 0;
          m.envMapIntensity = 0.15;
        }}
      />
      <SeatMarker />
    </group>
  );
}

/** A soft ring over the seat you are walking to / waiting for. */
function SeatMarker() {
  const ref = useRef<THREE.Mesh>(null);
  const id = useArena((s) => s.pending ?? s.walkingTo);
  const seat = id ? bowlSeat(id) : null;
  useFrame(({ clock }) => {
    if (ref.current) ref.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 3) * 0.06);
  });
  if (!seat) return null;
  return (
    <mesh ref={ref} position={[seat.x, seat.y + 1.05, seat.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.18, 0.24, 32]} />
      <meshBasicMaterial color="#b89be6" transparent opacity={0.85} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

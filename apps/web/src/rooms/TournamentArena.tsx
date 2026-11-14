"use client";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, Text } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { HallLayout, Table } from "./layouts";
import { GltfInstances, Instanced, LightPools, model, type Xform } from "./interior-kit";
import { SouthWall } from "./shell";
import { PoolTables } from "./PoolHall";
import { LudoTables } from "./LudoLounge";
import { IgisoroTables } from "./IgisoroCourt";
import { isOnScreen, useArea } from "@/world/stage";
import { selfPose } from "@/lib/world-store";
import { pickables, updateVenue, useVenue } from "@/arena/hooks"; // also registers the arena's hall hooks
import { bindArenaRealtime, fetchArenaStatus, useArena } from "@/arena/arena-client";
import {
  BOWL_SEATS,
  bowlSeat,
  COMMENTATORS,
  CONCESSIONS,
  CONCOURSE,
  FEATURE_TABLES,
  FLOOR_R,
  FLOOR_Y,
  GANTRY,
  KIOSK,
  LOBBY,
  LOWER,
  LOWER_AISLES,
  LOWER_BACK,
  OUTER_R,
  PLAYERS_TUNNEL_HW,
  PORTAL_HW,
  RESTROOM,
  SECTIONS,
  STAGE,
  TUNNEL_STEPS,
  UPPER,
  UPPER_AISLES,
  VIP,
  lowerTreadY,
  polar,
  upperTreadY,
} from "@/arena/bowl";
import { EVENT_BOARD, PHOTO_SPOT, TOTEM_ANGLES, totemPos } from "@/arena/venue";
import {
  accentTexture,
  ceilingTexture,
  concreteTexture,
  eventBoardTexture,
  floorTexture,
  menuTexture,
  paintEventBoard,
  paintRibbon,
  paintScoreboard,
  plateAtlas,
  ribbonTexture,
  scoreboardTexture,
  slatTexture,
  totemTexture,
} from "@/arena/textures";
import { V } from "@/arena/strings";

/**
 * Tournament Arena interior (P2-ARN-03 / P2-ARN-04) — a modern indoor arena (original design; ideas only from great
 * venues such as Kigali's): deep charcoal concrete and warm timber, the arena purple as an accent, gold highlights.
 *   lobby (timber slat walls, ticket & info kiosk, live event board, concession frontage with menu screens, restrooms)
 *   → back-lit entry portal → concourse ring (polished concrete, glass balustrade, wayfinding totems, photo spot)
 *   → lower bowl A–L / upper tier U1–U8 (glass balustrade over an LED fascia) / VIP boxes V1–V4 (glass fronts)
 *   → competition floor: feature stage (Pool, Ludo, Igisoro tables), players' tunnel, commentator desk (ON AIR)
 *   → curved 4-sided centre-hung board with an underside ring screen and a halo ring, slim truss
 *   → acoustic timber ceiling ring with warm cove light rings around a dark space-frame lantern.
 *
 * Eye comfort (no glare): every surface is matte (roughness ≥ 0.85, metalness 0, envMapIntensity ≤ 0.12); the glass
 * is frosted (rough, low opacity, no reflections); light comes from a soft overhead key, warm coves and baked light
 * pools — no bare bright sources; screens, LED ribbons and nosings are mid-bright and tone-mapped (below bloom).
 * Live: the house lights ease down and a soft stage wash comes up.
 *
 * Performance: the bowl is one merged geometry per material; the 1,224 seats are ONE InstancedMesh (a detailed seat
 * with vertex-coloured shell / pad / armrests, a simpler one on Lite); plates are one merged mesh; rails, nosings,
 * the lantern space frame and truss are instanced.
 */
const FONT = "/fonts/Baloo2.ttf";
const D2R = Math.PI / 180;
const LOBBY_H = 4.6;
const PORTAL_H = 3.4;
/** acoustic ceiling ring (underside) and the open space-frame lantern in the middle */
const CEIL_Y = 14.6;
const LANTERN_R = 9.5;
const ROOF_Y = 15.2;
const BOARD_Y = FLOOR_Y + 12.6;

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
      // ring: u = the angle round the ring (one turn = 0…1; inward faces run against it so text reads from inside)
      const u0 = ring ? (inward ? -b0 : b0) / 360 : (b0 * D2R * r) / uvScale;
      const u1 = ring ? (inward ? -b1 : b1) / 360 : (b1 * D2R * r) / uvScale;
      const v0 = ring ? 0 : y0 / uvScale;
      const v1 = ring ? 1 : y1 / uvScale;
      if (inward) this.quad(p(b1, y0), p(b0, y0), p(b0, y1), p(b1, y1), nn, [u1, v0, u0, v1]);
      else this.quad(p(b0, y0), p(b1, y0), p(b1, y1), p(b0, y1), nn, [u0, v0, u1, v1]);
    }
  }
  /** radial wall at angle a, facing towards +angle (`ccw`) or −angle */
  radial(a: number, r0: number, r1: number, y0: number, y1: number, ccw: boolean, uvScale = 1) {
    const ar = a * D2R;
    const n: THREE.Vector3Tuple = ccw ? [Math.cos(ar), 0, -Math.sin(ar)] : [-Math.cos(ar), 0, Math.sin(ar)];
    const p = (r: number, y: number): THREE.Vector3Tuple => [r * Math.sin(ar), y, r * Math.cos(ar)];
    const uv: [number, number, number, number] = [r1 / uvScale, y0 / uvScale, r0 / uvScale, y1 / uvScale];
    if (ccw) this.quad(p(r1, y0), p(r0, y0), p(r0, y1), p(r1, y1), n, uv);
    else this.quad(p(r0, y0), p(r1, y0), p(r1, y1), p(r0, y1), n, [uv[2], uv[1], uv[0], uv[3]]);
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
/** angular half width (deg) of an opening of `m` metres (lateral) at radius r */
const halfDeg = (m: number, r: number) => m / r / D2R;
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
const UPPER_HOLES = UPPER_AISLES.map((a) => [a, halfDeg(0.62, CONCOURSE.r1)] as [number, number]);
const LOWER_RAIL_HOLES: [number, number][] = [...LOWER_AISLES.map((a) => [a, halfDeg(0.62, CONCOURSE.r0)] as [number, number]), [180, 6.0]];
const GANTRY_NOTCH = 2.6; // half width (deg) of the gantry stair notch at 180°

/** cap rails: tube segments along an arc */
function arcRail(r: number, a0: number, a1: number, y: number, rad: number, out: THREE.Matrix4[]) {
  const n = Math.max(1, Math.ceil((a1 - a0) / 4));
  for (let k = 0; k < n; k++) {
    const p0 = polar(r, a0 + ((a1 - a0) * k) / n);
    const p1 = polar(r, a0 + ((a1 - a0) * (k + 1)) / n);
    member(new THREE.Vector3(p0.x, y, p0.z), new THREE.Vector3(p1.x, y, p1.z), rad, out);
  }
}

function buildBowl() {
  const concrete = new Geo(); // treads, risers, cheek walls (charcoal)
  const floorC = new Geo(); // concourse, portal, VIP fore-courts (polished concrete)
  const finish = new Geo(); // barrier, kerbs, caps, lintels, box exteriors (warm stone)
  const timber = new Geo(); // the shell, portal blocks, the drum's lobby face, VIP side walls (timber slats)
  const dark = new Geo(); // soffits, box roofs, gantry deck
  const glass = new Geo(); // frosted glass balustrades
  const warm = new Geo(); // VIP interiors
  const accent = new Geo(); // Imigongo accent band
  const rails: THREE.Matrix4[] = [];

  // ---- lower bowl: treads + risers + stepped aisles, front barrier
  const y1 = lowerTreadY(1);
  for (let i = 1; i <= LOWER.rows; i++) {
    const r0 = LOWER.front + LOWER.depth * (i - 1);
    const r1 = r0 + LOWER.depth;
    const y = lowerTreadY(i);
    concrete.top(r0, r1, LOWER_SPAN[0], LOWER_SPAN[1], y, false, 4);
    concrete.wall(r0, LOWER_SPAN[0], LOWER_SPAN[1], i === 1 ? FLOOR_Y : lowerTreadY(i - 1), y, true, 4);
    if (i < LOWER.rows)
      for (const a of LOWER_AISLES) {
        const h = halfDeg(0.55, r0);
        const yy = y + (LOWER.depth * LOWER.slope) / 2;
        concrete.top(r0 + LOWER.depth / 2, r1, a - h, a + h, yy);
        concrete.wall(r0 + LOWER.depth / 2, a - h, a + h, y, yy);
      }
  }
  concrete.wall(LOWER_BACK, LOWER_SPAN[0], LOWER_SPAN[1], lowerTreadY(LOWER.rows), 0);
  finish.wall(FLOOR_R, LOWER_SPAN[0], LOWER_SPAN[1], FLOOR_Y, y1 + 0.95, true, 4);
  finish.top(FLOOR_R, LOWER.front, LOWER_SPAN[0], LOWER_SPAN[1], y1 + 0.95);
  finish.wall(LOWER.front, LOWER_SPAN[0], LOWER_SPAN[1], y1, y1 + 0.95, false, 4);
  // players' tunnel: cheek walls closing the gap to the row ends
  for (const s of [-1, 1]) {
    const aEdge = s < 0 ? 190 : 170;
    concrete.top(FLOOR_R, CONCOURSE.r0, Math.min(aEdge, aEdge + s * 4), Math.max(aEdge, aEdge + s * 4), 0.9);
    concrete.radial(aEdge, FLOOR_R, CONCOURSE.r0, FLOOR_Y, 0.9, s > 0);
  }

  // ---- concourse ring + glass balustrade at the top of the lower bowl (open at the aisles and the tunnel)
  floorC.top(CONCOURSE.r0 - 0.03, CONCOURSE.r1, 0, 360, 0, false, 4);
  for (const [b0, b1] of cut(0, 360, LOWER_RAIL_HOLES)) {
    glass.wall(CONCOURSE.r0 + 0.05, b0, b1, 0.06, 1.05, true);
    arcRail(CONCOURSE.r0 + 0.05, b0, b1, 1.07, 0.03, rails);
  }
  for (const v of VIP_SECTIONS) floorC.top(CONCOURSE.r1, VIP.front, v.a0, v.a1, 0, false, 4);

  // ---- south gap: timber-clad portal blocks either side of the back-lit entry portal
  for (const [a0, a1] of [
    [342, 351],
    [9, 18],
  ] as [number, number][]) {
    finish.top(CONCOURSE.r1, OUTER_R, a0, a1, PORTAL_H);
    timber.wall(CONCOURSE.r1, a0, a1, 0, PORTAL_H, true, 1.6);
  }
  floorC.top(CONCOURSE.r1, OUTER_R + 0.7, -9, 9, 0, false, 4);
  finish.top(CONCOURSE.r1, OUTER_R, -9, 9, PORTAL_H + 1.0);
  finish.wall(CONCOURSE.r1, -9, 9, PORTAL_H, PORTAL_H + 1.0, true, 2);
  dark.top(CONCOURSE.r1, OUTER_R, -9, 9, PORTAL_H, true);

  // ---- north gap: the media gantry deck (a viewpoint) with its stair notch at 180°
  for (const [a0, a1] of [
    [GANTRY.a0, 180 - GANTRY_NOTCH],
    [180 + GANTRY_NOTCH, GANTRY.a1],
  ] as [number, number][]) {
    dark.top(CONCOURSE.r1, OUTER_R, a0, a1, GANTRY.y);
    finish.wall(CONCOURSE.r1, a0, a1, 0, GANTRY.y, true, 2);
    glass.wall(CONCOURSE.r1 + 0.06, a0, a1, GANTRY.y + 0.05, GANTRY.y + 1.05, true);
    arcRail(CONCOURSE.r1 + 0.06, a0, a1, GANTRY.y + 1.07, 0.03, rails);
  }
  dark.top(GANTRY.r0, OUTER_R, 180 - GANTRY_NOTCH, 180 + GANTRY_NOTCH, GANTRY.y);
  for (let k = 1; k <= GANTRY.steps; k++) {
    const r = CONCOURSE.r1 + ((GANTRY.r0 - CONCOURSE.r1) * (k - 1)) / GANTRY.steps;
    const y = (GANTRY.y * k) / GANTRY.steps;
    concrete.top(r, GANTRY.r0, 180 - GANTRY_NOTCH, 180 + GANTRY_NOTCH, y);
    concrete.wall(r, 180 - GANTRY_NOTCH, 180 + GANTRY_NOTCH, y - GANTRY.y / GANTRY.steps, y);
  }
  finish.radial(180 - GANTRY_NOTCH, CONCOURSE.r1, GANTRY.r0, 0, GANTRY.y, true);
  finish.radial(180 + GANTRY_NOTCH, CONCOURSE.r1, GANTRY.r0, 0, GANTRY.y, false);

  // ---- upper tier: treads + stepped aisles, a low stone kerb carrying the LED fascia, frosted glass above it
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
    for (const [b0, b1] of cut(a0, a1, UPPER_HOLES)) {
      finish.wall(CONCOURSE.r1, b0, b1, 0, 0.45, true, 2);
      finish.top(CONCOURSE.r1, CONCOURSE.r1 + 0.16, b0, b1, 0.45);
      finish.wall(CONCOURSE.r1 + 0.16, b0, b1, upperTreadY(1), 0.45, false, 2);
      glass.wall(CONCOURSE.r1 + 0.08, b0, b1, 0.45, 1.12, true);
      arcRail(CONCOURSE.r1 + 0.08, b0, b1, 1.14, 0.03, rails);
    }
    // side walls where an arc meets a gap or a box (timber)
    timber.radial(a0, CONCOURSE.r1, OUTER_R, 0, upperTreadY(UPPER.rows) + 1.2, false, 1.6);
    timber.radial(a1, CONCOURSE.r1, OUTER_R, 0, upperTreadY(UPPER.rows) + 1.2, true, 1.6);
  }

  // ---- VIP boxes: raised floor, glass front with its stair opening, timber sides, roof slab, warm interior
  for (const v of VIP_SECTIONS) {
    const sa = v.a0 + VIP.stairOff;
    const hole = halfDeg(0.5, VIP.front);
    finish.top(VIP.front, OUTER_R, v.a0, v.a1, VIP.floorY, false, 2);
    finish.wall(VIP.front, v.a0, v.a1, 0, VIP.floorY, true, 2);
    for (const [b0, b1] of cut(v.a0, v.a1, [[sa, hole]])) {
      glass.wall(VIP.front + 0.03, b0, b1, VIP.floorY, VIP.floorY + 1.05, true);
      arcRail(VIP.front + 0.03, b0, b1, VIP.floorY + 1.07, 0.03, rails);
    }
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
      timber.radial(a, VIP.front, OUTER_R, VIP.floorY, VIP.floorY + 3.0, !ccw, 1.6);
    }
    dark.top(VIP.front - 0.4, OUTER_R, v.a0, v.a1, VIP.floorY + 3.0, true);
    finish.top(VIP.front - 0.4, OUTER_R, v.a0, v.a1, VIP.floorY + 3.15);
    finish.wall(VIP.front - 0.4, v.a0, v.a1, VIP.floorY + 3.0, VIP.floorY + 3.15, true);
    warm.wall(OUTER_R - 0.05, v.a0, v.a1, VIP.floorY, VIP.floorY + 3.0, true, 2);
  }

  // ---- the shell: warm timber slats all round up to the ceiling, an Imigongo accent band, the portal opening
  timber.wall(OUTER_R, 7, 353, 0, CEIL_Y, true, 1.6);
  timber.wall(OUTER_R, -7, 7, PORTAL_H + 1.0, CEIL_Y, true, 1.6);
  accent.wall(OUTER_R - 0.03, 0, 360, 6.2, 6.62, true, 1, true);
  // lobby face of the drum (outside the bowl)
  const lobbyA = Math.asin(LOBBY.hw / OUTER_R) / D2R;
  for (const [a0, a1] of [
    [-lobbyA, -7],
    [7, lobbyA],
  ] as [number, number][])
    timber.wall(OUTER_R + 0.02, a0, a1, 0, LOBBY_H, false, 1.6);
  timber.wall(OUTER_R + 0.02, -7, 7, PORTAL_H + 1.0, LOBBY_H, false, 1.6);
  // players' tunnel handrails
  for (const s of [-1, 1]) member(new THREE.Vector3(s * (PLAYERS_TUNNEL_HW - 0.05), 0.95, -CONCOURSE.r0), new THREE.Vector3(s * (PLAYERS_TUNNEL_HW - 0.05), FLOOR_Y + 0.95, -FLOOR_R), 0.03, rails);

  return {
    geo: {
      concrete: concrete.build(),
      floorC: floorC.build(),
      finish: finish.build(),
      timber: timber.build(),
      dark: dark.build(),
      glass: glass.build(),
      warm: warm.build(),
      accent: accent.build(),
    },
    rails,
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
  const g = new THREE.ShapeGeometry(s, 24);
  g.rotateX(Math.PI / 2);
  // planar UVs in metres / 3 (concrete tiles)
  const p = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 3, p.getZ(i) / 3);
  return g;
}

/* ---------------- premium stadium seat (vertex-coloured: shell / pad / armrests), local +z faces the floor ---------------- */

function coloured(g: THREE.BufferGeometry, k: number) {
  const n = g.getAttribute("position").count;
  g.setAttribute("color", new THREE.Float32BufferAttribute(new Array(n * 3).fill(k), 3));
  return g.index ? g.toNonIndexed() : g;
}
function seatGeometry(lite: boolean) {
  const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const parts: THREE.BufferGeometry[] = lite
    ? [
        coloured(B(0.44, 0.07, 0.4).translate(0, 0.44, -0.03), 1),
        coloured(B(0.44, 0.48, 0.06).rotateX(-0.14).translate(0, 0.73, -0.24), 0.85),
        coloured(B(0.08, 0.4, 0.1).translate(0, 0.2, -0.14), 0.2),
        coloured(B(0.54, 0.035, 0.3).translate(0, 0.62, -0.08), 0.22),
      ]
    : [
        // pedestal + seat shell
        coloured(B(0.07, 0.38, 0.1).translate(0, 0.19, -0.16), 0.16),
        coloured(B(0.46, 0.035, 0.42).translate(0, 0.405, -0.03), 0.32),
        // upholstered seat pad (contoured: a slight front roll)
        coloured(B(0.42, 0.055, 0.36).translate(0, 0.45, -0.04), 1),
        coloured(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 8).rotateZ(Math.PI / 2).translate(0, 0.45, 0.14), 1),
        // back shell + back pad (contoured top)
        coloured(B(0.46, 0.54, 0.035).rotateX(-0.15).translate(0, 0.75, -0.265), 0.32),
        coloured(B(0.4, 0.46, 0.04).rotateX(-0.15).translate(0, 0.76, -0.235), 1),
        coloured(new THREE.CylinderGeometry(0.03, 0.03, 0.46, 8).rotateZ(Math.PI / 2).translate(0, 1.02, -0.3), 0.32),
        // armrests (two), posts, cup holder on the right arm
        ...[-1, 1].flatMap((s) => [coloured(B(0.05, 0.035, 0.34).translate(s * 0.245, 0.62, -0.07), 0.18), coloured(B(0.035, 0.2, 0.035).translate(s * 0.245, 0.51, -0.18), 0.18)]),
        coloured(new THREE.CylinderGeometry(0.036, 0.03, 0.04, 10, 1, true).translate(0.245, 0.62, 0.12), 0.14),
      ];
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
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

/** row number plates on the aisle ends: one merged mesh, UVs into the 1…6 atlas */
function platesGeometry() {
  const g = new Geo();
  for (const s of BOWL_SEATS) {
    const sec = SECTIONS.find((x) => x.id === s.table)!;
    if (sec.tier === "vip") continue;
    const aisles = sec.tier === "lower" ? LOWER_AISLES : UPPER_AISLES;
    const edges = [
      { n: 1, a: sec.a0, dir: -1 },
      { n: sec.seats, a: sec.a1, dir: 1 },
    ];
    for (const e of edges) {
      if (s.n !== e.n || !aisles.some((x) => Math.abs(((x - e.a + 540) % 360) - 180) < 0.01)) continue;
      // on the aisle-side face of the end seat's armrest, facing along the row into the aisle
      const a = s.a + e.dir * halfDeg(0.275, s.r);
      const c = polar(s.r - 0.04, a);
      const ar = a * D2R;
      const t: [number, number, number] = [Math.cos(ar) * e.dir, 0, -Math.sin(ar) * e.dir]; // along the row, towards the aisle
      const rad: [number, number, number] = [Math.sin(ar), 0, Math.cos(ar)];
      const hw = 0.06;
      const y0 = s.y + 0.5;
      const y1 = s.y + 0.58;
      const P = (k: number, y: number): THREE.Vector3Tuple => [c.x + rad[0] * k * hw + t[0] * 0.005, y, c.z + rad[2] * k * hw + t[2] * 0.005];
      const u0 = (s.row - 1) / 6;
      const u1 = s.row / 6;
      // the quad faces +t
      if (e.dir > 0) g.quad(P(1, y0), P(-1, y0), P(-1, y1), P(1, y1), t, [u0, 0, u1, 1]);
      else g.quad(P(-1, y0), P(1, y0), P(1, y1), P(-1, y1), t, [u0, 0, u1, 1]);
    }
  }
  return g.build();
}

/* ---------------- matte materials ---------------- */

function useMats() {
  return useMemo(() => {
    const slat = slatTexture();
    const conc = concreteTexture();
    const acc = accentTexture();
    acc.repeat.set(60, 1);
    const m = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, envMapIntensity: 0.1, ...extra });
    return {
      concrete: m("#55504c", { side: THREE.DoubleSide }),
      floorC: m("#ffffff", { map: conc, roughness: 0.86, side: THREE.DoubleSide }),
      finish: m("#b4ab9f", { side: THREE.DoubleSide }),
      timber: m("#ffffff", { map: slat, roughness: 0.9 }),
      dark: m("#232127", { side: THREE.DoubleSide, roughness: 1 }),
      // frosted, low-reflection glass (rough, no environment reflections, low opacity, sorted after opaques)
      glass: new THREE.MeshStandardMaterial({ color: "#d6dde2", roughness: 1, metalness: 0, envMapIntensity: 0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
      warm: m("#7a5a40", { side: THREE.DoubleSide }),
      accent: m("#ffffff", { map: acc, roughness: 0.95 }),
      rail: m("#2b2a30", { roughness: 0.85 }),
      // LED-lit stair nosings: soft warm strips (emissive below the bloom threshold)
      nosing: m("#3a2e1c", { emissive: "#ffb45c", emissiveIntensity: 0.32, roughness: 0.95 }),
      seat: m("#ffffff", { roughness: 0.88, vertexColors: true }),
      frame: m("#2a282f", { roughness: 0.9 }),
      stone: m("#cfc6b8", { roughness: 0.9 }),
      wood: m("#8a6648", { roughness: 0.88 }),
      plate: new THREE.MeshStandardMaterial({ map: plateAtlas(), roughness: 0.9, metalness: 0 }),
      cove: new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffd9a8").multiplyScalar(0.85) }),
    };
  }, []);
}

/* ---------------- the interior ---------------- */

export function TournamentArena({ layout, lite }: { layout: HallLayout; lite: boolean }) {
  const bowl = useMemo(() => buildBowl(), []);
  useEffect(() => () => Object.values(bowl.geo).forEach((g) => g.dispose()), [bowl]);
  const M = useMats();
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const cyl = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, lite ? 5 : 7), [lite]);
  const seatGeo = useMemo(() => seatGeometry(lite), [lite]);
  const plates = useMemo(() => platesGeometry(), []);
  const lobby = useMemo(() => lobbyShape(), []);
  const scene = useThree((s) => s.scene);
  const area = useArea();

  useLayoutEffect(() => {
    if (!scene.background) scene.background = new THREE.Color("#141218");
  }, [scene]);
  useEffect(() => {
    bindArenaRealtime();
    void fetchArenaStatus();
  }, []);

  /* --- tap targets: the real walking surfaces (stairs, rows, tiers, floors) and the seats --- */
  const pickRefs = useRef<(THREE.Object3D | null)[]>([]);
  const addPick = (i: number) => (o: THREE.Object3D | null) => void (pickRefs.current[i] = o);
  useEffect(() => {
    pickables.length = 0;
    for (const o of pickRefs.current) if (o) pickables.push(o);
    return () => void (pickables.length = 0);
  });

  /* --- seats: ONE instanced mesh; colour per tier (charcoal-plum lower, slate upper, cognac VIP), calm variation --- */
  const seatRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const im = seatRef.current;
    if (!im) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    BOWL_SEATS.forEach((s, i) => {
      const vip = s.table.startsWith("V");
      q.setFromAxisAngle(_up, s.yaw);
      m.compose(new THREE.Vector3(s.x, s.y, s.z), q, vip ? new THREE.Vector3(1.22, 1.04, 1.12) : new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(i, m);
      c.set(vip ? "#8a5d3b" : s.table.startsWith("U") ? "#4a4a63" : "#5a3f78").offsetHSL(0, 0, hash(i) * 0.04 - 0.02);
      im.setColorAt(i, c);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
  }, [seatGeo]);

  /* --- LED stair nosings (soft), tunnel steps, cheek walls, portal walls --- */
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
          nosings.push({ p: [p.x, y + 0.006, p.z], r: a * D2R, s: [1.0, 0.012, 0.05] });
        }
      }
    for (const a of UPPER_AISLES)
      for (let j = 1; j < UPPER.rows; j++) {
        const r0 = UPPER.r0 + UPPER.depth * (j - 1);
        for (const [rr, y] of [
          [r0 + 0.03, upperTreadY(j)],
          [r0 + UPPER.depth / 2 + 0.03, upperTreadY(j) + (UPPER.depth * UPPER.slope) / 2],
        ] as [number, number][]) {
          const p = polar(rr, a);
          nosings.push({ p: [p.x, y + 0.006, p.z], r: a * D2R, s: [1.1, 0.012, 0.05] });
        }
      }
    for (let k = 1; k <= GANTRY.steps; k++) {
      const p = polar(CONCOURSE.r1 + ((GANTRY.r0 - CONCOURSE.r1) * (k - 1)) / GANTRY.steps + 0.03, 180);
      nosings.push({ p: [p.x, (GANTRY.y * k) / GANTRY.steps + 0.006, p.z], r: Math.PI, s: [1.6, 0.012, 0.05] });
    }
    const steps: Xform[] = [];
    for (let k = 0; k < TUNNEL_STEPS; k++) {
      const z0 = -CONCOURSE.r0 + ((CONCOURSE.r0 - FLOOR_R) * (k + 0.5)) / TUNNEL_STEPS;
      const y = (FLOOR_Y * (k + 1)) / TUNNEL_STEPS;
      if (y - FLOOR_Y > 1e-3) steps.push({ p: [0, (y + FLOOR_Y) / 2, z0], s: [PLAYERS_TUNNEL_HW * 2, y - FLOOR_Y, (CONCOURSE.r0 - FLOOR_R) / TUNNEL_STEPS + 0.01] });
    }
    const cheeks: Xform[] = [-1, 1].map((s) => ({ p: [s * (PLAYERS_TUNNEL_HW + 0.5), (FLOOR_Y + 0.9) / 2, -(FLOOR_R + CONCOURSE.r0) / 2], s: [1.0, 0.9 - FLOOR_Y, CONCOURSE.r0 - FLOOR_R] }));
    const portal: Xform[] = [-1, 1].map((s) => ({ p: [s * (PORTAL_HW + 0.5), PORTAL_H / 2, (CONCOURSE.r1 + OUTER_R) / 2 + 0.2], s: [1.0, PORTAL_H, OUTER_R - CONCOURSE.r1 + 0.6] }));
    return { nosings, steps, cheeks, portal };
  }, []);

  /* --- lantern space frame (the open middle of the ceiling), truss --- */
  const roof = useMemo(() => {
    const top: THREE.Matrix4[] = [];
    const S = 2.4;
    const R = LANTERN_R + 0.6;
    const yT = ROOF_Y + 1.2;
    const yB = ROOF_Y;
    const inside = (x: number, z: number) => Math.hypot(x, z) < R;
    const n = Math.ceil(R / S);
    for (let i = -n; i <= n; i++)
      for (let j = -n; j <= n; j++) {
        const x = i * S;
        const z = j * S;
        if (inside(x, z)) {
          if (inside(x + S, z)) member(new THREE.Vector3(x, yT, z), new THREE.Vector3(x + S, yT, z), 0.04, top);
          if (inside(x, z + S)) member(new THREE.Vector3(x, yT, z), new THREE.Vector3(x, yT, z + S), 0.04, top);
        }
        const bx = x + S / 2;
        const bz = z + S / 2;
        if (!inside(bx, bz)) continue;
        if (inside(bx + S, bz)) member(new THREE.Vector3(bx, yB, bz), new THREE.Vector3(bx + S, yB, bz), 0.05, top);
        if (inside(bx, bz + S)) member(new THREE.Vector3(bx, yB, bz), new THREE.Vector3(bx, yB, bz + S), 0.05, top);
        if (!lite)
          for (const [dx, dz] of [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ] as [number, number][])
            if (inside(bx + (dx * S) / 2, bz + (dz * S) / 2)) member(new THREE.Vector3(bx, yB, bz), new THREE.Vector3(bx + (dx * S) / 2, yT, bz + (dz * S) / 2), 0.03, top);
      }
    // centre board truss ring + hangers
    const truss: THREE.Matrix4[] = [];
    for (let k = 0; k < 12; k++) {
      const a0 = (k / 12) * 360;
      const a1 = ((k + 1) / 12) * 360;
      for (const y of [BOARD_Y + 1.95, BOARD_Y + 2.45]) {
        const p0 = polar(3.4, a0);
        const p1 = polar(3.4, a1);
        member(new THREE.Vector3(p0.x, y, p0.z), new THREE.Vector3(p1.x, y, p1.z), 0.035, truss);
      }
      const p = polar(3.4, a0);
      member(new THREE.Vector3(p.x, BOARD_Y + 1.95, p.z), new THREE.Vector3(p.x, BOARD_Y + 2.45, p.z), 0.025, truss);
    }
    for (const a of [45, 135, 225, 315]) {
      const p = polar(3.4, a);
      const q = polar(2.2, a);
      member(new THREE.Vector3(p.x, BOARD_Y + 2.45, p.z), new THREE.Vector3(q.x, ROOF_Y, q.z), 0.015, truss);
    }
    return { top, truss };
  }, [lite]);

  /* --- LED ribbons, floor, centre board, event board, totems, menus --- */
  const status = useArena((s) => s.status);
  const announceText = useArena((s) => s.announce?.text ?? null);
  const ribbons = useMemo(() => {
    const words = ["TOURNAMENT ARENA", "PLAY · MEET · WIN", "GUKIRANA PLAYGROUND", "MUSANZE", "POOL · LUDO · IGISORO", "FAIR PLAY"];
    const lower = ribbonTexture(words);
    const upper = ribbonTexture([...words].reverse());
    const high = ribbonTexture(words.map(() => ""), "#241d33");
    lower.repeat.set(4, 1);
    upper.repeat.set(5, 1);
    high.repeat.set(6, 1);
    return { lower, upper, high };
  }, []);
  useEffect(() => {
    // the event's name runs on the fascia ribbons
    const t = status?.current?.title ?? status?.next?.title;
    if (!t) return;
    const words = [t.toUpperCase(), "TOURNAMENT ARENA", status?.current ? "LIVE · FAIR PLAY" : "NEXT EVENT", "POOL · LUDO · IGISORO", t.toUpperCase(), "GUKIRANA PLAYGROUND"];
    for (const [r, w] of [
      [ribbons.lower, words],
      [ribbons.upper, [...words].reverse()],
    ] as [THREE.CanvasTexture, string[]][]) {
      paintRibbon((r.userData as { g: CanvasRenderingContext2D }).g, w);
      r.needsUpdate = true;
    }
  }, [status, ribbons]);
  const ribbonGeo = useMemo(() => {
    const g = (r: number, y0: number, y1: number, spans: [number, number][]) => {
      const geo = new Geo();
      for (const [a0, a1] of spans) geo.wall(r, a0, a1, y0, y1, true, 1, true);
      return geo.build();
    };
    return {
      lower: g(FLOOR_R - 0.02, FLOOR_Y + 0.35, FLOOR_Y + 1.05, [
        [LOWER_SPAN[0], 360],
        [0, LOWER_SPAN[1] - 360],
      ]),
      upper: g(CONCOURSE.r1 - 0.02, 0.07, 0.4, UPPER_SPANS.flatMap(([a0, a1]) => cut(a0, a1, UPPER_HOLES))),
      high: g(OUTER_R - 0.05, CEIL_Y - 1.2, CEIL_Y - 0.95, [[0, 360]]),
    };
  }, []);
  const floorTex = useMemo(() => floorTexture(), []);
  const board = useMemo(() => {
    const b = scoreboardTexture();
    b.texture.repeat.set(1, 1);
    return b;
  }, []);
  const lobbyBoard = useMemo(() => eventBoardTexture(), []);
  const totems = useMemo(() => TOTEM_ANGLES.map((deg) => ({ deg, tex: totemTexture(deg), p: totemPos(deg) })), []);
  const menus = useMemo(() => [menuTexture(V.counterTitle.snack, V.menu.snack), menuTexture(V.counterTitle.drink, V.menu.drink)], []);
  const ceiling = useMemo(() => {
    const t = ceilingTexture();
    t.repeat.set(26, 26);
    return t;
  }, []);
  const concTex = useMemo(() => {
    const t = concreteTexture();
    return t;
  }, []);
  // repaint the boards: on every status / announcement change, and every second while a countdown runs
  useEffect(() => {
    const paint = () => {
      paintScoreboard(board.g, useArena.getState().status);
      board.texture.needsUpdate = true;
      paintEventBoard(lobbyBoard.g, useArena.getState().status, useArena.getState().announce?.text ?? null);
      lobbyBoard.texture.needsUpdate = true;
    };
    paint();
    const id = setInterval(() => {
      if (!isOnScreen(area)) return;
      const ev = useArena.getState().status?.current;
      const soon = ev && ev.status !== "live" && Date.parse(ev.startsAt) - Date.now() < 10 * 60_000;
      if (soon || Date.now() % 10_000 < 1000) paint();
    }, 1000);
    return () => clearInterval(id);
  }, [status, announceText, board, lobbyBoard, area]);

  /* --- living venue: house lights down + stage wash up when the event is live; walk-on spotlight --- */
  const live = status?.current?.status === "live";
  const hemi = useRef<THREE.HemisphereLight>(null);
  const key = useRef<THREE.DirectionalLight>(null);
  const wash = useRef<THREE.SpotLight>(null);
  const washDisc = useRef<THREE.MeshBasicMaterial>(null);
  const walkSpot = useRef<THREE.Group>(null);
  const onAirMat = useRef<THREE.MeshStandardMaterial>(null);
  const doorW = useRef<THREE.Group>(null);
  const doorE = useRef<THREE.Group>(null);
  const k = useRef(0);
  useFrame(({ clock }, dt) => {
    if (!isOnScreen(area)) return;
    updateVenue();
    ribbons.lower.offset.x = (ribbons.lower.offset.x + dt * 0.004) % 1;
    ribbons.upper.offset.x = (ribbons.upper.offset.x - dt * 0.003) % 1;
    k.current += ((live ? 1 : 0) - k.current) * Math.min(1, dt * 0.6);
    const house = 1 - 0.42 * k.current;
    if (hemi.current) hemi.current.intensity = (lite ? 1.45 : 1.1) * house;
    if (key.current) key.current.intensity = (lite ? 1.0 : 1.1) * house;
    if (wash.current) wash.current.intensity = 2.4 * k.current;
    if (washDisc.current) washDisc.current.opacity = 0.05 + 0.1 * k.current;
    // participants on the floor: a soft walk-on light pool follows them
    const v = useVenue.getState();
    const onFloor = Math.hypot(selfPose.x, selfPose.z) < FLOOR_R + 1 && selfPose.z < STAGE.z + STAGE.hd + 2;
    if (walkSpot.current) {
      walkSpot.current.visible = onFloor && (v.walkOn > performance.now() || live);
      walkSpot.current.position.set(selfPose.x, FLOOR_Y + (Math.abs(selfPose.x) <= STAGE.hw && Math.abs(selfPose.z - STAGE.z) <= STAGE.hd ? STAGE.h : 0) + 0.012, selfPose.z);
    }
    if (onAirMat.current) onAirMat.current.emissiveIntensity = useArena.getState().onAir ? 0.85 + Math.sin(clock.elapsedTime * 3) * 0.1 : 0.05;
    // restroom doors swing open for a visit
    const side = v.restroom?.side ?? 0;
    for (const [ref, s] of [
      [doorW, -1],
      [doorE, 1],
    ] as const) {
      const g = ref.current;
      if (!g) continue;
      const want = side === s && v.restroom?.phase !== "in" ? -s * 1.35 : 0;
      g.rotation.y += (want - g.rotation.y) * Math.min(1, dt * 4);
    }
  });

  /* --- feature tables (the halls' own table models) --- */
  const feature = useMemo(() => {
    const t = (id: string, v: { x: number; z: number; w: number; d: number; h: number }): Table => ({ id, ...v });
    const igi = t("t0", FEATURE_TABLES.igisoro);
    const igiLayout = { ...layout, tables: [igi], seats: [-1, 1].map((s, i) => ({ id: `t0s${i}`, table: "t0", x: igi.x, z: igi.z + s * 1.18, yaw: s > 0 ? Math.PI : 0 })) } as HallLayout;
    return { pool: [t("t0", FEATURE_TABLES.pool)], ludo: [t("t0", FEATURE_TABLES.ludo)], igiLayout };
  }, [layout]);

  const southLayout = useMemo(() => ({ ...layout, size: { ...layout.size, w: LOBBY.hw * 2 + 0.6, h: LOBBY_H } }), [layout]);
  const slatMat = M.timber;
  const signs = useMemo(
    () =>
      SECTIONS.map((s) => {
        const mid = (s.a0 + s.a1) / 2;
        if (s.tier === "lower") {
          const p = polar(CONCOURSE.r0 + 0.14, mid);
          return { id: s.id, x: p.x, y: 1.5, z: p.z, ry: mid * D2R, size: 0.5 };
        }
        if (s.tier === "upper") {
          const p = polar(CONCOURSE.r1 - 0.06, mid);
          return { id: s.id, x: p.x, y: 1.62, z: p.z, ry: mid * D2R + Math.PI, size: 0.46 };
        }
        const p = polar(VIP.front - 0.44, mid);
        return { id: s.id, x: p.x, y: VIP.floorY + 2.62, z: p.z, ry: mid * D2R + Math.PI, size: 0.32 };
      }),
    [],
  );
  const concoursePools = useMemo(() => Array.from({ length: 24 }, (_, i) => ({ ...polar(CONCOURSE.mid, i * 15 + 7.5), w: 2.6, d: 2.6 })), []);
  const coveRing = (r: number, w: number, y: number) => (
    <mesh position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={M.cove}>
      <ringGeometry args={[r, r + w, lite ? 64 : 128]} />
    </mesh>
  );

  return (
    <group>
      {/* -------- lighting: soft overhead key, sky fill, warm coves; the stage wash when live; no hot spots -------- */}
      {!lite && (
        <Environment resolution={32} frames={1} environmentIntensity={0.3}>
          <Lightformer intensity={1.0} position={[0, CEIL_Y, 0]} rotation-x={Math.PI / 2} scale={[40, 40, 1]} color="#f6eee4" />
          <Lightformer intensity={0.35} position={[0, 1, 0]} rotation-x={-Math.PI / 2} scale={[40, 40, 1]} color="#5e5660" />
        </Environment>
      )}
      <hemisphereLight ref={hemi} args={["#f6eee6", "#4a4248", lite ? 1.45 : 1.1]} />
      <ambientLight intensity={lite ? 0.32 : 0.2} />
      <directionalLight
        ref={key}
        position={[2, 30, 6]}
        intensity={lite ? 1.0 : 1.1}
        color="#fff2e2"
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
      <directionalLight position={[0, 8, 40]} intensity={0.22} color="#f5e6d2" />
      {!lite && <spotLight ref={wash} position={[0, BOARD_Y - 2.2, STAGE.z + 5]} target-position={[0, FLOOR_Y, STAGE.z]} angle={0.62} penumbra={1} decay={0} intensity={0} color="#fff1dc" />}

      {/* -------- bowl -------- */}
      <mesh ref={addPick(0)} geometry={bowl.geo.concrete} material={M.concrete} receiveShadow={!lite} />
      <mesh ref={addPick(1)} geometry={bowl.geo.floorC} material={M.floorC} receiveShadow={!lite} />
      <mesh ref={addPick(2)} geometry={bowl.geo.finish} material={M.finish} receiveShadow={!lite} />
      <mesh geometry={bowl.geo.timber} material={M.timber} />
      <mesh ref={addPick(3)} geometry={bowl.geo.dark} material={M.dark} />
      <mesh geometry={bowl.geo.warm} material={M.warm} />
      <mesh geometry={bowl.geo.accent} material={M.accent} />
      <mesh geometry={bowl.geo.glass} material={M.glass} renderOrder={2} />
      <instancedMesh ref={(o) => {
        seatRef.current = o;
        pickRefs.current[4] = o;
      }} args={[seatGeo, M.seat, BOWL_SEATS.length]} receiveShadow={false} />
      <mesh geometry={plates} material={M.plate} />
      <Instanced geometry={box} items={X.nosings} receiveShadow={false}>
        <primitive object={M.nosing} attach="material" />
      </Instanced>
      <MatrixInstances geometry={cyl} matrices={bowl.rails}>
        <primitive object={M.rail} attach="material" />
      </MatrixInstances>
      <Instanced geometry={box} items={[...X.steps, ...X.cheeks, ...X.portal]}>
        <primitive object={M.concrete} attach="material" />
      </Instanced>

      {/* LED fascia ribbons: the floor ring, the upper-tier fascia, a slim ring under the ceiling (calm motion) */}
      <mesh geometry={ribbonGeo.lower}>
        <meshBasicMaterial map={ribbons.lower} color="#bdb3cc" />
      </mesh>
      <mesh geometry={ribbonGeo.upper}>
        <meshBasicMaterial map={ribbons.upper} color="#bdb3cc" />
      </mesh>
      <mesh geometry={ribbonGeo.high}>
        <meshBasicMaterial map={ribbons.high} color="#a493c4" />
      </mesh>

      {/* -------- concourse: soft downlight pools, back-lit section signs, wayfinding totems, photo spot -------- */}
      <LightPools items={concoursePools} color="#ffe2bd" opacity={lite ? 0.1 : 0.07} y={0.012} />
      {signs.map((s) => (
        <group key={s.id} position={[s.x, s.y, s.z]} rotation={[0, s.ry, 0]}>
          <mesh position={[0, 0, -0.015]}>
            <planeGeometry args={[s.id.length > 1 ? 1.05 : 0.78, 0.66]} />
            <meshStandardMaterial color="#e9dfcd" emissive="#f3e7d2" emissiveIntensity={0.42} roughness={1} metalness={0} />
          </mesh>
          <Text font={FONT} fontSize={s.size} anchorX="center" anchorY="middle">
            {s.id}
            <meshStandardMaterial color="#2a2430" roughness={0.9} metalness={0} />
          </Text>
        </group>
      ))}
      {totems.map((t) => (
        <group key={t.deg} position={[t.p.x, 0, t.p.z]} rotation={[0, t.deg * D2R + Math.PI, 0]}>
          <mesh position={[0, 1.05, 0]} material={M.frame} castShadow={!lite}>
            <boxGeometry args={[0.56, 2.1, 0.24]} />
          </mesh>
          <mesh position={[0, 1.18, 0.125]}>
            <planeGeometry args={[0.46, 0.92]} />
            <meshBasicMaterial map={t.tex} color="#c8c2d0" />
          </mesh>
          <mesh position={[0, 2.12, 0]} material={M.wood}>
            <boxGeometry args={[0.58, 0.06, 0.26]} />
          </mesh>
        </group>
      ))}
      <group position={[PHOTO_SPOT.x, 0.01, PHOTO_SPOT.z]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.42, 0.5, 40]} />
          <meshBasicMaterial color="#d8b45a" transparent opacity={0.7} depthWrite={false} />
        </mesh>
        <Text font={FONT} fontSize={0.12} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0.68]} anchorX="center" anchorY="middle" letterSpacing={0.12}>
          PHOTO SPOT
          <meshBasicMaterial color="#d8b45a" />
        </Text>
      </group>
      {/* exits: green signs over the portal, bowl side */}
      <mesh position={[0, PORTAL_H + 0.5, CONCOURSE.r1 - 0.05]}>
        <boxGeometry args={[1.1, 0.34, 0.06]} />
        <meshStandardMaterial color="#0c5a2f" emissive="#18a050" emissiveIntensity={0.7} roughness={1} />
      </mesh>
      <Text font={FONT} fontSize={0.19} position={[0, PORTAL_H + 0.5, CONCOURSE.r1 - 0.09]} rotation={[0, Math.PI, 0]} anchorX="center" anchorY="middle" letterSpacing={0.08}>
        EXIT · PLAZA
        <meshBasicMaterial color="#e8f5ec" />
      </Text>
      {/* back-lit portal frame (warm light strip round the opening) */}
      <Instanced
        geometry={box}
        items={[
          { p: [-PORTAL_HW + 0.02, PORTAL_H / 2, CONCOURSE.r1 + 0.02], s: [0.05, PORTAL_H, 0.05] },
          { p: [PORTAL_HW - 0.02, PORTAL_H / 2, CONCOURSE.r1 + 0.02], s: [0.05, PORTAL_H, 0.05] },
          { p: [0, PORTAL_H - 0.03, CONCOURSE.r1 + 0.02], s: [PORTAL_HW * 2, 0.05, 0.05] },
        ]}
        receiveShadow={false}
      >
        <primitive object={M.cove} attach="material" />
      </Instanced>

      {/* -------- competition floor, stage, walk-in path, commentator desk -------- */}
      <mesh ref={addPick(5)} rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} receiveShadow={!lite}>
        <circleGeometry args={[FLOOR_R + 0.05, lite ? 48 : 96]} />
        <meshStandardMaterial map={floorTex} roughness={0.95} metalness={0} envMapIntensity={0.1} />
      </mesh>
      <mesh ref={addPick(6)} position={[0, FLOOR_Y + STAGE.h / 2, STAGE.z]} castShadow={!lite} receiveShadow={!lite}>
        <boxGeometry args={[STAGE.hw * 2, STAGE.h, STAGE.hd * 2]} />
        <meshStandardMaterial color="#211e25" roughness={0.95} metalness={0} envMapIntensity={0.1} />
      </mesh>
      {[
        [0, STAGE.z + STAGE.hd + 0.005, STAGE.hw * 2, 0],
        [0, STAGE.z - STAGE.hd - 0.005, STAGE.hw * 2, Math.PI],
      ].map(([x, z, w, ry], i) => (
        <mesh key={i} position={[x!, FLOOR_Y + STAGE.h / 2, z!]} rotation={[0, ry!, 0]}>
          <planeGeometry args={[w!, STAGE.h * 0.4]} />
          <meshBasicMaterial color="#56427e" />
        </mesh>
      ))}
      {/* the soft stage wash on the deck (baked; it brightens when live) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y + STAGE.h + 0.004, STAGE.z]}>
        <planeGeometry args={[STAGE.hw * 2 - 0.4, STAGE.hd * 2 - 0.4]} />
        <meshBasicMaterial ref={washDisc} color="#fff0d8" transparent opacity={0.05} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <group position={[0, FLOOR_Y + STAGE.h, 0]}>
        <PoolTables tables={feature.pool} lite={lite} />
        <LudoTables tables={feature.ludo} status={["playing"]} lite={lite} />
        <IgisoroTables layout={feature.igiLayout} status={{ t0: "playing" }} lite={lite} />
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y + 0.006, (-FLOOR_R + (STAGE.z - STAGE.hd)) / 2]}>
        <planeGeometry args={[1.8, FLOOR_R + (STAGE.z - STAGE.hd)]} />
        <meshStandardMaterial color="#3e2d60" roughness={1} metalness={0} envMapIntensity={0.05} />
      </mesh>
      <Instanced
        geometry={box}
        items={[-1, 1].map((s) => ({ p: [s * 0.95, FLOOR_Y + 0.01, (-FLOOR_R + (STAGE.z - STAGE.hd)) / 2], s: [0.05, 0.012, FLOOR_R + (STAGE.z - STAGE.hd)] }) as Xform)}
        receiveShadow={false}
      >
        <primitive object={M.nosing} attach="material" />
      </Instanced>
      <group ref={walkSpot} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1.2, 40]} />
          <meshBasicMaterial color="#fff2da" transparent opacity={0.16} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      </group>
      <Text font={FONT} fontSize={0.3} position={[0, 1.3, -CONCOURSE.r0 + 0.1]} rotation={[0, Math.PI, 0]} anchorX="center" anchorY="middle" letterSpacing={0.1}>
        PLAYERS ONLY
        <meshStandardMaterial color="#e9e3d6" roughness={0.9} metalness={0} />
      </Text>
      <Text font={FONT} fontSize={0.26} position={[0, GANTRY.y + 1.4, -(CONCOURSE.r1 + 0.1)]} anchorX="center" anchorY="middle" letterSpacing={0.12}>
        MEDIA GANTRY
        <meshStandardMaterial color="#cfc6dd" roughness={0.9} metalness={0} />
      </Text>
      <group position={[COMMENTATORS.x, FLOOR_Y, COMMENTATORS.z]}>
        <mesh position={[0, 0.5, 0]} material={M.wood} castShadow={!lite}>
          <boxGeometry args={[COMMENTATORS.w, 1.0, COMMENTATORS.d]} />
        </mesh>
        <mesh position={[0, 1.02, 0]} material={M.stone}>
          <boxGeometry args={[COMMENTATORS.w + 0.1, 0.04, COMMENTATORS.d + 0.1]} />
        </mesh>
        {[-1, 0, 1].map((k2) => (
          <mesh key={k2} position={[k2 * 0.95, 1.22, -0.2]} rotation={[-0.15, 0, 0]}>
            <boxGeometry args={[0.5, 0.32, 0.03]} />
            <meshStandardMaterial color="#1a1a1e" emissive="#3c4a66" emissiveIntensity={0.3} roughness={0.9} />
          </mesh>
        ))}
        {/* ON AIR light (lit while a staff commentator is on air) */}
        <mesh position={[0, 1.62, -0.2]}>
          <boxGeometry args={[0.5, 0.16, 0.06]} />
          <meshStandardMaterial ref={onAirMat} color="#3a1212" emissive="#e0453a" emissiveIntensity={0.05} roughness={1} />
        </mesh>
        <Text font={FONT} fontSize={0.09} position={[0, 1.62, -0.165]} anchorX="center" anchorY="middle" letterSpacing={0.12}>
          {V.onAir}
          <meshBasicMaterial color="#f3d6d2" />
        </Text>
        <Text font={FONT} fontSize={0.2} position={[0, 0.62, COMMENTATORS.d / 2 + 0.01]} anchorX="center" anchorY="middle" letterSpacing={0.14}>
          COMMENTARY
          <meshStandardMaterial color="#efe6d6" roughness={0.9} metalness={0} />
        </Text>
      </group>

      {/* -------- centre-hung board: four curved faces, an underside ring screen, a halo ring, slim truss -------- */}
      <group position={[0, BOARD_Y, 0]}>
        <mesh material={M.frame}>
          <cylinderGeometry args={[3.92, 3.92, 3.1, 32]} />
        </mesh>
        {[0, 1, 2, 3].map((q) => (
          <mesh key={q}>
            <cylinderGeometry args={[4.0, 4.0, 2.9, 24, 1, true, (q * 90 - 41) * D2R, 82 * D2R]} />
            <meshBasicMaterial map={board.texture} color="#cfc8d8" />
          </mesh>
        ))}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[0, s * 1.55, 0]} material={M.frame}>
            <cylinderGeometry args={[4.06, 4.06, 0.12, 48]} />
          </mesh>
        ))}
        <mesh position={[0, -2.0, 0]}>
          <cylinderGeometry args={[2.7, 2.7, 0.62, 48, 1, true]} />
          <meshBasicMaterial map={ribbons.lower} color="#b5abc6" />
        </mesh>
        <mesh position={[0, -2.33, 0]} material={M.frame}>
          <cylinderGeometry args={[2.72, 2.72, 0.05, 48]} />
        </mesh>
        <mesh position={[0, 1.72, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[4.25, 0.045, 8, lite ? 64 : 128]} />
          <meshBasicMaterial color={new THREE.Color("#e8cc96").multiplyScalar(0.9)} />
        </mesh>
      </group>
      <MatrixInstances geometry={cyl} matrices={roof.truss}>
        <primitive object={M.rail} attach="material" />
      </MatrixInstances>

      {/* -------- ceiling: acoustic timber ring, warm cove light rings, the dark space-frame lantern in the middle -------- */}
      <mesh position={[0, CEIL_Y, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[LANTERN_R, OUTER_R + 0.1, lite ? 64 : 128, 1]} />
        <meshStandardMaterial map={ceiling} emissiveMap={ceiling} emissive="#c9a27a" emissiveIntensity={0.5} roughness={0.95} metalness={0} envMapIntensity={0.05} />
      </mesh>
      {coveRing(LANTERN_R - 0.16, 0.16, CEIL_Y - 0.03)}
      {coveRing(17.6, 0.1, CEIL_Y - 0.03)}
      {coveRing(OUTER_R - 0.3, 0.14, CEIL_Y - 0.03)}
      <MatrixInstances geometry={cyl} matrices={roof.top}>
        <meshStandardMaterial color="#3a3940" roughness={0.9} metalness={0} envMapIntensity={0.05} />
      </MatrixInstances>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, ROOF_Y + 1.7, 0]}>
        <circleGeometry args={[LANTERN_R + 0.4, 64]} />
        <meshStandardMaterial color="#1a181e" roughness={1} metalness={0} envMapIntensity={0} />
      </mesh>
      <mesh position={[0, (CEIL_Y + ROOF_Y + 1.7) / 2, 0]}>
        <cylinderGeometry args={[LANTERN_R + 0.02, LANTERN_R + 0.02, ROOF_Y + 1.7 - CEIL_Y, 64, 1, true]} />
        <meshStandardMaterial color="#25232a" roughness={1} metalness={0} side={THREE.BackSide} />
      </mesh>

      {/* -------- lobby: polished concrete, timber slat walls, cove-lit ceiling -------- */}
      <mesh ref={addPick(7)} geometry={lobby} position={[0, 0.002, 0]} receiveShadow={!lite}>
        <meshStandardMaterial map={concTex} roughness={0.86} metalness={0} envMapIntensity={0.08} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={lobby} position={[0, LOBBY_H, 0]}>
        <meshStandardMaterial color="#e6e1d8" roughness={1} metalness={0} envMapIntensity={0.05} side={THREE.DoubleSide} />
      </mesh>
      <Instanced
        geometry={box}
        items={[
          { p: [0, LOBBY_H - 0.04, LOBBY.z1 - 0.6], s: [LOBBY.hw * 2 - 1.2, 0.03, 0.08] },
          { p: [-LOBBY.hw + 0.6, LOBBY_H - 0.04, 28], s: [0.08, 0.03, 11] },
          { p: [LOBBY.hw - 0.6, LOBBY_H - 0.04, 28], s: [0.08, 0.03, 11] },
          ...[-6, 0, 6].map((x) => ({ p: [x, LOBBY_H - 0.03, 30.4] as [number, number, number], s: [0.9, 0.02, 0.9] as [number, number, number] })),
        ]}
        receiveShadow={false}
      >
        <primitive object={M.cove} attach="material" />
      </Instanced>
      <LightPools items={[-6, 0, 6].map((x) => ({ x, z: 30.4, w: 4, d: 4 }))} color="#ffe6c8" opacity={lite ? 0.12 : 0.08} y={0.01} />
      {/* side walls (timber slats) with the restroom door openings */}
      {[-1, 1].map((s) => {
        const zc = Math.sqrt(OUTER_R * OUTER_R - LOBBY.hw * LOBBY.hw);
        const d0 = RESTROOM.doorZ - RESTROOM.doorW / 2;
        const d1 = RESTROOM.doorZ + RESTROOM.doorW / 2;
        const seg = (z0: number, z1: number, y0: number, y1: number, key2: string) => (
          <mesh key={key2} position={[s * LOBBY.hw, (y0 + y1) / 2, (z0 + z1) / 2]} rotation={[0, -s * (Math.PI / 2), 0]} material={slatMat}>
            <planeGeometry args={[z1 - z0, y1 - y0]} />
          </mesh>
        );
        return (
          <group key={s}>
            {seg(zc, d0, 0, LOBBY_H, "a")}
            {seg(d1, LOBBY.z1, 0, LOBBY_H, "b")}
            {seg(d0, d1, 2.2, LOBBY_H, "c")}
            {/* the restroom behind (a small dim room; the camera never goes in) */}
            <mesh position={[s * (LOBBY.hw + RESTROOM.depth / 2), 0.004, (RESTROOM.z0 + RESTROOM.z1) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[RESTROOM.depth, RESTROOM.z1 - RESTROOM.z0]} />
              <meshStandardMaterial color="#9a958e" roughness={0.95} />
            </mesh>
            <mesh position={[s * (LOBBY.hw + RESTROOM.depth), 1.3, (RESTROOM.z0 + RESTROOM.z1) / 2]} rotation={[0, -s * (Math.PI / 2), 0]}>
              <planeGeometry args={[RESTROOM.z1 - RESTROOM.z0, 2.6]} />
              <meshStandardMaterial color="#cfd2d0" roughness={0.95} />
            </mesh>
            {[RESTROOM.z0, RESTROOM.z1].map((z, i) => (
              <mesh key={i} position={[s * (LOBBY.hw + RESTROOM.depth / 2), 1.3, z]} rotation={[0, i ? Math.PI : 0, 0]}>
                <planeGeometry args={[RESTROOM.depth, 2.6]} />
                <meshStandardMaterial color="#cfd2d0" roughness={0.95} side={THREE.DoubleSide} />
              </mesh>
            ))}
            <mesh position={[s * (LOBBY.hw + RESTROOM.depth / 2), 2.6, (RESTROOM.z0 + RESTROOM.z1) / 2]} rotation={[Math.PI / 2, 0, 0]}>
              <planeGeometry args={[RESTROOM.depth, RESTROOM.z1 - RESTROOM.z0]} />
              <meshStandardMaterial color="#bfc2c0" roughness={1} />
            </mesh>
            {/* the door (hinged at its south edge) */}
            <group ref={s < 0 ? doorW : doorE} position={[s * (LOBBY.hw + 0.02), 0, d0]}>
              <mesh position={[0, 1.1, RESTROOM.doorW / 2]} material={M.wood}>
                <boxGeometry args={[0.04, 2.18, RESTROOM.doorW - 0.04]} />
              </mesh>
            </group>
            <Text font={FONT} fontSize={0.2} position={[s * (LOBBY.hw - 0.03), 2.5, RESTROOM.doorZ]} rotation={[0, -s * (Math.PI / 2), 0]} anchorX="center" anchorY="middle" letterSpacing={0.12}>
              RESTROOMS
              <meshStandardMaterial color="#f1e9dc" roughness={0.9} metalness={0} />
            </Text>
          </group>
        );
      })}
      <SouthWall layout={southLayout}>
        <primitive object={slatMat} attach="material" />
      </SouthWall>
      <mesh position={[0, PORTAL_H + 0.55, OUTER_R + 0.08]}>
        <planeGeometry args={[10.6, 0.72]} />
        <meshStandardMaterial color="#e9dfcd" emissive="#f3e7d2" emissiveIntensity={0.4} roughness={1} metalness={0} />
      </mesh>
      <Text font={FONT} fontSize={0.32} position={[0, PORTAL_H + 0.55, OUTER_R + 0.1]} anchorX="center" anchorY="middle" letterSpacing={0.1}>
        BOWL · LOWER A–L · UPPER U1–U8 · VIP V1–V4
        <meshStandardMaterial color="#2a2430" roughness={0.9} metalness={0} />
      </Text>
      {/* ticket & info kiosk: timber front, stone top, an Imigongo accent strip, screen and sign */}
      <group position={[KIOSK.x, 0, KIOSK.z]}>
        <mesh position={[0, 0.55, 0]} material={M.wood} castShadow={!lite}>
          <boxGeometry args={[KIOSK.w, 1.1, KIOSK.d]} />
        </mesh>
        <mesh position={[0, 0.85, KIOSK.d / 2 + 0.005]} material={M.accent}>
          <planeGeometry args={[KIOSK.w - 0.2, 0.14]} />
        </mesh>
        <mesh position={[0, 1.12, 0]} material={M.stone}>
          <boxGeometry args={[KIOSK.w + 0.1, 0.05, KIOSK.d + 0.1]} />
        </mesh>
        <mesh position={[0, 2.4, -0.4]} material={M.frame}>
          <boxGeometry args={[KIOSK.w, 0.7, 0.08]} />
        </mesh>
        <Text font={FONT} fontSize={0.3} position={[0, 2.4, -0.35]} anchorX="center" anchorY="middle" letterSpacing={0.12}>
          TICKETS · INFO
          <meshStandardMaterial color="#efe9dc" roughness={0.9} metalness={0} />
        </Text>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * (KIOSK.w / 2 - 0.1), 1.75, -0.4]} material={M.rail}>
            <boxGeometry args={[0.06, 1.3, 0.06]} />
          </mesh>
        ))}
      </group>
      {/* event board */}
      <group position={[EVENT_BOARD.x, 0, EVENT_BOARD.z]}>
        <mesh position={[0, 1.95, 0]} material={M.frame}>
          <boxGeometry args={[3.35, 1.95, 0.12]} />
        </mesh>
        <mesh position={[0, 1.95, 0.065]}>
          <planeGeometry args={[3.2, 1.8]} />
          <meshBasicMaterial map={lobbyBoard.texture} color="#cfc8d8" />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 1.4, 0.5, 0]} material={M.rail}>
            <boxGeometry args={[0.08, 1.0, 0.08]} />
          </mesh>
        ))}
      </group>
      {/* concession frontage: timber counters, stone tops, menu screens */}
      {CONCESSIONS.map((c, i) => {
        const s = Math.sign(c.x);
        return (
          <group key={i}>
            <mesh position={[c.x, 0.55, c.z]} material={M.wood} castShadow={!lite}>
              <boxGeometry args={[c.w, 1.1, c.d]} />
            </mesh>
            <mesh position={[c.x, 1.12, c.z]} material={M.stone}>
              <boxGeometry args={[c.w + 0.15, 0.05, c.d + 0.1]} />
            </mesh>
            {[-1.4, 1.4].map((dz, j) => (
              <group key={j} position={[s * (LOBBY.hw - 0.04), 2.75, c.z + dz]} rotation={[0, -s * (Math.PI / 2), 0]}>
                <mesh material={M.frame}>
                  <boxGeometry args={[2.3, 1.2, 0.04]} />
                </mesh>
                <mesh position={[0, 0, 0.025]}>
                  <planeGeometry args={[2.2, 1.1]} />
                  <meshBasicMaterial map={menus[i]} color="#cbc4d4" />
                </mesh>
              </group>
            ))}
          </group>
        );
      })}
      <GltfInstances
        url={model("potted_plant_02")}
        items={[
          { p: [-LOBBY.hw + 0.8, 0, 23.4], s: 1.5, r: 0.3 },
          { p: [LOBBY.hw - 0.8, 0, 23.4], s: 1.5, r: 2.1 },
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
      <meshBasicMaterial color="#d8b45a" transparent opacity={0.85} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

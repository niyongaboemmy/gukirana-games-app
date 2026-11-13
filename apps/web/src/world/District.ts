import * as THREE from "three";
import { GeoBatch } from "./geo";
import { LAMPS } from "./obstacles";
import { BENCHES, DOOR, DOOR_RING, FOUNTAIN_RADIUS, PORTALS, ringPoint, SERVICE_ANGLE, SPAWN, TOTEMS, type PortalDef } from "./layout";

/**
 * Static architecture of the Gukirana Arena District, authored as primitives and merged per material (geo.ts).
 * Every building is built in a local frame: door centre at the origin, facade facing +z (towards the fountain),
 * the volume extending to −z. Dimensions in metres; see docs/WORLD-ARENA-DESIGN.md §5–6.
 */

export const ARENA = { cz: -22, rx: 21, rz: 17, wall: 18.5 };

/** Wall with a door opening, centred on x = 0. */
function wallWithDoor(b: GeoBatch, key: string, w: number, h: number, z: number, t: number, tile: number) {
  const ow = DOOR.w + 0.4;
  const oh = DOOR.h + 0.2;
  const side = (w - ow) / 2;
  b.box(key, side, h, t, { p: [-(ow / 2 + side / 2), h / 2, z], tile });
  b.box(key, side, h, t, { p: [ow / 2 + side / 2, h / 2, z], tile });
  if (h > oh) b.box(key, ow, h - oh, t, { p: [0, oh + (h - oh) / 2, z], tile });
}

/** Aluminium door surround with an LED trim in the game colour, plus a basalt threshold. */
function doorSurround(b: GeoBatch, led: string, z = 0) {
  const hw = DOOR.w / 2;
  b.box("alu", 0.16, DOOR.h + 0.16, 0.36, { p: [-(hw + 0.08), (DOOR.h + 0.16) / 2, z] });
  b.box("alu", 0.16, DOOR.h + 0.16, 0.36, { p: [hw + 0.08, (DOOR.h + 0.16) / 2, z] });
  b.box("alu", DOOR.w + 0.32, 0.16, 0.36, { p: [0, DOOR.h + 0.08, z] });
  b.box(led, 0.06, DOOR.h + 0.2, 0.06, { p: [-(hw + 0.2), (DOOR.h + 0.2) / 2, z + 0.2] });
  b.box(led, 0.06, DOOR.h + 0.2, 0.06, { p: [hw + 0.2, (DOOR.h + 0.2) / 2, z + 0.2] });
  b.box(led, DOOR.w + 0.46, 0.06, 0.06, { p: [0, DOOR.h + 0.23, z + 0.2] });
  b.box("lava", DOOR.w + 1.2, 0.06, 1.6, { p: [0, 0.03, z + 0.7], tile: 1.2 });
}

/** Heavy basalt entrance pylons with Imigongo diamond inlays — the "arena door" read from across the plaza. */
function pylons(b: GeoBatch, h = 5.0, z = 0.35) {
  for (const s of [-1, 1]) {
    b.box("lava", 0.9, h, 1.0, { p: [s * 2.35, h / 2, z], tile: 1.2 });
    b.box("diamond", 0.56, h - 0.8, 0.04, { p: [s * 2.35, h / 2, z + 0.51], uv: [1, 6] });
  }
  b.box("lava", 5.6, 0.8, 1.0, { p: [0, h + 0.4, z], tile: 1.2 });
}

function poolHall(b: GeoBatch) {
  const W = 14;
  const D = 13;
  const H = 7.5;
  // volume: dark board-formed concrete, basalt base course
  b.box("concreteDark", 0.4, H, D, { p: [-W / 2 + 0.2, H / 2, -D / 2], tile: 2 });
  b.box("concreteDark", 0.4, H, D, { p: [W / 2 - 0.2, H / 2, -D / 2], tile: 2 });
  b.box("concreteDark", W, H, 0.4, { p: [0, H / 2, -D + 0.2], tile: 2 });
  for (const s of [-1, 1]) b.box("lava", 0.12, 1.0, D, { p: [s * (W / 2 + 0.06), 0.5, -D / 2], tile: 1.2 });
  b.box("lava", W + 0.24, 1.0, 0.12, { p: [0, 0.5, -D - 0.06], tile: 1.2 });
  wallWithDoor(b, "glass", W - 0.8, H - 0.2, -0.6, 0.12, 3);
  // vertical timber fins (sun screen) in front of the glass, clear of the door zone
  for (let x = -W / 2 + 0.6; x <= W / 2 - 0.5; x += 0.62) {
    if (Math.abs(x) < 3.0) continue;
    b.box("woodDark", 0.1, H - 0.3, 0.55, { p: [x, (H - 0.3) / 2, -0.2], tile: 1 });
  }
  // roof slab + fascia with LED ribbon
  b.box("concreteDark", W + 1.2, 0.9, D + 1.6, { p: [0, H + 0.45, -D / 2 + 0.6], tile: 2 });
  b.box("led-pool", W + 1.24, 0.12, 0.06, { p: [0, H + 0.12, 1.42] });
  b.box("led-pool", 0.06, 0.12, D + 1.6, { p: [-(W / 2 + 0.62), H + 0.12, -D / 2 + 0.6] });
  b.box("led-pool", 0.06, 0.12, D + 1.6, { p: [W / 2 + 0.62, H + 0.12, -D / 2 + 0.6] });
  pylons(b);
  doorSurround(b, "led-pool", -0.5);
  // rooftop plant + lamp over the hall's signature tables (seen from far)
  b.box("steel", 3, 1.2, 2, { p: [3.5, H + 1.5, -8] });
}

function ludoLounge(b: GeoBatch) {
  const W = 14;
  const D = 13;
  const H = 5.6;
  b.box("brick", 0.45, H, D, { p: [-W / 2 + 0.22, H / 2, -D / 2], tile: 1 });
  b.box("brick", 0.45, H, D, { p: [W / 2 - 0.22, H / 2, -D / 2], tile: 1 });
  b.box("brick", W, H, 0.45, { p: [0, H / 2, -D + 0.22], tile: 1 });
  wallWithDoor(b, "glass", W - 0.9, H, -0.4, 0.12, 3);
  // brick piers framing the shopfront
  for (const x of [-6.6, -4.4, 4.4, 6.6]) b.box("brick", 0.6, H, 0.6, { p: [x, H / 2, -0.15], tile: 1 });
  b.box("concrete", W + 0.6, 0.5, D + 0.6, { p: [0, H + 0.25, -D / 2], tile: 2 });
  // rooftop garden terrace: glass balustrade, pergola with LED strings, umbrellas, planters
  const R = H + 0.5;
  b.box("glassCool", W, 1.1, 0.05, { p: [0, R + 0.55, 0.2] });
  for (const s of [-1, 1]) b.box("glassCool", 0.05, 1.1, D, { p: [s * (W / 2 + 0.2), R + 0.55, -D / 2] });
  for (const [x, z] of [
    [-5.5, -1.5],
    [5.5, -1.5],
    [-5.5, -7.5],
    [5.5, -7.5],
  ] as const)
    b.box("wood", 0.2, 3, 0.2, { p: [x, R + 1.5, z], tile: 1 });
  for (let z = -1.5; z >= -7.5; z -= 1.5) {
    b.box("wood", 11.4, 0.18, 0.12, { p: [0, R + 3.05, z], tile: 1 });
    b.box("led-ludo", 11.2, 0.04, 0.04, { p: [0, R + 2.9, z] });
  }
  for (const [x, z, k] of [
    [-3.2, -10.2, "paint-teal"],
    [0.2, -10.6, "paint-pink"],
    [3.6, -10.1, "paint-orange"],
  ] as const) {
    b.cyl("steel", 0.04, 0.04, 2.4, 6, { p: [x, R + 1.2, z] });
    b.add(k, new THREE.ConeGeometry(1.4, 0.6, 12, 1, true), { p: [x, R + 2.4, z] });
  }
  for (const x of [-5, 5]) b.box("hedge", 2.2, 0.7, 1.2, { p: [x, R + 0.35, -11.5] });
  b.box("led-ludo", W + 0.64, 0.12, 0.06, { p: [0, H + 0.1, 0.32] });
  doorSurround(b, "led-ludo", -0.35);
  pylons(b, 4.6);
}

function igisoroCourt(b: GeoBatch) {
  const R = 7;
  const cz = -8.6;
  const H = 4.8;
  const circ = Math.PI * 2 * R;
  b.cyl("white", R, R, H, 40, { p: [0, H / 2, cz] });
  b.cyl("lava", R + 0.08, R + 0.12, 0.9, 40, { p: [0, 0.45, cz], uv: [circ / 1.2, 0.9 / 1.2] }, true);
  b.cyl("imigongo", R + 0.05, R + 0.05, 1.1, 40, { p: [0, H - 0.85, cz], uv: [circ / 4.4, 1] }, true);
  // conical roof inspired by the royal hut of Nyanza and the Agaseke lid
  b.add("thatch", new THREE.ConeGeometry(R + 2.2, 6.4, 40, 1, true), { p: [0, H + 3.2, cz], uv: [18, 3] });
  b.add("woodDark", new THREE.ConeGeometry(0.5, 1.6, 12), { p: [0, H + 6.9, cz] });
  b.add("led-igisoro", new THREE.TorusGeometry(R + 2.15, 0.05, 6, 64), { p: [0, H + 0.05, cz], r: [Math.PI / 2, 0, 0] });
  // timber porch
  b.box("wood", 6.4, 0.3, 3.4, { p: [0, 4.9, -0.9], tile: 1 });
  for (const x of [-2.9, 2.9]) b.cyl("woodDark", 0.16, 0.18, 4.75, 10, { p: [x, 2.37, 0.5] });
  wallWithDoor(b, "lava", 6.2, 4.8, -2.4, 0.5, 1.2);
  doorSurround(b, "led-igisoro", -2.1);
  // carved benches either side of the porch
  for (const x of [-2.2, 2.2]) b.box("woodDark", 1.4, 0.45, 0.5, { p: [x, 0.23, -1.6], tile: 1 });
}

function tournamentArena(b: GeoBatch, tier: string) {
  const { cz, rx, rz, wall } = ARENA;
  const seg = tier === "lite" ? 48 : 72;
  const perim = Math.PI * Math.sqrt(2 * (rx * rx + rz * rz));
  // basalt plinth, glass concourse level, concourse slab
  b.add("lava", new THREE.CylinderGeometry(1, 1, 1.2, seg, 1, true), { p: [0, 0.6, cz], s: [rx + 0.4, 1, rz + 0.4], uv: [perim / 1.2, 1] });
  b.add("glass", new THREE.CylinderGeometry(1, 1, 6, seg, 1, true), { p: [0, 4.2, cz], s: [rx - 0.3, 1, rz - 0.3], uv: [perim / 3, 2] });
  b.add("white", new THREE.CylinderGeometry(1, 1, 0.6, seg), { p: [0, 7.4, cz], s: [rx + 0.6, 1, rz + 0.6] });
  // dark inner drum behind the pleated skin
  b.add("diamondDark", new THREE.CylinderGeometry(1, 1, wall - 7.7, seg, 1, true), {
    p: [0, 7.7 + (wall - 7.7) / 2, cz],
    s: [rx - 0.6, 1, rz - 0.6],
    uv: [perim / 3, 3],
  });
  // pleated Imigongo skin: tilted panels around the ellipse create the rhythm of light and shadow
  const panels = tier === "lite" ? 44 : 64;
  for (let i = 0; i < panels; i++) {
    const a = (i / panels) * Math.PI * 2;
    const x = Math.sin(a) * (rx + 0.2);
    const z = cz + Math.cos(a) * (rz + 0.2);
    const tangent = Math.atan2(Math.cos(a) * rx, -Math.sin(a) * rz);
    b.box("diamond", (perim / panels) * 1.05, wall - 8.2, 0.12, {
      p: [x, 8.0 + (wall - 8.2) / 2, z],
      r: [0, tangent + Math.PI / 2 + 0.32, 0],
      uv: [1, 4],
    });
  }
  // LED ribbon bands (colour-cycling material "led-halo") + roof fascia
  b.add("led-halo", new THREE.CylinderGeometry(1, 1, 0.32, seg, 1, true), { p: [0, 7.9, cz], s: [rx + 0.65, 1, rz + 0.65] });
  b.add("white", new THREE.CylinderGeometry(1, 1, 1.1, seg, 1, true), { p: [0, wall + 0.4, cz], s: [rx + 0.5, 1, rz + 0.5] });
  b.add("led-halo", new THREE.CylinderGeometry(1, 1, 0.22, seg, 1, true), { p: [0, wall - 0.3, cz], s: [rx + 0.55, 1, rz + 0.55] });
  // space-frame roof: shallow aluminium dome with radial ribs
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(Math.cos((t * Math.PI) / 2) * 1, Math.sin((t * Math.PI) / 2) * 1));
  }
  b.add("alu", new THREE.LatheGeometry(pts.reverse(), seg), { p: [0, wall + 0.9, cz], s: [rx + 0.45, 5.5, rz + 0.45] });
  // space-frame ring trusses following the dome
  for (const [k, y] of [
    [0.82, 2.0],
    [0.55, 4.0],
    [0.3, 5.0],
  ] as const)
    b.add("steel", new THREE.TorusGeometry(1, 0.012, 4, seg), { p: [0, wall + 0.9 + y * 1.03, cz], r: [Math.PI / 2, 0, 0], s: [(rx + 0.45) * k, (rz + 0.45) * k, 12] });
  b.add("led-halo", new THREE.TorusGeometry(3, 0.12, 6, 32), { p: [0, wall + 6.35, cz], r: [Math.PI / 2, 0, 0] });
  // entrance: glass foyer, cantilevered canopy on slender columns, LED soffit lines
  b.box("glass", 12, 6.2, 0.14, { p: [-0, 3.1, -1.3], tile: 3 });
  for (const s of [-1, 1]) b.box("glass", 0.14, 6.2, 4.2, { p: [s * 6, 3.1, -3.4], tile: 3 });
  b.box("white", 22, 0.45, 9, { p: [0, 7.0, -2.5] });
  b.box("alu", 22.1, 0.12, 9.1, { p: [0, 6.73, -2.5] });
  for (let x = -9; x <= 9; x += 3) b.box("led-warm", 0.08, 0.04, 8.6, { p: [x, 6.65, -2.5] });
  b.box("led-arena", 22.1, 0.08, 0.08, { p: [0, 7.27, 2.03] });
  for (const x of [-10.2, -5, 5, 10.2]) b.cyl("steel", 0.14, 0.18, 6.8, 10, { p: [x, 3.4, 1.4] });
  b.add("white", new THREE.BoxGeometry(12.4, 6.2, 0.3), { p: [0, 3.1, -1.5] });
  // main LED screen frame on the drum (screen surface itself is animated, see Plaza.tsx)
  b.box("screenFrame", 17, 5.4, 0.5, { p: [0, 12.6, cz + rz + 0.9] });
  doorSurround(b, "led-arena", -1.1);
  wallWithDoor(b, "white", 12.4, 6.2, -1.3, 0.32, 2);
  // flagpoles
  for (const x of [-13, -11, 11, 13]) b.cyl("alu", 0.05, 0.07, 11, 8, { p: [x, 5.5, 3] });
}

function comingSoon(b: GeoBatch, tier: string) {
  // hoarding fence with a gate (the "door"), concrete frame under construction, tower crane
  for (const s of [-1, 1]) b.box("hoarding", 4.8, 2.6, 0.12, { p: [s * 4.2, 1.3, -0.4] });
  b.box("steel", 3.6, 0.3, 0.2, { p: [0, 4.35, -0.4] });
  for (const s of [-1, 1]) b.box("steel", 0.2, 4.5, 0.2, { p: [s * 1.75, 2.25, -0.4] });
  for (const [x, z] of [
    [-4, -2.5],
    [4, -2.5],
    [-4, -9],
    [4, -9],
  ] as const)
    b.box("concrete", 0.5, 7.5, 0.5, { p: [x, 3.75, z], tile: 2 });
  b.box("concrete", 9, 0.35, 7.2, { p: [0, 3.6, -5.75], tile: 2 });
  b.box("concrete", 9, 0.35, 7.2, { p: [0, 7.4, -5.75], tile: 2 });
  if (tier !== "lite")
    for (let x = -4.5; x <= 4.5; x += 1.5) {
      b.box("steel", 0.06, 7.5, 0.06, { p: [x, 3.75, -1.8] });
      b.box("steel", 0.06, 0.06, 1.0, { p: [x, 5.5, -2.3] });
    }
  // tower crane
  const cx = 2;
  const cz = -12;
  b.box("paint-yellow", 0.9, 26, 0.9, { p: [cx, 13, cz] });
  b.box("paint-yellow", 0.7, 0.9, 24, { p: [cx, 26.4, cz + 4] });
  b.box("concreteDark", 2, 1.6, 2.4, { p: [cx, 26, cz - 6.5] });
  b.box("white", 1.4, 1.4, 1.4, { p: [cx + 1.1, 25.2, cz] });
  b.box("led-red", 0.3, 0.3, 0.3, { p: [cx, 27.1, cz + 15.8] });
  b.cyl("steel", 0.02, 0.02, 9, 4, { p: [cx, 21.5, cz + 11] });
  doorSurround(b, "led-soon", -0.4);
}

function servicePavilion(b: GeoBatch) {
  b.box("glassCool", 8, 4, 0.12, { p: [0, 2, -1.5], tile: 3 });
  for (const s of [-1, 1]) b.box("glassCool", 0.12, 4, 5, { p: [s * 4, 2, -4], tile: 3 });
  b.box("wood", 10, 0.4, 8, { p: [0, 4.2, -3.5], tile: 1 });
  b.box("led-sky", 10.04, 0.1, 0.06, { p: [0, 4.05, 0.52] });
  b.box("lava", 8, 4, 0.4, { p: [0, 2, -6.5], tile: 1.2 });
  b.box("white", 2.6, 1.05, 0.7, { p: [0, 0.52, -3.2] });
}

/** Paving, basalt bands, LED wayfinding inlays, fountain, Agaseke sculpture, benches, lamps, planters, totems. */
function plaza(b: GeoBatch, tier: string) {
  const flat = (geo: THREE.BufferGeometry) => geo.rotateX(-Math.PI / 2);
  b.add("paving", flat(new THREE.CircleGeometry(32.5, tier === "lite" ? 64 : 128)), { p: [0, 0, 0], tile: 4 });
  for (const [r0, r1, k] of [
    [7.6, 7.9, "concreteDark"],
    [15.75, 15.95, "concreteDark"],
    [32.5, 33.3, "lava"],
  ] as const)
    b.add(k, flat(new THREE.RingGeometry(r0, r1, 128, 1)), { p: [0, 0.012, 0], tile: 1.2 });
  // wayfinding: an LED line in each game's colour from the fountain to its door (§6.2)
  for (const p of PORTALS) {
    const key = p.kind === "soon" ? "led-soon" : `led-${p.kind}`;
    const len = DOOR_RING - 3 - (FOUNTAIN_RADIUS + 1.2);
    const mid = ringPoint(p.angleDeg, FOUNTAIN_RADIUS + 1.2 + len / 2);
    b.box(key, 0.12, 0.02, len, { p: [mid.x, 0.012, mid.z], r: [0, mid.rotY, 0] });
    for (const off of [-0.5, 0.5]) {
      const o = ringPoint(p.angleDeg + 90, off);
      b.box("lava", 0.25, 0.015, len, { p: [mid.x + o.x, 0.008, mid.z + o.z], r: [0, mid.rotY, 0], tile: 1.2 });
    }
  }
  // spawn medallion
  b.add("led-sky", flat(new THREE.RingGeometry(1.15, 1.3, 48)), { p: [SPAWN.x, 0.016, SPAWN.z] });
  b.add("lava", flat(new THREE.CircleGeometry(1.15, 48)), { p: [SPAWN.x, 0.014, SPAWN.z], tile: 1.2 });

  // fountain: basalt basin, white coping, water and jets; Agaseke sculpture on a plinth
  b.cyl("lava", FOUNTAIN_RADIUS, FOUNTAIN_RADIUS + 0.15, 0.55, 64, { p: [0, 0.27, 0], uv: [18, 0.5] });
  b.add("white", flat(new THREE.RingGeometry(FOUNTAIN_RADIUS - 0.35, FOUNTAIN_RADIUS + 0.05, 64, 1)), { p: [0, 0.56, 0] });
  b.cyl("lava", 1.0, 1.15, 0.9, 32, { p: [0, 0.6, 0], uv: [5, 0.8] });
  const prof: [number, number][] = [
    [0.001, 0],
    [0.5, 0],
    [0.64, 0.12],
    [0.78, 0.5],
    [0.8, 0.9],
    [0.7, 1.22],
    [0.6, 1.3],
    [0.68, 1.34],
    [0.64, 1.5],
    [0.5, 1.9],
    [0.32, 2.35],
    [0.16, 2.75],
    [0.07, 3.0],
    [0.001, 3.12],
  ];
  b.add("agaseke", new THREE.LatheGeometry(
    prof.map(([r, y]) => new THREE.Vector2(r, y)),
    tier === "lite" ? 20 : 40,
  ), { p: [0, 1.05, 0], s: [1.25, 1.25, 1.25], uv: [6, 1] });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.add("jet", new THREE.TorusGeometry(1.05, 0.035, 5, 16, Math.PI), {
      p: [Math.sin(a) * 2.2, 0.5, Math.cos(a) * 2.2],
      r: [0, a + Math.PI / 2, 0],
    });
  }

  // benches
  for (const bench of BENCHES) {
    b.frame([bench.x, 0, bench.z], bench.rotY, () => {
      for (const s of [-1, 1]) b.box("lava", 0.35, 0.42, 0.5, { p: [s * 0.8, 0.21, 0], tile: 1.2 });
      b.box("wood", 2.1, 0.08, 0.55, { p: [0, 0.46, 0], tile: 1 });
    });
  }
  // lamp posts with warm LED heads
  // (same 12 posts the player collides with: world/obstacles.ts LAMPS)
  for (const p of LAMPS) {
    b.cyl("steel", 0.06, 0.09, 4.6, 8, { p: [p.x, 2.3, p.z] });
    b.box("steel", 0.9, 0.12, 0.28, { p: [p.x, 4.6, p.z], r: [0, p.rotY, 0] });
    b.box("led-warm", 0.8, 0.03, 0.2, { p: [p.x, 4.53, p.z], r: [0, p.rotY, 0] });
  }
  // planters: modern raised flower planters are drawn by world/Flowers.tsx
  // totems (screens are dynamic Text)
  for (const t of TOTEMS) {
    b.frame([t.x, 0, t.z], t.rotY, () => {
      b.box("screenFrame", 2.4, 3.4, 0.3, { p: [0, 1.95, 0] });
      b.box("lava", 1.2, 0.3, 0.7, { p: [0, 0.15, 0], tile: 1.2 });
      b.box(t.id === "wallet" ? "led-gold" : "led-sky", 2.44, 0.06, 0.32, { p: [0, 3.65, 0] });
    });
  }
  // perimeter: low black lava-rock walls between the buildings (typical Musanze dry-stone walls) + road ring
  for (let deg = -180; deg < 180; deg += 6) {
    const near = [...PORTALS.map((p) => p.angleDeg), SERVICE_ANGLE].some((a) => Math.abs(((deg - a + 540) % 360) - 180) < 12);
    if (near || Math.abs(deg) > 168) continue;
    const p = ringPoint(deg + 3, 34);
    b.box("lava", 3.6, 0.8, 0.6, { p: [p.x, 0.4, p.z], r: [0, p.rotY, 0], tile: 1.2 });
  }
  b.add("asphalt", flat(new THREE.RingGeometry(74, 81, 160, 1)), { p: [0, 0.01, 0], tile: 3 });
  b.add("white", flat(new THREE.RingGeometry(77.42, 77.58, 160, 1)), { p: [0, 0.02, 0] });
  // approach avenue from the south (spawn side) to the road
  b.box("paving", 8, 0.02, 41, { p: [0, 0.0, 53.5], tile: 4 });
}

export function buildDistrict(tier: string): Map<string, THREE.BufferGeometry> {
  const b = new GeoBatch();
  plaza(b, tier);
  const builders: Record<PortalDef["kind"], (b: GeoBatch, tier: string) => void> = {
    pool: poolHall,
    ludo: ludoLounge,
    igisoro: igisoroCourt,
    arena: tournamentArena,
    soon: comingSoon,
  };
  for (const p of PORTALS) {
    const d = ringPoint(p.angleDeg, DOOR_RING);
    b.frame([d.x, 0, d.z], d.rotY, () => builders[p.kind](b, tier));
  }
  const s = ringPoint(SERVICE_ANGLE, DOOR_RING);
  b.frame([s.x, 0, s.z], s.rotY, () => servicePavilion(b));
  return b.build();
}

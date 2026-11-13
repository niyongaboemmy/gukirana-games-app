import * as THREE from "three";
import { GeoBatch } from "./geo";
import { LAMPS } from "./obstacles";
import { RING_PLANTERS } from "./beds";
import { BENCHES, DOOR, DOOR_RING, FOUNTAIN_RADIUS, PORTALS, ringPoint, SERVICE_ANGLE, SPAWN, TOTEMS, type PortalDef } from "./layout";

/**
 * Static architecture of the Gukirana Arena District, authored as primitives and merged per material (geo.ts).
 * Every building is built in a local frame: door centre at the origin, facade facing +z (towards the fountain),
 * the volume extending to −z. Dimensions in metres; see docs/WORLD-ARENA-DESIGN.md §5–6.
 *
 * Exterior scale matches the hall interiors (24 × 18 m): each hall is an entrance wing on the plaza ring with the
 * full-size hall behind it, offset away from its neighbours so the wedge between doors stays open. The doors and
 * their positions on the ring (DOOR_RING, PORTALS) never move.
 */

export const ARENA = { cz: -22, rx: 18, rz: 16, wall: 18.5 };

/** Building footprints (local rectangles, incl. roof overhangs) — keeps the perimeter walls out of the halls. */
export const FOOTPRINTS: Record<PortalDef["kind"] | "service", { x0: number; x1: number; z0: number; z1: number }[]> = {
  pool: [
    { x0: -7.6, x1: 7.6, z0: 1.6, z1: -8 },
    { x0: -15.4, x1: 9.4, z0: -8, z1: -26.4 },
  ],
  ludo: [
    { x0: -7.6, x1: 7.6, z0: 1.6, z1: -8 },
    { x0: -9.4, x1: 15.4, z0: -8, z1: -26.4 },
  ],
  igisoro: [{ x0: -15.4, x1: 11.4, z0: 1, z1: -21.8 }],
  arena: [{ x0: -19, x1: 19, z0: 3, z1: -39 }],
  soon: [{ x0: -5.2, x1: 5.2, z0: 0.5, z1: -10 }],
  service: [{ x0: -5.2, x1: 5.2, z0: 0.6, z1: -7 }],
};

/** Wall with a door opening, centred on x = 0. */
function wallWithDoor(b: GeoBatch, key: string, w: number, h: number, z: number, t: number, tile: number) {
  const ow = DOOR.w + 0.4;
  const oh = DOOR.h + 0.2;
  const side = (w - ow) / 2;
  b.box(key, side, h, t, { p: [-(ow / 2 + side / 2), h / 2, z], tile });
  b.box(key, side, h, t, { p: [ow / 2 + side / 2, h / 2, z], tile });
  if (h > oh) b.box(key, ow, h - oh, t, { p: [0, oh + (h - oh) / 2, z], tile });
}

/** Aluminium door surround with a slim LED trim in the game colour, plus a basalt threshold. */
function doorSurround(b: GeoBatch, led: string, z = 0) {
  const hw = DOOR.w / 2;
  b.box("alu", 0.16, DOOR.h + 0.16, 0.36, { p: [-(hw + 0.08), (DOOR.h + 0.16) / 2, z] });
  b.box("alu", 0.16, DOOR.h + 0.16, 0.36, { p: [hw + 0.08, (DOOR.h + 0.16) / 2, z] });
  b.box("alu", DOOR.w + 0.32, 0.16, 0.36, { p: [0, DOOR.h + 0.08, z] });
  b.box(led, 0.03, DOOR.h + 0.2, 0.03, { p: [-(hw + 0.19), (DOOR.h + 0.2) / 2, z + 0.19] });
  b.box(led, 0.03, DOOR.h + 0.2, 0.03, { p: [hw + 0.19, (DOOR.h + 0.2) / 2, z + 0.19] });
  b.box(led, DOOR.w + 0.41, 0.03, 0.03, { p: [0, DOOR.h + 0.2, z + 0.19] });
  b.box("basalt", DOOR.w + 1.2, 0.04, 1.6, { p: [0, 0.02, z + 0.7], tile: 1.2 });
}

/** Heavy basalt entrance pylons with Imigongo diamond inlays — the "arena door" read from across the plaza. */
function pylons(b: GeoBatch, h = 5.0, z = 0.35) {
  for (const s of [-1, 1]) {
    b.box("lava", 0.9, h, 1.0, { p: [s * 2.35, h / 2, z], tile: 1.2 });
    b.box("diamond", 0.56, h - 0.8, 0.04, { p: [s * 2.35, h / 2, z + 0.51], uv: [1, 6] });
  }
  b.box("lava", 5.6, 0.8, 1.0, { p: [0, h + 0.4, z], tile: 1.2 });
}

/** Full-size hall volume behind an entrance wing: walls, basalt base course, roof slab with parapet. */
function hallVolume(b: GeoBatch, wall: string, x0: number, x1: number, z0: number, z1: number, H: number, tile: number) {
  const W = x1 - x0;
  const D = z0 - z1;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const t = 0.4;
  b.box(wall, t, H, D, { p: [x0 + t / 2, H / 2, cz], tile });
  b.box(wall, t, H, D, { p: [x1 - t / 2, H / 2, cz], tile });
  b.box(wall, W, H, t, { p: [cx, H / 2, z1 + t / 2], tile });
  b.box(wall, W, H, t, { p: [cx, H / 2, z0 - t / 2], tile });
  // basalt base course
  for (const x of [x0 - 0.06, x1 + 0.06]) b.box("lava", 0.12, 1.0, D, { p: [x, 0.5, cz], tile: 1.2 });
  b.box("lava", W + 0.24, 1.0, 0.12, { p: [cx, 0.5, z1 - 0.06], tile: 1.2 });
  for (const s of [-1, 1]) {
    // front shoulders either side of the entrance wing
    const xa = s < 0 ? x0 : 7.6;
    const xb = s < 0 ? -7.6 : x1;
    if (xb - xa > 0.2) b.box("lava", xb - xa, 1.0, 0.12, { p: [(xa + xb) / 2, 0.5, z0 + 0.06], tile: 1.2 });
  }
  // roof slab + parapet
  b.box("concrete", W + 0.4, 0.5, D + 0.4, { p: [cx, H + 0.25, cz], tile: 2 });
  b.box("concrete", W + 0.4, 0.6, 0.2, { p: [cx, H + 0.8, z1 - 0.1], tile: 2 });
  b.box("concrete", W + 0.4, 0.6, 0.2, { p: [cx, H + 0.8, z0 + 0.1], tile: 2 });
  for (const x of [x0 - 0.1, x1 + 0.1]) b.box("concrete", 0.2, 0.6, D + 0.4, { p: [x, H + 0.8, cz], tile: 2 });
}

/** Ribbon window along a side wall (glazing flush with the outside face). */
function ribbon(b: GeoBatch, x: number, z0: number, z1: number, y: number, h: number) {
  b.box("glass", 0.06, h, z0 - z1, { p: [x, y, (z0 + z1) / 2], tile: 6 });
  b.box("alu", 0.14, 0.08, z0 - z1, { p: [x, y - h / 2 - 0.04, (z0 + z1) / 2] });
}

function poolHall(b: GeoBatch) {
  const W = 14;
  const D = 8;
  const H = 7.5;
  // entrance wing: dark board-formed concrete, basalt base course, glass shopfront behind timber fins
  b.box("concreteDark", 0.4, H, D, { p: [-W / 2 + 0.2, H / 2, -D / 2], tile: 2 });
  b.box("concreteDark", 0.4, H, D, { p: [W / 2 - 0.2, H / 2, -D / 2], tile: 2 });
  for (const s of [-1, 1]) b.box("lava", 0.12, 1.0, D, { p: [s * (W / 2 + 0.06), 0.5, -D / 2], tile: 1.2 });
  wallWithDoor(b, "glass", W - 0.8, H - 0.2, -0.6, 0.12, 6);
  for (let x = -W / 2 + 0.6; x <= W / 2 - 0.5; x += 0.62) {
    if (Math.abs(x) < 3.0) continue;
    b.box("woodDark", 0.1, H - 0.3, 0.55, { p: [x, (H - 0.3) / 2, -0.2], tile: 1 });
  }
  b.box("concreteDark", W + 1.2, 0.9, D + 1.6, { p: [0, H + 0.45, -D / 2 + 0.6], tile: 2 });
  b.box("led-pool", W + 1.24, 0.03, 0.03, { p: [0, H + 0.06, 1.42] });
  // the 24 × 18 m hall behind (taller than the wing), ribbon clerestory on the open side
  hallVolume(b, "concreteDark", -15, 9, -8, -26, 8.6, 2);
  ribbon(b, -15.03, -9.5, -24.5, 6.6, 1.4);
  ribbon(b, 9.03, -9.5, -24.5, 6.6, 1.4);
  pylons(b);
  doorSurround(b, "led-pool", -0.5);
  // rooftop plant on the hall roof
  b.box("steel", 3, 1.2, 2, { p: [-6, 9.7, -18] });
  b.box("steel", 2, 0.9, 1.4, { p: [2.5, 9.55, -21] });
}

function ludoLounge(b: GeoBatch) {
  const W = 14;
  const D = 8;
  const H = 5.6;
  b.box("brick", 0.45, H, D, { p: [-W / 2 + 0.22, H / 2, -D / 2], tile: 1 });
  b.box("brick", 0.45, H, D, { p: [W / 2 - 0.22, H / 2, -D / 2], tile: 1 });
  wallWithDoor(b, "glass", W - 0.9, H, -0.4, 0.12, 6);
  for (const x of [-6.6, -4.4, 4.4, 6.6]) b.box("brick", 0.6, H, 0.6, { p: [x, H / 2, -0.15], tile: 1 });
  b.box("concrete", W + 0.6, 0.5, D + 0.6, { p: [0, H + 0.25, -D / 2], tile: 2 });
  // rooftop garden terrace on the wing: glass balustrade, pergola with LED strings
  const R = H + 0.5;
  b.box("glassClear", W, 1.1, 0.05, { p: [0, R + 0.55, 0.2] });
  for (const s of [-1, 1]) b.box("glassClear", 0.05, 1.1, D, { p: [s * (W / 2 + 0.2), R + 0.55, -D / 2] });
  for (const [x, z] of [
    [-5.5, -1.5],
    [5.5, -1.5],
    [-5.5, -6.5],
    [5.5, -6.5],
  ] as const)
    b.box("wood", 0.2, 3, 0.2, { p: [x, R + 1.5, z], tile: 1 });
  for (let z = -1.5; z >= -6.5; z -= 1.25) {
    b.box("wood", 11.4, 0.18, 0.12, { p: [0, R + 3.05, z], tile: 1 });
    b.box("led-ludo", 11.2, 0.02, 0.02, { p: [0, R + 2.92, z] });
  }
  for (const x of [-5, 5]) b.box("hedge", 2.2, 0.7, 1.0, { p: [x, R + 0.35, -7.2] });
  b.box("led-ludo", W + 0.64, 0.03, 0.03, { p: [0, H + 0.04, 0.32] });
  // the 24 × 18 m lounge behind, roof terrace with umbrellas and the giant die on its mast (Plaza.tsx)
  const H2 = 6.8;
  hallVolume(b, "brick", -9, 15, -8, -26, H2, 1);
  ribbon(b, 15.03, -9.5, -24.5, 3.4, 2.2);
  ribbon(b, -9.03, -9.5, -24.5, 3.4, 2.2);
  const R2 = H2 + 0.5;
  for (const [x, z, k] of [
    [-3.2, -11.2, "paint-teal"],
    [0.4, -11.6, "paint-pink"],
    [8.6, -11.1, "paint-orange"],
  ] as const) {
    b.cyl("steel", 0.04, 0.04, 2.4, 6, { p: [x, R2 + 1.2, z] });
    b.add(k, new THREE.ConeGeometry(1.4, 0.6, 12, 1, true), { p: [x, R2 + 2.4, z] });
  }
  // die mast with a fork bracket (the die no longer floats in mid-air)
  b.cyl("steel", 0.09, 0.12, 2.6, 10, { p: [4, R2 + 1.3, -12] });
  b.box("steel", 2.64, 0.12, 0.14, { p: [4, R2 + 2.6, -12] });
  for (const s of [-1, 1]) b.box("steel", 0.12, 1.95, 0.14, { p: [4 + s * 1.26, R2 + 3.6, -12] });
  doorSurround(b, "led-ludo", -0.35);
  pylons(b, 4.6);
}

function igisoroCourt(b: GeoBatch, tier: string) {
  // a rectangular 24 × 18 m hall (as inside) under a big hipped thatch roof, inspired by the royal palace at Nyanza
  const x0 = -14;
  const x1 = 10;
  const z0 = -2.4;
  const z1 = -20.4;
  const H = 5.0;
  const W = x1 - x0;
  const D = z0 - z1;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const t = 0.5;
  // walls: white lime plaster on a lava-stone base course, Imigongo frieze under the eaves
  b.box("white", t, H, D, { p: [x0 + t / 2, H / 2, cz] });
  b.box("white", t, H, D, { p: [x1 - t / 2, H / 2, cz] });
  b.box("white", W, H, t, { p: [cx, H / 2, z1 + t / 2] });
  // front wall either side of the door wall section
  const fw = 6.2;
  for (const [a, c] of [
    [x0, -fw / 2],
    [fw / 2, x1],
  ] as const)
    b.box("white", c - a, H, t, { p: [(a + c) / 2, H / 2, z0] });
  wallWithDoor(b, "lava", fw, H, z0, t, 1.2);
  for (const [px, pz, w, d, rot] of [
    [x0 - 0.04, cz, D, 0.08, Math.PI / 2],
    [x1 + 0.04, cz, D, 0.08, Math.PI / 2],
    [cx, z1 - 0.04, W, 0.08, 0],
  ] as const) {
    b.box("lava", w + 0.1, 0.9, d, { p: [px, 0.45, pz], r: [0, rot, 0], tile: 1.2 });
    b.box("imigongo", w + 0.1, 1.0, d, { p: [px, H - 0.75, pz], r: [0, rot, 0], uv: [w / 4.4, 1] });
  }
  for (const [a, c] of [
    [x0, -fw / 2],
    [fw / 2, x1],
  ] as const) {
    b.box("lava", c - a, 0.9, 0.08, { p: [(a + c) / 2, 0.45, z0 + t / 2 + 0.04], tile: 1.2 });
    b.box("imigongo", c - a, 1.0, 0.08, { p: [(a + c) / 2, H - 0.75, z0 + t / 2 + 0.04], uv: [(c - a) / 4.4, 1] });
  }
  // hipped thatch roof: a 4-sided pyramid stretched over the rectangle, deep overhang, timber ridge finial
  const ov = 1.4;
  const rh = 6.2;
  const k = 1 / Math.SQRT1_2;
  const roof = new THREE.ConeGeometry(1, 1, 4, 1, true).rotateY(Math.PI / 4).toNonIndexed();
  roof.computeVertexNormals(); // flat roof planes, not a rounded cone
  b.add("thatch", roof, {
    p: [cx, H + rh / 2 - 0.25, cz],
    s: [(W / 2 + ov) * k, rh, (D / 2 + ov) * k],
    uv: [26, 5],
  });
  b.add("woodDark", new THREE.ConeGeometry(0.45, 1.5, 10), { p: [cx, H + rh + 0.4, cz] });
  // eave fascia with a slim green LED line
  for (const [px, pz, w, rot] of [
    [cx, z0 + ov - 0.05, W + ov * 2, 0],
    [cx, z1 - ov + 0.05, W + ov * 2, 0],
    [x0 - ov + 0.05, cz, D + ov * 2, Math.PI / 2],
    [x1 + ov - 0.05, cz, D + ov * 2, Math.PI / 2],
  ] as const) {
    b.box("woodDark", w, 0.22, 0.1, { p: [px, H - 0.32, pz], r: [0, rot, 0], tile: 1 });
    b.box("led-igisoro", w, 0.025, 0.025, { p: [px, H - 0.44, pz], r: [0, rot, 0] });
  }
  if (tier !== "lite")
    // exposed rafter ends under the eaves
    for (let x = x0 - ov + 0.6; x <= x1 + ov - 0.5; x += 0.9) b.box("woodDark", 0.08, 0.1, ov, { p: [x, H - 0.18, z0 + ov / 2], tile: 1 });
  // timber porch
  b.box("wood", 6.4, 0.3, 3.4, { p: [0, 4.6, -0.9], tile: 1 });
  for (const x of [-2.9, 2.9]) b.cyl("woodDark", 0.16, 0.18, 4.45, 10, { p: [x, 2.22, 0.5] });
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
  b.add("glass", new THREE.CylinderGeometry(1, 1, 6, seg, 1, true), { p: [0, 4.2, cz], s: [rx - 0.3, 1, rz - 0.3], uv: [perim / 6, 1] });
  b.add("white", new THREE.CylinderGeometry(1, 1, 0.6, seg), { p: [0, 7.4, cz], s: [rx + 0.6, 1, rz + 0.6] });
  // dark inner drum behind the pleated skin
  b.add("diamondDark", new THREE.CylinderGeometry(1, 1, wall - 7.7, seg, 1, true), {
    p: [0, 7.7 + (wall - 7.7) / 2, cz],
    s: [rx - 0.6, 1, rz - 0.6],
    uv: [perim / 3, 3],
  });
  // pleated Imigongo skin: tilted panels around the ellipse create the rhythm of light and shadow
  const panels = tier === "lite" ? 40 : 58;
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
  b.add("led-halo", new THREE.CylinderGeometry(1, 1, 0.12, seg, 1, true), { p: [0, 7.9, cz], s: [rx + 0.65, 1, rz + 0.65] });
  b.add("white", new THREE.CylinderGeometry(1, 1, 1.1, seg, 1, true), { p: [0, wall + 0.4, cz], s: [rx + 0.5, 1, rz + 0.5] });
  b.add("led-halo", new THREE.CylinderGeometry(1, 1, 0.08, seg, 1, true), { p: [0, wall - 0.3, cz], s: [rx + 0.55, 1, rz + 0.55] });
  // space-frame roof: shallow aluminium dome with radial ribs
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(Math.cos((t * Math.PI) / 2) * 1, Math.sin((t * Math.PI) / 2) * 1));
  }
  b.add("alu", new THREE.LatheGeometry(pts.reverse(), seg), { p: [0, wall + 0.9, cz], s: [rx + 0.45, 5.0, rz + 0.45] });
  for (const [k, y] of [
    [0.82, 2.0],
    [0.55, 3.6],
    [0.3, 4.5],
  ] as const)
    b.add("steel", new THREE.TorusGeometry(1, 0.012, 4, seg), { p: [0, wall + 0.9 + y * 1.03, cz], r: [Math.PI / 2, 0, 0], s: [(rx + 0.45) * k, (rz + 0.45) * k, 12] });
  b.add("led-halo", new THREE.TorusGeometry(3, 0.06, 6, 32), { p: [0, wall + 5.85, cz], r: [Math.PI / 2, 0, 0] });
  // entrance: glazed lobby (curtain wall with the door, glass returns), cantilevered canopy on slender columns
  wallWithDoor(b, "glass", 12.4, 6.2, -1.3, 0.14, 6);
  for (const s of [-1, 1]) b.box("glass", 0.14, 6.2, 4.4, { p: [s * 6.2, 3.1, -3.4], tile: 6 });
  // vertical aluminium mullion caps every 1.5 m + transom at door head height
  for (let x = -6; x <= 6.01; x += 1.5) if (Math.abs(x) > 1.8) b.box("alu", 0.08, 6.2, 0.1, { p: [x, 3.1, -1.2] });
  b.box("alu", 12.4, 0.1, 0.1, { p: [0, 4.25, -1.2] });
  // lobby floor and dark interior volume behind the glazing (read through the glass)
  b.box("basalt", 12.2, 0.04, 4.4, { p: [0, 0.02, -3.4], tile: 1.2 });
  b.box("white", 17, 0.45, 9, { p: [0, 7.0, -2.5] });
  b.box("alu", 17.1, 0.12, 9.1, { p: [0, 6.73, -2.5] });
  for (let x = -7.2; x <= 7.21; x += 2.4) b.box("lampHead", 0.08, 0.03, 8.6, { p: [x, 6.66, -2.5] });
  b.box("led-arena", 17.1, 0.03, 0.03, { p: [0, 7.24, 2.03] });
  for (const x of [-7.8, -4.2, 4.2, 7.8]) b.cyl("steel", 0.14, 0.18, 6.8, 10, { p: [x, 3.4, 1.4] });
  // ticket window (left of the doors): recessed counter with an aluminium hood
  b.box("screenFrame", 1.6, 1.2, 0.3, { p: [-4.6, 1.75, -1.15] });
  b.box("alu", 1.9, 0.08, 0.6, { p: [-4.6, 2.42, -1.0] });
  b.box("alu", 1.7, 0.06, 0.4, { p: [-4.6, 1.12, -0.98] });
  // main LED screen frame on the drum (screen surface itself is animated, see Plaza.tsx)
  b.box("screenFrame", 17, 5.4, 0.5, { p: [0, 12.6, cz + rz + 0.9] });
  doorSurround(b, "led-arena", -1.1);
  // flagpoles
  for (const x of [-11.5, -10, 10, 11.5]) b.cyl("alu", 0.05, 0.07, 11, 8, { p: [x, 5.5, 3] });
}

/** Lattice of tubes between two points (crane mast / jib members). */
function member(b: GeoBatch, key: string, a: THREE.Vector3, c: THREE.Vector3, r: number) {
  const d = new THREE.Vector3().subVectors(c, a);
  const len = d.length();
  const geo = new THREE.CylinderGeometry(r, r, len, 5, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  const e = new THREE.Euler().setFromQuaternion(q);
  b.add(key, geo, { p: [(a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2], r: [e.x, e.y, e.z] });
}

function towerCrane(b: GeoBatch, cx: number, cz: number, tier: string) {
  const H = 26;
  const s = 0.45; // half mast width
  const step = tier === "lite" ? 3.2 : 1.6;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(cx + x, y, cz + z);
  const corners = [
    [-s, -s],
    [s, -s],
    [s, s],
    [-s, s],
  ] as const;
  for (const [x, z] of corners) member(b, "paint-yellow", v(x, 0, z), v(x, H, z), 0.05);
  for (let y = 0; y < H - 0.1; y += step) {
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k]!;
      const [bx, bz] = corners[(k + 1) % 4]!;
      member(b, "paint-yellow", v(ax, y, az), v(bx, y, bz), 0.03);
      member(b, "paint-yellow", v(ax, y, az), v(bx, y + step, bz), 0.025);
    }
  }
  // slewing unit, cab, apex
  b.box("paint-yellow", 1.4, 0.6, 1.4, { p: [cx, H + 0.3, cz] });
  b.box("white", 1.3, 1.4, 1.5, { p: [cx + 1.25, H - 0.4, cz + 0.4] });
  b.box("glassClear", 1.32, 0.7, 1.52, { p: [cx + 1.25, H - 0.1, cz + 0.4] });
  member(b, "paint-yellow", v(-s, H + 0.6, -s), v(0, H + 4.2, 0), 0.05);
  member(b, "paint-yellow", v(s, H + 0.6, s), v(0, H + 4.2, 0), 0.05);
  member(b, "paint-yellow", v(s, H + 0.6, -s), v(0, H + 4.2, 0), 0.05);
  member(b, "paint-yellow", v(-s, H + 0.6, s), v(0, H + 4.2, 0), 0.05);
  // jib (triangular lattice towards +z) and counter-jib with concrete blocks (towards −z)
  const L = 20;
  const jy = H + 0.6;
  const jh = 1.2;
  for (const x of [-0.4, 0.4]) member(b, "paint-yellow", v(x, jy, 0), v(x, jy, L), 0.04);
  member(b, "paint-yellow", v(0, jy + jh, 0), v(0, jy + jh * 0.4, L), 0.04);
  const js = tier === "lite" ? 4 : 2;
  for (let z = 0; z < L; z += js) {
    member(b, "paint-yellow", v(-0.4, jy, z), v(0, jy + jh * (1 - (0.6 * z) / L), z + js / 2), 0.022);
    member(b, "paint-yellow", v(0.4, jy, z), v(0, jy + jh * (1 - (0.6 * z) / L), z + js / 2), 0.022);
    member(b, "paint-yellow", v(-0.4, jy, z), v(0.4, jy, z), 0.02);
  }
  for (const x of [-0.45, 0.45]) member(b, "paint-yellow", v(x, jy, 0), v(x, jy, -7), 0.05);
  for (let z = -1; z > -7; z -= 1.5) member(b, "paint-yellow", v(-0.45, jy, z), v(0.45, jy, z - 0.75), 0.025);
  for (let i = 0; i < 3; i++) b.box("concrete", 1.6, 1.0, 0.6, { p: [cx, jy - 0.6, cz - 5.2 - i * 0.65], tile: 2 });
  // pendant ties from the apex, trolley, hook cable and hook block
  member(b, "steel", v(0, H + 4.2, 0), v(0, jy + jh * 0.4, L * 0.85), 0.012);
  member(b, "steel", v(0, H + 4.2, 0), v(0, jy, -6.8), 0.012);
  b.box("steel", 0.9, 0.3, 0.7, { p: [cx, jy - 0.2, cz + 11] });
  member(b, "steel", v(-0.08, jy - 0.3, 11), v(-0.08, 12.6, 11), 0.008);
  member(b, "steel", v(0.08, jy - 0.3, 11), v(0.08, 12.6, 11), 0.008);
  b.box("paint-yellow", 0.45, 0.6, 0.3, { p: [cx, 12.3, cz + 11] });
  b.add("steel", new THREE.TorusGeometry(0.16, 0.035, 5, 10, Math.PI * 1.4), { p: [cx, 11.85, cz + 11], r: [0, 0, Math.PI * 0.8] });
  b.box("led-red", 0.2, 0.2, 0.2, { p: [cx, H + 4.35, cz] });
  b.box("led-red", 0.15, 0.15, 0.15, { p: [cx, jy + 0.6, cz + L] });
  // footing
  b.box("concrete", 2.4, 0.6, 2.4, { p: [cx, 0.3, cz], tile: 2 });
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
  towerCrane(b, 2, -12, tier);
  doorSurround(b, "led-soon", -0.4);
}

function servicePavilion(b: GeoBatch) {
  // café + help desk: see-through shopfront, timber roof, lava back wall, and a real interior behind the glass
  b.box("glassClear", 8, 4, 0.06, { p: [0, 2, -1.5] });
  for (const s of [-1, 1]) b.box("glassClear", 0.06, 4, 5, { p: [s * 4, 2, -4] });
  for (const x of [-4, -2, 2, 4]) b.box("alu", 0.08, 4, 0.1, { p: [x, 2, -1.5] });
  b.box("alu", 8, 0.08, 0.1, { p: [0, 2.6, -1.5] });
  b.box("alu", 2.0, 0.08, 0.1, { p: [0, 2.2, -1.5] });
  b.box("wood", 10, 0.4, 8, { p: [0, 4.2, -3.5], tile: 1 });
  b.box("led-sky", 10.04, 0.03, 0.03, { p: [0, 4.0, 0.52] });
  b.box("lava", 8, 4, 0.4, { p: [0, 2, -6.5], tile: 1.2 });
  b.box("wood", 7.9, 0.04, 4.9, { p: [0, 0.02, -4.0], tile: 1 });
  // L-shaped counter (timber front, light stone top), espresso machine, menu board, back shelves with stock
  b.box("woodDark", 3.6, 1.0, 0.6, { p: [0.4, 0.5, -4.4], tile: 1 });
  b.box("woodDark", 0.6, 1.0, 1.6, { p: [2.5, 0.5, -5.1], tile: 1 });
  b.box("white", 3.8, 0.05, 0.7, { p: [0.4, 1.03, -4.4] });
  b.box("white", 0.7, 0.05, 1.7, { p: [2.5, 1.03, -5.1] });
  b.box("steel", 0.6, 0.45, 0.45, { p: [-0.6, 1.28, -4.5] });
  b.box("screenFrame", 1.6, 0.9, 0.05, { p: [0.4, 2.8, -6.27] });
  for (const y of [1.5, 2.0]) b.box("wood", 3.2, 0.04, 0.3, { p: [-1.6, y, -6.12], tile: 1 });
  for (let i = 0; i < 9; i++) b.box(i % 3 === 0 ? "paint-orange" : i % 3 === 1 ? "paint-teal" : "white", 0.12, 0.26, 0.12, { p: [-3 + i * 0.32, 1.65 + (i % 2) * 0.5, -6.12] });
  // bar stools along the counter front, two café tables by the glass
  for (const x of [-0.8, 0.2, 1.2]) {
    b.cyl("steel", 0.025, 0.025, 0.72, 6, { p: [x, 0.36, -3.7] });
    b.cyl("woodDark", 0.18, 0.18, 0.05, 12, { p: [x, 0.74, -3.7] });
    b.cyl("steel", 0.2, 0.2, 0.02, 12, { p: [x, 0.01, -3.7] });
  }
  for (const x of [-2.7, 2.6]) {
    b.cyl("white", 0.35, 0.35, 0.03, 16, { p: [x, 0.74, -2.4] });
    b.cyl("steel", 0.03, 0.03, 0.72, 6, { p: [x, 0.37, -2.4] });
    for (const s of [-1, 1]) {
      b.box("woodDark", 0.4, 0.04, 0.4, { p: [x + s * 0.55, 0.45, -2.4] });
      b.box("woodDark", 0.04, 0.4, 0.4, { p: [x + s * 0.74, 0.65, -2.4] });
      for (const [lx, lz] of [
        [-0.16, -0.16],
        [0.16, 0.16],
        [-0.16, 0.16],
        [0.16, -0.16],
      ] as const)
        b.box("steel", 0.025, 0.45, 0.025, { p: [x + s * 0.55 + lx, 0.22, -2.4 + lz] });
    }
  }
  // pendant lamps over the counter
  for (const x of [-0.8, 0.4, 1.6]) {
    b.cyl("steel", 0.006, 0.006, 1.6, 4, { p: [x, 3.2, -4.4] });
    b.add("lampHead", new THREE.ConeGeometry(0.16, 0.2, 14, 1, true), { p: [x, 2.35, -4.4] });
  }
}

/** Soft AO decal (flat blob) under furniture: merged into the "ao" batch. */
function ao(b: GeoBatch, x: number, z: number, w: number, d: number, rotY = 0) {
  b.add("ao", new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), { p: [x, 0.008, z], r: [0, rotY, 0] });
}

/** Paving, basalt bands, LED wayfinding inlays, fountain, Agaseke sculpture, benches, lamps, planters, totems. */
function plaza(b: GeoBatch, tier: string) {
  const flat = (geo: THREE.BufferGeometry) => geo.rotateX(-Math.PI / 2);
  b.add("paving", flat(new THREE.CircleGeometry(32.5, tier === "lite" ? 64 : 128)), { p: [0, 0, 0], tile: 4.8 });
  for (const [r0, r1, k] of [
    [7.6, 7.9, "basalt"],
    [15.75, 15.95, "basalt"],
    [32.5, 33.3, "lava"],
  ] as const)
    b.add(k, flat(new THREE.RingGeometry(r0, r1, 128, 1)), { p: [0, 0.004, 0], tile: 1.2 });
  // wayfinding: a slim LED line in each game's colour, inlaid in one flush 0.3 m basalt band (§6.2)
  for (const p of PORTALS) {
    const key = p.kind === "soon" ? "led-soon" : `led-${p.kind}`;
    const len = DOOR_RING - 3 - (FOUNTAIN_RADIUS + 1.2);
    const mid = ringPoint(p.angleDeg, FOUNTAIN_RADIUS + 1.2 + len / 2);
    b.box("basalt", 0.3, 0.008, len, { p: [mid.x, 0.004, mid.z], r: [0, mid.rotY, 0], tile: 1.2 });
    b.box(key, 0.04, 0.004, len, { p: [mid.x, 0.009, mid.z], r: [0, mid.rotY, 0] });
  }
  // spawn medallion: flush granite disc with a 15 mm brass inlay ring
  b.add("granite", flat(new THREE.CircleGeometry(1.1, 48)), { p: [SPAWN.x, 0.005, SPAWN.z], tile: 2.4 });
  b.add("brass", flat(new THREE.RingGeometry(1.1, 1.115, 96)), { p: [SPAWN.x, 0.006, SPAWN.z] });
  b.add("brass", flat(new THREE.RingGeometry(0.42, 0.435, 64)), { p: [SPAWN.x, 0.006, SPAWN.z] });

  // fountain: open basalt basin (outer + inner wall, lighter floor), white coping; Agaseke sculpture on a plinth.
  // The water surface, jets and splashes are animated (Fountain.tsx).
  b.cyl("lava", FOUNTAIN_RADIUS, FOUNTAIN_RADIUS + 0.15, 0.55, 64, { p: [0, 0.27, 0], uv: [18, 0.5] }, true);
  b.add("basinFloor", flat(new THREE.CircleGeometry(FOUNTAIN_RADIUS - 0.3, 64)), { p: [0, 0.12, 0], tile: 1.2 });
  b.cyl("white", FOUNTAIN_RADIUS - 0.3, FOUNTAIN_RADIUS - 0.3, 0.44, 64, { p: [0, 0.34, 0] }, true);
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
  // ten bronze nozzles inside the coping
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.cyl("brass", 0.025, 0.035, 0.1, 8, { p: [Math.sin(a) * (FOUNTAIN_RADIUS - 0.62), 0.47, Math.cos(a) * (FOUNTAIN_RADIUS - 0.62)] });
  }
  ao(b, 0, 0, FOUNTAIN_RADIUS * 2 + 1.4, FOUNTAIN_RADIUS * 2 + 1.4);

  // benches
  for (const bench of BENCHES) {
    b.frame([bench.x, 0, bench.z], bench.rotY, () => {
      for (const s of [-1, 1]) b.box("lava", 0.35, 0.42, 0.5, { p: [s * 0.8, 0.21, 0], tile: 1.2 });
      b.box("wood", 2.1, 0.08, 0.55, { p: [0, 0.46, 0], tile: 1 });
    });
    ao(b, bench.x, bench.z, 2.9, 1.3, bench.rotY);
  }
  // lamp posts with warm LED heads (same 12 posts the player collides with: world/obstacles.ts LAMPS)
  for (const p of LAMPS) {
    b.cyl("steel", 0.06, 0.09, 4.6, 8, { p: [p.x, 2.3, p.z] });
    b.cyl("steel", 0.16, 0.18, 0.08, 12, { p: [p.x, 0.04, p.z] });
    b.box("steel", 0.9, 0.12, 0.28, { p: [p.x, 4.6, p.z], r: [0, p.rotY, 0] });
    b.box("lampHead", 0.8, 0.03, 0.2, { p: [p.x, 4.53, p.z], r: [0, p.rotY, 0] });
    ao(b, p.x, p.z, 0.9, 0.9);
  }
  // planters: modern raised flower planters are drawn by world/Flowers.tsx (AO under them here)
  for (const p of RING_PLANTERS) ao(b, p.x, p.z, p.r * 2 + 1.0, p.r * 2 + 1.0);
  // totems (screens are dynamic Text): brushed aluminium housing, vent grille and logo on the back
  for (const t of TOTEMS) {
    b.frame([t.x, 0, t.z], t.rotY, () => {
      b.box("aluBrushed", 2.4, 3.4, 0.3, { p: [0, 1.95, 0] });
      b.box("lava", 1.2, 0.3, 0.7, { p: [0, 0.15, 0], tile: 1.2 });
      b.box(t.id === "wallet" ? "led-gold" : "led-sky", 2.3, 0.025, 0.02, { p: [0, 3.62, 0.15] });
      for (let i = 0; i < 6; i++) b.box("screenFrame", 1.5, 0.03, 0.012, { p: [0, 0.62 + i * 0.07, -0.152] });
      b.add("screenFrame", new THREE.CircleGeometry(0.16, 24).rotateY(Math.PI), { p: [0, 3.0, -0.152] });
      b.add("aluBrushed", new THREE.RingGeometry(0.07, 0.11, 24).rotateY(Math.PI), { p: [0, 3.0, -0.154] });
    });
    ao(b, t.x, t.z, 2.4, 1.3, t.rotY);
  }
  // perimeter: low black lava-rock walls between the buildings (typical Musanze dry-stone walls) + road ring
  const builder = (deg: number) => [...PORTALS.map((p) => ({ a: p.angleDeg, k: p.kind as keyof typeof FOOTPRINTS })), { a: SERVICE_ANGLE, k: "service" as const }].some(({ a, k }) => {
    for (const s of [-1.8, 0, 1.8]) {
      const w = ringPoint(deg + 3, 34);
      const o = ringPoint(deg + 3 + 90, s);
      const l = toLocal(a, w.x + o.x, w.z + o.z);
      if (FOOTPRINTS[k].some((f) => l.x > f.x0 - 1 && l.x < f.x1 + 1 && l.z < f.z0 + 1 && l.z > f.z1 - 1)) return true;
    }
    return false;
  });
  for (let deg = -180; deg < 180; deg += 6) {
    const near = [...PORTALS.map((p) => p.angleDeg), SERVICE_ANGLE].some((a) => Math.abs(((deg - a + 540) % 360) - 180) < 12);
    if (near || Math.abs(deg) > 168 || builder(deg)) continue;
    const p = ringPoint(deg + 3, 34);
    b.box("lava", 3.6, 0.8, 0.6, { p: [p.x, 0.4, p.z], r: [0, p.rotY, 0], tile: 1.2 });
  }
  b.add("asphalt", flat(new THREE.RingGeometry(74, 81, 160, 1)), { p: [0, 0.01, 0], tile: 3 });
  b.add("white", flat(new THREE.RingGeometry(77.42, 77.58, 160, 1)), { p: [0, 0.02, 0] });
  // approach avenue from the south (spawn side) to the road
  b.box("paving", 8, 0.02, 41, { p: [0, 0.0, 53.5], tile: 4.8 });
}

/** World point → a building's local frame (door at the origin, +z towards the fountain). */
export function toLocal(angleDeg: number, x: number, z: number) {
  const d = ringPoint(angleDeg, DOOR_RING);
  const rot = d.rotY;
  const dx = x - d.x;
  const dz = z - d.z;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
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

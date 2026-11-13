import * as THREE from "three";
import { GeoBatch } from "./geo";
import { LAMPS } from "./obstacles";
import { RING_PLANTERS } from "./beds";
import { ARENA, FOOTPRINTS, igisoroHall, inBuilding, LUDO_DIE, PLOTS, sitePlan, toLocal, WING_HW, wingedHall } from "./footprints";
import {
  BENCHES,
  DOOR,
  DOOR_RING,
  FOUNTAIN_COURT,
  FOUNTAIN_RADIUS,
  PAVING_R,
  PERIMETER_R,
  PORTALS,
  RING_ROAD,
  ringPoint,
  SPAWN,
  TOTEMS,
  ENTRY_Z,
  EXPANSION_PLOTS,
  EXPANSION_RING,
  OUTER_PROMENADE,
  WAYFINDING,
  wayfindingRows,
  type PortalDef,
} from "./layout";

export { ARENA, FOOTPRINTS, toLocal };

/**
 * Static architecture of the Gukirana Arena District, authored as primitives and merged per material (geo.ts).
 * Every building is built in a local frame: door centre at the origin, facade facing +z (towards the fountain),
 * the volume extending to −z. Dimensions in metres; see docs/WORLD-ARENA-DESIGN.md §5–6.
 *
 * Exterior scale follows the hall interiors (world/footprints.ts derives every hall volume from rooms/layouts.ts
 * HALLS): each hall is an entrance wing on the plaza ring with the full-size hall behind it, offset away from its
 * neighbours so the wedge between doors stays open. The doors sit on the ring (DOOR_RING, PORTALS).
 */

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
    const xa = s < 0 ? x0 : WING_HW;
    const xb = s < 0 ? -WING_HW : x1;
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
  const hall = wingedHall("pool");
  const W = 14;
  const D = hall.wing;
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
  // the full-size hall behind (taller than the wing), ribbon clerestories on both sides and above the wing
  const { x0, x1, z0, z1, H: H2 } = hall;
  hallVolume(b, "concreteDark", x0, x1, z0, z1, H2, 2);
  ribbon(b, x0 - 0.03, z0 - 1.5, z1 + 1.5, H2 - 2, 1.4);
  ribbon(b, x1 + 0.03, z0 - 1.5, z1 + 1.5, H2 - 2, 1.4);
  for (const s of [-1, 1]) {
    const xa = s < 0 ? x0 + 1.2 : WING_HW + 1.2;
    const xb = s < 0 ? -WING_HW - 1.2 : x1 - 1.2;
    if (xb - xa > 2) b.box("glass", xb - xa, 1.4, 0.06, { p: [(xa + xb) / 2, H2 - 2, z0 + 0.03], tile: 6 });
  }
  pylons(b);
  doorSurround(b, "led-pool", -0.5);
  // rooftop plant on the hall roof
  const cz = (z0 + z1) / 2;
  const cx = (x0 + x1) / 2;
  b.box("steel", 3, 1.2, 2, { p: [cx - 6, H2 + 1.1, cz] });
  b.box("steel", 2, 0.9, 1.4, { p: [cx + 4, H2 + 0.95, cz - 4] });
  b.box("steel", 2.4, 1.0, 1.6, { p: [cx + 9, H2 + 1.0, cz + 5] });
}

function ludoLounge(b: GeoBatch) {
  const hall = wingedHall("ludo");
  const W = 14;
  const D = hall.wing;
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
  for (const x of [-5, 5]) b.box("hedge", 2.2, 0.7, 1.0, { p: [x, R + 0.35, -D + 0.8] });
  b.box("led-ludo", W + 0.64, 0.03, 0.03, { p: [0, H + 0.04, 0.32] });
  // the full-size lounge behind, roof terrace with umbrellas and the giant die on its mast (Plaza.tsx)
  const { x0, x1, z0, z1, H: H2 } = hall;
  hallVolume(b, "brick", x0, x1, z0, z1, H2, 1);
  ribbon(b, x1 + 0.03, z0 - 1.5, z1 + 1.5, 3.4, 2.2);
  ribbon(b, x0 - 0.03, z0 - 1.5, z1 + 1.5, 3.4, 2.2);
  const R2 = H2 + 0.5;
  for (const [x, dz, k] of [
    [-3.2, -3.2, "paint-teal"],
    [0.4, -3.6, "paint-pink"],
    [8.6, -3.1, "paint-orange"],
  ] as const) {
    b.cyl("steel", 0.04, 0.04, 2.4, 6, { p: [x, R2 + 1.2, z0 + dz] });
    b.add(k, new THREE.ConeGeometry(1.4, 0.6, 12, 1, true), { p: [x, R2 + 2.4, z0 + dz] });
  }
  // die mast with a fork bracket (the die no longer floats in mid-air)
  const die = LUDO_DIE;
  b.cyl("steel", 0.09, 0.12, 2.6, 10, { p: [die.x, R2 + 1.3, die.z] });
  b.box("steel", 2.64, 0.12, 0.14, { p: [die.x, R2 + 2.6, die.z] });
  for (const s of [-1, 1]) b.box("steel", 0.12, 1.95, 0.14, { p: [die.x + s * 1.26, R2 + 3.6, die.z] });
  doorSurround(b, "led-ludo", -0.35);
  pylons(b, 4.6);
}

/**
 * A white lime-plaster block on a lava-stone base course, Imigongo frieze under the eaves, timber-framed windows and
 * a hipped thatch roof (inspired by the royal palace at Nyanza). `door`: the front wall gets the lava door section;
 * `hidden`: front-wall span (x range) covered by another block, left without windows.
 */
function thatchedBlock(b: GeoBatch, x0: number, x1: number, z0: number, z1: number, H: number, tier: string, opts: { door?: boolean; hidden?: [number, number] } = {}) {
  const W = x1 - x0;
  const D = z0 - z1;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const { t, ov } = igisoroHall();
  b.box("white", t, H, D, { p: [x0 + t / 2, H / 2, cz] });
  b.box("white", t, H, D, { p: [x1 - t / 2, H / 2, cz] });
  b.box("white", W, H, t, { p: [cx, H / 2, z1 + t / 2] });
  // front wall (either side of the lava door section when there is a door)
  const fw = opts.door ? 6.2 : 0;
  const fronts: [number, number][] = opts.door
    ? [
        [x0, -fw / 2],
        [fw / 2, x1],
      ]
    : [[x0, x1]];
  for (const [a, c] of fronts) b.box("white", c - a, H, t, { p: [(a + c) / 2, H / 2, z0 - t / 2] });
  if (opts.door) wallWithDoor(b, "lava", fw, H, z0 - t / 2, t, 1.2);
  for (const [px, pz, w, d, rot] of [
    [x0 - 0.04, cz, D, 0.08, Math.PI / 2],
    [x1 + 0.04, cz, D, 0.08, Math.PI / 2],
    [cx, z1 - 0.04, W, 0.08, 0],
  ] as const) {
    b.box("lava", w + 0.1, 0.9, d, { p: [px, 0.45, pz], r: [0, rot, 0], tile: 1.2 });
    b.box("imigongo", w + 0.1, 1.0, d, { p: [px, H - 0.75, pz], r: [0, rot, 0], uv: [w / 4.4, 1] });
  }
  for (const [a, c] of fronts) {
    const segs: [number, number][] = opts.hidden ? [[a, Math.min(c, opts.hidden[0])], [Math.max(a, opts.hidden[1]), c]] : [[a, c]];
    for (const [sa, sc] of segs) {
      if (sc - sa < 0.2) continue;
      b.box("lava", sc - sa, 0.9, 0.08, { p: [(sa + sc) / 2, 0.45, z0 + 0.04], tile: 1.2 });
      b.box("imigongo", sc - sa, 1.0, 0.08, { p: [(sa + sc) / 2, H - 0.75, z0 + 0.04], uv: [(sc - sa) / 4.4, 1] });
    }
  }
  // hipped thatch roof: a 4-sided pyramid stretched over the rectangle, deep overhang, timber ridge finial
  const rh = 6.2 * Math.max(0.75, Math.min(W, D) / 18) ** 0.5;
  const k = 1 / Math.SQRT1_2;
  const roof = new THREE.ConeGeometry(1, 1, 4, 1, true).rotateY(Math.PI / 4).toNonIndexed();
  roof.computeVertexNormals(); // flat roof planes, not a rounded cone
  b.add("thatch", roof, { p: [cx, H + rh / 2 - 0.25, cz], s: [(W / 2 + ov) * k, rh, (D / 2 + ov) * k], uv: [Math.max(8, W + D) * 0.6, 5] });
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
    // exposed rafter ends under the front eaves
    for (let x = x0 - ov + 0.6; x <= x1 + ov - 0.5; x += 0.9)
      if (!opts.hidden || x < opts.hidden[0] - ov || x > opts.hidden[1] + ov) b.box("woodDark", 0.08, 0.1, ov, { p: [x, H - 0.18, z0 + ov / 2], tile: 1 });
  // windows: timber-framed 0.9 × 1.6 m, sill at 0.9 m, every ~3 m on all walls; neutral glass in front of a warm
  // out-of-focus view of the hall (columns, lamps, tables) for depth
  const win = (x: number, z: number, rotY: number) => {
    b.frame([x, 0, z], rotY, () => {
      b.box("windowGlimpse", 0.9, 1.6, 0.02, { p: [0, 1.7, 0.02] });
      b.box("glassClear", 0.9, 1.6, 0.02, { p: [0, 1.7, 0.1] });
      for (const s of [-1, 1]) b.box("woodDark", 0.1, 1.8, 0.16, { p: [s * 0.5, 1.7, 0.08], tile: 1 });
      b.box("woodDark", 1.1, 0.1, 0.16, { p: [0, 2.55, 0.08], tile: 1 });
      b.box("woodDark", 1.2, 0.08, 0.26, { p: [0, 0.86, 0.12], tile: 1 }); // sill
      b.box("woodDark", 0.9, 0.05, 0.05, { p: [0, 2.05, 0.11], tile: 1 }); // transom bar
    });
  };
  const frontOk = (x: number) => (!opts.door || Math.abs(x) > fw / 2 + 0.9) && (!opts.hidden || x < opts.hidden[0] - 0.8 || x > opts.hidden[1] + 0.8);
  for (let x = x0 + 1.8; x <= x1 - 1.0; x += 3) if (frontOk(x)) win(x, z0, 0);
  for (let z = z0 - 2.0; z >= z1 + 1.0; z -= 3) {
    win(x0, z, -Math.PI / 2);
    win(x1, z, Math.PI / 2);
  }
  for (let x = x0 + 1.8; x <= x1 - 1.0; x += 3) win(x, z1, Math.PI);
}

function igisoroCourt(b: GeoBatch, tier: string) {
  // the thatched porch wing with the carved door, and the full-size court behind it (the interior size plus walls)
  const h = igisoroHall();
  const wx = WING_HW - 0.6;
  thatchedBlock(b, -wx, wx, h.doorZ + h.t / 2, -h.wing, 4.6, tier, { door: true });
  thatchedBlock(b, h.x0, h.x1, h.z0, h.z1, 5.6, tier, { hidden: [-wx - 0.2, wx + 0.2] });
  // timber porch
  b.box("wood", 6.4, 0.3, 3.4, { p: [0, 4.6, -0.9], tile: 1 });
  for (const x of [-2.9, 2.9]) b.cyl("woodDark", 0.16, 0.18, 4.45, 10, { p: [x, 2.22, 0.5] });
  doorSurround(b, "led-igisoro", -2.1);
  // lettered timber fascia board hung under the porch roof (the lettering is drawn in Plaza.tsx)
  b.box("woodDark", 4.6, 0.62, 0.08, { p: [0, 4.14, 0.84], tile: 1 });
  for (const x of [-2.0, 2.0]) b.box("steel", 0.03, 0.12, 0.03, { p: [x, 4.5, 0.84] });
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
  const panels = Math.round(perim / (tier === "lite" ? 2.7 : 1.85));
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

function comingSoon(b: GeoBatch, tier: string, crane = true) {
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
  if (crane) towerCrane(b, 2, -12, tier);
  doorSurround(b, "led-soon", -0.4);
}

/**
 * A reserved hall plot: hoarding around the whole plot a ~36 × 28 m hall will take (entrance wing + hall), the site
 * gate on the door line, and on some plots a tower crane over a rising concrete frame.
 */
function hallSite(b: GeoBatch, away: number, tier: string, crane: boolean, ringPlot: boolean) {
  const h = sitePlan(away);
  const H = 2.6;
  const fence = (ax: number, az: number, cx: number, cz: number) => {
    const len = Math.hypot(cx - ax, cz - az);
    if (len < 0.1) return;
    b.box("hoarding", len, H, 0.12, { p: [(ax + cx) / 2, H / 2, (az + cz) / 2], r: [0, -Math.atan2(cz - az, cx - ax), 0] });
  };
  const wx = WING_HW;
  const pts: [number, number][] = [
    [wx, -0.4],
    [wx, h.z0],
    [h.x1, h.z0],
    [h.x1, h.z1],
    [h.x0, h.z1],
    [h.x0, h.z0],
    [-wx, h.z0],
    [-wx, -0.4],
  ];
  for (let i = 0; i < pts.length - 1; i++) fence(pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1]);
  for (const [x, z] of pts) b.box("steel", 0.12, H + 0.2, 0.12, { p: [x, (H + 0.2) / 2, z] });
  if (ringPlot) {
    // inner-ring plots: the standard construction front (site gate, frame, crane) from the small plots
    for (const sd of [-1, 1]) fence(sd * 6.6, -0.4, sd * wx, -0.4);
    comingSoon(b, tier, crane);
    return;
  }
  // expansion plots: the site gate on the door line and a lettered board (Plaza.tsx)
  for (const sd of [-1, 1]) {
    fence(sd * 1.9, -0.4, sd * wx, -0.4);
    b.box("steel", 0.2, 4.5, 0.2, { p: [sd * 1.75, 2.25, -0.4] });
  }
  b.box("steel", 3.6, 0.3, 0.2, { p: [0, 4.35, -0.4] });
  b.box("led-soon", 3.5, 0.03, 0.03, { p: [0, 4.18, -0.28] });
  b.box("screenFrame", 5.2, 1.3, 0.1, { p: [4.4, 3.4, -0.3] });
  if (crane && tier !== "lite") towerCrane(b, (h.x0 + h.x1) / 2 + 6, (h.z0 + h.z1) / 2, tier);
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
  const ringSeg = tier === "lite" ? 96 : 192;
  b.add("paving", flat(new THREE.CircleGeometry(PAVING_R, ringSeg)), { p: [0, 0, 0], tile: 4.8 });
  // the fountain court: a honed granite disc, framed by a basalt band; a second band halfway out to the edge
  b.add("granite", flat(new THREE.CircleGeometry(FOUNTAIN_COURT, tier === "lite" ? 64 : 128)), { p: [0, 0.003, 0], tile: 4.8 });
  for (const [r0, r1, k] of [
    [FOUNTAIN_COURT - 0.05, FOUNTAIN_COURT + 0.3, "basalt"],
    [20.6, 20.8, "basalt"],
    [PAVING_R, PAVING_R + 0.8, "lava"],
  ] as const)
    b.add(k, flat(new THREE.RingGeometry(r0, r1, ringSeg, 1)), { p: [0, 0.004, 0], tile: 1.2 });
  // promenades: from the fountain court to every door, a 3.6 m walk edged by two flush basalt strips, with a slim
  // LED line in each game's colour down the middle (§6.2)
  for (const p of PORTALS) {
    const key = p.kind === "soon" ? "led-soon" : `led-${p.kind}`;
    const r0 = FOUNTAIN_COURT + 0.3;
    const len = DOOR_RING - 3 - r0;
    const mid = ringPoint(p.angleDeg, r0 + len / 2);
    const a = (p.angleDeg * Math.PI) / 180;
    b.box("basalt", 0.3, 0.008, len, { p: [mid.x, 0.004, mid.z], r: [0, mid.rotY, 0], tile: 1.2 });
    b.box(key, 0.04, 0.004, len, { p: [mid.x, 0.009, mid.z], r: [0, mid.rotY, 0] });
    for (const s of [-1, 1])
      b.box("basalt", 0.2, 0.008, len, { p: [mid.x + s * 1.8 * Math.cos(a), 0.004, mid.z + s * 1.8 * Math.sin(a)], r: [0, mid.rotY, 0], tile: 1.2 });
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
  ), { p: [0, 1.05, 0], s: [1.35, 1.35, 1.35], uv: [6, 1] });
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
  // lamp posts with warm LED heads (the same posts the player collides with: world/obstacles.ts LAMPS)
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
  // wayfinding signs at the fountain court: brushed aluminium post with a dark panel on both faces, a colour bar
  // per listed plot (the names and distances are Text, Plaza.tsx)
  for (const w of WAYFINDING) {
    const rows = wayfindingRows(w);
    b.frame([w.x, 0, w.z], w.rotY, () => {
      b.box("aluBrushed", 1.5, 2.3, 0.16, { p: [0, 1.35, 0] });
      b.box("lava", 0.9, 0.2, 0.42, { p: [0, 0.1, 0], tile: 1.2 });
      b.box("led-sky", 1.4, 0.02, 0.17, { p: [0, 2.49, 0] });
      b.box("screenFrame", 1.38, 1.9, 0.172, { p: [0, 1.42, 0] });
      rows.forEach((r, i) => {
        for (const s of [-1, 1]) b.box(r.led, 0.04, 0.24, 0.18, { p: [s * 0.62, 1.42 + (1.5 - i) * 0.42, 0] });
      });
    });
    ao(b, w.x, w.z, 1.8, 0.8, w.rotY);
  }
  // perimeter: low black lava-rock walls between the buildings (typical Musanze dry-stone walls) + road ring
  // (3.6 m wall stones every STEP degrees; kept clear of the doors, the buildings and the entry gate's own walls)
  const STEP = (3.6 / PERIMETER_R) * (180 / Math.PI);
  const DOOR_GAP = (7.1 / PERIMETER_R) * (180 / Math.PI);
  const builder = (deg: number) => {
    for (const s of [-1.8, 0, 1.8]) {
      const w = ringPoint(deg + STEP / 2, PERIMETER_R);
      const o = ringPoint(deg + STEP / 2 + 90, s);
      if (inBuilding(w.x + o.x, w.z + o.z, 1)) return true;
    }
    return false;
  };
  const off = (deg: number, a: number) => Math.abs(((deg + STEP / 2 - a + 540) % 360) - 180);
  for (let deg = -180; deg < 180; deg += STEP) {
    const near = PLOTS.some((q) => q.ring === DOOR_RING && off(deg, q.angleDeg) < DOOR_GAP);
    const p = ringPoint(deg + STEP / 2, PERIMETER_R);
    const gate = p.z > ENTRY_Z - 6 && Math.abs(p.x) < 17.5; // the entry gate has its own perimeter walls
    if (near || gate || builder(deg)) continue;
    b.box("lava", 3.6, 0.8, 0.6, { p: [p.x, 0.4, p.z], r: [0, p.rotY, 0], tile: 1.2 });
  }
  // expansion district: the outer promenade ring (honed granite between basalt kerbs), served by the main avenue
  b.add("granite", flat(new THREE.RingGeometry(OUTER_PROMENADE.r0, OUTER_PROMENADE.r1, 240, 1)), { p: [0, 0.008, 0], tile: 4.8 });
  for (const r of [OUTER_PROMENADE.r0, OUTER_PROMENADE.r1]) b.add("basalt", flat(new THREE.RingGeometry(r - 0.1, r + 0.1, 240, 1)), { p: [0, 0.012, 0], tile: 1.2 });
  // a forecourt in front of every expansion plot
  for (const e of EXPANSION_PLOTS) {
    const m = ringPoint(e.angleDeg, (OUTER_PROMENADE.r1 + EXPANSION_RING) / 2 + 0.3);
    b.box("granite", 16, 0.02, EXPANSION_RING - OUTER_PROMENADE.r1 + 1.2, { p: [m.x, 0.007, m.z], r: [0, m.rotY, 0], tile: 4.8 });
  }
  const mid = (RING_ROAD.r0 + RING_ROAD.r1) / 2;
  b.add("asphalt", flat(new THREE.RingGeometry(RING_ROAD.r0, RING_ROAD.r1, 200, 1)), { p: [0, 0.01, 0], tile: 3 });
  b.add("white", flat(new THREE.RingGeometry(mid - 0.08, mid + 0.08, 200, 1)), { p: [0, 0.02, 0] });
  // approach avenue from the south (spawn side) to the road
  const a0 = PAVING_R - 1;
  b.box("paving", 8, 0.02, RING_ROAD.r0 - a0, { p: [0, 0.0, (a0 + RING_ROAD.r0) / 2], tile: 4.8 });
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
  // every plot from the data (layout.ts PORTALS / EXPANSION_PLOTS → footprints.ts PLOTS)
  PLOTS.forEach((p, i) => {
    const d = ringPoint(p.angleDeg, p.ring);
    b.frame([d.x, 0, d.z], d.rotY, () => {
      if (p.type === "service") servicePavilion(b);
      else if (p.type === "site") hallSite(b, p.away, tier, p.ring === DOOR_RING || i % 2 === 0, p.ring === DOOR_RING);
      else builders[p.type](b, tier);
    });
  });
  return b.build();
}

import { HALLS, type HallGame } from "@/rooms/layouts";
import { PORTALS, ringOf, ringPoint } from "./layout";

/**
 * What you see through a building's glass is what is really there (P2-WLD-18), as data. Pure: no three.js.
 *
 * Every glazed facade on the campus belongs to one hall. Through its glass you see THAT hall's real interior (the
 * same scene you walk into: world/GlassCapture renders it once into a cube map from just inside its door, with the
 * hall's own lights, and the glass shader ray-marches the captured colour + distance), and on its outside face a
 * Fresnel reflection of the real plaza in front of it (a second, small cube captured from the forecourt).
 *
 * Frames. A building's LOCAL frame is the District one (door on its ring point at the origin, +z towards the
 * fountain, world/footprints.ts). The hall's ROOM frame is its interior (rooms/layouts.ts: x ∈ ±w/2, y ∈ [0, h],
 * z ∈ ±d/2, the door in the south wall z = +d/2). A pane maps local → room by `room = local + (door.x, 0, d/2 − zRef)`:
 * the plane z = zRef of the facade (the glass line, or the inner doorway of a vestibule) is the room's south wall,
 * exactly as walking through the door puts you just inside it (the exterior wing is not part of the interior).
 */

/** halls with glazing on the campus (the Boxing hall is reached through the Fight lobby, it has no facade) */
export const GLAZED = ["pool", "ludo", "igisoro", "admin", "arena", "fight"] as const satisfies readonly HallGame[];
export type GlazedHall = (typeof GLAZED)[number];
export const isGlazed = (g: string): g is GlazedHall => (GLAZED as readonly string[]).includes(g);

/**
 * How a pane is drawn (carried in its UV x, at the centre of an integer cell so merging keeps it exact):
 *  - `glass`: vision glass, the real interior behind it (once captured), a Fresnel reflection of the plaza on it;
 *  - `doorway`: the open inner doorway at the end of a door vestibule (no glass: the interior, no reflection);
 *  - `blind`: glazing whose room is not modelled behind it (side / back windows): closed woven blinds behind the glass;
 *  - `spandrel`: back-painted opaque glass (in front of a slab, a ceiling void or a wall): reflection only.
 * Vision glass above the room's ceiling or beyond its side walls turns into spandrel by itself (shader).
 */
export const PANE_MODES = ["glass", "doorway", "blind", "spandrel"] as const;
export type PaneMode = (typeof PANE_MODES)[number];

/** UV of a pane's vertices: x = mode cell, y = zRef (local z of the plane that maps to the room's south wall) */
export function paneUV(mode: PaneMode, zRef: number): [number, number] {
  return [PANE_MODES.indexOf(mode) + 0.5, zRef];
}
export function decodePaneUV(u: number): PaneMode | null {
  return PANE_MODES[Math.floor(u)] ?? null;
}

/** The hall's door on the campus: ring point (world) and the local-frame rotation (world/footprints toLocal). */
export function doorFrame(game: GlazedHall) {
  const p = PORTALS.find((q) => q.id === game);
  if (!p) throw new Error(`no portal for ${game}`);
  const d = ringPoint(p.angleDeg, ringOf(p));
  return { x: d.x, z: d.z, rotY: d.rotY, angleDeg: p.angleDeg, ring: ringOf(p), open: !!p.href };
}

/**
 * World → local (door frame) as a column-major 4×4 matrix (THREE.Matrix4.fromArray / a GLSL mat4 uniform):
 * local.x = dx·c − dz·s, local.z = dx·s + dz·c with (dx, dz) = world − door, c = cos rotY, s = sin rotY.
 */
export function worldToLocal(game: GlazedHall): number[] {
  const f = doorFrame(game);
  const c = Math.cos(f.rotY);
  const s = Math.sin(f.rotY);
  const tx = -(c * f.x - s * f.z);
  const tz = -(s * f.x + c * f.z);
  // columns: x axis, y axis, z axis, translation
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, tx, 0, tz, 1];
}

/** Apply a column-major 4×4 to a point. */
export function apply(m: number[], p: { x: number; y: number; z: number }) {
  return {
    x: m[0]! * p.x + m[4]! * p.y + m[8]! * p.z + m[12]!,
    y: m[1]! * p.x + m[5]! * p.y + m[9]! * p.z + m[13]!,
    z: m[2]! * p.x + m[6]! * p.y + m[10]! * p.z + m[14]!,
  };
}

/** A local-frame point → the room frame, for a pane whose south-wall plane is local z = zRef. */
export function localToRoom(game: GlazedHall, p: { x: number; y: number; z: number }, zRef: number) {
  const L = HALLS[game];
  return { x: p.x + L.door.x, y: p.y, z: p.z - zRef + L.size.d / 2 };
}

export interface Projection {
  /** room box the march is bounded by (m, room frame) */
  min: [number, number, number];
  max: [number, number, number];
  /**
   * where the interior is captured from (room frame): on the door axis OUTSIDE the south wall, at the distance and height
   * a visitor looks in from. The south wall, the door and everything outside it (userData.gkSouth) are left out of the
   * capture, so the room is seen through the door line exactly as from the forecourt.
   */
  at: [number, number, number];
  /** distance encoding range of the capture's alpha channel (m): from the capture point to the far corners */
  maxD: number;
  /** height the march stops at (under the ceiling fixtures; the ceiling above it is box-projected) */
  cut: number;
}

/** capture point: CAPTURE_OUT m outside the south wall on the door axis, at eye height */
export const CAPTURE_OUT = 3.5;
export const CAPTURE_EYE = 1.7;

/** Ray-march parameters and the capture point of a hall (room frame). */
export function projectionOf(game: GlazedHall): Projection {
  const L = HALLS[game];
  const { w, d, h } = L.size;
  const min: [number, number, number] = [-w / 2, 0, -d / 2];
  const max: [number, number, number] = [w / 2, h, d / 2];
  const y = Math.min(CAPTURE_EYE, h - 0.3);
  return {
    min,
    max,
    at: [L.door.x, y, d / 2 + CAPTURE_OUT],
    maxD: Math.ceil(Math.hypot(w / 2 + Math.abs(L.door.x), d + CAPTURE_OUT, h)),
    cut: Math.max(CAPTURE_EYE + 0.6, h - 0.9),
  };
}

/** Outside reflection capture: on the forecourt, `REFLECT_OUT` m in front of the door line, eye height (world). */
export const REFLECT_OUT = 6;
export function reflectionPoint(game: GlazedHall): [number, number, number] {
  const f = doorFrame(game);
  // local (0, 1.7, REFLECT_OUT) → world: world = door + R(−rotY)·local
  const c = Math.cos(f.rotY);
  const s = Math.sin(f.rotY);
  const lx = 0;
  const lz = REFLECT_OUT;
  return [f.x + c * lx + s * lz, 1.7, f.z - s * lx + c * lz];
}

/** distance from the player at which a hall's glass gets captured (and kept), and the order they are taken in */
export const CAPTURE_RANGE = 40;

/**
 * The next hall to capture: the nearest glazed hall within range (its door), not yet captured, that can be entered
 * (a closed hall is never mounted, its glass stays honest: tinted, reflecting).
 */
export function nextCapture(pos: { x: number; z: number }, done: ReadonlySet<string>, range = CAPTURE_RANGE): GlazedHall | null {
  let best: GlazedHall | null = null;
  let bd = Infinity;
  for (const g of GLAZED) {
    if (done.has(g)) continue;
    const f = doorFrame(g);
    if (!f.open) continue;
    const dd = Math.hypot(f.x - pos.x, f.z - pos.z);
    if (dd <= range && dd < bd) {
      bd = dd;
      best = g;
    }
  }
  return best;
}

/** GPU memory of the captures (bytes): RGBA8 cube maps, with their mip chain (+1/3) */
export const cubeBytes = (size: number, mips = true) => Math.round(size * size * 4 * 6 * (mips ? 4 / 3 : 1));

/**
 * Capture sizes. Behind the smoked glass the interior is only a dim, heavily blurred impression (a high mip level), so
 * the captures are small; the open doorway of a vestibule shows it sharper. The reflection is what reads on the glass:
 * desktop 512 px interior / 256 px reflection, phones and small-memory devices 256 / 128.
 */
export const interiorSize = (desktop: boolean) => (desktop ? 512 : 256);
export const reflectSize = (desktop: boolean) => (desktop ? 256 : 128);

/** a desktop-class device: not a coarse pointer, more than 4 GB reported (or not reported) */
export const isDesktopClass = (deviceMemoryGb: number | undefined, coarsePointer: boolean) => !coarsePointer && !(deviceMemoryGb !== undefined && deviceMemoryGb <= 4);

/** the most GPU memory the glass captures hold (bytes): one interior (with mips) and one reflection per glazed hall */
export const captureBudget = (desktop: boolean) => GLAZED.length * (cubeBytes(interiorSize(desktop)) + cubeBytes(reflectSize(desktop), false));

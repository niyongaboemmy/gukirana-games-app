import { HALLS, type HallGame } from "@/rooms/layouts";
import { PORTALS, ringOf, ringPoint } from "./layout";

/**
 * The hall glass as data (P2-WLD-18, P2-WLD-20). Pure: no three.js.
 *
 * Every glazed facade on the campus belongs to one hall and is the same smoked glass (world/glazing.ts): a near-black
 * body and, on its outside face, a Fresnel reflection of the real plaza in front of it (a small cube captured once
 * from the forecourt, world/GlassCapture). Nothing of the room behind is ever shown through it: the interior captures
 * of P2-WLD-18 (re-projected at depth through the open vestibule doorways and, dimly, through the glass) smeared and
 * tore at the edges of what the capture point could see, so the doors are closed smoked glass too (P2-WLD-20).
 *
 * Frames. A building's LOCAL frame is the District one (door on its ring point at the origin, +z towards the
 * fountain, world/footprints.ts). The hall's ROOM frame is its interior (rooms/layouts.ts: x ∈ ±w/2, y ∈ [0, h],
 * z ∈ ±d/2, the door in the south wall z = +d/2). A pane maps local → room by `room = local + (door.x, 0, d/2 − zRef)`:
 * the plane z = zRef of the facade (the glass line) is the room's south wall, exactly as walking through the door puts
 * you just inside it. Vision glass above the room's ceiling or beyond its side walls is drawn as back-painted spandrel.
 */

/** halls with glazing on the campus (the Boxing hall is reached through the Fight lobby, it has no facade) */
export const GLAZED = ["pool", "ludo", "igisoro", "admin", "arena", "fight"] as const satisfies readonly HallGame[];
export type GlazedHall = (typeof GLAZED)[number];
export const isGlazed = (g: string): g is GlazedHall => (GLAZED as readonly string[]).includes(g);

/**
 * How a pane is drawn (carried in its UV x, at the centre of an integer cell so merging keeps it exact):
 *  - `glass`: vision glass in a facade: smoked, the plaza reflected on it, the facade's pane grid where it has none;
 *  - `door`: a door leaf (the sliding doors, the vestibule's inner doors): the same smoked glass, no grid, never
 *    spandrel (it moves: no room-frame test);
 *  - `blind`: glazing whose room is not modelled behind it (side / back windows): closed woven blinds behind the glass;
 *  - `spandrel`: back-painted opaque glass (in front of a slab, a ceiling void or a wall): reflection only.
 */
export const PANE_MODES = ["glass", "door", "blind", "spandrel"] as const;
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

/** The hall's room box (room frame, m): vision glass outside it (above the ceiling, beyond the side walls) is spandrel. */
export function roomBox(game: GlazedHall): { min: [number, number, number]; max: [number, number, number] } {
  const { w, d, h } = HALLS[game].size;
  return { min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] };
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

/** distance from the player at which a hall's glass gets its reflection captured (and kept), nearest first */
export const CAPTURE_RANGE = 40;

/**
 * The next hall whose reflection to capture: the nearest glazed hall within range (its door), not yet captured. Closed
 * halls too: the reflection is of the plaza, the hall itself is never mounted for it.
 */
export function nextCapture(pos: { x: number; z: number }, done: ReadonlySet<string>, range = CAPTURE_RANGE): GlazedHall | null {
  let best: GlazedHall | null = null;
  let bd = Infinity;
  for (const g of GLAZED) {
    if (done.has(g)) continue;
    const f = doorFrame(g);
    const dd = Math.hypot(f.x - pos.x, f.z - pos.z);
    if (dd <= range && dd < bd) {
      bd = dd;
      best = g;
    }
  }
  return best;
}

/** GPU memory of a capture (bytes): an RGBA8 cube map, with its mip chain (+1/3) or without */
export const cubeBytes = (size: number, mips = true) => Math.round(size * size * 4 * 6 * (mips ? 4 / 3 : 1));

/** Reflection capture size: desktop 256 px, phones and small-memory devices 128 px (no mips). */
export const reflectSize = (desktop: boolean) => (desktop ? 256 : 128);

/** a desktop-class device: not a coarse pointer, more than 4 GB reported (or not reported) */
export const isDesktopClass = (deviceMemoryGb: number | undefined, coarsePointer: boolean) => !coarsePointer && !(deviceMemoryGb !== undefined && deviceMemoryGb <= 4);

/** the most GPU memory the glass captures hold (bytes): one reflection per glazed hall (≈ 9.4 MB desktop, 2.4 MB phone) */
export const captureBudget = (desktop: boolean) => GLAZED.length * cubeBytes(reflectSize(desktop), false);

import { FIGHT_BUILDING } from "@/fight/plan";
import { igisoroHall, PLOTS, wingedHall, type Plot } from "@/world/footprints";
import { DOOR_RING, PORTALS, ringOf, ringPoint } from "@/world/layout";

/**
 * The campus as seen out of a hall's entrance (P2-WLD-15), as data: every building on the campus plots (the plaza's
 * door ring AND the expansion ring: the Administrative Block, the Boxing hall's long body, the reserved sites)
 * reduced to its real volumes, heights and facade materials, in world coordinates. rooms/PlazaGlimpse turns this into
 * a few merged meshes in the hall's frame; the unit tests check every block stands on its plot's true bearing.
 */

export type ImpostorMat = "concreteDark" | "brick" | "limestone" | "white" | "charcoal" | "wood" | "hoarding";

export interface ImpostorBlock {
  plot: string;
  type: Plot["type"];
  /** world centre of the block (m) and the plot's rotation (its door frame) */
  x: number;
  z: number;
  rotY: number;
  w: number;
  d: number;
  h: number;
  mat: ImpostorMat;
  roof: "slab" | "thatch" | "none";
  /** the lit shopfront on the plaza side of this block (width, height), if it has one */
  glass: { w: number; h: number } | null;
}

const MAT: Record<Plot["type"], ImpostorMat> = {
  pool: "concreteDark",
  ludo: "brick",
  admin: "limestone",
  igisoro: "white",
  fight: "charcoal",
  service: "wood",
  soon: "hoarding",
  site: "hoarding",
  arena: "white",
};

/** height of the i-th footprint rectangle of a plot (the entrance wing first, the hall behind), from the real builds */
export function blockHeight(type: Plot["type"], i: number): number {
  switch (type) {
    case "pool":
      return i === 0 ? 8.4 : wingedHall("pool").H + 0.5;
    case "ludo":
      return i === 0 ? 6.1 : wingedHall("ludo").H + 0.5;
    case "admin":
      return i === 0 ? 7.6 : wingedHall("admin").H + 0.5;
    case "igisoro":
      return i === 0 ? 4.6 : igisoroHall().H;
    case "fight":
      return i === 0 ? FIGHT_BUILDING.lobbyH + 0.55 : FIGHT_BUILDING.H + 0.5;
    case "service":
      return 4.4;
    default:
      return 2.6; // site hoarding
  }
}

/** shopfront glazing on the wing of each building type: [width, height] or null (sites, hoarding) */
const GLASS: Partial<Record<Plot["type"], [number, number]>> = {
  pool: [13.2, 7.3],
  ludo: [13.1, 5.6],
  admin: [12.6, 5.7],
  fight: [19.2, 4.1],
  service: [8, 4],
};

/** Every building block on the campus except the viewing hall's own (and the arena drum, drawn as a drum). */
export function impostorBlocks(selfId: string): ImpostorBlock[] {
  const out: ImpostorBlock[] = [];
  for (const p of PLOTS) {
    if (p.id === selfId || p.type === "arena") continue;
    const r = ringPoint(p.angleDeg, p.ring);
    const c = Math.cos(r.rotY);
    const s = Math.sin(r.rotY);
    p.rects.forEach((f, i) => {
      const lx = (f.x0 + f.x1) / 2;
      const lz = (f.z0 + f.z1) / 2;
      const g = i === 0 ? GLASS[p.type] : undefined;
      out.push({
        plot: p.id,
        type: p.type,
        x: r.x + lx * c + lz * s,
        z: r.z - lx * s + lz * c,
        rotY: r.rotY,
        w: Math.abs(f.x1 - f.x0),
        d: Math.abs(f.z0 - f.z1),
        h: blockHeight(p.type, i),
        mat: MAT[p.type],
        roof: p.type === "igisoro" ? "thatch" : p.type === "soon" || p.type === "site" ? "none" : "slab",
        glass: g ? { w: Math.min(g[0], Math.abs(f.x1 - f.x0) - 0.6), h: g[1] } : null,
      });
    });
  }
  return out;
}

/** The viewing hall's door on the campus: its bearing and ring (the Administrative Block stands on the expansion ring). */
export function hallDoor(game: string) {
  const portal = PORTALS.find((p) => p.id === game);
  const deg = portal?.angleDeg ?? 0;
  return { deg, ring: portal ? ringOf(portal) : DOOR_RING };
}

import type { PortalId } from "@/lib/world-store";
import type { IconKind } from "./textures";

/**
 * Gukirana Arena District layout in metres (DESIGN-SPEC §6.1–6.2, docs/WORLD-ARENA-DESIGN.md §5).
 * Circular entry plaza (Agaseke fountain at the centre); every game building faces the fountain and its door is
 * the interaction point. North (−z) is the Tournament Arena with the Virunga volcano chain behind it.
 */
export const PLAZA_RADIUS = 28; // walkable radius of the entry plaza
export const DOOR_RING = 29.5; // building fronts / doors sit on this ring
export const SPAWN = { x: 0, z: 17 };
export const FOUNTAIN_RADIUS = 3.6;
export const INTERACT_RADIUS = 3.0;
export const DOOR = { w: 3.0, h: 4.0 }; // §6.1 door size

export interface PortalDef {
  id: PortalId;
  label: string;
  sub: string;
  color: string;
  href: string | null;
  angleDeg: number;
  kind: IconKind;
}

export const PORTALS: PortalDef[] = [
  { id: "soon-left", label: "Coming Soon", sub: "Draughts", color: "#8A94A6", href: null, angleDeg: -112, kind: "soon" },
  { id: "igisoro", label: "Igisoro Court", sub: "Strategy", color: "#27AE60", href: "/play/igisoro", angleDeg: -76, kind: "igisoro" },
  { id: "pool", label: "Pool Hall", sub: "8-Ball", color: "#2F80ED", href: "/play/pool", angleDeg: -38, kind: "pool" },
  { id: "arena", label: "Tournament Arena", sub: "Tournaments", color: "#9B51E0", href: null, angleDeg: 0, kind: "arena" },
  { id: "ludo", label: "Ludo Lounge", sub: "Dice & tactics", color: "#FF8A1F", href: "/play/ludo", angleDeg: 38, kind: "ludo" },
  { id: "soon-right", label: "Coming Soon", sub: "Chess", color: "#8A94A6", href: null, angleDeg: 76, kind: "soon" },
];

/** Service pavilion (wallet kiosk + help desk) closes the ring on the east side. */
export const SERVICE_ANGLE = 112;

export function ringPoint(angleDeg: number, r: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: r * Math.sin(a), z: -r * Math.cos(a), rotY: -a };
}

/** Door transform. The building's local +z faces the fountain; `entry` is where the "Enter" prompt triggers. */
export function portalTransform(p: PortalDef) {
  const d = ringPoint(p.angleDeg, DOOR_RING);
  const e = ringPoint(p.angleDeg, DOOR_RING - 2.4);
  return { x: d.x, z: d.z, rotY: d.rotY, entryX: e.x, entryZ: e.z };
}

/** Round obstacles inside the plaza (fountain, planters, totems). Player movement is pushed out of these. */
export interface Collider {
  x: number;
  z: number;
  r: number;
}

/** Planter islands with trees on the plaza ring, between the building doors. */
export const PLANTERS: { x: number; z: number; r: number }[] = [-131, -94, -57, -19, 19, 57, 94, 131].map((deg, i) => {
  const p = ringPoint(deg, 23.5);
  return { x: p.x, z: p.z, r: i % 2 ? 1.7 : 2.0 };
});

/** Digital totems: welcome board (west of spawn) and wallet kiosk (east of spawn). */
export const TOTEMS = [
  { id: "welcome", x: -8.5, z: 9.5, rotY: 0.7 },
  { id: "wallet", x: 8.5, z: 9.5, rotY: -0.7 },
] as const;

/** Timber benches on lava-stone plinths around the fountain, facing it. */
export const BENCHES = [30, 90, 150, -30, -90, -150].map((deg) => ringPoint(deg, 11));

export const COLLIDERS: Collider[] = [
  ...BENCHES.map((b) => ({ x: b.x, z: b.z, r: 1.05 })),
  { x: 0, z: 0, r: FOUNTAIN_RADIUS + 0.5 },
  ...PLANTERS.map((p) => ({ x: p.x, z: p.z, r: p.r + 0.35 })),
  ...TOTEMS.map((t) => ({ x: t.x, z: t.z, r: 1.1 })),
];

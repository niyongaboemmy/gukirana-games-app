import type { PortalId } from "@/lib/world-store";

/** Plaza layout in metres (DESIGN-SPEC-3D-VR §6.1–6.2). Spawn is south, portals arc to the north. */
export const PLAZA_RADIUS = 30;
export const SPAWN = { x: 0, z: 16 };
export const FOUNTAIN_RADIUS = 3.6;
export const PORTAL_RING = 17;
export const INTERACT_RADIUS = 3.4;

export interface PortalDef {
  id: PortalId;
  label: string;
  sub: string;
  emoji: string;
  color: string;
  href: string | null;
  angleDeg: number;
}

export const PORTALS: PortalDef[] = [
  { id: "soon-left", label: "Coming Soon", sub: "Draughts", emoji: "♟️", color: "#8A94A6", href: null, angleDeg: -100 },
  { id: "pool", label: "Pool Hall", sub: "8-Ball", emoji: "🎱", color: "#2F80ED", href: "/play/pool", angleDeg: -60 },
  { id: "igisoro", label: "Igisoro Court", sub: "Strategy", emoji: "🌰", color: "#27AE60", href: "/play/igisoro", angleDeg: -20 },
  { id: "ludo", label: "Ludo Lounge", sub: "Dice & tactics", emoji: "🎲", color: "#FF8A1F", href: "/play/ludo", angleDeg: 20 },
  { id: "arena", label: "Arena", sub: "Tournaments", emoji: "🏆", color: "#9B51E0", href: null, angleDeg: 60 },
  { id: "soon-right", label: "Coming Soon", sub: "Chess", emoji: "♞", color: "#8A94A6", href: null, angleDeg: 100 },
];

export function portalTransform(p: PortalDef) {
  const a = (p.angleDeg * Math.PI) / 180;
  const x = PORTAL_RING * Math.sin(a);
  const z = -PORTAL_RING * Math.cos(a);
  return { x, z, rotY: -a, entryX: x * 0.84, entryZ: z * 0.84 };
}

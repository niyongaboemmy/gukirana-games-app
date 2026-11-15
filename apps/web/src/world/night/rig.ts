import { LAMPS } from "../obstacles";
import { WALK_PROPS } from "../walk-mesh";
import { BOLLARDS, FORECOURT, GUARD_POSTS, STREET_LIGHTS } from "../campus";
import { BENCHES, DOOR_RING, ENTRY_Z, FOUNTAIN_RADIUS, PORTALS, portalTransform, ringPoint, TOTEMS, type PortalDef } from "../layout";
import { RING_PLANTERS } from "../beds";
import { NOTICE_BOARD } from "../activities";
import { ARENA, ARENA_FLAGPOLES, ARENA_FLAG, igisoroHall, PLOTS, sitePlan, wingedHall, WING_HW } from "../footprints";
import { FIGHT_BUILDING, FIGHT_DOOR_INSET } from "@/fight/plan";
import { SIGN } from "@/fight/exterior";
import { GATE_Z } from "../gate/Gate";
import type { Tier } from "../materials";
import { ANIM, threshold, type Anim, type PhotoGroup } from "./show";

/**
 * The campus night lighting rig (P2-WLD-21, docs/NIGHT-LIGHTING.md §3): every artificial light as data — where it is,
 * its colour temperature, its photocell group and its animation. Drawn without real lights by world/NightLights.tsx
 * in three instanced draws:
 *  - pools: light on the ground (additive discs: lamps, canopies, doors, bench and planter accents, coloured spill);
 *  - halos: the visible source (camera-facing glows: lamp heads, bulbs, fixture glints, beacons, the arena lantern);
 *  - washes: light on walls (vertical quads that MULTIPLY what is behind them: uplight grazing, downlight scallops,
 *    even sign washes — the wall's own texture shows through, glass stays dark).
 * Colours are sRGB hex at the source: 2700 K #ffb46b (walkway / heritage warm), 3000 K #ffc985 (campus standard),
 * 4000 K #ffe2c4 (the Pool Hall's cooler wash); accents per building.
 */

export type Vec3 = [number, number, number];
export interface PoolFx {
  x: number;
  z: number;
  y?: number;
  r: number;
  k: number;
  col: string;
  group: PhotoGroup;
  anim?: Anim;
  phase?: number;
}
export interface HaloFx {
  p: Vec3;
  /** size multiplier (1 = a lamp head, ~0.8 m glow close up) */
  size: number;
  k: number;
  col: string;
  group: PhotoGroup;
  anim?: Anim;
  phase?: number;
}
/** wash shape: 0 uplight (bright at the foot), 1 downlight (bright at the top), 2 even (sign / fascia wash) */
export type WashMode = 0 | 1 | 2;
export interface WashFx {
  /** bottom centre (world), the quad faces along rotY (local +z), offset a few cm off the wall by the caller */
  p: Vec3;
  rotY: number;
  w: number;
  h: number;
  k: number;
  col: string;
  mode: WashMode;
  /** light cones across the width (0 = one continuous wash) */
  scallops: number;
  group: PhotoGroup;
  anim?: Anim;
  phase?: number;
}
export interface Rig {
  pools: (PoolFx & { thr: number })[];
  halos: (HaloFx & { thr: number })[];
  washes: (WashFx & { thr: number })[];
}

export const K2700 = "#ffb46b";
export const K3000 = "#ffc985";
export const K4000 = "#ffe2c4";
const AMBER = "#ffab52";
const RED = "#ff3a2a";
const BLUE = "#4a78ff";

/** a building's local frame (door centre at the origin, facade towards +z) → world */
function frameOf(angleDeg: number, ring: number) {
  const d = ringPoint(angleDeg, ring);
  const c = Math.cos(d.rotY);
  const s = Math.sin(d.rotY);
  return {
    rotY: d.rotY,
    at: (lx: number, ly: number, lz: number): Vec3 => [d.x + lx * c + lz * s, ly, d.z - lx * s + lz * c],
  };
}
type Frame = ReturnType<typeof frameOf>;

export function buildRig(tier: Tier): Rig {
  const pools: PoolFx[] = [];
  const halos: HaloFx[] = [];
  const washes: WashFx[] = [];
  const pool = (f: Frame, lx: number, lz: number, r: number, k: number, col: string, group: PhotoGroup, anim?: Anim, phase?: number) => {
    const [x, , z] = f.at(lx, 0, lz);
    pools.push({ x, z, r, k, col, group, anim, phase });
  };
  /** a wash on a wall facing local +z at local z = lz (0.05 m off it), x from x0 to x1, y from y0, h high */
  const wash = (f: Frame, x0: number, x1: number, lz: number, y0: number, h: number, o: Omit<WashFx, "p" | "rotY" | "w" | "h">, face = 0) =>
    washes.push({ ...o, p: f.at((x0 + x1) / 2, y0, lz + (face ? -0.05 : 0.05)), rotY: f.rotY + face, w: x1 - x0, h });

  /* ---- campus lamps (P2-WLD-19): plaza, walks, street lights — a pool and a glowing head each ---- */
  for (const p of LAMPS) {
    pools.push({ x: p.x, z: p.z, r: 5.4, k: 1, col: K3000, group: "lamps" });
    halos.push({ p: [p.x, 4.5, p.z], size: 1, k: 1, col: K3000, group: "lamps" });
  }
  WALK_PROPS.forEach((p, i) => {
    if (p.kind === "lamp") {
      if (tier === "lite" && i % 2) return;
      const hx = p.x + Math.sin(p.rotY) * 0.3;
      const hz = p.z + Math.cos(p.rotY) * 0.3;
      pools.push({ x: hx, z: hz, r: 5.4, k: 1, col: K2700, group: "lamps" });
      halos.push({ p: [hx, 4.5, hz], size: 1, k: 1, col: K2700, group: "lamps" });
    } else if (p.kind === "bench" && tier !== "lite")
      // a low warm LED strip under the seat (walkway accent: you can see where to sit)
      pools.push({ x: p.x, z: p.z, r: 1.5, k: 0.55, col: K2700, group: "accents" });
  });
  for (const l of STREET_LIGHTS) {
    const hx = l.x + Math.sin(l.rotY) * 1.55;
    const hz = l.z + Math.cos(l.rotY) * 1.55;
    pools.push({ x: l.x + Math.sin(l.rotY) * 2.2, y: l.y, z: l.z + Math.cos(l.rotY) * 2.2, r: 8.5, k: 0.9, col: K3000, group: "lamps" });
    halos.push({ p: [hx, l.y + 7.82, hz], size: 1, k: 1, col: K3000, group: "lamps" });
  }

  /* ---- plaza furniture: bench strips, planter uplights, totems, notice board ---- */
  for (const bnch of BENCHES) pools.push({ x: bnch.x, z: bnch.z, r: 1.6, k: 0.6, col: K2700, group: "accents" });
  if (tier !== "lite") for (const p of RING_PLANTERS) pools.push({ x: p.x, z: p.z, r: p.r + 0.9, k: 0.32, col: K2700, group: "accents" });
  for (const t of TOTEMS) {
    // the screen's own glow on the paving in front of it
    pools.push({ x: t.x + Math.sin(t.rotY) * 0.9, z: t.z + Math.cos(t.rotY) * 0.9, r: 1.8, k: 0.35, col: "#9fb4ff", group: "signs" });
  }
  {
    const nb = NOTICE_BOARD;
    const f = { rotY: nb.rotY, at: (lx: number, ly: number, lz: number): Vec3 => [nb.x + lx * Math.cos(nb.rotY) + lz * Math.sin(nb.rotY), ly, nb.z - lx * Math.sin(nb.rotY) + lz * Math.cos(nb.rotY)] };
    // a sign light over the board: the notices readable at night
    wash(f, -nb.w / 2, nb.w / 2, 0.1, 0.9, nb.h + 0.5, { k: 1.3, col: K3000, mode: 1, scallops: 0, group: "accents" });
    pool(f, 0, 1.0, 1.6, 0.4, K3000, "accents");
  }

  /* ---- the fountain: basin lights, the Agaseke's uplight fixtures, the lid's halo, the court around it ---- */
  for (let i = 0; i < 6; i++) {
    const a = i * 1.0472 + 0.26;
    halos.push({ p: [Math.sin(a) * 0.98, 1.1, Math.cos(a) * 0.98], size: 0.22, k: 1.6, col: K3000, group: "signs" });
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    halos.push({ p: [Math.sin(a) * (FOUNTAIN_RADIUS - 0.62), 0.44, Math.cos(a) * (FOUNTAIN_RADIUS - 0.62)], size: 0.3, k: 1.1, col: "#fff1d8", group: "signs" });
  }
  halos.push({ p: [0, 1.05 + 3.75, 0], size: 1.6, k: 0.28, col: K2700, group: "signs" });
  pools.push({ x: 0, z: 0, r: FOUNTAIN_RADIUS + 2.6, k: 0.42, col: "#ffe4c0", group: "signs" });

  /* ---- halls: each one's night identity ---- */
  const door = (kind: PortalDef["kind"]) => {
    const p = PORTALS.find((q) => q.kind === kind);
    return p ? { def: p, f: frameOf(p.angleDeg, p.ring ?? DOOR_RING) } : null;
  };
  // every hall door: the canopy / porch downlights on the doorstep (the doors are findable at night)
  for (const d of PORTALS) {
    const t = portalTransform(d);
    pools.push({ x: t.entryX, z: t.entryZ, r: 4.6, k: d.kind === "soon" ? 0.45 : 1.15, col: K3000, group: "lamps" });
  }

  // Pool Hall: a cooler 4000 K — downlight scallops on the hall's front shoulders, warm light up the timber fins
  const pl = door("pool");
  if (pl) {
    const h = wingedHall("pool");
    for (const [a, c] of [
      [h.x0, -WING_HW],
      [WING_HW, h.x1],
    ] as const)
      if (c - a > 1) wash(pl.f, a + 0.3, c - 0.3, h.z0, 0.2, h.H - 0.3, { k: 1.6, col: K4000, mode: 1, scallops: Math.max(1, Math.round((c - a) / 3.2)), group: "facades" });
    for (const s of [-1, 1]) wash(pl.f, s > 0 ? 3.0 : -6.8, s > 0 ? 6.8 : -3.0, 0.1, 0, 7.2, { k: 1.4, col: K3000, mode: 0, scallops: 3, group: "facades" });
    wash(pl.f, -7.6, 7.6, 1.4, 7.5, 0.9, { k: 1.0, col: K4000, mode: 2, scallops: 0, group: "facades" });
  }

  // Ludo Lounge: warm 2700 K grazing up the brick piers and the lounge's brick shoulders, the giant die in a spot
  const lu = door("ludo");
  if (lu) {
    const h = wingedHall("ludo");
    for (const x of [-6.6, -4.4, 4.4, 6.6]) wash(lu.f, x - 0.32, x + 0.32, 0.15, 0, 5.6, { k: 2.4, col: K2700, mode: 0, scallops: 1, group: "facades" });
    for (const s of [-1, 1]) wash(lu.f, s * 7 - 0.23, s * 7 + 0.23, 0, 0, 5.6, { k: 2.0, col: K2700, mode: 0, scallops: 1, group: "facades" });
    for (const [a, c] of [
      [h.x0, -WING_HW],
      [WING_HW, h.x1],
    ] as const)
      if (c - a > 1) wash(lu.f, a + 0.3, c - 0.3, h.z0 + 0.12, 0, h.H - 0.2, { k: 2.0, col: K2700, mode: 0, scallops: Math.max(1, Math.round((c - a) / 2.6)), group: "facades" });
    if (tier !== "lite") halos.push({ p: lu.f.at(4, h.H + 0.5 + 4.4, h.z0 - 4), size: 4, k: 0.18, col: "#ffd9a8", group: "facades" });
  }

  // Igisoro Court: heritage warm uplights up the white lime walls to the Imigongo frieze and the thatch eaves
  const ig = door("igisoro");
  if (ig) {
    const h = igisoroHall();
    const wx = WING_HW - 0.6;
    const z0 = h.doorZ + h.t / 2;
    for (const [a, c] of [
      [-wx, -3.1],
      [3.1, wx],
    ] as const)
      wash(ig.f, a + 0.1, c - 0.1, z0 + 0.1, 0, 4.5, { k: 2.2, col: K2700, mode: 0, scallops: 2, group: "facades" });
    for (const [a, c] of [
      [h.x0, -wx - 0.2],
      [wx + 0.2, h.x1],
    ] as const)
      if (c - a > 1) wash(ig.f, a + 0.2, c - 0.2, h.z0 + 0.1, 0, 5.5, { k: 2.2, col: K2700, mode: 0, scallops: Math.max(1, Math.round((c - a) / 3)), group: "facades" });
    // the porch: the fascia board's lettering lit from the porch soffit
    wash(ig.f, -2.3, 2.3, 0.9, 3.83, 0.62, { k: 1.6, col: K2700, mode: 1, scallops: 0, group: "signs" });
  }

  // Tournament Arena: the canopy's downlight grid on the forecourt, ground glints at the flagpoles, the lantern
  // breathing on the roof (the screen's rising light and the amber lines are shader hooks: night/material-hooks)
  const ar = door("arena");
  if (ar) {
    for (let x = -9; x <= 9.01; x += 3)
      for (const z of [1.3, -1.9]) {
        if (z < 0 && Math.abs(x) < 6.5) continue;
        pool(ar.f, x, z, 2.4, 0.55, K3000, "facades");
      }
    for (const x of ARENA_FLAGPOLES) {
      halos.push({ p: ar.f.at(x, 0.32, ARENA_FLAG.z + 0.25), size: 0.2, k: 1.2, col: K3000, group: "facades" });
      pool(ar.f, x, ARENA_FLAG.z, 1.1, 0.5, K3000, "facades");
    }
    const roofY = ARENA.wall + 0.1 + 0.9;
    halos.push({ p: ar.f.at(0, roofY + 3.4 + 0.4, ARENA.cz), size: 6, k: 0.3, col: "#ffbf7a", group: "signs", anim: ANIM.breathe, phase: 0.5 });
  }

  // Fight Games: canopy downlights, wall washers either side of the sign, red and blue spill trading places
  const fg = door("fight");
  if (fg) {
    const F = FIGHT_BUILDING;
    const face = FIGHT_DOOR_INSET + 0.4;
    for (let i = 0; i < 6; i++) for (const z of [1.3, 3.1]) pool(fg.f, -5.5 + i * 2.2, face + z, 1.9, 0.55, K3000, "facades");
    for (const s of [-1, 1]) wash(fg.f, s * (SIGN.w / 2 + 2) - 1.6, s * (SIGN.w / 2 + 2) + 1.6, F.front + 0.12, F.lobbyH + 0.5, F.H - F.lobbyH - 1.0, { k: 1.8, col: K3000, mode: 0, scallops: 1, group: "facades" });
    for (const s of [-1, 1]) {
      const x0 = 9.6 + 0.45;
      const x1 = F.lobbyHw - 0.4;
      if (x1 - x0 > 0.5) wash(fg.f, s > 0 ? x0 : -x1, s > 0 ? x1 : -x0, face + 0.24, 0.3, F.lobbyH - 0.8, { k: 1.8, col: K3000, mode: 0, scallops: Math.max(1, Math.round((x1 - x0) / 1.5)), group: "facades" });
    }
    if (tier !== "lite")
      for (const s of [-1, 1]) pool(fg.f, s * 9, face + 6, 3.2, 0.32, s < 0 ? RED : BLUE, "facades", ANIM.pulse, s < 0 ? 0 : 0.5);
  }

  // Administrative Block: calm 3000 K — canopy downlights, grazing up the limestone piers, the lettered fascia lit
  const ad = door("admin");
  if (ad) {
    const W = 14.4;
    for (const x of [-2.4, 0, 2.4]) pool(ad.f, x, 0.1, 2.4, 0.85, K3000, "facades");
    for (const s of [-1, 1]) wash(ad.f, s * (W / 2 - 0.45) - 0.45, s * (W / 2 - 0.45) + 0.45, 0, 0, 7.2, { k: 1.4, col: K3000, mode: 0, scallops: 1, group: "facades" });
    wash(ad.f, -W / 2 + 0.9, W / 2 - 0.9, 0.1, 7.2 - 1.5, 1.5, { k: 1.3, col: K3000, mode: 2, scallops: 0, group: "signs" });
  }

  // café pavilion: the warm interior glow through the glass, the terrace, festoon string lights along the fascia
  {
    const svc = PLOTS.find((p) => p.type === "service");
    if (svc) {
      const f = frameOf(svc.angleDeg, svc.ring);
      pool(f, 0, -4, 4.2, 1.0, K2700, "facades");
      pool(f, 0, 2.2, 4.4, 0.55, K2700, "facades");
      const n = tier === "lite" ? 9 : 17;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const x = -5 + 10 * u;
        const sag = 0.28 * Math.sin(((u * 4) % 1) * Math.PI); // four swags between hanging points
        halos.push({ p: f.at(x, 3.9 - sag, 0.75), size: 0.16, k: 1.8, col: "#ffcf8a", group: "facades", anim: ANIM.shimmer, phase: (i * 0.37) % 1 });
      }
    }
  }

  // construction sites: amber beacons on the site gates, a red aviation light on every crane, a work light at the gate
  PLOTS.forEach((p, i) => {
    if (p.type !== "site" && p.type !== "soon") return;
    const f = frameOf(p.angleDeg, p.ring);
    const ringPlot = p.ring === DOOR_RING;
    for (const s of [-1, 1]) halos.push({ p: f.at(s * 1.75, 4.62, -0.4), size: 0.3, k: 1.3, col: AMBER, group: "signs", anim: ANIM.beacon, phase: s < 0 ? 0 : 0.5 });
    pool(f, 0, 0.8, 3.2, 0.35, AMBER, "lamps");
    const crane = ringPlot || i % 2 === 0;
    if (!crane || (tier === "lite" && !ringPlot)) return;
    if (ringPlot) halos.push({ p: f.at(2, 30.4, -12), size: 0.5, k: 1.6, col: RED, group: "signs", anim: ANIM.beacon, phase: 0.25 });
    else {
      const h = sitePlan(p.away);
      halos.push({ p: f.at((h.x0 + h.x1) / 2 + 6, 30.4, (h.z0 + h.z1) / 2), size: 0.5, k: 1.6, col: RED, group: "signs", anim: ANIM.beacon, phase: 0.25 });
    }
  });

  /* ---- arrival gate, plaza entry gate, forecourt, guard posts, bollards ---- */
  for (const Z of [GATE_Z, ENTRY_Z]) {
    const outer = Z === GATE_Z;
    pools.push({ x: 0, z: Z - 1, r: 6, k: 1.1, col: K3000, group: "lamps" });
    if (outer) pools.push({ x: 0, z: Z + 3.5, r: 5, k: 0.9, col: K3000, group: "lamps" });
    // the basalt pylons with their Imigongo inlays, grazed from the paving (both faces)
    const f = { rotY: 0, at: (lx: number, ly: number, lz: number): Vec3 => [lx, ly, Z + lz] };
    for (const s of [-1, 1]) {
      wash(f, s * 8.6 - 0.78, s * 8.6 + 0.78, 1.2, 0, 5.3, { k: 2.2, col: K3000, mode: 0, scallops: 1, group: "facades" });
      wash(f, s * 8.6 - 0.78, s * 8.6 + 0.78, -1.2, 0, 5.3, { k: 2.2, col: K3000, mode: 0, scallops: 1, group: "facades" }, Math.PI);
    }
  }
  pools.push({ x: 0, z: (FORECOURT.walk.z0 + FORECOURT.walk.z1) / 2, r: 6, k: 0.8, col: K3000, group: "lamps" });
  for (const g of GUARD_POSTS) {
    pools.push({ x: g.x, z: g.z + 1.2, r: 3.6, k: 0.8, col: K3000, group: "lamps" });
    halos.push({ p: [g.x, 2.6, g.z + 1.0], size: 0.35, k: 1.0, col: K3000, group: "lamps" });
  }
  if (tier !== "lite")
    BOLLARDS.forEach((b) => {
      pools.push({ x: b.x, z: b.z, r: 1.3, k: 0.45, col: K2700, group: "accents" });
      halos.push({ p: [b.x, 0.84, b.z], size: 0.14, k: 1.1, col: K2700, group: "accents" });
    });

  // photocell thresholds: deterministic per fixture, staggered within the group's window
  let n = 0;
  const thr = <T extends { group: PhotoGroup }>(x: T) => ({ ...x, thr: threshold(x.group, n++) });
  return {
    pools: pools.map(thr),
    halos: halos.map(thr),
    washes: washes.map(thr),
  };
}

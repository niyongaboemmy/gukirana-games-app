import * as THREE from "three";
import { DOOR, DOOR_RING, FIGHT_ANGLE, SPAWN } from "@/world/layout";
import type { GeoBatch } from "@/world/geo";
import { interiorPane } from "@/world/interior-glass";
import { FIGHT_BUILDING, FIGHT_DOOR_INSET } from "./plan";

/**
 * Fight Games hall exterior (P3-FGT-01, plan §4.1; modernised in P3-FGT-03), built in the building's own door frame
 * (door centre at the origin, facade towards +z; the District places the frame from the plot, so moving the building
 * is a change of its site constants only): the tall Boxing hall (chamfered back corners, timber band, light lines
 * along the parapet) with the lit "FIGHT GAMES" sign on its front, and the lobby wing — glazing either side of the
 * door, a cantilevered entrance canopy with a lit fascia and downlights, a step-free forecourt, planters with hedges
 * and small trees, the live board on the left wing. Merged into the district batch: ~one draw call per material.
 */
export function fightHall(b: GeoBatch) {
  const f = FIGHT_BUILDING;
  const t = 0.4;
  const seg = (key: string, ax: number, az: number, cx: number, cz: number, h: number, y0 = 0, tile = 2) => {
    const len = Math.hypot(cx - ax, cz - az);
    if (len < 0.05) return;
    b.box(key, len, h, t, { p: [(ax + cx) / 2, y0 + h / 2, (az + cz) / 2], r: [0, -Math.atan2(cz - az, cx - ax), 0], tile });
  };

  /* ---- Boxing hall volume (P3-FGT-11: centred on its own line f.cx, off the door axis) ---- */
  b.frame([f.cx, 0, 0], 0, () => hallVolume(b, seg));
  lobbyWing(b);
}

type Seg = (key: string, ax: number, az: number, cx: number, cz: number, h: number, y0?: number, tile?: number) => void;
function hallVolume(b: GeoBatch, seg: Seg) {
  const f = FIGHT_BUILDING;
  const t = 0.4;
  const H = f.H;
  const pts: [number, number][] = [
    [-f.hw, f.front],
    [-f.hw, f.back + f.chamfer],
    [-f.hw + f.chamfer, f.back],
    [f.hw - f.chamfer, f.back],
    [f.hw, f.back + f.chamfer],
    [f.hw, f.front],
  ];
  for (let i = 0; i < pts.length - 1; i++) seg("charcoal", pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1], H);
  // the front wall (the part above the lobby roof and either side of the lobby wing)
  b.box("charcoal", f.hw * 2, H, t, { p: [0, H / 2, f.front - t / 2], tile: 2 });
  // basalt base course, roof slab, parapet
  for (let i = 0; i < pts.length - 1; i++) seg("lava", pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1], 0.9, 0, 1.2);
  const roofD = f.front - (f.back + f.chamfer);
  b.box("concreteDark", f.hw * 2 + 0.4, 0.5, roofD, { p: [0, H + 0.25, f.front - roofD / 2], tile: 2 });
  b.box("concreteDark", (f.hw - f.chamfer) * 2, 0.5, f.chamfer, { p: [0, H + 0.25, f.back + f.chamfer / 2], tile: 2 });
  // timber slat band and the red / blue light lines under the parapet, on the front and the two long sides
  for (const s of [-1, 1]) {
    const x = s * (f.hw + 0.03);
    b.box("woodDark", 0.06, 1.6, roofD - 2, { p: [x, H - 1.4, f.front - roofD / 2], tile: 1 });
    b.box("led-fight", 0.04, 0.05, roofD - 2, { p: [x + s * 0.03, H - 0.45, f.front - roofD / 2] });
    b.box("led-corner-blue", 0.04, 0.05, roofD - 2, { p: [x + s * 0.03, H - 2.35, f.front - roofD / 2] });
  }
  // the front beside the lobby wing, where the hall's body is wider than the pavilion (P3-FGT-11: on the +x side)
  for (const s of [-1, 1]) {
    const x0 = s * f.lobbyHw - f.cx + s * 0.6; // the pavilion's side wall, in this frame
    const x1 = s * (f.hw - 0.6);
    if (s * (x1 - x0) > 0.9) b.box("woodDark", Math.abs(x1 - x0), 1.6, 0.06, { p: [(x0 + x1) / 2, H - 1.4, f.front + 0.03], tile: 1 });
  }
  b.box("led-fight", f.hw * 2 - 1.2, 0.05, 0.04, { p: [0, H - 0.45, f.front + 0.06] });
  b.box("led-corner-blue", f.hw * 2 - 1.2, 0.05, 0.04, { p: [0, H - 2.35, f.front + 0.06] });
  // rooftop plant, roof lights along the long hall
  b.box("steel", 3.2, 1.3, 2.2, { p: [-7, H + 1.15, (f.front + f.back) / 2 + 12] });
  b.box("steel", 2.4, 1.0, 1.6, { p: [8, H + 1.0, (f.front + f.back) / 2 - 20] });
  for (let z = f.front - 10; z > f.back + 8; z -= 12) b.box("glass", 5.5, 0.35, 3.2, { p: [0, H + 0.68, z], tile: 2 });
  // the long side walls (P2-WLD-14: the south one faces the arrival gate): tall red light fins every 12 m
  for (const s of [-1, 1])
    for (let z = f.front - 6; z > f.back + 6; z -= 12) b.box("led-fight", 0.05, H - 4.4, 0.12, { p: [s * (f.hw + 0.05), (H - 4.4) / 2 + 1.1, z] });

}

function lobbyWing(b: GeoBatch) {
  const f = FIGHT_BUILDING;
  const t = 0.4;
  /* ---- lobby wing (P3-FGT-03: a modern entrance, same footprint) ---- */
  const LH = f.lobbyH;
  const fz = FIGHT_DOOR_INSET + t / 2; // front wall centre (its inside face is the door line)
  const face = fz + t / 2; // outside face of the front wall
  const ow = DOOR.w + 0.4;
  const oh = DOOR.h + 0.2;
  const side = f.lobbyHw - ow / 2;
  for (const s of [-1, 1]) b.box("charcoal", side, LH, t, { p: [s * (ow / 2 + side / 2), LH / 2, fz], tile: 2 });
  b.box("charcoal", ow, LH - oh, t, { p: [0, oh + (LH - oh) / 2, fz], tile: 2 });
  for (const s of [-1, 1]) b.box("charcoal", t, LH, fz - f.front, { p: [s * (f.lobbyHw - t / 2), LH / 2, (fz + f.front) / 2], tile: 2 });
  b.box("concreteDark", f.lobbyHw * 2 + 1.0, 0.55, fz - f.front + 1.2, { p: [0, LH + 0.27, (fz + f.front) / 2 + 0.4], tile: 2 });
  for (const s of [-1, 1]) b.box("lava", side, 0.3, 0.1, { p: [s * (ow / 2 + side / 2), 0.15, face + 0.05], tile: 1.2 });

  // floor-to-canopy glazing either side of the door: the lobby behind it, slim steel mullions and a transom
  const G = { x0: 2.0, x1: 9.6, y0: 0.3, y1: 4.4 };
  const gw = G.x1 - G.x0;
  for (const s of [-1, 1]) {
    const cx = s * (G.x0 + gw / 2);
    // (P2-WLD-15: interior-mapped glass: the lit training-ring corner and the heavy bags read through it with depth)
    b.box("screenFrame", gw, G.y1 - G.y0, 0.03, { p: [cx, (G.y0 + G.y1) / 2, face + 0.015] });
    interiorPane(b, "fight", "shopfront", gw, G.y1 - G.y0, [cx, (G.y0 + G.y1) / 2, face + 0.04]);
    for (let k = 0; k <= 6; k++) b.box("steel", 0.07, G.y1 - G.y0 + 0.1, 0.12, { p: [s * (G.x0 + (gw * k) / 6), (G.y0 + G.y1) / 2, face + 0.08] });
    b.box("steel", gw + 0.07, 0.07, 0.12, { p: [cx, G.y0, face + 0.08] });
    b.box("steel", gw + 0.07, 0.06, 0.12, { p: [cx, 3.2, face + 0.08] });
    // a warm uplight line along the sill
    b.box("led-warm", gw, 0.03, 0.03, { p: [cx, G.y0 + 0.06, face + 0.16] });
  }
  // timber slats on the outer wings (clear of the glazing and the live board on the left)
  for (let x = G.x1 + 0.45; x <= f.lobbyHw - 0.4; x += 0.42) {
    for (const s of [-1, 1]) b.box("woodDark", 0.09, LH - 0.8, 0.2, { p: [s * x, (LH - 0.8) / 2 + 0.3, face + 0.12], tile: 1 });
  }

  // the entrance canopy: a thin cantilevered slab over the door and the glazing, a lit fascia, downlights
  const C = { w: 14, d: 4.4, y: 4.62, th: 0.28 };
  b.box("concreteDark", C.w, C.th, C.d, { p: [0, C.y + C.th / 2, face + C.d / 2], tile: 2 });
  b.box("charcoal", C.w + 0.06, 0.62, 0.1, { p: [0, C.y + 0.2, face + C.d + 0.03], tile: 2 });
  b.box("led-fight", C.w + 0.08, 0.05, 0.05, { p: [0, C.y - 0.1, face + C.d + 0.06] });
  for (const s of [-1, 1]) b.box("charcoal", 0.1, 0.62, C.d, { p: [s * (C.w / 2 + 0.02), C.y + 0.2, face + C.d / 2], tile: 2 });
  // two slim tie rods from the hall wall to the canopy edge
  for (const s of [-1, 1]) {
    const a = new THREE.Vector3(s * 5.5, LH - 0.2, face + 0.1);
    const e = new THREE.Vector3(s * 5.5, C.y + C.th, face + C.d - 0.3);
    const len = a.distanceTo(e);
    const rod = new THREE.CylinderGeometry(0.035, 0.035, len, 8);
    rod.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), e.clone().sub(a).normalize()));
    b.add("steel", rod, { p: [(a.x + e.x) / 2, (a.y + e.y) / 2, (a.z + e.z) / 2] });
  }
  for (let i = 0; i < 6; i++)
    for (const z of [1.3, 3.1]) b.cyl("led-warm", 0.12, 0.12, 0.03, 16, { p: [-5.5 + i * 2.2, C.y - 0.01, face + z] });

  // door surround
  const hw = DOOR.w / 2;
  for (const s of [-1, 1]) b.box("steel", 0.18, DOOR.h + 0.18, 0.4, { p: [s * (hw + 0.09), (DOOR.h + 0.18) / 2, FIGHT_DOOR_INSET + 0.1] });
  b.box("steel", DOOR.w + 0.36, 0.18, 0.4, { p: [0, DOOR.h + 0.09, FIGHT_DOOR_INSET + 0.1] });
  b.box("led-fight", DOOR.w + 0.44, 0.03, 0.03, { p: [0, DOOR.h + 0.22, FIGHT_DOOR_INSET + 0.32] });

  // (P2-WLD-14: the pavilion stands on the plaza's door ring, its forecourt is the plaza's own step-free paving)
  // behind the glazing (P2-WLD-15): the training ring's corner is drawn by the interior-mapped glass above (the boxes
  // that stood here were behind the solid front wall and never showed)

  /* ---- the rooftop sign on the pavilion (P2-WLD-14): turned towards the arrival, lettering in FightFacadeBoard ---- */
  b.frame([ROOF_SIGN.x, 0, ROOF_SIGN.z], ROOF_SIGN.rotY, () => {
    for (const s of [-1, 1]) b.box("steel", 0.16, ROOF_SIGN.y - ROOF_SIGN.h / 2 - LH, 0.16, { p: [s * (ROOF_SIGN.w / 2 - 0.8), (ROOF_SIGN.y - ROOF_SIGN.h / 2 + LH) / 2, 0] });
    b.box("screenFrame", ROOF_SIGN.w, ROOF_SIGN.h, 0.36, { p: [0, ROOF_SIGN.y, 0] });
    for (const z of [-0.2, 0.2]) {
      b.box("led-fight", ROOF_SIGN.w - 0.3, 0.07, 0.04, { p: [0, ROOF_SIGN.y - ROOF_SIGN.h / 2 + 0.18, z] });
      b.box("led-fight", ROOF_SIGN.w - 0.3, 0.07, 0.04, { p: [0, ROOF_SIGN.y + ROOF_SIGN.h / 2 - 0.18, z] });
    }
  });

  /* ---- the lit "FIGHT GAMES" sign on the hall front above the lobby roof (letters: FightFacadeBoard) ---- */
  const sy = SIGN.y;
  const sz = f.front + 0.12;
  b.box("screenFrame", SIGN.w, SIGN.h, 0.24, { p: [0, sy, sz] });
  b.box("led-fight", SIGN.w - 1.2, 0.08, 0.04, { p: [0, sy - SIGN.h / 2 + 0.32, sz + 0.14] });
  b.box("led-fight", 0.14, SIGN.h - 0.5, 0.06, { p: [-SIGN.w / 2 + 0.35, sy, sz + 0.14] });
  b.box("led-corner-blue", 0.14, SIGN.h - 0.5, 0.06, { p: [SIGN.w / 2 - 0.35, sy, sz + 0.14] });
  // wall washers on the hall front either side of the sign
  for (const s of [-1, 1]) b.box("led-warm", 0.05, 0.05, 0.05, { p: [s * (SIGN.w / 2 + 2), LH + 0.6, f.front + 0.1] });

  /* ---- the live board on the left wing (its text: FightFacadeBoard) ---- */
  b.box("screenFrame", LIVE_BOARD.w + 0.2, LIVE_BOARD.h + 0.2, 0.14, { p: [LIVE_BOARD.x, LIVE_BOARD.y, face + 0.3] });
  b.box("steel", 0.12, LIVE_BOARD.y - LIVE_BOARD.h / 2, 0.12, { p: [LIVE_BOARD.x, (LIVE_BOARD.y - LIVE_BOARD.h / 2) / 2, face + 0.3] });
}

/**
 * The rooftop sign over the pavilion's north end (door frame): a double-sided light box turned towards the arrival
 * spawn (the camera behind it), so "FIGHT GAMES" reads from the plaza entry as well as from the fountain (P2-WLD-14).
 */
export const ROOF_SIGN = (() => {
  const x = -10.4;
  const z = (FIGHT_DOOR_INSET + FIGHT_BUILDING.front) / 2;
  // the spawn's follow camera in the door frame: the facade at 88° faces west, the spawn lies south-west of it
  const a = (FIGHT_ANGLE * Math.PI) / 180;
  const door = { x: DOOR_RING * Math.sin(a), z: -DOOR_RING * Math.cos(a) };
  const cam = { x: SPAWN.x - door.x, z: SPAWN.z + 9 - door.z };
  const c = Math.cos(-a);
  const s = Math.sin(-a);
  const lx = cam.x * c - cam.z * s - x;
  const lz = cam.x * s + cam.z * c - z;
  return { x, z, rotY: Math.atan2(lx, lz) * 0.8, y: FIGHT_BUILDING.lobbyH + 3.2, w: 7.6, h: 2.1 };
})();
/** the facade sign over the lobby roof and the live board (door frame; letters drawn by FightFacadeBoard) */
// (P2-WLD-14: high enough on the hall front to clear the pavilion roof from the plaza, 20–30 m away)
export const SIGN = { y: FIGHT_BUILDING.lobbyH + 3.4, w: 17, h: 2.7 };
export const LIVE_BOARD = { x: -12.4, y: 3.3, w: 4.8, h: 2.4, z: FIGHT_DOOR_INSET + 0.4 + 0.39 };

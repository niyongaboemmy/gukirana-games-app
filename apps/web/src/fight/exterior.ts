import { DOOR } from "@/world/layout";
import type { GeoBatch } from "@/world/geo";
import { FIGHT_BUILDING, FIGHT_DOOR_INSET } from "./plan";

/**
 * Fight Games hall exterior (P3-FGT-01, plan §4.1), built in its plaza door frame (door centre at the origin, facade
 * towards +z): a low charcoal lobby wing with a timber-slat facade, red and blue light lines and the ring-and-glove
 * sign, and the tall Boxing hall behind it (chamfered back corners, timber band, light lines along the parapet).
 * Merged into the district batch (world/District.ts): ~one draw call per material.
 */
export function fightHall(b: GeoBatch) {
  const f = FIGHT_BUILDING;
  const t = 0.4;
  const seg = (key: string, ax: number, az: number, cx: number, cz: number, h: number, y0 = 0, tile = 2) => {
    const len = Math.hypot(cx - ax, cz - az);
    if (len < 0.05) return;
    b.box(key, len, h, t, { p: [(ax + cx) / 2, y0 + h / 2, (az + cz) / 2], r: [0, -Math.atan2(cz - az, cx - ax), 0], tile });
  };

  /* ---- Boxing hall volume ---- */
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
  for (const s of [-1, 1]) {
    const x0 = s * (f.lobbyHw + 0.6);
    const x1 = s * (f.hw - 0.6);
    b.box("woodDark", Math.abs(x1 - x0), 1.6, 0.06, { p: [(x0 + x1) / 2, H - 1.4, f.front + 0.03], tile: 1 });
  }
  b.box("led-fight", f.hw * 2 - 1.2, 0.05, 0.04, { p: [0, H - 0.45, f.front + 0.06] });
  b.box("led-corner-blue", f.hw * 2 - 1.2, 0.05, 0.04, { p: [0, H - 2.35, f.front + 0.06] });
  // rooftop plant
  b.box("steel", 3.2, 1.3, 2.2, { p: [-18, H + 1.15, (f.front + f.back) / 2] });
  b.box("steel", 2.4, 1.0, 1.6, { p: [22, H + 1.0, (f.front + f.back) / 2 - 6] });

  /* ---- lobby wing ---- */
  const LH = f.lobbyH;
  const fz = FIGHT_DOOR_INSET + t / 2; // front wall centre (its inside face is the door line)
  const ow = DOOR.w + 0.4;
  const oh = DOOR.h + 0.2;
  const side = f.lobbyHw - ow / 2;
  for (const s of [-1, 1]) b.box("charcoal", side, LH, t, { p: [s * (ow / 2 + side / 2), LH / 2, fz], tile: 2 });
  b.box("charcoal", ow, LH - oh, t, { p: [0, oh + (LH - oh) / 2, fz], tile: 2 });
  for (const s of [-1, 1]) b.box("charcoal", t, LH, fz - f.front, { p: [s * (f.lobbyHw - t / 2), LH / 2, (fz + f.front) / 2], tile: 2 });
  b.box("concreteDark", f.lobbyHw * 2 + 1.0, 0.55, fz - f.front + 2.2, { p: [0, LH + 0.27, (fz + f.front) / 2 + 0.9], tile: 2 });
  for (const s of [-1, 1]) b.box("lava", side, 0.9, 0.12, { p: [s * (ow / 2 + side / 2), 0.45, fz + t / 2 + 0.06], tile: 1.2 });
  // timber slats over the facade (clear of the door), lit from the canopy
  for (let x = -f.lobbyHw + 0.6; x <= f.lobbyHw - 0.5; x += 0.55) {
    if (Math.abs(x) < 3.2) continue;
    b.box("woodDark", 0.09, LH - 0.5, 0.22, { p: [x, (LH - 0.5) / 2, fz + t / 2 + 0.18], tile: 1 });
  }
  // red and blue light lines along the canopy edge
  b.box("led-fight", f.lobbyHw * 2 + 1.0, 0.05, 0.04, { p: [0, LH + 0.02, fz + 2.12] });
  b.box("led-corner-blue", f.lobbyHw * 2 + 1.0, 0.05, 0.04, { p: [0, LH + 0.5, fz + 2.12] });
  // door surround
  const hw = DOOR.w / 2;
  for (const s of [-1, 1]) b.box("steel", 0.18, DOOR.h + 0.18, 0.4, { p: [s * (hw + 0.09), (DOOR.h + 0.18) / 2, FIGHT_DOOR_INSET + 0.1] });
  b.box("steel", DOOR.w + 0.36, 0.18, 0.4, { p: [0, DOOR.h + 0.09, FIGHT_DOOR_INSET + 0.1] });
  b.box("led-fight", DOOR.w + 0.44, 0.03, 0.03, { p: [0, DOOR.h + 0.22, FIGHT_DOOR_INSET + 0.32] });
  b.box("basalt", DOOR.w + 1.4, 0.04, 1.8, { p: [0, 0.02, FIGHT_DOOR_INSET + 0.9], tile: 1.2 });

  /* ---- the ring-and-glove sign on the hall front, above the lobby roof ---- */
  const sy = LH + 3.2;
  const sz = f.front + 0.35;
  b.box("screenFrame", 9.6, 4.2, 0.2, { p: [0, sy, sz - 0.1] });
  // the ring: apron, three ropes between four posts (red / blue / white corners)
  b.box("white", 5.6, 0.5, 0.08, { p: [0, sy - 1.45, sz] });
  for (const [i, x] of [-2.6, 2.6].entries()) b.box(i === 0 ? "led-fight" : "led-corner-blue", 0.16, 2.2, 0.1, { p: [x, sy - 0.25, sz + 0.02] });
  for (const y of [-0.7, -0.15, 0.4]) b.box("white", 5.2, 0.05, 0.06, { p: [0, sy + y, sz + 0.04] });
  // the glove (rounded fist from stacked blocks) over the ropes
  b.box("led-fight", 1.5, 1.3, 0.14, { p: [0.3, sy + 1.05, sz + 0.1] });
  b.box("led-fight", 1.2, 0.5, 0.14, { p: [0.15, sy + 1.85, sz + 0.1] });
  b.box("led-fight", 0.5, 0.8, 0.14, { p: [-0.65, sy + 0.95, sz + 0.12] });
  b.box("white", 1.3, 0.32, 0.15, { p: [0.4, sy + 0.25, sz + 0.11] });
  // the small LED board for the live count (its text is drawn by world/Plaza FightBoard)
  b.box("screenFrame", 3.4, 0.9, 0.12, { p: [-9.5, LH - 1.6, fz + t / 2 + 0.45] });
}

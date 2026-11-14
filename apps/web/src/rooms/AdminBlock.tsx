"use client";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { GeoBatch } from "@/world/geo";
import { Avatar } from "@/world/Avatar";
import { DEFAULT_LOOK, SKIN_TONES, type AvatarLook } from "@/world/outfits";
import { isOnScreen, useArea } from "@/world/stage";
import type { HallLayout } from "./layouts";
import { GltfInstances, Instanced, model, usePbr, type Xform } from "./interior-kit";
import { imigongoPanel } from "./room-textures";
import { SouthWall, WindowWall } from "./shell";
import { doors, registerAdminHooks, updateDoors } from "@/admin-block/doors";
import { canEnter, occupantsOf, useOffices } from "@/admin-block/office-client";
import {
  ADMIN_WALLS,
  BENCHES,
  DIRECTORY,
  DOOR_H,
  DOOR_W,
  FRONT_Z,
  LOBBY_PLANTERS,
  LOUNGE,
  MEETING_CHAIR_R,
  MEETING_R,
  OFFICE_PLANS,
  officeFurniture,
  OPENING,
  RECEPTION,
  RECEPTIONIST,
  SCREEN_Z,
  SIDELIGHT,
  WALL_T,
  type OfficePlan,
} from "@/admin-block/plan";
import { compoundMapTexture, filesTexture, nameplateTexture, paintDirectory, rackTexture, screenTexture, signTexture, ticketBoardTexture, type ScreenKind } from "@/admin-block/textures";
import { doorStatus, S, STATUS_HEX, statusLabel } from "@/admin-block/strings";

/**
 * Administrative Block interior (P2-ADM-02): a calm civic office floor. Reception lobby (stone floor, reception
 * counter with a receptionist, live office directory, waiting lounge, an Imigongo triptych), a carpeted corridor
 * and four closed offices (Super Admin, IT Office, Accountant, Customer Support), each with a desk, chair,
 * monitors, shelving, a meeting corner, a themed wall and the north window onto the Virungas.
 *
 * Eye comfort as in the game halls: every surface is matte (roughness ≥ 0.8, metalness 0, envMapIntensity ≤ 0.2),
 * the light is one soft overhead key + sky fill + recessed linear ceiling lights whose emissive stays below the
 * bloom threshold; screens are dim (≤ 0.6). Static architecture and furniture are merged per material (GeoBatch:
 * ~16 draw calls for the whole floor); repeated props are instanced; the doors are the only animated meshes.
 */

type Key =
  | "plaster"
  | "plasterWarm"
  | "accentWall"
  | "oak"
  | "oakDark"
  | "laminate"
  | "metal"
  | "metalLight"
  | "fabric"
  | "fabricWarm"
  | "stoneTop"
  | "trim"
  | "frosted"
  | "light"
  | "rug"
  | "screenFrame"
  | "accent"
  | "white";

const SHADOW_KEYS = new Set<Key>(["oak", "oakDark", "laminate", "metal", "metalLight", "fabric", "fabricWarm", "stoneTop"]);

const westFace = (o: OfficePlan) => o.x0 + (o.x0 <= -18 ? 0 : WALL_T / 2);

interface ScreenSpot {
  kind: ScreenKind;
  x: Xform;
}

/** Everything static, authored as primitives and merged per material. */
function buildStatic(h: number) {
  const b = new GeoBatch();
  const books: Xform[] = [];
  const screens: ScreenSpot[] = [];
  const monitor = (x: number, z: number, y: number, yaw: number, kind: ScreenKind, w = 0.56, hh = 0.33) => {
    // bezel, neck and foot (screen face is a separate textured plane, facing along yaw)
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    b.box("screenFrame", w + 0.03, hh + 0.03, 0.025, { p: [x, y + 0.14 + hh / 2, z], r: [0, yaw, 0] });
    b.box("metal", 0.04, 0.16, 0.03, { p: [x - fx * 0.04, y + 0.08, z - fz * 0.04], r: [0, yaw, 0] });
    b.box("metal", 0.2, 0.012, 0.16, { p: [x - fx * 0.05, y + 0.006, z - fz * 0.05], r: [0, yaw, 0] });
    screens.push({ kind, x: { p: [x + fx * 0.0135, y + 0.14 + hh / 2, z + fz * 0.0135], r: yaw, s: [w, hh, 1] } });
  };
  const taskChair = (x: number, z: number, yaw: number) => {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    b.box("fabric", 0.5, 0.08, 0.48, { p: [x, 0.47, z], r: [0, yaw, 0] });
    b.box("fabric", 0.46, 0.58, 0.07, { p: [x - fx * 0.24, 0.86, z - fz * 0.24], r: [0, yaw, 0] });
    b.cyl("metal", 0.03, 0.03, 0.4, 8, { p: [x, 0.24, z] });
    b.cyl("metal", 0.3, 0.3, 0.035, 12, { p: [x, 0.03, z] });
  };
  const visitorChair = (x: number, z: number, yaw: number) => {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    b.box("fabricWarm", 0.5, 0.07, 0.48, { p: [x, 0.46, z], r: [0, yaw, 0] });
    b.box("fabricWarm", 0.48, 0.42, 0.05, { p: [x - fx * 0.235, 0.74, z - fz * 0.235], r: [0, yaw, 0] });
    for (const [lx, lz] of [
      [-0.21, -0.19],
      [0.21, -0.19],
      [-0.21, 0.19],
      [0.21, 0.19],
    ] as const) {
      // rotate the leg offsets with the chair
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      b.box("metal", 0.025, 0.43, 0.025, { p: [x + lx * c + lz * s, 0.215, z - lx * s + lz * c] });
    }
  };

  /* ---------- architecture ---------- */
  for (const r of ADMIN_WALLS) b.box("plaster", r.w, h, r.d, { p: [r.x, h / 2, r.z], tile: 2 });
  for (const o of OFFICE_PLANS) {
    // door header, frame (jambs + head), frosted side light with its frame
    b.box("plaster", DOOR_W, h - DOOR_H - 0.06, WALL_T, { p: [o.cx, DOOR_H + 0.06 + (h - DOOR_H - 0.06) / 2, FRONT_Z], tile: 2 });
    for (const s of [-1, 1]) b.box("trim", 0.06, DOOR_H + 0.06, WALL_T + 0.05, { p: [o.cx + s * (DOOR_W / 2 - 0.03), (DOOR_H + 0.06) / 2, FRONT_Z] });
    b.box("trim", DOOR_W, 0.06, WALL_T + 0.05, { p: [o.cx, DOOR_H + 0.03, FRONT_Z] });
    const sx = o.cx + (SIDELIGHT.x0 + SIDELIGHT.x1) / 2;
    const sw = SIDELIGHT.x1 - SIDELIGHT.x0;
    b.box("frosted", sw, DOOR_H - 0.12, WALL_T + 0.02, { p: [sx, 0.08 + (DOOR_H - 0.12) / 2, FRONT_Z] });
    for (const s of [-1, 1]) b.box("trim", 0.04, DOOR_H, WALL_T + 0.05, { p: [sx + s * (sw / 2 + 0.02), DOOR_H / 2 + 0.03, FRONT_Z] });
    b.box("trim", sw + 0.08, 0.04, WALL_T + 0.05, { p: [sx, DOOR_H + 0.03, FRONT_Z] });
    b.box("trim", sw + 0.08, 0.04, WALL_T + 0.05, { p: [sx, 0.06, FRONT_Z] });
    // nameplate backing + status lamp housing (corridor side)
    b.box("metal", 0.46, 0.2, 0.012, { p: [o.cx + 1.66, 1.52, FRONT_Z + WALL_T / 2 + 0.006] });
    b.box("metal", 0.1, 0.1, 0.02, { p: [o.cx + 1.66, 1.82, FRONT_Z + WALL_T / 2 + 0.01] });
  }
  // bulkhead over the lobby opening (carries the OFFICES sign)
  b.box("plaster", OPENING.x1 - OPENING.x0, 0.7, WALL_T, { p: [0, h - 0.35, SCREEN_Z], tile: 2 });
  b.box("trim", OPENING.x1 - OPENING.x0, 0.04, WALL_T + 0.04, { p: [0, h - 0.7, SCREEN_Z] });
  // skirting: shadow-gap base along the outer and corridor walls
  for (const z of [FRONT_Z + WALL_T / 2 + 0.01, SCREEN_Z - WALL_T / 2 - 0.01, SCREEN_Z + WALL_T / 2 + 0.01]) b.box("trim", 36, 0.08, 0.02, { p: [0, 0.04, z] });
  for (const s of [-1, 1]) b.box("trim", 0.02, 0.08, 28, { p: [s * 17.99, 0.04, 0] });
  // recessed linear ceiling lights: lobby grid, corridor line, two per office
  for (const z of [5.2, 8.4, 11.6]) for (const s of [-1, 1]) b.box("light", 13, 0.02, 0.1, { p: [s * 9.5, h - 0.012, z] });
  b.box("light", 34, 0.02, 0.12, { p: [0, h - 0.012, (FRONT_Z + SCREEN_Z) / 2] });
  for (const o of OFFICE_PLANS) for (const z of [-4.6, -9.6]) b.box("light", 6.4, 0.02, 0.1, { p: [o.cx, h - 0.012, z] });

  /* ---------- lobby ---------- */
  const R = RECEPTION;
  b.box("oak", R.w, R.h - 0.06, 0.1, { p: [R.x, (R.h - 0.06) / 2, R.z + R.d / 2 - 0.05] });
  for (const s of [-1, 1]) b.box("oak", 0.08, R.h - 0.06, R.d, { p: [R.x + s * (R.w / 2 - 0.04), (R.h - 0.06) / 2, R.z] });
  b.box("stoneTop", R.w + 0.1, 0.05, R.d + 0.1, { p: [R.x, R.h - 0.025, R.z + 0.02] });
  b.box("laminate", R.w - 0.2, 0.04, 0.6, { p: [R.x, 0.74, R.z - 0.1] });
  b.box("accent", R.w, 0.025, 0.01, { p: [R.x, 0.86, R.z + R.d / 2 + 0.004] });
  b.box("trim", R.w, 0.08, 0.06, { p: [R.x, 0.04, R.z + R.d / 2 - 0.08] });
  // counter return (west end) with a low cabinet
  b.box("oak", 0.6, 0.75, 0.9, { p: [R.x - R.w / 2 + 0.3, 0.375, R.z - 0.85] });
  b.box("stoneTop", 0.64, 0.04, 0.94, { p: [R.x - R.w / 2 + 0.3, 0.77, R.z - 0.85] });
  taskChair(RECEPTIONIST.x, RECEPTIONIST.z - 0.12, 0);
  monitor(R.x + 0.8, R.z - 0.05, 0.76, Math.PI, "reception");
  // waiting benches along the screen wall
  for (const be of BENCHES) {
    b.box("fabric", be.w, 0.12, be.d - 0.1, { p: [be.x, 0.42, be.z + 0.05] });
    b.box("fabric", be.w, 0.42, 0.1, { p: [be.x, 0.7, be.z - be.d / 2 + 0.05] });
    b.box("metal", be.w - 0.1, 0.36, be.d - 0.2, { p: [be.x, 0.18, be.z + 0.05] });
  }
  // lounge: coffee table + rug (sofa / armchairs are glTF props)
  const T = LOUNGE.table;
  b.box("oak", T.w, 0.04, T.d, { p: [T.x, 0.42, T.z] });
  b.box("metal", T.w - 0.16, 0.4, T.d - 0.2, { p: [T.x, 0.2, T.z] });
  b.box("rug", 4.4, 0.008, 5.2, { p: [15.4, 0.004, T.z] });
  // directory board frame, Imigongo triptych frames (behind reception), east-wall pair (lounge)
  b.box("metal", DIRECTORY.w + 0.12, DIRECTORY.h + 0.12, 0.05, { p: [DIRECTORY.x, DIRECTORY.y, SCREEN_Z + WALL_T / 2 + 0.025] });
  for (const dx of [-1.3, 0, 1.3]) b.box("oakDark", 1.08, 2.08, 0.04, { p: [R.x + dx, 2.05, SCREEN_Z + WALL_T / 2 + 0.02] });
  for (const dz of [-0.75, 0.75]) b.box("oakDark", 0.04, 1.78, 1.18, { p: [17.98, 2.15, LOUNGE.sofa.z + dz] });
  // the reception's feature wall: a warm accent band behind the triptych
  b.box("accentWall", 5.4, h, 0.02, { p: [R.x, h / 2, SCREEN_Z + WALL_T / 2 + 0.01] });

  /* ---------- offices ---------- */
  for (const o of OFFICE_PLANS) {
    const f = officeFurniture(o);
    for (const d of f.desks) {
      b.box(o.theme === "executive" ? "oakDark" : "laminate", d.w, 0.04, d.d, { p: [d.x, d.h - 0.02, d.z] });
      b.box("oak", d.w - 0.12, 0.48, 0.03, { p: [d.x, d.h - 0.3, d.z + d.d / 2 - 0.06] });
      for (const s of [-1, 1]) b.box(o.theme === "executive" ? "oakDark" : "metal", 0.05, d.h - 0.04, d.d - 0.08, { p: [d.x + s * (d.w / 2 - 0.06), (d.h - 0.04) / 2, d.z] });
    }
    for (const c of f.chairs) taskChair(c.x, c.z, 0);
    for (const c of f.visitors) visitorChair(c.x, c.z, Math.PI);
    // monitors per theme (screens face the person at the desk: north, yaw π)
    const dk = f.desks[0]!;
    const top = dk.h;
    if (o.theme === "executive") monitor(dk.x + 0.55, dk.z + 0.1, top, Math.PI, "exec", 0.62, 0.36);
    if (o.theme === "it") {
      monitor(dk.x - 0.6, dk.z + 0.12, top, Math.PI - 0.38, "it", 0.54, 0.32);
      monitor(dk.x, dk.z + 0.2, top, Math.PI, "it-code", 0.54, 0.32);
      monitor(dk.x + 0.6, dk.z + 0.12, top, Math.PI + 0.38, "it", 0.54, 0.32);
    }
    if (o.theme === "finance") {
      monitor(dk.x - 0.33, dk.z + 0.15, top, Math.PI - 0.15, "finance");
      monitor(dk.x + 0.33, dk.z + 0.15, top, Math.PI + 0.15, "finance-table");
    }
    if (o.theme === "support")
      for (const d of f.desks) {
        monitor(d.x, d.z + 0.12, d.h, Math.PI, "support", 0.52, 0.31);
        // headset on its stand
        b.cyl("metal", 0.03, 0.04, 0.24, 8, { p: [d.x + 0.55, d.h + 0.12, d.z - 0.05] });
        b.add("fabric", new THREE.TorusGeometry(0.085, 0.012, 6, 16, Math.PI), { p: [d.x + 0.55, d.h + 0.25, d.z - 0.05] });
        for (const s of [-1, 1]) b.cyl("fabric", 0.035, 0.035, 0.03, 12, { p: [d.x + 0.55 + s * 0.085, d.h + 0.24, d.z - 0.05], r: [0, 0, Math.PI / 2] });
      }
    // keyboards
    for (const d of f.desks) b.box("screenFrame", 0.42, 0.015, 0.14, { p: [d.x, d.h + 0.008, d.z - 0.22] });
    // units on the side walls
    for (const u of f.units) {
      if (u.kind === "shelf") {
        for (const zz of [u.z - u.d / 2 + 0.015, u.z + u.d / 2 - 0.015, u.z]) b.box("oak", u.w, u.h, 0.03, { p: [u.x, u.h / 2, zz] });
        for (const y of [0.04, 0.5, 0.96, 1.42, 1.88, u.h - 0.015]) b.box("oak", u.w, 0.03, u.d, { p: [u.x, y, u.z] });
        // binders and books (instanced, coloured)
        for (const [si, y] of [0.055, 0.515, 0.975, 1.435].entries())
          for (let k = 0; k < 18; k++) {
            if ((k * 7 + si * 3 + o.cx) % 5 === 0) continue;
            const half = k < 9 ? -1 : 1;
            const z0 = u.z + (half < 0 ? -u.d / 2 + 0.12 : 0.1);
            const zz = z0 + (k % 9) * 0.25;
            const bh = 0.26 + ((k * 13 + si * 5) % 4) * 0.03;
            books.push({ p: [u.x, y + bh / 2, zz], s: [u.w - 0.12, bh, 0.06 + ((k + si) % 3) * 0.02] });
          }
      } else if (u.kind === "rack") {
        for (let k = 0; k < 3; k++) b.box("metal", u.w, u.h, u.d / 3 - 0.02, { p: [u.x, u.h / 2, u.z - u.d / 3 + k * (u.d / 3)] });
      } else if (u.kind === "files") {
        for (let k = 0; k < 4; k++) b.box("metalLight", u.w, u.h, u.d / 4 - 0.02, { p: [u.x, u.h / 2, u.z - (u.d * 3) / 8 + k * (u.d / 4)] });
        b.box("stoneTop", u.w + 0.04, 0.03, u.d + 0.04, { p: [u.x, u.h + 0.015, u.z] });
      } else {
        b.box("oak", u.w, u.h, u.d, { p: [u.x, u.h / 2, u.z] });
        b.box("stoneTop", u.w + 0.03, 0.03, u.d + 0.03, { p: [u.x, u.h + 0.015, u.z] });
      }
    }
    // meeting corner: round table, four chairs, rug, the team screen on the front wall
    const m = f.meeting;
    b.cyl("oak", MEETING_R, MEETING_R, 0.04, 32, { p: [m.x, 0.74, m.z] });
    b.cyl("metal", 0.05, 0.05, 0.7, 8, { p: [m.x, 0.37, m.z] });
    b.cyl("metal", 0.3, 0.3, 0.03, 16, { p: [m.x, 0.015, m.z] });
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const cx = m.x + Math.sin(a) * MEETING_CHAIR_R;
      const cz = m.z + Math.cos(a) * MEETING_CHAIR_R;
      visitorChair(cx, cz, a + Math.PI);
    }
    b.box("rug", 3.0, 0.008, 3.0, { p: [m.x, 0.004, m.z] });
    b.box("screenFrame", 1.5, 0.88, 0.04, { p: [m.x, 1.62, FRONT_Z - WALL_T / 2 - 0.02] });
    screens.push({ kind: o.theme === "finance" ? "finance" : o.theme === "it" ? "it" : o.theme === "support" ? "support" : "meeting", x: { p: [m.x, 1.62, FRONT_Z - WALL_T / 2 - 0.042], r: Math.PI, s: [1.42, 0.8, 1] } });
    // executive: a rug under the desk group; the compound map frame on the west wall
    if (o.theme === "executive") {
      b.box("rug", 4.2, 0.008, 3.8, { p: [o.cx, 0.004, -10.1] });
      b.box("metal", 4.36, 2.5, 0.04, { p: [westFace(o) + 0.02, 2.05, -9.6], r: [0, Math.PI / 2, 0] });
    }
    if (o.theme === "support") b.box("metal", 0.04, 1.92, 3.72, { p: [westFace(o) + 0.02, 1.95, -9.6] });
    if (o.theme === "finance") b.box("screenFrame", 0.04, 1.0, 1.7, { p: [westFace(o) + 0.02, 2.15, -10.2] });
  }
  return { geos: b.build(), books, screens };
}

function useAdminMaterials(lite: boolean) {
  const plaster = usePbr("white_plaster_02", [1, 1]);
  const oak = usePbr("oak_veneer_01", [1, 1]);
  const velour = usePbr("velour_velvet", [2, 2], { map: false });
  return useMemo(() => {
    const n = new THREE.Vector2(0.25, 0.25);
    const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, envMapIntensity: 0.12, ...p });
    const m: Record<Key, THREE.Material> = {
      plaster: std({ normalMap: plaster.normalMap, normalScale: n, color: "#e6e2da", roughness: 0.95 }),
      plasterWarm: std({ color: "#d8d0c3", roughness: 0.95 }),
      accentWall: std({ color: "#3a3d42", roughness: 0.95 }),
      oak: std({ map: oak.map, normalMap: oak.normalMap, color: "#e2c29c", roughness: 0.85 }),
      oakDark: std({ map: oak.map, color: "#9c7a5c", roughness: 0.86 }),
      laminate: std({ color: "#e7e3dc", roughness: 0.88 }),
      metal: std({ color: "#2c2e33", roughness: 0.85 }),
      metalLight: std({ map: filesTexture(), color: "#ffffff", roughness: 0.86 }),
      fabric: std({ normalMap: velour.normalMap, normalScale: n, color: "#4b5563", roughness: 1, envMapIntensity: 0.06 }),
      fabricWarm: std({ normalMap: velour.normalMap, normalScale: n, color: "#7c6a5a", roughness: 1, envMapIntensity: 0.06 }),
      stoneTop: std({ color: "#d9d3c7", roughness: 0.86 }),
      trim: std({ color: "#2a2b2e", roughness: 0.9 }),
      frosted: std({ color: "#c9ced2", emissive: "#e8ecee", emissiveIntensity: lite ? 0.12 : 0.06, roughness: 1 }),
      light: std({ color: "#000000", emissive: "#fff4e6", emissiveIntensity: 0.72, roughness: 1 }),
      rug: std({ color: "#5d5650", roughness: 1, envMapIntensity: 0.05 }),
      screenFrame: std({ color: "#17181b", roughness: 0.9 }),
      accent: std({ color: "#c9a96b", roughness: 0.85 }),
      white: std({ color: "#ecebe7", roughness: 0.9 }),
    };
    return m;
  }, [plaster, oak, velour, lite]);
}

/* ---------------- doors (the only animated architecture) ---------------- */

const ease = (t: number) => t * t * (3 - 2 * t);

function OfficeDoors({ lite }: { lite: boolean }) {
  const oak = usePbr("oak_veneer_01", [1, 2]);
  const leaf = useRef<(THREE.Group | null)[]>([]);
  const mats = useMemo(
    () => ({
      leaf: new THREE.MeshStandardMaterial({ map: oak.map, normalMap: oak.normalMap, color: "#e6c49c", roughness: 0.84, metalness: 0, envMapIntensity: 0.12 }),
      handle: new THREE.MeshStandardMaterial({ color: "#3a3c40", roughness: 0.8, metalness: 0, envMapIntensity: 0.15 }),
      kick: new THREE.MeshStandardMaterial({ color: "#2a2b2e", roughness: 0.9, metalness: 0 }),
    }),
    [oak],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const fx = useOffices((s) => s.knockFx);
  useFrame(() => {
    const now = performance.now();
    OFFICE_PLANS.forEach((o, i) => {
      const g = leaf.current[i];
      if (!g) return;
      let rattle = 0;
      if (fx && fx.office === o.id) {
        // three knocks: the closed leaf shivers in its frame with each rap
        const t = (now - fx.at) / 1000;
        if (t < 0.7) for (const k of [0, 0.21, 0.42]) if (t > k && t < k + 0.09) rattle = Math.sin(((t - k) / 0.09) * Math.PI) * 0.006;
      }
      g.rotation.y = ease(doors[o.id]!.open) * 1.5 + rattle;
    });
  });
  const L = DOOR_W - 0.12;
  return (
    <group>
      {OFFICE_PLANS.map((o, i) => (
        // hinged on the west jamb, swinging into the office (−z)
        <group key={o.id} ref={(g) => void (leaf.current[i] = g)} position={[o.cx - DOOR_W / 2 + 0.06, 0, FRONT_Z]}>
          <mesh material={mats.leaf} position={[L / 2, DOOR_H / 2 + 0.005, 0]} castShadow={!lite} receiveShadow>
            <boxGeometry args={[L - 0.01, DOOR_H - 0.01, 0.045]} />
          </mesh>
          <mesh material={mats.kick} position={[L / 2, 0.12, 0]}>
            <boxGeometry args={[L - 0.06, 0.18, 0.05]} />
          </mesh>
          {/* lever handles on both faces, with their roses */}
          {[-1, 1].map((s) => (
            <group key={s} position={[L - 0.09, 1.02, s * 0.04]}>
              <mesh material={mats.handle} position={[-0.06, 0, s * 0.02]}>
                <boxGeometry args={[0.14, 0.022, 0.022]} />
              </mesh>
              <mesh material={mats.handle} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.028, 0.028, 0.012, 16]} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

/** Nameplates and status lamps beside each door (vacant grey / staff inside green / in a meeting amber). */
function DoorSigns() {
  const st = useOffices();
  const lamps = useMemo(() => OFFICE_PLANS.map(() => new THREE.MeshStandardMaterial({ color: "#000000", emissive: STATUS_HEX.vacant, emissiveIntensity: 0.55, roughness: 1 })), []);
  const plates = useMemo(
    () => OFFICE_PLANS.map((o) => new THREE.MeshStandardMaterial({ map: nameplateTexture(o.name, o.plate, o.accent), roughness: 0.9, metalness: 0, envMapIntensity: 0.1 })),
    [],
  );
  useEffect(() => () => [...lamps, ...plates].forEach((m) => m.dispose()), [lamps, plates]);
  useEffect(() => {
    OFFICE_PLANS.forEach((o, i) => lamps[i]!.emissive.set(STATUS_HEX[doorStatus(occupantsOf(o.id, st))]));
  }, [st, lamps]);
  return (
    <group>
      {OFFICE_PLANS.map((o, i) => (
        <group key={o.id}>
          <mesh material={plates[i]} position={[o.cx + 1.66, 1.52, FRONT_Z + WALL_T / 2 + 0.0135]}>
            <planeGeometry args={[0.44, 0.165]} />
          </mesh>
          <mesh material={lamps[i]} position={[o.cx + 1.66, 1.82, FRONT_Z + WALL_T / 2 + 0.021]}>
            <circleGeometry args={[0.032, 20]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** The reception directory board: live office status (re-painted when it changes). */
function DirectoryBoard() {
  const st = useOffices();
  const texRef = useRef<THREE.CanvasTexture | null>(null);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#000000", roughness: 1, metalness: 0, emissive: "#ffffff", emissiveIntensity: 0.55 }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => {
    const rows = st.offices.map((o) => {
      const n = occupantsOf(o.id, st);
      return { name: o.name, status: statusLabel(n), dot: STATUS_HEX[doorStatus(n)], note: canEnter(o.id) ? S.youCanEnter : null };
    });
    texRef.current = paintDirectory(texRef.current, rows, S.directoryBoard, st.source === "api" ? S.visitorsKnock : S.offline);
    if (mat.emissiveMap !== texRef.current) {
      mat.map = texRef.current;
      mat.emissiveMap = texRef.current;
      mat.needsUpdate = true;
    }
  }, [st, mat]);
  return (
    <mesh material={mat} position={[DIRECTORY.x, DIRECTORY.y, SCREEN_Z + WALL_T / 2 + 0.052]}>
      <planeGeometry args={[DIRECTORY.w, DIRECTORY.w * (600 / 1024)]} />
    </mesh>
  );
}

/** Lettered signs, art, the screens' faces, the rack fronts, the wall map and the ticket board. */
function Graphics({ screens, h }: { screens: ScreenSpot[]; h: number }) {
  const plane = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const panels = useMemo(() => [imigongoPanel(0), imigongoPanel(1)], []);
  const byKind = useMemo(() => {
    const out = new Map<ScreenKind, Xform[]>();
    for (const s of screens) out.set(s.kind, [...(out.get(s.kind) ?? []), s.x]);
    return [...out.entries()];
  }, [screens]);
  const signs = useMemo(
    () => ({
      offices: signTexture(S.officesSign, { arrows: true, size: 84, w: 1024, h: 160 }),
      reception: signTexture(S.reception, { size: 92, w: 1024, h: 180, bg: "#3a3d42" }),
      exit: signTexture(S.exitSign, { size: 84, w: 1024, h: 160 }),
    }),
    [],
  );
  const face = (map: THREE.Texture, glow = 0) =>
    glow ? <meshStandardMaterial map={map} emissive="#ffffff" emissiveMap={map} emissiveIntensity={glow} roughness={1} metalness={0} /> : <meshStandardMaterial map={map} roughness={0.92} metalness={0} envMapIntensity={0.1} />;
  const exec = OFFICE_PLANS.find((o) => o.theme === "executive")!;
  const it = OFFICE_PLANS.find((o) => o.theme === "it")!;
  const fin = OFFICE_PLANS.find((o) => o.theme === "finance")!;
  const sup = OFFICE_PLANS.find((o) => o.theme === "support")!;
  const rack = officeFurniture(it).units.find((u) => u.kind === "rack")!;
  const files = officeFurniture(fin).units.find((u) => u.kind === "files")!;
  return (
    <group>
      {byKind.map(([kind, items]) => (
        <Instanced key={kind} geometry={plane} items={items} receiveShadow={false}>
          <meshStandardMaterial color="#000000" emissive="#ffffff" emissiveMap={screenTexture(kind)} emissiveIntensity={0.55} roughness={1} metalness={0} />
        </Instanced>
      ))}
      {/* OFFICES over the lobby opening (both faces), RECEPTION over the counter, the block's name over the door */}
      <mesh geometry={plane} position={[0, h - 0.35, SCREEN_Z + WALL_T / 2 + 0.004]} scale={[3.4, 0.53, 1]}>
        {face(signs.offices)}
      </mesh>
      <mesh geometry={plane} position={[0, h - 0.35, SCREEN_Z - WALL_T / 2 - 0.004]} rotation={[0, Math.PI, 0]} scale={[3.4, 0.53, 1]}>
        {face(signs.exit)}
      </mesh>
      <mesh geometry={plane} position={[RECEPTION.x, 3.35, SCREEN_Z + WALL_T / 2 + 0.024]} scale={[2.6, 0.46, 1]}>
        {face(signs.reception)}
      </mesh>
      {/* Imigongo triptych behind reception, a pair over the lounge sofa */}
      {[-1.3, 0, 1.3].map((dx, i) => (
        <mesh key={dx} geometry={plane} position={[RECEPTION.x + dx, 2.05, SCREEN_Z + WALL_T / 2 + 0.042]} scale={[1.0, 2.0, 1]}>
          {face(panels[i % 2]!)}
        </mesh>
      ))}
      {[-0.75, 0.75].map((dz, i) => (
        <mesh key={dz} geometry={plane} position={[17.955, 2.15, LOUNGE.sofa.z + dz]} rotation={[0, -Math.PI / 2, 0]} scale={[1.1, 1.7, 1]}>
          {face(panels[(i + 1) % 2]!)}
        </mesh>
      ))}
      {/* Super Admin: the compound overview map; Support: ticket board; Accountant: finance wall screen; IT: rack fronts */}
      <mesh geometry={plane} position={[westFace(exec) + 0.045, 2.05, -9.6]} rotation={[0, Math.PI / 2, 0]} scale={[4.2, 2.36, 1]}>
        {face(compoundMapTexture(), 0.18)}
      </mesh>
      <mesh geometry={plane} position={[westFace(sup) + 0.045, 1.95, -9.6]} rotation={[0, Math.PI / 2, 0]} scale={[3.6, 1.8, 1]}>
        {face(ticketBoardTexture())}
      </mesh>
      <mesh geometry={plane} position={[westFace(fin) + 0.045, 2.15, -10.2]} rotation={[0, Math.PI / 2, 0]} scale={[1.62, 0.92, 1]}>
        <meshStandardMaterial color="#000000" emissive="#ffffff" emissiveMap={screenTexture("finance")} emissiveIntensity={0.5} roughness={1} />
      </mesh>
      {[0, 1, 2].map((k) => (
        <mesh key={k} geometry={plane} position={[rack.x + rack.w / 2 + 0.003, rack.h / 2, rack.z - rack.d / 3 + k * (rack.d / 3)]} rotation={[0, Math.PI / 2, 0]} scale={[rack.d / 3 - 0.04, rack.h - 0.06, 1]}>
          <meshStandardMaterial map={rackTexture()} emissive="#ffffff" emissiveMap={rackTexture()} emissiveIntensity={0.35} roughness={0.95} metalness={0} />
        </mesh>
      ))}
      {[0, 1, 2, 3].map((k) => (
        <mesh key={k} geometry={plane} position={[files.x + files.w / 2 + 0.003, files.h / 2, files.z - (files.d * 3) / 8 + k * (files.d / 4)]} rotation={[0, Math.PI / 2, 0]} scale={[files.d / 4 - 0.04, files.h - 0.02, 1]}>
          {face(filesTexture())}
        </mesh>
      ))}
    </group>
  );
}

const RECEPTIONIST_LOOK: AvatarLook = {
  ...DEFAULT_LOOK,
  bodyType: "feminine",
  skinTone: SKIN_TONES[2]!,
  hairColor: "#141010",
  outfit: { top: "blazer-cream", bottom: "skirt", shoes: "loafers", accessory: "earrings", headwear: "no-hat" },
  accent: "#C9A96B",
};

function Receptionist({ lite }: { lite: boolean }) {
  const anim = useRef(13); // seated
  return (
    <group position={[RECEPTIONIST.x, 0, RECEPTIONIST.z - 0.12]}>
      <Avatar look={RECEPTIONIST_LOOK} animRef={anim} showTag={false} shadows={!lite} quality={lite ? "lite" : "standard"} keepClothes />
    </group>
  );
}

export function AdminBlock({ layout, lite }: { layout: HallLayout; lite: boolean }) {
  const { w, d, h } = layout.size;
  const area = useArea();
  useEffect(() => registerAdminHooks(), []);
  useFrame((_, dt) => {
    if (isOnScreen(area)) updateDoors(Math.min(dt, 0.05));
  });
  const mats = useAdminMaterials(lite);
  const built = useMemo(() => buildStatic(h), [h]);
  useEffect(() => () => built.geos.forEach((g) => g.dispose()), [built]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const plaster = usePbr("white_plaster_02", [w / 4, d / 4]);
  const velour = usePbr("velour_velvet", [w / 1.5, 6], { map: false });
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const bookColors = useMemo(() => ["#3d4a5c", "#6b5a45", "#8a8f96", "#2f3a33", "#7a4b3a", "#c9c3b6", "#45505e"], []);
  const small = useMemo(() => new THREE.Vector2(0.2, 0.2), []);
  const lobbyD = d / 2 - SCREEN_Z;
  const corrD = SCREEN_Z - FRONT_Z;
  const officeD = FRONT_Z + d / 2;
  const plants = useMemo<Xform[]>(
    () => [...LOBBY_PLANTERS.map(([x, z], i) => ({ p: [x, 0, z] as [number, number, number], s: 1.45, r: i * 1.3 })), ...OFFICE_PLANS.map((o, i) => ({ p: [officeFurniture(o).plant.x, 0, officeFurniture(o).plant.z] as [number, number, number], s: 1.3, r: i * 2.1 }))],
    [],
  );
  const wallMat = <meshStandardMaterial normalMap={plaster.normalMap} normalScale={small} color="#e6e2da" roughness={0.95} metalness={0} envMapIntensity={0.1} />;
  return (
    <group>
      {/* -------- lighting: soft overhead key, sky fill through the north glazing, no hot-spots -------- */}
      <Environment resolution={32} frames={1} environmentIntensity={0.65}>
        <Lightformer intensity={1.1} position={[0, 3.6, 0]} rotation-x={Math.PI / 2} scale={[30, 22, 1]} color="#fff4e8" />
        <Lightformer intensity={1.3} position={[0, 2, -13.5]} scale={[34, 3, 1]} color="#e3ecf4" />
        <Lightformer intensity={0.5} position={[0, 1, 0]} rotation-x={-Math.PI / 2} scale={[30, 22, 1]} color="#8a857c" />
      </Environment>
      <hemisphereLight args={["#fff8ee", "#6e6a63", lite ? 1.55 : 1.3]} />
      <directionalLight
        position={[2, 20, 4]}
        intensity={lite ? 1.25 : 1.35}
        color="#fff2e0"
        castShadow={!lite}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-19}
        shadow-camera-right={19}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
        shadow-camera-near={8}
        shadow-camera-far={30}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-radius={4}
      />
      <directionalLight position={[0, 7, -30]} intensity={0.45} color="#e6eef6" />

      {/* -------- floors: honed stone lobby, carpet runner corridor, carpet offices; ceiling -------- */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, SCREEN_Z + lobbyD / 2]} receiveShadow>
        <planeGeometry args={[w, lobbyD]} />
        <meshStandardMaterial normalMap={plaster.normalMap} normalScale={small} color="#cfcac0" roughness={0.9} metalness={0} envMapIntensity={0.12} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, FRONT_Z + corrD / 2]} receiveShadow>
        <planeGeometry args={[w, corrD]} />
        <meshStandardMaterial normalMap={velour.normalMap} normalScale={small} color="#4d525a" roughness={1} metalness={0} envMapIntensity={0.05} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, FRONT_Z + corrD / 2]} receiveShadow>
        <planeGeometry args={[w - 1.2, 1.6]} />
        <meshStandardMaterial normalMap={velour.normalMap} normalScale={small} color="#5d5650" roughness={1} metalness={0} envMapIntensity={0.05} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -d / 2 + officeD / 2]} receiveShadow>
        <planeGeometry args={[w, officeD]} />
        <meshStandardMaterial normalMap={velour.normalMap} normalScale={small} color="#5b6068" roughness={1} metalness={0} envMapIntensity={0.05} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, h, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#e6e3dd" emissive="#f4f1ea" emissiveIntensity={0.42} roughness={1} metalness={0} envMapIntensity={0.1} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w / 2), h / 2, 0]} rotation={[0, -s * (Math.PI / 2), 0]} receiveShadow>
          <planeGeometry args={[d, h]} />
          {wallMat}
        </mesh>
      ))}
      <WindowWall w={w} d={d} h={h} sill={0.75} head={3.25} transom={2.55} bays={12} glassTint="#9fb2bd" glassOpacity={0.05} frameColor="#2a2b2e" matte>
        {wallMat}
      </WindowWall>
      <SouthWall layout={layout}>{wallMat}</SouthWall>

      {/* -------- merged static architecture + furniture -------- */}
      {[...built.geos.entries()].map(([k, g]) => (
        <mesh key={k} geometry={g} material={mats[k as Key]} castShadow={!lite && SHADOW_KEYS.has(k as Key)} receiveShadow />
      ))}
      <Instanced geometry={box} items={built.books} colors={bookColors}>
        <meshStandardMaterial roughness={0.9} metalness={0} envMapIntensity={0.1} />
      </Instanced>

      {/* -------- props -------- */}
      <GltfInstances url={model("potted_plant_02")} items={plants.filter((_, i) => i % 2 === 0)} />
      <GltfInstances url={model("potted_plant_04")} items={plants.filter((_, i) => i % 2 === 1).map((x) => ({ ...x, s: 2.4 }))} />
      <GltfInstances url={model("sofa_02")} items={[{ p: [LOUNGE.sofa.x, 0, LOUNGE.sofa.z], r: -Math.PI / 2, s: 1.1 }]} castShadow={!lite} />
      <GltfInstances url={model("modern_arm_chair_01")} items={LOUNGE.chairs.map((c) => ({ p: [c.x, 0, c.z], r: Math.PI / 2, s: 1.0 }) as Xform)} castShadow={!lite} />

      <OfficeDoors lite={lite} />
      <DoorSigns />
      <DirectoryBoard />
      <Graphics screens={built.screens} h={h} />
      <Suspense fallback={null}>
        <Receptionist lite={lite} />
      </Suspense>
    </group>
  );
}

"use client";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { DOOR, VESTIBULE_DEPTH, type PortalDef } from "./layout";
import type { Tier } from "./materials";
import { blobTexture, doorBadgeTexture, woodTexture } from "./textures";
import { glazingMaterial, paneGeometry } from "./glazing";
import { isGlazed } from "./glass-capture";

/**
 * The draught lobby behind each plaza hall door (P1-WLD-03, P2-WLD-20): a short, finished entrance lobby in the hall's
 * own palette — its floor with a coir entrance mat, walls washed by the warm ceiling downlights over a dark skirting,
 * the ceiling — closed at its far end by the inner doors: a pair of the same smoked glass as the facade and the street
 * doors (world/glazing.ts), in the hall's door frame, push bars, a lit sensor over them. Nothing of the hall is shown
 * through them (the depth-reprojected capture of P2-WLD-18 smeared): walking in, the hall takes over once the camera is
 * through the street door, as before (world/stage.ts enterHall).
 * The Tournament Arena's door opens into its glazed foyer: the lobby there IS the foyer, as wide and tall as the glass
 * box, closed by a timber back wall IN FRONT of the drum (its brick plinth and glass band stand 5.6 m behind the door
 * line and used to show through the street doors).
 * Local frame = the building's door frame (door centre at x = 0, plaza towards +z), `inset` = door line z.
 */
const DEPTH = VESTIBULE_DEPTH;
/** the arena foyer's back wall (door frame z): in front of the drum's brick plinth (z ≈ −5.6 on the door axis) */
export const ARENA_FOYER_BACK = -5.35;

interface Style {
  floor: string;
  floorTex?: "wood" | "herringbone" | "tile";
  wall: string;
  ceiling: string;
  lights: number;
}
const STYLES: Record<PortalDef["kind"], Style> = {
  pool: { floor: "#5a3f2c", floorTex: "wood", wall: "#5a4636", ceiling: "#2a2622", lights: 3 },
  ludo: { floor: "#b07a4a", floorTex: "herringbone", wall: "#d2b48c", ceiling: "#6e5238", lights: 3 },
  igisoro: { floor: "#9a5b3c", floorTex: "tile", wall: "#c9a77c", ceiling: "#6a4a2c", lights: 3 },
  // the arena's glazed foyer itself, in its chocolate palette: timber walls, a dark soffit
  arena: { floor: "#8a7f74", floorTex: "tile", wall: "#5a3e2c", ceiling: "#2a1f18", lights: 3 },
  admin: { floor: "#b9b4ab", floorTex: "tile", wall: "#d8d0bf", ceiling: "#cfc9bf", lights: 3 },
  fight: { floor: "#77736d", floorTex: "tile", wall: "#45444a", ceiling: "#1c1c1f", lights: 3 },
  soon: { floor: "#777", wall: "#777", ceiling: "#555", lights: 0 },
};

/**
 * Door frames, rails, push bars, the header track and the lobby's skirting, per hall: graphite on the modern halls,
 * dark bronze on the Administrative Block, chocolate at the Tournament Arena, dark timber at Igisoro Court. Shared by
 * the street doors (world/Plaza AutoDoors) and the inner doors here, so they batch together.
 */
export const DOOR_FRAME: Record<PortalDef["kind"], string> = {
  pool: "#1e1f23",
  ludo: "#1e1f23",
  igisoro: "#3a2a1c",
  arena: "#2e2019",
  admin: "#3f382f",
  fight: "#1e1f23",
  soon: "#1e1f23",
};
export const doorFrameMaterial = (kind: PortalDef["kind"]) => new THREE.MeshStandardMaterial({ color: DOOR_FRAME[kind], metalness: 0.55, roughness: 0.42 });

/** One tile of the floor pattern (128 px): tile or herringbone; null for timber boards (the shared wood texture). */
function floorTile(kind: Style["floorTex"]): CanvasImageSource | null {
  if (!kind || kind === "wood") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 128, 128);
  if (kind === "tile") {
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const v = 225 + ((x * 7 + y * 13) % 5) * 6;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
      }
  } else {
    // herringbone: 45° staggered planks
    g.save();
    g.translate(64, 64);
    g.rotate(Math.PI / 4);
    for (let i = -6; i < 6; i++)
      for (let j = -6; j < 6; j++) {
        const v = 205 + ((i * 5 + j * 11 + 40) % 7) * 7;
        g.fillStyle = `rgb(${v},${v - 6},${v - 14})`;
        if ((i + j) % 2 === 0) g.fillRect(i * 16, j * 16, 31, 15);
        else g.fillRect(i * 16, j * 16, 15, 31);
      }
    g.restore();
  }
  return c;
}

/**
 * The lobby floor baked into one texture over the whole floor (`w` × `len` m, the door at the bottom edge): the hall's
 * floor pattern in its colour and, just inside the door, the ribbed coir entrance mat with a dark border (one draw
 * call for both; `mat.from` / `mat.to`: metres in from the door).
 */
function lobbyFloor(style: Style, w: number, len: number, mat: { w: number; from: number; to: number }): THREE.CanvasTexture {
  const ppm = 80;
  const c = document.createElement("canvas");
  c.width = Math.round(w * ppm);
  c.height = Math.round(len * ppm);
  const g = c.getContext("2d")!;
  const tile = floorTile(style.floorTex);
  if (tile) {
    // the pattern twice across and twice along the lobby (as the old 2 × 2 repeat)
    const tw = c.width / 2;
    const th = c.height / 2;
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) g.drawImage(tile, x * tw, y * th, tw, th);
  } else {
    // timber boards running into the hall
    const wood = woodTexture().image as CanvasImageSource;
    const sz = 1.6 * ppm;
    for (let y = 0; y < c.height; y += sz) for (let x = 0; x < c.width; x += sz) g.drawImage(wood, x, y, sz, sz);
  }
  g.globalCompositeOperation = "multiply";
  g.fillStyle = style.floor;
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "source-over";
  const x0 = Math.round(((w - mat.w) / 2) * ppm);
  const y0 = Math.round(c.height - mat.to * ppm);
  const mw = Math.round(mat.w * ppm);
  const mh = Math.round((mat.to - mat.from) * ppm);
  g.fillStyle = "#1f1d1b";
  g.fillRect(x0, y0, mw, mh);
  g.fillStyle = "#2c2925";
  g.fillRect(x0 + 6, y0 + 6, mw - 12, mh - 12);
  for (let x = x0 + 10, i = 0; x < x0 + mw - 10; x += 4, i++) {
    g.fillStyle = i % 2 ? "#4a443d" : "#3b3631";
    g.fillRect(x, y0 + 10, 2, mh - 20);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * A box whose faces all sample one column of the wall wash (u fixed): an even wash across a narrow panel. `v`: a
 * number = that row everywhere; [centre y, wall height] = the row of each vertex's height on the wall (panels at
 * different heights read as one wall).
 */
function washedBox(w: number, h: number, d: number, u: number, v: number | [number, number]): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, typeof v === "number" ? v : THREE.MathUtils.clamp((v[0] + pos.getY(i)) / v[1], 0, 1));
  return g;
}

let washTex: THREE.CanvasTexture | null = null;
/** The light of one downlight on the wall beside it: a soft scallop from the ceiling down (repeated per downlight). */
function wallWash(): THREE.CanvasTexture {
  if (washTex) return washTex;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3a3a3a";
  g.fillRect(0, 0, 64, 256);
  g.save();
  g.scale(1, 3.2);
  const r = g.createRadialGradient(32, 4, 2, 32, 4, 70);
  r.addColorStop(0, "#ffffff");
  r.addColorStop(0.45, "#a8a8a8");
  r.addColorStop(1, "#3a3a3a");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 80);
  g.restore();
  washTex = new THREE.CanvasTexture(c);
  washTex.colorSpace = THREE.SRGBColorSpace;
  washTex.wrapS = THREE.RepeatWrapping;
  return washTex;
}

/**
 * One smoked-glass door leaf (origin: bottom centre, glass in the z = 0 plane): slim stiles and rails in the hall's
 * frame, a horizontal push bar on both faces. Used by the street doors (world/Plaza AutoDoors, they slide) and by the
 * vestibule's inner doors.
 */
export function DoorLeaf({ w, h, glass, frame }: { w: number; h: number; glass: THREE.Material; frame: THREE.Material }) {
  const pane = useMemo(() => paneGeometry("door", 0, w - 0.06, h - 0.1), [w, h]);
  useEffect(() => () => pane.dispose(), [pane]);
  return (
    <>
      <mesh geometry={pane} material={glass} position={[0, h / 2, 0]} />
      <LeafFrame w={w} h={h} frame={frame} />
    </>
  );
}

/** A door leaf's frame (stiles, rails, push bars on both faces) around its glass (origin: bottom centre). */
function LeafFrame({ w, h, frame }: { w: number; h: number; frame: THREE.Material }) {
  return (
    <>
      {[-1, 1].map((k) => (
        <mesh key={k} material={frame} position={[(k * (w - 0.05)) / 2, h / 2, 0]}>
          <boxGeometry args={[0.05, h, 0.05]} />
        </mesh>
      ))}
      <mesh material={frame} position={[0, h - 0.035, 0]}>
        <boxGeometry args={[w - 0.1, 0.07, 0.046]} />
      </mesh>
      <mesh material={frame} position={[0, 0.06, 0]}>
        <boxGeometry args={[w - 0.1, 0.12, 0.046]} />
      </mesh>
      {/* push bars on both faces, on short stand-offs */}
      {[-1, 1].map((f) => (
        <group key={`b${f}`}>
          <mesh material={frame} position={[0, 1.05, f * 0.065]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.016, 0.016, w * 0.62, 10]} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} material={frame} position={[s * w * 0.27, 1.05, f * 0.044]}>
              <boxGeometry args={[0.025, 0.025, 0.03]} />
            </mesh>
          ))}
        </group>
      ))}
    </>
  );
}

export function Vestibule({ def, inset, tier }: { def: PortalDef; inset: number; tier: Tier }) {
  const s = STYLES[def.kind];
  const lite = tier === "lite";
  const foyer = def.kind === "arena";
  const w = foyer ? 12.0 : DOOR.w + 0.3;
  const h = foyer ? 6.1 : DOOR.h + 0.25;
  const z0 = inset - 0.04;
  const zb = foyer ? ARENA_FOYER_BACK : z0 - DEPTH;
  const depth = z0 - zb;
  const mats = useMemo(() => {
    // the recess is shaded by the building: without real shadows (Lite) darken it by hand
    const k = lite ? 0.55 : 1;
    const col = (hex: string) => new THREE.Color(hex).multiplyScalar(k);
    const wash = wallWash().clone();
    wash.repeat.set(s.lights, 1);
    wash.needsUpdate = true;
    // the walls take the downlights' warm light: a scallop under each one (emissive, no real light needed)
    const lit = { roughness: 0.88, emissive: new THREE.Color("#e9c49c"), emissiveMap: wash, emissiveIntensity: lite ? 0.26 : 0.32 };
    return {
      floor: new THREE.MeshStandardMaterial({ color: col("#ffffff"), map: foyer ? null : lobbyFloor(s, w, depth + 0.12, { w: Math.min(w - 0.5, 3.4), from: 0.25, to: 1.85 }), roughness: 0.6, metalness: 0 }),
      // (wall and ceiling differ only in colour: the door's static batch folds them into one draw call)
      wall: new THREE.MeshStandardMaterial({ color: col(s.wall), ...lit }),
      // (the soffit faces down, away from the daylight: the downlights' bounce, evenly, keeps it from reading black)
      ceiling: new THREE.MeshStandardMaterial({ color: col(s.ceiling), ...lit }),
      frame: doorFrameMaterial(def.kind),
      light: new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffe3b8").multiplyScalar(0.85), toneMapped: false }),
      pool: new THREE.MeshBasicMaterial({
        map: blobTexture(),
        color: "#ffd9a0",
        transparent: true,
        opacity: lite ? 0.16 : 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    };
  }, [def.kind, s, lite, foyer, w, depth]);
  useEffect(
    () => () => {
      mats.floor.map?.dispose();
      mats.wall.emissiveMap?.dispose();
      Object.values(mats).forEach((m) => m.dispose());
    },
    [mats],
  );
  const glass = isGlazed(def.kind) ? glazingMaterial(def.kind, tier, "inner") : null;
  const zc = z0 - depth / 2;
  const cols = foyer ? [-3.6, 0, 3.6] : [0];
  const cast = !lite;
  // the floor surface: 30 mm, clear of the plaza's lava edge band (16 mm) under the inner-ring lobbies and the
  // Administrative Block's granite forecourt (22 mm); the foyer stands on the district's basalt slab (top at 4 cm)
  const fy = foyer ? 0.04 : 0.03;
  // the inner doors: a pair in the middle of the back wall
  const DW = foyer ? 2.8 : 2.6;
  const DH = 2.9;
  const side = (w - DW) / 2;
  const leaf = DW / 2 - 0.05;
  // the back wall's panels sample the wash at a scallop's centre (u = 0.5 / lights): lit evenly from the top
  const back = useMemo(() => {
    const u = 0.5 / Math.max(1, s.lights);
    return {
      side: washedBox(side + 0.02, h + 0.02, 0.1, u, [(h + 0.02) / 2, h]),
      over: washedBox(DW + 0.02, h + 0.02 - DH, 0.092, u, [(DH + h + 0.02) / 2, h]),
      // the soffit samples the wash's dim foot: an even glow
      ceiling: washedBox(w + 0.2, 0.1, depth + 0.12, u, 0.03),
    };
  }, [side, h, DW, s.lights, w, depth]);
  useEffect(() => () => Object.values(back).forEach((g) => g.dispose()), [back]);
  // the inner doors: one smoked pane across both closed leaves (one draw call), the leaves' stiles, rails and bars
  const pane = useMemo(() => paneGeometry("door", 0, DW - 0.18, DH - 0.2), [DW]);
  useEffect(() => () => pane.dispose(), [pane]);
  return (
    <group>
      {!foyer && (
        // (on under the back wall and the inner doors: no gap to the ground below at their foot)
        <mesh material={mats.floor} position={[0, fy, zc - 0.06]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={cast}>
          <planeGeometry args={[w, depth + 0.12]} />
        </mesh>
      )}
      {/* side walls (running 12 cm past the back wall's face, covering its ends) and their skirting (from 30 cm in: clear of the door surround) */}
      {[-1, 1].map((sd) => (
        <group key={sd}>
          <mesh material={mats.wall} position={[sd * (w / 2 + 0.05), h / 2, zc - 0.06]} castShadow={cast} receiveShadow={cast}>
            <boxGeometry args={[0.1, h, depth + 0.12]} />
          </mesh>
          <mesh material={mats.frame} position={[sd * (w / 2 - 0.012), 0.07, zc - 0.15]}>
            <boxGeometry args={[0.04, 0.12, depth - 0.32]} />
          </mesh>
        </group>
      ))}
      <mesh geometry={back.ceiling} material={mats.ceiling} position={[0, h + 0.05, zc - 0.06]} castShadow={cast} receiveShadow={cast} />
      {/* back wall either side of and over the inner doors (2 cm into the side walls and the ceiling: no shared faces) */}
      {[-1, 1].map((sd) => (
        <mesh key={`p${sd}`} geometry={back.side} material={mats.wall} position={[sd * (DW / 2 + (side + 0.02) / 2), (h + 0.02) / 2, zb - 0.05]} castShadow={cast} receiveShadow={cast} />
      ))}
      {/* (1 cm into the side panels, its face 4 mm behind theirs: no shared faces) */}
      <mesh geometry={back.over} material={mats.wall} position={[0, (DH + h + 0.02) / 2, zb - 0.05]} castShadow={cast} receiveShadow={cast} />
      {/* inner door frame: jambs, head and the meeting stile pair, set into the opening */}
      {[-1, 1].map((sd) => (
        <mesh key={`j${sd}`} material={mats.frame} position={[sd * (DW / 2 - 0.045), DH / 2, zb - 0.05]}>
          <boxGeometry args={[0.1, DH, 0.16]} />
        </mesh>
      ))}
      <mesh material={mats.frame} position={[0, DH - 0.045, zb - 0.05]}>
        <boxGeometry args={[DW, 0.1, 0.16]} />
      </mesh>
      {/* the inner doors, closed: two smoked-glass leaves meeting in the middle */}
      {glass && <mesh geometry={pane} material={glass} position={[0, fy + (DH - 0.11) / 2, zb - 0.05]} />}
      {[-1, 1].map((sd) => (
        <group key={`l${sd}`} position={[sd * (leaf / 2 + 0.003), fy + 0.002, zb - 0.05]}>
          <LeafFrame w={leaf} h={DH - 0.11} frame={mats.frame} />
        </group>
      ))}
      {/* the door operator's lit sensor over the inner doors */}
      <mesh material={mats.light} position={[0, DH + 0.12, zb + 0.008]}>
        <boxGeometry args={[foyer ? DW + 0.6 : 0.5, 0.025, 0.02]} />
      </mesh>
      {Array.from({ length: s.lights }, (_, i) => {
        const z = z0 - ((i + 0.5) / s.lights) * depth;
        return cols.map((x) => (
          <group key={`${i}:${x}`}>
            <mesh material={mats.light} position={[x, h - 0.002, z]} rotation={[Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.09, 20]} />
            </mesh>
            <mesh material={mats.pool} position={[x, fy + 0.02, z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
              <planeGeometry args={[1.6, 1.6]} />
            </mesh>
          </group>
        ));
      })}
    </group>
  );
}

/** Small lit game sign (0.6 m) above a hall door, replacing the old full-height door poster. */
export function DoorBadge({ def, y, z }: { def: PortalDef; y: number; z: number }) {
  const mat = useMemo(() => {
    const tex = doorBadgeTexture(def.kind, def.color);
    return new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: "#ffffff",
      emissiveIntensity: 0.55,
      roughness: 0.4,
      transparent: true,
      alphaTest: 0.05,
    });
  }, [def.kind, def.color]);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh material={mat} position={[0, y, z]}>
      <planeGeometry args={[0.6, 0.6]} />
    </mesh>
  );
}

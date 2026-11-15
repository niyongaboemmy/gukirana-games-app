"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { isOnScreen, useArea } from "@/world/stage";
import { useFightBridge } from "./bridge";
import { LOBBY_VENUE } from "./gym-plan";
import { RINGS } from "./plan";
import { F } from "./strings";

/**
 * The lobby as a venue entrance (P3-FGT-04): a reception desk with a staff member (gym-life, room "fight"), a "Fights
 * now" board behind it fed ONLY by the ring registry (the bridge: real fights, nothing invented), a trophy cabinet,
 * planters by the doors. Static parts are one vertex-coloured merged mesh; the cabinet glass 1; the board 1 canvas
 * (redrawn only when what it lists changes).
 */

const _c = new THREE.Color();
type Parts = THREE.BufferGeometry[];
function colored(g: THREE.BufferGeometry, color: string) {
  const n = g.getAttribute("position").count;
  const c = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i++) c.set([_c.r, _c.g, _c.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g.index ? g.toNonIndexed() : g;
}
const box = (p: Parts, w: number, h: number, d: number, x: number, y: number, z: number, col: string) =>
  p.push(colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), col));
const cyl = (
  p: Parts,
  rt: number,
  rb: number,
  h: number,
  x: number,
  y: number,
  z: number,
  col: string,
  seg = 14,
) => p.push(colored(new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z), col));
const sph = (p: Parts, r: number, x: number, y: number, z: number, col: string, sy = 1) =>
  p.push(colored(new THREE.SphereGeometry(r, 12, 8).scale(1, sy, 1).translate(x, y, z), col));

function venueGeometry(): THREE.BufferGeometry {
  const p: Parts = [];
  const D = LOBBY_VENUE.desk;
  // reception desk: a timber counter with a lit red fascia strip, a raised top, a monitor and a bell
  box(p, D.w, 1.05, D.d, D.x, 0.525, D.z, "#8a5f3d");
  box(p, D.w + 0.12, 0.05, D.d + 0.1, D.x, 1.08, D.z, "#2a2522");
  box(p, 0.02, 0.06, D.d - 0.2, D.x + D.w / 2 + 0.005, 0.86, D.z, "#C8322A");
  box(p, 0.45, 0.04, D.d - 0.2, D.x - 0.12, 0.78, D.z, "#d9cfbe"); // the work top behind the counter
  box(p, 0.04, 0.3, 0.48, D.x - 0.2, 1.0, D.z - 0.55, "#121214");
  box(p, 0.12, 0.02, 0.14, D.x - 0.12, 0.81, D.z - 0.55, "#121214");
  cyl(p, 0.04, 0.05, 0.035, D.x + 0.18, 1.12, D.z + 0.7, "#b08a3a");
  // trophy cabinet: a dark timber case with three glass shelves of cups, belts and gloves
  const C = LOBBY_VENUE.cabinet;
  // an open-fronted case (back, sides, plinth, top with a lit pelmet); the glass front is its own mesh
  box(p, 0.04, C.h, C.d, C.x + C.w / 2 - 0.02, C.h / 2, C.z, "#5a3f2d");
  for (const s of [-1, 1]) box(p, C.w, C.h, 0.04, C.x, C.h / 2, C.z + s * (C.d / 2 - 0.02), "#3a2a20");
  box(p, C.w, 0.18, C.d, C.x, 0.09, C.z, "#2a1e17");
  box(p, C.w, 0.08, C.d, C.x, C.h - 0.04, C.z, "#2a1e17");
  box(p, 0.02, 0.03, C.d - 0.1, C.x + C.w / 2 - 0.05, C.h - 0.1, C.z, "#fff1d6");
  for (const y of [0.55, 1.05, 1.55]) box(p, C.w - 0.08, 0.02, C.d - 0.1, C.x - 0.02, y, C.z, "#cfd6d9");
  const gold = "#c9a03e";
  const silver = "#b9bcc2";
  for (const [k, y] of [0.55, 1.05, 1.55].entries())
    for (let i = 0; i < 3; i++) {
      const z = C.z - 0.55 + i * 0.55;
      const col = (i + k) % 3 === 0 ? silver : gold;
      if (k === 1 && i === 1) {
        // a championship belt on its stand
        box(p, 0.06, 0.16, 0.42, C.x - 0.05, y + 0.16, z, "#1c1c1e");
        box(p, 0.07, 0.12, 0.16, C.x - 0.06, y + 0.16, z, gold);
        continue;
      }
      if (k === 2 && i === 0) {
        // a signed pair of gloves
        sph(p, 0.07, C.x - 0.05, y + 0.1, z - 0.06, "#b3242b", 1.25);
        sph(p, 0.07, C.x - 0.05, y + 0.1, z + 0.07, "#b3242b", 1.25);
        continue;
      }
      cyl(p, 0.05, 0.06, 0.04, C.x - 0.05, y + 0.03, z, "#1c1c1e");
      cyl(p, 0.015, 0.015, 0.08, C.x - 0.05, y + 0.09, z, col, 8);
      cyl(p, 0.07, 0.03, 0.12, C.x - 0.05, y + 0.19, z, col);
    }
  // planters with small leafy trees
  for (const pl of LOBBY_VENUE.plants) {
    cyl(p, 0.26, 0.22, 0.5, pl.x, 0.25, pl.z, "#2b2a2c", 16);
    cyl(p, 0.03, 0.04, 0.7, pl.x, 0.85, pl.z, "#5a3f2a", 6);
    sph(p, 0.36, pl.x, 1.35, pl.z, "#3f6a3a", 1.2);
    sph(p, 0.26, pl.x + 0.15, 1.15, pl.z - 0.1, "#4b7a42");
  }
  const g = mergeGeometries(p)!;
  p.forEach((x) => x.dispose());
  return g;
}

/** what the Fights now board lists: the live rings of the registry (fighting / starting / result), nothing else */
function boardKey(): string {
  const rings = useFightBridge.getState().rings;
  return RINGS.map((r) => rings[r.id])
    .filter((s) => s && (s.status === "fighting" || s.status === "starting" || s.status === "result"))
    .slice(0, 6)
    .map(
      (s) =>
        `${s!.id}|${s!.status}|${s!.red?.name ?? ""}|${s!.blue?.name ?? ""}|${s!.score?.red ?? ""}|${s!.score?.blue ?? ""}`,
    )
    .join(";");
}
function drawBoard(g: CanvasRenderingContext2D, key: string) {
  const W = 1024;
  const H = 512;
  g.fillStyle = "#0e0e10";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#C8322A";
  g.fillRect(0, 0, W, 76);
  g.fillStyle = "#ffffff";
  g.font = "800 44px sans-serif";
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.fillText(F.fightsToday.toUpperCase(), 32, 40);
  const rows = key ? key.split(";") : [];
  if (!rows.length) {
    g.font = "600 34px sans-serif";
    g.fillStyle = "#cfcfcf";
    g.textAlign = "center";
    g.fillText(F.noFightsNow, W / 2, 290);
    return;
  }
  rows.forEach((row, i) => {
    const [id, st, red, blue, a, b] = row.split("|");
    const y = 118 + i * 66;
    g.fillStyle = i % 2 ? "#17171a" : "#1d1d21";
    g.fillRect(16, y - 30, W - 32, 60);
    g.textAlign = "left";
    g.fillStyle = "#ffffff";
    g.font = "800 32px sans-serif";
    g.fillText(F.ring(id!), 32, y);
    g.font = "600 30px sans-serif";
    g.fillText(`${red || "—"}  ${F.vs}  ${blue || "—"}`.slice(0, 34), 220, y);
    g.textAlign = "right";
    g.fillStyle = st === "result" ? "#d8d8d8" : "#ff8a7a";
    g.fillText(a && b ? `${a} – ${b}` : (F.status[st as keyof typeof F.status] ?? ""), W - 32, y);
  });
}

function FightsBoard() {
  const area = useArea();
  const parts = useMemo(() => {
    const cv = document.createElement("canvas");
    cv.width = 1024;
    cv.height = 512;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return {
      g: cv.getContext("2d")!,
      tex,
      mat: new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
    };
  }, []);
  useEffect(() => () => (parts.tex.dispose(), parts.mat.dispose()), [parts]);
  const shown = useRef<string | null>(null);
  const acc = useRef(1);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 0.5 || !isOnScreen(area)) return;
    acc.current = 0;
    const key = boardKey();
    if (key === shown.current) return;
    shown.current = key;
    drawBoard(parts.g, key);
    parts.tex.needsUpdate = true;
  });
  const B = LOBBY_VENUE.fightsBoard;
  return (
    <group position={[B.x, B.y, B.z]} rotation-y={Math.PI / 2}>
      <mesh position={[0, 0, -0.02]}>
        <boxGeometry args={[B.w + 0.14, B.h + 0.14, 0.04]} />
        <meshStandardMaterial color="#0c0c0e" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh material={parts.mat} position={[0, 0, 0.008]}>
        <planeGeometry args={[B.w, B.h]} />
      </mesh>
    </group>
  );
}

export function LobbyVenue() {
  const res = useMemo(() => {
    const geo = venueGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.08 });
    const glass = new THREE.MeshPhysicalMaterial({
      color: "#c9d3d6",
      transparent: true,
      opacity: 0.18,
      roughness: 0.08,
      depthWrite: false,
    });
    return { geo, mat, glass };
  }, []);
  useEffect(() => () => (res.geo.dispose(), res.mat.dispose(), res.glass.dispose()), [res]);
  const C = LOBBY_VENUE.cabinet;
  const D = LOBBY_VENUE.desk;
  return (
    <group userData={{ noMerge: true }}>
      <mesh geometry={res.geo} material={res.mat} receiveShadow />
      {/* the cabinet's glass front (drawn after the trophies) */}
      <mesh
        material={res.glass}
        position={[C.x - C.w / 2 - 0.005, C.h / 2 + 0.05, C.z]}
        rotation-y={-Math.PI / 2}
        renderOrder={2}
      >
        <planeGeometry args={[C.d - 0.06, C.h - 0.2]} />
      </mesh>
      <Text
        font="/fonts/Baloo2.ttf"
        fontSize={0.16}
        letterSpacing={0.1}
        position={[C.x - C.w / 2 - 0.02, C.h + 0.16, C.z]}
        rotation-y={-Math.PI / 2}
        anchorX="center"
        anchorY="middle"
      >
        {F.trophies.toUpperCase()}
        <meshBasicMaterial color="#e8d9b8" toneMapped={false} />
      </Text>
      {/* reception sign on the counter front */}
      <Text
        font="/fonts/Baloo2.ttf"
        fontSize={0.17}
        letterSpacing={0.12}
        position={[D.x + D.w / 2 + 0.012, 0.55, D.z]}
        rotation-y={Math.PI / 2}
        anchorX="center"
        anchorY="middle"
      >
        {F.reception.toUpperCase()}
        <meshBasicMaterial color="#f2e9dc" toneMapped={false} />
      </Text>
      <Text
        font="/fonts/Baloo2.ttf"
        fontSize={0.09}
        position={[D.x + D.w / 2 + 0.012, 0.38, D.z]}
        rotation-y={Math.PI / 2}
        anchorX="center"
        anchorY="middle"
      >
        {F.receptionSub}
        <meshBasicMaterial color="#d8cfc2" toneMapped={false} />
      </Text>
      <FightsBoard />
    </group>
  );
}

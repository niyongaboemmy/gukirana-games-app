"use client";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { isOnScreen, useArea } from "@/world/stage";
import { BOXING_SIZE } from "./plan";
import { GYM_DECOR, GYM_PROPS, HEAVY_BAGS, TRAINING_FLOOR, VENUE } from "./gym-plan";
import { F } from "./strings";

/**
 * The Boxing hall's training wall and venue props (P3-FGT-04, gym-plan.ts): rubber floor with tape marks, a mirror,
 * heavy bags that swing when hit, a speed bag, a double-end bag, a skipping square, a pads corner, a weight bench and
 * rack, a water station and a towel cart; the announcer's stand and the timekeeper's table at the feature stage; the
 * hall rules and ring etiquette boards, a gym timer and the changing room door.
 *
 * Budget: every static part is ONE vertex-coloured merged mesh (1 draw call), the mirror 1, the boards + timer one
 * canvas (1, the timer redrawn only when its second changes), the bags 2 instanced meshes. `hidden` / `dim` let the
 * fight focus mode put the whole wall away or fade it back.
 */

const S = BOXING_SIZE.d / 2;

type Parts = THREE.BufferGeometry[];
const _c = new THREE.Color();
function colored(g: THREE.BufferGeometry, color: string) {
  const n = g.getAttribute("position").count;
  const c = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i++) c.set([_c.r, _c.g, _c.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g.index ? g.toNonIndexed() : g;
}
function box(
  p: Parts,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: string,
  ry = 0,
) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  p.push(colored(g, color));
}
function cyl(
  p: Parts,
  rt: number,
  rb: number,
  h: number,
  x: number,
  y: number,
  z: number,
  color: string,
  seg = 12,
  rx = 0,
  rz = 0,
) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  p.push(colored(g, color));
}

const COL = {
  rubber: "#2b2a2c",
  tape: "#d9cfae",
  chalk: "#cfcac0",
  steel: "#2e2f33",
  chrome: "#9a9ca2",
  wood: "#9a6b45",
  white: "#e6e4de",
  blue: "#5b7fa6",
  towel: "#b3242b",
  towel2: "#e8e4dc",
  plate: "#1c1c1e",
  pad: "#8a1f22",
  door: "#4a3426",
  frame: "#1e1d1f",
  brass: "#b08a3a",
  cloth: "#3a2a20",
};

/** everything static, in one geometry */
function staticGeometry(): THREE.BufferGeometry {
  const p: Parts = [];
  const F0 = TRAINING_FLOOR;
  // rubber floor (2 mm proud of the concrete, an opaque slab: no decal stacking on the floor plane)
  box(p, F0.x1 - F0.x0, 0.02, F0.z1 - F0.z0, (F0.x0 + F0.x1) / 2, 0.01, (F0.z0 + F0.z1) / 2, COL.rubber);
  // tape lines on the rubber: an edge line, the skipping square, footwork ladder marks at the mirror
  box(p, F0.x1 - F0.x0, 0.004, 0.05, (F0.x0 + F0.x1) / 2, 0.022, F0.z0 + 0.06, COL.tape);
  const sk = GYM_DECOR.skipping;
  for (const [dx, dz, w, d] of [
    [0, -0.6, 1.3, 0.05],
    [0, 0.6, 1.3, 0.05],
    [-0.65, 0, 0.05, 1.25],
    [0.65, 0, 0.05, 1.25],
  ] as const)
    box(p, w, 0.004, d, sk.x + dx, 0.022, Math.min(S - 0.05, sk.z + dz), COL.tape);
  for (let k = 0; k < 5; k++)
    box(p, 0.04, 0.004, 0.55, GYM_DECOR.mirror.x0 + 0.4 + k * 0.55, 0.022, S - 0.75, COL.chalk);
  // the mirror's frame
  const M = GYM_DECOR.mirror;
  box(p, M.x1 - M.x0 + 0.1, 0.06, 0.05, (M.x0 + M.x1) / 2, M.y1 + 0.03, S - 0.03, COL.frame);
  box(p, M.x1 - M.x0 + 0.1, 0.06, 0.05, (M.x0 + M.x1) / 2, M.y0 - 0.03, S - 0.03, COL.frame);
  // heavy-bag wall brackets (the chains and bags swing: instanced)
  for (const b of HEAVY_BAGS) {
    box(p, 0.08, 0.08, S - b.z + 0.05, b.x, 2.7, (b.z + S) / 2, COL.steel);
    box(p, 0.3, 0.3, 0.04, b.x, 2.7, S - 0.02, COL.steel);
  }
  // speed bag platform (round board on a wall bracket)
  const sp = GYM_PROPS.find((x) => x.kind === "speedBag")!;
  cyl(p, 0.36, 0.36, 0.05, sp.x, 2.05, sp.z, COL.wood, 20);
  box(p, 0.06, 0.06, 0.45, sp.x - 0.25, 2.0, S - 0.22, COL.steel);
  box(p, 0.06, 0.06, 0.45, sp.x + 0.25, 2.0, S - 0.22, COL.steel);
  // double-end bag cords: floor anchor and ceiling line
  const de = GYM_DECOR.doubleEnd;
  cyl(p, 0.006, 0.006, 1.15, de.x, 0.58, de.z, COL.white, 4);
  cyl(p, 0.006, 0.006, 1.2, de.x, 2.3, de.z, COL.white, 4);
  cyl(p, 0.1, 0.12, 0.04, de.x, 0.02, de.z, COL.steel, 12);
  // towel cart: frame, two shelves, folded towels
  const tc = GYM_DECOR.towelCart;
  for (const y of [0.25, 0.75]) box(p, 0.75, 0.03, 0.42, tc.x, y, tc.z, COL.chrome);
  for (const [dx, dz] of [
    [-0.35, -0.19],
    [0.35, -0.19],
    [-0.35, 0.19],
    [0.35, 0.19],
  ] as const)
    cyl(p, 0.012, 0.012, 0.95, tc.x + dx, 0.5, tc.z + dz, COL.chrome, 6);
  for (let k = 0; k < 3; k++) {
    box(p, 0.2, 0.12, 0.32, tc.x - 0.22 + k * 0.22, 0.83, tc.z, k === 1 ? COL.towel2 : COL.towel);
    box(p, 0.2, 0.1, 0.32, tc.x - 0.22 + k * 0.22, 0.32, tc.z, COL.towel2);
  }
  // water station: cooler on a stand, a cup dispenser, a little bin
  const w = GYM_PROPS.find((x) => x.kind === "water")!;
  box(p, 0.4, 0.95, 0.38, w.x, 0.475, w.z, COL.white);
  cyl(p, 0.15, 0.15, 0.42, w.x, 1.17, w.z, COL.blue, 16);
  box(p, 0.08, 0.06, 0.06, w.x, 0.85, w.z - 0.21, COL.steel);
  cyl(p, 0.04, 0.04, 0.3, w.x + 0.3, 1.1, S - 0.05, COL.white, 10);
  cyl(p, 0.13, 0.11, 0.38, w.x - 0.36, 0.19, w.z, COL.steel, 12);
  // pads corner: a pad rack on the wall with spare focus mitts
  const pd = GYM_DECOR.pads;
  box(p, 1.0, 0.05, 0.12, pd.x, 1.55, S - 0.06, COL.steel);
  for (let k = 0; k < 3; k++) box(p, 0.2, 0.26, 0.08, pd.x - 0.3 + k * 0.3, 1.38, S - 0.1, COL.pad);
  // weight bench + rack with plates
  const be = GYM_DECOR.bench;
  box(p, be.w, 0.1, be.d, be.x, 0.45, be.z, COL.cloth);
  box(p, 0.06, 0.4, 0.3, be.x - be.w / 2 + 0.12, 0.2, be.z, COL.steel);
  box(p, 0.06, 0.4, 0.3, be.x + be.w / 2 - 0.12, 0.2, be.z, COL.steel);
  const rk = GYM_DECOR.rack;
  for (const dx of [-rk.w / 2 + 0.05, rk.w / 2 - 0.05])
    box(p, 0.05, 1.3, 0.05, rk.x + dx, 0.65, rk.z, COL.steel);
  box(p, rk.w, 0.04, rk.d, rk.x, 0.25, rk.z, COL.steel);
  cyl(p, 0.015, 0.015, rk.w + 0.3, rk.x, 1.25, rk.z, COL.chrome, 8, 0, Math.PI / 2);
  for (const s of [-1, 1])
    for (const k of [0, 1])
      cyl(
        p,
        0.22 - k * 0.05,
        0.22 - k * 0.05,
        0.04,
        rk.x + s * (rk.w / 2 + 0.06 + k * 0.05),
        1.25,
        rk.z,
        COL.plate,
        18,
        0,
        Math.PI / 2,
      );
  for (let k = 0; k < 4; k++)
    cyl(p, 0.16, 0.16, 0.03, rk.x - 0.45 + k * 0.3, 0.42, rk.z, COL.plate, 14, Math.PI / 2);
  // announcer's stand: a lectern with a microphone on a gooseneck
  const an = VENUE.announcer;
  box(p, 0.62, 1.05, 0.45, an.x, 0.525, an.z, COL.frame);
  box(p, 0.7, 0.04, 0.52, an.x, 1.07, an.z - 0.02, COL.wood, 0);
  box(p, 0.5, 0.12, 0.02, an.x, 0.85, an.z - 0.235, COL.pad);
  cyl(p, 0.008, 0.008, 0.38, an.x + 0.12, 1.28, an.z - 0.1, COL.steel, 6, 0.45);
  cyl(p, 0.025, 0.02, 0.07, an.x + 0.12, 1.47, an.z - 0.18, COL.plate, 8);
  // timekeeper's table: table, a bell on a block, a scoresheet and a stool behind
  const tk = VENUE.timekeeper;
  box(p, tk.w, 0.04, tk.d, tk.x, 0.76, tk.z, COL.frame);
  box(p, tk.w - 0.06, 0.7, 0.02, tk.x, 0.39, tk.z - tk.d / 2 + 0.02, COL.pad);
  for (const s of [-1, 1])
    box(p, 0.04, 0.74, tk.d - 0.06, tk.x + s * (tk.w / 2 - 0.04), 0.37, tk.z, COL.frame);
  box(p, 0.16, 0.06, 0.12, tk.x - 0.4, 0.81, tk.z, COL.wood);
  cyl(p, 0.07, 0.09, 0.07, tk.x - 0.4, 0.88, tk.z, COL.brass, 16);
  box(p, 0.3, 0.005, 0.22, tk.x + 0.2, 0.785, tk.z, COL.white);
  // the changing room door (north wall, past the east lockers) and its frame
  const cd = VENUE.changingDoor;
  // (the frame stands 3 cm proud of the slat band, the leaf 5 mm inside the frame's faces: no shared planes)
  box(p, cd.w + 0.16, 2.3, 0.08, cd.x, 1.15, -S + 0.05, COL.frame);
  box(p, cd.w, 2.15, 0.07, cd.x, 1.075, -S + 0.05, COL.door);
  box(p, 0.03, 0.18, 0.04, cd.x + cd.w / 2 - 0.12, 1.05, -S + 0.1, COL.chrome);
  // the notice boards' cork frames (their faces are on the board canvas)
  for (const n of VENUE.notices) box(p, 1.36, 1.0, 0.04, n.x, 1.75, S - 0.02, COL.wood);
  const g = mergeGeometries(p)!;
  p.forEach((x) => x.dispose());
  return g;
}

/* ---------------- swinging bags ---------------- */

/** pendulum state per bag (angle about x / z, rad, and their rates); hits from players and the trainee push it */
export const bagSwing = new Map<string, { ax: number; az: number; vx: number; vz: number }>();
/** a hit on bag `id` towards +z (the wall) with `power` 0…1 (cosmetic only) */
export function hitBag(id: string, power = 1, side = 0) {
  const s = bagSwing.get(id) ?? { ax: 0, az: 0, vx: 0, vz: 0 };
  s.vx -= 0.9 * power; // (a negative angle about x swings the bottom towards the wall, +z)
  s.vz += side * 0.35 * power;
  bagSwing.set(id, s);
}

/** heavy bag geometry with its origin at the pivot (the bracket), chain included, hanging down to 0.55 m */
function heavyBagGeometry(): THREE.BufferGeometry {
  const p: Parts = [];
  cyl(p, 0.006, 0.006, 0.5, 0, -0.25, 0, COL.chrome, 4);
  cyl(p, 0.17, 0.17, 0.04, 0, -0.52, 0, COL.steel, 18);
  cyl(p, 0.19, 0.19, 1.1, 0, -1.1, 0, "#4a1e1a", 18);
  cyl(p, 0.192, 0.192, 0.08, 0, -0.7, 0, "#1c1c1e", 18);
  cyl(p, 0.192, 0.192, 0.08, 0, -1.5, 0, "#1c1c1e", 18);
  const g = mergeGeometries(p)!;
  p.forEach((x) => x.dispose());
  return g;
}
/** small bags (speed bag, double-end): origin at the pivot */
function smallBagGeometry(): THREE.BufferGeometry {
  const p: Parts = [];
  cyl(p, 0.005, 0.005, 0.12, 0, -0.06, 0, COL.chrome, 4);
  const s = new THREE.SphereGeometry(0.12, 14, 10);
  s.scale(1, 1.35, 1);
  s.translate(0, -0.24, 0);
  p.push(colored(s, "#5a2a1e"));
  const g = mergeGeometries(p)!;
  p.forEach((x) => x.dispose());
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

function Bags({ mat }: { mat: THREE.Material }) {
  const area = useArea();
  const heavy = useRef<THREE.InstancedMesh>(null);
  const small = useRef<THREE.InstancedMesh>(null);
  const geos = useMemo(() => ({ heavy: heavyBagGeometry(), small: smallBagGeometry() }), []);
  useEffect(() => () => (geos.heavy.dispose(), geos.small.dispose()), [geos]);
  const sp = GYM_PROPS.find((x) => x.kind === "speedBag")!;
  const smalls = useMemo(
    () => [
      { id: sp.id, x: sp.x, y: 2.02, z: sp.z },
      { id: "double-end", x: GYM_DECOR.doubleEnd.x, y: 1.74, z: GYM_DECOR.doubleEnd.z },
    ],
    [sp],
  );
  const write = () => {
    HEAVY_BAGS.forEach((b, i) => {
      const s = bagSwing.get(b.id);
      _q.setFromEuler(_e.set(s?.ax ?? 0, 0, s?.az ?? 0));
      heavy.current!.setMatrixAt(i, _m.compose(_v.set(b.x, 2.68, b.z), _q, ONE));
    });
    smalls.forEach((b, i) => {
      const s = bagSwing.get(b.id);
      _q.setFromEuler(_e.set(s?.ax ?? 0, 0, s?.az ?? 0));
      small.current!.setMatrixAt(i, _m.compose(_v.set(b.x, b.y, b.z), _q, ONE));
    });
    heavy.current!.instanceMatrix.needsUpdate = true;
    small.current!.instanceMatrix.needsUpdate = true;
  };
  useLayoutEffect(() => {
    write();
    heavy.current!.computeBoundingSphere();
    small.current!.computeBoundingSphere();
  });
  useFrame((_, raw) => {
    if (!isOnScreen(area)) return;
    const dt = Math.min(raw, 0.05);
    let moving = false;
    for (const s of bagSwing.values()) {
      // a damped pendulum (ω ≈ 2.4 rad/s for a 1.7 m hang), angles clamped so a flurry never flips a bag
      s.vx += (-5.8 * s.ax - 1.1 * s.vx) * dt;
      s.vz += (-5.8 * s.az - 1.1 * s.vz) * dt;
      s.ax = THREE.MathUtils.clamp(s.ax + s.vx * dt, -0.35, 0.35);
      s.az = THREE.MathUtils.clamp(s.az + s.vz * dt, -0.25, 0.25);
      if (Math.abs(s.ax) + Math.abs(s.az) + Math.abs(s.vx) + Math.abs(s.vz) > 1e-4) moving = true;
    }
    if (moving) write();
  });
  return (
    <group userData={{ noMerge: true }}>
      <instancedMesh ref={heavy} args={[geos.heavy, mat, HEAVY_BAGS.length]} />
      <instancedMesh ref={small} args={[geos.small, mat, smalls.length]} />
    </group>
  );
}

/* ---------------- boards + gym timer (one canvas) ---------------- */

const BOARD = { w: 1024, h: 512 };
/** the gym timer: 3 min work, 1 min rest, from the wall clock (a gym timer, not anyone's fight) */
export function gymTimer(sec: number) {
  const k = ((Math.floor(sec) % 240) + 240) % 240;
  return k < 180 ? { phase: "round" as const, left: 180 - k } : { phase: "rest" as const, left: 240 - k };
}
function drawNotices(g: CanvasRenderingContext2D) {
  const items = [
    { title: F.rulesTitle, lines: F.rules },
    { title: F.etiquetteTitle, lines: F.etiquette },
  ];
  items.forEach((it, i) => {
    const x0 = i * 512;
    g.fillStyle = "#efe7d6";
    g.fillRect(x0 + 8, 8, 496, 368);
    g.fillStyle = "#7d1d18";
    g.fillRect(x0 + 8, 8, 496, 70);
    g.fillStyle = "#ffffff";
    g.font = "700 38px sans-serif";
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(it.title.toUpperCase(), x0 + 32, 44);
    g.fillStyle = "#2a2420";
    g.font = "500 27px sans-serif";
    it.lines.forEach((l, k) => {
      g.fillText(`•  ${l}`, x0 + 32, 118 + k * 64, 450);
    });
  });
}
function drawClock(g: CanvasRenderingContext2D, sec: number) {
  const t = gymTimer(sec);
  g.clearRect(0, 384, 1024, 128);
  g.fillStyle = "#101012";
  g.fillRect(0, 384, 512, 128);
  g.fillStyle = t.phase === "round" ? "#C8322A" : "#2E9D57";
  g.fillRect(16, 400, 150, 96);
  g.fillStyle = "#ffffff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "800 34px sans-serif";
  g.fillText((t.phase === "round" ? F.gymClockRound : F.gymClockRest).toUpperCase(), 91, 448);
  g.font = "800 84px monospace";
  g.fillStyle = t.phase === "round" ? "#ff6a5a" : "#7be0a2";
  g.fillText(`${Math.floor(t.left / 60)}:${String(t.left % 60).padStart(2, "0")}`, 340, 450);
}

function Boards({ dim }: { dim: number }) {
  const area = useArea();
  const parts = useMemo(() => {
    const cv = document.createElement("canvas");
    cv.width = BOARD.w;
    cv.height = BOARD.h;
    const g = cv.getContext("2d")!;
    drawNotices(g);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const quad = (
      w: number,
      h: number,
      u0: number,
      v0: number,
      u1: number,
      v1: number,
      x: number,
      y: number,
      z: number,
    ) => {
      const q = new THREE.PlaneGeometry(w, h);
      const uv = q.getAttribute("uv") as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
      q.rotateY(Math.PI); // facing into the hall (−z) from the south wall
      q.translate(x, y, z);
      return q;
    };
    const qs = [
      ...VENUE.notices.map((n) =>
        quad(
          1.28,
          0.92,
          n.kind === "rules" ? 0 : 0.5,
          1 - 376 / 512,
          n.kind === "rules" ? 0.5 : 1,
          1,
          n.x,
          1.75,
          S - 0.045,
        ),
      ),
      quad(1.2, 0.3, 0, 0, 0.5, 128 / 512, GYM_DECOR.clock.x, GYM_DECOR.clock.y, S - 0.04),
    ];
    const geo = mergeGeometries(qs)!;
    qs.forEach((q) => q.dispose());
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: false });
    return { g, tex, geo, mat };
  }, []);
  useEffect(() => () => (parts.tex.dispose(), parts.geo.dispose(), parts.mat.dispose()), [parts]);
  const shown = useRef(-1);
  useFrame(() => {
    if (!isOnScreen(area)) return;
    const sec = Math.floor(Date.now() / 1000);
    if (sec === shown.current) return;
    shown.current = sec;
    drawClock(parts.g, sec);
    parts.tex.needsUpdate = true;
  });
  useEffect(() => {
    parts.mat.transparent = dim < 1;
    parts.mat.opacity = dim;
    parts.mat.needsUpdate = true;
  }, [dim, parts]);
  return <mesh geometry={parts.geo} material={parts.mat} />;
}

/* ---------------- the wall ---------------- */

export function TrainingZone({ hidden = false, dim = 1 }: { hidden?: boolean; dim?: number }) {
  const res = useMemo(() => {
    const geo = staticGeometry();
    const kit = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 });
    // the mirror: a bright, cool, smooth panel (no real reflection in budget); a soft vertical sheen in its texture
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 64;
    const g = cv.getContext("2d")!;
    const gr = g.createLinearGradient(0, 0, 256, 0);
    gr.addColorStop(0, "#5f686d");
    gr.addColorStop(0.3, "#8e979b");
    gr.addColorStop(0.45, "#b8c0c4");
    gr.addColorStop(0.6, "#899297");
    gr.addColorStop(1, "#5a6368");
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 64);
    const mtex = new THREE.CanvasTexture(cv);
    mtex.colorSpace = THREE.SRGBColorSpace;
    const mirror = new THREE.MeshStandardMaterial({ map: mtex, roughness: 0.15, metalness: 0.35 });
    const M = GYM_DECOR.mirror;
    const mgeo = new THREE.PlaneGeometry(M.x1 - M.x0, M.y1 - M.y0)
      .rotateY(Math.PI)
      .translate((M.x0 + M.x1) / 2, (M.y0 + M.y1) / 2, S - 0.035);
    // a warm wash from a strip light over the training wall (no rings light it): one additive quad on the wall that
    // fades downwards, and the strip itself (the gradient's brightest row)
    const wc = document.createElement("canvas");
    wc.width = 4;
    wc.height = 128;
    const wg = wc.getContext("2d")!;
    const wgr = wg.createLinearGradient(0, 0, 0, 128);
    wgr.addColorStop(0, "rgba(255,236,205,1)");
    wgr.addColorStop(0.06, "rgba(255,224,180,0.55)");
    wgr.addColorStop(0.5, "rgba(255,210,160,0.22)");
    wgr.addColorStop(1, "rgba(255,200,150,0.05)");
    wg.fillStyle = wgr;
    wg.fillRect(0, 0, 4, 128);
    const wtex = new THREE.CanvasTexture(wc);
    wtex.colorSpace = THREE.SRGBColorSpace;
    const wash = new THREE.MeshBasicMaterial({ map: wtex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.55 });
    const F0 = TRAINING_FLOOR;
    const wq = new THREE.PlaneGeometry(F0.x1 - F0.x0, 3.4).rotateY(Math.PI).translate((F0.x0 + F0.x1) / 2, 1.7, S - 0.06);
    const sq = new THREE.PlaneGeometry(F0.x1 - F0.x0, 0.07).rotateX(Math.PI / 2).translate((F0.x0 + F0.x1) / 2, 3.42, S - 0.12);
    const suv = sq.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < suv.count; i++) suv.setY(i, 0.995);
    const wgeo = mergeGeometries([wq, sq])!;
    wq.dispose();
    sq.dispose();
    return { geo, kit, mirror, mtex, mgeo, wash, wtex, wgeo };
  }, []);
  useEffect(() => () => (res.wash.dispose(), res.wtex.dispose(), res.wgeo.dispose()), [res]);
  useEffect(
    () => () => (
      res.geo.dispose(),
      res.kit.dispose(),
      res.mirror.dispose(),
      res.mtex.dispose(),
      res.mgeo.dispose()
    ),
    [res],
  );
  useEffect(() => {
    for (const m of [res.kit, res.mirror]) {
      m.transparent = dim < 1;
      m.opacity = dim;
      m.needsUpdate = true;
    }
  }, [dim, res]);
  return (
    <group visible={!hidden && dim > 0.01} userData={{ noMerge: true }}>
      <mesh geometry={res.geo} material={res.kit} receiveShadow />
      <mesh geometry={res.mgeo} material={res.mirror} />
      <mesh geometry={res.wgeo} material={res.wash} renderOrder={1} />
      <Bags mat={res.kit} />
      <Boards dim={dim} />
    </group>
  );
}

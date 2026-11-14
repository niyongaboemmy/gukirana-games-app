"use client";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { woodTexture } from "@/world/textures";
import { BOXING_AISLES, BOXING_BENCHES, BOXING_SIZE, FEATURE_ZONE_HW, RINGS, ROW_Z } from "./plan";
import { F } from "./strings";

/**
 * Boxing hall dressing (P3-FGT-03, plan §4.4): calm arena realism on a small budget.
 *  - warm light pools on the floor round every ring (one additive instanced decal), so the rings sit in light and the
 *    aisles fall off softly instead of a flat black hall;
 *  - painted floor markings: the main aisle and cross aisle edge lines and a safety square round every ring;
 *  - timber spectator benches along the long walls (plan.ts BOXING_BENCHES, also colliders);
 *  - fabric banners on the end walls and over the lockers (one canvas atlas).
 * Static parts are merged by the hall's StaticMerge; the pools and banners are one draw call each.
 */

/* ---------------- light pools ---------------- */

let poolTex: THREE.Texture | null = null;
function poolTexture() {
  if (poolTex) return poolTex;
  const n = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = n;
  const g = cv.getContext("2d")!;
  const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  gr.addColorStop(0, "rgba(255,226,180,1)");
  gr.addColorStop(0.45, "rgba(255,214,160,0.55)");
  gr.addColorStop(1, "rgba(255,200,140,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, n, n);
  poolTex = new THREE.CanvasTexture(cv);
  poolTex.colorSpace = THREE.SRGBColorSpace;
  return poolTex;
}

export function LightPools({ lite }: { lite: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, opacity: lite ? 0.3 : 0.42, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3 }), [lite]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    RINGS.forEach((r, i) => {
      const s = r.feature ? 13 : 8.2;
      m.compose(new THREE.Vector3(r.x, r.feature ? FEATURE_STAGE_TOP : 0.015, r.z), new THREE.Quaternion(), new THREE.Vector3(s, 1, s));
      ref.current!.setMatrixAt(i, m);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
    ref.current!.computeBoundingSphere();
  }, []);
  useEffect(() => () => (geo.dispose(), mat.dispose()), [geo, mat]);
  return <instancedMesh ref={ref} args={[geo, mat, RINGS.length]} renderOrder={1} userData={{ noMerge: true }} />;
}
const FEATURE_STAGE_TOP = 1.215;

/* ---------------- floor markings ---------------- */

/** painted lines (one merged geometry): aisle edges, the front cross aisle, a safety square round every ring */
export function FloorMarks() {
  const { geo, mat } = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const line = (x: number, z: number, w: number, d: number) => {
      const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
      g.translate(x, 0.008, z);
      parts.push(g);
    };
    const { w, d } = BOXING_SIZE;
    // main aisles either side of the feature zone: two edge lines each
    for (const s of [-1, 1]) {
      const cx = s * (FEATURE_ZONE_HW + 1);
      for (const e of [-0.85, 0.85]) line(cx + e, -1, 0.08, d - 4);
    }
    // the front cross aisle (in front of row A) and a dashed centre line along it
    const zA = ROW_Z[0]! + 2.45 + 0.35;
    line(0, zA, w - 2, 0.08);
    for (let x = -w / 2 + 2; x < w / 2 - 2; x += 2.4) line(x + 0.6, (zA + d / 2) / 2, 1.2, 0.06);
    // block aisles between the ring columns: a dashed guide line
    for (const x of BOXING_AISLES.slice(1, -1)) if (Math.abs(x) > FEATURE_ZONE_HW + 1.5) for (let z = -d / 2 + 2; z < zA - 0.5; z += 2.0) line(x, z + 0.5, 0.06, 1.0);
    // safety squares round the standard rings (0.55 m out from the platform)
    for (const r of RINGS) {
      if (r.feature) continue;
      const k = r.half + 0.55;
      line(r.x, r.z - k, 2 * k, 0.06);
      line(r.x, r.z + k, 2 * k, 0.06);
      line(r.x - k, r.z, 0.06, 2 * k);
      line(r.x + k, r.z, 0.06, 2 * k);
    }
    const geo = mergeGeometries(parts)!;
    parts.forEach((p) => p.dispose());
    return { geo, mat: new THREE.MeshStandardMaterial({ color: "#d8cdb4", roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1 }) };
  }, []);
  useEffect(() => () => (geo.dispose(), mat.dispose()), [geo, mat]);
  return <mesh geometry={geo} material={mat} receiveShadow />;
}

/* ---------------- spectator benches ---------------- */

export function Benches() {
  const { seat, legs, mats } = useMemo(() => {
    const s: THREE.BufferGeometry[] = [];
    const l: THREE.BufferGeometry[] = [];
    for (const b of BOXING_BENCHES) {
      const back = b.z > 0 ? 1 : -1; // the wall side
      for (const [k, dz] of [
        [0, -0.12],
        [1, 0.12],
      ] as const) {
        const g = new THREE.BoxGeometry(b.w, 0.045, 0.2);
        g.translate(b.x, 0.45, b.z + dz);
        s.push(g);
        void k;
      }
      // backrest slat against the wall
      const br = new THREE.BoxGeometry(b.w, 0.14, 0.04);
      br.translate(b.x, 0.82, b.z + back * 0.22);
      s.push(br);
      for (const ex of [-b.w / 2 + 0.25, 0, b.w / 2 - 0.25]) {
        const leg = new THREE.BoxGeometry(0.05, 0.43, 0.42);
        leg.translate(b.x + ex, 0.215, b.z);
        l.push(leg);
        const post = new THREE.BoxGeometry(0.04, 0.4, 0.04);
        post.translate(b.x + ex, 0.65, b.z + back * 0.22);
        l.push(post);
      }
    }
    const wood = woodTexture().clone();
    wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
    wood.needsUpdate = true;
    const seat = mergeGeometries(s)!;
    const legs = mergeGeometries(l)!;
    s.forEach((x) => x.dispose());
    l.forEach((x) => x.dispose());
    return { seat, legs, mats: { wood: new THREE.MeshStandardMaterial({ map: wood, color: "#c08a5a", roughness: 0.7 }), steel: new THREE.MeshStandardMaterial({ color: "#232326", roughness: 0.55, metalness: 0.5 }) } };
  }, []);
  useEffect(() => () => (seat.dispose(), legs.dispose(), mats.wood.map?.dispose(), mats.wood.dispose(), mats.steel.dispose()), [seat, legs, mats]);
  return (
    <group>
      <mesh geometry={seat} material={mats.wood} castShadow receiveShadow />
      <mesh geometry={legs} material={mats.steel} />
    </group>
  );
}

/* ---------------- banners ---------------- */

const BANNERS = [
  { title: F.bannerBoxing, sub: F.hall, bg: "#5a3a26" },
  { title: F.bannerRespect, sub: F.bannerRespectSub, bg: "#2a2a2e" },
  { title: F.bannerFairPlay, sub: F.bannerFairPlaySub, bg: "#7a2a24" },
  { title: F.bannerGlovesUp, sub: F.bannerGlovesUpSub, bg: "#2a2a2e" },
];

function bannerAtlas() {
  const cw = 256;
  const ch = 768;
  const cv = document.createElement("canvas");
  cv.width = cw * BANNERS.length;
  cv.height = ch;
  const g = cv.getContext("2d")!;
  BANNERS.forEach((b, i) => {
    const x = i * cw;
    g.fillStyle = b.bg;
    g.fillRect(x, 0, cw, ch);
    // hem lines and a chocolate / white stripe
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.fillRect(x + 18, 40, cw - 36, 4);
    g.fillRect(x + 18, ch - 44, cw - 36, 4);
    g.save();
    g.translate(x + cw / 2, ch / 2);
    g.rotate(-Math.PI / 2);
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "800 92px sans-serif";
    g.fillText(b.title.toUpperCase(), 0, -26, ch - 120);
    g.font = "600 36px sans-serif";
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.fillText(b.sub.toUpperCase(), 0, 56, ch - 120);
    g.restore();
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** vertical banners (1.6 × 4.8 m) on the end walls and over the locker banks */
export function Banners() {
  const { geo, mat } = useMemo(() => {
    const { w, d } = BOXING_SIZE;
    const spots: [number, number, number, number][] = []; // x, z, rotY, banner
    for (const [k, z] of [-9, -3, 3, 9].entries()) {
      spots.push([-w / 2 + 0.08, z, Math.PI / 2, k % BANNERS.length]);
      spots.push([w / 2 - 0.08, z, -Math.PI / 2, (k + 2) % BANNERS.length]);
    }
    for (const [k, x] of [-38, -30, -22, 22, 30, 38].entries()) spots.push([x, -d / 2 + 0.08, 0, k % BANNERS.length]);
    const parts = spots.map(([x, z, ry, b]) => {
      const g = new THREE.PlaneGeometry(1.6, 4.8);
      const uv = g.getAttribute("uv") as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, (b + uv.getX(i)) / BANNERS.length);
      g.rotateY(ry);
      g.translate(x, 6.4, z);
      return g;
    });
    const geo = mergeGeometries(parts)!;
    parts.forEach((p) => p.dispose());
    return { geo, mat: new THREE.MeshStandardMaterial({ map: bannerAtlas(), roughness: 0.95, side: THREE.DoubleSide }) };
  }, []);
  useEffect(() => () => (geo.dispose(), mat.map?.dispose(), mat.dispose()), [geo, mat]);
  return <mesh geometry={geo} material={mat} userData={{ noMerge: true }} />;
}

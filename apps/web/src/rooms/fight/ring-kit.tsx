"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { boardGeometry, canvasGeometry, farRingGeometry, featureExtrasGeometry, lampGeometry, nearRingGeometry, stoolGeometry, triangles } from "./ring-kit-geometry";
import { LOD_BY_TIER, RING, ringDrawCalls, selectLods, STATUS_COLORS, stoolParked, stoolSpot, type RingLod, type RingSpec } from "./ring-kit-core";

/**
 * <RingKit rings={…} /> (P3-FGT-02): a whole field of boxing rings in a handful of instanced draw calls.
 *
 *   <RingKit rings={[{ id: "r1", x: 0, z: 0, rotY: 0, status: "free" }, …]} featureRing="r1" tier="standard" />
 *
 * Standard tier: near kit (≤ 26 m) + far kit + printed canvas + status lamps + number boards + stools + the feature
 * ring's extras = ≤ 7 draw calls for any number of rings (≈ 50 in the hall), shadows optional (+2). Lite: near
 * (≤ 14 m) + far + canvas + lamps + stools = 5 (the canvas is plain, no boards / extras). Rings outside the view are culled
 * per ring on the CPU (bounding sphere vs frustum) before the instance buffers are filled, the levels have a
 * hysteresis, and the buffers are only rewritten when an assignment / status changes. Matte materials throughout.
 * Ring placement helpers (corners, stools, fighters' and referee spots, steps) are in ring-kit-core.ts.
 */
export interface RingKitProps {
  rings: readonly RingSpec[];
  /** one ring with extra detail (judges' table, bell, lighting truss) and always the near kit */
  featureRing?: string | null;
  tier?: "lite" | "standard";
  /** the near kit (and stools) cast shadows (+2 draw calls in a shadow map) */
  shadows?: boolean;
  /** show the number boards (standard tier) */
  boards?: boolean;
  /** per-frame stats for QA / the lab */
  statsRef?: React.RefObject<RingKitStats | null>;
}

export interface RingKitStats {
  near: number;
  far: number;
  culled: number;
  drawCalls: number;
  triangles: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();
const _sphere = new THREE.Sphere();
const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/* ---------------- textures (generated once, deterministic) ---------------- */

const hash = (x: number, y: number) => {
  let a = (x * 374761393 + y * 668265263) >>> 0;
  a = Math.imul(a ^ (a >>> 13), 1274126177) >>> 0;
  return ((a ^ (a >>> 16)) >>> 0) / 4294967296;
};

/** the printed canvas: light grey-blue canvas weave, a darker apron, corner marks and a centre emblem */
function canvasTexture(): THREE.Texture {
  const n = 1024;
  const cv = document.createElement("canvas");
  cv.width = cv.height = n;
  const g = cv.getContext("2d")!;
  const half = RING.half;
  const px = (m: number) => ((m + half) / (2 * half)) * n; // ring metres → pixels
  // apron (outside the posts)
  g.fillStyle = "#3a3f47";
  g.fillRect(0, 0, n, n);
  // canvas inside the ropes
  const a = px(-RING.post),
    b = px(RING.post);
  g.fillStyle = "#b9bfc8";
  g.fillRect(a, a, b - a, b - a);
  // a subtle weave (hashed, no randomness)
  const img = g.getImageData(0, 0, n, n);
  const d = img.data;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      const w = ((x & 3) === 0 ? -5 : 0) + ((y & 3) === 0 ? -4 : 0) + (hash(x >> 1, y >> 1) - 0.5) * 9;
      d[i] = Math.max(0, Math.min(255, d[i]! + w));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + w));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + w));
    }
  g.putImageData(img, 0, 0);
  // centre emblem: two thin rings and a glove-like mark, faint blue
  const c = n / 2;
  g.strokeStyle = "rgba(31,79,176,0.55)";
  g.lineWidth = 10;
  g.beginPath();
  g.arc(c, c, n * 0.12, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 3;
  g.beginPath();
  g.arc(c, c, n * 0.135, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "rgba(31,79,176,0.45)";
  g.font = `700 ${Math.round(n * 0.045)}px sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("GUKIRANA", c, c);
  // corner marks: a quarter disc in the corner colour (red, blue) or white (neutral)
  const corners: [number, number, string][] = [
    [a, a, "rgba(179,36,43,0.7)"],
    [b, b, "rgba(31,79,176,0.7)"],
    [b, a, "rgba(240,238,232,0.7)"],
    [a, b, "rgba(240,238,232,0.7)"],
  ];
  for (const [x, y, col] of corners) {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x, y);
    g.arc(x, y, n * 0.06, 0, Math.PI * 2);
    g.fill();
  }
  // apron lettering on each side
  g.fillStyle = "rgba(220,224,230,0.55)";
  g.font = `700 ${Math.round(n * 0.03)}px sans-serif`;
  for (let s = 0; s < 4; s++) {
    g.save();
    g.translate(c, c);
    g.rotate((s * Math.PI) / 2);
    g.fillText("GUKIRANA  BOXING", 0, (b - a) / 2 + (n - (b - a)) / 4);
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** an 8 × 8 atlas of ring numbers 1…64 (light digits on graphite) */
const ATLAS = 8;
function numberAtlas(): THREE.Texture {
  const cell = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = cell * ATLAS;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#1d1f24";
  g.fillRect(0, 0, cv.width, cv.height);
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let k = 0; k < ATLAS * ATLAS; k++) {
    const x = (k % ATLAS) * cell,
      y = Math.floor(k / ATLAS) * cell;
    g.fillStyle = "#2f80ed";
    g.fillRect(x + 8, y + cell - 18, cell - 16, 6);
    g.fillStyle = "#e9ecf1";
    g.font = `700 ${Math.round(cell * 0.52)}px sans-serif`;
    g.fillText(String(k + 1), x + cell / 2, y + cell * 0.46);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* ---------------- the component ---------------- */

const matte = (opts: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, ...opts });

export function RingKit({ rings, featureRing = null, tier = "standard", shadows = false, boards = true, statsRef }: RingKitProps) {
  const lite = tier === "lite";
  const showBoards = boards && !lite;
  const cap = Math.max(1, rings.length);
  const res = useMemo(() => {
    const near = nearRingGeometry();
    const far = farRingGeometry();
    const canvas = canvasGeometry();
    const lamp = lampGeometry();
    const board = boardGeometry();
    const stool = stoolGeometry();
    const mats = {
      kit: matte({ vertexColors: true }),
      canvas: lite ? matte({ color: "#aeb4bd" }) : matte({ map: canvasTexture(), roughness: 0.92 }),
      // status lamps glow softly (unlit colour, tone-mapped: no bloom blow-out)
      lamp: new THREE.MeshBasicMaterial({ color: "#ffffff" }),
      board: new THREE.MeshBasicMaterial({ map: showBoards ? numberAtlas() : null, toneMapped: true }),
      stool: matte({ vertexColors: true, roughness: 0.7 }),
    };
    // the board picks its number cell from a per-instance uv offset
    mats.board.customProgramCacheKey = () => "gk-ring-board";
    mats.board.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec2 aCell;").replace("#include <uv_vertex>", `#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv * ${(1 / ATLAS).toFixed(5)} + aCell;\n#endif`);
    };
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, n: number, name: string) => {
      const im = new THREE.InstancedMesh(g, m, n);
      im.name = name;
      im.count = 0;
      im.frustumCulled = false; // culled per ring before the buffers are filled
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return im;
    };
    const meshes = {
      near: mk(near, mats.kit, cap, "ring-near"),
      far: mk(far, mats.kit, cap, "ring-far"),
      canvas: mk(canvas, mats.canvas, cap, "ring-canvas"),
      lamp: mk(lamp, mats.lamp, cap, "ring-lamp"),
      board: mk(board, mats.board, cap, "ring-board"),
      stool: mk(stool, mats.stool, cap * 2, "ring-stools"),
    };
    meshes.lamp.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    meshes.stool.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 6), 3);
    board.setAttribute("aCell", new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2));
    meshes.near.castShadow = shadows;
    meshes.stool.castShadow = shadows;
    for (const k of ["near", "far", "canvas", "stool"] as const) meshes[k].receiveShadow = true;
    const extras = featureRing && !lite ? new THREE.Mesh(featureExtrasGeometry(), mats.kit) : null;
    if (extras) extras.name = "ring-feature-extras";
    const tris = { near: triangles(near), far: triangles(far), canvas: triangles(canvas), lamp: triangles(lamp), board: triangles(board), stool: triangles(stool), extras: extras ? triangles(extras.geometry) : 0 };
    return { meshes, mats, extras, tris, geos: [near, far, canvas, lamp, board, stool] };
  }, [cap, lite, showBoards, shadows, featureRing]);
  useEffect(
    () => () => {
      res.geos.forEach((g) => g.dispose());
      res.extras?.geometry.dispose();
      Object.values(res.mats).forEach((m) => {
        (m as THREE.MeshStandardMaterial).map?.dispose();
        m.dispose();
      });
      Object.values(res.meshes).forEach((m) => m.dispose());
    },
    [res],
  );

  const state = useRef({ lods: [] as RingLod[], prev: null as RingLod[] | null, sig: NaN });
  const feature = rings.find((r) => r.id === featureRing) ?? null;

  useFrame(({ camera }) => {
    const st = state.current;
    camera.updateMatrixWorld();
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);
    const cam = camera.getWorldPosition(_p);
    const lods = selectLods(
      rings,
      { x: cam.x, y: cam.y, z: cam.z },
      LOD_BY_TIER[tier],
      (r) => _frustum.intersectsSphere(_sphere.set(_sphere.center.set(r.x, RING.deck + 0.6, r.z), RING.radius)),
      st.prev,
      featureRing,
      st.lods,
    );
    st.prev = lods.slice();
    // rewrite the buffers only when something changed (levels, status, rest, transforms)
    let sig = rings.length;
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i]!;
      const v = (lods[i] === "near" ? 1 : lods[i] === "far" ? 2 : 3) + 4 * (r.status.charCodeAt(0) + (r.rest ? 512 : 0)) + Math.round(r.x * 100) * 7919 + Math.round(r.z * 100) * 104729 + Math.round(r.rotY * 1000) * 15485863;
      sig = (Math.imul(sig ^ v, 2654435761) + i) | 0;
    }
    if (sig === st.sig) return;
    st.sig = sig;
    const M = res.meshes;
    let nn = 0,
      nf = 0,
      nv = 0,
      ns = 0;
    const cell = M.board.geometry.getAttribute("aCell") as THREE.InstancedBufferAttribute;
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i]!;
      const lod = lods[i]!;
      if (lod === "culled") continue;
      _q.setFromAxisAngle(UP, r.rotY);
      _m.compose(_p.set(r.x, 0, r.z), _q, _s);
      if (lod === "near") M.near.setMatrixAt(nn++, _m);
      else M.far.setMatrixAt(nf++, _m);
      M.canvas.setMatrixAt(nv, _m);
      M.lamp.setMatrixAt(nv, _m);
      M.lamp.setColorAt(nv, _c.set(STATUS_COLORS[r.status]));
      M.board.setMatrixAt(nv, _m);
      const num = Math.max(1, Math.min(ATLAS * ATLAS, r.number ?? i + 1)) - 1;
      // atlas rows run top → bottom in the canvas, uv v runs bottom → top
      cell.setXY(nv, (num % ATLAS) / ATLAS, 1 - (Math.floor(num / ATLAS) + 1) / ATLAS);
      nv++;
      if (lod === "near") {
        for (const c of ["red", "blue"] as const) {
          const s = r.rest ? stoolSpot(r, c) : stoolParked(r, c);
          _q.setFromAxisAngle(UP, s.yaw);
          _m.compose(_p.set(s.x, s.y, s.z), _q, _s);
          M.stool.setMatrixAt(ns, _m);
          M.stool.setColorAt(ns, _c.set(c === "red" ? "#b3242b" : "#1f4fb0"));
          ns++;
        }
      }
    }
    M.near.count = nn;
    M.far.count = nf;
    M.canvas.count = nv;
    M.lamp.count = nv;
    M.board.count = showBoards ? nv : 0;
    M.stool.count = ns;
    for (const m of Object.values(M)) {
      m.visible = m.count > 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    cell.needsUpdate = true;
    if (statsRef) {
      const t = res.tris;
      const featureOn = !!res.extras && !!feature && lods[rings.indexOf(feature)] !== "culled";
      statsRef.current = {
        near: nn,
        far: nf,
        culled: rings.length - nv,
        drawCalls: ringDrawCalls(tier, { anyNear: nn > 0, anyFar: nf > 0, feature: featureOn, boards: showBoards, shadows }),
        triangles: nn * t.near + nf * t.far + nv * (t.canvas + t.lamp + (showBoards ? t.board : 0)) + ns * t.stool + (featureOn ? t.extras : 0),
      };
    }
  });

  return (
    <group name="ring-kit" userData={{ noMerge: true }}>
      <primitive object={res.meshes.near} />
      <primitive object={res.meshes.far} />
      <primitive object={res.meshes.canvas} />
      <primitive object={res.meshes.lamp} />
      {showBoards && <primitive object={res.meshes.board} />}
      <primitive object={res.meshes.stool} />
      {res.extras && feature && <primitive object={res.extras} position={[feature.x, 0, feature.z]} rotation={[0, feature.rotY, 0]} />}
    </group>
  );
}

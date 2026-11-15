import * as THREE from "three";

/**
 * Ring kit body fit (P3-FGT-07). The Rocketbox bodies have their everyday clothes modelled into the mesh (hoodie,
 * blazer, baggy trousers) and the look shader only recolours them, so a boxer "in kit" used to show a hoodie in the
 * corner colour, skin-coloured baggy trousers under the trunks and hoodie sleeves. For the ring the body's own
 * geometry is refitted, per body model, once (cached by the source geometry):
 *  - legs: thigh / calf vertices are pulled onto an athletic leg profile round the bone axis (bare legs under the
 *    trunks, the boots fit the leg);
 *  - arms: the sleeves are pulled onto the arm profile and take the skin of the hand (UV remap): a sleeveless singlet;
 *  - the torso loses the garment bulk (hood, pockets, lapels) round the spine axis: a fitted vest.
 * Weighted by how much each vertex belongs to the limb, so the joints (hips, shoulders) blend smoothly. Pure geometry
 * maths, deterministic; the profile functions are unit-tested.
 */

/** athletic radius (m, reference body) along a limb segment at t (0 = the proximal joint … 1 = the distal one) */
export function limbRadius(seg: "thigh" | "calf" | "upperArm" | "foreArm", t: number): number {
  const u = Math.min(1, Math.max(0, t));
  switch (seg) {
    case "thigh":
      return 0.088 - 0.03 * u;
    case "calf":
      // the calf muscle bulges a quarter of the way down, the ankle is slim
      return u < 0.3 ? 0.054 + 0.006 * (u / 0.3) : 0.06 - 0.022 * ((u - 0.3) / 0.7);
    case "upperArm":
      return 0.05 - 0.008 * u;
    case "foreArm":
      return 0.043 - 0.013 * u;
  }
}

/**
 * The fitted radial distance: anything wider than the profile is pulled in (a little of the garment's own shape is
 * kept so the silhouette is not a tube); anything already slimmer stays.
 */
export function fitRadius(r: number, target: number, keep = 0.18): number {
  return r <= target ? r : target + (r - target) * keep;
}

const SEGMENTS: { seg: Parameters<typeof limbRadius>[0]; a: string; b: string; arm: boolean }[] = [
  { seg: "thigh", a: "Bip01_L_Thigh", b: "Bip01_L_Calf", arm: false },
  { seg: "thigh", a: "Bip01_R_Thigh", b: "Bip01_R_Calf", arm: false },
  { seg: "calf", a: "Bip01_L_Calf", b: "Bip01_L_Foot", arm: false },
  { seg: "calf", a: "Bip01_R_Calf", b: "Bip01_R_Foot", arm: false },
  { seg: "upperArm", a: "Bip01_L_UpperArm", b: "Bip01_L_Forearm", arm: true },
  { seg: "upperArm", a: "Bip01_R_UpperArm", b: "Bip01_R_Forearm", arm: true },
  { seg: "foreArm", a: "Bip01_L_Forearm", b: "Bip01_L_Hand", arm: true },
  { seg: "foreArm", a: "Bip01_R_Forearm", b: "Bip01_R_Hand", arm: true },
];
const TORSO = ["Bip01_Spine", "Bip01_Spine1", "Bip01_Spine2", "Bip01_Neck"];

/** "boxer": athletic legs, bare arms, fitted vest; "official" (the referee): only the garment bulk / hood trimmed */
export type FitMode = "boxer" | "official";
const caches: Record<FitMode, WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>> = { boxer: new WeakMap(), official: new WeakMap() };
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Read the body's recolour mask (R skin · G top · B bottom) on the CPU: (u, v) → [r, g, b] 0..1, or null when the
 * image is not drawable here (tests, workers). Drawn once into a small canvas per texture.
 */
const maskPixels = new WeakMap<object, { w: number; h: number; d: Uint8ClampedArray } | null>();
function maskReader(mat: THREE.Material): ((u: number, v: number) => [number, number, number]) | null {
  const tex = (mat.userData.gkUniforms as { uMask?: { value: THREE.Texture | null } } | undefined)?.uMask?.value;
  const img = tex?.image as CanvasImageSource | undefined;
  if (!tex || !img || typeof document === "undefined") return null;
  let px = maskPixels.get(tex);
  if (px === undefined) {
    px = null;
    try {
      const w = 128,
        h = 128;
      const cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h);
        px = { w, h, d: ctx.getImageData(0, 0, w, h).data };
      }
    } catch {
      px = null;
    }
    maskPixels.set(tex, px);
  }
  if (!px) return null;
  const P = px;
  const flip = tex.flipY;
  return (u, v) => {
    const x = Math.min(P.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * P.w)));
    const vv = v - Math.floor(v);
    const y = Math.min(P.h - 1, Math.max(0, Math.floor((flip ? 1 - vv : vv) * P.h)));
    const i = (y * P.w + x) * 4;
    return [P.d[i]! / 255, P.d[i + 1]! / 255, P.d[i + 2]! / 255];
  };
}

/** the refitted geometry for one body mesh (cached per source geometry; never dispose the result) */
export function kitFitGeometry(mesh: THREE.SkinnedMesh, mode: FitMode = "boxer"): THREE.BufferGeometry {
  const cache = caches[mode];
  const src = mesh.geometry;
  const hit = cache.get(src);
  if (hit) return hit;
  const g = src.clone();
  g.userData = { ...src.userData, gkShared: true, gkKitFit: true };
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const uv = g.getAttribute("uv") as THREE.BufferAttribute | undefined;
  const si = g.getAttribute("skinIndex") as THREE.BufferAttribute;
  const sw = g.getAttribute("skinWeight") as THREE.BufferAttribute;
  const bones = mesh.skeleton.bones;
  // bone positions in the mesh's bind space
  const bindPos = (name: string): THREE.Vector3 | null => {
    const i = bones.findIndex((b) => b.name === name);
    if (i < 0) return null;
    const m = new THREE.Matrix4().copy(mesh.skeleton.boneInverses[i]!).invert().premultiply(new THREE.Matrix4().copy(mesh.bindMatrix).invert());
    return new THREE.Vector3().setFromMatrixPosition(m);
  };
  const idx = (name: string) => bones.findIndex((b) => b.name === name);
  // mesh units per metre (the Rocketbox meshes may be authored in cm): from the leg length
  const hip = bindPos("Bip01_L_Thigh");
  const knee = bindPos("Bip01_L_Calf");
  const unit = hip && knee ? hip.distanceTo(knee) / 0.43 : 1;
  const segs = SEGMENTS.map((s) => ({ ...s, A: bindPos(s.a), B: bindPos(s.b), ia: idx(s.a) })).filter((s) => s.A && s.B && s.ia >= 0) as (typeof SEGMENTS[number] & { A: THREE.Vector3; B: THREE.Vector3; ia: number })[];
  const segOf = new Map<number, (typeof segs)[number]>();
  for (const s of segs) segOf.set(s.ia, s);
  const armBones = new Set(segs.filter((s) => s.arm).map((s) => s.ia));
  const legBones = new Set(segs.filter((s) => !s.arm).map((s) => s.ia));
  const torso = new Set(TORSO.map(idx).filter((i) => i >= 0));
  // the skin UV for the bare arms: a real finger vertex of each hand (fingers are always bare skin; a hand-weighted
  // vertex can be a sleeve cuff), the one nearest the fingers' mean UV (a mean of separate islands could land on cloth)
  const fingers = { L: new Set<number>(), R: new Set<number>() };
  bones.forEach((b, i) => {
    if (b.name.startsWith("Bip01_L_Finger")) fingers.L.add(i);
    else if (b.name.startsWith("Bip01_R_Finger")) fingers.R.add(i);
  });
  const n = pos.count;
  const dom = new Int16Array(n);
  const domW = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let best = -1,
      bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w > bw) {
        bw = w;
        best = si.getComponent(i, k);
      }
    }
    dom[i] = best;
    domW[i] = bw;
  }
  const skinUv: Record<"L" | "R", [number, number] | null> = { L: null, R: null };
  const mask = maskReader(mesh.material as THREE.Material);
  if (uv)
    for (const side of ["L", "R"] as const) {
      let su = 0,
        sv = 0,
        sn = 0;
      for (let i = 0; i < n; i++)
        if (fingers[side].has(dom[i]!) && domW[i]! > 0.8) {
          su += uv.getX(i);
          sv += uv.getY(i);
          sn++;
        }
      if (!sn) continue;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        if (!fingers[side].has(dom[i]!) || domW[i]! <= 0.8) continue;
        // with the recolour mask readable: the most certainly-skin texel among the hand's vertices wins
        const m = mask?.(uv.getX(i), uv.getY(i));
        const d = m ? -(m[0] - m[1] - m[2]) : (uv.getX(i) - su / sn) ** 2 + (uv.getY(i) - sv / sn) ** 2;
        if (d < bd) {
          bd = d;
          skinUv[side] = [uv.getX(i), uv.getY(i)];
        }
      }
    }
  // torso axis (bind space): from the pelvis up through the neck; the garment bulk is trimmed round it
  const sp0 = bindPos("Bip01_Spine");
  const neck = bindPos("Bip01_Neck");
  const headIdx = idx("Bip01_Head");
  const p = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    let limbW = 0,
      armW = 0,
      torsoW = 0;
    for (let k = 0; k < 4; k++) {
      const b = si.getComponent(i, k);
      const w = sw.getComponent(i, k);
      if (armBones.has(b)) armW += w;
      if (legBones.has(b) || armBones.has(b)) limbW += w;
      if (torso.has(b)) torsoW += w;
    }
    const s = segOf.get(dom[i]!);
    if (s && limbW > 0.4 && mode === "boxer") {
      ab.subVectors(s.B, s.A);
      const L2 = ab.lengthSq() || 1;
      const t = Math.min(1, Math.max(0, c.subVectors(p, s.A).dot(ab) / L2));
      c.copy(s.A).addScaledVector(ab, t);
      const d = p.clone().sub(c);
      const r = d.length() / unit;
      const r2 = fitRadius(r, limbRadius(s.seg, t));
      const k = smooth(0.4, 0.85, limbW);
      if (r > 1e-5) p.copy(c).addScaledVector(d, ((r + (r2 - r) * k) / r));
      pos.setXYZ(i, p.x, p.y, p.z);
      // bare arms: the sleeve takes the hand's skin
      const su = skinUv[s.a.includes("_L_") ? "L" : "R"];
      if (s.arm && su && uv && armW > 0.3) uv.setXY(i, su[0], su[1]);
    } else if (sp0 && neck && torsoW > 0.5) {
      // fitted vest: the chest / back garment bulk comes in towards the spine (the hood folds down to the collar)
      ab.subVectors(neck, sp0);
      const L2 = ab.lengthSq() || 1;
      const t = c.subVectors(p, sp0).dot(ab) / L2;
      c.copy(sp0).addScaledVector(ab, Math.min(1.15, Math.max(0, t)));
      const d = p.clone().sub(c);
      const k = (mode === "boxer" ? 0.9 : 0.95) - 0.12 * smooth(0.75, 1.15, t);
      p.copy(c).addScaledVector(d, 1 + (k - 1) * smooth(0.5, 0.9, torsoW));
      // the hood: anything above the neck base and behind the neck drops down onto the shoulders
      if (t > 1.0) p.addScaledVector(ab, -(t - 1.0) * 0.6);
      pos.setXYZ(i, p.x, p.y, p.z);
    } else if (neck && dom[i] === headIdx) {
      // body-mesh vertices that follow the head are the hood / a high collar (the head itself is its own mesh): they
      // fold down into a low collar round the neck base
      p.sub(neck).multiplyScalar(0.4).add(neck);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
  }
  if (process.env.NODE_ENV !== "production") {
    // (lab readout: how this body's vertices are weighted, which UV the arms took)
    const byBone: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const nm = bones[dom[i]!]?.name ?? "?";
      byBone[nm] = (byBone[nm] ?? 0) + 1;
    }
    g.userData.gkFitStats = { byBone, skinUv, unit, n, maskAt: { L: skinUv.L && mask?.(...skinUv.L), R: skinUv.R && mask?.(...skinUv.R) } };
  }
  pos.needsUpdate = true;
  if (uv) uv.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  cache.set(src, g);
  return g;
}

/**
 * Refit every body mesh of a person (full + far LOD) for the ring kit; returns the undo (the everyday geometry back).
 * Must run before anything is fitted to the body surface (trunks, boot shafts).
 */
export function fitBodyForKit(root: THREE.Object3D, mode: FitMode = "boxer"): () => void {
  const swaps: { mesh: THREE.SkinnedMesh; prev: THREE.BufferGeometry }[] = [];
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || (m.material as THREE.Material)?.name !== "body") return;
    if (!m.skeleton.bones.some((b) => b.name === "Bip01_L_Calf")) return;
    if (m.geometry.userData.gkKitFit) return;
    swaps.push({ mesh: m, prev: m.geometry });
    m.geometry = kitFitGeometry(m, mode);
  });
  return () => {
    for (const s of swaps) s.mesh.geometry = s.prev;
  };
}

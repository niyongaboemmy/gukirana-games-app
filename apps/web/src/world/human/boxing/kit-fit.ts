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
      // quads: full at the top third, tapering into the knee
      return u < 0.25 ? 0.09 + 0.006 * (u / 0.25) : 0.096 - 0.036 * ((u - 0.25) / 0.75);
    case "calf":
      // the calf muscle bulges a quarter of the way down, the ankle is slim
      return u < 0.3 ? 0.056 + 0.009 * (u / 0.3) : 0.065 - 0.026 * ((u - 0.3) / 0.7);
    case "upperArm":
      // deltoid cap at the shoulder, biceps / triceps belly, slimmer above the elbow
      return u < 0.2 ? 0.06 - 0.004 * (u / 0.2) : u < 0.6 ? 0.056 - 0.004 * ((u - 0.2) / 0.4) : 0.052 - 0.012 * ((u - 0.6) / 0.4);
    case "foreArm":
      // full just below the elbow, slim wrist
      return u < 0.25 ? 0.044 + 0.004 * (u / 0.25) : 0.048 - 0.02 * ((u - 0.25) / 0.75);
  }
}

/**
 * The fitted radial distance: anything wider than the profile is pulled in (a little of the garment's own shape is
 * kept so the silhouette is not a tube); anything already slimmer stays.
 */
export function fitRadius(r: number, target: number, keep = 0.18): number {
  return r <= target ? r : target + (r - target) * keep;
}

/**
 * The athlete's sculpt (P3-FGT-09): like fitRadius, but a limb thinner than the profile also grows most of the way to
 * it (the plaza bodies are slim; a boxer's arms and legs carry muscle). `grow` 0 = fitRadius.
 */
export function sculptRadius(r: number, target: number, grow = 0.75, keep = 0.18): number {
  return r <= target ? r + (target - r) * grow : target + (r - target) * keep;
}

/**
 * Torso shape factors for the boxer's V-taper (P3-FGT-09) at t along the spine axis (0 = Spine … 1 = Neck): `side` =
 * scale of the across-the-body distance (broad back / lats up top, a narrow waist), `front` = front-back depth (chest
 * up top, a flat stomach). Feminine builds keep the chest depth (no added bust) and take a softer taper.
 */
export function torsoShape(t: number, build: "masculine" | "feminine" | "neutral" = "masculine"): { side: number; front: number } {
  const fem = build === "feminine";
  const u = Math.min(1.15, Math.max(0, t));
  const waist = 1 - smoothstep01(0.05, 0.3, u) * (1 - smoothstep01(0.35, 0.6, u));
  const chest = smoothstep01(0.45, 0.8, u) * (1 - smoothstep01(1.0, 1.15, u));
  const side = 1 - (fem ? 0.06 : 0.09) * waist + (fem ? 0.05 : 0.12) * chest;
  const front = 1 - (fem ? 0.08 : 0.1) * waist + (fem ? 0 : 0.05) * chest;
  return { side, front };
}
function smoothstep01(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** build scale of the limb profile: the feminine body is smaller-framed (still athletic) */
export const buildScale = (build: "masculine" | "feminine" | "neutral"): number => (build === "feminine" ? 0.86 : build === "neutral" ? 0.94 : 1);

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
export function kitFitGeometry(mesh: THREE.SkinnedMesh, mode: FitMode = "boxer", build: "masculine" | "feminine" | "neutral" = "masculine"): THREE.BufferGeometry {
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
  // body axes (bind space): across the body (right → left shoulder) and forward (heel → toe), for the V-taper
  const shL = bindPos("Bip01_L_UpperArm");
  const shR = bindPos("Bip01_R_UpperArm");
  const lat = shL && shR ? shL.clone().sub(shR).normalize() : null;
  const footL = bindPos("Bip01_L_Foot");
  const toeL = bindPos("Bip01_L_Toe0");
  const up = sp0 && neck ? neck.clone().sub(sp0).normalize() : null;
  const fwd = footL && toeL && up ? toeL.clone().sub(footL) : null;
  if (fwd && up) fwd.addScaledVector(up, -fwd.dot(up)).normalize();
  const clav = new Map<number, number>();
  for (const [nm, sg] of [["Bip01_L_Clavicle", 1], ["Bip01_R_Clavicle", -1]] as const) {
    const i = idx(nm);
    if (i >= 0) clav.set(i, sg);
  }
  const scale = mode === "boxer" ? buildScale(build) : 1;
  const p = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    let limbW = 0,
      torsoW = 0;
    for (let k = 0; k < 4; k++) {
      const b = si.getComponent(i, k);
      const w = sw.getComponent(i, k);
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
      const r2 = sculptRadius(r, limbRadius(s.seg, t) * scale, s.arm ? 0.8 : 0.7);
      const k = smooth(0.4, 0.85, limbW);
      if (r > 1e-5) p.copy(c).addScaledVector(d, ((r + (r2 - r) * k) / r));
      pos.setXYZ(i, p.x, p.y, p.z);
      // (bare arms: the sleeve takes the hand's skin — per triangle, after this loop)
    } else if (sp0 && neck && torsoW > 0.5) {
      // fitted vest: the chest / back garment bulk comes in towards the spine (the hood folds down to the collar)
      ab.subVectors(neck, sp0);
      const L2 = ab.lengthSq() || 1;
      const t = c.subVectors(p, sp0).dot(ab) / L2;
      c.copy(sp0).addScaledVector(ab, Math.min(1.15, Math.max(0, t)));
      const d = p.clone().sub(c);
      const k = (mode === "boxer" ? 0.9 : 0.95) - 0.12 * smooth(0.75, 1.15, t);
      const wT = smooth(0.5, 0.9, torsoW);
      if (mode === "boxer" && lat && fwd) {
        // the V-taper (P3-FGT-09): broad across the lats / chest, a narrow waist, a flat stomach; the garment bulk
        // comes off the back and front (k) but not the sides, so the frame reads athletic, not skinny
        const sh = torsoShape(t, build);
        const dl = d.dot(lat);
        const df = d.dot(fwd);
        const du = d.clone().addScaledVector(lat, -dl).addScaledVector(fwd, -df);
        const back = df < 0 ? k : Math.min(1, k + 0.05);
        let nl = dl * (1 + (sh.side * Math.min(1, k + 0.08) - 1) * wT);
        let nf = df * (1 + (sh.front * back - 1) * wT);
        // the hood / high collar behind the neck: flattened onto the upper back (no lump)
        if (t > 0.78 && df < 0) nf = Math.max(nf, -0.1 * unit * (1 - 0.35 * smooth(0.78, 1.1, t)));
        if (t > 0.95) nl *= 1 - 0.25 * smooth(0.95, 1.15, t);
        p.copy(c).add(du).addScaledVector(lat, nl).addScaledVector(fwd, nf);
      } else p.copy(c).addScaledVector(d, 1 + (k - 1) * wT);
      // the hood: anything above the neck base and behind the neck drops down onto the shoulders
      if (t > 1.0) p.addScaledVector(ab, -(t - 1.0) * 0.6);
      pos.setXYZ(i, p.x, p.y, p.z);
    } else if (mode === "boxer" && lat && clav.has(dom[i]!) && domW[i]! > 0.4) {
      // broad shoulders: the clavicle region out towards the deltoid cap and up a touch (the trapezius)
      const sg = clav.get(dom[i]!)!;
      const w = smooth(0.4, 0.9, domW[i]!);
      p.addScaledVector(lat, sg * 0.016 * unit * scale * w);
      if (up) p.addScaledVector(up, 0.006 * unit * w);
      pos.setXYZ(i, p.x, p.y, p.z);
    } else if (neck && dom[i] === headIdx) {
      // body-mesh vertices that follow the head are the hood / a high collar (the head itself is its own mesh): they
      // fold down into a low collar round the neck base
      p.sub(neck).multiplyScalar(mode === "boxer" ? 0.25 : 0.4).add(neck);
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
  // normals before the armhole split: a split vertex keeps the smooth normal (no lighting seam at the cut)
  g.computeVertexNormals();
  const out = mode === "boxer" && uv ? bareArms(g, si, sw, bones.map((b) => b.name), skinUv) : g;
  if (out !== g) {
    out.userData = g.userData;
    g.dispose();
  }
  out.computeBoundingSphere();
  cache.set(src, out);
  return out;
}

/**
 * Bare arms, cut like a vest armhole (P3-FGT-09). Re-mapping single vertices to the hand's skin texel made every
 * triangle that spans the shoulder interpolate its UV across the whole atlas (streaks of shirt print and red on the
 * upper arm). Instead each TRIANGLE is classed: mostly arm-weighted = skin (all three corners take the skin texel of
 * that arm), else garment (its corners keep their own UV). A vertex shared by both kinds is split in two (every
 * attribute copied), so the armhole is a clean edge on the triangle borders.
 */
function bareArms(g: THREE.BufferGeometry, si: THREE.BufferAttribute, sw: THREE.BufferAttribute, names: string[], skinUv: Record<"L" | "R", [number, number] | null>): THREE.BufferGeometry {
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  const n = uv.count;
  const armL = new Float32Array(n);
  const armR = new Float32Array(n);
  const isArm = names.map((nm) => (/_(UpperArm|Forearm|Hand|Finger)/.test(nm) ? (nm.includes("_L_") ? 1 : 2) : 0));
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 4; k++) {
      const a = isArm[si.getComponent(i, k)] ?? 0;
      const w = sw.getComponent(i, k);
      if (a === 1) armL[i]! += w;
      else if (a === 2) armR[i]! += w;
    }
  const index = g.index ? Array.from(g.index.array) : Array.from({ length: n }, (_, i) => i);
  const uvOut: number[] = Array.from(uv.array as ArrayLike<number>);
  /** v → which uv it carries already (0 own, 1 skin L, 2 skin R) */
  const kindOf = new Int8Array(n).fill(-1);
  const dup = new Map<string, number>();
  const copies: number[] = []; // source vertex of each new vertex
  for (let t = 0; t + 2 < index.length; t += 3) {
    let l = 0,
      r = 0;
    for (let c = 0; c < 3; c++) {
      l += armL[index[t + c]!]!;
      r += armR[index[t + c]!]!;
    }
    const skin = (l + r) / 3 >= 0.45;
    const side = l >= r ? 1 : 2;
    const su = skinUv[side === 1 ? "L" : "R"];
    const kind = skin && su ? side : 0;
    for (let c = 0; c < 3; c++) {
      const v = index[t + c]!;
      if (kindOf[v] === -1 || kindOf[v] === kind) {
        if (kindOf[v] === -1) {
          kindOf[v] = kind;
          if (kind) {
            uvOut[v * 2] = su![0];
            uvOut[v * 2 + 1] = su![1];
          }
        }
        continue;
      }
      const key = `${v}:${kind}`;
      let nv = dup.get(key);
      if (nv === undefined) {
        nv = n + copies.length;
        copies.push(v);
        dup.set(key, nv);
        const src = uv.array as ArrayLike<number>;
        uvOut.push(kind ? su![0] : src[v * 2]!, kind ? su![1] : src[v * 2 + 1]!);
      }
      index[t + c] = nv;
    }
  }
  if (!copies.length && !g.index) {
    uv.copyArray(uvOut);
    uv.needsUpdate = true;
    return g;
  }
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes) as [string, THREE.BufferAttribute][]) {
    if (name === "uv") {
      out.setAttribute("uv", new THREE.Float32BufferAttribute(uvOut, 2));
      continue;
    }
    out.setAttribute(name, extend(attr, copies));
  }
  const morph = out.morphAttributes as Record<string, THREE.BufferAttribute[]>;
  for (const [name, list] of Object.entries(g.morphAttributes) as [string, THREE.BufferAttribute[]][]) morph[name] = list.map((a) => extend(a, copies));
  out.morphTargetsRelative = g.morphTargetsRelative;
  out.setIndex(index);
  for (const gr of g.groups) out.addGroup(gr.start, gr.count, gr.materialIndex);
  return out;
}
function extend(attr: THREE.BufferAttribute, copies: number[]): THREE.BufferAttribute {
  const s = attr.itemSize;
  const src = attr.array as unknown as ArrayLike<number> & { constructor: new (n: number) => THREE.TypedArray };
  const arr = new src.constructor((attr.count + copies.length) * s);
  arr.set(src as unknown as ArrayLike<number>);
  copies.forEach((v, j) => {
    for (let k = 0; k < s; k++) arr[(attr.count + j) * s + k] = src[v * s + k]!;
  });
  return new THREE.BufferAttribute(arr, s, attr.normalized);
}


/**
 * Refit every body mesh of a person (full + far LOD) for the ring kit; returns the undo (the everyday geometry back).
 * Must run before anything is fitted to the body surface (trunks, boot shafts).
 */
export function fitBodyForKit(root: THREE.Object3D, mode: FitMode = "boxer", build: "masculine" | "feminine" | "neutral" = "masculine"): () => void {
  const swaps: { mesh: THREE.SkinnedMesh; prev: THREE.BufferGeometry }[] = [];
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || (m.material as THREE.Material)?.name !== "body") return;
    if (!m.skeleton.bones.some((b) => b.name === "Bip01_L_Calf")) return;
    if (m.geometry.userData.gkKitFit) return;
    swaps.push({ mesh: m, prev: m.geometry });
    m.geometry = kitFitGeometry(m, mode, build);
  });
  return () => {
    for (const s of swaps) s.mesh.geometry = s.prev;
  };
}

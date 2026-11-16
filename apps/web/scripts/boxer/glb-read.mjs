// P3-FGT-19B: read a ring-people GLB back (the inverse of glb.mjs) for the audits that run on the shipped file rather
// than inside the build: proportions (measure.mjs) and the per-fighter triangle count of the fighter-v8 harness
// (qa/e2e/fighter-v8). Handles what glb.mjs writes (and plain glTF 2.0 GLBs): float / normalised integer accessors,
// one primitive per mesh, one skin.
import { readFileSync } from "node:fs";

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

/** parse a GLB buffer → { json, bin, accessor(i, { float }) } */
export function parseGlb(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("glb: bad magic");
  let off = 12,
    json = null,
    bin = null;
  while (off < u8.byteLength) {
    const len = dv.getUint32(off, true),
      type = dv.getUint32(off + 4, true);
    const body = u8.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === 0x004e4942) bin = body;
    off += 8 + len;
  }
  if (!json) throw new Error("glb: no JSON chunk");
  const accessor = (i, { float = true } = {}) => {
    const a = json.accessors[i];
    const C = COMP[a.componentType];
    const n = a.count * SIZE[a.type];
    let out;
    if (a.bufferView === undefined) out = new C(n);
    else {
      const bv = json.bufferViews[a.bufferView];
      const start = bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
      // (copy: the views may not be aligned for the type)
      out = new C(bin.buffer.slice(start, start + n * C.BYTES_PER_ELEMENT));
    }
    if (a.sparse) {
      const iv = json.bufferViews[a.sparse.indices.bufferView],
        vv = json.bufferViews[a.sparse.values.bufferView];
      const IC = COMP[a.sparse.indices.componentType];
      const idx = new IC(bin.buffer.slice(bin.byteOffset + (iv.byteOffset ?? 0), bin.byteOffset + (iv.byteOffset ?? 0) + a.sparse.count * IC.BYTES_PER_ELEMENT));
      const k = SIZE[a.type];
      const vals = new C(bin.buffer.slice(bin.byteOffset + (vv.byteOffset ?? 0), bin.byteOffset + (vv.byteOffset ?? 0) + a.sparse.count * k * C.BYTES_PER_ELEMENT));
      for (let s = 0; s < idx.length; s++) for (let q = 0; q < k; q++) out[idx[s] * k + q] = vals[s * k + q];
    }
    if (float && a.normalized && NORM[a.componentType]) return Float32Array.from(out, (v) => Math.max(-1, v / NORM[a.componentType]));
    return out;
  };
  return { json, bin, accessor };
}

/** invert a rigid column-major 4×4 → its translation (a joint's bind position from its inverse bind matrix) */
export function rigidInverseTranslation(m, o = 0) {
  // m = [R | t]; inverse translation = −Rᵀ t
  const t = [m[o + 12], m[o + 13], m[o + 14]];
  return [-(m[o + 0] * t[0] + m[o + 1] * t[1] + m[o + 2] * t[2]), -(m[o + 4] * t[0] + m[o + 5] * t[1] + m[o + 6] * t[2]), -(m[o + 8] * t[0] + m[o + 9] * t[1] + m[o + 10] * t[2])];
}

/**
 * A boxer GLB as plain arrays → { meshes: Map(name → { P, index, J, W, attrs }), joints: [{ name, pos }], extras }.
 * Morph targets are left out (the base body type).
 */
export function readBoxerGlb(path) {
  const { json, accessor } = parseGlb(readFileSync(path));
  const skin = json.skins?.[0];
  const ibm = skin ? accessor(skin.inverseBindMatrices) : null;
  const joints = skin ? skin.joints.map((n, k) => ({ name: json.nodes[n].name, pos: rigidInverseTranslation(ibm, k * 16) })) : [];
  const meshes = new Map();
  for (const m of json.meshes) {
    const p = m.primitives[0];
    const attrs = {};
    // (custom attributes as three's GLTFLoader names them: `_MAT` → `_mat`)
    for (const [K, i] of Object.entries(p.attributes)) {
      const k = K.startsWith("_") ? K.toLowerCase() : K;
      attrs[k] = accessor(i, { float: !/^(JOINTS_0|_mat|_cover|_zone)$/.test(k) });
    }
    // morph targets by name (position deltas, metres)
    const morphs = {};
    (p.targets ?? []).forEach((t, k) => {
      const name = m.extras?.targetNames?.[k] ?? `t${k}`;
      if (t.POSITION !== undefined) morphs[name] = accessor(t.POSITION);
    });
    meshes.set(m.name, { P: attrs.POSITION, index: p.indices !== undefined ? accessor(p.indices, { float: false }) : null, J: attrs.JOINTS_0 ?? null, W: attrs.WEIGHTS_0 ?? null, attrs, morphs });
  }
  return { meshes, joints, extras: json.scenes?.[json.scene ?? 0]?.extras ?? {}, json };
}

/** body cover bits (build.mjs COVER) and the boxer outfit (boxer-body.ts OUTFIT_MESHES.boxer) */
export const COVER = { vest: 1, trunks: 2, boots: 4, gloves: 8, headgear: 16, vestCore: 1024 };
export const BOXER_MESHES = ["body", "kit_vest", "kit_trunks", "kit_boots", "kit_socks", "kit_gloves", "kit_headgear", "kit_wraps"];

/**
 * The triangles one fighter in kit draws (LOD0): the body faces the kit does not cover (the runtime's cull in
 * boxer-body.ts makeBoxer) plus every kit mesh → { total, byMesh }.
 */
export function fighterTriangles(glb, { headgear = true, meshes = BOXER_MESHES } = {}) {
  const cover = COVER.vest | COVER.trunks | COVER.boots | COVER.gloves | (headgear ? COVER.headgear : 0);
  const byMesh = {};
  let total = 0;
  for (const name of meshes) {
    if (!headgear && name === "kit_headgear") continue;
    const m = glb.meshes.get(name);
    if (!m) continue;
    let n = m.index.length / 3;
    const cov = m.attrs._cover;
    if (name === "body" && cov) {
      n = 0;
      for (let t = 0; t < m.index.length; t += 3) {
        const ca = cov[m.index[t]],
          cb = cov[m.index[t + 1]],
          cc = cov[m.index[t + 2]];
        if (ca & cb & cc & cover) continue;
        if (((ca & cb) | (cb & cc) | (ca & cc)) & COVER.vestCore) continue;
        n++;
      }
    }
    byMesh[name] = n;
    total += n;
  }
  return { total, byMesh };
}

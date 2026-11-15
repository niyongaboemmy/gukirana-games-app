// Minimal glTF 2.0 binary writer for the boxer bodies (P3-FGT-13): one skin, several skinned meshes sharing it,
// float / uint attributes, optional POSITION morph targets. No dependencies.
import { writeFileSync } from "node:fs";

/**
 * @param {string} path
 * @param {{
 *   bones: { name: string, parent: number, pos: number[], rot?: number[] }[],
 *   meshes: { name: string, attrs: Record<string, { data: Float32Array | Uint16Array | Uint8Array, size: number, norm?: boolean }>, index: Uint32Array, morphs?: Float32Array[] }[],
 *   morphNames?: string[],
 *   extras?: object,
 * }} model
 */
export function writeGlb(path, model) {
  const chunks = [];
  let byteLength = 0;
  const bufferViews = [];
  const accessors = [];
  const align = () => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      byteLength += pad;
    }
  };
  const view = (arr, target) => {
    align();
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    chunks.push(buf);
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: buf.length, ...(target ? { target } : {}) });
    byteLength += buf.length;
    return bufferViews.length - 1;
  };
  const TYPES = { 1: "SCALAR", 2: "VEC2", 3: "VEC3", 4: "VEC4", 16: "MAT4" };
  const accessor = (arr, size, { target, norm, minmax } = {}) => {
    const bv = view(arr, target);
    const componentType = arr instanceof Float32Array ? 5126 : arr instanceof Uint32Array ? 5125 : arr instanceof Uint16Array ? 5123 : 5121;
    const acc = { bufferView: bv, componentType, count: arr.length / size, type: TYPES[size], ...(norm ? { normalized: true } : {}) };
    if (minmax) {
      const min = new Array(size).fill(Infinity);
      const max = new Array(size).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) {
        const k = i % size;
        if (arr[i] < min[k]) min[k] = arr[i];
        if (arr[i] > max[k]) max[k] = arr[i];
      }
      acc.min = min;
      acc.max = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };

  // nodes: 0 = scene root "boxer", then the bones, then one node per mesh
  const nodes = [{ name: "boxer", children: [] }];
  const boneNode = (i) => 1 + i;
  model.bones.forEach((b, i) => {
    const parentPos = b.parent >= 0 ? model.bones[b.parent].pos : [0, 0, 0];
    const node = { name: b.name, translation: [b.pos[0] - parentPos[0], b.pos[1] - parentPos[1], b.pos[2] - parentPos[2]] };
    if (b.rot) node.rotation = b.rot;
    nodes.push(node);
  });
  // (bone rotations are only allowed on leaf-ish finger bones whose children are re-expressed below)
  model.bones.forEach((b, i) => {
    if (b.parent >= 0) (nodes[boneNode(b.parent)].children ??= []).push(boneNode(i));
    else nodes[0].children.push(boneNode(i));
  });
  // world matrices of the bones (for the inverse bind matrices)
  const world = model.bones.map(() => null);
  const quatMat = (q) => {
    const [x, y, z, w] = q;
    return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
  };
  const mul = (a, b) => {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  };
  const local = (i) => {
    const n = nodes[boneNode(i)];
    const m = n.rotation ? quatMat(n.rotation) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    m[12] = n.translation[0];
    m[13] = n.translation[1];
    m[14] = n.translation[2];
    return m;
  };
  const getWorld = (i) => {
    if (world[i]) return world[i];
    const b = model.bones[i];
    world[i] = b.parent >= 0 ? mul(getWorld(b.parent), local(i)) : local(i);
    return world[i];
  };
  const invRigid = (m) => {
    // rotation transpose, translation −Rᵀt
    const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
    const t = [m[12], m[13], m[14]];
    r[12] = -(r[0] * t[0] + r[4] * t[1] + r[8] * t[2]);
    r[13] = -(r[1] * t[0] + r[5] * t[1] + r[9] * t[2]);
    r[14] = -(r[2] * t[0] + r[6] * t[1] + r[10] * t[2]);
    return r;
  };
  // re-express children of rotated bones: their translation must be in the parent's rotated frame
  model.bones.forEach((b, i) => {
    if (b.parent < 0 || !nodes[boneNode(b.parent)].rotation) return;
    const pw = getWorld(b.parent);
    const inv = invRigid(pw);
    const p = b.pos;
    nodes[boneNode(i)].translation = [inv[0] * p[0] + inv[4] * p[1] + inv[8] * p[2] + inv[12], inv[1] * p[0] + inv[5] * p[1] + inv[9] * p[2] + inv[13], inv[2] * p[0] + inv[6] * p[1] + inv[10] * p[2] + inv[14]];
    world[i] = null;
  });
  for (let i = 0; i < world.length; i++) world[i] = null;
  const ibm = new Float32Array(model.bones.length * 16);
  model.bones.forEach((_, i) => ibm.set(invRigid(getWorld(i)), i * 16));
  const skin = { joints: model.bones.map((_, i) => boneNode(i)), inverseBindMatrices: accessor(ibm, 16), skeleton: boneNode(0) };

  const meshes = [];
  for (const m of model.meshes) {
    const attributes = {};
    for (const [k, a] of Object.entries(m.attrs)) attributes[k] = accessor(a.data, a.size, { target: 34962, norm: a.norm, minmax: k === "POSITION" });
    const prim = { attributes, indices: accessor(m.index, 1, { target: 34963 }), mode: 4 };
    if (m.morphs?.length) prim.targets = m.morphs.map((d) => ({ POSITION: accessor(d, 3, { target: 34962, minmax: true }) }));
    meshes.push({ name: m.name, primitives: [prim], ...(m.morphs?.length ? { weights: m.morphs.map(() => 0), extras: { targetNames: model.morphNames } } : {}) });
    nodes.push({ name: m.name, mesh: meshes.length - 1, skin: 0 });
    nodes[0].children.push(nodes.length - 1);
  }

  const json = {
    asset: { version: "2.0", generator: "gukirana boxer-body build (P3-FGT-13)", copyright: "Derived from MakeHuman 1.x base mesh, targets, skeleton and weights (CC0 1.0)" },
    scene: 0,
    scenes: [{ nodes: [0], ...(model.extras ? { extras: model.extras } : {}) }],
    nodes,
    meshes,
    skins: [skin],
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };
  align();
  const bin = Buffer.concat(chunks);
  let jsonBuf = Buffer.from(JSON.stringify(json));
  const jpad = (4 - (jsonBuf.length % 4)) % 4;
  if (jpad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jpad, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  writeFileSync(path, Buffer.concat([header, jh, jsonBuf, bh, bin]));
  return 12 + 16 + jsonBuf.length + bin.length;
}

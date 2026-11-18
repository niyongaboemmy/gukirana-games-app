import * as THREE from "three";
import type { BodyType, OutfitItem } from "../outfits";
import { FABRIC, type FabricId } from "./skin/skin-shading";

/**
 * P2-AVA-17: women's tops — real garments instead of the feminine body's baked blazer.
 *
 * Each feminine top kind is its own garment, built offline in Blender (apps/web/scripts/women-tops, README there): cut
 * from the feminine body (its blazer smoothed away), draped with cloth simulation in the relaxed pose (folds under the
 * bust, at the waist and hips, the armpits, the elbows of long sleeves), un-skinned back to the bind pose, 2.5 mm
 * turned hems on every edge, and a baked normal + occlusion map of the folds. The asset (`wt-<kind>.bin` + `.webp`) also
 * carries the skin this top leaves bare (the arms below a short sleeve, the chest under a low neckline, all sunk under
 * the body's own skin where they meet it) and a band of trousers under the hem.
 *
 * At runtime the body geometry is rebuilt once per base geometry and kind (shared by everyone wearing it):
 *  - the blazer goes completely: every body triangle of the mask's top region, its pocket flaps (trousers in the mask),
 *    the trousers' lining round the hips (inward-facing, only ever seen with the jacket on) and the trousers' top
 *    under the garment (above its hem + 1.5 cm: under the jacket it bulged into the jacket's skirt);
 *  - the garment, skin and trouser parts are appended to the SAME geometry (no new draw call, no new material): their
 *    UVs are shifted (garment u + 4, skin u + 6, trousers u + 8) so the body shader tells them apart; the garment's
 *    fold map comes in as one extra texture on the body material (materials.ts uWear / uWearMap).
 * Item ids are unchanged; fabric and print come from the item as before (prints laid in metres, P2-AVA-15).
 */

export type GarmentKind = "tee" | "jersey" | "hoodie" | "track" | "shirt" | "sash";

/** The garment each catalogue top kind wears on the feminine body (the blazer stays the body's own blazer). */
export const GARMENT_OF_KIND: Record<string, GarmentKind | null> = {
  tee: "tee",
  jersey: "jersey",
  hoodie: "hoodie",
  longsleeve: "track",
  shirt: "shirt",
  sash: "sash",
  blazer: null,
};

/** The weave each garment is drawn with (skin-shading.ts FABRIC). */
export const GARMENT_FABRIC: Record<GarmentKind, FabricId> = {
  tee: FABRIC.knit,
  jersey: FABRIC.knit,
  // (a sweat knit: the fleece pile read as speckle at the garment's UV scale)
  hoodie: FABRIC.knit,
  track: FABRIC.knit,
  shirt: FABRIC.cottonTwill,
  sash: FABRIC.cottonTwill,
};

/**
 * Per-item switch: the items whose simulated garment ships (review gate, docs/QA/women-tops/audit.md). Items not
 * listed keep the baked blazer.
 */
export const SHIPPED_TOPS: ReadonlySet<string> = new Set<string>([
  // held at coordinator review (P2-AVA-17): the tee garment ("tee", "tee-white", "imigongo-top") shows ragged
  // neckline/sleeve/hem edges and armpit crumples at full size; re-enable once those are clean
]);

/** Development only: `?wtops=all|none|<item>,<item>` overrides the shipped set (before / after shots). */
function devOverride(): ReadonlySet<string> | "all" | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search).get("wtops");
  if (q === null) return null;
  if (q === "all") return "all";
  return new Set(q === "none" ? [] : q.split(","));
}

/** The garment a top is drawn with on a body, or null for the body's own baked garment. */
export function womenTopFor(item: OutfitItem | undefined, body: BodyType, shipped: ReadonlySet<string> | "all" = devOverride() ?? SHIPPED_TOPS): GarmentKind | null {
  if (!item || item.slot !== "top" || body !== "feminine") return null;
  const kind = GARMENT_OF_KIND[item.kind] ?? null;
  if (!kind) return null;
  return shipped === "all" || shipped.has(item.id) ? kind : null;
}

/* ------------------------------------------------------------------------------------------------- the asset */

/** Parts of an asset: near / far garment, skin, trousers band, sash (sash tops: a band of the second colour). */
export const PART = { garment: 0, garmentFar: 1, skin: 2, skinFar: 3, under: 4, underFar: 5, band: 6, bandFar: 7 } as const;
/** UV offset (u) per part family: the body shader's tag for garment, skin, trousers and sash fragments. */
export const PART_U = { garment: 4, skin: 6, under: 8, band: 10 } as const;

export interface TopPart {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  /** indices into TopAsset.bones */
  joints: Uint8Array;
  weights: Float32Array;
  index: Uint16Array | Uint32Array;
}
export interface TopAsset {
  bones: string[];
  parts: Map<number, TopPart>;
}

/**
 * Parse `wt-<kind>.bin` (written by scripts/women-tops/bake.py): "GKWT", version, bone names, the position box, then
 * per part: id, vertex / index counts, positions (3 × u16 in the box, padded to 8 B), normals (4 × i8), UVs (2 × u16),
 * joints (4 × u8), weights (4 × u8, sum 255), indices (u16 below 65 536 vertices, else u32), 4-byte aligned.
 */
export function parseTopAsset(buf: ArrayBuffer): TopAsset {
  const dv = new DataView(buf);
  let o = 0;
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== "GKWT") throw new Error("not a women-tops asset");
  o = 4;
  const version = dv.getUint32(o, true);
  if (version !== 1) throw new Error(`women-tops asset version ${version}`);
  const nBones = dv.getUint32(o + 4, true);
  o += 8;
  const bones: string[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < nBones; i++) {
    const n = dv.getUint8(o);
    bones.push(dec.decode(new Uint8Array(buf, o + 1, n)));
    o += 1 + n;
  }
  o = (o + 3) & ~3;
  const lo = [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)];
  const hi = [dv.getFloat32(o + 12, true), dv.getFloat32(o + 16, true), dv.getFloat32(o + 20, true)];
  o += 24;
  const nParts = dv.getUint32(o, true);
  o += 4;
  const parts = new Map<number, TopPart>();
  for (let p = 0; p < nParts; p++) {
    const id = dv.getUint32(o, true),
      nv = dv.getUint32(o + 4, true),
      ni = dv.getUint32(o + 8, true);
    o += 12;
    const position = new Float32Array(nv * 3);
    for (let v = 0; v < nv; v++, o += 8)
      for (let k = 0; k < 3; k++) position[v * 3 + k] = lo[k]! + (dv.getUint16(o + k * 2, true) / 65535) * (hi[k]! - lo[k]!);
    const normal = new Float32Array(nv * 3);
    for (let v = 0; v < nv; v++, o += 4) {
      const x = dv.getInt8(o) / 127,
        y = dv.getInt8(o + 1) / 127,
        z = dv.getInt8(o + 2) / 127;
      const l = Math.hypot(x, y, z) || 1;
      normal[v * 3] = x / l;
      normal[v * 3 + 1] = y / l;
      normal[v * 3 + 2] = z / l;
    }
    const uv = new Float32Array(nv * 2);
    for (let v = 0; v < nv; v++, o += 4) {
      uv[v * 2] = dv.getUint16(o, true) / 65535;
      uv[v * 2 + 1] = dv.getUint16(o + 2, true) / 65535;
    }
    const joints = new Uint8Array(buf.slice(o, o + nv * 4));
    o += nv * 4;
    const weights = new Float32Array(nv * 4);
    for (let v = 0; v < nv * 4; v++) weights[v] = dv.getUint8(o + v) / 255;
    o += nv * 4;
    const wide = nv >= 65536;
    const index = wide ? new Uint32Array(buf.slice(o, o + ni * 4)) : new Uint16Array(buf.slice(o, o + ni * 2));
    o += ni * (wide ? 4 : 2);
    o = (o + 3) & ~3;
    parts.set(id, { position, normal, uv, joints, weights, index });
  }
  return { bones, parts };
}

const BASE = "/assets/characters/women-tops";
export const assetUrl = (kind: GarmentKind) => `${BASE}/wt-${kind}.bin`;
export const mapUrl = (kind: GarmentKind) => `${BASE}/wt-${kind}.webp`;

interface Loaded {
  asset: TopAsset;
  map: THREE.Texture;
}
type Entry = { state: "pending"; promise: Promise<void> } | { state: "ready"; value: Loaded } | { state: "error"; error: unknown };
const cache = new Map<GarmentKind, Entry>();

function load(kind: GarmentKind): Entry {
  let e = cache.get(kind);
  if (e) return e;
  const promise = Promise.all([
    fetch(assetUrl(kind)).then((r) => {
      if (!r.ok) throw new Error(`${assetUrl(kind)}: ${r.status}`);
      return r.arrayBuffer();
    }),
    new THREE.TextureLoader().loadAsync(mapUrl(kind)),
  ]).then(
    ([buf, map]) => {
      map.colorSpace = THREE.NoColorSpace;
      map.flipY = false;
      map.anisotropy = 4;
      map.needsUpdate = true;
      cache.set(kind, { state: "ready", value: { asset: parseTopAsset(buf), map } });
    },
    (error: unknown) => {
      console.warn("[women-tops]", kind, error);
      cache.set(kind, { state: "error", error });
    },
  );
  e = { state: "pending", promise };
  cache.set(kind, e);
  return e;
}

/**
 * The garment asset of a kind for rendering (React Suspense: throws its loading promise until it is in). null when it
 * failed to load: the person then keeps the baked blazer.
 */
export function readWomenTop(kind: GarmentKind | null): Loaded | null {
  if (!kind) return null;
  const e = load(kind);
  if (e.state === "ready") return e.value;
  if (e.state === "error") return null;
  throw e.promise;
}

/* ------------------------------------------------------------------------------------------ the body rebuild */

/** The trousers under the garment, above its hem + COVER, are not drawn (m). Same as garment.py. */
export const COVER = 0.015;

export interface BodyRegions {
  /** recolour mask at a UV: skin / top / bottom shares (0..1) */
  region: (u: number, v: number) => { skin: number; top: number; bottom: number };
  /** skeleton index of a bone name (three.js names: spaces as underscores), -1 if absent */
  boneIndex: (name: string) => number;
  /** bind-space position of the pelvis, the hip joints' height along `up` (lining / covered trousers rules) */
  pelvis: THREE.Vector3;
  hipY: number;
  /**
   * the body's up direction in its bind space (pelvis → head; the Rocketbox bodies' bind space is turned, so it is
   * not +y)
   */
  up: THREE.Vector3;
}

/** The blazer's pocket flaps are trousers in the mask (P2-AVA-16): these UV rectangles (glTF / three.js v). */
export function isPocketUv(u: number, v: number): boolean {
  const x = u - Math.floor(u),
    y = v - Math.floor(v);
  return ((x > 0.31 && x < 0.415) || (x > 0.585 && x < 0.69)) && y > 0.685 && y < 0.76;
}

/**
 * The shirt cuffs under the blazer sleeves are skin in the mask (P2-AVA-16 gkCuff): these UV strips. With the blazer
 * gone they were pale rings round the wrists; the garment asset's arm skin reaches into the hand instead.
 */
export function isShirtCuffUv(u: number, v: number): boolean {
  const x = u - Math.floor(u),
    y = v - Math.floor(v);
  return (x < 0.066 || x > 0.934) && y > 0.265 && y < 0.505;
}

/** Trouser faces round the hips that face inwards: the jacket's lining (prep.py lining()). */
export function isLining(centre: THREE.Vector3, normal: THREE.Vector3, pelvis: THREE.Vector3, hipY: number, up: THREE.Vector3 = Y_UP): boolean {
  const h = centre.dot(up);
  if (!(h > hipY - 0.3 && h < hipY + 0.15)) return false;
  // the horizontal direction from the trunk axis
  const rad = centre.clone().sub(pelvis);
  rad.addScaledVector(up, -rad.dot(up));
  const l = rad.length();
  // (only out at the jacket's radius: the inner thighs at the crotch face the axis too)
  if (l < 0.11) return false;
  return normal.dot(rad) / l < -0.2;
}

const Y_UP = new THREE.Vector3(0, 1, 0);

/** The lowest point of the garment along the body's up direction (its hem). */
export function hemHeight(asset: TopAsset, up: THREE.Vector3): number {
  const g = asset.parts.get(PART.garment);
  let h = Infinity;
  if (g) for (let v = 0; v < g.position.length; v += 3) h = Math.min(h, g.position[v]! * up.x + g.position[v + 1]! * up.y + g.position[v + 2]! * up.z);
  return h;
}

/**
 * Which body triangles stay under a garment (index offsets into the index array, multiples of 3). Drops the blazer
 * (top region), its pocket flaps, the trousers' lining round the hips and the trousers above the garment's hem.
 */
export function keptTriangles(geo: THREE.BufferGeometry, r: BodyRegions, hemY: number): number[] {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const idx = geo.index ? geo.index.array : Uint32Array.from({ length: pos.count }, (_, i) => i);
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    n = new THREE.Vector3(),
    m = new THREE.Vector3();
  const out: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t]!,
      i1 = idx[t + 1]!,
      i2 = idx[t + 2]!;
    const u = (uv.getX(i0) + uv.getX(i1) + uv.getX(i2)) / 3,
      v = (uv.getY(i0) + uv.getY(i1) + uv.getY(i2)) / 3;
    const reg = r.region(u, v);
    if (reg.top > 0.5) continue;
    if (reg.skin > 0.5 && isShirtCuffUv(u, v)) continue;
    if (reg.bottom > 0.5 && reg.skin <= 0.5 && reg.top <= 0.5) {
      if (isPocketUv(u, v)) continue;
      a.fromBufferAttribute(pos, i0);
      b.fromBufferAttribute(pos, i1);
      c.fromBufferAttribute(pos, i2);
      const lim = hemY + COVER;
      if (a.dot(r.up) > lim && b.dot(r.up) > lim && c.dot(r.up) > lim) continue;
      n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
      m.copy(a).add(b).add(c).divideScalar(3);
      if (isLining(m, n, r.pelvis, r.hipY, r.up)) continue;
    }
    out.push(t);
  }
  return out;
}

/**
 * The body geometry with the garment: kept body triangles + the garment, skin and trousers parts (near or far set),
 * appended with the body's own attribute layout. Parts' UVs are shifted by PART_U; their joints are mapped from the
 * asset's bone names onto the body skeleton (a bone the body lacks falls back to the pelvis).
 */
export function bodyWithTop(src: THREE.BufferGeometry, asset: TopAsset, r: BodyRegions, far: boolean): THREE.BufferGeometry {
  const kept = keptTriangles(src, r, hemHeight(asset, r.up));
  const ids = far ? [PART.garmentFar, PART.skinFar, PART.underFar, PART.bandFar] : [PART.garment, PART.skin, PART.under, PART.band];
  const fams: number[] = [PART_U.garment, PART_U.skin, PART_U.under, PART_U.band];
  const parts: { p: TopPart; du: number }[] = [];
  ids.forEach((id, k) => {
    const p = asset.parts.get(id);
    if (p) parts.push({ p, du: fams[k]! });
  });
  const baseCount = src.attributes.position!.count;
  const extra = parts.reduce((s, x) => s + x.p.position.length / 3, 0);
  const total = baseCount + extra;
  const pelvis = Math.max(0, r.boneIndex("Bip01_Pelvis"));
  const jmap = asset.bones.map((n) => {
    const i = r.boneIndex(n);
    return i >= 0 ? i : pelvis;
  });
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const size = a.itemSize;
    const Arr = a.array.constructor as { new (n: number): THREE.TypedArray };
    const arr = new Arr(total * size);
    // (interleaved / normalized sources are copied element-wise)
    for (let i = 0; i < baseCount; i++) for (let k = 0; k < size; k++) arr[i * size + k] = a.getComponent(i, k) as number;
    let o = baseCount;
    for (const { p, du } of parts) {
      const nv = p.position.length / 3;
      for (let v = 0; v < nv; v++, o++) {
        for (let k = 0; k < size; k++) {
          let val = 0;
          if (name === "position") val = p.position[v * 3 + k]!;
          else if (name === "normal") val = p.normal[v * 3 + k]!;
          else if (name === "uv") val = k === 0 ? p.uv[v * 2]! + du : p.uv[v * 2 + 1]!;
          else if (name === "skinIndex") val = jmap[p.joints[v * 4 + k]!] ?? pelvis;
          else if (name === "skinWeight") val = p.weights[v * 4 + k]!;
          arr[o * size + k] = a.normalized && name === "skinWeight" ? Math.round(val * (Arr === Uint8Array ? 255 : 65535)) : val;
        }
      }
    }
    g.setAttribute(name, new THREE.BufferAttribute(arr, size, a.normalized));
  }
  const srcIdx = src.index ? src.index.array : Uint32Array.from({ length: baseCount }, (_, i) => i);
  const nIdx = kept.length * 3 + parts.reduce((s, x) => s + x.p.index.length, 0);
  const index = total > 65535 ? new Uint32Array(nIdx) : new Uint16Array(nIdx);
  let w = 0;
  for (const t of kept) {
    index[w++] = srcIdx[t]!;
    index[w++] = srcIdx[t + 1]!;
    index[w++] = srcIdx[t + 2]!;
  }
  let base = baseCount;
  for (const { p } of parts) {
    for (let i = 0; i < p.index.length; i++) index[w++] = base + p.index[i]!;
    base += p.position.length / 3;
  }
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  g.userData.gkWomenTop = true;
  return g;
}

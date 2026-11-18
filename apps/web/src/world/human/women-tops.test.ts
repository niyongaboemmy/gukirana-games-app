import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { OUTFITS } from "../outfits";
import {
  bodyWithTop,
  COVER,
  GARMENT_FABRIC,
  GARMENT_OF_KIND,
  hemHeight,
  isLining,
  isPocketUv,
  isShirtCuffUv,
  keptTriangles,
  parseTopAsset,
  PART,
  PART_U,
  SHIPPED_TOPS,
  womenTopFor,
  type BodyRegions,
  type GarmentKind,
  type TopAsset,
} from "./women-tops";

/** P2-AVA-17: women's tops — simulated garments replace the feminine body's baked blazer. */

const item = (id: string) => OUTFITS.find((o) => o.id === id)!;

describe("which top gets a garment", () => {
  it("every catalogue top kind has a decision (garment or the body's own blazer)", () => {
    for (const o of OUTFITS.filter((x) => x.slot === "top")) expect(o.kind in GARMENT_OF_KIND).toBe(true);
    expect(GARMENT_OF_KIND.blazer).toBeNull();
    for (const k of Object.values(GARMENT_OF_KIND)) if (k) expect(GARMENT_FABRIC[k]).toBeGreaterThan(0);
  });

  it("only the feminine body, only switched-on items", () => {
    expect(womenTopFor(item("tee"), "feminine", "all")).toBe("tee");
    expect(womenTopFor(item("imigongo-top"), "feminine", "all")).toBe("tee");
    expect(womenTopFor(item("track"), "feminine", "all")).toBe("track");
    expect(womenTopFor(item("kitenge-sun"), "feminine", "all")).toBe("shirt");
    expect(womenTopFor(item("mushanana"), "feminine", "all")).toBe("sash");
    expect(womenTopFor(item("tee"), "masculine", "all")).toBeNull();
    expect(womenTopFor(item("tee"), "neutral", "all")).toBeNull();
    expect(womenTopFor(item("blazer-cream"), "feminine", "all")).toBeNull();
    expect(womenTopFor(item("jeans"), "feminine", "all")).toBeNull();
    expect(womenTopFor(undefined, "feminine", "all")).toBeNull();
    // the per-item switch
    expect(womenTopFor(item("tee"), "feminine", new Set(["tee-white"]))).toBeNull();
    expect(womenTopFor(item("tee-white"), "feminine", new Set(["tee-white"]))).toBe("tee");
  });

  it("the shipped set names real top items (saved looks keep their ids)", () => {
    for (const id of SHIPPED_TOPS) {
      const o = item(id);
      expect(o?.slot).toBe("top");
      expect(GARMENT_OF_KIND[o.kind]).toBeTruthy();
      // its garment asset is published
      const dir = join(__dirname, "../../../public/assets/characters/women-tops");
      expect(existsSync(join(dir, `wt-${GARMENT_OF_KIND[o.kind]}.bin`))).toBe(true);
      expect(existsSync(join(dir, `wt-${GARMENT_OF_KIND[o.kind]}.webp`))).toBe(true);
    }
  });
});

/** Writes the asset format of scripts/women-tops/bake.py (pack()). */
function writeAsset(bones: string[], parts: { id: number; pos: number[][]; nrm: number[][]; uv: number[][]; ji: number[][]; jw: number[][]; idx: number[] }[]): ArrayBuffer {
  const all = parts.flatMap((p) => p.pos);
  const lo = [0, 1, 2].map((k) => Math.min(...all.map((p) => p[k]!)));
  const hi = [0, 1, 2].map((k) => Math.max(...all.map((p) => p[k]!)));
  const bytes: number[] = [];
  const u8 = (v: number) => bytes.push(v & 255);
  const u16 = (v: number) => (u8(v), u8(v >> 8));
  const u32 = (v: number) => (u16(v & 0xffff), u16(v >>> 16));
  const f32 = (v: number) => {
    const b = new Uint8Array(new Float32Array([v]).buffer);
    b.forEach(u8);
  };
  const pad = () => {
    while (bytes.length % 4) u8(0);
  };
  "GKWT".split("").forEach((c) => u8(c.charCodeAt(0)));
  u32(1);
  u32(bones.length);
  for (const b of bones) {
    u8(b.length);
    b.split("").forEach((c) => u8(c.charCodeAt(0)));
  }
  pad();
  [...lo, ...hi].forEach(f32);
  u32(parts.length);
  for (const p of parts) {
    u32(p.id);
    u32(p.pos.length);
    u32(p.idx.length);
    for (const q of p.pos) {
      for (let k = 0; k < 3; k++) u16(Math.round(((q[k]! - lo[k]!) / Math.max(hi[k]! - lo[k]!, 1e-6)) * 65535));
      u16(0);
    }
    for (const n of p.nrm) [...n.map((c) => Math.round(c * 127)), 0].forEach((c) => u8(c < 0 ? 256 + c : c));
    for (const t of p.uv) t.forEach((c) => u16(Math.round(c * 65535)));
    for (const j of p.ji) j.forEach(u8);
    for (const w of p.jw) w.forEach(u8);
    p.idx.forEach(u16);
    pad();
  }
  return new Uint8Array(bytes).buffer;
}

const QUAD = {
  pos: [
    [0, -0.1, 0.1],
    [0.1, -0.1, 0.1],
    [0.1, 0.2, 0.1],
    [0, 0.2, 0.1],
  ],
  nrm: [
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
  ],
  uv: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  ji: [
    [0, 1, 0, 0],
    [0, 0, 0, 0],
    [1, 0, 0, 0],
    [2, 0, 0, 0],
  ],
  jw: [
    [128, 127, 0, 0],
    [255, 0, 0, 0],
    [255, 0, 0, 0],
    [255, 0, 0, 0],
  ],
  idx: [0, 1, 2, 0, 2, 3],
};

describe("the garment asset", () => {
  it("parses the baked format: dequantised positions, unit normals, weights, the hem height", () => {
    const buf = writeAsset(["Bip01_Spine", "Bip01_L_UpperArm", "Bip01_Missing"], [{ id: PART.garment, ...QUAD }, { id: PART.skin, ...QUAD }]);
    const a = parseTopAsset(buf);
    expect(a.bones).toEqual(["Bip01_Spine", "Bip01_L_UpperArm", "Bip01_Missing"]);
    expect([...a.parts.keys()]).toEqual([PART.garment, PART.skin]);
    const g = a.parts.get(PART.garment)!;
    expect(g.position.length).toBe(12);
    for (let i = 0; i < 12; i++) expect(g.position[i]).toBeCloseTo(QUAD.pos[Math.floor(i / 3)]![i % 3]!, 4);
    expect(Math.hypot(g.normal[0]!, g.normal[1]!, g.normal[2]!)).toBeCloseTo(1, 5);
    expect(g.weights[0]! + g.weights[1]!).toBeCloseTo(1, 5);
    expect([...g.index]).toEqual(QUAD.idx);
    expect(hemHeight(a, new THREE.Vector3(0, 1, 0))).toBeCloseTo(-0.1, 4);
    // the hem along another up direction (the bodies' bind space is turned)
    expect(hemHeight(a, new THREE.Vector3(0, 0, 1))).toBeCloseTo(0.1, 4);
  });

  it("rejects other files", () => {
    expect(() => parseTopAsset(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]).buffer)).toThrow();
  });

  it("the published assets parse, with near / far garment and skin, and stay small", () => {
    const dir = join(__dirname, "../../../public/assets/characters/women-tops");
    let total = 0;
    for (const kind of Object.keys(GARMENT_FABRIC) as GarmentKind[]) {
      const bin = join(dir, `wt-${kind}.bin`);
      if (!existsSync(bin)) continue;
      const raw = readFileSync(bin);
      total += raw.length + (existsSync(join(dir, `wt-${kind}.webp`)) ? readFileSync(join(dir, `wt-${kind}.webp`)).length : 0);
      const a = parseTopAsset(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length) as ArrayBuffer);
      for (const id of [PART.garment, PART.garmentFar, PART.skin, PART.skinFar]) expect(a.parts.has(id)).toBe(true);
      const near = a.parts.get(PART.garment)!.index.length / 3;
      const far = a.parts.get(PART.garmentFar)!.index.length / 3;
      // light for phones; the far level well under the near one
      expect(near).toBeLessThan(6000);
      expect(far).toBeLessThan(near * 0.6);
      expect(a.bones.every((b) => b.startsWith("Bip01_"))).toBe(true);
      expect(a.parts.get(PART.garment)!.position.length).toBeGreaterThan(300);
    }
    expect(total).toBeLessThan(1.5 * 1024 * 1024);
  });
});

describe("the body without its blazer", () => {
  it("UV tags of the blazer's own parts", () => {
    expect(isPocketUv(0.35, 0.7)).toBe(true);
    expect(isPocketUv(0.62, 0.72)).toBe(true);
    expect(isPocketUv(0.5, 0.7)).toBe(false);
    expect(isShirtCuffUv(0.03, 0.4)).toBe(true);
    expect(isShirtCuffUv(0.95, 0.3)).toBe(true);
    expect(isShirtCuffUv(0.5, 0.4)).toBe(false);
    expect(isShirtCuffUv(0.03, 0.8)).toBe(false);
  });

  it("the lining: trouser faces round the hips that face inwards", () => {
    const pelvis = new THREE.Vector3(0, 0, 0);
    expect(isLining(new THREE.Vector3(0.15, 0, 0), new THREE.Vector3(-1, 0, 0), pelvis, 0)).toBe(true);
    expect(isLining(new THREE.Vector3(0.15, 0, 0), new THREE.Vector3(1, 0, 0), pelvis, 0)).toBe(false);
    // far below the hips (the legs) never
    expect(isLining(new THREE.Vector3(0.15, -0.6, 0), new THREE.Vector3(-1, 0, 0), pelvis, 0)).toBe(false);
    // a turned bind space (up = +z): the height is measured along it
    const up = new THREE.Vector3(0, 0, 1);
    expect(isLining(new THREE.Vector3(0.15, 0, 0), new THREE.Vector3(-1, 0, 0), pelvis, 0, up)).toBe(true);
    expect(isLining(new THREE.Vector3(0.15, 0, -0.6), new THREE.Vector3(-1, 0, 0), pelvis, 0, up)).toBe(false);
  });

  /** One triangle per region, its UVs pointing at a mask that answers by the triangle's u band. */
  function regionBody() {
    const P: number[] = [];
    const UV: number[] = [];
    const tri = (cx: number, y: number, u: number, v: number, outward = true) => {
      // a small triangle in the plane x = cx facing +x (outward from the pelvis axis) or -x
      const pts = !outward
        ? [
            [cx, y, -0.01],
            [cx, y, 0.01],
            [cx, y + 0.02, 0],
          ]
        : [
            [cx, y, 0.01],
            [cx, y, -0.01],
            [cx, y + 0.02, 0],
          ];
      for (const p of pts) {
        P.push(...p);
        UV.push(u, v);
      }
    };
    tri(0.15, 0.3, 0.2, 0.2); // 0 blazer (top)
    tri(0.15, 0.1, 0.8, 0.2); // 1 skin (hand)
    tri(0.15, 0.1, 0.03, 0.4); // 2 shirt cuff (skin in the mask)
    tri(0.15, -0.3, 0.5, 0.9); // 3 trousers, below the hem
    tri(0.15, 0.05, 0.5, 0.9); // 4 trousers, under the garment
    tri(0.15, -0.05, 0.35, 0.7); // 5 pocket flap
    tri(0.15, -0.05, 0.5, 0.95, false); // 6 lining (inward)
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(P.length).fill(0), 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Array((P.length / 3) * 4).fill(0), 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(new Array((P.length / 3) * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    g.setIndex(Array.from({ length: P.length / 3 }, (_, i) => i));
    const r: BodyRegions = {
      region: (u, v) => (v > 0.6 ? { skin: 0, top: 0, bottom: 1 } : u < 0.1 || u > 0.7 ? { skin: 1, top: 0, bottom: 0 } : { skin: 0, top: 1, bottom: 0 }),
      boneIndex: (n) => ["Bip01_Pelvis", "Bip01_Spine", "Bip01_L_UpperArm"].indexOf(n),
      pelvis: new THREE.Vector3(0, 0, 0),
      hipY: 0,
      up: new THREE.Vector3(0, 1, 0),
    };
    return { g, r };
  }

  it("drops the blazer, its cuffs and pocket flaps, the lining and the trousers under the garment", () => {
    const { g, r } = regionBody();
    const kept = keptTriangles(g, r, -0.1).map((t) => t / 3);
    expect(kept).toEqual([1, 3]);
    // a lower hem covers less: the trousers at y 0.05 are above hem + COVER only while the hem is under 0.05 - COVER
    expect(keptTriangles(g, r, 0.05 - COVER + 0.01).map((t) => t / 3)).toContain(4);
  });

  it("appends the garment, skin and trousers parts to the same geometry with tagged UVs and mapped joints", () => {
    const { g, r } = regionBody();
    const buf = writeAsset(["Bip01_Spine", "Bip01_L_UpperArm", "Bip01_Missing"], [
      { id: PART.garment, ...QUAD },
      { id: PART.skin, ...QUAD },
      { id: PART.under, ...QUAD },
      { id: PART.garmentFar, ...QUAD, idx: [0, 1, 2] },
    ]);
    const asset: TopAsset = parseTopAsset(buf);
    const out = bodyWithTop(g, asset, r, false);
    const base = g.attributes.position!.count;
    expect(out.attributes.position!.count).toBe(base + 12);
    // the kept body (2 triangles) + 3 parts x 2 triangles
    expect(out.index!.count / 3).toBe(2 + 6);
    const uv = out.attributes.uv as THREE.BufferAttribute;
    expect(uv.getX(base)).toBeCloseTo(PART_U.garment, 4);
    expect(uv.getX(base + 4)).toBeCloseTo(PART_U.skin, 4);
    expect(uv.getX(base + 8)).toBeCloseTo(PART_U.under + 0, 4);
    const si = out.attributes.skinIndex as THREE.BufferAttribute;
    // asset bone 0 (Spine) -> body 1, bone 1 (L_UpperArm) -> 2, a bone the body lacks -> the pelvis
    expect(si.getX(base)).toBe(1);
    expect(si.getY(base)).toBe(2);
    expect(si.getX(base + 3)).toBe(0);
    // the far set uses the far parts
    const farG = bodyWithTop(g, asset, r, true);
    expect(farG.index!.count / 3).toBe(2 + 1);
    // every index points at a real vertex
    const n = out.attributes.position!.count;
    for (let i = 0; i < out.index!.count; i++) expect(out.index!.getX(i)).toBeLessThan(n);
  });
});

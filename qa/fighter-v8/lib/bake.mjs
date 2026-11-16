// P3-FGT-19A fighter v8 prototype (dev only): UV-space bakes for the skin.
// rasterise per-vertex scalars into MakeHuman's UV layout (region masks: roughness zones, sweat, hairline, brows),
// compose the four skin-tone albedos from the CC0 MakeHuman photo skin (its luminance detail, re-toned to Monk Skin
// Tone targets), derive a fine detail normal from the photo's high-pass and merge it with the anatomy bake.
import sharp from "sharp";
import { clamp } from "./geo.mjs";

/**
 * Rasterise triangles in UV space. tris: [[ia, ib, ic]] into per-corner arrays uv (flat, 2 per corner index) and
 * values (flat, `ch` per corner index). Returns Float32Array(size² · ch) and a coverage mask; uncovered texels are
 * dilated from their neighbours (8 passes) so bilinear sampling at island borders stays clean.
 */
export function rasterUV(tris, uv, values, ch, size) {
  const out = new Float32Array(size * size * ch);
  const cov = new Uint8Array(size * size);
  for (const [a, b, c] of tris) {
    const ax = uv[a * 2] * size, ay = uv[a * 2 + 1] * size;
    const bx = uv[b * 2] * size, by = uv[b * 2 + 1] * size;
    const cx = uv[c * 2] * size, cy = uv[c * 2 + 1] * size;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-12) continue;
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den;
        const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.01 || w1 < -0.01 || w2 < -0.01) continue;
        const t = y * size + x;
        for (let k = 0; k < ch; k++) out[t * ch + k] = w0 * values[a * ch + k] + w1 * values[b * ch + k] + w2 * values[c * ch + k];
        cov[t] = 1;
      }
  }
  for (let pass = 0; pass < 8; pass++) {
    const add = [];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const t = y * size + x;
        if (cov[t]) continue;
        let n = 0;
        const acc = new Array(ch).fill(0);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
          const q = yy * size + xx;
          if (!cov[q]) continue;
          for (let k = 0; k < ch; k++) acc[k] += out[q * ch + k];
          n++;
        }
        if (n) add.push([t, acc.map((v) => v / n)]);
      }
    for (const [t, v] of add) {
      for (let k = 0; k < ch; k++) out[t * ch + k] = v[k];
      cov[t] = 1;
    }
  }
  return { data: out, cov };
}

const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
export const hexLin = (h) => [1, 3, 5].map((i) => srgbToLin(parseInt(h.slice(i, i + 2), 16) / 255));

/**
 * The four Rwandan athlete tones, deep → light brown. Targets are the Monk Skin Tone scale swatches 9, 8, 7, 6
 * (Google, MST, CC BY 4.0: https://skintone.google) as the mean albedo of the torso; the photo skin's own variation
 * rides on top.
 */
export const TONES = [
  // the Monk swatches are display colours; as albedo they are warmed slightly (measured dark skin keeps more red
  // than a neutral grey-brown: a grey albedo is what makes deep skin render "ashy")
  { id: "t1-deep", label: "Deep (MST 9)", hex: "#3a312a", albedo: "#46302a" },
  { id: "t2-dark", label: "Dark brown (MST 8)", hex: "#604134", albedo: "#664234" },
  { id: "t3-brown", label: "Brown (MST 7)", hex: "#825c43", albedo: "#895c42" },
  { id: "t4-light", label: "Light brown (MST 6)", hex: "#a07e56", albedo: "#a77b55" },
];

/** load an image as float RGB(A) */
export async function loadImage(path, size) {
  const img = sharp(path).removeAlpha();
  const { data, info } = await (size ? img.resize(size, size) : img).raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}

/** separable box blur ×3 (≈ gaussian) on a single channel float image */
export function blur(src, w, h, r) {
  let a = Float32Array.from(src);
  let b = new Float32Array(a.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[y * w + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        b[y * w + x] = acc / (2 * r + 1);
        acc += a[y * w + clamp(x + r + 1, 0, w - 1)] - a[y * w + clamp(x - r, 0, w - 1)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / (2 * r + 1);
        acc += b[clamp(y + r + 1, 0, h - 1) * w + x] - b[clamp(y - r, 0, h - 1) * w + x];
      }
    }
  }
  return a;
}

/**
 * Compose one tone's albedo. src: the MakeHuman photo skin (RGB 8-bit), torsoMask: float mask (1 on the torso /
 * arms / legs, used to measure the photo's mean), regions: { lips, palms, hair, brows, joints } float masks.
 */
export function composeAlbedo(src, size, tone, regions) {
  const n = size * size;
  const L = new Float32Array(n);
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    R[i] = srgbToLin(src.data[i * 3] / 255);
    G[i] = srgbToLin(src.data[i * 3 + 1] / 255);
    B[i] = srgbToLin(src.data[i * 3 + 2] / 255);
    L[i] = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i];
  }
  // reference luminance: the mean over the skin of the torso / limbs
  let sum = 0, cnt = 0;
  for (let i = 0; i < n; i++)
    if (regions.skinRef[i] > 0.5) {
      sum += L[i];
      cnt++;
    }
  const Lm = sum / Math.max(1, cnt);
  // large-scale lightness (sigma ≈ 20 px at 2K) and fine detail
  const Lb = blur(L, size, size, Math.round(size / 160));
  const t = hexLin(tone.albedo ?? tone.hex);
  const out = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    const coarse = clamp(Lb[i] / Lm, 0.25, 2.2);
    const fine = clamp(L[i] / Math.max(1e-4, Lb[i]), 0.55, 1.6);
    // the photo's macro lightness is softened (its baked lighting), its fine detail kept
    const k = coarse ** 0.55 * fine ** 0.9;
    let r = t[0] * k, g = t[1] * k, b = t[2] * k;
    // lips: deeper, slightly cooler-red; palms / soles lighter and warmer; joints (knuckles, elbows, knees) a touch
    // darker on deep skin (hyperpigmented creases); hair and brows near-black, slightly warm
    const lip = regions.lips[i], palm = regions.palms[i], hair = regions.hair[i], brow = regions.brows[i], joint = regions.joints[i];
    if (lip > 0) {
      // lips: darker and a little cooler (mauve-brown) than the face, never lighter
      const f = clamp(fine, 0.8, 1.2);
      r = r * (1 - lip) + t[0] * 0.58 * f * lip;
      g = g * (1 - lip) + t[1] * 0.42 * f * lip;
      b = b * (1 - lip) + t[2] * 0.5 * f * lip;
    }
    if (palm > 0) {
      const pl = [Math.min(0.5, t[0] * 2.1), Math.min(0.4, t[1] * 2.0), Math.min(0.32, t[2] * 1.9)];
      r = r * (1 - palm) + pl[0] * fine * palm;
      g = g * (1 - palm) + pl[1] * fine * palm;
      b = b * (1 - palm) + pl[2] * fine * palm;
    }
    const fl = regions.flush ? regions.flush[i] : 0;
    if (fl > 0) {
      // warmer / redder, scaled down on deep skin (melanin masks it)
      const k2 = fl * (0.1 + 0.25 * Math.min(1, t[0] * 6));
      r *= 1 + k2 * 0.9;
      g *= 1 - k2 * 0.15;
      b *= 1 - k2 * 0.2;
    }
    if (joint > 0) {
      const d = 1 - 0.22 * joint;
      r *= d;
      g *= d * 0.97;
      b *= d * 0.95;
    }
    const hb = Math.max(hair, brow * 0.85);
    if (hb > 0) {
      const hc = [0.012, 0.009, 0.008];
      const f = clamp(fine, 0.7, 1.3);
      r = r * (1 - hb) + hc[0] * f * hb;
      g = g * (1 - hb) + hc[1] * f * hb;
      b = b * (1 - hb) + hc[2] * f * hb;
    }
    out[i * 3] = Math.round(clamp(linToSrgb(r), 0, 1) * 255);
    out[i * 3 + 1] = Math.round(clamp(linToSrgb(g), 0, 1) * 255);
    out[i * 3 + 2] = Math.round(clamp(linToSrgb(b), 0, 1) * 255);
  }
  return out;
}

/**
 * Fine detail normal from the photo skin's high-pass luminance (pores, creases, the painted skin texture), merged
 * (UDN blend) with the anatomy normal map (RG = tangent normal, B = cavity; MakeHuman UV). Output RGB normal map.
 */
export function composeNormal(src, size, anatomy, { fineGain = 2.2, anatomyGain = 1.6, vein = null, poreMask = null, braid = null } = {}) {
  const n = size * size;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = (0.2126 * src.data[i * 3] + 0.7152 * src.data[i * 3 + 1] + 0.0722 * src.data[i * 3 + 2]) / 255;
  const Lb = blur(L, size, size, Math.max(2, Math.round(size / 400)));
  const H = new Float32Array(n);
  for (let i = 0; i < n; i++) H[i] = L[i] - Lb[i];
  // procedural pores (a fine pitted noise, ~1 texel), stronger on the face (poreMask)
  let seed = 7;
  for (let i = 0; i < n; i++) {
    seed = (seed * 16807) % 2147483647;
    const r = seed / 2147483647;
    const pm = poreMask ? 0.5 + poreMask[i] : 1;
    if (r < 0.08) H[i] -= 0.012 * pm;
    else H[i] += (r - 0.5) * 0.004 * pm;
  }
  if (braid) for (let i = 0; i < n; i++) H[i] += braid[i] * 0.06;
  // veins (raised): blurred so they read as soft ridges
  if (vein) {
    const vb = blur(vein, size, size, 1);
    for (let i = 0; i < n; i++) H[i] += vb[i] * 0.05;
  }
  const out = Buffer.alloc(n * 3);
  const cav = new Float32Array(n);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const hx = H[y * size + Math.min(size - 1, x + 1)] - H[y * size + Math.max(0, x - 1)];
      const hy = H[Math.min(size - 1, y + 1) * size + x] - H[Math.max(0, y - 1) * size + x];
      // fine normal (dark = low): tangent x along +u, y along +v (glTF v down → flip)
      let fx = -hx * fineGain, fy = hy * fineGain;
      // anatomy (sampled at the same uv)
      const ax = ((anatomy.data[(Math.floor((y / size) * anatomy.h) * anatomy.w + Math.floor((x / size) * anatomy.w)) * anatomy.ch] / 255) * 2 - 1) * anatomyGain;
      const ay = ((anatomy.data[(Math.floor((y / size) * anatomy.h) * anatomy.w + Math.floor((x / size) * anatomy.w)) * anatomy.ch + 1] / 255) * 2 - 1) * anatomyGain;
      cav[i] = anatomy.data[(Math.floor((y / size) * anatomy.h) * anatomy.w + Math.floor((x / size) * anatomy.w)) * anatomy.ch + 2] / 255;
      let nx = ax + fx, ny = ay + fy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      out[i * 3] = Math.round((nx * 0.5 + 0.5) * 255);
      out[i * 3 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[i * 3 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  return { normal: out, cavity: cav };
}

export async function writeRGB(path, buf, size, { quality = 92 } = {}) {
  const img = sharp(buf, { raw: { width: size, height: size, channels: 3 } });
  if (path.endsWith(".png")) await img.png({ compressionLevel: 9 }).toFile(path);
  else if (path.endsWith(".webp")) await img.webp({ quality }).toFile(path);
  else await img.jpeg({ quality }).toFile(path);
}
export async function writeGrey(path, f32, size, { quality = 92 } = {}) {
  const buf = Buffer.alloc(size * size);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.round(clamp(f32[i], 0, 1) * 255);
  const img = sharp(buf, { raw: { width: size, height: size, channels: 1 } });
  if (path.endsWith(".png")) await img.png({ compressionLevel: 9 }).toFile(path);
  else await img.webp({ quality }).toFile(path);
}

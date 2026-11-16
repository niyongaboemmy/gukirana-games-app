import * as THREE from "three";

/**
 * Alpha-cut foliage from a 2D canvas without black fringes (P2-WLD-22). A canvas stores premultiplied colour, so every
 * transparent texel is black (0, 0, 0, 0): linear filtering and mipmaps blend that black into the edges of every
 * leaf and petal, and at a distance whole plants turn into dark smudges. This copies the canvas into a DataTexture
 * and "bleeds" the colour of the nearest painted texels outwards into the transparent ones (alpha stays 0), a few
 * texels per pass, then fills what is still empty with the image's mean colour — the standard texture-padding fix.
 */
export function bleedCanvas(c: HTMLCanvasElement, passes = 8): THREE.DataTexture {
  const w = c.width;
  const h = c.height;
  const src = c.getContext("2d")!.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(src.length);
  out.set(src);
  // filled[i]: this texel carries a valid colour
  let filled = new Uint8Array(w * h);
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let n = 0;
  for (let i = 0; i < w * h; i++)
    if (src[i * 4 + 3]! > 8) {
      filled[i] = 1;
      sr += src[i * 4]!;
      sg += src[i * 4 + 1]!;
      sb += src[i * 4 + 2]!;
      n++;
    }
  for (let p = 0; p < passes; p++) {
    const next = filled.slice();
    let grew = false;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (filled[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let k = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const j = yy * w + xx;
            if (!filled[j]) continue;
            r += out[j * 4]!;
            g += out[j * 4 + 1]!;
            b += out[j * 4 + 2]!;
            k++;
          }
        }
        if (!k) continue;
        out[i * 4] = r / k;
        out[i * 4 + 1] = g / k;
        out[i * 4 + 2] = b / k;
        next[i] = 1;
        grew = true;
      }
    filled = next;
    if (!grew) break;
  }
  if (n) {
    const mr = sr / n;
    const mg = sg / n;
    const mb = sb / n;
    for (let i = 0; i < w * h; i++)
      if (!filled[i]) {
        out[i * 4] = mr;
        out[i * 4 + 1] = mg;
        out[i * 4 + 2] = mb;
      }
  }
  // DataTexture rows run bottom-up (flipY does not apply to data textures): flip the rows
  const flipped = new Uint8Array(out.length);
  const row = w * 4;
  for (let y = 0; y < h; y++) flipped.set(out.subarray(y * row, (y + 1) * row), (h - 1 - y) * row);
  const t = new THREE.DataTexture(flipped, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

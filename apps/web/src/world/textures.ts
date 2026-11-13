import * as THREE from "three";

/**
 * Procedural canvas textures (no downloads, works offline). Every texture is cached, so materials can share them.
 * Patterns use a seeded PRNG so the world looks identical on every device (this is decoration, not game randomness).
 * Imigongo geometry: zig-zags, diamonds and spirals in black, white and red-ochre (DESIGN-SPEC §5.2).
 */

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  return { c, g };
}

function finish(key: string, c: HTMLCanvasElement, opts: { srgb?: boolean; repeat?: [number, number]; aniso?: number } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = opts.aniso ?? 8;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

function cached<T extends THREE.Texture>(key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit) return hit as T;
  return make();
}

/** Fine value-noise speckle used to break up flat colour on stone, concrete and soil. */
function speckle(g: CanvasRenderingContext2D, w: number, h: number, r: () => number, n: number, alpha: number, light = true) {
  for (let i = 0; i < n; i++) {
    const v = r();
    g.fillStyle = light ? `rgba(255,255,255,${alpha * v})` : `rgba(0,0,0,${alpha * v})`;
    const s = 1 + r() * 2.5;
    g.fillRect(r() * w, r() * h, s, s);
  }
}

/** Imigongo frieze: zig-zag mountains with inner chevrons. Tiles horizontally. */
export function imigongoTexture(repeat = 8): THREE.CanvasTexture {
  return cached(`imigongo-${repeat}`, () => {
    const { c, g } = canvas(512, 128);
    g.fillStyle = "#F4EFE6";
    g.fillRect(0, 0, 512, 128);
    for (let i = 0; i < 8; i++) {
      const x = i * 64;
      g.fillStyle = i % 2 ? "#B5532A" : "#1B1B1B";
      g.beginPath();
      g.moveTo(x, 128);
      g.lineTo(x + 32, 14);
      g.lineTo(x + 64, 128);
      g.fill();
      g.fillStyle = "#F4EFE6";
      g.beginPath();
      g.moveTo(x + 14, 128);
      g.lineTo(x + 32, 70);
      g.lineTo(x + 50, 128);
      g.fill();
      g.fillStyle = i % 2 ? "#1B1B1B" : "#B5532A";
      g.beginPath();
      g.moveTo(x + 24, 128);
      g.lineTo(x + 32, 104);
      g.lineTo(x + 40, 128);
      g.fill();
    }
    g.fillStyle = "#1B1B1B";
    g.fillRect(0, 0, 512, 6);
    return finish(`imigongo-${repeat}`, c, { repeat: [repeat, 1] }) as THREE.CanvasTexture;
  });
}

/** Imigongo diamond lattice — used as the perforated arena skin and hall wall panels. One tile = 1 UV unit. */
export function imigongoDiamondTexture(dark = "#1B1B1B", accent = "#B5532A", base = "#F4EFE6"): THREE.CanvasTexture {
  const key = `diamond-${dark}-${accent}-${base}`;
  return cached(key, () => {
    const { c, g } = canvas(256, 256);
    g.fillStyle = base;
    g.fillRect(0, 0, 256, 256);
    const diamond = (cx: number, cy: number, rx: number, ry: number, col: string) => {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(cx, cy - ry);
      g.lineTo(cx + rx, cy);
      g.lineTo(cx, cy + ry);
      g.lineTo(cx - rx, cy);
      g.closePath();
      g.fill();
    };
    for (const [cx, cy] of [
      [128, 128],
      [0, 0],
      [256, 0],
      [0, 256],
      [256, 256],
    ] as const) {
      diamond(cx, cy, 120, 120, dark);
      diamond(cx, cy, 92, 92, base);
      diamond(cx, cy, 64, 64, accent);
      diamond(cx, cy, 38, 38, base);
      diamond(cx, cy, 16, 16, dark);
    }
    return finish(key, c);
  });
}

/**
 * Musanze lava-rock rubble (P1-WLD-03): irregular basalt stones (tileable jittered Voronoi, no coursed rows), each
 * stone grey-brown with a warm/cool jitter and vesicles, set in narrow recessed dark joints. Doubles as the bump map
 * (joints are the low points). 1 UV unit ≈ 1.2 m.
 */
export function lavaStoneTexture(): THREE.CanvasTexture {
  return cached("lava", () => {
    const S = 512;
    const { c, g } = canvas(S, S);
    const r = rng(11);
    const G = 6; // ~6 stones per 1.2 m row → 15–30 cm stones
    const cell = S / G;
    const pts: { x: number; y: number; v: number; warm: number }[] = [];
    for (let j = 0; j < G; j++)
      for (let i = 0; i < G; i++) pts.push({ x: (i + 0.15 + r() * 0.7) * cell, y: (j + 0.15 + r() * 0.7) * cell, v: 60 + r() * 40, warm: (r() - 0.5) * 14 });
    const img = g.createImageData(S, S);
    const d = img.data;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const ci = Math.floor(x / cell);
        const cj = Math.floor(y / cell);
        let d1 = 1e9;
        let d2 = 1e9;
        let best = 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ii = (ci + di + G) % G;
            const jj = (cj + dj + G) % G;
            const p = pts[jj * G + ii]!;
            const px = p.x + (ci + di - ii) * cell;
            const py = p.y + (cj + dj - jj) * cell;
            const dd = (x - px) * (x - px) + (y - py) * (y - py);
            if (dd < d1) {
              d2 = d1;
              d1 = dd;
              best = jj * G + ii;
            } else if (dd < d2) d2 = dd;
          }
        const edge = Math.sqrt(d2) - Math.sqrt(d1); // ≈ 2 × distance to the joint
        const p = pts[best]!;
        const o = (y * S + x) * 4;
        if (edge < 5) {
          // recessed joint #2e2d2a
          d[o] = 46;
          d[o + 1] = 45;
          d[o + 2] = 42;
        } else {
          // rounded stone edge: darker near the joint, slight surface noise
          const k = Math.min(1, (edge - 5) / 18);
          const n = (r() - 0.5) * 10;
          const v = p.v * (0.72 + 0.28 * k) + n;
          d[o] = v + p.warm * 0.6;
          d[o + 1] = v - 1;
          d[o + 2] = v - p.warm * 0.6 - 3;
        }
        d[o + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    // vesicles (gas bubbles) typical of basalt
    for (let k = 0; k < 900; k++) {
      g.fillStyle = `rgba(20,19,18,${0.35 + r() * 0.35})`;
      g.beginPath();
      g.arc(r() * S, r() * S, 0.8 + r() * 2.2, 0, Math.PI * 2);
      g.fill();
    }
    speckle(g, S, S, r, 2500, 0.07);
    return finish("lava", c);
  });
}

/**
 * Plaza paving (P1-WLD-03): honed granite slabs 0.6 × 1.2 m in stretcher bond with only ±4 % tone variance (no
 * checkerboard), fine grain and slightly worn arrises. Large-scale grime / wear comes from `pavingWearTexture`.
 * 1 UV unit = 4.8 m (4 slabs across, 8 courses).
 */
export function pavingTexture(): THREE.CanvasTexture {
  return cached("paving", () => {
    const S = 512;
    const { c, g } = canvas(S, S);
    const r = rng(5);
    g.fillStyle = "#8e8981"; // joint
    g.fillRect(0, 0, S, S);
    const w = S / 4;
    const h = S / 8;
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? w / 2 : 0;
      for (let k = -1; k < 5; k++) {
        const v = 196 * (1 + (r() - 0.5) * 0.08);
        g.fillStyle = `rgb(${v},${v - 5},${v - 12})`;
        g.fillRect(k * w + off + 1, row * h + 1, w - 2, h - 2);
      }
    }
    speckle(g, S, S, r, 9000, 0.09, false);
    speckle(g, S, S, r, 5000, 0.07);
    // a few darker mineral flecks
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(40,38,36,${0.15 + r() * 0.2})`;
      g.fillRect(r() * S, r() * S, 1, 1);
    }
    return finish("paving", c);
  });
}

/**
 * Low-frequency grime and foot-traffic wear over the whole plaza (one texture across ±33 m, sampled in world space):
 * soft blotches at 8–16 m, darker worn lines from the entrance to the fountain and on to every door, and scuffed
 * rings around the benches. Grey = 1.0 (neutral) at 50 % … darker below.
 */
export function pavingWearTexture(paths: { x: number; z: number }[][], spots: { x: number; z: number; r: number }[], half = 33): THREE.CanvasTexture {
  return cached("paving-wear", () => {
    const S = 512;
    const { c, g } = canvas(S, S);
    const r = rng(17);
    const px = (x: number) => ((x + half) / (half * 2)) * S;
    g.fillStyle = "rgb(250,250,250)";
    g.fillRect(0, 0, S, S);
    // soft grime blotches (8–16 m), as many per square metre whatever the plaza size
    for (let i = 0; i < Math.round(70 * (half / 33) ** 2); i++) {
      const x = r() * S;
      const y = r() * S;
      const rad = ((4 + r() * 8) / (half * 2)) * S;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(60,55,45,${0.05 + r() * 0.07})`);
      gr.addColorStop(1, "rgba(60,55,45,0)");
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // worn walking lines (soft, ~1.6 m wide)
    g.lineCap = "round";
    g.lineJoin = "round";
    for (const [w, a] of [
      [((2.2 / (half * 2)) * S), 0.07],
      [((1.0 / (half * 2)) * S), 0.07],
    ] as const) {
      g.strokeStyle = `rgba(70,62,50,${a})`;
      g.lineWidth = w;
      for (const p of paths) {
        g.beginPath();
        p.forEach((q, i) => (i ? g.lineTo(px(q.x), px(q.z)) : g.moveTo(px(q.x), px(q.z))));
        g.stroke();
      }
    }
    for (const s of spots) {
      const rad = (s.r / (half * 2)) * S;
      const gr = g.createRadialGradient(px(s.x), px(s.z), 0, px(s.x), px(s.z), rad);
      gr.addColorStop(0, "rgba(70,62,50,0.13)");
      gr.addColorStop(1, "rgba(70,62,50,0)");
      g.fillStyle = gr;
      g.fillRect(px(s.x) - rad, px(s.z) - rad, rad * 2, rad * 2);
    }
    const t = finish("paving-wear", c, { aniso: 1, srgb: false });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Board-formed concrete (light, warm). 1 UV unit = 2 m. */
export function concreteTexture(): THREE.CanvasTexture {
  return cached("concrete", () => {
    const { c, g } = canvas(256, 256);
    const r = rng(7);
    g.fillStyle = "#cdc8bf";
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 32) {
      g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.04})`;
      g.fillRect(0, y, 256, 32);
      g.fillStyle = "rgba(0,0,0,0.12)";
      g.fillRect(0, y, 256, 1);
    }
    speckle(g, 256, 256, r, 2500, 0.08, false);
    speckle(g, 256, 256, r, 1500, 0.08);
    return finish("concrete", c);
  });
}

/** Warm timber battens / cladding. 1 UV unit = 1 m. */
export function woodTexture(): THREE.CanvasTexture {
  return cached("wood", () => {
    const { c, g } = canvas(256, 256);
    const r = rng(9);
    const boards = 8;
    for (let i = 0; i < boards; i++) {
      const base = 120 + r() * 40;
      g.fillStyle = `rgb(${base + 40},${base - 10},${base - 55})`;
      g.fillRect((i * 256) / boards, 0, 256 / boards, 256);
      for (let k = 0; k < 18; k++) {
        g.strokeStyle = `rgba(60,30,10,${0.08 + r() * 0.14})`;
        g.lineWidth = 0.6 + r();
        const x = (i * 256) / boards + r() * (256 / boards);
        g.beginPath();
        g.moveTo(x, 0);
        g.bezierCurveTo(x + r() * 4 - 2, 80, x + r() * 4 - 2, 170, x + r() * 3 - 1.5, 256);
        g.stroke();
      }
      g.fillStyle = "rgba(20,10,5,0.55)";
      g.fillRect((i * 256) / boards, 0, 2, 256);
    }
    return finish("wood", c);
  });
}

/** Terracotta brick (Rwandan fired clay). 1 UV unit = 1 m. */
export function brickTexture(): THREE.CanvasTexture {
  return cached("brick", () => {
    const { c, g } = canvas(256, 256);
    const r = rng(13);
    g.fillStyle = "#d9cbb8";
    g.fillRect(0, 0, 256, 256);
    const rows = 16;
    const bh = 256 / rows;
    for (let y = 0; y < rows; y++) {
      const off = y % 2 ? 16 : 0;
      for (let x = -1; x < 9; x++) {
        const v = r();
        g.fillStyle = `rgb(${168 + v * 40},${78 + v * 22},${48 + v * 14})`;
        g.fillRect(x * 32 + off + 1, y * bh + 1, 30, bh - 2);
      }
    }
    speckle(g, 256, 256, r, 1200, 0.1, false);
    return finish("brick", c);
  });
}

/**
 * Curtain wall (P1-WLD-03): neutral dark glazing (#1f2b33, reflections come from the sky environment, no baked
 * sunset gradient) in a slim aluminium mullion grid. A sparse emissive mask lights ~12 % of the panes with a soft
 * warm interior glow (#e9d3ae, brighter towards the ceiling) — the rest stay dark. 1 UV unit = 6 m (4 × 4 bays of
 * 1.5 m, each split by a transom), so the lit panes don't repeat in an obvious grid.
 */
export function curtainWallTextures(seed = 3): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const key = `curtain3-${seed}`;
  const hit = cache.get(key);
  const hitE = cache.get(`${key}-e`);
  if (hit && hitE) return { map: hit as THREE.CanvasTexture, emissive: hitE as THREE.CanvasTexture };
  const r = rng(seed);
  const S = 512;
  const B = S / 4;
  const { c, g } = canvas(S, S);
  const { c: ce, g: ge } = canvas(S, S);
  g.fillStyle = "#1f2b33";
  g.fillRect(0, 0, S, S);
  ge.fillStyle = "#000";
  ge.fillRect(0, 0, S, S);
  for (let by = 0; by < 4; by++)
    for (let bx = 0; bx < 4; bx++)
      for (const [y0, hh] of [
        [3, 82],
        [88, 37],
      ] as const) {
        const x = bx * B + 3;
        const y = by * B + y0;
        const v = 0.92 + r() * 0.08; // tiny pane-to-pane tint differences
        g.fillStyle = `rgb(${Math.round(31 * v)},${Math.round(43 * v)},${Math.round(51 * v)})`;
        g.fillRect(x, y, B - 6, hh);
        if (r() < 0.12) {
          const warm = ge.createLinearGradient(x, y, x, y + hh);
          warm.addColorStop(0, "rgba(233,211,174,0.9)");
          warm.addColorStop(0.5, "rgba(233,211,174,0.5)");
          warm.addColorStop(1, "rgba(233,211,174,0.28)");
          ge.fillStyle = warm;
          ge.fillRect(x, y, B - 6, hh);
        }
      }
  g.fillStyle = "#9aa1a8";
  for (let k = 0; k <= 4; k++) {
    const p = Math.min(S - 3, k * B - 1.5);
    g.fillRect(p, 0, 3, S);
    g.fillRect(0, p, S, 3);
  }
  for (let by = 0; by < 4; by++) g.fillRect(0, by * B + 86, S, 2);
  const map = finish(key, c);
  const emissive = finish(`${key}-e`, ce);
  return { map, emissive };
}

/** Grass with clover and soil noise. 1 UV unit = 6 m. */
export function grassTexture(): THREE.CanvasTexture {
  return cached("grass", () => {
    const { c, g } = canvas(256, 256);
    const r = rng(21);
    g.fillStyle = "#4f8a3c";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) {
      const v = r();
      g.fillStyle = v > 0.6 ? "rgba(140,190,90,0.35)" : v > 0.2 ? "rgba(40,90,35,0.35)" : "rgba(70,55,30,0.25)";
      g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 2 + r() * 3);
    }
    return finish("grass", c);
  });
}

/** Soft cloud / mist puff with alpha. Used for mist layers and cloud caps on volcano summits. */
export function mistTexture(): THREE.CanvasTexture {
  return cached("mist", () => {
    const { c, g } = canvas(512, 256);
    const r = rng(33);
    g.clearRect(0, 0, 512, 256);
    for (let i = 0; i < 70; i++) {
      const x = 40 + r() * 432;
      const y = 90 + r() * 80;
      const rad = 30 + r() * 70;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, "rgba(255,255,255,0.22)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    }
    // fade the horizontal edges so the strip tiles invisibly
    g.globalCompositeOperation = "destination-in";
    const edge = g.createLinearGradient(0, 0, 512, 0);
    edge.addColorStop(0, "rgba(0,0,0,0)");
    edge.addColorStop(0.15, "rgba(0,0,0,1)");
    edge.addColorStop(0.85, "rgba(0,0,0,1)");
    edge.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = edge;
    g.fillRect(0, 0, 512, 256);
    g.globalCompositeOperation = "source-over";
    const t = finish("mist", c, { aniso: 1 });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Circular soft blob (contact shadow under avatars, lamp glows). */
export function blobTexture(): THREE.CanvasTexture {
  return cached("blob", () => {
    const { c, g } = canvas(128, 128);
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.5)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const t = finish("blob", c, { aniso: 1 });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

export type IconKind = "pool" | "ludo" | "igisoro" | "arena" | "soon";

/** Vector game icons drawn on canvas (no emoji glyphs in 3D, they depend on system fonts). */
function drawIcon(g: CanvasRenderingContext2D, kind: IconKind, cx: number, cy: number, s: number, color: string) {
  g.save();
  g.translate(cx, cy);
  g.lineWidth = s * 0.06;
  g.strokeStyle = "#ffffff";
  g.fillStyle = "#ffffff";
  if (kind === "pool") {
    g.fillStyle = "#111";
    g.beginPath();
    g.arc(0, 0, s * 0.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(0, -s * 0.06, s * 0.24, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#111";
    g.font = `900 ${s * 0.32}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("8", 0, -s * 0.04);
    g.fillStyle = "rgba(255,255,255,0.5)";
    g.beginPath();
    g.ellipse(-s * 0.22, -s * 0.28, s * 0.1, s * 0.05, -0.6, 0, Math.PI * 2);
    g.fill();
  } else if (kind === "ludo") {
    g.fillStyle = "#fff";
    const w = s * 0.9;
    g.beginPath();
    g.roundRect(-w / 2, -w / 2, w, w, s * 0.16);
    g.fill();
    g.fillStyle = color;
    for (const [x, y] of [
      [-0.22, -0.22],
      [0.22, 0.22],
      [0.22, -0.22],
      [-0.22, 0.22],
      [0, 0],
    ] as const) {
      g.beginPath();
      g.arc(x * s, y * s, s * 0.08, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === "igisoro") {
    g.fillStyle = "#8a5a33";
    g.beginPath();
    g.roundRect(-s * 0.55, -s * 0.32, s * 1.1, s * 0.64, s * 0.1);
    g.fill();
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 4; col++) {
        const x = -s * 0.39 + col * s * 0.26;
        const y = -s * 0.13 + row * s * 0.26;
        g.fillStyle = "#3d2412";
        g.beginPath();
        g.arc(x, y, s * 0.1, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#e9d8b4";
        g.beginPath();
        g.arc(x - s * 0.02, y, s * 0.035, 0, Math.PI * 2);
        g.arc(x + s * 0.03, y + s * 0.02, s * 0.035, 0, Math.PI * 2);
        g.fill();
      }
  } else if (kind === "arena") {
    g.fillStyle = "#FFC83D";
    g.beginPath();
    g.moveTo(-s * 0.34, -s * 0.42);
    g.lineTo(s * 0.34, -s * 0.42);
    g.quadraticCurveTo(s * 0.34, s * 0.05, 0, s * 0.12);
    g.quadraticCurveTo(-s * 0.34, s * 0.05, -s * 0.34, -s * 0.42);
    g.fill();
    g.fillRect(-s * 0.06, s * 0.1, s * 0.12, s * 0.2);
    g.fillRect(-s * 0.24, s * 0.3, s * 0.48, s * 0.1);
    g.strokeStyle = "#FFC83D";
    g.beginPath();
    g.arc(-s * 0.36, -s * 0.24, s * 0.14, Math.PI * 0.5, Math.PI * 1.5);
    g.arc(s * 0.36, -s * 0.24, s * 0.14, -Math.PI * 0.5, Math.PI * 0.5);
    g.stroke();
  } else {
    g.strokeStyle = "rgba(255,255,255,0.8)";
    g.lineWidth = s * 0.08;
    g.beginPath();
    g.arc(0, 0, s * 0.42, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -s * 0.28);
    g.moveTo(0, 0);
    g.lineTo(s * 0.2, s * 0.1);
    g.stroke();
  }
  g.restore();
}

/** What you see through an arena door: a lit interior glimpse in the game's colour with its icon. */
export function doorPreviewTexture(kind: IconKind, color: string, label: string): THREE.CanvasTexture {
  const key = `door-${kind}-${color}-${label}`;
  return cached(key, () => {
    const { c, g } = canvas(256, 384);
    const grad = g.createLinearGradient(0, 0, 0, 384);
    grad.addColorStop(0, "#0b0d1a");
    grad.addColorStop(0.55, color);
    grad.addColorStop(1, "#0b0d1a");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 384);
    // perspective floor lines of the concourse behind the doors
    g.strokeStyle = "rgba(255,255,255,0.18)";
    g.lineWidth = 2;
    for (let i = -5; i <= 5; i++) {
      g.beginPath();
      g.moveTo(128 + i * 8, 250);
      g.lineTo(128 + i * 60, 384);
      g.stroke();
    }
    for (let i = 0; i < 5; i++) {
      g.fillStyle = "rgba(255,236,200,0.85)";
      g.beginPath();
      g.ellipse(48 + i * 40, 40, 10, 4, 0, 0, Math.PI * 2);
      g.fill();
    }
    drawIcon(g, kind, 128, 165, 120, color);
    g.fillStyle = "rgba(255,255,255,0.92)";
    g.font = "800 26px system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText(label.toUpperCase(), 128, 300);
    const t = finish(key, c, { aniso: 4 });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Animated LED screen content for the arena (scrolls via texture offset). */
export function arenaScreenTexture(): THREE.CanvasTexture {
  return ledScreenTexture("arena-screen", ["TOURNAMENT ARENA", "LIVE FINALS SOON", "GUKIRANA PLAYGROUND", "PLAY  MEET  WIN"]);
}

/** 4-message LED screen strip (2048×150; show one quarter at a time with repeat.x = 0.25). */
export function ledScreenTexture(key: string, msgs: [string, string, string, string]): THREE.CanvasTexture {
  return cached(key, () => {
    const { c, g } = canvas(2048, 150);
    const grad = g.createLinearGradient(0, 0, 2048, 0);
    grad.addColorStop(0, "#22266E");
    grad.addColorStop(0.25, "#9B51E0");
    grad.addColorStop(0.5, "#2F80ED");
    grad.addColorStop(0.75, "#9B51E0");
    grad.addColorStop(1, "#22266E");
    g.fillStyle = grad;
    g.fillRect(0, 0, 2048, 150);
    g.fillStyle = "rgba(0,0,0,0.25)";
    for (let y = 0; y < 150; y += 4) g.fillRect(0, y, 2048, 1);
    g.textAlign = "center";
    g.textBaseline = "middle";
    msgs.forEach((m, i) => {
      g.fillStyle = i % 2 ? "#FFC83D" : "#ffffff";
      g.font = "900 62px system-ui, sans-serif";
      g.fillText(m, 256 + i * 512, 78, 480);
    });
    const t = finish(key, c, { aniso: 4 });
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Construction hoarding print for coming-soon pavilions (aspect ≈ 1.7, one print per fence panel). */
export function hoardingTexture(): THREE.CanvasTexture {
  return cached("hoarding", () => {
    const { c, g } = canvas(512, 300);
    g.fillStyle = "#22266E";
    g.fillRect(0, 0, 512, 300);
    for (let i = 0; i < 16; i++) {
      g.fillStyle = i % 2 ? "#FFC83D" : "#B5532A";
      g.beginPath();
      g.moveTo(i * 32, 300);
      g.lineTo(i * 32 + 16, 262);
      g.lineTo(i * 32 + 32, 300);
      g.fill();
    }
    g.fillStyle = "rgba(255,255,255,0.95)";
    g.textAlign = "center";
    g.font = "900 64px system-ui, sans-serif";
    g.fillText("NEW GAMES", 256, 120);
    g.fillStyle = "#FFC83D";
    g.font = "800 44px system-ui, sans-serif";
    g.fillText("BUILDING NOW", 256, 190);
    const t = finish("hoarding", c, { aniso: 4 });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Agaseke basket weave: natural sisal with black and red-ochre zig-zag bands. */
export function agasekeTexture(): THREE.CanvasTexture {
  return cached("agaseke", () => {
    const { c, g } = canvas(256, 512);
    const r = rng(17);
    g.fillStyle = "#d8bd86";
    g.fillRect(0, 0, 256, 512);
    for (let y = 0; y < 512; y += 4) {
      g.fillStyle = `rgba(120,85,40,${0.12 + r() * 0.12})`;
      g.fillRect(0, y, 256, 1.5);
    }
    const band = (y0: number, h: number, col: string, teeth: number) => {
      g.fillStyle = col;
      const w = 256 / teeth;
      for (let i = 0; i < teeth; i++) {
        g.beginPath();
        g.moveTo(i * w, y0 + h);
        g.lineTo(i * w + w / 2, y0);
        g.lineTo(i * w + w, y0 + h);
        g.fill();
      }
    };
    band(400, 40, "#1B1B1B", 8);
    band(330, 26, "#B5532A", 10);
    band(170, 30, "#1B1B1B", 10);
    band(90, 22, "#B5532A", 12);
    return finish("agaseke", c, { aniso: 4 });
  });
}

/* ---------- avatar fabric prints ---------- */

export type PrintId = "kitenge-sun" | "kitenge-leaf" | "kitenge-wave" | "imigongo-cloth" | "mushanana-gold" | "plaid";

/** Kitenge-style wax prints and Imishanana-inspired borders (original patterns, not copies of a real fabric). */
export function fabricTexture(id: PrintId): THREE.CanvasTexture {
  return cached(`fabric-${id}`, () => {
    const { c, g } = canvas(256, 256);
    const r = rng(id.length * 31 + id.charCodeAt(8));
    if (id === "kitenge-sun") {
      g.fillStyle = "#E85D1C";
      g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          const cx = x * 64 + (y % 2) * 32 + 16;
          const cy = y * 64 + 32;
          g.fillStyle = "#FFC83D";
          g.beginPath();
          g.arc(cx, cy, 22, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = "#2a1a5e";
          g.lineWidth = 4;
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            g.beginPath();
            g.moveTo(cx + Math.cos(a) * 14, cy + Math.sin(a) * 14);
            g.lineTo(cx + Math.cos(a) * 28, cy + Math.sin(a) * 28);
            g.stroke();
          }
          g.fillStyle = "#2a1a5e";
          g.beginPath();
          g.arc(cx, cy, 8, 0, Math.PI * 2);
          g.fill();
        }
    } else if (id === "kitenge-leaf") {
      g.fillStyle = "#0E6B5C";
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 18; i++) {
        const cx = r() * 256;
        const cy = r() * 256;
        const a = r() * Math.PI;
        g.save();
        g.translate(cx, cy);
        g.rotate(a);
        g.fillStyle = i % 3 ? "#F2B134" : "#F4EFE6";
        g.beginPath();
        g.ellipse(0, 0, 30, 12, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = "#0E6B5C";
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(-28, 0);
        g.lineTo(28, 0);
        g.stroke();
        g.restore();
      }
    } else if (id === "kitenge-wave") {
      g.fillStyle = "#1F3C88";
      g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 256; y += 32) {
        g.strokeStyle = y % 64 ? "#F4EFE6" : "#E8A33D";
        g.lineWidth = 8;
        g.beginPath();
        for (let x = 0; x <= 256; x += 8) g.lineTo(x, y + 16 + Math.sin((x / 256) * Math.PI * 4) * 9);
        g.stroke();
      }
    } else if (id === "imigongo-cloth") {
      const t = imigongoDiamondTexture("#1B1B1B", "#B5532A", "#F4EFE6");
      g.drawImage(t.image as HTMLCanvasElement, 0, 0, 256, 256);
    } else if (id === "mushanana-gold") {
      g.fillStyle = "#F3E3C3";
      g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 256; y += 6) {
        g.fillStyle = `rgba(200,160,90,${0.12 + r() * 0.1})`;
        g.fillRect(0, y, 256, 2);
      }
      g.fillStyle = "#C8952F";
      g.fillRect(0, 200, 256, 26);
      g.fillStyle = "#7A1F2B";
      for (let x = 0; x < 256; x += 16) {
        g.beginPath();
        g.moveTo(x, 226);
        g.lineTo(x + 8, 206);
        g.lineTo(x + 16, 226);
        g.fill();
      }
    } else {
      g.fillStyle = "#3a3f5c";
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 256; i += 32) {
        g.fillStyle = "rgba(255,255,255,0.12)";
        g.fillRect(i, 0, 10, 256);
        g.fillRect(0, i, 256, 10);
        g.fillStyle = "rgba(229,57,53,0.35)";
        g.fillRect(i + 14, 0, 3, 256);
        g.fillRect(0, i + 14, 256, 3);
      }
    }
    return finish(`fabric-${id}`, c, { aniso: 4 });
  });
}

/**
 * Grass thatch (P1-WLD-03): dense dry-grass fibres (#a08560) laid in overlapping courses, each course's butt ends
 * casting a soft shadow line. u runs around the roof, v down the slope. 1 UV unit ≈ 1.2 m of roof.
 */
export function thatchTexture(): THREE.CanvasTexture {
  return cached("thatch", () => {
    const S = 256;
    const { c, g } = canvas(S, S);
    const r = rng(29);
    g.fillStyle = "#8e7552";
    g.fillRect(0, 0, S, S);
    const courses = 5;
    const ch = S / courses;
    for (let k = 0; k < courses; k++) {
      const y0 = k * ch;
      for (let i = 0; i < 1300; i++) {
        const x = r() * S;
        const y = y0 - ch * 0.35 + r() * ch * 1.25;
        const len = ch * (0.5 + r() * 0.7);
        const tone = 125 + r() * 70;
        g.strokeStyle = `rgba(${tone + 22},${tone + 2},${tone - 38},${0.35 + r() * 0.45})`;
        g.lineWidth = 0.6 + r() * 0.9;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (r() - 0.5) * 5, y + len);
        g.stroke();
      }
      // butt-end shadow at the bottom of each course
      const sh = g.createLinearGradient(0, y0 + ch * 0.82, 0, y0 + ch);
      sh.addColorStop(0, "rgba(40,28,15,0)");
      sh.addColorStop(1, "rgba(40,28,15,0.42)");
      g.fillStyle = sh;
      g.fillRect(0, y0 + ch * 0.82, S, ch * 0.18);
    }
    return finish("thatch", c);
  });
}

/** Round game badge for the small sign above each hall door (transparent outside the disc). */
export function doorBadgeTexture(kind: IconKind, color: string): THREE.CanvasTexture {
  const key = `badge-${kind}-${color}`;
  return cached(key, () => {
    const { c, g } = canvas(128, 128);
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = "#1a1c22";
    g.beginPath();
    g.arc(64, 64, 62, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = color;
    g.lineWidth = 5;
    g.beginPath();
    g.arc(64, 64, 57, 0, Math.PI * 2);
    g.stroke();
    drawIcon(g, kind, 64, 64, 70, color);
    const t = finish(key, c, { aniso: 4 });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/**
 * Out-of-focus view into a hall, seen at the back of the entrance vestibule. Painted tiny (96 × 64) and upscaled
 * with linear filtering, which gives a natural defocus without any blur pass.
 */
export function hallGlimpseTexture(kind: IconKind): THREE.CanvasTexture {
  const key = `glimpse-${kind}`;
  return cached(key, () => {
    const W = 48;
    const H = 64;
    const { c, g } = canvas(W, H);
    const pal: Record<IconKind, { wall: string; floor: string; ceil: string; table: string; lamp: string }> = {
      pool: { wall: "#3a2c22", floor: "#4a3322", ceil: "#1e1a17", table: "#1f5a36", lamp: "#ffd9a0" },
      ludo: { wall: "#b08a62", floor: "#a8723f", ceil: "#6a5038", table: "#7a4a2a", lamp: "#ffe2b0" },
      igisoro: { wall: "#a8794a", floor: "#8a5232", ceil: "#6a4a2a", table: "#5a3a22", lamp: "#ffd79a" },
      arena: { wall: "#4a4a58", floor: "#6a6a70", ceil: "#22232a", table: "#3a3a48", lamp: "#e8eeff" },
      soon: { wall: "#555", floor: "#666", ceil: "#333", table: "#444", lamp: "#ddd" },
    };
    const p = pal[kind];
    // ceiling / wall / floor bands in perspective
    g.fillStyle = p.ceil;
    g.fillRect(0, 0, W, H * 0.3);
    g.fillStyle = p.wall;
    g.fillRect(0, H * 0.3, W, H * 0.32);
    const fl = g.createLinearGradient(0, H * 0.62, 0, H);
    fl.addColorStop(0, p.floor);
    fl.addColorStop(1, "#000000");
    g.fillStyle = fl;
    g.fillRect(0, H * 0.62, W, H * 0.38);
    // tables and their warm pendant pools
    for (const [x, w, y] of [
      [8, 14, 0.6],
      [28, 16, 0.62],
      [18, 10, 0.55],
    ] as const) {
      const lg = g.createRadialGradient(x + w / 2, H * 0.36, 0, x + w / 2, H * 0.36, 7);
      lg.addColorStop(0, p.lamp);
      lg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = lg;
      g.fillRect(x - 4, H * 0.28, w + 8, 14);
      g.fillStyle = p.table;
      g.fillRect(x, H * y, w, 4);
      g.fillStyle = "rgba(0,0,0,0.5)";
      g.fillRect(x + 1, H * y + 4, 2, 5);
      g.fillRect(x + w - 3, H * y + 4, 2, 5);
    }
    // a far window band with daylight
    g.fillStyle = "rgba(220,232,240,0.45)";
    g.fillRect(4, H * 0.34, W - 8, 6);
    const t = finish(key, c, { aniso: 1 });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    return t;
  });
}

/** Brushed aluminium (vertical grain) for the backs and sides of the sign totems. */
export function brushedAluTexture(): THREE.CanvasTexture {
  return cached("brushed-alu", () => {
    const { c, g } = canvas(128, 256);
    const r = rng(41);
    g.fillStyle = "#c2c6cc";
    g.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 700; i++) {
      const v = 150 + r() * 90;
      g.fillStyle = `rgba(${v},${v + 2},${v + 6},0.35)`;
      g.fillRect(r() * 128, 0, 0.6 + r() * 0.8, 256);
    }
    return finish("brushed-alu", c);
  });
}

/** Tournament poster lightbox for the arena lobby glazing. */
export function posterTexture(title: string, sub: string, color: string): THREE.CanvasTexture {
  const key = `poster-${title}-${sub}-${color}`;
  return cached(key, () => {
    const { c, g } = canvas(128, 256);
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, "#14162a");
    gr.addColorStop(1, color);
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 256);
    drawIcon(g, "arena", 64, 92, 70, color);
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.font = "800 15px system-ui, sans-serif";
    g.fillText(title, 64, 170);
    g.font = "600 11px system-ui, sans-serif";
    g.fillStyle = "rgba(255,255,255,0.8)";
    g.fillText(sub, 64, 190);
    const t = finish(key, c, { aniso: 4 });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

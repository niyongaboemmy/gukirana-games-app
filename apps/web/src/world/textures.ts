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

/** Black volcanic lava-rock wall (typical of Musanze): irregular basalt stones with light mortar. 1 UV unit ≈ 1.2 m. */
export function lavaStoneTexture(): THREE.CanvasTexture {
  return cached("lava", () => {
    const { c, g } = canvas(512, 512);
    const r = rng(11);
    g.fillStyle = "#8b8a86";
    g.fillRect(0, 0, 512, 512);
    let y = 0;
    while (y < 512) {
      const rowH = 34 + r() * 26;
      let x = -r() * 40;
      while (x < 512) {
        const w = 40 + r() * 60;
        const shade = 26 + r() * 30;
        g.fillStyle = `rgb(${shade},${shade - 2},${shade - 4})`;
        g.beginPath();
        const inset = 3;
        g.moveTo(x + inset + r() * 6, y + inset);
        g.lineTo(x + w - inset - r() * 6, y + inset + r() * 4);
        g.lineTo(x + w - inset, y + rowH - inset - r() * 6);
        g.lineTo(x + inset + r() * 4, y + rowH - inset);
        g.closePath();
        g.fill();
        // vesicles (gas bubbles) typical of basalt
        for (let k = 0; k < 6; k++) {
          g.fillStyle = `rgba(0,0,0,${0.25 + r() * 0.3})`;
          g.beginPath();
          g.arc(x + 8 + r() * (w - 16), y + 8 + r() * (rowH - 16), 1 + r() * 2.4, 0, Math.PI * 2);
          g.fill();
        }
        x += w;
      }
      y += rowH;
    }
    speckle(g, 512, 512, r, 2500, 0.08);
    return finish("lava", c);
  });
}

/** Large-format plaza paving: honed light stone slabs with darker basalt bands. 1 UV unit = 4 m. */
export function pavingTexture(): THREE.CanvasTexture {
  return cached("paving", () => {
    const { c, g } = canvas(512, 512);
    const r = rng(5);
    g.fillStyle = "#9c968c";
    g.fillRect(0, 0, 512, 512);
    const n = 4;
    const s = 512 / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const v = 176 + r() * 26;
        g.fillStyle = `rgb(${v},${v - 6},${v - 16})`;
        g.fillRect(x * s + 1, y * s + 1, s - 2, s - 2);
      }
    speckle(g, 512, 512, r, 6000, 0.12, false);
    speckle(g, 512, 512, r, 3000, 0.1);
    return finish("paving", c);
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
 * Curtain wall: mullion grid + interior seen through glass. Lit panes (warm) are encoded in an emissive map so the
 * building glows at dusk without any real lights. 1 UV unit = one 1.5 m bay.
 */
export function curtainWallTextures(tint: string, seed = 3): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const key = `curtain-${tint}-${seed}`;
  const hit = cache.get(key);
  const hitE = cache.get(`${key}-e`);
  if (hit && hitE) return { map: hit as THREE.CanvasTexture, emissive: hitE as THREE.CanvasTexture };
  const r = rng(seed);
  const { c, g } = canvas(256, 256);
  const { c: ce, g: ge } = canvas(256, 256);
  g.fillStyle = "#1d2430";
  g.fillRect(0, 0, 256, 256);
  ge.fillStyle = "#000";
  ge.fillRect(0, 0, 256, 256);
  // two bays per tile
  for (let by = 0; by < 2; by++)
    for (let bx = 0; bx < 2; bx++) {
      const x = bx * 128;
      const y = by * 128;
      const grad = g.createLinearGradient(x, y, x + 128, y + 128);
      grad.addColorStop(0, "#5f7d96");
      grad.addColorStop(0.55, "#2c3d52");
      grad.addColorStop(1, "#435a70");
      g.fillStyle = grad;
      g.fillRect(x + 4, y + 4, 120, 120);
      if (r() > 0.35) {
        const warm = ge.createLinearGradient(x, y + 128, x, y);
        warm.addColorStop(0, tint);
        warm.addColorStop(0.5, "rgba(255,214,160,0.75)");
        warm.addColorStop(1, "rgba(255,214,160,0.15)");
        ge.fillStyle = warm;
        ge.globalAlpha = 0.35 + r() * 0.5;
        ge.fillRect(x + 4, y + 4, 120, 120);
        ge.globalAlpha = 1;
      }
    }
  g.fillStyle = "#c8ccd2";
  for (const p of [0, 126, 254]) {
    g.fillRect(p, 0, 4, 256);
    g.fillRect(0, p, 256, 4);
  }
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

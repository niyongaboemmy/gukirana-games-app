import * as THREE from "three";
import { sessionMemo } from "@/world/session-cache";

/**
 * Procedural interior textures (canvas, generated once per room). Photographic PBR sets come from
 * /public/assets/interiors (CC0, see docs/ASSET-LICENSES.md); these cover what no stock texture has:
 * Imigongo and Kitenge patterns, the Ludo board, numbered pool balls, signage and soft shadow blobs.
 */
function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d")! };
}
function tex(c: HTMLCanvasElement, repeat: [number, number] = [1, 1], srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}
// deterministic pseudo-noise (cosmetic only)
const n = (i: number) => {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** Soft radial falloff (white centre → transparent edge). Tinted black = contact shadow, tinted warm + additive = light pool. */
let blob: THREE.CanvasTexture | null = null;
export function blobTexture(): THREE.CanvasTexture {
  if (blob) return blob;
  const { c, g } = canvas(128, 128);
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.45, "rgba(255,255,255,.7)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  blob = tex(c);
  blob.wrapS = blob.wrapT = THREE.ClampToEdgeWrapping;
  return blob;
}

/** Imigongo: concentric diamonds and zig-zags in black / white / red-ochre (DESIGN-SPEC §5.2). */
function imigongoBuild(repeat: [number, number], dark = "#1B1B1B", accent = "#B5532A", light = "#F4EFE6"): THREE.CanvasTexture {
  const { c, g } = canvas(256, 256);
  g.fillStyle = light;
  g.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 4; row++)
    for (let i = 0; i < 4; i++) {
      const x = i * 64;
      const y = row * 64;
      g.fillStyle = (i + row) % 2 ? accent : dark;
      g.beginPath();
      g.moveTo(x + 32, y + 4);
      g.lineTo(x + 60, y + 32);
      g.lineTo(x + 32, y + 60);
      g.lineTo(x + 4, y + 32);
      g.fill();
      g.fillStyle = light;
      g.beginPath();
      g.moveTo(x + 32, y + 18);
      g.lineTo(x + 46, y + 32);
      g.lineTo(x + 32, y + 46);
      g.lineTo(x + 18, y + 32);
      g.fill();
    }
  return tex(c, repeat);
}

/** Large Imigongo wall panel: stepped zig-zag bands + nested diamonds, with a raised-relief look (painted cow-dung clay). */
function imigongoPanelBuild(variant: number): THREE.CanvasTexture {
  const { c, g } = canvas(512, 1024);
  const K = "#1B1B1B";
  const W = "#EFE7D8";
  const O = "#A9492A";
  g.fillStyle = K;
  g.fillRect(0, 0, 512, 1024);
  if (variant % 2 === 0) {
    // stacked chevrons
    const bands = 9;
    const bh = 1024 / bands;
    for (let b = 0; b < bands; b++) {
      g.fillStyle = b % 3 === 1 ? O : W;
      const y = b * bh;
      for (let k = 0; k < 4; k++) {
        const x0 = k * 128;
        g.beginPath();
        g.moveTo(x0, y + bh * 0.25);
        g.lineTo(x0 + 64, y + bh * 0.75);
        g.lineTo(x0 + 128, y + bh * 0.25);
        g.lineTo(x0 + 128, y + bh * 0.48);
        g.lineTo(x0 + 64, y + bh * 0.98);
        g.lineTo(x0, y + bh * 0.48);
        g.fill();
      }
    }
  } else {
    // nested diamonds lattice
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 2; k++) {
        const cx = 128 + k * 256;
        const cy = 128 + r * 256;
        for (let s = 5; s > 0; s--) {
          g.fillStyle = s % 2 ? (s === 3 ? O : W) : K;
          const q = s * 24;
          g.beginPath();
          g.moveTo(cx, cy - q);
          g.lineTo(cx + q, cy);
          g.lineTo(cx, cy + q);
          g.lineTo(cx - q, cy);
          g.fill();
        }
      }
    g.fillStyle = O;
    for (let r = 0; r <= 4; r++) g.fillRect(0, r * 256 - 6, 512, 12);
  }
  // relief: soft shading along edges + clay grain
  const img = g.getImageData(0, 0, 512, 1024);
  const d = img.data;
  for (let y = 1; y < 1024; y++)
    for (let x = 1; x < 512; x++) {
      const i = (y * 512 + x) * 4;
      const up = ((y - 1) * 512 + x) * 4;
      const lum = d[i]! - d[up]!;
      const k = lum > 40 ? 1.12 : lum < -40 ? 0.72 : 1;
      const grain = 0.94 + n(x * 3.1 + y * 7.7) * 0.1;
      d[i] = Math.min(255, d[i]! * k * grain);
      d[i + 1] = Math.min(255, d[i + 1]! * k * grain);
      d[i + 2] = Math.min(255, d[i + 2]! * k * grain);
    }
  g.putImageData(img, 0, 0);
  return tex(c);
}

/** Tournament billiard cloth: fine fibre noise over a base colour. */
function feltTextureBuild(color: string): THREE.CanvasTexture {
  const { c, g } = canvas(512, 256);
  g.fillStyle = color;
  g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 26000; i++) {
    const v = n(i);
    g.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.07})` : `rgba(0,0,0,${v * 0.1})`;
    g.fillRect(n(i * 3) * 512, n(i * 5) * 256, 1 + (i % 3 === 0 ? 1 : 0), 1);
  }
  // faint table-brush direction
  for (let y = 0; y < 256; y += 2) {
    g.fillStyle = `rgba(0,0,0,${0.015 + n(y) * 0.02})`;
    g.fillRect(0, y, 512, 1);
  }
  return tex(c, [3, 1.5]);
}

const BALL = ["#f4f1e6", "#f2c200", "#1d4fbf", "#d42a26", "#4a2a85", "#ee7a12", "#127a3e", "#7a1a1e", "#111111", "#f2c200", "#1d4fbf", "#d42a26", "#4a2a85", "#ee7a12", "#127a3e", "#7a1a1e"];
/** 4 × 4 atlas of numbered pool balls (0 = cue ball), equirectangular per cell. */
function ballAtlasBuild(): THREE.CanvasTexture {
  const CW = 256;
  const CH = 128;
  const { c, g } = canvas(CW * 4, CH * 4);
  for (let b = 0; b < 16; b++) {
    const x = (b % 4) * CW;
    const y = Math.floor(b / 4) * CH;
    const stripe = b >= 9;
    g.fillStyle = stripe ? "#f4f1e6" : BALL[b]!;
    g.fillRect(x, y, CW, CH);
    if (stripe) {
      g.fillStyle = BALL[b]!;
      g.fillRect(x, y + CH * 0.27, CW, CH * 0.46);
    }
    if (b > 0)
      for (const u of [0.25, 0.75]) {
        g.fillStyle = "#f8f6ee";
        g.beginPath();
        g.ellipse(x + CW * u, y + CH / 2, CH * 0.2, CH * 0.17, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#111";
        g.font = `bold ${CH * 0.22}px Arial, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(String(b), x + CW * u, y + CH / 2 + 1);
      }
    else {
      g.fillStyle = "#c33";
      g.beginPath();
      g.arc(x + CW * 0.25, y + CH / 2, 4, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Hand-knotted club rug (pool hall): deep oxblood field, navy border, medallion. */
function clubRugBuild(): THREE.CanvasTexture {
  const { c, g } = canvas(512, 384);
  g.fillStyle = "#4a1518";
  g.fillRect(0, 0, 512, 384);
  g.strokeStyle = "#1c2238";
  g.lineWidth = 26;
  g.strokeRect(13, 13, 486, 358);
  g.strokeStyle = "#b08a4a";
  g.lineWidth = 3;
  g.strokeRect(32, 32, 448, 320);
  g.strokeRect(6, 6, 500, 372);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = "#b08a4a";
    const t = i / 40;
    g.beginPath();
    g.arc(13 + t * 486, 13, 4, 0, Math.PI * 2);
    g.arc(13 + t * 486, 371, 4, 0, Math.PI * 2);
    g.fill();
  }
  // subtle all-over lattice field (no bold medallion)
  for (let y = 48; y < 340; y += 24)
    for (let x = 48; x < 470; x += 24) {
      g.fillStyle = (x / 24 + y / 24) % 2 ? "rgba(28,34,56,.55)" : "rgba(122,52,40,.45)";
      g.beginPath();
      g.moveTo(x, y - 8);
      g.lineTo(x + 8, y);
      g.lineTo(x, y + 8);
      g.lineTo(x - 8, y);
      g.fill();
    }
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(0,0,0,${n(i) * 0.12})`;
    g.fillRect(n(i * 3) * 512, n(i * 5) * 384, 2, 1);
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Kitenge (African wax print) inspired pattern for rugs and cushions in the Ludo Lounge. */
function kitengeBuild(palette: string[], repeat: [number, number] = [1, 1]): THREE.CanvasTexture {
  const { c, g } = canvas(512, 512);
  const [bg, a, b, cc, d] = palette as [string, string, string, string, string];
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 512);
  for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) {
      const x = k * 128 + (r % 2) * 64;
      const y = r * 128 + 64;
      // concentric "sun" circles
      for (let s = 5; s > 0; s--) {
        g.fillStyle = [a, b, cc, d, bg][s % 5]!;
        g.beginPath();
        g.arc(x, y, s * 10, 0, Math.PI * 2);
        g.fill();
      }
      // leaf petals
      g.fillStyle = d;
      for (let p = 0; p < 6; p++) {
        const ang = (p / 6) * Math.PI * 2;
        g.beginPath();
        g.ellipse(x + Math.cos(ang) * 46, y + Math.sin(ang) * 46, 12, 5, ang, 0, Math.PI * 2);
        g.fill();
      }
    }
  // zig-zag dividers
  g.strokeStyle = cc;
  g.lineWidth = 5;
  for (let r = 0; r <= 4; r++) {
    g.beginPath();
    for (let x = 0; x <= 512; x += 16) g.lineTo(x, r * 128 + (x % 32 ? 6 : -6));
    g.stroke();
  }
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = `rgba(0,0,0,${n(i) * 0.08})`;
    g.fillRect(n(i * 3) * 512, n(i * 5) * 512, 1, 1);
  }
  return tex(c, repeat);
}

/** Top of a Ludo table (classic cross layout, colour-blind-safe corners). */
function ludoBoardBuild(): THREE.CanvasTexture {
  const { c, g } = canvas(512, 512);
  const s = 512 / 15;
  const cols = ["#E53935", "#43A047", "#FDD835", "#1E88E5"];
  g.fillStyle = "#f4efe6";
  g.fillRect(0, 0, 512, 512);
  [
    [0, 0],
    [0, 9],
    [9, 9],
    [9, 0],
  ].forEach(([r, cc], i) => {
    g.fillStyle = cols[i]!;
    g.fillRect(cc! * s, r! * s, 6 * s, 6 * s);
    g.fillStyle = "#fff";
    g.fillRect(cc! * s + s, r! * s + s, 4 * s, 4 * s);
    g.fillStyle = cols[i]!;
    for (const [dx, dy] of [
      [1.9, 1.9],
      [4.1, 1.9],
      [1.9, 4.1],
      [4.1, 4.1],
    ]) {
      g.beginPath();
      g.arc((cc! + dx!) * s, (r! + dy!) * s, s * 0.55, 0, Math.PI * 2);
      g.fill();
    }
  });
  g.strokeStyle = "rgba(0,0,0,.3)";
  g.lineWidth = 1.5;
  for (let r = 0; r < 15; r++)
    for (let cc = 0; cc < 15; cc++) {
      const inArm = (r >= 6 && r <= 8) || (cc >= 6 && cc <= 8);
      const inBase = (r < 6 || r > 8) && (cc < 6 || cc > 8);
      if (inArm && !inBase && !(r >= 6 && r <= 8 && cc >= 6 && cc <= 8)) g.strokeRect(cc * s, r * s, s, s);
    }
  for (let k = 1; k < 6; k++) {
    g.fillStyle = cols[0]!;
    g.fillRect(k * s, 7 * s, s, s);
    g.fillStyle = cols[1]!;
    g.fillRect(7 * s, k * s, s, s);
    g.fillStyle = cols[2]!;
    g.fillRect((14 - k) * s, 7 * s, s, s);
    g.fillStyle = cols[3]!;
    g.fillRect(7 * s, (14 - k) * s, s, s);
  }
  const ctr = 7.5 * s;
  cols.forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(ctr, ctr);
    const a = (Math.PI / 2) * i + Math.PI;
    g.arc(ctr, ctr, 1.5 * s * Math.SQRT2, a - Math.PI / 4, a + Math.PI / 4);
    g.fill();
  });
  g.strokeStyle = "#7a5634";
  g.lineWidth = 6;
  g.strokeRect(3, 3, 506, 506);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/**
 * Baked light on a surface (emissive / additive map): warm radial pools at the given points, black elsewhere.
 * `spots` are in 0..1 surface UV; r is the radius as a fraction of the width. Used for pendant spill on dark
 * ceilings and for spotlights on the back-bar shelving, where a real light per spot would cost too much on phones.
 */
export function spillTexture(spots: { u: number; v: number; r: number; a?: number }[], aspect = 1, size = 512, base = 0): THREE.CanvasTexture {
  const w = size;
  const h = Math.max(32, Math.round(size / aspect));
  const { c, g } = canvas(w, h);
  const b = Math.round(base * 255);
  g.fillStyle = `rgb(${b},${b},${b})`; // a faint even fill = the general bounce on the surface
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "lighter";
  for (const s of spots) {
    const x = s.u * w;
    const y = (1 - s.v) * h;
    const r = s.r * w;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const a = s.a ?? 1;
    grad.addColorStop(0, `rgba(255,214,160,${a})`);
    grad.addColorStop(0.35, `rgba(255,190,120,${a * 0.55})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 2;
  return t;
}

/**
 * Daylight falling through a window wall onto the floor (additive decal): bright at the glass (v = 1), fading into
 * the room, broken by soft, slightly skewed mullion shadows. `bays` = glazing bays across.
 */
function windowLightTextureBuild(bays = 8): THREE.CanvasTexture {
  const { c, g } = canvas(1024, 256);
  const fall = g.createLinearGradient(0, 0, 0, 256);
  fall.addColorStop(0, "rgba(255,255,255,1)");
  fall.addColorStop(0.25, "rgba(255,255,255,.62)");
  fall.addColorStop(0.6, "rgba(255,255,255,.2)");
  fall.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = fall;
  g.fillRect(0, 0, 1024, 256);
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i <= bays; i++) {
    const x = (i / bays) * 1024;
    for (let k = 0; k < 3; k++) {
      // three passes of widening wedges = a soft-edged shadow without canvas filters
      g.fillStyle = "rgba(0,0,0,.28)";
      g.beginPath();
      g.moveTo(x - 3 - k * 2, 0);
      g.lineTo(x + 3 + k * 2, 0);
      g.lineTo(x + 34 + k * 6, 256);
      g.lineTo(x + 14 - k * 6, 256);
      g.fill();
    }
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Dice atlas, 3 × 2 faces (1..6 pips). */
function diceAtlasBuild(): THREE.CanvasTexture {
  const F = 128;
  const { c, g } = canvas(F * 3, F * 2);
  const pips: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [
      [0.27, 0.27],
      [0.73, 0.73],
    ],
    3: [
      [0.25, 0.25],
      [0.5, 0.5],
      [0.75, 0.75],
    ],
    4: [
      [0.27, 0.27],
      [0.73, 0.27],
      [0.27, 0.73],
      [0.73, 0.73],
    ],
    5: [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.5, 0.5],
      [0.25, 0.75],
      [0.75, 0.75],
    ],
    6: [
      [0.27, 0.22],
      [0.73, 0.22],
      [0.27, 0.5],
      [0.73, 0.5],
      [0.27, 0.78],
      [0.73, 0.78],
    ],
  };
  for (let f = 0; f < 6; f++) {
    const x = (f % 3) * F;
    const y = Math.floor(f / 3) * F;
    g.fillStyle = "#fbfaf6";
    g.fillRect(x, y, F, F);
    g.fillStyle = f === 0 ? "#c62828" : "#1b1b1b";
    for (const [px, py] of pips[f + 1]!) {
      g.beginPath();
      g.arc(x + px * F, y + py * F, F * (f === 0 ? 0.13 : 0.085), 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Leaf cluster card (alpha) for the courtyard tree canopy. */
function leafCardBuild(): THREE.CanvasTexture {
  const { c, g } = canvas(256, 256);
  g.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    const a = n(i) * Math.PI * 2;
    const r = Math.sqrt(n(i * 3)) * 100;
    const x = 128 + Math.cos(a) * r;
    const y = 128 + Math.sin(a) * r;
    const L = 14 + n(i * 7) * 12;
    const shade = 0.65 + n(i * 11) * 0.45;
    g.fillStyle = `rgb(${Math.floor(70 * shade)},${Math.floor(118 * shade)},${Math.floor(46 * shade)})`;
    g.save();
    g.translate(x, y);
    g.rotate(a + n(i * 13));
    g.beginPath();
    g.ellipse(0, 0, L, L * 0.42, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(30,50,20,.5)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-L, 0);
    g.lineTo(L, 0);
    g.stroke();
    g.restore();
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Chalk menu board for the coffee counter. */
function menuBoardBuild(): THREE.CanvasTexture {
  const { c, g } = canvas(512, 320);
  g.fillStyle = "#23272a";
  g.fillRect(0, 0, 512, 320);
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(255,255,255,${n(i) * 0.04})`;
    g.fillRect(n(i * 3) * 512, n(i * 5) * 320, 2, 2);
  }
  g.fillStyle = "#f4efe6";
  g.textAlign = "left";
  g.font = "bold 34px Georgia, serif";
  g.fillText("Ikawa · Coffee", 30, 54);
  g.font = "22px Georgia, serif";
  const items: [string, string][] = [
    ["Espresso (Musanze beans)", "1,500"],
    ["Cappuccino", "2,500"],
    ["Icyayi chai", "1,500"],
    ["Fresh passion juice", "2,000"],
    ["Sambusa (2)", "1,000"],
  ];
  items.forEach(([a, b], i) => {
    g.fillText(a, 30, 104 + i * 40);
    g.textAlign = "right";
    g.fillText(b, 482, 104 + i * 40);
    g.textAlign = "left";
  });
  g.strokeStyle = "#FF8A1F";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(30, 70);
  g.lineTo(300, 70);
  g.stroke();
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/* ---------------- session cache ----------------
 * Each canvas texture is a pure function of its arguments: generated once per session (and pre-generated in idle
 * time while you are in the plaza, rooms/preload.ts), so warming a hall as you walk up to it does not repaint
 * them inside a frame. */
const memo =
  <A extends unknown[]>(name: string, build: (...a: A) => THREE.CanvasTexture) =>
  (...a: A): THREE.CanvasTexture =>
    sessionMemo(`room-tex:${name}:${JSON.stringify(a)}`, () => build(...a));
export const imigongo = memo("imigongo", imigongoBuild);
export const imigongoPanel = memo("imigongoPanel", imigongoPanelBuild);
export const feltTexture = memo("felt", feltTextureBuild);
export const ballAtlas = memo("balls", ballAtlasBuild);
export const clubRug = memo("clubRug", clubRugBuild);
export const kitenge = memo("kitenge", kitengeBuild);
export const ludoBoard = memo("ludoBoard", ludoBoardBuild);
export const windowLightTexture = memo("windowLight", windowLightTextureBuild);
export const diceAtlas = memo("dice", diceAtlasBuild);
export const leafCard = memo("leafCard", leafCardBuild);
export const menuBoard = memo("menuBoard", menuBoardBuild);

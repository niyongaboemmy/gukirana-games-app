import * as THREE from "three";
import { sessionMemo } from "@/world/session-cache";
import { BASE_ORIGIN, HOME_COLUMN, TRACK_COORDS } from "@/games/ludo-board";
import { SAFE_SQUARES } from "@gukirana/ludo";

/**
 * Procedural textures of the Ludo Lounge (canvas, generated once per session and pre-painted in idle time while you
 * are in the plaza, rooms/preload.ts). Calm, premium palette: the four seat colours are slightly deepened (still read
 * clearly, never neon) on a warm ivory board, and each seat also has its shape (● ▲ ■ ◆, DESIGN-SPEC: colour is never
 * the only signal).
 */

/** Board seat colours (muted versions of games/ludo-board SEAT_COLORS, same order: red, green, yellow, blue). */
export const LUDO_TABLE_COLORS = ["#c4473e", "#3f8a5c", "#d9ab3c", "#3d6ba8"];

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d")! };
}
function tex(c: HTMLCanvasElement, repeat: [number, number] = [1, 1]) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const n = (i: number) => {
  const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
  return x - Math.floor(x);
};

function shape(g: CanvasRenderingContext2D, kind: number, x: number, y: number, r: number) {
  g.beginPath();
  if (kind === 0) g.arc(x, y, r, 0, Math.PI * 2);
  else if (kind === 1) {
    g.moveTo(x, y - r);
    g.lineTo(x + r * 0.95, y + r * 0.7);
    g.lineTo(x - r * 0.95, y + r * 0.7);
    g.closePath();
  } else if (kind === 2) g.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
  else {
    g.moveTo(x, y - r);
    g.lineTo(x + r, y);
    g.lineTo(x, y + r);
    g.lineTo(x - r, y);
    g.closePath();
  }
  g.fill();
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

/** The table board: the real 15 × 15 cross layout of the game screen (track, home columns, safe squares, bases). */
function ludoTableBoardBuild(): THREE.CanvasTexture {
  const S = 1024;
  const { c, g } = canvas(S, S);
  const m = 28; // walnut frame
  const s = (S - 2 * m) / 15;
  const X = (col: number) => m + col * s;
  const Y = (row: number) => m + row * s;
  const cols = LUDO_TABLE_COLORS;
  g.fillStyle = "#5a4232";
  g.fillRect(0, 0, S, S);
  g.fillStyle = "#efe8dc";
  g.fillRect(m, m, S - 2 * m, S - 2 * m);
  // bases: coloured square, ivory court, four token rings, the seat's shape in the middle
  BASE_ORIGIN.forEach(([r, cc], i) => {
    g.fillStyle = cols[i]!;
    g.fillRect(X(cc), Y(r), 6 * s, 6 * s);
    g.fillStyle = "#f6f1e8";
    g.fillRect(X(cc + 0.8), Y(r + 0.8), 4.4 * s, 4.4 * s);
    for (const [dr, dc] of [
      [1.5, 1.5],
      [1.5, 3.5],
      [3.5, 1.5],
      [3.5, 3.5],
    ] as const) {
      g.fillStyle = cols[i]!;
      g.beginPath();
      g.arc(X(cc + dc + 0.5), Y(r + dr + 0.5), s * 0.56, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,255,255,.22)";
      g.beginPath();
      g.arc(X(cc + dc + 0.5), Y(r + dr + 0.5), s * 0.36, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "rgba(60,45,35,.18)";
    shape(g, i, X(cc + 3), Y(r + 3), s * 0.42);
  });
  // track cells (white), start cells and home columns in the seat colour, stars on the safe squares
  g.lineWidth = 2;
  g.strokeStyle = "rgba(70,55,45,.35)";
  TRACK_COORDS.forEach(([r, cc], i) => {
    g.fillStyle = i % 13 === 0 ? cols[i / 13]! : "#fbf8f2";
    g.fillRect(X(cc), Y(r), s, s);
    g.strokeRect(X(cc) + 1, Y(r) + 1, s - 2, s - 2);
    if (SAFE_SQUARES.has(i) && i % 13 !== 0) {
      g.fillStyle = "rgba(90,70,55,.38)";
      star(g, X(cc + 0.5), Y(r + 0.5), s * 0.34);
    }
  });
  HOME_COLUMN.forEach((col, i) =>
    col.forEach(([r, cc]) => {
      g.fillStyle = cols[i]!;
      g.fillRect(X(cc), Y(r), s, s);
      g.strokeRect(X(cc) + 1, Y(r) + 1, s - 2, s - 2);
    }),
  );
  // centre: four triangles (home), seat order as the game screen's conic gradient
  const cx = X(7.5);
  const cy = Y(7.5);
  const corners: [number, number][] = [
    [X(6), Y(9)], // bottom-left
    [X(6), Y(6)], // top-left
    [X(9), Y(6)], // top-right
    [X(9), Y(9)], // bottom-right
  ];
  // red (seat 0) enters from the west, green from the north, yellow from the east, blue from the south
  const tri: [number, number][][] = [
    [corners[0]!, corners[1]!],
    [corners[1]!, corners[2]!],
    [corners[2]!, corners[3]!],
    [corners[3]!, corners[0]!],
  ];
  tri.forEach(([a, b], i) => {
    if (!a || !b) return;
    g.fillStyle = cols[i]!;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.closePath();
    g.fill();
  });
  // a very faint paper grain (cosmetic) keeps the print from looking flat
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(60,40,20,${n(i) * 0.05})`;
    g.fillRect(n(i * 3) * S, n(i * 5) * S, 2, 2);
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Kitenge print in the lounge's calm palette (cushions, rugs, textile art). Pattern after room-textures kitenge. */
function calmKitengeBuild(palette: string[], repeat: [number, number] = [1, 1]): THREE.CanvasTexture {
  const { c, g } = canvas(512, 512);
  const [bg, a, b, cc, d] = palette as [string, string, string, string, string];
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 512);
  for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) {
      const x = k * 128 + (r % 2) * 64;
      const y = r * 128 + 64;
      for (let st = 5; st > 0; st--) {
        g.fillStyle = [a, b, cc, d, bg][st % 5]!;
        g.beginPath();
        g.arc(x, y, st * 10, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = d;
      for (let p = 0; p < 6; p++) {
        const ang = (p / 6) * Math.PI * 2;
        g.beginPath();
        g.ellipse(x + Math.cos(ang) * 46, y + Math.sin(ang) * 46, 12, 5, ang, 0, Math.PI * 2);
        g.fill();
      }
    }
  g.strokeStyle = cc;
  g.lineWidth = 4;
  for (let r = 0; r <= 4; r++) {
    g.beginPath();
    for (let x = 0; x <= 512; x += 16) g.lineTo(x, r * 128 + (x % 32 ? 5 : -5));
    g.stroke();
  }
  // woven texture: fine fibre noise
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(0,0,0,${n(i) * 0.07})`;
    g.fillRect(n(i * 3) * 512, n(i * 5) * 512, 1.5, 1.5);
  }
  return tex(c, repeat);
}

/** Bar menu: matte charcoal board, warm ivory lettering (no orange neon underline). */
function ludoMenuBuild(): THREE.CanvasTexture {
  const { c, g } = canvas(512, 320);
  g.fillStyle = "#2b2d2e";
  g.fillRect(0, 0, 512, 320);
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(255,255,255,${n(i) * 0.03})`;
    g.fillRect(n(i * 3) * 512, n(i * 5) * 320, 2, 2);
  }
  g.fillStyle = "#e9e2d4";
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
    g.textAlign = "left";
    g.fillText(a, 30, 104 + i * 40);
    g.textAlign = "right";
    g.fillText(b, 482, 104 + i * 40);
  });
  g.strokeStyle = "#b8956a";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(30, 70);
  g.lineTo(300, 70);
  g.stroke();
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Table numbers 1–16 for the oak number blocks (4 × 4 atlas, warm ivory on walnut, matte). */
function tableNumbersBuild(): THREE.CanvasTexture {
  const C = 128;
  const { c, g } = canvas(C * 4, C * 4);
  g.fillStyle = "#4a3627";
  g.fillRect(0, 0, C * 4, C * 4);
  g.fillStyle = "#ece4d6";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "bold 76px system-ui, sans-serif";
  for (let i = 0; i < 16; i++) g.fillText(String(i + 1), (i % 4) * C + C / 2, Math.floor(i / 4) * C + C / 2 + 4);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

const memo =
  <A extends unknown[]>(name: string, build: (...a: A) => THREE.CanvasTexture) =>
  (...a: A): THREE.CanvasTexture =>
    sessionMemo(`ludo-tex:${name}:${JSON.stringify(a)}`, () => build(...a));
export const ludoTableBoard = memo("board", ludoTableBoardBuild);
export const calmKitenge = memo("kitenge", calmKitengeBuild);
export const ludoMenu = memo("menu", ludoMenuBuild);
export const tableNumbers = memo("numbers", tableNumbersBuild);

/** The lounge's Kitenge palettes: rug (sand + clay + teal), cushions / art (indigo + ochre). */
export const KITENGE_RUG = ["#e9e0cf", "#a9643f", "#3f6f69", "#c99b4f", "#3b4160"];
export const KITENGE_ART = ["#3b4160", "#c99b4f", "#a9643f", "#3f6f69", "#e9e0cf"];

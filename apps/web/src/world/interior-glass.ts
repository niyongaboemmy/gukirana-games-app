import * as THREE from "three";
import type { GeoBatch } from "./geo";
import { INTERIOR_KINDS, INTERIOR_ROOMS, interiorUV, type InteriorKind, type InteriorView } from "./interior-plan";

/**
 * Interior-mapped glass (P2-WLD-15): every glazed shopfront, door vestibule and window in the district shows a real
 * room behind it instead of a painted pane texture or a flat poster. One shader, one material, one draw call for all
 * of them (the kind and view ride in the pane's UVs, world/interior-plan.ts):
 *
 *  - the room is ray-cast per pixel in the pane's own frame (back wall, floor, ceiling with its downlights / pendants),
 *    so it has true depth and parallax as you walk past (the classic "interior mapping" technique);
 *  - two furniture cards stand at depth inside it, drawn from the hall's own furniture (atlas below), occluded by the
 *    floor exactly like real objects;
 *  - the glass itself: a slight grey-green tint, Fresnel reflection of the sky (strong at grazing angles, faint when
 *    you look straight in), thin pane frames where the facade has no mullions of its own; the open inner doorway
 *    at the end of a vestibule is not glass (no reflection);
 *  - distance LOD without popping: past ~50 m the room fades smoothly to its average colour (and the atlas mips blur
 *    it), so far facades read as lit glass, not as noisy detail.
 */

/* ------------------------------------------------------------------ furniture atlas ------------------------------------------------------------------ */

/** atlas cell (px), gutter (px), columns: near card, far card, back wall; rows: INTERIOR_KINDS (top = 0) */
const TW = 384;
const TH = 192;
const GUT = 6;
const CARD_H = 4.0;
const BACK_H = 4.8;

type Pen = {
  rect: (x: number, y: number, w: number, h: number, c: string) => void;
  poly: (pts: [number, number][], c: string | CanvasGradient) => void;
  ellipse: (x: number, y: number, rx: number, ry: number, c: string | CanvasGradient) => void;
  line: (x0: number, y0: number, x1: number, y1: number, w: number, c: string) => void;
  glow: (x: number, y: number, r: number, c: string, a: number) => void;
  cone: (x: number, yTop: number, wTop: number, yBot: number, wBot: number, a: number) => void;
  g: CanvasRenderingContext2D;
};

function cell(g: CanvasRenderingContext2D, col: number, row: number, wM: number, hM: number, opaque: string | null, draw: (p: Pen) => void) {
  const x0 = col * TW;
  const y0 = row * TH;
  g.save();
  g.beginPath();
  g.rect(x0, y0, TW, TH);
  g.clip();
  if (opaque) {
    g.fillStyle = opaque;
    g.fillRect(x0, y0, TW, TH);
  }
  // metres, y up from the floor, inside the gutter
  g.translate(x0 + GUT, y0 + TH - GUT);
  g.scale((TW - 2 * GUT) / wM, -(TH - 2 * GUT) / hM);
  const p: Pen = {
    g,
    rect: (x, y, w, h, c) => {
      g.fillStyle = c;
      g.fillRect(x, y, w, h);
    },
    poly: (pts, c) => {
      g.fillStyle = c;
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
    },
    ellipse: (x, y, rx, ry, c) => {
      g.fillStyle = c;
      g.beginPath();
      g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
    },
    line: (x0, y0, x1, y1, w, c) => {
      g.strokeStyle = c;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    },
    glow: (x, y, r, c, a) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, c);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.globalAlpha = a;
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
      g.globalAlpha = 1;
    },
    cone: (x, yTop, wTop, yBot, wBot, a) => {
      const gr = g.createLinearGradient(0, yTop, 0, yBot);
      gr.addColorStop(0, `rgba(255,226,170,${a})`);
      gr.addColorStop(1, "rgba(255,226,170,0)");
      p.poly(
        [
          [x - wTop / 2, yTop],
          [x + wTop / 2, yTop],
          [x + wBot / 2, yBot],
          [x - wBot / 2, yBot],
        ],
        gr,
      );
    },
  };
  draw(p);
  g.restore();
}

/** a pendant over a table: cord, shade and its glowing underside */
function pendant(p: Pen, x: number, y: number, w: number, shade: string, top = CARD_H) {
  for (const s of w > 0.6 ? [-1, 1] : [0]) p.line(x + s * w * 0.32, y + 0.15, x + s * w * 0.32, top, 0.012, "#151515");
  p.rect(x - w / 2, y, w, 0.16, shade);
  p.rect(x - w / 2 + 0.03, y - 0.02, w - 0.06, 0.03, "#fff4d6");
}

/** an upholstered chair seen side-on (back away from the table: `dir` = −1 left of a table, +1 right) */
function chair(p: Pen, x: number, dir: number, seat: string, frame: string) {
  p.rect(x - 0.22, 0.42, 0.44, 0.07, seat);
  p.rect(x + dir * 0.2 - 0.03, 0.42, 0.06, 0.5, seat);
  p.rect(x - 0.19, 0, 0.035, 0.42, frame);
  p.rect(x + 0.155, 0, 0.035, 0.42, frame);
}

function plant(p: Pen, x: number, h: number) {
  p.poly(
    [
      [x - 0.22, 0],
      [x + 0.22, 0],
      [x + 0.27, 0.42],
      [x - 0.27, 0.42],
    ],
    "#5b5149",
  );
  for (const [dx, dy, r] of [
    [0, h * 0.75, 0.38],
    [-0.22, h * 0.55, 0.3],
    [0.24, h * 0.6, 0.32],
    [0.05, h * 0.95, 0.26],
    [-0.1, h * 0.4, 0.26],
  ] as const)
    p.ellipse(x + dx, 0.42 + dy, r, r * 0.9, dx < 0 ? "#2f5a2a" : "#3f6e33");
}

const KIND_DRAW: Record<InteriorKind, { near: (p: Pen) => void; far: (p: Pen) => void; back: (p: Pen) => void }> = {
  pool: {
    near: (p) => {
      const x = 3.2;
      p.cone(x, 1.93, 1.8, 0.88, 2.6, 0.06);
      for (const lx of [x - 1.12, x, x + 1.12]) p.rect(lx - 0.075, 0, 0.15, 0.64, "#24160d");
      p.rect(x - 1.38, 0.62, 2.76, 0.2, "#4a2a18");
      p.rect(x - 1.38, 0.62, 2.76, 0.03, "#2a170c");
      p.rect(x - 1.42, 0.82, 2.84, 0.06, "#5c3520");
      p.poly(
        [
          [x - 1.3, 0.88],
          [x + 1.3, 0.88],
          [x + 1.2, 1.08],
          [x - 1.2, 1.08],
        ],
        "#1a4e85",
      );
      p.rect(x - 1.22, 1.07, 2.44, 0.04, "#3e2414");
      for (const [bx, c] of [
        [-0.6, "#f2efe6"],
        [0.3, "#c8322a"],
        [0.42, "#f2c230"],
        [0.55, "#1d1d1d"],
        [0.36, "#2f5db0"],
      ] as const)
        p.ellipse(x + bx, 0.96 + (bx > 0.4 ? 0.04 : 0), 0.03, 0.022, c);
      pendant(p, x, 1.95, 1.9, "#1c2a22");
      // a cue rest beside the table
      p.rect(0.42, 0, 0.3, 0.06, "#2a1a10");
      for (let i = 0; i < 5; i++) p.line(0.47 + i * 0.05, 0.06, 0.45 + i * 0.055, 1.45, 0.018, i % 2 ? "#c9a46a" : "#a77c45");
    },
    far: (p) => {
      const x = 3.2;
      p.cone(x, 1.93, 1.8, 0.88, 2.6, 0.05);
      for (const lx of [x - 1.12, x + 1.12]) p.rect(lx - 0.075, 0, 0.15, 0.64, "#24160d");
      p.rect(x - 1.38, 0.62, 2.76, 0.2, "#4a2a18");
      p.rect(x - 1.42, 0.82, 2.84, 0.06, "#5c3520");
      p.poly(
        [
          [x - 1.3, 0.88],
          [x + 1.3, 0.88],
          [x + 1.22, 1.0],
          [x - 1.22, 1.0],
        ],
        "#1a4e85",
      );
      pendant(p, x, 1.95, 1.9, "#1c2a22");
      // bar stools along the wall
      for (const sx of [0.4, 6.0]) {
        p.ellipse(sx, 0.76, 0.19, 0.05, "#3a2416");
        p.rect(sx - 0.02, 0, 0.04, 0.74, "#7c8188");
        p.rect(sx - 0.15, 0.28, 0.3, 0.025, "#7c8188");
      }
    },
    back: (p) => {
      // timber slat wall on felt backing, a cue rack and the lit table-number screen
      p.rect(0, 0, 6.4, BACK_H, "#2a2420");
      for (let x = 0.03; x < 6.4; x += 0.1) p.rect(x, 0.15, 0.055, BACK_H, "#7a5a3c");
      p.rect(0, 0, 6.4, 0.15, "#1c1b1b");
      p.rect(0.6, 1.3, 1.1, 1.6, "#2c2018");
      for (let i = 0; i < 8; i++) p.line(0.7 + i * 0.13, 1.35, 0.7 + i * 0.13, 2.85, 0.025, i % 2 ? "#c9a46a" : "#9c7042");
      p.rect(2.7, 2.2, 1.5, 0.5, "#0b0c0d");
      for (let i = 0; i < 5; i++) p.rect(2.85 + i * 0.25, 2.38, 0.14, 0.14, "#e8f6ee");
      p.rect(0, 3.6, 6.4, 0.04, "#fff1df");
    },
  },
  ludo: {
    near: (p) => {
      for (const x of [1.4, 4.2]) {
        p.glow(x, 2.3, 0.45, "#fff0c8", 0.55);
        p.line(x, 2.45, x, CARD_H, 0.012, "#2a2018");
        p.ellipse(x, 2.3, 0.16, 0.16, "#fff3d2");
        p.rect(x - 0.05, 0, 0.1, 0.72, "#5a3620");
        p.rect(x - 0.3, 0.02, 0.6, 0.04, "#5a3620");
        p.rect(x - 0.5, 0.72, 1.0, 0.06, "#7a4a2a");
        // the four-colour board, seen over the table edge
        p.poly(
          [
            [x - 0.44, 0.78],
            [x, 0.78],
            [x, 0.86],
            [x - 0.4, 0.86],
          ],
          "#d64a3a",
        );
        p.poly(
          [
            [x, 0.78],
            [x + 0.44, 0.78],
            [x + 0.4, 0.86],
            [x, 0.86],
          ],
          "#3aa858",
        );
        p.poly(
          [
            [x - 0.4, 0.86],
            [x, 0.86],
            [x, 0.93],
            [x - 0.37, 0.93],
          ],
          "#2f6fd0",
        );
        p.poly(
          [
            [x, 0.86],
            [x + 0.4, 0.86],
            [x + 0.37, 0.93],
            [x, 0.93],
          ],
          "#f2c230",
        );
        p.rect(x - 0.06, 0.78, 0.12, 0.15, "#f4ead6");
        chair(p, x - 0.78, -1, "#7a3b2a", "#3a2416");
        chair(p, x + 0.78, 1, "#7a3b2a", "#3a2416");
      }
    },
    far: (p) => {
      // a sofa against the wall, a tall plant, a further table under its globe
      p.rect(0.3, 0, 2.2, 0.42, "#5e3f33");
      p.rect(0.3, 0.42, 2.2, 0.36, "#6e4a3c");
      for (const x of [0.35, 2.3]) p.rect(x, 0.42, 0.18, 0.22, "#5a3a2e");
      plant(p, 3.2, 1.4);
      const x = 4.5;
      p.glow(x, 2.3, 0.45, "#fff0c8", 0.5);
      p.line(x, 2.45, x, CARD_H, 0.012, "#2a2018");
      p.ellipse(x, 2.3, 0.16, 0.16, "#fff3d2");
      p.rect(x - 0.05, 0, 0.1, 0.72, "#5a3620");
      p.rect(x - 0.5, 0.72, 1.0, 0.06, "#7a4a2a");
      p.rect(x - 0.44, 0.78, 0.88, 0.07, "#e9dcc2");
      chair(p, x - 0.78, -1, "#7a3b2a", "#3a2416");
    },
    back: (p) => {
      p.rect(0, 0, 5.6, BACK_H, "#c9ab8a");
      p.rect(0, 0, 5.6, 0.12, "#8a6a4a");
      p.rect(0, 0.12, 5.6, 0.9, "#b8966f");
      // shelves of board games and a framed board on the wall
      for (const y of [1.25, 1.8, 2.35]) p.rect(0.5, y, 2.1, 0.04, "#4a3020");
      const boxes = ["#d64a3a", "#2f6fd0", "#f2c230", "#3aa858", "#e9dcc2", "#7a4a2a"];
      for (let s = 0; s < 3; s++) for (let i = 0; i < 7; i++) p.rect(0.56 + i * 0.29, 1.29 + s * 0.55, 0.22, 0.28 + ((i + s) % 3) * 0.06, boxes[(i + s * 2) % boxes.length]!);
      p.rect(3.4, 1.3, 1.5, 1.5, "#3a2416");
      p.rect(3.48, 1.38, 1.34, 1.34, "#f4ead6");
      for (const [dx, dy, c] of [
        [0, 0, "#d64a3a"],
        [0.82, 0, "#3aa858"],
        [0, 0.82, "#2f6fd0"],
        [0.82, 0.82, "#f2c230"],
      ] as const)
        p.rect(3.52 + dx, 1.42 + dy, 0.48, 0.48, c);
      for (const x of [1.5, 4.15]) p.glow(x, 3.2, 0.5, "#ffe6b8", 0.6);
    },
  },
  igisoro: {
    near: (p) => {
      for (const x of [1.3, 3.9]) {
        p.glow(x, 2.5, 0.5, "#ffe2a8", 0.5);
        // the carved board on its low stand, the pits along its top, two low stools
        p.rect(x - 0.45, 0, 0.1, 0.3, "#4a2c16");
        p.rect(x + 0.35, 0, 0.1, 0.3, "#4a2c16");
        p.rect(x - 0.62, 0.3, 1.24, 0.14, "#6a3e20");
        p.poly(
          [
            [x - 0.62, 0.44],
            [x + 0.62, 0.44],
            [x + 0.56, 0.6],
            [x - 0.56, 0.6],
          ],
          "#7e4c28",
        );
        for (let r = 0; r < 2; r++) for (let i = 0; i < 8; i++) p.ellipse(x - 0.5 + i * 0.143 + r * 0.01, 0.48 + r * 0.07, 0.045, 0.018, "#2e180a");
        for (const s of [-1, 1]) {
          p.rect(x + s * 0.95 - 0.2, 0.3, 0.4, 0.06, "#5a3418");
          p.poly(
            [
              [x + s * 0.95 - 0.14, 0],
              [x + s * 0.95 + 0.14, 0],
              [x + s * 0.95 + 0.06, 0.3],
              [x + s * 0.95 - 0.06, 0.3],
            ],
            "#4a2c16",
          );
        }
      }
    },
    far: (p) => {
      // woven pendant shades, an ingoma drum, an agaseke basket on a plinth
      for (const x of [1.0, 3.6]) {
        p.line(x, 2.7, x, CARD_H, 0.012, "#2a1a0c");
        p.ellipse(x, 2.62, 0.34, 0.16, "#b8894f");
        p.rect(x - 0.28, 2.48, 0.56, 0.04, "#fff0cc");
        p.glow(x, 2.3, 0.6, "#ffdca0", 0.45);
      }
      const dx = 2.3;
      p.rect(dx - 0.26, 0, 0.52, 0.72, "#6a3a1c");
      for (let i = 0; i < 6; i++) p.line(dx - 0.24 + i * 0.096, 0.05, dx - 0.2 + i * 0.09, 0.7, 0.01, "#e8d6b0");
      p.ellipse(dx, 0.72, 0.26, 0.05, "#d8c49c");
      const bx = 4.6;
      p.rect(bx - 0.25, 0, 0.5, 0.6, "#ece2cc");
      p.poly(
        [
          [bx - 0.16, 0.6],
          [bx + 0.16, 0.6],
          [bx + 0.05, 1.15],
          [bx - 0.05, 1.15],
        ],
        "#c99a5a",
      );
      for (let i = 0; i < 4; i++) p.line(bx - 0.14 + i * 0.02, 0.7 + i * 0.1, bx + 0.14 - i * 0.02, 0.7 + i * 0.1, 0.012, "#2a1a10");
    },
    back: (p) => {
      p.rect(0, 0, 5.2, BACK_H, "#4a3020");
      for (let x = 0.05; x < 5.2; x += 0.26) p.rect(x, 0, 0.02, BACK_H, "#3a2416");
      p.rect(0, 0, 5.2, 0.4, "#2a1a10");
      // Imigongo band: black / white / terracotta zigzags
      p.rect(0, 1.15, 5.2, 0.6, "#1d1a18");
      for (let x = 0; x < 5.2; x += 0.4) {
        p.poly(
          [
            [x, 1.2],
            [x + 0.2, 1.7],
            [x + 0.4, 1.2],
          ],
          "#f1ead8",
        );
        p.poly(
          [
            [x + 0.08, 1.2],
            [x + 0.2, 1.5],
            [x + 0.32, 1.2],
          ],
          "#a8492a",
        );
      }
      for (const x of [0.15, 2.75]) p.rect(x - 0.1, 0, 0.2, BACK_H, "#4a2c16");
      // a niche with pots
      p.rect(3.6, 2.2, 1.0, 0.8, "#6a4630");
      for (const [x, h] of [
        [3.8, 0.35],
        [4.1, 0.5],
        [4.4, 0.3],
      ] as const)
        p.ellipse(x, 2.2 + h / 2, 0.11, h / 2, "#8a4a2a");
      for (const x of [1.4, 4.0]) p.glow(x, 3.3, 0.55, "#ffdca0", 0.55);
    },
  },
  arena: {
    near: (p) => {
      // a row of ticket turnstiles with glass flaps, stanchions with the arena's purple rope
      for (const x of [0.6, 1.5, 2.4, 3.3]) {
        p.rect(x - 0.13, 0, 0.26, 1.0, "#8d939b");
        p.rect(x - 0.13, 0.94, 0.26, 0.06, "#2a2c32");
        p.rect(x - 0.05, 0.98, 0.1, 0.03, "#7ef0a0");
        if (x < 3.3) p.rect(x + 0.13, 0.45, 0.64, 0.45, "rgba(210,230,240,0.35)");
      }
      for (const x of [4.3, 5.4]) {
        p.rect(x - 0.02, 0, 0.04, 0.95, "#c9ced6");
        p.ellipse(x, 0.02, 0.15, 0.03, "#9aa0a8");
      }
      p.g.strokeStyle = "#7a3cc0";
      p.g.lineWidth = 0.035;
      p.g.beginPath();
      p.g.moveTo(4.3, 0.9);
      p.g.quadraticCurveTo(4.85, 0.72, 5.4, 0.9);
      p.g.stroke();
    },
    far: (p) => {
      // tournament banners and the trophy cabinet
      for (const x of [0.8, 2.0]) {
        p.rect(x - 0.4, 1.5, 0.8, 2.4, "#5b2aa0");
        p.poly(
          [
            [x - 0.4, 1.5],
            [x, 1.25],
            [x + 0.4, 1.5],
          ],
          "#5b2aa0",
        );
        p.poly(
          [
            [x, 2.2],
            [x + 0.22, 2.55],
            [x, 2.9],
            [x - 0.22, 2.55],
          ],
          "#ffc83d",
        );
        p.rect(x - 0.3, 3.4, 0.6, 0.06, "#ffc83d");
      }
      const cx = 4.4;
      p.rect(cx - 0.9, 0, 1.8, 2.1, "#1c1d22");
      p.rect(cx - 0.82, 0.1, 1.64, 1.9, "#2c2a30");
      for (const y of [0.75, 1.4]) p.rect(cx - 0.82, y, 1.64, 0.03, "#fff4d8");
      for (const [x, y, h] of [
        [-0.5, 0.78, 0.4],
        [0, 0.78, 0.55],
        [0.5, 0.78, 0.4],
        [-0.3, 1.43, 0.35],
        [0.3, 1.43, 0.35],
      ] as const) {
        p.rect(cx + x - 0.08, y, 0.16, 0.06, "#c9a040");
        p.poly(
          [
            [cx + x - 0.03, y + 0.06],
            [cx + x + 0.03, y + 0.06],
            [cx + x + 0.11, y + h],
            [cx + x - 0.11, y + h],
          ],
          "#e8b838",
        );
      }
    },
    back: (p) => {
      p.rect(0, 0, 6, BACK_H, "#3a3b44");
      p.rect(0, 0, 6, 0.3, "#24252b");
      // the video wall: purple to gold, a tournament bracket glowing on it
      const gr = p.g.createLinearGradient(0, 1.3, 0, 4.6);
      gr.addColorStop(0, "#3a1670");
      gr.addColorStop(0.6, "#7a3cc0");
      gr.addColorStop(1, "#c88a2a");
      p.rect(0.2, 1.3, 5.6, 3.3, "#101014");
      p.poly(
        [
          [0.3, 1.4],
          [5.7, 1.4],
          [5.7, 4.5],
          [0.3, 4.5],
        ],
        gr,
      );
      for (const [y, x0, x1] of [
        [2.0, 0.8, 1.8],
        [2.6, 0.8, 1.8],
        [3.4, 0.8, 1.8],
        [4.0, 0.8, 1.8],
        [2.3, 1.8, 2.8],
        [3.7, 1.8, 2.8],
        [3.0, 2.8, 3.4],
        [3.0, 4.0, 5.2],
      ] as const)
        p.rect(x0, y, x1 - x0, 0.05, "#f4ecff");
      for (const [x, y0, y1] of [
        [1.8, 2.0, 2.6],
        [1.8, 3.4, 4.0],
        [2.8, 2.3, 3.7],
      ] as const)
        p.rect(x, y0, 0.05, y1 - y0, "#f4ecff");
      p.poly(
        [
          [3.7, 2.6],
          [3.95, 3.0],
          [3.7, 3.4],
          [3.45, 3.0],
        ],
        "#ffe08a",
      );
    },
  },
  admin: {
    near: (p) => {
      // the reception desk: timber front, limestone top, a brass Imigongo diamond, a screen; plants either side
      const x = 3.5;
      p.rect(x - 1.7, 0, 3.4, 1.05, "#7a5236");
      for (let i = 0; i < 17; i++) p.rect(x - 1.65 + i * 0.2, 0.06, 0.02, 0.95, "#5e3e28");
      p.rect(x - 1.76, 1.05, 3.52, 0.08, "#e4dccb");
      p.poly(
        [
          [x - 1.7, 1.13],
          [x + 1.7, 1.13],
          [x + 1.6, 1.22],
          [x - 1.6, 1.22],
        ],
        "#d6cdbb",
      );
      p.poly(
        [
          [x, 0.35],
          [x + 0.22, 0.6],
          [x, 0.85],
          [x - 0.22, 0.6],
        ],
        "#b08a4a",
      );
      p.rect(x + 0.6, 1.2, 0.5, 0.32, "#1b1d22");
      p.rect(x + 0.82, 1.13, 0.06, 0.08, "#2a2c30");
      plant(p, 0.7, 1.5);
      plant(p, 6.3, 1.2);
      // the waiting area beside reception: two armchairs and a low table, a tall plant
      for (const [x, d] of [
        [8.6, -1],
        [10.4, 1],
      ] as const) {
        p.rect(x - 0.4, 0.12, 0.8, 0.34, "#6d6a66");
        p.rect(x + d * 0.32 - 0.08, 0.12, 0.16, 0.7, "#5f5c58");
        p.rect(x - 0.36, 0, 0.05, 0.12, "#2a2a2a");
        p.rect(x + 0.31, 0, 0.05, 0.12, "#2a2a2a");
      }
      p.rect(9.15, 0.36, 0.7, 0.05, "#3f382f");
      p.rect(9.47, 0, 0.06, 0.36, "#3f382f");
      plant(p, 12.2, 1.6);
    },
    far: (p) => {
      // lounge armchairs round a low table, a glazed meeting room partition
      for (const [x, d] of [
        [1.4, -1],
        [3.0, 1],
      ] as const) {
        p.rect(x - 0.4, 0.12, 0.8, 0.34, "#6d6a66");
        p.rect(x + d * 0.32 - 0.08, 0.12, 0.16, 0.7, "#5f5c58");
        p.rect(x - 0.36, 0, 0.05, 0.12, "#2a2a2a");
        p.rect(x + 0.31, 0, 0.05, 0.12, "#2a2a2a");
      }
      p.rect(1.85, 0.36, 0.7, 0.05, "#3f382f");
      p.rect(2.17, 0, 0.06, 0.36, "#3f382f");
      p.rect(4.2, 0, 2.6, 3.0, "rgba(220,232,236,0.28)");
      for (const x of [4.2, 5.5, 6.8]) p.rect(x - 0.03, 0, 0.06, 3.0, "#3f382f");
      p.rect(4.2, 2.97, 2.6, 0.05, "#3f382f");
      p.rect(4.6, 0.7, 1.6, 0.05, "#7a5236");
      p.glow(5.5, 2.4, 0.9, "#fff3e0", 0.35);
    },
    back: (p) => {
      // light plaster, two timber office doors, the dark office directory board (lines only), wall washers
      p.rect(0, 0, 13, BACK_H, "#e2ddd3");
      p.rect(0, 0, 13, 0.1, "#9a948a");
      for (const x of [0.7, 5.3, 8.2, 11.4]) {
        p.rect(x - 0.05, 0, 1.1, 2.3, "#2e2a26");
        p.rect(x, 0, 1.0, 2.25, "#8a5a36");
        p.rect(x + 0.82, 1.0, 0.04, 0.22, "#c9ced6");
      }
      p.rect(2.7, 1.2, 1.6, 1.5, "#1d1e22");
      for (let i = 0; i < 6; i++) p.rect(2.85, 1.4 + i * 0.2, 1.0 - (i % 3) * 0.2, 0.05, "#e8e4dc");
      for (const x of [1.2, 3.5, 5.8, 8.7, 11.9]) p.glow(x, 4.2, 0.8, "#fff6e6", 0.5);
    },
  },
  fight: {
    near: (p) => {
      // the training ring's corner: canvas over the apron, padded corner posts, red / white / blue ropes
      p.rect(0.1, 0, 7.4, 0.95, "#1b1b1e");
      p.rect(0.1, 0.12, 7.4, 0.7, "#7a1e1a");
      p.rect(0.1, 0.12, 7.4, 0.04, "#c8322a");
      p.poly(
        [
          [0.1, 0.95],
          [7.5, 0.95],
          [7.4, 1.1],
          [0.2, 1.1],
        ],
        "#56667c",
      );
      for (const [x, pad] of [
        [0.35, "#c8322a"],
        [7.25, "#2f5db0"],
      ] as const) {
        p.rect(x - 0.06, 0.95, 0.12, 1.4, "#c9ced6");
        p.rect(x - 0.1, 1.2, 0.2, 1.1, pad);
      }
      for (const [y, c] of [
        [1.35, "#2f5db0"],
        [1.75, "#f2efe6"],
        [2.15, "#c8322a"],
      ] as const) {
        p.g.strokeStyle = c;
        p.g.lineWidth = 0.05;
        p.g.beginPath();
        p.g.moveTo(0.45, y);
        p.g.quadraticCurveTo(3.8, y - 0.08, 7.15, y);
        p.g.stroke();
      }
    },
    far: (p) => {
      // heavy bags on chains, a speed-bag platform on the wall
      for (const [x, c] of [
        [1.0, "#1c1c1f"],
        [2.8, "#8a1f1a"],
        [4.6, "#1c1c1f"],
      ] as const) {
        p.line(x, 2.7, x, CARD_H, 0.02, "#8a8f96");
        p.rect(x - 0.18, 1.1, 0.36, 1.6, c);
        p.ellipse(x, 1.1, 0.18, 0.05, c);
        p.rect(x - 0.18, 2.3, 0.36, 0.05, "#c9ced6");
      }
      p.rect(5.8, 1.9, 1.2, 0.08, "#3a3a3d");
      p.rect(6.36, 2.0, 0.08, 0.6, "#3a3a3d");
      p.ellipse(6.4, 1.75, 0.1, 0.13, "#8a1f1a");
    },
    back: (p) => {
      p.rect(0, 0, 7.6, BACK_H, "#8a8178");
      for (let y = 0.6; y < BACK_H; y += 0.6) p.rect(0, y, 7.6, 0.012, "#77706a");
      for (let x = 1.2; x < 7.6; x += 2.4) p.rect(x, 0, 0.012, BACK_H, "#77706a");
      p.rect(0, 0, 7.6, 0.2, "#3a3836");
      p.rect(0, 2.6, 7.6, 0.14, "#c8322a");
      p.rect(0, 2.42, 7.6, 0.05, "#2f5db0");
      // two framed fight posters (a glove, no lettering) and floodlights
      for (const x of [1.2, 5.2]) {
        p.rect(x, 0.9, 1.2, 1.4, "#111113");
        p.rect(x + 0.06, 0.96, 1.08, 1.28, "#5a1814");
        p.ellipse(x + 0.6, 1.7, 0.3, 0.26, "#c8322a");
        p.rect(x + 0.42, 1.2, 0.36, 0.26, "#e8e2d8");
      }
      for (const x of [1.9, 5.7]) p.glow(x, 4.0, 0.9, "#f4f1ea", 0.5);
    },
  },
};

let atlas: THREE.CanvasTexture | null = null;
/** The furniture atlas (3 columns × one row per kind), drawn once per session (~2 MB GPU). */
export function interiorAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const c = document.createElement("canvas");
  c.width = TW * 3;
  c.height = TH * INTERIOR_KINDS.length;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  INTERIOR_KINDS.forEach((k, row) => {
    const room = INTERIOR_ROOMS[k];
    const d = KIND_DRAW[k];
    cell(g, 0, row, room.tile, CARD_H, null, d.near);
    cell(g, 1, row, room.tile, CARD_H, null, d.far);
    cell(g, 2, row, room.tile, BACK_H, room.wall, d.back);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  atlas = t;
  return t;
}

/* ------------------------------------------------------------------ the shader ------------------------------------------------------------------ */

const N = INTERIOR_KINDS.length;

const VERT = /* glsl */ `
#include <fog_pars_vertex>
varying vec3 vW;
varying vec3 vN;
varying vec2 vK;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = mat3(modelMatrix) * normal;
  vK = uv;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uAtlas;
uniform vec4 uA[${N}]; // depth, ceiling, tile, lamps
uniform vec4 uB[${N}]; // near, far, pane, transom
uniform float uHall[${N}];
uniform vec3 uWall[${N}];
uniform vec3 uFloor[${N}];
uniform vec3 uCeil[${N}];
uniform vec3 uLamp[${N}];
uniform vec3 uAvg[${N}];
uniform float uExposure;
varying vec3 vW;
varying vec3 vN;
varying vec2 vK;

const float ROWS = ${N}.0;
const vec2 GUT = vec2(${(GUT / TW).toFixed(6)}, ${(GUT / TH).toFixed(6)});

vec4 cellTex(float col, float row, vec2 q, vec2 dx, vec2 dy) {
  vec2 inner = 1.0 - 2.0 * GUT;
  vec2 cellSize = vec2(1.0 / 3.0, 1.0 / ROWS);
  vec2 f = vec2(fract(q.x), clamp(q.y, 0.0, 1.0));
  vec2 uv = (vec2(col, ROWS - 1.0 - row) + GUT + f * inner) * cellSize;
  return textureGrad(uAtlas, uv, dx * inner * cellSize, dy * inner * cellSize);
}
// squared distance (m²) to the nearest light of a square grid with spacing s
float grid2(vec2 p, float s) {
  vec2 c = (fract(p / s) - 0.5) * s;
  return dot(c, c);
}
float lum(vec3 c) { return max(c.r, max(c.g, c.b)); }

void main() {
  int k = int(floor(vK.x));
  int view = int(floor(vK.y));
  float row = float(k);
  vec4 A = uA[k];
  vec4 B = uB[k];

  vec3 Nw = vec3(vN.x, 0.0, vN.z);
  Nw = normalize(Nw + vec3(0.0, 0.0, 1e-5));
  vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), Nw));
  vec3 V = normalize(vW - cameraPosition);
  vec3 r = vec3(dot(V, T), V.y, -dot(V, Nw));
  r.z = max(r.z, 0.03);
  float u = dot(vW, T);
  float y = vW.y;
  float dist = length(vW - cameraPosition);

  float D = view == 1 ? uHall[k] : (view == 2 ? A.x * 0.8 : A.x);
  float Hc = A.y;
  float tile = A.z;
  float nearD = B.x * (view == 1 ? 1.4 : 1.0);
  float farD = B.y * (view == 1 ? 1.9 : 1.0);

  // every texture coordinate is computed unconditionally (derivatives must be taken in uniform control flow)
  float tB = D / r.z;
  float tN = nearD / r.z;
  float tF = farD / r.z;
  vec2 qB = vec2((u + r.x * tB) / tile + 0.21, (y + r.y * tB) / ${BACK_H.toFixed(1)});
  vec2 qN = vec2((u + r.x * tN) / tile, (y + r.y * tN) / ${CARD_H.toFixed(1)});
  vec2 qF = vec2((u + r.x * tF) / tile + 0.5, (y + r.y * tF) / ${CARD_H.toFixed(1)});
  vec4 cB = cellTex(2.0, row, qB, dFdx(qB), dFdy(qB));
  vec4 cN = cellTex(0.0, row, qN, dFdx(qN), dFdy(qN));
  vec4 cF = cellTex(1.0, row, qF, dFdx(qF), dFdy(qF));

  // the room: back wall, floor or ceiling, whichever the ray meets first
  float tFl = r.y < 0.0 ? -y / r.y : 1e5;
  float tCe = r.y > 0.0 ? (Hc - y) / r.y : 1e5;
  float t = min(tB, min(tFl, tCe));
  float hx = u + r.x * t;
  float hy = y + r.y * t;
  float dep = r.z * t;
  vec3 lamp = uLamp[k];
  float s = A.w;
  vec3 col;
  if (t == tB) {
    col = cB.rgb * (0.72 + 0.3 * smoothstep(0.0, Hc, hy));
  } else if (t == tFl) {
    float d2 = grid2(vec2(hx, dep), s);
    col = uFloor[k] * (0.42 + 0.7 * exp(-d2 / 1.3));
    // glossy floor: soft reflections of the lights above
    col += lamp * 0.22 * exp(-d2 / 0.12) * smoothstep(0.0, 1.5, dep);
    col *= mix(0.72, 1.0, smoothstep(0.0, 1.2, D - dep));
  } else {
    float d2 = grid2(vec2(hx, dep - 0.5 * s), s);
    col = uCeil[k] * 0.75 + lamp * (2.2 * (1.0 - smoothstep(0.012, 0.03, d2)) + 0.18 * exp(-d2 / 0.4));
  }
  // furniture cards, far then near, where they stand in front of what the ray met
  float boostF = 1.0 + 2.2 * smoothstep(0.86, 0.98, lum(cF.rgb)) * smoothstep(0.6, 0.9, cF.a);
  float boostN = 1.0 + 2.2 * smoothstep(0.86, 0.98, lum(cN.rgb)) * smoothstep(0.6, 0.9, cN.a);
  if (farD < dep && qF.y > 0.0 && qF.y < 1.0) col = mix(col, cF.rgb * 0.9 * boostF, cF.a);
  if (nearD < dep && qN.y > 0.0 && qN.y < 1.0) col = mix(col, cN.rgb * boostN, cN.a);
  // a little depth haze inside the room, the room's own exposure
  col *= mix(1.0, 0.8, clamp(dep / 18.0, 0.0, 1.0)) * uExposure;
  // glass above the ceiling: the slab edge / the storey above, dark
  if (y > Hc) col = uCeil[k] * 0.3;
  // distance LOD: fade to the room's average (no popping), the atlas mips blur it as it goes
  col = mix(col, uAvg[k] * 0.62 * uExposure, smoothstep(45.0, 110.0, dist));

  if (view != 1) {
    // the glass: tint, Fresnel reflection of the sky / the plaza, pane frames
    float cosv = clamp(dot(-V, Nw), 0.0, 1.0);
    float F = 0.04 + 0.96 * pow(1.0 - cosv, 5.0);
    vec3 R = reflect(V, Nw);
    vec3 sky = mix(vec3(0.56, 0.64, 0.7), vec3(0.24, 0.4, 0.6), smoothstep(0.05, 0.7, R.y));
    vec3 refl = mix(vec3(0.17, 0.16, 0.14), sky, smoothstep(-0.06, 0.12, R.y));
    col *= vec3(0.78, 0.84, 0.84);
    col = mix(col, refl, clamp(F + 0.08, 0.0, 0.92));
    if (B.z > 0.0) {
      float px = abs(fract(u / B.z + 0.5) - 0.5) * B.z;
      float fr = 1.0 - smoothstep(0.022, 0.034, px);
      float tr = B.w > 0.0 ? 1.0 - smoothstep(0.022, 0.034, abs(y - B.w)) : 0.0;
      col = mix(col, vec3(0.09, 0.09, 0.1), max(fr, tr) * (1.0 - smoothstep(30.0, 70.0, dist)));
    }
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const MATS = new Map<string, THREE.ShaderMaterial>();
/** The one interior-glass material (per tier: Lite renders a little darker, there is no bloom). */
export function interiorGlassMaterial(tier: "lite" | "standard"): THREE.ShaderMaterial {
  const hit = MATS.get(tier);
  if (hit) return hit;
  const rooms = INTERIOR_KINDS.map((k) => INTERIOR_ROOMS[k]);
  const col = (hex: string) => new THREE.Color(hex);
  const m = new THREE.ShaderMaterial({
    name: "interior-glass",
    vertexShader: VERT,
    fragmentShader: FRAG,
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uAtlas: { value: interiorAtlas() },
      uA: { value: rooms.map((r) => new THREE.Vector4(r.depth, r.ceiling, r.tile, r.lamps)) },
      uB: { value: rooms.map((r) => new THREE.Vector4(r.near, r.far, r.pane, r.transom)) },
      uHall: { value: rooms.map((r) => r.hallDepth) },
      uWall: { value: rooms.map((r) => col(r.wall)) },
      uFloor: { value: rooms.map((r) => col(r.floor)) },
      uCeil: { value: rooms.map((r) => col(r.ceil)) },
      uLamp: { value: rooms.map((r) => col(r.lamp)) },
      uAvg: { value: rooms.map((r) => col(r.avg)) },
      uExposure: { value: tier === "lite" ? 0.85 : 1.0 },
    },
  });
  MATS.set(tier, m);
  return m;
}

/** A pane of interior-mapped glass (facing +z in the current frame), for the district batch or a hand-built mesh. */
export function interiorPaneGeometry(kind: InteriorKind, view: InteriorView, w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const [u, v] = interiorUV(kind, view);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
  return g;
}

/** Add an interior-mapped pane (facing +z of the frame, `rotY` turns it) to a district batch (material key "interior"). */
export function interiorPane(b: GeoBatch, kind: InteriorKind, view: InteriorView, w: number, h: number, p: [number, number, number], rotY = 0) {
  b.add("interior", interiorPaneGeometry(kind, view, w, h), { p, r: [0, rotY, 0] });
}

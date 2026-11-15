"use client";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { BOXING_RING_COUNT, CORNER_COLORS } from "@gukirana/contracts";
import { useFightBridge } from "./bridge";
import { ringCounts } from "./rings";
import { F } from "./strings";

const PX_PER_M = 340;

/**
 * What you see at the far end of the lobby → Boxing passage: the hall beyond, painted once on a canvas (ceiling light
 * strips, the timber back wall, rows of lit rings with red / blue / white ropes in perspective) under a lit
 * "BOXING HALL" header with the live free-ring count. It replaces a flat light panel that read as an empty white room.
 * One plane, one texture; repainted only when the free-ring count changes. `view="lobby"` paints the other way round
 * (seen from the Boxing hall's exit): the warm foyer, timber slats, benches and the bright plaza doors at its end.
 */
export function HallGlimpse({ w, h, position, rotationY = 0, view = "hall" }: { w: number; h: number; position: [number, number, number]; rotationY?: number; view?: "hall" | "lobby" }) {
  const free = useFightBridge((s) => (Object.keys(s.rings).length ? ringCounts(s.rings).free : null));
  const { tex, canvas } = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = Math.round(w * PX_PER_M);
    c.height = Math.round(h * PX_PER_M);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { tex: t, canvas: c };
  }, [w, h]);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), [tex]);
  useEffect(() => () => (tex.dispose(), mat.dispose()), [tex, mat]);
  useEffect(() => {
    if (view === "lobby") paintLobby(canvas);
    else paint(canvas, free);
    tex.needsUpdate = true;
  }, [canvas, tex, free, view]);
  return (
    <mesh material={mat} position={position} rotation-y={rotationY}>
      <planeGeometry args={[w, h]} />
    </mesh>
  );
}

function paint(c: HTMLCanvasElement, free: number | null) {
  const g = c.getContext("2d");
  if (!g) return;
  const W = c.width;
  const H = c.height;
  const hz = H * 0.5; // eye height ≈ 1.5 m of a 3 m opening: horizon in the middle
  const vx = W / 2;
  // ceiling and floor
  let gr = g.createLinearGradient(0, 0, 0, hz);
  gr.addColorStop(0, "#151312");
  gr.addColorStop(1, "#2c2622");
  g.fillStyle = gr;
  g.fillRect(0, 0, W, hz);
  gr = g.createLinearGradient(0, hz, 0, H);
  gr.addColorStop(0, "#4a4038");
  gr.addColorStop(1, "#7a6c5c");
  g.fillStyle = gr;
  g.fillRect(0, hz, W, H - hz);
  // far timber wall band at the horizon
  g.fillStyle = "#6b4630";
  g.fillRect(0, hz - H * 0.07, W, H * 0.07);
  g.fillStyle = "#3a2a20";
  g.fillRect(0, hz - H * 0.075, W, H * 0.008);
  // ceiling light strips converging on the vanishing point
  g.fillStyle = "rgba(255,244,226,0.95)";
  for (let i = 1; i <= 6; i++) {
    const d = i * i * 0.9 + 1.2; // depth (m)
    const y = hz - (hz * 0.9) / d;
    const half = (W * 0.9) / d;
    const th = Math.max(2, (H * 0.05) / d);
    g.fillRect(vx - half, y, half * 2, th);
  }
  // floor lane lines
  g.strokeStyle = "rgba(235,225,205,0.55)";
  g.lineWidth = 3;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(vx + s * W * 0.08, H);
    g.lineTo(vx + s * W * 0.005, hz);
    g.stroke();
  }
  // rows of rings on both sides of the aisle, far to near (painter's order)
  const rings: { x: number; d: number }[] = [];
  for (let i = 5; i >= 0; i--) for (const s of [-1, 1]) rings.push({ x: s * 4.6, d: 4 + i * 6.5 });
  for (const r of rings) drawRing(g, vx, hz, H, r.x, r.d);
  // a soft light haze over the rings
  gr = g.createRadialGradient(vx, hz, 0, vx, hz, W * 0.7);
  gr.addColorStop(0, "rgba(255,240,220,0.18)");
  gr.addColorStop(1, "rgba(255,240,220,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  // header: BOXING HALL + live free rings
  const bh = H * 0.15;
  g.fillStyle = "rgba(12,11,11,0.86)";
  g.fillRect(0, 0, W, bh);
  g.fillStyle = CORNER_COLORS.red;
  g.fillRect(0, bh - H * 0.008, W, H * 0.008);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#f5efe6";
  g.font = `800 ${Math.round(bh * 0.4)}px system-ui, sans-serif`;
  g.fillText(F.boxingHall.toUpperCase(), vx, bh * 0.36);
  g.fillStyle = "#6fdc8c";
  g.font = `700 ${Math.round(bh * 0.24)}px system-ui, sans-serif`;
  g.fillText(F.ringsFree(free ?? BOXING_RING_COUNT), vx, bh * 0.76);
}

/** one ring in perspective: x = lateral offset (m), d = depth (m); platform 1 m high, 5 m wide, posts and 3 ropes */
function drawRing(g: CanvasRenderingContext2D, vx: number, hz: number, H: number, x: number, d: number) {
  const f = H * 0.5 * 1.15; // focal length in px (≈ the 60° view of the follow camera)
  const eye = 1.5;
  const P = (lx: number, y: number, dz: number) => ({ x: vx + (lx * f) / dz, y: hz + ((eye - y) * f) / dz });
  const half = 2.5;
  const near = d;
  const far = d + 5;
  // apron (platform side facing the aisle) and canvas top
  const a = P(x - Math.sign(x) * half, 1.0, near);
  const b = P(x - Math.sign(x) * half, 1.0, far);
  const a0 = P(x - Math.sign(x) * half, 0, near);
  const b0 = P(x - Math.sign(x) * half, 0, far);
  g.fillStyle = "#16161a";
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
  g.lineTo(b0.x, b0.y);
  g.lineTo(a0.x, a0.y);
  g.fill();
  const tl = P(x - half, 1.0, near);
  const tr = P(x + half, 1.0, near);
  const fl = P(x - half, 1.0, far);
  const fr = P(x + half, 1.0, far);
  g.fillStyle = "#e9e6df";
  g.beginPath();
  g.moveTo(tl.x, tl.y);
  g.lineTo(tr.x, tr.y);
  g.lineTo(fr.x, fr.y);
  g.lineTo(fl.x, fl.y);
  g.fill();
  // front apron with the blue skirt band
  const bl = P(x - half, 0, near);
  const br = P(x + half, 0, near);
  g.fillStyle = "#1b1b20";
  g.fillRect(Math.min(tl.x, tr.x), tl.y, Math.abs(tr.x - tl.x), bl.y - tl.y);
  g.fillStyle = CORNER_COLORS.blue;
  g.fillRect(Math.min(tl.x, tr.x), tl.y + (bl.y - tl.y) * 0.12, Math.abs(tr.x - tl.x), (bl.y - tl.y) * 0.14);
  void br;
  // posts
  const posts: [number, number, string][] = [
    [x - half, near, CORNER_COLORS.red],
    [x + half, near, "#f2f2f2"],
    [x - half, far, "#f2f2f2"],
    [x + half, far, CORNER_COLORS.blue],
  ];
  for (const [px, pz, col] of posts) {
    const p0 = P(px, 1.0, pz);
    const p1 = P(px, 2.45, pz);
    g.strokeStyle = col;
    g.lineWidth = Math.max(1.5, (0.14 * f) / pz);
    g.beginPath();
    g.moveTo(p0.x, p0.y);
    g.lineTo(p1.x, p1.y);
    g.stroke();
  }
  // ropes on the near side and the aisle side
  const ropeCols = ["#f2f2f2", CORNER_COLORS.blue, "#f2f2f2"];
  ropeCols.forEach((col, i) => {
    const y = 1.45 + i * 0.4;
    g.strokeStyle = col;
    g.lineWidth = Math.max(1, (0.05 * f) / near);
    const n0 = P(x - half, y, near);
    const n1 = P(x + half, y, near);
    const s0 = P(x - Math.sign(x) * half, y, near);
    const s1 = P(x - Math.sign(x) * half, y, far);
    g.beginPath();
    g.moveTo(n0.x, n0.y);
    g.lineTo(n1.x, n1.y);
    g.moveTo(s0.x, s0.y);
    g.lineTo(s1.x, s1.y);
    g.stroke();
  });
  // the light pool over the ring
  const c = P(x, 1.0, (near + far) / 2);
  const rad = (3.2 * f) / ((near + far) / 2);
  const gr = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, rad);
  gr.addColorStop(0, "rgba(255,248,232,0.35)");
  gr.addColorStop(1, "rgba(255,248,232,0)");
  g.fillStyle = gr;
  g.fillRect(c.x - rad, c.y - rad, rad * 2, rad * 2);
}

/** the lobby seen from the Boxing hall's exit passage: warm foyer, slatted walls, benches, the plaza doors' daylight */
function paintLobby(c: HTMLCanvasElement) {
  const g = c.getContext("2d");
  if (!g) return;
  const W = c.width;
  const H = c.height;
  const hz = H * 0.5;
  const vx = W / 2;
  // room box in one-point perspective: back wall rectangle, ceiling, floor, side walls
  const bw = W * 0.34;
  const bt = hz - H * 0.17;
  const bb = hz + H * 0.17;
  g.fillStyle = "#4a4641";
  g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(vx + bw, bt); g.lineTo(vx - bw, bt); g.fill();
  let gr = g.createLinearGradient(0, bb, 0, H);
  gr.addColorStop(0, "#8d8478");
  gr.addColorStop(1, "#a59b8c");
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(0, H); g.lineTo(W, H); g.lineTo(vx + bw, bb); g.lineTo(vx - bw, bb); g.fill();
  for (const s of [-1, 1]) {
    const ex = s < 0 ? 0 : W;
    const bx = vx + s * bw;
    g.fillStyle = "#8a847a";
    g.beginPath(); g.moveTo(ex, 0); g.lineTo(bx, bt); g.lineTo(bx, bb); g.lineTo(ex, H); g.fill();
    // timber slat band on the lower wall
    g.fillStyle = "#a8774d";
    const sy0 = H * 0.66;
    g.beginPath(); g.moveTo(ex, sy0); g.lineTo(bx, hz + H * 0.03); g.lineTo(bx, bb); g.lineTo(ex, H); g.fill();
    g.strokeStyle = "rgba(60,38,22,0.45)";
    g.lineWidth = 2;
    for (let i = 1; i < 14; i++) {
      const t = i / 14;
      const x = ex + (bx - ex) * (1 - (1 - t) * (1 - t));
      const yTop = sy0 + (hz + H * 0.03 - sy0) * (1 - (1 - t) * (1 - t));
      const yBot = H + (bb - H) * (1 - (1 - t) * (1 - t));
      g.beginPath(); g.moveTo(x, yTop); g.lineTo(x, yBot); g.stroke();
    }
  }
  // back wall with the plaza doors (daylight) in the middle
  g.fillStyle = "#7d776e";
  g.fillRect(vx - bw, bt, bw * 2, bb - bt);
  const dw = bw * 0.36;
  const dt = bt + (bb - bt) * 0.28;
  gr = g.createLinearGradient(0, dt, 0, bb);
  gr.addColorStop(0, "#f4f1ea");
  gr.addColorStop(1, "#d9d2c4");
  g.fillStyle = gr;
  g.fillRect(vx - dw, dt, dw * 2, bb - dt);
  g.fillStyle = "#1a1a1d";
  g.fillRect(vx - 2, dt, 4, bb - dt);
  g.fillRect(vx - dw - 5, dt - 5, dw * 2 + 10, 6);
  // warm ceiling light strips
  g.fillStyle = "rgba(255,244,226,0.95)";
  for (let i = 1; i <= 3; i++) {
    const k = 1 - i * 0.24;
    const y = bt * k + 0 * (1 - k);
    const half = bw + (W / 2 - bw) * k;
    g.fillRect(vx - half * 0.7, y + H * 0.02, half * 1.4, Math.max(3, H * 0.012 * k));
  }
  // benches either side of the aisle
  g.fillStyle = "#c89a6a";
  for (const s of [-1, 1]) for (const k of [0.62, 0.38]) {
    const y = bb + (H - bb) * k;
    const x0 = vx + s * (bw * 0.5 + (W / 2) * k * 0.55);
    const len = W * 0.18 * (0.4 + k);
    g.fillRect(s < 0 ? x0 - len : x0, y, len, H * 0.025 * (0.5 + k));
    g.fillStyle = "#1a1a1d";
    g.fillRect(s < 0 ? x0 - len * 0.9 : x0 + len * 0.1, y + H * 0.025 * (0.5 + k), 4, H * 0.03 * k);
    g.fillRect(s < 0 ? x0 - len * 0.15 : x0 + len * 0.85, y + H * 0.025 * (0.5 + k), 4, H * 0.03 * k);
    g.fillStyle = "#c89a6a";
  }
  // the red floor chevrons leading to the plaza doors
  g.fillStyle = "#e0453a";
  for (let i = 0; i < 4; i++) {
    const k = 1 - i * 0.22;
    const y = bb + (H - bb) * k * 0.85;
    const s = W * 0.05 * k;
    g.beginPath(); g.moveTo(vx - s, y + s * 0.4); g.lineTo(vx, y - s * 0.2); g.lineTo(vx + s, y + s * 0.4); g.lineTo(vx + s, y + s * 0.7); g.lineTo(vx, y + s * 0.1); g.lineTo(vx - s, y + s * 0.7); g.fill();
  }
  // header
  const bh = H * 0.15;
  g.fillStyle = "rgba(12,11,11,0.86)";
  g.fillRect(0, 0, W, bh);
  g.fillStyle = "#1d4a32";
  g.fillRect(0, bh - H * 0.008, W, H * 0.008);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#f5efe6";
  g.font = `800 ${Math.round(bh * 0.36)}px system-ui, sans-serif`;
  g.fillText(F.wayExit.toUpperCase(), vx, bh * 0.36);
  g.fillStyle = "#e8c3a0";
  g.font = `700 ${Math.round(bh * 0.22)}px system-ui, sans-serif`;
  g.fillText(F.wayExitSub, vx, bh * 0.76);
}

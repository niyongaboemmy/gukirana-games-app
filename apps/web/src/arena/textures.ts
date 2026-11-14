"use client";
import * as THREE from "three";
import type { ArenaStatus } from "@gukirana/contracts";
import { A, scopeWords, whenWords } from "./strings";

/**
 * Arena canvas textures. Screens are painted in calm, mid-bright tones (no pure white fields, no saturated glow):
 * they read clearly from the top row without glare, and stay below the bloom threshold (tone-mapped).
 */
function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d")! };
}
function tex(c: HTMLCanvasElement, repeat: [number, number] = [1, 1]) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 4;
  return t;
}
const FONT = "system-ui, -apple-system, Segoe UI, sans-serif";

/** Paint the centre-hung scoreboard face (1024 × 480): current / next event, live state, passes. */
export function paintScoreboard(g: CanvasRenderingContext2D, st: ArenaStatus | null) {
  const W = 1024;
  const H = 480;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#1b1530");
  grad.addColorStop(1, "#120f1f");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // LED pixel grid (cosmetic, very low contrast)
  g.fillStyle = "rgba(0,0,0,0.22)";
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
  // Imigongo zig-zag band top and bottom
  g.fillStyle = "#6e4a9e";
  for (let i = 0; i < 32; i++) {
    for (const [y0, dir] of [
      [0, 1],
      [H, -1],
    ] as const) {
      g.beginPath();
      g.moveTo(i * 32, y0);
      g.lineTo(i * 32 + 16, y0 + dir * 22);
      g.lineTo(i * 32 + 32, y0);
      g.fill();
    }
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  const ev = st?.current ?? st?.next ?? null;
  const live = st?.current?.status === "live";
  const tag = !st ? "GUKIRANA ARENA" : !st.open ? "ARENA CLOSED" : st.current ? A.status[st.current.status].toUpperCase() : ev ? "NEXT EVENT" : "OPEN SEATING";
  g.fillStyle = live ? "#c9524a" : "#4a3f74";
  const tw = Math.min(520, g.measureText(tag).width + 220);
  g.fillRect(W / 2 - tw / 2, 52, tw, 64);
  g.fillStyle = "#ece6f5";
  g.font = `800 40px ${FONT}`;
  g.fillText(tag, W / 2, 86, 500);
  if (ev) {
    g.fillStyle = "#ece6f5";
    g.font = `900 78px ${FONT}`;
    g.fillText(ev.title.toUpperCase(), W / 2, 196, 960);
    g.fillStyle = "#d8b45a";
    g.font = `700 46px ${FONT}`;
    g.fillText(`${ev.game ? A.game[ev.game] : A.kind[ev.kind]} · ${whenWords(ev.startsAt)}`, W / 2, 288, 940);
    g.fillStyle = "#b9b1cc";
    g.font = `600 36px ${FONT}`;
    g.fillText(scopeWords(ev.rules), W / 2, 360, 940);
    if (st?.current) g.fillText(`${st.occupancy.seats.toLocaleString()} in the bowl`, W / 2, 414, 940);
  } else {
    g.fillStyle = "#ece6f5";
    g.font = `900 84px ${FONT}`;
    g.fillText("TOURNAMENT ARENA", W / 2, 220, 960);
    g.fillStyle = "#b9b1cc";
    g.font = `600 40px ${FONT}`;
    g.fillText(A.noEvent, W / 2, 320, 940);
  }
}

export function scoreboardTexture() {
  const { c, g } = canvas(1024, 480);
  paintScoreboard(g, null);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return { texture: t, g };
}

/** LED ribbon band (2048 × 64): a slow-scrolling line of text between Imigongo chevrons. */
export function ribbonTexture(words: string[], tone = "#3a2c5c") {
  const { c, g } = canvas(2048, 64);
  g.fillStyle = tone;
  g.fillRect(0, 0, 2048, 64);
  g.fillStyle = "rgba(0,0,0,0.25)";
  for (let y = 0; y < 64; y += 3) g.fillRect(0, y, 2048, 1);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `800 34px ${FONT}`;
  const step = 2048 / words.length;
  words.forEach((w, i) => {
    g.fillStyle = i % 2 ? "#d8b45a" : "#e4def0";
    g.fillText(w, step * (i + 0.5), 34, step - 80);
    g.fillStyle = "#8a6bc0";
    g.beginPath();
    g.moveTo(step * (i + 1) - 18, 32);
    g.lineTo(step * (i + 1), 18);
    g.lineTo(step * (i + 1) + 18, 32);
    g.lineTo(step * (i + 1), 46);
    g.fill();
  });
  return tex(c);
}

/** Competition floor (1024²): dark timber tone, a ring of Imigongo triangles at the edge, a soft centre circle. */
export function floorTexture() {
  const { c, g } = canvas(1024, 1024);
  g.fillStyle = "#2f2a2c";
  g.fillRect(0, 0, 1024, 1024);
  // board strips (cosmetic, deterministic)
  for (let i = 0; i < 64; i++) {
    const v = 44 + ((i * 37) % 9);
    g.fillStyle = `rgb(${v},${v - 4},${v - 2})`;
    g.fillRect(i * 16, 0, 15, 1024);
  }
  g.translate(512, 512);
  g.strokeStyle = "#6e5a8e";
  g.lineWidth = 6;
  g.beginPath();
  g.arc(0, 0, 150, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "#4b3d66";
  for (let i = 0; i < 72; i++) {
    g.save();
    g.rotate((i / 72) * Math.PI * 2);
    g.beginPath();
    g.moveTo(-20, -500);
    g.lineTo(0, -470);
    g.lineTo(20, -500);
    g.fill();
    g.restore();
  }
  g.strokeStyle = "#5b4b78";
  g.lineWidth = 4;
  g.beginPath();
  g.arc(0, 0, 462, 0, Math.PI * 2);
  g.stroke();
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Event board in the lobby (768 × 432): what is on today and how to get in. */
export function eventBoardTexture() {
  const { c, g } = canvas(768, 432);
  return { texture: Object.assign(tex(c), { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping }), g };
}
export function paintEventBoard(g: CanvasRenderingContext2D, st: ArenaStatus | null) {
  g.fillStyle = "#1d1a26";
  g.fillRect(0, 0, 768, 432);
  g.fillStyle = "#4a3f74";
  g.fillRect(0, 0, 768, 72);
  g.fillStyle = "#ece6f5";
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.font = `800 36px ${FONT}`;
  g.fillText("TODAY IN THE ARENA", 32, 38, 700);
  const rows: [string, string, string][] = [];
  if (st?.current) rows.push([A.status[st.current.status], st.current.title, scopeWords(st.current.rules)]);
  if (st?.next) rows.push([whenWords(st.next.startsAt), st.next.title, scopeWords(st.next.rules)]);
  if (!rows.length) rows.push(["Open", "Open seating", "Sit anywhere"]);
  rows.slice(0, 2).forEach(([a, b, s], i) => {
    const y = 130 + i * 140;
    g.fillStyle = "#d8b45a";
    g.font = `700 28px ${FONT}`;
    g.fillText(a.toUpperCase(), 32, y, 700);
    g.fillStyle = "#ece6f5";
    g.font = `800 44px ${FONT}`;
    g.fillText(b, 32, y + 46, 700);
    g.fillStyle = "#b9b1cc";
    g.font = `600 26px ${FONT}`;
    g.fillText(s, 32, y + 88, 700);
  });
}

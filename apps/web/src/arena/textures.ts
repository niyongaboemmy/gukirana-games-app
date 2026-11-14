"use client";
import * as THREE from "three";
import type { ArenaStatus } from "@gukirana/contracts";
import { A, scopeWords, V, whenWords } from "./strings";
import { countdown } from "./venue";

/**
 * Arena canvas textures. Screens are painted in calm, mid-bright tones on deep charcoal (no pure white fields, no
 * saturated glow): they read from the top row without glare and stay below the bloom threshold (tone-mapped).
 * Palette: charcoal, warm timber, the arena purple as an accent, gold highlights. Surfaces are calm (no busy patterns);
 * the Imigongo motif is a refined accent band only.
 */
function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d")! };
}
function tex(c: HTMLCanvasElement, repeat: [number, number] = [1, 1], srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  return t;
}
const FONT = "system-ui, -apple-system, Segoe UI, sans-serif";
const C = { charcoal: "#17161b", panel: "#211f27", text: "#ece7f2", muted: "#aaa3b8", gold: "#d8b45a", purple: "#7b5cb3", purpleDeep: "#3d2f5e", live: "#b9504a" };
/** deterministic 0…1 hash */
const h1 = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Imigongo chevron band (accent only) */
function imigongoBand(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, fg = C.gold, bg = C.charcoal) {
  g.fillStyle = bg;
  g.fillRect(x0, y0, w, h);
  g.fillStyle = fg;
  const step = h * 1.4;
  for (let x = x0; x < x0 + w; x += step) {
    g.beginPath();
    g.moveTo(x, y0 + h);
    g.lineTo(x + step / 2, y0 + h * 0.18);
    g.lineTo(x + step, y0 + h);
    g.lineTo(x + step * 0.78, y0 + h);
    g.lineTo(x + step / 2, y0 + h * 0.52);
    g.lineTo(x + step * 0.22, y0 + h);
    g.fill();
  }
}

/* ---------------- centre-hung board ---------------- */

/** Paint the centre-hung board face (1024 × 512): event, countdown, REAL people-inside count, feature table state. */
export function paintScoreboard(g: CanvasRenderingContext2D, st: ArenaStatus | null, now = Date.now()) {
  const W = 1024;
  const H = 512;
  g.fillStyle = C.charcoal;
  g.fillRect(0, 0, W, H);
  // soft vignette panel + LED pixel grid (cosmetic, very low contrast)
  const grad = g.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.7);
  grad.addColorStop(0, "#26222f");
  grad.addColorStop(1, C.charcoal);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(0,0,0,0.2)";
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
  imigongoBand(g, 0, H - 26, W, 26, C.purpleDeep, C.charcoal);
  g.fillStyle = C.gold;
  g.fillRect(0, 0, W, 4);
  g.textAlign = "center";
  g.textBaseline = "middle";
  const ev = st?.current ?? st?.next ?? null;
  const live = st?.current?.status === "live";
  const tag = !st ? "GUKIRANA ARENA" : !st.open ? "ARENA CLOSED" : st.current ? A.status[st.current.status].toUpperCase() : ev ? "NEXT EVENT" : "OPEN SEATING";
  g.font = `800 34px ${FONT}`;
  const tw = Math.min(440, g.measureText(tag).width + 70);
  g.fillStyle = live ? C.live : C.purpleDeep;
  g.beginPath();
  g.roundRect(W / 2 - tw / 2, 34, tw, 54, 27);
  g.fill();
  g.fillStyle = C.text;
  g.fillText(tag, W / 2, 62, 420);
  if (ev) {
    g.fillStyle = C.text;
    g.font = `900 72px ${FONT}`;
    g.fillText(ev.title.toUpperCase(), W / 2, 150, 960);
    g.fillStyle = C.gold;
    g.font = `700 38px ${FONT}`;
    g.fillText(`${ev.game ? A.game[ev.game] : A.kind[ev.kind]} · ${whenWords(ev.startsAt)}`, W / 2, 222, 940);
    const cd = (ev.status === "scheduled" || ev.status === "doors_open") && st?.current ? countdown(ev.startsAt, now) : null;
    g.font = `800 64px ${FONT}`;
    g.fillStyle = C.text;
    if (cd) g.fillText(`STARTS IN ${cd.text.toUpperCase()}`, W / 2, 306, 940);
    else if (live) g.fillText(V.noMatch.toUpperCase(), W / 2, 306, 940);
    else {
      g.font = `600 36px ${FONT}`;
      g.fillStyle = C.muted;
      g.fillText(scopeWords(ev.rules), W / 2, 306, 940);
    }
  } else {
    g.fillStyle = C.text;
    g.font = `900 80px ${FONT}`;
    g.fillText("TOURNAMENT ARENA", W / 2, 190, 960);
    g.fillStyle = C.muted;
    g.font = `600 38px ${FONT}`;
    g.fillText(A.noEvent, W / 2, 270, 940);
  }
  // real counts only (server occupancy)
  if (st) {
    g.fillStyle = C.muted;
    g.font = `700 36px ${FONT}`;
    g.fillText(`${V.inside(st.occupancy.concourse)} · ${V.seatedCount(st.occupancy.seats)}`, W / 2, 400, 940);
  }
}

export function scoreboardTexture() {
  const { c, g } = canvas(1024, 512);
  paintScoreboard(g, null);
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return { texture: t, g };
}

/* ---------------- LED ribbons ---------------- */

function glyph(g: CanvasRenderingContext2D, kind: number, x: number, y: number, s: number) {
  g.save();
  g.translate(x, y);
  if (kind === 0) {
    // pool ball
    g.fillStyle = C.text;
    g.beginPath();
    g.arc(0, 0, s, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = C.charcoal;
    g.font = `900 ${s * 1.2}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("8", 0, 1);
  } else if (kind === 1) {
    // die
    g.fillStyle = C.gold;
    g.beginPath();
    g.roundRect(-s, -s, s * 2, s * 2, s * 0.35);
    g.fill();
    g.fillStyle = C.charcoal;
    for (const [px, py] of [
      [-0.5, -0.5],
      [0, 0],
      [0.5, 0.5],
    ] as [number, number][])
      g.fillRect(px * s - s * 0.16, py * s - s * 0.16, s * 0.32, s * 0.32);
  } else {
    // igisoro pits (2 × 4)
    g.fillStyle = C.purple;
    for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.arc(-s * 1.2 + k * s * 0.8, -s * 0.4 + r * s * 0.8, s * 0.3, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

/** Paint a ribbon band (2048 × 64): words with game glyphs between them over an Imigongo hairline. */
export function paintRibbon(g: CanvasRenderingContext2D, words: string[], tone = C.charcoal) {
  g.fillStyle = tone;
  g.fillRect(0, 0, 2048, 64);
  g.fillStyle = "rgba(0,0,0,0.22)";
  for (let y = 0; y < 64; y += 3) g.fillRect(0, y, 2048, 1);
  imigongoBand(g, 0, 56, 2048, 8, C.purpleDeep, tone);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `800 30px ${FONT}`;
  const step = 2048 / Math.max(1, words.length);
  words.forEach((w, i) => {
    g.fillStyle = i % 2 ? C.gold : C.text;
    g.fillText(w, step * (i + 0.5), 30, step - 110);
    glyph(g, i % 3, step * (i + 1), 30, 12);
  });
}
export function ribbonTexture(words: string[], tone = C.charcoal) {
  const { c, g } = canvas(2048, 64);
  paintRibbon(g, words, tone);
  const t = tex(c);
  return Object.assign(t, { userData: { g } });
}

/* ---------------- surfaces (calm, premium) ---------------- */

/** Warm timber acoustic slats (vertical) with dark gaps: the shell, lobby walls, portal blocks. */
export function slatTexture() {
  const { c, g } = canvas(256, 256);
  // (the joints are a deep warm brown, not black: at a distance the mip levels average to a calm timber tone)
  g.fillStyle = "#2e241b";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 8; i++) {
    const v = h1(i) * 14;
    g.fillStyle = `rgb(${128 + v},${94 + v * 0.7},${64 + v * 0.5})`;
    g.fillRect(i * 32 + 3, 0, 24, 256);
    // faint grain
    g.fillStyle = "rgba(60,40,24,0.12)";
    for (let k = 0; k < 6; k++) g.fillRect(i * 32 + 5 + h1(i * 7 + k) * 20, 0, 1, 256);
  }
  return tex(c);
}

/** Polished (matte-sealed) concrete: very subtle mottling. */
export function concreteTexture() {
  const { c, g } = canvas(256, 256);
  g.fillStyle = "#a8a197";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const v = 120 + Math.floor(h1(i) * 30);
    g.fillStyle = `rgba(${v},${v - 4},${v - 9},0.25)`;
    g.fillRect(h1(i + 3) * 256, h1(i + 9) * 256, 2 + h1(i + 5) * 5, 2 + h1(i + 11) * 5);
  }
  g.strokeStyle = "rgba(40,36,32,0.35)";
  g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, 255, 255); // saw-cut joint every tile
  return tex(c);
}

/** Acoustic ceiling: fine perforated timber panels (calm, low contrast). */
export function ceilingTexture() {
  const { c, g } = canvas(256, 256);
  g.fillStyle = "#4a3a2c";
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = "rgba(20,14,10,0.55)";
  for (let y = 8; y < 256; y += 16) for (let x = 8; x < 256; x += 16) g.fillRect(x - 1, y - 1, 2.5, 2.5);
  g.fillStyle = "rgba(15,10,8,0.8)";
  g.fillRect(0, 0, 256, 3);
  g.fillRect(0, 0, 3, 256);
  return tex(c);
}

/** Imigongo accent band texture (a refined strip, not wallpaper). */
export function accentTexture() {
  const { c, g } = canvas(512, 64);
  imigongoBand(g, 0, 0, 512, 64, C.gold, "#2a2420");
  return tex(c);
}

/** Row number plates on the aisle-end seats: an atlas of 1…6 (u = (n − 1) / 6). */
export function plateAtlas() {
  const { c, g } = canvas(384, 64);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = "#2a2730";
    g.fillRect(i * 64, 0, 64, 64);
    g.fillStyle = C.gold;
    g.font = `800 40px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(i + 1), i * 64 + 32, 34);
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Wayfinding totem screen (256 × 512): "you are here" bearing and the section ring. */
export function totemTexture(deg: number) {
  const { c, g } = canvas(256, 512);
  g.fillStyle = C.charcoal;
  g.fillRect(0, 0, 256, 512);
  g.fillStyle = C.gold;
  g.fillRect(0, 0, 256, 6);
  g.fillStyle = C.text;
  g.textAlign = "center";
  g.font = `800 26px ${FONT}`;
  g.fillText(V.youAreHere.toUpperCase(), 128, 46);
  // section ring
  const cx = 128;
  const cy = 200;
  const lower = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
  const starts = [0, 28, 56, 84, 112, 140, 192, 220, 248, 276, 304, 332];
  g.font = `800 15px ${FONT}`;
  lower.forEach((s, i) => {
    const a = ((starts[i]! + 14) * Math.PI) / 180;
    // screen: south (+z) down, east (+x) right
    g.fillStyle = C.muted;
    g.fillText(s, cx + Math.sin(a) * 62, cy + Math.cos(a) * 62 + 5);
  });
  g.strokeStyle = C.purple;
  g.lineWidth = 10;
  g.beginPath();
  g.arc(cx, cy, 84, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "#2c2836";
  g.beginPath();
  g.arc(cx, cy, 40, 0, Math.PI * 2);
  g.fill();
  const a = (deg * Math.PI) / 180;
  g.fillStyle = C.gold;
  g.beginPath();
  g.arc(cx + Math.sin(a) * 84, cy + Math.cos(a) * 84, 11, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = C.text;
  g.font = `700 20px ${FONT}`;
  g.fillText("EXIT ↓ SOUTH PORTAL", 128, 340);
  g.fillStyle = C.muted;
  g.font = `600 18px ${FONT}`;
  g.fillText("Lower A–L · stairs down", 128, 384);
  g.fillText("Upper U1–U8 · stairs up", 128, 412);
  g.fillText("VIP V1–V4 · box stairs", 128, 440);
  imigongoBand(g, 0, 488, 256, 24, C.purpleDeep, C.charcoal);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Concession menu screen (512 × 256): item names (free tasting: no prices, nothing is sold). */
export function menuTexture(title: string, items: string[]) {
  const { c, g } = canvas(512, 256);
  g.fillStyle = C.charcoal;
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = C.gold;
  g.font = `800 34px ${FONT}`;
  g.textBaseline = "middle";
  g.fillText(title.toUpperCase(), 24, 38);
  g.fillStyle = C.text;
  g.font = `600 26px ${FONT}`;
  items.forEach((it, i) => g.fillText(it, 24 + (i % 2) * 244, 104 + Math.floor(i / 2) * 50));
  g.fillStyle = C.muted;
  g.font = `600 18px ${FONT}`;
  g.fillText("Free tasting · just for fun", 24, 226);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/* ---------------- floor + lobby board ---------------- */

/** Competition floor (1024²): dark timber tone, a ring of Imigongo triangles at the edge, a soft centre circle. */
export function floorTexture() {
  const { c, g } = canvas(1024, 1024);
  g.fillStyle = "#2a2626";
  g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 64; i++) {
    const v = 40 + ((i * 37) % 7);
    g.fillStyle = `rgb(${v},${v - 4},${v - 3})`;
    g.fillRect(i * 16, 0, 15, 1024);
  }
  g.translate(512, 512);
  g.strokeStyle = "#5f4e80";
  g.lineWidth = 5;
  g.beginPath();
  g.arc(0, 0, 150, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "#3f3358";
  for (let i = 0; i < 72; i++) {
    g.save();
    g.rotate((i / 72) * Math.PI * 2);
    g.beginPath();
    g.moveTo(-18, -500);
    g.lineTo(0, -474);
    g.lineTo(18, -500);
    g.fill();
    g.restore();
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Event board in the lobby (768 × 432): what is on today and how to get in. */
export function eventBoardTexture() {
  const { c, g } = canvas(768, 432);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return { texture: t, g };
}
export function paintEventBoard(g: CanvasRenderingContext2D, st: ArenaStatus | null, announce: string | null = null, now = Date.now()) {
  g.fillStyle = C.charcoal;
  g.fillRect(0, 0, 768, 432);
  g.fillStyle = C.purpleDeep;
  g.fillRect(0, 0, 768, 68);
  g.fillStyle = C.text;
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.font = `800 32px ${FONT}`;
  g.fillText("TODAY IN THE ARENA", 28, 36, 520);
  if (st) {
    g.textAlign = "right";
    g.fillStyle = C.gold;
    g.font = `700 24px ${FONT}`;
    g.fillText(V.inside(st.occupancy.concourse), 740, 36, 240);
    g.textAlign = "left";
  }
  const rows: [string, string, string][] = [];
  if (st?.current) {
    const cd = countdown(st.current.startsAt, now);
    rows.push([cd && st.current.status !== "live" ? V.startsIn(cd.text) : A.status[st.current.status], st.current.title, scopeWords(st.current.rules)]);
  }
  if (st?.next) rows.push([whenWords(st.next.startsAt), st.next.title, scopeWords(st.next.rules)]);
  if (!rows.length) rows.push(["Open", "Open seating", "Sit anywhere"]);
  rows.slice(0, 2).forEach(([a, b, s], i) => {
    const y = 116 + i * 120;
    g.fillStyle = C.gold;
    g.font = `700 24px ${FONT}`;
    g.fillText(a.toUpperCase(), 28, y, 712);
    g.fillStyle = C.text;
    g.font = `800 40px ${FONT}`;
    g.fillText(b, 28, y + 40, 712);
    g.fillStyle = C.muted;
    g.font = `600 22px ${FONT}`;
    g.fillText(s, 28, y + 76, 712);
  });
  if (announce) {
    g.fillStyle = "#2a2632";
    g.fillRect(0, 384, 768, 48);
    g.fillStyle = C.text;
    g.font = `600 22px ${FONT}`;
    g.fillText(announce, 28, 408, 712);
  }
}

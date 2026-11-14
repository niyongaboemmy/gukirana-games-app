import * as THREE from "three";
import { PORTALS, ringPoint, SERVICE_ANGLE, PLAZA_RADIUS, DOOR_RING, EXPANSION_PLOTS, EXPANSION_RING } from "@/world/layout";
import { PLOTS } from "@/world/footprints";

/**
 * Canvas textures for the Administrative Block (signage, screens, the compound map, the ticket board). Painted
 * once per session (cached), small (≤ 1024 px), matte: screens are emissive below the bloom threshold.
 * Signage uses the system UI sans-serif (civic, not the rounded game font).
 */
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const cache = new Map<string, THREE.CanvasTexture>();

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d")! };
}
function finish(c: HTMLCanvasElement, aniso = 4) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}
function memo(key: string, build: () => THREE.CanvasTexture) {
  let t = cache.get(key);
  if (!t) {
    t = build();
    cache.set(key, t);
  }
  return t;
}
// deterministic pseudo-noise (cosmetic only)
const n = (i: number) => {
  const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
  return x - Math.floor(x);
};
function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Brushed-steel nameplate beside an office door: office name, the role line, an accent rule. */
export function nameplateTexture(name: string, sub: string, accent: string) {
  return memo(`np-${name}`, () => {
    const { c, g } = canvas(512, 192);
    g.fillStyle = "#24262a";
    g.fillRect(0, 0, 512, 192);
    g.fillStyle = accent;
    g.fillRect(36, 40, 6, 112);
    g.fillStyle = "#eceae6";
    g.font = `600 58px ${SANS}`;
    g.textBaseline = "alphabetic";
    g.fillText(name, 66, 104);
    g.fillStyle = "#a7abb2";
    g.font = `400 28px ${SANS}`;
    g.fillText(sub, 68, 146);
    return finish(c, 8);
  });
}

/** A lettered sign (matte light letters on a dark or stone panel). */
export function signTexture(text: string, opts: { sub?: string; w?: number; h?: number; bg?: string; fg?: string; size?: number; arrows?: boolean } = {}) {
  const { sub, w = 1024, h = 256, bg = "#26282c", fg = "#ece9e3", size = 96, arrows = false } = opts;
  return memo(`sign-${text}-${sub}-${w}-${h}-${bg}`, () => {
    const { c, g } = canvas(w, h);
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `600 ${size}px ${SANS}`;
    const y = sub ? h * 0.42 : h / 2;
    // letter-spaced capitals
    const spaced = text.split("").join(String.fromCharCode(8202));
    g.fillText(spaced, w / 2, y);
    if (sub) {
      g.fillStyle = "#a7abb2";
      g.font = `400 ${Math.round(size * 0.36)}px ${SANS}`;
      g.fillText(sub, w / 2, h * 0.76);
    }
    if (arrows) {
      g.strokeStyle = fg;
      g.lineWidth = h * 0.035;
      g.lineCap = "round";
      for (const s of [-1, 1]) {
        const x = w / 2 + s * w * 0.4;
        g.beginPath();
        g.moveTo(x - s * h * 0.12, y);
        g.lineTo(x + s * h * 0.12, y);
        g.moveTo(x + s * h * 0.03, y - h * 0.09);
        g.lineTo(x + s * h * 0.12, y);
        g.lineTo(x + s * h * 0.03, y + h * 0.09);
        g.stroke();
      }
    }
    return finish(c, 8);
  });
}

export interface DirectoryRow {
  name: string;
  status: string;
  dot: string;
  /** e.g. "You can enter" (role holders) */
  note: string | null;
}
/** The live directory board at reception (re-painted when an office's status changes). */
export function paintDirectory(t: THREE.CanvasTexture | null, rows: DirectoryRow[], title: string, foot: string): THREE.CanvasTexture {
  const tex = t ?? finish(canvas(1024, 600).c, 8);
  const c = tex.image as HTMLCanvasElement;
  const g = c.getContext("2d")!;
  const W = c.width;
  const H = c.height;
  g.fillStyle = "#1d1f23";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#c9a96b";
  g.fillRect(56, 112, W - 112, 3);
  g.fillStyle = "#ecebe7";
  g.font = `600 52px ${SANS}`;
  g.textBaseline = "alphabetic";
  g.fillText(title.split("").join(String.fromCharCode(8202)), 56, 88);
  rows.forEach((r, i) => {
    const y = 150 + i * 96;
    g.fillStyle = i % 2 ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.05)";
    g.fillRect(40, y, W - 80, 84);
    g.fillStyle = "#ecebe7";
    g.font = `600 40px ${SANS}`;
    g.fillText(r.name, 72, y + 54);
    g.fillStyle = r.dot;
    g.beginPath();
    g.arc(W - 360, y + 42, 12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#c6c9ce";
    g.font = `500 30px ${SANS}`;
    g.fillText(r.status, W - 336, r.note ? y + 42 : y + 52);
    if (r.note) {
      g.fillStyle = "#e3c98f"; // warm note (queue / you can enter), no blue
      g.font = `500 22px ${SANS}`;
      g.fillText(r.note, W - 336, y + 76);
    }
  });
  g.fillStyle = "#8b9097";
  g.font = `400 24px ${SANS}`;
  g.fillText(foot, 56, H - 30);
  tex.needsUpdate = true;
  return tex;
}

/** Compound overview for the Super Admin's wall: the plaza, every hall on the door ring, the expansion plots. */
export function compoundMapTexture() {
  return memo("compound-map", () => {
    const W = 1024;
    const H = 576;
    const { c, g } = canvas(W, H);
    g.fillStyle = "#1b1d21";
    g.fillRect(0, 0, W, H);
    // grid
    g.strokeStyle = "rgba(255,255,255,0.04)";
    g.lineWidth = 1;
    for (let x = 0; x < W; x += 32) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }
    for (let y = 0; y < H; y += 32) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
    const cx = W * 0.4;
    const cy = H * 0.52;
    const k = 2.0; // px per metre
    const at = (x: number, z: number) => [cx + x * k, cy + z * k] as const;
    // outer promenade, plaza, fountain
    g.strokeStyle = "rgba(201,169,107,0.35)";
    g.lineWidth = 8;
    g.beginPath();
    g.arc(cx, cy, 102 * k, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = "#33363c";
    g.beginPath();
    g.arc(cx, cy, PLAZA_RADIUS * k, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#4b6b84";
    g.beginPath();
    g.arc(cx, cy, 5 * k, 0, Math.PI * 2);
    g.fill();
    // avenue south
    g.fillStyle = "#33363c";
    g.fillRect(cx - 4 * k, cy + PLAZA_RADIUS * k, 8 * k, H);
    // buildings (footprints, rotated into place)
    for (const p of PLOTS) {
      const d = ringPoint(p.angleDeg, p.ring);
      const portal = PORTALS.find((q) => q.id === p.id);
      const col = p.id === "service" ? "#3DA9FC" : portal && portal.kind !== "soon" ? portal.color : "#5d636c";
      g.save();
      g.translate(...at(d.x, d.z));
      g.rotate(-d.rotY);
      g.fillStyle = col;
      g.globalAlpha = p.type === "site" ? 0.35 : 0.9;
      for (const r of p.rects) g.fillRect(r.x0 * k, -r.z0 * k, (r.x1 - r.x0) * k, (r.z0 - r.z1) * k);
      g.restore();
    }
    g.globalAlpha = 1;
    // legend
    const items = [...PORTALS.filter((p) => p.href || p.kind === "arena").map((p) => [p.label, p.color] as const), ["Help desk · Cafe", "#3DA9FC"] as const, ["Reserved plots", "#5d636c"] as const];
    g.font = `600 30px ${SANS}`;
    g.fillStyle = "#ecebe7";
    g.fillText("GUKIRANA COMPOUND", W - 330, 56);
    g.font = `400 22px ${SANS}`;
    items.forEach(([label, col], i) => {
      const y = 100 + i * 38;
      g.fillStyle = col;
      g.fillRect(W - 330, y - 16, 18, 18);
      g.fillStyle = "#c6c9ce";
      g.fillText(label, W - 300, y);
    });
    g.fillStyle = "#8b9097";
    g.font = `400 18px ${SANS}`;
    g.fillText(`Door ring ${DOOR_RING} m · plaza ${PLAZA_RADIUS} m · ${EXPANSION_PLOTS.length} plots at ${EXPANSION_RING} m`, W - 330, H - 30);
    void SERVICE_ANGLE;
    return finish(c, 8);
  });
}

/** Customer Support ticket board: three columns of cards. */
export function ticketBoardTexture() {
  return memo("tickets", () => {
    const W = 1024;
    const H = 512;
    const { c, g } = canvas(W, H);
    g.fillStyle = "#e9e6e0";
    g.fillRect(0, 0, W, H);
    const cols = ["NEW", "IN PROGRESS", "WAITING", "RESOLVED"];
    const colours = ["#d98c5f", "#5b9bd5", "#c9a96b", "#5fae8b"];
    const cw = (W - 60) / cols.length;
    cols.forEach((name, i) => {
      const x = 30 + i * cw;
      g.fillStyle = "#3a3d42";
      g.font = `600 26px ${SANS}`;
      g.fillText(name, x + 12, 50);
      g.fillStyle = "rgba(0,0,0,0.12)";
      g.fillRect(x + 4, 64, cw - 8, 2);
      const count = 2 + Math.floor(n(i * 7) * 4);
      for (let k = 0; k < count; k++) {
        const y = 84 + k * 84;
        if (y > H - 80) break;
        g.fillStyle = "#ffffff";
        rrect(g, x + 10, y, cw - 28, 70, 6);
        g.fill();
        g.fillStyle = colours[i]!;
        g.fillRect(x + 10, y, 6, 70);
        g.fillStyle = "#3a3d42";
        g.font = `600 18px ${SANS}`;
        g.fillText(`#${1040 + i * 17 + k * 3}`, x + 26, y + 26);
        g.fillStyle = "#8b9097";
        for (let l = 0; l < 2; l++) g.fillRect(x + 26, y + 38 + l * 14, (cw - 80) * (0.5 + n(i * 31 + k * 5 + l) * 0.45), 6);
      }
    });
    return finish(c, 8);
  });
}

export type ScreenKind = "exec" | "it" | "it-code" | "finance" | "finance-table" | "support" | "meeting" | "reception";
/** Monitor contents (dark UI, soft colours; emissive below the bloom threshold). */
export function screenTexture(kind: ScreenKind) {
  return memo(`screen-${kind}`, () => {
    const W = 512;
    const H = 320;
    const { c, g } = canvas(W, H);
    g.fillStyle = "#16181c";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "#202329";
    g.fillRect(0, 0, W, 28);
    g.fillStyle = "#c9a96b";
    g.fillRect(12, 11, 40, 6);
    const panel = (x: number, y: number, w: number, h: number) => {
      g.fillStyle = "#1f2227";
      rrect(g, x, y, w, h, 6);
      g.fill();
    };
    const bars = (x: number, y: number, w: number, h: number, col: string, seed: number) => {
      const N = 12;
      for (let i = 0; i < N; i++) {
        const v = 0.25 + n(seed + i) * 0.7;
        g.fillStyle = col;
        g.fillRect(x + (i * w) / N + 2, y + h - v * h, w / N - 4, v * h);
      }
    };
    const line = (x: number, y: number, w: number, h: number, col: string, seed: number) => {
      g.strokeStyle = col;
      g.lineWidth = 3;
      g.beginPath();
      for (let i = 0; i <= 20; i++) {
        const v = 0.3 + 0.5 * n(seed + i * 0.37) * 0.6 + (i / 20) * 0.25;
        const px = x + (i / 20) * w;
        const py = y + h - v * h;
        if (i) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
      g.stroke();
    };
    const rows = (x: number, y: number, w: number, count: number, seed: number, dots?: string[]) => {
      for (let i = 0; i < count; i++) {
        const yy = y + i * 22;
        if (dots) {
          g.fillStyle = dots[Math.floor(n(seed + i) * dots.length)]!;
          g.beginPath();
          g.arc(x + 6, yy + 4, 4, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = "#5b616b";
        g.fillRect(x + (dots ? 18 : 0), yy, (w - 30) * (0.45 + n(seed * 3 + i) * 0.5), 8);
      }
    };
    if (kind === "exec" || kind === "meeting") {
      panel(16, 44, 230, 120);
      bars(28, 60, 206, 92, "#5b9bd5", 3);
      panel(262, 44, 234, 120);
      line(274, 60, 210, 92, "#c9a96b", 9);
      panel(16, 178, 480, 126);
      rows(30, 196, 450, 5, 21, ["#22c55e", "#f59e0b", "#5b9bd5"]);
    } else if (kind === "it") {
      panel(16, 44, 480, 140);
      for (let i = 0; i < 6; i++) {
        const ok = n(i + 40) > 0.18;
        g.fillStyle = ok ? "#1f3a2b" : "#3d3120";
        rrect(g, 30 + (i % 3) * 156, 58 + Math.floor(i / 3) * 62, 144, 52, 6);
        g.fill();
        g.fillStyle = ok ? "#22c55e" : "#f59e0b";
        g.beginPath();
        g.arc(48 + (i % 3) * 156, 84 + Math.floor(i / 3) * 62, 6, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#9aa1ab";
        g.fillRect(62 + (i % 3) * 156, 80 + Math.floor(i / 3) * 62, 90, 8);
      }
      panel(16, 196, 480, 108);
      line(28, 206, 456, 88, "#5b9bd5", 51);
    } else if (kind === "it-code") {
      for (let i = 0; i < 11; i++) {
        const indent = Math.floor(n(i + 70) * 4) * 18;
        g.fillStyle = ["#7aa2d6", "#c9a96b", "#8fc4a5", "#9aa1ab"][Math.floor(n(i + 90) * 4)]!;
        g.fillRect(20 + indent, 46 + i * 24, 120 + n(i + 110) * 260, 9);
      }
    } else if (kind === "finance") {
      panel(16, 44, 480, 160);
      line(28, 56, 456, 136, "#5fae8b", 77);
      line(28, 56, 456, 136, "rgba(201,169,107,0.8)", 133);
      panel(16, 216, 152, 88);
      panel(180, 216, 152, 88);
      panel(344, 216, 152, 88);
      g.fillStyle = "#ecebe7";
      g.font = `600 28px ${SANS}`;
      ["+12%", "4,210", "98.6%"].forEach((t, i) => g.fillText(t, 32 + i * 164, 270));
    } else if (kind === "finance-table") {
      for (let r = 0; r < 11; r++) {
        g.fillStyle = r % 2 ? "#1b1e22" : "#1f2227";
        g.fillRect(16, 40 + r * 24, 480, 24);
        for (let k = 0; k < 4; k++) {
          g.fillStyle = k === 3 ? (n(r + 15) > 0.3 ? "#5fae8b" : "#d98c5f") : "#6b717b";
          g.fillRect(28 + k * 120, 48 + r * 24, 60 + n(r * 4 + k) * 40, 8);
        }
      }
    } else if (kind === "support") {
      panel(16, 44, 170, 260);
      rows(28, 60, 150, 10, 5, ["#d98c5f", "#5b9bd5", "#5fae8b"]);
      panel(198, 44, 298, 260);
      for (let i = 0; i < 5; i++) {
        const mine = i % 2 === 1;
        g.fillStyle = mine ? "#2b3a4f" : "#2a2d33";
        rrect(g, mine ? 270 : 212, 60 + i * 46, 210, 34, 8);
        g.fill();
      }
    } else {
      // reception: visitor list + clock
      panel(16, 44, 480, 260);
      g.fillStyle = "#ecebe7";
      g.font = `600 30px ${SANS}`;
      g.fillText("Visitors today", 32, 84);
      rows(32, 108, 440, 8, 61, ["#22c55e", "#8a9099"]);
    }
    const t = finish(c, 4);
    return t;
  });
}

/** Server rack front: perforated door with status LEDs. */
export function rackTexture() {
  return memo("rack", () => {
    const { c, g } = canvas(128, 256);
    g.fillStyle = "#1a1b1e";
    g.fillRect(0, 0, 128, 256);
    for (let u = 0; u < 20; u++) {
      const y = 12 + u * 12;
      g.fillStyle = "#24262a";
      g.fillRect(10, y, 108, 10);
      for (let k = 0; k < 3; k++) {
        const on = n(u * 5 + k) > 0.35;
        g.fillStyle = on ? (n(u * 9 + k) > 0.85 ? "#f59e0b" : "#22c55e") : "#2e3135";
        g.fillRect(96 + k * 6, y + 3, 3, 3);
      }
      g.fillStyle = "#2f3237";
      for (let h = 0; h < 10; h++) g.fillRect(16 + h * 7, y + 3, 4, 4);
    }
    return finish(c, 4);
  });
}

/** Filing cabinet fronts (four drawers, label holders, handles). */
export function filesTexture() {
  return memo("files", () => {
    const { c, g } = canvas(128, 256);
    g.fillStyle = "#9aa0a6";
    g.fillRect(0, 0, 128, 256);
    for (let d = 0; d < 4; d++) {
      const y = d * 64;
      g.fillStyle = "#7d838a";
      g.fillRect(0, y, 128, 3);
      g.fillStyle = "#e8e6e1";
      g.fillRect(44, y + 14, 40, 14);
      g.fillStyle = "#4a4e54";
      g.fillRect(40, y + 36, 48, 6);
    }
    return finish(c, 4);
  });
}

/**
 * Painted art for the 2D pool boards (practice + live): a tournament table drawn once into an offscreen canvas
 * (worsted cloth with fibre noise and nap, walnut rails with grain and a bevel, pearl diamond sights, leather pocket
 * liners, cushion noses) and a cue with tip, ferrule, maple shaft, joint, wrap and butt. Purely cosmetic: the
 * texture noise is a deterministic hash, never game randomness.
 */
const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export type TableSpec = {
  /** playing surface in table units */
  w: number;
  h: number;
  /** rail width in table units */
  pad: number;
  pockets: readonly (readonly [number, number] | readonly [number, number, number])[];
  pocketR: number;
  /** canvas pixels per table unit */
  scale: number;
  cloth?: string;
};

export function paintTable(spec: TableSpec): HTMLCanvasElement {
  const { w, h, pad, pocketR, scale } = spec;
  const cloth = spec.cloth ?? "#1f6f78";
  const c = document.createElement("canvas");
  c.width = Math.round((w + pad * 2) * scale);
  c.height = Math.round((h + pad * 2) * scale);
  const g = c.getContext("2d")!;
  g.setTransform(scale, 0, 0, scale, pad * scale, pad * scale);
  const u = pad / 40; // drawing details are tuned for a 40-unit rail

  // walnut rails: warm base, long grain streaks, then a bevel (light outer lip, dark inner edge)
  g.save();
  g.beginPath();
  g.roundRect(-pad, -pad, w + pad * 2, h + pad * 2, pad * 0.7);
  g.clip();
  const wood = g.createLinearGradient(0, -pad, 0, h + pad);
  wood.addColorStop(0, "#6e3f1f");
  wood.addColorStop(0.5, "#5a3218");
  wood.addColorStop(1, "#4b2913");
  g.fillStyle = wood;
  g.fillRect(-pad, -pad, w + pad * 2, h + pad * 2);
  for (let i = 0; i < 260; i++) {
    const y = -pad + hash(i) * (h + pad * 2);
    const amp = 1 + hash(i + 7) * 3 * u;
    const dark = hash(i + 3) > 0.45;
    g.strokeStyle = dark ? `rgba(30,14,5,${0.08 + hash(i + 5) * 0.16})` : `rgba(255,214,160,${0.04 + hash(i + 9) * 0.07})`;
    g.lineWidth = (0.6 + hash(i + 11) * 1.8) * u;
    g.beginPath();
    for (let x = -pad; x <= w + pad; x += 20 * u) {
      const yy = y + Math.sin(x / ((60 + hash(i + 13) * 120) * u) + i) * amp;
      if (x === -pad) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
  }
  g.restore();
  g.lineWidth = 3 * u;
  g.strokeStyle = "rgba(255,220,170,.22)";
  g.beginPath();
  g.roundRect(-pad + 2 * u, -pad + 2 * u, w + pad * 2 - 4 * u, h + pad * 2 - 4 * u, pad * 0.65);
  g.stroke();

  // cloth: worsted base, fine fibre speckle, faint nap running head → foot, soft vignette under the rails
  const base = g.createRadialGradient(w / 2, h / 2, 40 * u, w / 2, h / 2, w * 0.72);
  base.addColorStop(0, shade(cloth, 1.12));
  base.addColorStop(1, shade(cloth, 0.92));
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) {
    const v = hash(i * 3 + 1);
    g.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.09})` : `rgba(0,0,0,${v * 0.11})`;
    g.fillRect(hash(i * 5 + 2) * w, hash(i * 7 + 3) * h, 1.2 * u, 0.8 * u);
  }
  for (let y = 0, k = 0; y < h; y += 3 * u, k++) {
    g.fillStyle = `rgba(0,0,0,${0.012 + hash(k + 17) * 0.018})`;
    g.fillRect(0, y, w, u);
  }
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, "rgba(0,0,0,.32)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    return gr;
  };
  const cush = 9 * u;
  g.fillStyle = edge(0, 0, 0, 26 * u);
  g.fillRect(0, 0, w, 26 * u);
  g.fillStyle = edge(0, h, 0, h - 26 * u);
  g.fillRect(0, h - 26 * u, w, 26 * u);
  g.fillStyle = edge(0, 0, 26 * u, 0);
  g.fillRect(0, 0, 26 * u, h);
  g.fillStyle = edge(w, 0, w - 26 * u, 0);
  g.fillRect(w - 26 * u, 0, 26 * u, h);
  // cushion noses (slightly darker cloth with a lit edge)
  g.fillStyle = shade(cloth, 0.78);
  g.fillRect(0, 0, w, cush);
  g.fillRect(0, h - cush, w, cush);
  g.fillRect(0, 0, cush, h);
  g.fillRect(w - cush, 0, cush, h);
  g.strokeStyle = "rgba(255,255,255,.14)";
  g.lineWidth = 1.2 * u;
  g.strokeRect(cush, cush, w - cush * 2, h - cush * 2);
  // head string and spots
  g.strokeStyle = "rgba(255,255,255,.10)";
  g.lineWidth = u;
  g.beginPath();
  g.moveTo(w / 4, cush);
  g.lineTo(w / 4, h - cush);
  g.stroke();
  g.fillStyle = "rgba(255,255,255,.35)";
  for (const x of [w / 4, (w * 3) / 4]) {
    g.beginPath();
    g.arc(x, h / 2, 2.2 * u, 0, Math.PI * 2);
    g.fill();
  }

  // diamond sights (mother of pearl) on the rail tops
  const diamond = (x: number, y: number) => {
    const s = 5 * u;
    g.fillStyle = "#efe6d2";
    g.strokeStyle = "rgba(40,20,8,.6)";
    g.lineWidth = 0.8 * u;
    g.beginPath();
    g.moveTo(x, y - s);
    g.lineTo(x + s * 0.7, y);
    g.lineTo(x, y + s);
    g.lineTo(x - s * 0.7, y);
    g.closePath();
    g.fill();
    g.stroke();
  };
  for (let k = 1; k < 8; k++) {
    if (k === 4) continue;
    diamond((w * k) / 8, -pad / 2);
    diamond((w * k) / 8, h + pad / 2);
  }
  for (let k = 1; k < 4; k++) {
    diamond(-pad / 2, (h * k) / 4);
    diamond(w + pad / 2, (h * k) / 4);
  }

  // pockets: stitched leather liner, then the dark drop
  for (const p of spec.pockets) {
    const [px, py] = p;
    const pr = p[2] ?? pocketR;
    const liner = g.createRadialGradient(px, py, pr * 0.6, px, py, pr + 9 * u);
    liner.addColorStop(0, "#2a1609");
    liner.addColorStop(0.75, "#6b4024");
    liner.addColorStop(1, "#3c220f");
    g.fillStyle = liner;
    g.beginPath();
    g.arc(px, py, pr + 9 * u, 0, Math.PI * 2);
    g.fill();
    g.setLineDash([2.5 * u, 2.5 * u]);
    g.strokeStyle = "rgba(230,200,150,.45)";
    g.lineWidth = 0.9 * u;
    g.beginPath();
    g.arc(px, py, pr + 5.5 * u, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    const hole = g.createRadialGradient(px - pr * 0.25, py - pr * 0.25, pr * 0.1, px, py, pr);
    hole.addColorStop(0, "#000");
    hole.addColorStop(0.8, "#070605");
    hole.addColorStop(1, "#1a120c");
    g.fillStyle = hole;
    g.beginPath();
    g.arc(px, py, pr, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/**
 * The cue, from the tip (at distance `gap` behind the cue ball centre, along `angle`) back `len` units:
 * blue chalked tip, white ferrule, tapered maple shaft, steel joint, ebony forearm, black linen wrap, butt, bumper.
 */
export function drawCue(g: CanvasRenderingContext2D, x: number, y: number, angle: number, gap: number, len = 320, k = 1) {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  g.save();
  g.translate(x - ca * gap, y - sa * gap);
  g.rotate(angle + Math.PI); // +x now runs from the tip towards the butt
  // drop shadow on the cloth
  g.fillStyle = "rgba(0,0,0,.28)";
  g.beginPath();
  g.moveTo(4 * k, 5 * k - 2.2 * k);
  g.lineTo(len + 4 * k, 5 * k - 5 * k);
  g.lineTo(len + 4 * k, 5 * k + 5 * k);
  g.lineTo(4 * k, 5 * k + 2.2 * k);
  g.fill();
  const width = (t: number) => (2.3 + 2.9 * t) * k; // half-width along the cue (0 = tip, 1 = butt)
  const seg = (a: number, b: number, fill: string | CanvasGradient) => {
    const x0 = a * len;
    const x1 = b * len;
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(x0, -width(a));
    g.lineTo(x1, -width(b));
    g.lineTo(x1, width(b));
    g.lineTo(x0, width(a));
    g.closePath();
    g.fill();
  };
  const across = (c0: string, c1: string, c2: string) => {
    const gr = g.createLinearGradient(0, -6 * k, 0, 6 * k);
    gr.addColorStop(0, c0);
    gr.addColorStop(0.45, c1);
    gr.addColorStop(1, c2);
    return gr;
  };
  seg(0, 0.012, across("#2b5fa8", "#4f86d0", "#1e4a86")); // chalked tip
  seg(0.012, 0.04, across("#d9d6cc", "#fbfaf4", "#bdb9ad")); // ferrule
  seg(0.04, 0.52, across("#c99e62", "#f1d7a6", "#b0844b")); // maple shaft
  seg(0.52, 0.535, across("#8d9299", "#eef1f4", "#7a7f86")); // joint collar
  seg(0.535, 0.7, across("#1c1210", "#4a2e22", "#120b09")); // ebony forearm
  // inlay points on the forearm
  g.fillStyle = "#e9dcc0";
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(0.555 * len, 0);
    g.lineTo(0.66 * len, s * width(0.6) * 0.75);
    g.lineTo(0.62 * len, 0);
    g.fill();
  }
  seg(0.7, 0.86, across("#0d0d0f", "#2a2a2e", "#08080a")); // linen wrap
  g.strokeStyle = "rgba(255,255,255,.07)";
  g.lineWidth = 0.8 * k;
  for (let t = 0.705; t < 0.86; t += 0.008) {
    g.beginPath();
    g.moveTo(t * len, -width(t));
    g.lineTo((t + 0.004) * len, width(t));
    g.stroke();
  }
  seg(0.86, 0.985, across("#3b0f12", "#7a2a2a", "#2a090b")); // butt sleeve
  seg(0.985, 1, across("#111", "#2c2c2c", "#050505")); // rubber bumper
  g.restore();
}

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

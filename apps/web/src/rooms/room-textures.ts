import * as THREE from "three";

/** Procedural interior textures — no downloads (DESIGN-SPEC rule). */
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
// deterministic pseudo-noise (cosmetic only)
const n = (i: number) => {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

export function woodPlanks(base: [number, number, number], repeat: [number, number]): THREE.CanvasTexture {
  const { c, g } = canvas(512, 512);
  const rows = 8;
  for (let r = 0; r < rows; r++) {
    const off = n(r) * 512;
    for (let k = -1; k < 3; k++) {
      const shade = 0.82 + n(r * 7 + k) * 0.3;
      g.fillStyle = `rgb(${base[0] * shade},${base[1] * shade},${base[2] * shade})`;
      g.fillRect(off + k * 300, r * 64, 300, 64);
      g.fillStyle = "rgba(0,0,0,.35)";
      g.fillRect(off + k * 300, r * 64, 2, 64);
    }
    for (let l = 0; l < 14; l++) {
      g.strokeStyle = `rgba(0,0,0,${0.05 + n(r * 31 + l) * 0.08})`;
      g.beginPath();
      const y = r * 64 + n(r * 13 + l) * 64;
      g.moveTo(0, y);
      g.bezierCurveTo(170, y + 4, 340, y - 4, 512, y + 2);
      g.stroke();
    }
    g.fillStyle = "rgba(0,0,0,.45)";
    g.fillRect(0, r * 64, 512, 2);
  }
  return tex(c, repeat);
}

export function terrazzo(repeat: [number, number]): THREE.CanvasTexture {
  const { c, g } = canvas(512, 512);
  g.fillStyle = "#e9e3d8";
  g.fillRect(0, 0, 512, 512);
  const cols = ["#b5532a", "#2b2b2b", "#8a94a6", "#d9c27a", "#ffffff"];
  for (let i = 0; i < 900; i++) {
    g.fillStyle = cols[i % cols.length]!;
    g.globalAlpha = 0.55 + n(i) * 0.4;
    g.beginPath();
    g.ellipse(n(i * 3) * 512, n(i * 5) * 512, 1 + n(i * 7) * 4, 1 + n(i * 11) * 3, n(i) * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  return tex(c, repeat);
}

export function imigongo(repeat: [number, number], dark = "#1B1B1B", accent = "#B5532A", light = "#F4EFE6"): THREE.CanvasTexture {
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

export function plaster(color: string, repeat: [number, number]): THREE.CanvasTexture {
  const { c, g } = canvas(256, 256);
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(${n(i) > 0.5 ? "255,255,255" : "0,0,0"},${0.03 + n(i * 3) * 0.04})`;
    g.fillRect(n(i * 7) * 256, n(i * 11) * 256, 2, 2);
  }
  return tex(c, repeat);
}

export function cloth(color: string): THREE.CanvasTexture {
  const { c, g } = canvas(256, 128);
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(0,0,0,${n(i) * 0.06})`;
    g.fillRect(n(i * 3) * 256, n(i * 5) * 128, 1, 1);
  }
  return tex(c);
}

/** Painted window view: Virunga cones over terraced hills under a morning sky. */
export function volcanoView(): THREE.CanvasTexture {
  const { c, g } = canvas(1024, 384);
  const sky = g.createLinearGradient(0, 0, 0, 384);
  sky.addColorStop(0, "#8fc4ef");
  sky.addColorStop(0.55, "#dbeefa");
  sky.addColorStop(1, "#f3efe2");
  g.fillStyle = sky;
  g.fillRect(0, 0, 1024, 384);
  const cone = (cx: number, h: number, w: number, col: string) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(cx - w, 300);
    g.quadraticCurveTo(cx - w * 0.25, 300 - h * 0.6, cx - w * 0.08, 300 - h);
    g.lineTo(cx + w * 0.08, 300 - h);
    g.quadraticCurveTo(cx + w * 0.25, 300 - h * 0.6, cx + w, 300);
    g.fill();
  };
  cone(180, 190, 260, "#5d7488");
  cone(470, 240, 300, "#4e667c");
  cone(760, 170, 240, "#5f7a8c");
  cone(960, 130, 200, "#6c8596");
  g.fillStyle = "rgba(255,255,255,.55)";
  g.fillRect(0, 150, 1024, 22);
  for (let k = 0; k < 6; k++) {
    g.fillStyle = ["#4f8c4d", "#5a9a55", "#477f45", "#62a35b", "#3f7340", "#6aa961"][k]!;
    g.beginPath();
    g.moveTo(0, 384);
    for (let x = 0; x <= 1024; x += 32) g.lineTo(x, 270 + k * 18 + Math.sin(x / 90 + k) * 10);
    g.lineTo(1024, 384);
    g.fill();
  }
  return tex(c);
}

/** Top of a Ludo table (classic cross layout, colour-blind-safe corners). */
export function ludoBoard(): THREE.CanvasTexture {
  const { c, g } = canvas(512, 512);
  const s = 512 / 15;
  const cols = ["#E53935", "#43A047", "#FDD835", "#1E88E5"];
  g.fillStyle = "#f4efe6";
  g.fillRect(0, 0, 512, 512);
  [[0, 0], [0, 9], [9, 9], [9, 0]].forEach(([r, cc], i) => {
    g.fillStyle = cols[i]!;
    g.fillRect(cc! * s, r! * s, 6 * s, 6 * s);
    g.fillStyle = "#fff";
    g.fillRect(cc! * s + s, r! * s + s, 4 * s, 4 * s);
  });
  g.strokeStyle = "rgba(0,0,0,.25)";
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
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

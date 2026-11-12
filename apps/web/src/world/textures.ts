import * as THREE from "three";

/** Procedural textures (no downloads). Imigongo-inspired geometry: zig-zags and diamonds in black, white, ochre. */
function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d")! };
}

export function imigongoTexture(repeat = 8): THREE.CanvasTexture {
  const { c, g } = canvas(256, 64);
  g.fillStyle = "#F4EFE6";
  g.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 8; i++) {
    const x = i * 32;
    g.fillStyle = i % 2 ? "#B5532A" : "#1B1B1B";
    g.beginPath();
    g.moveTo(x, 64);
    g.lineTo(x + 16, 8);
    g.lineTo(x + 32, 64);
    g.fill();
    g.fillStyle = "#F4EFE6";
    g.beginPath();
    g.moveTo(x + 8, 64);
    g.lineTo(x + 16, 36);
    g.lineTo(x + 24, 64);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function plazaFloorTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(512, 512);
  g.fillStyle = "#d9d3e6";
  g.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const shade = 210 + ((x * 7 + y * 13) % 5) * 6;
      g.fillStyle = `rgb(${shade - 6},${shade - 10},${shade + 6})`;
      g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
    }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 10);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function portalPreviewTexture(emoji: string, color: string, label: string): THREE.CanvasTexture {
  const { c, g } = canvas(256, 384);
  const grad = g.createLinearGradient(0, 0, 0, 384);
  grad.addColorStop(0, color);
  grad.addColorStop(1, "#0b0d1a");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 384);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(255,255,255,${0.04 + ((i * 37) % 10) / 120})`;
    g.beginPath();
    g.arc((i * 53) % 256, (i * 97) % 384, 2 + (i % 4), 0, Math.PI * 2);
    g.fill();
  }
  g.font = "120px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji'";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(emoji, 128, 170);
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.font = "bold 28px system-ui";
  g.fillText(label.toUpperCase(), 128, 300);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

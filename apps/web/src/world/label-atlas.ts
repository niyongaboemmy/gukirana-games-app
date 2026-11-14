import * as THREE from "three";

/**
 * Static sign lettering baked into ONE canvas texture (GAP-008): every sign that uses the atlas shares one material,
 * so the static batch (world/static-merge) draws all of them in one call instead of one troika Text mesh per sign.
 * Cells are laid out in a grid; `uv(i, widthFraction)` gives the UV rectangle of cell i (optionally its central part,
 * for narrower panels). Lettering is drawn with the world font (Baloo 2) once it has loaded.
 */
export interface LabelAtlas {
  texture: THREE.CanvasTexture;
  /** [u0, v0, u1, v1] of cell i, horizontally cropped to `wf` (0–1) of the cell around its centre */
  uv: (i: number, wf?: number) => [number, number, number, number];
}

const FONT_URL = "/fonts/Baloo2.ttf";
let fontReady: Promise<string> | null = null;
function worldFont(): Promise<string> {
  fontReady ??= (async () => {
    try {
      const f = new FontFace("GkBaloo2", `url(${FONT_URL})`);
      await f.load();
      document.fonts.add(f);
      return "GkBaloo2";
    } catch {
      return "sans-serif";
    }
  })();
  return fontReady;
}

export function labelAtlas(
  labels: { text: string; px: number }[],
  { cols = 6, cellW = 256, cellH = 160, ink = "#2a2430", paper = "#ffffff", letterSpacing = 0 }: { cols?: number; cellW?: number; cellH?: number; ink?: string; paper?: string; letterSpacing?: number } = {},
): LabelAtlas {
  const rows = Math.max(1, Math.ceil(labels.length / cols));
  const c = document.createElement("canvas");
  c.width = cols * cellW;
  c.height = rows * cellH;
  const g = c.getContext("2d")!;
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const draw = (family: string) => {
    g.fillStyle = paper;
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = ink;
    g.textAlign = "center";
    g.textBaseline = "middle";
    labels.forEach((l, i) => {
      g.font = `600 ${l.px}px ${family}`;
      if ("letterSpacing" in g) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${letterSpacing * l.px}px`;
      // Baloo's metrics sit a little high in the em box: nudge down so the letters look centred on the panel
      g.fillText(l.text, (i % cols) * cellW + cellW / 2, Math.floor(i / cols) * cellH + cellH / 2 + l.px * 0.08);
    });
    texture.needsUpdate = true;
  };
  draw("sans-serif");
  void worldFont().then(draw);
  const uv = (i: number, wf = 1): [number, number, number, number] => {
    const cx = i % cols;
    const cy = Math.floor(i / cols);
    const m = (1 - wf) / 2;
    return [(cx + m) / cols, 1 - (cy + 1) / rows, (cx + 1 - m) / cols, 1 - cy / rows];
  };
  return { texture, uv };
}

/** A plane (w × h) whose UVs map onto one atlas cell rectangle. */
export function atlasPlane(w: number, h: number, [u0, v0, u1, v1]: [number, number, number, number]): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
  return g;
}

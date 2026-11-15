/**
 * Rwanda's national flag (P2-WLD-17), as pure data: the arena and Administrative Block flags are painted from this, and
 * the unit test checks it against the official design. Proportion 2:3; a sky-blue band over the top half, then a
 * yellow and a green band of a quarter each; in the upper fly corner a golden sun of 24 straight rays around a golden
 * disc ringed in blue. Construction in flag units of a 1080 × 720 flag (the reference construction sheet):
 * sun centre (900, 171), rays from radius 36 to 116.1 (each ray's base spans 15°, so the bases meet), the disc
 * radius 34.3 with a 3.4-wide blue ring.
 */
export const RWANDA = {
  blue: "#00A1DE",
  yellow: "#FAD201",
  green: "#20603D",
  sun: "#E5BE01",
} as const;

export interface FlagSpec {
  w: number;
  h: number;
  /** horizontal bands, top to bottom: [y0, y1, colour] */
  bands: [number, number, string][];
  sun: { x: number; y: number; rayIn: number; rayOut: number; disc: number; ring: number; rays: [number, number][][] };
}

/** The flag at width `w` (height = 2/3 w), y measured down from the top edge (canvas convention). */
export function rwandaFlagSpec(w = 1080): FlagSpec {
  const k = w / 1080;
  const h = (w * 2) / 3;
  const cx = 900 * k;
  const cy = 171 * k;
  const rayIn = 36 * k;
  const rayOut = 116.1 * k;
  const rays: [number, number][][] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const half = Math.PI / 24; // 7.5°: neighbouring bases meet
    rays.push([
      [cx + Math.cos(a - half) * rayIn, cy + Math.sin(a - half) * rayIn],
      [cx + Math.cos(a) * rayOut, cy + Math.sin(a) * rayOut],
      [cx + Math.cos(a + half) * rayIn, cy + Math.sin(a + half) * rayIn],
    ]);
  }
  return {
    w,
    h,
    bands: [
      [0, h / 2, RWANDA.blue],
      [h / 2, (h * 3) / 4, RWANDA.yellow],
      [(h * 3) / 4, h, RWANDA.green],
    ],
    sun: { x: cx, y: cy, rayIn, rayOut, disc: 34.3 * k, ring: 3.4 * k, rays },
  };
}

/** Paint the flag into a 2D context of the spec's size (bands, rays, the blue ring, the golden disc). */
export function paintRwandaFlag(g: CanvasRenderingContext2D, s: FlagSpec = rwandaFlagSpec()) {
  for (const [y0, y1, c] of s.bands) {
    g.fillStyle = c;
    g.fillRect(0, y0, s.w, y1 - y0);
  }
  g.fillStyle = RWANDA.sun;
  for (const r of s.sun.rays) {
    g.beginPath();
    g.moveTo(r[0]![0], r[0]![1]);
    g.lineTo(r[1]![0], r[1]![1]);
    g.lineTo(r[2]![0], r[2]![1]);
    g.closePath();
    g.fill();
  }
  // the ray bases leave tiny notches at the rim: a golden backing disc under the ring closes them
  g.beginPath();
  g.arc(s.sun.x, s.sun.y, s.sun.rayIn + 0.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = RWANDA.blue;
  g.beginPath();
  g.arc(s.sun.x, s.sun.y, s.sun.disc + s.sun.ring / 2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = RWANDA.sun;
  g.beginPath();
  g.arc(s.sun.x, s.sun.y, s.sun.disc - s.sun.ring / 2, 0, Math.PI * 2);
  g.fill();
}

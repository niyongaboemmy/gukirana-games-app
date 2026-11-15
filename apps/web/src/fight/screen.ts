import { CORNER_COLORS, FEATURE_RINGS, TICK_HZ, type BoxingSnapshot, type RingState } from "@gukirana/contracts";
import { useFightBridge } from "./bridge";
import { ringCounts, ringState } from "./rings";
import { F } from "./strings";

/** which fight the big screen shows: mine, the watched ring, a live feature fight, any live fight; else the hall summary */
export function screenFight(): { ring: RingState; snap: BoxingSnapshot | null } | null {
  const b = useFightBridge.getState();
  if (b.mine) return { ring: ringState(b.mine.ring), snap: b.mine.snap };
  if (b.watched) return { ring: ringState(b.watched.ring), snap: b.watched.snap };
  for (const id of FEATURE_RINGS) {
    const r = ringState(id);
    if (r.status === "fighting" || r.status === "result") return { ring: r, snap: null };
  }
  const live = Object.values(b.rings).find((r) => r?.status === "fighting");
  return live ? { ring: live, snap: null } : null;
}

const clock = (ticks: number) => {
  const s = Math.max(0, Math.ceil(ticks / TICK_HZ));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** everything the screen face shows, as a string: the face is redrawn only when it changes (P3-FGT-04) */
export function bigScreenKey(): string {
  const f = screenFight();
  if (!f) {
    const n = ringCounts();
    return `hall:${n.fights}:${n.free}`;
  }
  const { ring, snap } = f;
  const pts = snap ? `${snap.fighters[0].points}:${snap.fighters[1].points}` : `${ring.score?.red ?? 0}:${ring.score?.blue ?? 0}`;
  return [ring.id, ring.red?.name, ring.blue?.name, pts, snap?.round ?? ring.round, snap?.rounds ?? ring.rounds, snap ? clock(snap.left) : ""].join("|");
}

/** draw the screen face (512 × 288 canvas) */
export function drawBigScreen(c: HTMLCanvasElement) {
  const g = c.getContext("2d")!;
  const W = c.width;
  const H = c.height;
  g.fillStyle = "#0b0b0d";
  g.fillRect(0, 0, W, H);
  g.textAlign = "center";
  g.textBaseline = "middle";
  const f = screenFight();
  if (!f) {
    const n = ringCounts();
    g.fillStyle = "#ffffff";
    g.font = "700 44px sans-serif";
    g.fillText(F.boxingHall.toUpperCase(), W / 2, H * 0.36);
    g.font = "500 28px sans-serif";
    g.fillStyle = "#cfcfcf";
    g.fillText(`${F.fightsOn(n.fights)} · ${F.ringsFree(n.free)}`, W / 2, H * 0.62);
    return;
  }
  const { ring, snap } = f;
  const red = ring.red?.name ?? "—";
  const blue = ring.blue?.name ?? "—";
  const pts: [number, number] = snap ? [snap.fighters[0].points, snap.fighters[1].points] : [ring.score?.red ?? 0, ring.score?.blue ?? 0];
  // corner bars (3D-screen colours only)
  g.fillStyle = CORNER_COLORS.red;
  g.fillRect(0, 0, W / 2 - 2, 64);
  g.fillStyle = CORNER_COLORS.blue;
  g.fillRect(W / 2 + 2, 0, W / 2 - 2, 64);
  g.fillStyle = "#ffffff";
  g.font = "700 30px sans-serif";
  g.fillText(red.slice(0, 16), W / 4, 33);
  g.fillText(blue.slice(0, 16), (W * 3) / 4, 33);
  g.font = "800 96px sans-serif";
  g.fillText(String(pts[0]), W / 4, H * 0.52);
  g.fillText(String(pts[1]), (W * 3) / 4, H * 0.52);
  g.font = "600 26px sans-serif";
  g.fillStyle = "#d8d8d8";
  const round = snap?.round ?? ring.round ?? 1;
  const rounds = snap?.rounds ?? ring.rounds ?? 3;
  g.fillText(`${F.ring(ring.id)} · ${F.round(round, rounds)}`, W / 2, H * 0.84);
  if (snap) {
    g.font = "700 40px sans-serif";
    g.fillStyle = "#ffffff";
    g.fillText(clock(snap.left), W / 2, H * 0.52);
  }
}

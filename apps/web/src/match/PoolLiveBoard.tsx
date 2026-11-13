"use client";
import { useEffect, useRef, useState } from "react";
import { POCKETS, R, TABLE_H, TABLE_W, U, type PoolState } from "@gukirana/pool";
import { COLORS } from "@/games/pool-physics";
import { drawCue, paintTable } from "@/games/pool-art";

const PAD = 600; // rail width in 0.1 mm units for drawing
const WU = TABLE_W / U; // table size in 0.1 mm units
const HU = TABLE_H / U;
const BR = R / U;
const isStripe = (n: number) => n >= 9;

/**
 * Live Pool table: renders the server state, replays the server's recorded shot frames exactly
 * (no client physics → no desync), and lets the shooter aim + set power. Sends integer intents only.
 */
export function PoolLiveBoard({ state, myTurn, onShoot }: { state: PoolState; myTurn: boolean; onShoot: (i: { dx: number; dy: number; power: number; spin: number }) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tableArt = useRef<HTMLCanvasElement | null>(null);
  const aim = useRef(0);
  const [power, setPower] = useState(0);
  const [spin, setSpin] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const shown = useRef<{ n: number; x: number; y: number }[]>(state.balls.filter((b) => !b.in).map((b) => ({ n: b.n, x: b.x / U, y: b.y / U })));
  const lastShots = useRef(state.shots);
  const bar = useRef<HTMLDivElement>(null);

  // replay new shots from the server frames at real speed (frames recorded at 40 fps)
  useEffect(() => {
    const final = state.balls.filter((b) => !b.in).map((b) => ({ n: b.n, x: b.x / U, y: b.y / U }));
    const frames = state.lastShot?.frames ?? [];
    if (state.shots === lastShots.current || frames.length < 2) {
      shown.current = final;
      lastShots.current = state.shots;
      return;
    }
    lastShots.current = state.shots;
    setReplaying(true);
    const start = performance.now();
    const totalTicks = frames[frames.length - 1]![0]!;
    let raf = 0;
    const step = () => {
      const tick = ((performance.now() - start) / 1000) * 240;
      let i = 0;
      while (i < frames.length - 1 && frames[i + 1]![0]! <= tick) i++;
      const f = frames[i]!;
      const balls: { n: number; x: number; y: number }[] = [];
      for (let k = 1; k + 2 < f.length; k += 3) balls.push({ n: f[k]!, x: f[k + 1]!, y: f[k + 2]! });
      shown.current = balls;
      if (tick < totalTicks) raf = requestAnimationFrame(step);
      else {
        shown.current = final;
        setReplaying(false);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [state.shots, state.balls, state.lastShot]);

  // draw loop
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = canvas.current;
      if (c) {
        const g = c.getContext("2d")!;
        const scale = c.width / (WU + PAD * 2);
        g.setTransform(scale, 0, 0, scale, PAD * scale, PAD * scale);
        g.clearRect(-PAD, -PAD, WU + PAD * 2, HU + PAD * 2);
        // table art painted once (same look as practice: cloth, walnut rails, diamonds, leather pockets)
        tableArt.current ??= paintTable({ w: WU, h: HU, pad: PAD, pockets: POCKETS.map(([px, py, pr]) => [px / U, py / U, (pr / U) * 0.75] as const), pocketR: 0, scale });
        g.drawImage(tableArt.current, -PAD, -PAD, WU + PAD * 2, HU + PAD * 2);
        const balls = shown.current;
        const cue = balls.find((b) => b.n === 0);
        if (myTurn && !replaying && cue) {
          const a = aim.current;
          g.setLineDash([180, 180]);
          g.strokeStyle = "rgba(255,255,255,.75)";
          g.lineWidth = 40;
          g.beginPath();
          g.moveTo(cue.x, cue.y);
          g.lineTo(cue.x + Math.cos(a) * 9000, cue.y + Math.sin(a) * 9000);
          g.stroke();
          g.setLineDash([]);
          const back = 700 + power * 2400;
          drawCue(g, cue.x, cue.y, a, BR + back, 8000, 25);
        }
        for (const b of balls) {
          g.fillStyle = "rgba(0,0,0,.35)";
          g.beginPath();
          g.arc(b.x + 70, b.y + 90, BR, 0, Math.PI * 2);
          g.fill();
          g.save();
          g.beginPath();
          g.arc(b.x, b.y, BR, 0, Math.PI * 2);
          g.clip();
          g.fillStyle = isStripe(b.n) ? "#fdfdfd" : (COLORS[b.n] ?? "#fff");
          g.fillRect(b.x - BR, b.y - BR, BR * 2, BR * 2);
          if (isStripe(b.n)) {
            g.fillStyle = COLORS[b.n]!;
            g.fillRect(b.x - BR, b.y - BR * 0.55, BR * 2, BR * 1.1);
          }
          const sh = g.createRadialGradient(b.x - 90, b.y - 90, 10, b.x, b.y, BR);
          sh.addColorStop(0, "rgba(255,255,255,.7)");
          sh.addColorStop(0.4, "rgba(255,255,255,0)");
          sh.addColorStop(1, "rgba(0,0,0,.25)");
          g.fillStyle = sh;
          g.fillRect(b.x - BR, b.y - BR, BR * 2, BR * 2);
          g.restore();
          if (b.n > 0) {
            g.fillStyle = "#fff";
            g.beginPath();
            g.arc(b.x, b.y, BR * 0.42, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = "#111";
            g.font = `bold ${BR * 0.55}px system-ui`;
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.fillText(String(b.n), b.x, b.y + 10);
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [myTurn, replaying, power]);

  const aimFrom = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!myTurn || replaying) return;
    const rect = canvas.current!.getBoundingClientRect();
    const scale = rect.width / (WU + PAD * 2);
    const x = (e.clientX - rect.left) / scale - PAD;
    const y = (e.clientY - rect.top) / scale - PAD;
    const cue = shown.current.find((b) => b.n === 0);
    if (cue) aim.current = Math.atan2(y - cue.y, x - cue.x);
  };
  const setPowerFrom = (clientY: number) => {
    const r = bar.current!.getBoundingClientRect();
    setPower(Math.max(0, Math.min(1, (clientY - r.top) / r.height)));
  };

  return (
    <div className="flex h-full w-full min-w-0 items-center justify-center gap-2">
      <canvas
        ref={canvas}
        width={2160}
        height={1180}
        className="aspect-[2160/1180] max-h-full min-w-0 max-w-[calc((100dvh-150px)*1.83)] flex-1 touch-none rounded-3xl shadow-2xl"
        onPointerDown={aimFrom}
        onPointerMove={(e) => (e.buttons || e.pointerType === "mouse") && aimFrom(e)}
      />
      <div className="flex h-[80%] w-14 shrink-0 flex-col items-center gap-2">
        <span className="text-[10px] font-bold uppercase text-white/60">Power</span>
        <div
          ref={bar}
          className={`relative w-10 flex-1 touch-none rounded-full border-2 border-white/30 bg-white/10 ${!myTurn || replaying ? "opacity-40" : ""}`}
          onPointerDown={(e) => {
            if (!myTurn || replaying) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            setPowerFrom(e.clientY);
          }}
          onPointerMove={(e) => e.buttons && myTurn && !replaying && setPowerFrom(e.clientY)}
          onPointerUp={() => {
            if (power > 0.04 && myTurn && !replaying) {
              onShoot({ dx: Math.round(Math.cos(aim.current) * 100000), dy: Math.round(Math.sin(aim.current) * 100000), power: Math.max(1, Math.round(power * 1000)), spin });
            }
            setPower(0);
          }}
        >
          <div className="absolute inset-x-0 top-0 rounded-full bg-gradient-to-b from-success via-warning to-danger" style={{ height: `${power * 100}%` }} />
        </div>
        <span className="text-xs font-bold tabular-nums">{Math.round(power * 100)}%</span>
        <div className="flex flex-col items-center gap-1 text-[10px] font-bold uppercase text-white/60">
          Spin
          {[60, 0, -60].map((s) => (
            <button key={s} type="button" onClick={() => setSpin(s)} className={`w-12 rounded-md px-1 py-0.5 text-[10px] ${spin === s ? "bg-white/25 text-white" : "bg-white/10"}`}>
              {s > 0 ? "Follow" : s < 0 ? "Draw" : "Centre"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

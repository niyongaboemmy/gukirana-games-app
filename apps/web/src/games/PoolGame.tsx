"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameShell, ResultModal } from "./GameShell";
import { PoolBallIcon } from "@/ui/game-icons";
import { settlePractice } from "./practice";
import { COLORS, H, moving, POCKETS, POCKET_R, R, rack, rayHit, segDist, step, W, type Ball, type StepEvents } from "./pool-physics";
import { levelForXp, useProfile } from "@/lib/profile-store";

type Group = "solids" | "stripes" | null;
const isSolid = (n: number) => n >= 1 && n <= 7;
const isStripe = (n: number) => n >= 9;
const inGroup = (n: number, g: Group) => (g === "solids" ? isSolid(n) : g === "stripes" ? isStripe(n) : n !== 8 && n !== 0);
const MAX_SPEED = 1700;

export default function PoolGame() {
  const { name, color, xp } = useProfile();
  const canvas = useRef<HTMLCanvasElement>(null);
  const balls = useRef<Ball[]>(rack());
  const ev = useRef<StepEvents>({ firstHit: null, pocketed: [] });
  const aim = useRef(0);
  const [turn, setTurn] = useState<0 | 1>(0);
  const [groups, setGroups] = useState<[Group, Group]>([null, null]);
  const [power, setPower] = useState(0);
  const [rolling, setRolling] = useState(false);
  const [message, setMessage] = useState("Your break! Drag on the table to aim, pull the power bar down, release to shoot.");
  const [result, setResult] = useState<{ won: boolean; starsDelta: number; xp: number } | null>(null);
  const shots = useRef(0);
  const state = useRef({ turn: 0 as 0 | 1, groups: [null, null] as [Group, Group], over: false });

  const remaining = (g: Group) => balls.current.filter((b) => !b.in && inGroup(b.n, g) && g !== null).length;

  const end = useCallback((won: boolean, why: string) => {
    state.current.over = true;
    setMessage(why);
    setResult({ won, starsDelta: 0, xp: 0 });
    void settlePractice("pool", won).then((r) => setResult({ won, ...r }));
  }, []);

  /** Applies 8-ball rules once all balls stop. */
  const resolve = useCallback(() => {
    const s = state.current;
    const shooter = s.turn;
    const { firstHit, pocketed } = ev.current;
    let g = [...s.groups] as [Group, Group];
    const myGroup = g[shooter];
    const scratch = pocketed.includes(0);
    const potted = pocketed.filter((n) => n !== 0);
    let foul = scratch || firstHit === null;
    if (!foul && myGroup && firstHit !== null && !inGroup(firstHit, myGroup) && !(firstHit === 8 && remaining(myGroup) === 0)) foul = true;

    if (potted.includes(8)) {
      const cleared = myGroup !== null && remaining(myGroup) === 0;
      const winner = cleared && !scratch ? shooter : ((1 - shooter) as 0 | 1);
      end(winner === 0, winner === 0 ? "8-ball sunk. Clean finish!" : shooter === 0 ? "The 8-ball went down too early." : "The AI sank the 8-ball.");
      return;
    }
    if (!myGroup) {
      const first = potted.find((n) => n !== 8);
      if (first !== undefined && !foul) {
        const mine: Group = isSolid(first) ? "solids" : "stripes";
        g = shooter === 0 ? [mine, mine === "solids" ? "stripes" : "solids"] : [mine === "solids" ? "stripes" : "solids", mine];
        s.groups = g;
        setGroups(g);
      }
    }
    if (scratch) {
      const cue = balls.current[0]!;
      cue.in = false;
      cue.x = 250;
      cue.y = H / 2;
      while (balls.current.some((b) => b.n !== 0 && !b.in && Math.hypot(b.x - cue.x, b.y - cue.y) < 2 * R + 1)) cue.x -= 2 * R;
    }
    const keep = !foul && potted.some((n) => inGroup(n, g[shooter] ?? null) || g[shooter] === null);
    const next = keep ? shooter : ((1 - shooter) as 0 | 1);
    s.turn = next;
    setTurn(next);
    setMessage(
      foul
        ? `Foul${scratch ? ": scratch" : firstHit === null ? ": no ball hit" : ": wrong ball first"} · ${next === 0 ? "your turn" : "AI's turn"}`
        : keep
          ? next === 0 ? "Nice pot. Shoot again!" : "The AI potted. It shoots again."
          : next === 0 ? "Your turn." : "AI's turn.",
    );
  }, [end]);

  const shoot = useCallback((angle: number, pw: number) => {
    const cue = balls.current[0]!;
    cue.vx = Math.cos(angle) * pw * MAX_SPEED;
    cue.vy = Math.sin(angle) * pw * MAX_SPEED;
    ev.current = { firstHit: null, pocketed: [] };
    shots.current += 1;
    setRolling(true);
  }, []);

  // simulation + render loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const wasMoving = moving(balls.current);
      for (let i = 0; i < 8; i++) step(balls.current, dt / 8, ev.current);
      if (wasMoving && !moving(balls.current)) {
        setRolling(false);
        if (!state.current.over) resolve();
      }
      draw();
      raf = requestAnimationFrame(loop);
    };
    const draw = () => {
      const c = canvas.current;
      if (!c) return;
      const g = c.getContext("2d")!;
      const pad = 40;
      const scale = c.width / (W + pad * 2);
      g.setTransform(scale, 0, 0, scale, pad * scale, pad * scale);
      g.clearRect(-pad, -pad, W + pad * 2, H + pad * 2);
      // rails
      g.fillStyle = "#5a3418";
      g.beginPath();
      g.roundRect(-pad, -pad, W + pad * 2, H + pad * 2, 28);
      g.fill();
      // cloth
      const cloth = g.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, W * 0.7);
      cloth.addColorStop(0, "#2a8a92");
      cloth.addColorStop(1, "#1F6F78");
      g.fillStyle = cloth;
      g.fillRect(0, 0, W, H);
      g.strokeStyle = "rgba(255,255,255,.12)";
      g.beginPath();
      g.moveTo(250, 0);
      g.lineTo(250, H);
      g.stroke();
      for (const [px, py] of POCKETS) {
        g.fillStyle = "#0a0a0a";
        g.beginPath();
        g.arc(px, py, POCKET_R, 0, Math.PI * 2);
        g.fill();
      }
      // guide line (your turn)
      const cue = balls.current[0]!;
      if (!moving(balls.current) && state.current.turn === 0 && !state.current.over && !cue.in) {
        const a = aim.current;
        const hit = rayHit(balls.current, a);
        const len = hit ? hit.t : 400;
        g.setLineDash([8, 8]);
        g.strokeStyle = "rgba(255,255,255,.75)";
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(cue.x, cue.y);
        g.lineTo(cue.x + Math.cos(a) * len, cue.y + Math.sin(a) * len);
        g.stroke();
        g.setLineDash([]);
        if (hit) {
          const gx = cue.x + Math.cos(a) * hit.t;
          const gy = cue.y + Math.sin(a) * hit.t;
          g.strokeStyle = "rgba(255,255,255,.8)";
          g.beginPath();
          g.arc(gx, gy, R, 0, Math.PI * 2);
          g.stroke();
          const ox = hit.ball.x - gx;
          const oy = hit.ball.y - gy;
          const ol = Math.hypot(ox, oy) || 1;
          g.strokeStyle = "rgba(255,200,61,.9)";
          g.beginPath();
          g.moveTo(hit.ball.x, hit.ball.y);
          g.lineTo(hit.ball.x + (ox / ol) * 90, hit.ball.y + (oy / ol) * 90);
          g.stroke();
        }
        // cue stick
        const back = 30 + power * 90;
        g.strokeStyle = "#e9c58b";
        g.lineWidth = 7;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(cue.x - Math.cos(a) * (R + back), cue.y - Math.sin(a) * (R + back));
        g.lineTo(cue.x - Math.cos(a) * (R + back + 320), cue.y - Math.sin(a) * (R + back + 320));
        g.stroke();
      }
      // balls
      for (const b of balls.current) {
        if (b.in) continue;
        g.fillStyle = "rgba(0,0,0,.35)";
        g.beginPath();
        g.arc(b.x + 3, b.y + 4, R, 0, Math.PI * 2);
        g.fill();
        g.save();
        g.beginPath();
        g.arc(b.x, b.y, R, 0, Math.PI * 2);
        g.clip();
        g.fillStyle = isStripe(b.n) ? "#fdfdfd" : COLORS[b.n]!;
        g.fillRect(b.x - R, b.y - R, R * 2, R * 2);
        if (isStripe(b.n)) {
          g.fillStyle = COLORS[b.n]!;
          g.fillRect(b.x - R, b.y - R * 0.55, R * 2, R * 1.1);
        }
        const shine = g.createRadialGradient(b.x - 4, b.y - 4, 1, b.x, b.y, R);
        shine.addColorStop(0, "rgba(255,255,255,.7)");
        shine.addColorStop(0.4, "rgba(255,255,255,0)");
        shine.addColorStop(1, "rgba(0,0,0,.25)");
        g.fillStyle = shine;
        g.fillRect(b.x - R, b.y - R, R * 2, R * 2);
        g.restore();
        if (b.n > 0) {
          g.fillStyle = "#fff";
          g.beginPath();
          g.arc(b.x, b.y, 5, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = "#111";
          g.font = "bold 7px system-ui";
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(String(b.n), b.x, b.y + 0.5);
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [power, resolve]);

  // AI shot (practice only): ghost-ball aiming with a small deterministic error
  useEffect(() => {
    if (turn !== 1 || rolling || result) return;
    const t = setTimeout(() => {
      const bs = balls.current;
      const cue = bs[0]!;
      const g = state.current.groups[1];
      const targets = bs.filter((b) => !b.in && b.n !== 0 && (g ? (remaining(g) === 0 ? b.n === 8 : inGroup(b.n, g)) : b.n !== 8));
      let best: { angle: number; score: number; dist: number } | null = null;
      for (const b of targets)
        for (const [px, py] of POCKETS) {
          const dx = px - b.x;
          const dy = py - b.y;
          const dl = Math.hypot(dx, dy);
          const gx = b.x - (dx / dl) * 2 * R;
          const gy = b.y - (dy / dl) * 2 * R;
          const blocked = bs.some((o) => !o.in && o !== b && o.n !== 0 && (segDist(o.x, o.y, cue.x, cue.y, gx, gy) < 2 * R || segDist(o.x, o.y, b.x, b.y, px, py) < 2 * R));
          if (blocked) continue;
          const a1 = Math.atan2(gy - cue.y, gx - cue.x);
          const cut = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - a1), Math.cos(Math.atan2(dy, dx) - a1)));
          if (cut > 1.25) continue;
          const dist = Math.hypot(gx - cue.x, gy - cue.y) + dl;
          const score = -dist - cut * 400;
          if (!best || score > best.score) best = { angle: a1, score, dist };
        }
      const err = (((shots.current * 7919) % 100) / 100 - 0.5) * 0.03; // deterministic, small
      if (best) shoot(best.angle + err, Math.min(0.95, 0.3 + best.dist / 1800));
      else {
        const near = targets.sort((a, b) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y))[0];
        shoot(near ? Math.atan2(near.y - cue.y, near.x - cue.x) : 0, 0.55);
      }
    }, 1100);
    return () => clearTimeout(t);
  }, [rolling, result, shoot, turn]);

  // aiming by pointer on the table
  const setAimFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (turn !== 0 || rolling || result) return;
    const c = canvas.current!;
    const rect = c.getBoundingClientRect();
    const pad = 40;
    const scale = rect.width / (W + pad * 2);
    const x = (e.clientX - rect.left) / scale - pad;
    const y = (e.clientY - rect.top) / scale - pad;
    const cue = balls.current[0]!;
    aim.current = Math.atan2(y - cue.y, x - cue.x);
  };

  // power bar (right edge): pull down, release to shoot
  const bar = useRef<HTMLDivElement>(null);
  const setPowerFrom = (clientY: number) => {
    const r = bar.current!.getBoundingClientRect();
    setPower(Math.max(0, Math.min(1, (clientY - r.top) / r.height)));
  };

  const restart = () => {
    balls.current = rack();
    state.current = { turn: 0, groups: [null, null], over: false };
    setTurn(0);
    setGroups([null, null]);
    setResult(null);
    setMessage("Your break!");
  };

  const groupLabel = (gr: Group) => (gr ? `${gr} · ${remaining(gr)} left` : "Open table");

  return (
    <GameShell
      title="8-Ball Pool"
      icon={PoolBallIcon}
      color="#2F80ED"
      pot={0}
      you={{ name: name || "You", color, level: levelForXp(xp), active: turn === 0 && !result, detail: <p className="text-xs font-semibold capitalize">{groupLabel(groups[0])}</p> }}
      opponents={[{ name: "Cue AI", color: "#2F80ED", level: 10, isBot: true, active: turn === 1 && !result, detail: <p className="text-xs font-semibold capitalize">{groupLabel(groups[1])}</p> }]}
      footer={<p className="text-center text-xs text-white/75 sm:text-sm">{message}</p>}
    >
      <div className="flex h-full w-full min-w-0 items-center justify-center gap-2">
        <canvas
          ref={canvas}
          width={1080 * 2}
          height={580 * 2}
          className="aspect-[1080/580] max-h-full min-w-0 flex-1 max-w-[calc((100dvh-140px)*1.86)] touch-none rounded-3xl shadow-2xl"
          onPointerDown={setAimFromEvent}
          onPointerMove={(e) => (e.buttons || e.pointerType === "mouse") && setAimFromEvent(e)}
        />
        <div className="flex h-[80%] w-12 shrink-0 flex-col items-center gap-2">
          <span className="text-[10px] font-bold uppercase text-white/60">Power</span>
          <div
            ref={bar}
            className={`relative w-10 flex-1 touch-none rounded-full border-2 border-white/30 bg-white/10 ${turn !== 0 || rolling ? "opacity-40" : ""}`}
            onPointerDown={(e) => {
              if (turn !== 0 || rolling || result) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setPowerFrom(e.clientY);
            }}
            onPointerMove={(e) => e.buttons && turn === 0 && !rolling && setPowerFrom(e.clientY)}
            onPointerUp={() => {
              if (power > 0.04 && turn === 0 && !rolling) shoot(aim.current, power);
              setPower(0);
            }}
          >
            <div className="absolute inset-x-0 top-0 rounded-full bg-gradient-to-b from-[#22C55E] via-[#F59E0B] to-[#EF4444]" style={{ height: `${power * 100}%` }} />
            <div className="absolute inset-x-1 rounded-full bg-white shadow" style={{ top: `calc(${power * 100}% - 6px)`, height: 12 }} />
          </div>
          <span className="text-xs font-bold tabular-nums">{Math.round(power * 100)}%</span>
        </div>
      </div>
      {result && <ResultModal {...result} summary={message} onRematch={restart} />}
    </GameShell>
  );
}

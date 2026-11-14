"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Hand, RotateCcw, Target } from "lucide-react";
import { canPlaceCue, legalTargets, onTheEight, POCKETS, R, TABLE_H, TABLE_W, U, type PoolIntent, type PoolState } from "@gukirana/pool";
import { BALL_COLORS, drawCue, drawCueHands, paintTable } from "./pool-art";
import { pad, padOptions, shouldAutoFocus } from "./input";
import { animScale, haptic, sfx, useGamePrefs, type AimGuide } from "./feedback";
import { TurnBanner } from "./GameShell";
import { t, type GameKey } from "./i18n";

/** Table geometry in units (0.1 mm) — the engine works in milli-units (U per unit). */
const WU = TABLE_W / U;
const HU = TABLE_H / U;
const BR = R / U;
const PAD = 600;
const PK = POCKETS.map(([x, y, r]) => [x / U, y / U, r / U] as const);
const isStripe = (n: number) => n >= 9;
const MAX_PULL = 4200; // units of pull-back for full power
const DEG = Math.PI / 180;

type Pt = { n: number; x: number; y: number };
type Banner = { id: number; text: string; tone: "info" | "good" | "bad" };

/** Screen ↔ table mapping. Landscape: x right, y down. Portrait: the table stands up, the head string at the bottom. */
interface View {
  portrait: boolean;
  s: number; // css px per unit
}
const toTable = (v: View, sx: number, sy: number) => (v.portrait ? { x: WU + PAD - sy / v.s, y: sx / v.s - PAD } : { x: sx / v.s - PAD, y: sy / v.s - PAD });
function applyView(g: CanvasRenderingContext2D, v: View, dpr: number) {
  const s = v.s * dpr;
  if (v.portrait) g.setTransform(0, -s, s, 0, PAD * s, (PAD + WU) * s);
  else g.setTransform(s, 0, 0, s, PAD * s, PAD * s);
}

/** First ball hit along a ray from the cue ball (display only, floats). */
function rayHit(balls: Pt[], cx: number, cy: number, a: number): { ball: Pt; t: number } | null {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  let best: { ball: Pt; t: number } | null = null;
  for (const b of balls) {
    if (b.n === 0) continue;
    const fx = cx - b.x;
    const fy = cy - b.y;
    const bq = fx * dx + fy * dy;
    const c = fx * fx + fy * fy - 4 * BR * BR;
    const disc = bq * bq - c;
    if (disc < 0) continue;
    const tt = -bq - Math.sqrt(disc);
    if (tt > 0 && (!best || tt < best.t)) best = { ball: b, t: tt };
  }
  return best;
}
/** Distance along a ray to the cushion line (ball centre limits). */
function rayWall(cx: number, cy: number, a: number) {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  let tt = Infinity;
  if (dx > 1e-9) tt = Math.min(tt, (WU - BR - cx) / dx);
  if (dx < -1e-9) tt = Math.min(tt, (BR - cx) / dx);
  if (dy > 1e-9) tt = Math.min(tt, (HU - BR - cy) / dy);
  if (dy < -1e-9) tt = Math.min(tt, (BR - cy) / dy);
  return Math.max(0, tt);
}

function ballsOf(s: PoolState): Pt[] {
  return s.balls.filter((b) => !b.in).map((b) => ({ n: b.n, x: b.x / U, y: b.y / U }));
}

/** Per-ball roll state, indexed by ball number (preallocated: the draw loop allocates nothing per ball). */
interface RollState {
  px: Float64Array;
  py: Float64Array;
  ph: Float64Array; // rolled angle (distance / radius)
  dx: Float64Array; // roll direction
  dy: Float64Array;
  seen: Uint8Array;
}
const newRoll = (portrait: boolean): RollState => {
  const r = { px: new Float64Array(16), py: new Float64Array(16), ph: new Float64Array(16), dx: new Float64Array(16), dy: new Float64Array(16), seen: new Uint8Array(16) };
  for (let i = 0; i < 16; i++) {
    r.dx[i] = portrait ? 0 : 1;
    r.dy[i] = portrait ? 1 : 0;
  }
  return r;
};
/** Advance a ball's roll from its last drawn position: the number spot travels over the ball as it rolls and settles face-up at rest. */
function rollStep(r: RollState, b: Pt) {
  const n = b.n;
  if (!r.seen[n]) {
    r.seen[n] = 1;
    r.px[n] = b.x;
    r.py[n] = b.y;
    return;
  }
  const mx = b.x - r.px[n]!;
  const my = b.y - r.py[n]!;
  const d = Math.hypot(mx, my);
  if (d > 0.5) {
    r.ph[n] = r.ph[n]! + d / BR;
    r.dx[n] = mx / d;
    r.dy[n] = my / d;
  } else {
    const rest = Math.round(r.ph[n]! / Math.PI) * Math.PI; // settle with the number up (readable at rest)
    r.ph[n] = r.ph[n]! + (rest - r.ph[n]!) * 0.18;
  }
  r.px[n] = b.x;
  r.py[n] = b.y;
}

function drawBall(g: CanvasRenderingContext2D, b: Pt, portrait: boolean, alpha = 1, r?: RollState, cb = false, scale = 1) {
  const R0 = BR * scale;
  g.globalAlpha = alpha;
  g.fillStyle = "rgba(0,0,0,.35)";
  g.beginPath();
  g.arc(b.x + 70 * scale, b.y + 90 * scale, R0, 0, Math.PI * 2);
  g.fill();
  // roll: the number spot (two, on opposite sides of a real ball) sits at sin(θ) along the roll direction
  const ph = r ? r.ph[b.n]! : 0;
  const dx = r ? r.dx[b.n]! : portrait ? 0 : 1;
  const dy = r ? r.dy[b.n]! : portrait ? 1 : 0;
  const th = ((((ph + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI) - Math.PI / 2;
  const off = Math.sin(th) * R0 * 0.62;
  const squash = Math.max(0.12, Math.cos(th));
  const ang = Math.atan2(dy, dx);
  g.save();
  g.beginPath();
  g.arc(b.x, b.y, R0, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = isStripe(b.n) ? "#fdfdfd" : (BALL_COLORS[b.n] ?? "#fff");
  g.fillRect(b.x - R0, b.y - R0, R0 * 2, R0 * 2);
  if (isStripe(b.n)) {
    // the coloured band runs through the number spots, so it turns with the roll direction
    g.save();
    g.translate(b.x, b.y);
    g.rotate(ang);
    g.fillStyle = BALL_COLORS[b.n]!;
    g.fillRect(-R0, -R0 * 0.55, R0 * 2, R0 * 1.1);
    if (cb) {
      // colour-blind mode: dark edges on the band make stripes readable without colour
      g.strokeStyle = "rgba(0,0,0,.75)";
      g.lineWidth = R0 * 0.09;
      g.strokeRect(-R0 * 1.2, -R0 * 0.55, R0 * 2.4, R0 * 1.1);
    }
    g.restore();
  }
  const sh = g.createRadialGradient(b.x - 90 * scale, b.y - 90 * scale, 10, b.x, b.y, R0);
  sh.addColorStop(0, "rgba(255,255,255,.7)");
  sh.addColorStop(0.4, "rgba(255,255,255,0)");
  sh.addColorStop(1, "rgba(0,0,0,.25)");
  g.fillStyle = sh;
  g.fillRect(b.x - R0, b.y - R0, R0 * 2, R0 * 2);
  if (b.n > 0) {
    const disc = R0 * (cb ? 0.52 : 0.44);
    g.save();
    g.translate(b.x + dx * off, b.y + dy * off);
    g.rotate(ang);
    g.scale(squash, 1);
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(0, 0, disc, 0, Math.PI * 2);
    g.fill();
    g.rotate(-ang + (portrait ? Math.PI / 2 : 0)); // keep the numbers upright (a standing table turns them too)
    g.fillStyle = "#111";
    g.font = `bold ${R0 * (cb ? 0.72 : 0.6)}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(b.n), 0, 10 * scale);
    g.restore();
  } else if (r) {
    // cue ball: a small red dot shows the roll
    g.fillStyle = "rgba(200,30,30,.65)";
    g.beginPath();
    g.ellipse(b.x + dx * off, b.y + dy * off, R0 * 0.12 * squash, R0 * 0.12, ang, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  g.globalAlpha = 1;
}

const dropPt: Pt = { n: 0, x: 0, y: 0 };

/** Wooden rack triangle around the opening rack, fading and lifting as `t` → 1. */
function drawRackFrame(g: CanvasRenderingContext2D, balls: Pt[], t: number) {
  let apex: Pt | null = null;
  let top: Pt | null = null;
  let bot: Pt | null = null;
  for (const b of balls) {
    if (b.n === 0) continue;
    if (!apex || b.x < apex.x) apex = b;
    if (!top || b.x > top.x + 1 || (Math.abs(b.x - top.x) <= 1 && b.y < top.y)) top = b;
    if (!bot || b.x > bot.x + 1 || (Math.abs(b.x - bot.x) <= 1 && b.y > bot.y)) bot = b;
  }
  if (!apex || !top || !bot) return;
  const cx = (apex.x + top.x + bot.x) / 3;
  const cy = (apex.y + top.y + bot.y) / 3;
  const lift = t < 0.75 ? 1 : 1 + (t - 0.75) * 0.25;
  const alpha = t < 0.75 ? 1 : Math.max(0, 1 - (t - 0.75) / 0.25);
  const grow = (p: Pt) => [cx + (p.x - cx) * 1.55 * lift, cy + (p.y - cy) * 1.55 * lift] as const;
  const [ax, ay] = grow(apex);
  const [tx, ty] = grow(top);
  const [bx2, by2] = grow(bot);
  g.globalAlpha = alpha;
  g.lineJoin = "round";
  g.strokeStyle = "rgba(0,0,0,.35)";
  g.lineWidth = 150;
  g.beginPath();
  g.moveTo(ax + 60, ay + 80);
  g.lineTo(tx + 60, ty + 80);
  g.lineTo(bx2 + 60, by2 + 80);
  g.closePath();
  g.stroke();
  g.strokeStyle = "#7a4a22";
  g.lineWidth = 130;
  g.beginPath();
  g.moveTo(ax, ay);
  g.lineTo(tx, ty);
  g.lineTo(bx2, by2);
  g.closePath();
  g.stroke();
  g.strokeStyle = "rgba(255,220,170,.35)";
  g.lineWidth = 30;
  g.stroke();
  g.globalAlpha = 1;
}

/**
 * The 8-ball table for practice and live play. Renders the authoritative state, replays the server's recorded
 * frames (interpolated, skippable, re-playable), and turns touch / mouse / keyboard / gamepad input into one
 * integer shot intent: aim (drag, arrows, stick), pull-back or bar power, spin, ball in hand, called pocket.
 */
export function PoolTable({
  state,
  mySide,
  myTurn,
  guide,
  onShoot,
  onReplayDone,
  names,
}: {
  state: PoolState;
  mySide: 0 | 1;
  myTurn: boolean;
  /** aim guide length: practice follows the setting, live matches always pass "short" (same for both players) */
  guide: AimGuide;
  onShoot: (i: PoolIntent) => void;
  onReplayDone?: () => void;
  names: [string, string];
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const art = useRef<{ key: string; c: HTMLCanvasElement } | null>(null);
  const [view, setView] = useState<View>({ portrait: false, s: 0.03 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [cssSize, setCssSize] = useState({ w: 0, h: 0 });

  const aim = useRef(0);
  const [power, setPowerState] = useState(0.5);
  const powerRef = useRef(0.5);
  const setPower = (p: number) => {
    powerRef.current = Math.max(0, Math.min(1, p));
    setPowerState(powerRef.current);
  };
  const [spin, setSpin] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const replayingRef = useRef(false);
  const shown = useRef<Pt[]>(ballsOf(state));
  const [cuePos, setCuePos] = useState<{ x: number; y: number } | null>(null); // ball in hand placement
  const cuePosRef = useRef<{ x: number; y: number } | null>(null);
  cuePosRef.current = cuePos;
  const [badSpot, setBadSpot] = useState(false);
  const [called, setCalled] = useState<number | null>(null);
  const userCalled = useRef(false);
  const [keyPlacing, setKeyPlacing] = useState(false);
  const drag = useRef<{ mode: "aim" | "power" | "place"; start: number; id: number } | null>(null);
  const pull = useRef(0); // 0..1 while pulling the cue back on the table
  const [banner, setBanner] = useState<Banner | null>(null);
  const bannerId = useRef(0);
  const lastShots = useRef(state.shots);
  const replayFrames = useRef<number[][] | null>(null);

  const canAct = myTurn && !replaying && state.winner === null;
  const canActRef = useRef(canAct);
  canActRef.current = canAct;
  const eight = onTheEight(state, mySide);
  const targets = new Set(legalTargets(state, mySide));
  // what the draw loop reads every frame (kept in a ref so the loop never restarts)
  const colorBlind = useGamePrefs((s) => s.colorBlind);
  const hints = useGamePrefs((s) => s.hints);
  const leftHanded = useGamePrefs((s) => s.leftHanded);
  const live = useRef({ eight, targets, called, badSpot, guide, colorBlind, hints });
  live.current = { eight, targets, called, badSpot, guide, colorBlind, hints };
  // presentation-only animation state (rolling numbers, pocket drops, the opening rack)
  const roll = useRef<RollState>(newRoll(false));
  const drops = useRef<{ n: number; x: number; y: number; px: number; py: number; t0: number }[]>([]);
  const rackAt = useRef<number | null>(state.shots === 0 ? -1 : null);
  const show = useCallback((text: string, tone: Banner["tone"] = "info") => setBanner({ id: ++bannerId.current, text, tone }), []);

  // fit the canvas to its box (keeps the aspect, landscape or standing table)
  // the whole play area decides the orientation (a tall box stands the table up); the canvas fills what is left
  // after the controls, keeping the table's aspect
  const root = useRef<HTMLDivElement>(null);
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    const box = root.current;
    if (!el || !box) return;
    const ro = new ResizeObserver(() => {
      const p = box.clientHeight > box.clientWidth * 1.1;
      setPortrait(p);
      const w = el.clientWidth;
      const h = el.clientHeight;
      const tw = (p ? HU : WU) + PAD * 2;
      const th = (p ? WU : HU) + PAD * 2;
      const s = Math.max(0.001, Math.min(w / tw, h / th));
      setView({ portrait: p, s });
      setCssSize({ w: Math.floor(tw * s), h: Math.floor(th * s) });
    });
    ro.observe(el);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // a new turn: reset the per-shot controls, aim at a legal ball, suggest nothing yet
  const turnKey = `${state.shots}:${state.turn}:${myTurn}`;
  useEffect(() => {
    if (!myTurn) return;
    userCalled.current = false;
    setCalled(null);
    setSpin(0);
    setPower(0.5);
    const cue = state.balls.find((b) => b.n === 0)!;
    setCuePos(state.ballInHand ? { x: Math.round(cue.x / U), y: Math.round(cue.y / U) } : null);
    setKeyPlacing(state.ballInHand && document.documentElement.dataset.input === "key");
    // aim at the nearest legal ball, so keyboard / TV players start from a sensible line
    const legal = state.balls.filter((b) => !b.in && targets.has(b.n));
    const near = legal.sort((a, b) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y))[0];
    if (near && state.shots > 0) aim.current = Math.atan2(near.y - cue.y, near.x - cue.x);
    else aim.current = 0;
    if (shouldAutoFocus()) canvas.current?.focus({ preventScroll: true });
  }, [turnKey]);

  // replay new shots from the recorded frames (40 fps, interpolated to the display rate). The playback rate follows
  // the speed setting (Relaxed slower, Fast quicker, Skip = straight to the result) — the outcome is already decided.
  const playFrames = useCallback(
    (frames: number[][], final: Pt[], after?: () => void) => {
      const scale = animScale();
      if (frames.length < 2 || scale === 0) {
        // nothing to play (a timeout, skipped animations): also ends any replay a newer state interrupted
        replayingRef.current = false;
        setReplaying(false);
        shown.current = final;
        after?.();
        return () => undefined;
      }
      replayFrames.current = frames;
      replayingRef.current = true;
      setReplaying(true);
      sfx.cue(0.6);
      const rate = 1 / scale;
      const start = performance.now();
      const total = frames[frames.length - 1]![0]!;
      let raf = 0;
      // preallocated buffers: the step allocates nothing per frame (positions by ball number)
      const out: Pt[] = Array.from({ length: 16 }, (_, n) => ({ n, x: 0, y: 0 }));
      const view: Pt[] = [];
      const bx = new Float64Array(16);
      const by = new Float64Array(16);
      const has = new Uint8Array(16);
      const pvx = new Float64Array(16);
      const pvy = new Float64Array(16);
      const onTable = new Uint8Array(16);
      const lastX = new Float64Array(16);
      const lastY = new Float64Array(16);
      for (let k = 1; k + 2 < frames[0]!.length; k += 3) onTable[frames[0]![k]!] = 1;
      let lastClack = 0;
      const step = () => {
        if (!replayingRef.current) return; // skipped
        const now = performance.now();
        const tick = ((now - start) / 1000) * 240 * rate;
        let i = 0;
        while (i < frames.length - 1 && frames[i + 1]![0]! <= tick) i++;
        const fa = frames[i]!;
        const fb = frames[Math.min(i + 1, frames.length - 1)]!;
        const span = fb[0]! - fa[0]! || 1;
        const kk = Math.max(0, Math.min(1, (tick - fa[0]!) / span));
        has.fill(0);
        for (let k = 1; k + 2 < fb.length; k += 3) {
          const n = fb[k]!;
          has[n] = 1;
          bx[n] = fb[k + 1]!;
          by[n] = fb[k + 2]!;
        }
        view.length = 0;
        let clack = 0;
        for (let k = 1; k + 2 < fa.length; k += 3) {
          const n = fa[k]!;
          const ax = fa[k + 1]!;
          const ay = fa[k + 2]!;
          const p = out[n]!;
          const vx = has[n] ? bx[n]! - ax : 0;
          const vy = has[n] ? by[n]! - ay : 0;
          p.x = ax + vx * kk;
          p.y = ay + vy * kk;
          view.push(p);
          // a sharp change of direction → clack
          const sp = Math.hypot(vx, vy);
          const ps = Math.hypot(pvx[n]!, pvy[n]!);
          if (sp > 20 && (ps < 5 || (vx * pvx[n]! + vy * pvy[n]!) / (sp * ps) < 0.8)) clack = Math.max(clack, Math.min(1, sp / 400));
          pvx[n] = vx;
          pvy[n] = vy;
          lastX[n] = p.x;
          lastY[n] = p.y;
        }
        if (clack > 0 && now - lastClack > 60) {
          sfx.clack(clack);
          lastClack = now;
        }
        // a ball left the table this frame → it drops into the nearest pocket (drawn shrinking into it)
        for (let n = 0; n < 16; n++) {
          if (!onTable[n]) continue;
          let still = false;
          for (let k = 1; k + 2 < fa.length; k += 3) if (fa[k] === n) still = true;
          if (still) continue;
          onTable[n] = 0;
          let best = 0;
          let bd = Infinity;
          PK.forEach(([px, py], j) => {
            const d = Math.hypot(px - lastX[n]!, py - lastY[n]!);
            if (d < bd) {
              bd = d;
              best = j;
            }
          });
          drops.current.push({ n, x: lastX[n]!, y: lastY[n]!, px: PK[best]![0], py: PK[best]![1], t0: now });
          sfx.pocket();
          haptic(20);
        }
        shown.current = view;
        if (tick < total) raf = requestAnimationFrame(step);
        else finish();
      };
      const finish = () => {
        replayingRef.current = false;
        shown.current = final;
        setReplaying(false);
        after?.();
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
    },
    [],
  );

  useEffect(() => {
    if (state.shots === 0) rackAt.current = -1; // a new rack: the balls gather into the triangle (draw loop)
  }, [state.shots === 0, state.players[0]]);

  useEffect(() => {
    const final = ballsOf(state);
    const frames = state.lastShot?.frames ?? [];
    if (state.shots === lastShots.current) {
      if (!replayingRef.current) shown.current = final;
      return;
    }
    lastShots.current = state.shots;
    const ls = state.lastShot;
    const announce = () => {
      onReplayDone?.(); // always, the deciding shot included (the result screen waits for it)
      if (state.winner !== null) return;
      if (ls?.foul) {
        sfx.foul();
        haptic([60, 40, 60]);
        show(ls.message, "bad");
      } else if (state.turn === mySide) show(ls?.message === "Potted. Shoot again" ? ls.message : state.ballInHand ? t("pool.ballInHand") : t("game.yourTurn"), "good");
      else if (ls?.message) show(ls.message);
    };
    return playFrames(frames, final, announce);
  }, [state.shots, state.lastShot]);

  const skip = () => {
    if (!replayingRef.current) return;
    replayingRef.current = false;
    shown.current = ballsOf(state);
    setReplaying(false);
    if (state.winner === null && state.turn === mySide) show(t("game.yourTurn"), "good");
    onReplayDone?.();
  };
  const replayLast = () => {
    const frames = state.lastShot?.frames;
    if (frames && frames.length > 1 && !replayingRef.current) playFrames(frames, ballsOf(state));
  };

  // the cue ball as the shooter sees it (ball in hand placement included)
  const cueNow = (): Pt | undefined => {
    const c = shown.current.find((b) => b.n === 0);
    if (c && canActRef.current && cuePosRef.current) return { n: 0, ...cuePosRef.current };
    return c;
  };

  // called pocket: the one the 8 heads for on the current line, unless the player picked one
  const suggestPocket = useCallback(() => {
    if (!eight || userCalled.current) return;
    const cue = cueNow();
    if (!cue) return;
    const hit = rayHit(shown.current, cue.x, cue.y, aim.current);
    if (!hit || hit.ball.n !== 8) return;
    const gx = cue.x + Math.cos(aim.current) * hit.t;
    const gy = cue.y + Math.sin(aim.current) * hit.t;
    const ox = hit.ball.x - gx;
    const oy = hit.ball.y - gy;
    let best = 0;
    let bestCos = -2;
    PK.forEach(([px, py], i) => {
      const vx = px - hit.ball.x;
      const vy = py - hit.ball.y;
      const c = (vx * ox + vy * oy) / (Math.hypot(vx, vy) * Math.hypot(ox, oy) || 1);
      if (c > bestCos) {
        bestCos = c;
        best = i;
      }
    });
    setCalled((p) => (p === best ? p : best));
  }, [eight]);

  const shoot = useCallback(
    (pw = powerRef.current) => {
      if (!canActRef.current || pw < 0.02) return;
      if (state.ballInHand && cuePosRef.current && !canPlaceCue(state, cuePosRef.current.x, cuePosRef.current.y)) {
        setBadSpot(true);
        show(t("pool.invalidSpot"), "bad");
        return;
      }
      if (eight && called === null) {
        show(t("pool.callPocket"), "bad");
        return;
      }
      const a = aim.current;
      sfx.cue(pw);
      haptic(Math.round(15 + pw * 35));
      onShoot({
        dx: Math.round(Math.cos(a) * 100000),
        dy: Math.round(Math.sin(a) * 100000),
        power: Math.max(1, Math.min(1000, Math.round(pw * 1000))),
        spin,
        ...(state.ballInHand && cuePosRef.current ? { cue: cuePosRef.current } : {}),
        ...(eight && called !== null ? { pocket: called } : {}),
      });
      setPower(0.5);
    },
    [called, eight, onShoot, show, spin, state],
  );

  // keyboard / TV remote / gamepad (synthetic keys) while the table (or nothing) has focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const act = document.activeElement;
      if (act && act !== document.body && act !== canvas.current) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (replayingRef.current && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        skip();
        return;
      }
      if (!canActRef.current) return;
      const fine = e.shiftKey;
      if (keyPlacing && cuePosRef.current) {
        const st = fine ? 15 : 90;
        const mv: Record<string, [number, number]> = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] };
        let d = mv[e.key];
        if (d && viewRef.current.portrait) d = [-d[1], d[0]] as [number, number]; // screen arrows on a standing table
        if (d) {
          e.preventDefault();
          const p = { x: Math.round(Math.max(BR, Math.min(WU - BR, cuePosRef.current.x + d[0]))), y: Math.round(Math.max(BR, Math.min(HU - BR, cuePosRef.current.y + d[1]))) };
          setCuePos(p);
          setBadSpot(!canPlaceCue(state, p.x, p.y));
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (canPlaceCue(state, cuePosRef.current.x, cuePosRef.current.y)) setKeyPlacing(false);
          else show(t("pool.invalidSpot"), "bad");
          return;
        }
      }
      const rot = 1; // the standing table is a proper rotation: clockwise stays clockwise
      switch (e.key) {
        case "ArrowLeft":
          aim.current -= (fine ? 0.1 : 1) * DEG * rot;
          break;
        case "ArrowRight":
          aim.current += (fine ? 0.1 : 1) * DEG * rot;
          break;
        case "ArrowUp":
          setPower(powerRef.current + 0.05);
          break;
        case "ArrowDown":
          setPower(powerRef.current - 0.05);
          break;
        case "Enter":
        case " ":
          shoot();
          break;
        case "q":
        case "Q":
          setSpin((s) => Math.max(-100, s - 20));
          break;
        case "e":
        case "E":
          setSpin((s) => Math.min(100, s + 20));
          break;
        case "x":
          setSpin((s) => (s === 0 ? 60 : s > 0 ? -60 : 0));
          break;
        case "p":
        case "P":
        case "y":
          if (!eight) return;
          userCalled.current = true;
          setCalled((c) => ((c ?? -1) + 1) % 6);
          break;
        default:
          return;
      }
      e.preventDefault();
      suggestPocket();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shoot, keyPlacing, eight, suggestPocket, state]);

  // gamepad sticks: analog aim (left), power (right stick / triggers)
  useEffect(() => {
    padOptions.analogSticks = true;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!pad.connected || !canActRef.current || document.querySelector('[aria-modal="true"]')) return;
      const lx = pad.lx;
      if (lx) {
        aim.current += Math.sign(lx) * lx * lx * 1.4 * DEG;
        suggestPocket();
      }
      const dp = -pad.ry * 0.02 + (pad.rt - pad.lt) * 0.02;
      if (dp) setPower(powerRef.current + dp);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      padOptions.analogSticks = false;
      cancelAnimationFrame(raf);
    };
  }, [suggestPocket]);

  // pointer: drag to aim; pull the cue back (start near the cue ball) to shoot; drag the cue ball with ball in hand
  const tablePoint = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return toTable(viewRef.current, e.clientX - r.left, e.clientY - r.top);
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (replayingRef.current) return skip();
    if (!canActRef.current) return;
    const p = tablePoint(e);
    const cue = cueNow();
    if (!cue) return;
    const d = Math.hypot(p.x - cue.x, p.y - cue.y);
    // a pocket tap on the 8 calls it
    if (eight) {
      const i = PK.findIndex(([px, py, pr]) => Math.hypot(p.x - px, p.y - py) < pr * 1.7);
      if (i >= 0) {
        userCalled.current = true;
        setCalled(i);
        sfx.tap();
        return;
      }
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (state.ballInHand && d < BR * 2.6) {
      drag.current = { mode: "place", start: 0, id: e.pointerId };
      return;
    }
    // behind the cue ball, on the stick line → pull back for power
    const ax = Math.cos(aim.current);
    const ay = Math.sin(aim.current);
    const back = -((p.x - cue.x) * ax + (p.y - cue.y) * ay);
    const lateral = Math.abs(-(p.x - cue.x) * ay + (p.y - cue.y) * ax);
    if (d < BR * 4 || (back > 0 && back < 9000 && lateral < BR * 3)) {
      drag.current = { mode: "power", start: Math.max(0, back), id: e.pointerId };
      pull.current = 0;
      return;
    }
    drag.current = { mode: "aim", start: 0, id: e.pointerId };
    aim.current = Math.atan2(p.y - cue.y, p.x - cue.x);
    suggestPocket();
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = tablePoint(e);
    const cue = cueNow();
    if (!cue || !canActRef.current) return;
    const dr = drag.current;
    if (!dr) {
      // mouse hover aims (desktop); touch only aims while dragging
      if (e.pointerType === "mouse" && !e.buttons) {
        aim.current = Math.atan2(p.y - cue.y, p.x - cue.x);
        suggestPocket();
      }
      return;
    }
    if (dr.mode === "aim") {
      aim.current = Math.atan2(p.y - cue.y, p.x - cue.x);
      suggestPocket();
    } else if (dr.mode === "power") {
      const back = -((p.x - cue.x) * Math.cos(aim.current) + (p.y - cue.y) * Math.sin(aim.current));
      pull.current = Math.max(0, Math.min(1, (back - dr.start) / MAX_PULL));
      setPower(pull.current);
    } else {
      const x = Math.round(Math.max(BR, Math.min(WU - BR, p.x)));
      const y = Math.round(Math.max(BR, Math.min(HU - BR, p.y)));
      setCuePos({ x, y });
      setBadSpot(!canPlaceCue(state, x, y));
    }
  };
  const onUp = () => {
    const dr = drag.current;
    drag.current = null;
    if (!dr) return;
    if (dr.mode === "power") {
      const pw = pull.current;
      pull.current = 0;
      if (pw > 0.03) shoot(pw);
      else setPower(0.5);
    } else if (dr.mode === "place" && cuePosRef.current && !canPlaceCue(state, cuePosRef.current.x, cuePosRef.current.y)) {
      show(t("pool.invalidSpot"), "bad");
    }
  };

  // draw loop
  useEffect(() => {
    let raf = 0;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const remScale = Math.max(1, (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      const v = viewRef.current;
      if (!c || !cssSize.w) return;
      const pw = Math.round(cssSize.w * dpr);
      const ph = Math.round(cssSize.h * dpr);
      if (c.width !== pw || c.height !== ph) {
        c.width = pw;
        c.height = ph;
      }
      const g = c.getContext("2d")!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, pw, ph);
      applyView(g, v, dpr);
      const scale = v.s * dpr;
      const key = scale.toFixed(4);
      if (art.current?.key !== key) art.current = { key, c: paintTable({ w: WU, h: HU, pad: PAD, pockets: PK.map(([x, y, r]) => [x, y, r * 0.75] as const), pocketR: 0, scale }) };
      g.drawImage(art.current.c, -PAD, -PAD, WU + PAD * 2, HU + PAD * 2);

      const balls = shown.current;
      const act = canActRef.current;
      const { eight, targets, called, badSpot, guide, colorBlind: cb, hints } = live.current;
      const now = performance.now();
      const k = animScale();
      if (roll.current.dx[0] === 0 !== v.portrait && !roll.current.seen[0]) roll.current = newRoll(v.portrait);
      const cue = act && cuePosRef.current ? { n: 0, ...cuePosRef.current } : balls.find((b) => b.n === 0);
      const others = act && cuePosRef.current ? balls.filter((b) => b.n !== 0) : balls;
      // one css pixel in units, thickened with the 10-foot root size so guides stay readable on TVs
      const lw = (1 / v.s) * remScale;

      // called pocket ring
      if (eight && act && called !== null) {
        const [px, py, pr] = PK[called]!;
        g.strokeStyle = "rgba(251,191,36,.95)";
        g.lineWidth = 3 * lw;
        g.setLineDash([10 * lw, 6 * lw]);
        g.beginPath();
        g.arc(px, py, pr * 0.95, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      } else if (eight && act) {
        for (const [px, py, pr] of PK) {
          g.strokeStyle = "rgba(251,191,36,.45)";
          g.lineWidth = 2 * lw;
          g.beginPath();
          g.arc(px, py, pr * 0.9, 0, Math.PI * 2);
          g.stroke();
        }
      }

      if (act && cue && hints) {
        const a = aim.current;
        const ax = Math.cos(a);
        const ay = Math.sin(a);
        const hit = rayHit(others, cue.x, cue.y, a);
        const len = hit ? hit.t : rayWall(cue.x, cue.y, a);
        g.setLineDash([8 * lw, 7 * lw]);
        g.strokeStyle = "rgba(255,255,255,.8)";
        g.lineWidth = 2 * lw;
        g.beginPath();
        g.moveTo(cue.x, cue.y);
        g.lineTo(cue.x + ax * len, cue.y + ay * len);
        g.stroke();
        g.setLineDash([]);
        if (hit) {
          const gx = cue.x + ax * hit.t;
          const gy = cue.y + ay * hit.t;
          const legal = targets.has(hit.ball.n);
          g.strokeStyle = legal ? "rgba(255,255,255,.9)" : "rgba(239,68,68,.95)";
          g.lineWidth = 2.5 * lw;
          g.beginPath();
          g.arc(gx, gy, BR, 0, Math.PI * 2);
          g.stroke();
          if (!legal) {
            g.beginPath();
            g.moveTo(gx - BR * 0.6, gy - BR * 0.6);
            g.lineTo(gx + BR * 0.6, gy + BR * 0.6);
            g.moveTo(gx + BR * 0.6, gy - BR * 0.6);
            g.lineTo(gx - BR * 0.6, gy + BR * 0.6);
            g.stroke();
          }
          // object ball path (longer with the full practice guide) + cue ball tangent line
          const ox = hit.ball.x - gx;
          const oy = hit.ball.y - gy;
          const ol = Math.hypot(ox, oy) || 1;
          const cut = (ox * ax + oy * ay) / ol; // cos of the cut angle
          const objLen = (guide === "long" ? 5200 : guide === "medium" ? 3200 : 1700) * Math.max(0.25, cut);
          g.strokeStyle = legal ? "rgba(251,191,36,.95)" : "rgba(239,68,68,.6)";
          g.lineWidth = 2.5 * lw;
          g.beginPath();
          g.moveTo(hit.ball.x, hit.ball.y);
          g.lineTo(hit.ball.x + (ox / ol) * objLen, hit.ball.y + (oy / ol) * objLen);
          g.stroke();
          if (guide !== "short" && cut < 0.995) {
            let tx = -oy / ol;
            let ty = ox / ol;
            if (tx * ax + ty * ay < 0) {
              tx = -tx;
              ty = -ty;
            }
            g.strokeStyle = "rgba(255,255,255,.45)";
            g.lineWidth = 1.5 * lw;
            g.beginPath();
            g.moveTo(gx, gy);
            g.lineTo(gx + tx * 2200 * Math.sqrt(1 - cut * cut), gy + ty * 2200 * Math.sqrt(1 - cut * cut));
            g.stroke();
          }
        } else if (guide === "long") {
          // first cushion bounce
          const ex = cue.x + ax * len;
          const ey = cue.y + ay * len;
          const bx = ex <= BR + 1 || ex >= WU - BR - 1 ? -ax : ax;
          const by = ey <= BR + 1 || ey >= HU - BR - 1 ? -ay : ay;
          g.strokeStyle = "rgba(255,255,255,.35)";
          g.setLineDash([6 * lw, 8 * lw]);
          g.beginPath();
          g.moveTo(ex, ey);
          g.lineTo(ex + bx * 3000, ey + by * 3000);
          g.stroke();
          g.setLineDash([]);
        }
      }

      // pocket drops: the ball slides into the pocket, shrinking into the dark
      for (let i = drops.current.length - 1; i >= 0; i--) {
        const d = drops.current[i]!;
        const tt = k === 0 ? 1 : Math.min(1, (now - d.t0) / (280 * k));
        if (tt >= 1) {
          drops.current.splice(i, 1);
          continue;
        }
        const e = tt * tt;
        dropPt.n = d.n;
        dropPt.x = d.x + (d.px - d.x) * e;
        dropPt.y = d.y + (d.py - d.y) * e;
        drawBall(g, dropPt, v.portrait, 1 - tt * 0.8, undefined, cb, 1 - tt * 0.45);
      }

      // the opening rack: balls gather into the triangle, then the wooden frame lifts away
      let rk = 1;
      if (rackAt.current !== null) {
        if (rackAt.current < 0) rackAt.current = now;
        rk = k === 0 ? 1 : Math.min(1, (now - rackAt.current) / (1100 * k));
        if (rk >= 1) rackAt.current = null;
      }
      for (const b of others) {
        rollStep(roll.current, b);
        if (rk < 1 && b.n !== 0) {
          const e = 1 - Math.pow(1 - Math.min(1, rk / 0.7), 3);
          dropPt.n = b.n;
          dropPt.x = b.x + Math.sin(b.n * 1.7) * 1900 * (1 - e);
          dropPt.y = b.y + Math.cos(b.n * 2.3) * 1900 * (1 - e);
          drawBall(g, dropPt, v.portrait, Math.min(1, rk * 3), roll.current, cb);
        } else drawBall(g, b, v.portrait, 1, roll.current, cb);
      }
      if (rk < 1) drawRackFrame(g, others, rk);

      if (act && cue) {
        // the cue, drawn back by the power, held by your bridge hand on the cloth and your grip hand on the butt
        const a = aim.current;
        const back = 300 + (drag.current?.mode === "power" ? pull.current : powerRef.current) * 2600;
        drawCueHands(g, cue.x, cue.y, a, BR + back, BR + 3600, 25, "back");
        drawCue(g, cue.x, cue.y, a, BR + back, 8000, 25);
        drawCueHands(g, cue.x, cue.y, a, BR + back, BR + 3600, 25, "front");
      }
      if (cue && act && cuePosRef.current) {
        drawBall(g, cue, v.portrait, 0.95, undefined, cb);
        // ball in hand: a hand ring, red where it can't go
        g.strokeStyle = badSpot ? "rgba(239,68,68,.95)" : "rgba(255,255,255,.9)";
        g.lineWidth = 3 * lw;
        g.setLineDash([6 * lw, 5 * lw]);
        g.beginPath();
        g.arc(cue.x, cue.y, BR * 1.8, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [cssSize]);

  const statusKey: GameKey | null = !canAct ? null : state.ballInHand && keyPlacing ? "pool.ballInHandKeys" : state.ballInHand ? "pool.ballInHand" : eight && called === null ? "pool.callPocket" : null;
  const pocketName = called !== null ? t(`pool.pocket${called}` as GameKey) : "";
  const actionBtn = replaying ? (
    <button type="button" onClick={skip} className="btn-secondary min-h-11 w-full rounded-control px-3 text-sm font-bold">
      {t("pool.skip")}
    </button>
  ) : canAct ? (
    <button type="button" onClick={() => shoot()} className="btn-primary min-h-11 w-full rounded-control px-3 font-display text-sm font-bold">
      {t("pool.shoot")}
    </button>
  ) : (
    <button type="button" onClick={replayLast} disabled={!state.lastShot?.frames?.length} className="btn-secondary flex min-h-11 w-full items-center justify-center gap-1 rounded-control px-2 text-xs font-bold disabled:opacity-40" aria-label={t("pool.replay")}>
      <RotateCcw size={14} /> {t("pool.replay")}
    </button>
  );
  const fineAim = (
    <div className="flex gap-1">
      <HoldButton label={t("pool.fineAim")} disabled={!canAct} onStep={() => (aim.current -= 0.08 * DEG)}>
        <ChevronLeft size={18} />
      </HoldButton>
      <HoldButton label={t("pool.fineAim")} disabled={!canAct} onStep={() => (aim.current += 0.08 * DEG)}>
        <ChevronRight size={18} />
      </HoldButton>
    </div>
  );

  return (
    <div ref={root} className={`absolute inset-0 flex gap-2 ${portrait ? "flex-col" : leftHanded ? "flex-row-reverse" : "flex-row"}`}>
      <div ref={wrap} className="relative min-h-0 min-w-0 flex-1">
        <canvas
          ref={canvas}
          tabIndex={0}
          aria-label={`${t("pool.title")}: ${canAct ? t("pool.aimHint") : ""}`}
          style={{ width: cssSize.w || undefined, height: cssSize.h || undefined }}
          className="absolute inset-0 m-auto touch-none rounded-card shadow-2xl"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        {banner && <TurnBanner key={banner.id} text={banner.text} tone={banner.tone} />}
        <div className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center">
          {statusKey && (
            <p className="chip flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold sm:text-sm">
              {statusKey.startsWith("pool.ballInHand") ? <Hand size={14} /> : <Target size={14} />} {t(statusKey)}
            </p>
          )}
          {!statusKey && canAct && eight && called !== null && (
            <p className="chip flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white sm:text-sm">
              <Target size={14} className="text-gold" /> {t("pool.called", { pocket: pocketName })}
            </p>
          )}
        </div>
      </div>

      {/* controls: a column at the right edge in landscape (thumb reach), two rows under a standing table */}
      {portrait ? (
        <div className="flex shrink-0 flex-col gap-2 px-1">
          <PowerBar value={power} vertical={false} disabled={!canAct} onChange={setPower} onRelease={(p) => shoot(p)} />
          <div className={`flex items-center justify-between gap-2 ${leftHanded ? "flex-row-reverse" : ""}`}>
            <SpinPicker value={spin} onChange={setSpin} disabled={!canAct} />
            {fineAim}
            <div className="w-28">{actionBtn}</div>
          </div>
        </div>
      ) : (
        <div className="flex h-full max-h-136 w-21 shrink-0 flex-col items-center justify-center gap-1.5 py-1">
          <PowerBar value={power} vertical disabled={!canAct} onChange={setPower} onRelease={(p) => shoot(p)} />
          <SpinPicker value={spin} onChange={setSpin} disabled={!canAct} />
          {fineAim}
          {actionBtn}
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {state.lastShot?.message ?? ""} {names[state.turn]}
      </span>
    </div>
  );
}

/** Power: drag along the bar (release shoots), or arrows / slider keys with Enter to shoot. */
function PowerBar({ value, vertical, disabled, onChange, onRelease }: { value: number; vertical: boolean; disabled: boolean; onChange: (v: number) => void; onRelease: (v: number) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const latest = useRef(value);
  latest.current = value;
  const from = (e: React.PointerEvent) => {
    const r = bar.current!.getBoundingClientRect();
    const v = vertical ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    onChange(Math.max(0, Math.min(1, v)));
    latest.current = Math.max(0, Math.min(1, v));
  };
  return (
    <div className={`flex items-center gap-1 ${vertical ? "min-h-0 flex-1 flex-col" : "flex-1 flex-row"}`}>
      <span className="label text-[0.625rem] text-on-glass-muted">{t("pool.power")}</span>
      <div
        ref={bar}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={t("pool.power")}
        aria-orientation={vertical ? "vertical" : "horizontal"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-disabled={disabled}
        className={`relative touch-none overflow-hidden rounded-full border-2 border-white/25 bg-white/8 ${vertical ? "min-h-14 w-11 flex-1" : "h-11 min-w-24 flex-1"} ${disabled ? "opacity-40" : "cursor-grab"}`}
        onPointerDown={(e) => {
          if (disabled) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          from(e);
        }}
        onPointerMove={(e) => dragging.current && from(e)}
        onPointerUp={() => {
          if (!dragging.current) return;
          dragging.current = false;
          if (latest.current > 0.03) onRelease(latest.current);
        }}
        onPointerCancel={() => (dragging.current = false)}
        onKeyDown={(e) => {
          if (disabled) return;
          // the bar fills from the top (pull down = more power); arrows always mean up = more
          const step = ({ ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05 } as Record<string, number>)[e.key];
          if (step !== undefined) {
            e.preventDefault();
            onChange(Math.max(0, Math.min(1, value + step)));
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onRelease(value);
          }
        }}
      >
        <div className={`absolute bg-linear-to-b from-success via-warning to-danger ${vertical ? "inset-x-0 top-0" : "inset-y-0 left-0 bg-linear-to-r"}`} style={vertical ? { height: `${value * 100}%` } : { width: `${value * 100}%` }} />
        <div className={`absolute rounded-full bg-white shadow ${vertical ? "inset-x-1 h-2.5" : "inset-y-1 w-2.5"}`} style={vertical ? { top: `calc(${value * 100}% - 5px)` } : { left: `calc(${value * 100}% - 5px)` }} />
      </div>
      <span className="num text-xs font-bold tabular-nums">{Math.round(value * 100)}%</span>
    </div>
  );
}

/** Spin: tap the top of the cue ball for follow, the bottom for draw (engine spin −100…100). */
function SpinPicker({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled: boolean }) {
  const label = value > 0 ? t("pool.follow") : value < 0 ? t("pool.draw") : t("pool.centre");
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="label text-[0.625rem] text-on-glass-muted">{t("pool.spin")}</span>
      <button
        type="button"
        role="slider"
        aria-label={`${t("pool.spin")}: ${label}`}
        aria-orientation="vertical"
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={value}
        disabled={disabled}
        className="relative size-11 rounded-full bg-[radial-gradient(circle_at_40%_35%,#fff,#d9dadd_70%,#a9abb0)] shadow-inner ring-2 ring-white/25 disabled:opacity-40"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
          onChange(Math.max(-100, Math.min(100, Math.round((-dy * 100) / 20) * 20)));
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") onChange(Math.min(100, value + 20));
          else if (e.key === "ArrowDown") onChange(Math.max(-100, value - 20));
          else if (e.key === "Enter" || e.key === " ") onChange(value === 0 ? 60 : value > 0 ? -60 : 0);
          else return;
          e.preventDefault();
        }}
      >
        <span className="absolute left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-danger ring-2 ring-white" style={{ top: `${50 - value * 0.38}%` }} />
      </button>
      <span className="text-[0.625rem] font-semibold">{label}</span>
    </div>
  );
}

/** A button that repeats while held (fine aim on touch). */
function HoldButton({ children, onStep, disabled, label }: { children: React.ReactNode; onStep: () => void; disabled: boolean; label: string }) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className="btn-secondary grid size-10 place-items-center rounded-control disabled:opacity-40"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onStep();
        stop();
        timer.current = setInterval(onStep, 30);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          for (let i = 0; i < 4; i++) onStep();
        }
      }}
    >
      {children}
    </button>
  );
}


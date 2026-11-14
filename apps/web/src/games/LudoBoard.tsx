"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Star, Swords } from "lucide-react";
import { HOME, LAST_TRACK, SAFE_SQUARES, absoluteSquare, type LudoState } from "@gukirana/ludo";
import { BASE_ORIGIN, CENTRE_SIDE, HOME_COLUMN, SEAT_NAMES, TRACK_COORDS, TRIANGLE_CLIP, seatColors, tokenCell, type Side } from "./ludo-board";
import { SeatShape, DieIcon } from "@/ui/game-icons";
import { animScale, haptic, sfx, useAnimScale, useGamePrefs } from "./feedback";
import { shouldAutoFocus } from "./input";
import { Fist } from "./hands";
import { t } from "./i18n";

/** Paper fibre grain for the printed board (feTurbulence, no image download). */
const CARDBOARD_GRAIN = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9 0.35' numOctaves='3' seed='7'/><feColorMatrix values='0 0 0 0 0.45  0 0 0 0 0.36  0 0 0 0 0.25  0 0 0 0.9 0'/></filter><rect width='220' height='220' filter='url(%23n)'/></svg>",
).replace(/%2523/g, "%23")}")`;

const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
/** Base time per square of a token hop at Normal speed (scaled by the speed setting). */
export const STEP_MS = 120;
const TUMBLE_MS = 700;
const KNOCK_MS = 560;
const BURST = (100 / 15) * 1.6; // capture ring size, % of the board

/** Cube faces: value → which face of the cube carries it, and the cube rotation that brings it to the front. */
const FACE: Record<number, string> = { 1: "translateZ(var(--h))", 6: "rotateY(180deg) translateZ(var(--h))", 3: "rotateY(90deg) translateZ(var(--h))", 4: "rotateY(-90deg) translateZ(var(--h))", 2: "rotateX(90deg) translateZ(var(--h))", 5: "rotateX(-90deg) translateZ(var(--h))" };
const SHOW: Record<number, [number, number]> = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 2: [-90, 0], 5: [90, 0] };

/** How long the last event takes to show on this screen (die tumble, token hops, knock-back), at the current speed. */
export function ludoEventMs(s: LudoState): number {
  const k = animScale();
  const ev = s.lastEvent;
  if (!ev) return 0;
  if (ev.kind === "roll" || ev.kind === "pass") return TUMBLE_MS * k;
  const steps = ev.from === -1 ? 1 : ev.to - ev.from;
  return (steps * STEP_MS + (ev.captured.length ? KNOCK_MS : 0)) * k;
}

/**
 * Outcome-first die: a fist rattles it while the roll is requested, then throws; the cube tumbles and settles on the
 * value that came from the fair RNG (server or practice seed) — the animation never decides anything.
 * `rollId` changes on every new roll (state.rolls), so the opponent's rolls tumble too.
 */
export function Die({ value, rolling, color, rollId = 0 }: { value: number | null; rolling: boolean; color: string; rollId?: number }) {
  const k = useAnimScale();
  const [throwing, setThrowing] = useState(false);
  const spins = useRef(0);
  const lastId = useRef(rollId);
  const [rot, setRot] = useState<[number, number]>(SHOW[value ?? 1]!);
  useEffect(() => {
    if (!rolling) return;
    sfx.dice();
    haptic([12, 30, 12, 30, 12]);
  }, [rolling]);
  useEffect(() => {
    if (rollId === lastId.current || value === null) return;
    lastId.current = rollId;
    spins.current += 1;
    const [x, y] = SHOW[value]!;
    // whole extra turns make it tumble; alternating signs keep every throw looking different (deterministic)
    const n = spins.current;
    setRot([x + 360 * (2 + (n % 2)), y + 360 * (n % 2 ? -2 : 3)]);
    if (k > 0) {
      setThrowing(true);
      const tm = setTimeout(() => setThrowing(false), TUMBLE_MS * k);
      return () => clearTimeout(tm);
    }
  }, [rollId, value, k]);
  const v = value ?? 1;
  return (
    <div className="relative size-16 shrink-0" role="img" aria-label={rolling ? t("ludo.rolling") : t("ludo.dieShows", { n: v })}>
      <div
        className={`gk-die3d absolute inset-0 rounded-2xl ${throwing ? "gk-land" : ""} ${rolling ? "opacity-0" : ""}`}
        style={{ ["--gk-tumble" as string]: `${TUMBLE_MS * k}ms`, filter: "drop-shadow(0 8px 10px rgb(0 0 0 / .55))" }}
      >
        <div className="gk-cube" style={{ ["--h" as string]: "2rem", transform: `rotateX(${rot[0]}deg) rotateY(${rot[1]}deg)`, transition: k > 0 ? undefined : "none" }}>
          {[1, 2, 3, 4, 5, 6].map((f) => (
            <div key={f} className="gk-face" style={{ transform: FACE[f], outline: `3px solid ${color}`, outlineOffset: "-3px" }}>
              {Array.from({ length: 9 }, (_, i) => (
                <i key={i} className={PIPS[f]!.includes(i) ? "on" : ""} />
              ))}
            </div>
          ))}
        </div>
      </div>
      {/* the hand: rattles while rolling, flicks away on the throw */}
      {(rolling || throwing) && (
        <Fist
          className={`pointer-events-none absolute -right-3 -top-4 z-10 size-[4.6rem] ${rolling ? "gk-shake" : "gk-throw"}`}
          style={{ ["--gk-throw" as string]: `${Math.round(TUMBLE_MS * k * 0.45)}ms` }}
        />
      )}
    </div>
  );
}

/** Roll button + die + hint, shared by practice and live. The roll button takes focus on your roll (TV / pad). */
export function LudoControls({ die, rolling, color, canRoll, onRoll, hint, rollId }: { die: number | null; rolling: boolean; color: string; canRoll: boolean; onRoll: () => void; hint: string; rollId?: number }) {
  const btn = useRef<HTMLButtonElement>(null);
  const leftHanded = useGamePrefs((s) => s.leftHanded);
  useEffect(() => {
    if (canRoll && !rolling && shouldAutoFocus()) btn.current?.focus({ preventScroll: true });
  }, [canRoll, rolling]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !canRoll || rolling || document.querySelector('[aria-modal="true"]')) return;
      if (e.key === " " || e.key === "r" || e.key === "R") {
        e.preventDefault();
        onRoll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canRoll, onRoll, rolling]);
  return (
    <div className={`flex min-h-16 items-center justify-center gap-4 ${leftHanded ? "flex-row-reverse" : ""}`}>
      <Die value={die} rolling={rolling} color={color} rollId={rollId} />
      {canRoll ? (
        <button ref={btn} type="button" onClick={onRoll} disabled={rolling} className="btn-primary flex min-h-14 items-center gap-2 rounded-2xl px-8 font-display text-lg font-bold">
          <DieIcon size={20} /> {rolling ? t("ludo.rolling") : t("ludo.roll")}
          <kbd className="kbd ml-1 rounded px-1.5 text-xs max-sm:hidden">{t("game.keySpace")}</kbd>
        </button>
      ) : (
        <p className="max-w-[60vw] text-sm text-on-glass-muted" aria-live="polite">
          {hint}
        </p>
      )}
    </div>
  );
}

type Anim = { player: string; token: number; progress: number; captured: { player: string; token: number; progress: number }[] } | null;
const SHAPE_AT: Record<Side, [string, string]> = { top: ["50%", "17%"], right: ["83%", "50%"], bottom: ["50%", "83%"], left: ["17%", "50%"] };

/**
 * Printed Ludo board. Tokens are big (a full cell hit area), legal ones glow and show where they would land
 * (with a capture marker), moves hop square by square, captured tokens are knocked back to base spinning, a token
 * reaching home sets off a starburst in its colour. 1–4 move a token, arrows + Enter pick one.
 * Colours: every seat colour (yard, start square, home column, centre triangle, tokens, panels, die) comes from
 * one palette (`seatColors`), and the centre triangles are placed from the home columns (CENTRE_SIDE).
 */
export function LudoBoard({ state, movable, onMove, myId }: { state: LudoState; movable: number[]; onMove: (token: number) => void; myId: string }) {
  const colorBlind = useGamePrefs((s) => s.colorBlind);
  const hints = useGamePrefs((s) => s.hints);
  const confirmMove = useGamePrefs((s) => s.confirmMove);
  const k = useAnimScale();
  const colors = seatColors(colorBlind);
  const cells = useMemo(() => {
    const map = new Map<string, { bg: string; star?: boolean; start?: number }>();
    TRACK_COORDS.forEach(([r, c], i) => map.set(`${r},${c}`, { bg: i % 13 === 0 ? colors[i / 13]! : "#ffffff", star: SAFE_SQUARES.has(i) && i % 13 !== 0, start: i % 13 === 0 ? i / 13 : undefined }));
    HOME_COLUMN.forEach((col, s) => col.forEach(([r, c]) => map.set(`${r},${c}`, { bg: colors[s]! })));
    return map;
  }, [colors]);
  const me = state.players.find((p) => p.id === myId);
  const myTurn = state.players[state.turn]?.id === myId && !state.winner;
  const [focusTok, setFocusTok] = useState<number | null>(null);
  const [anim, setAnim] = useState<Anim>(null);
  const [burst, setBurst] = useState<{ id: number; r: number; c: number; color: string; home: boolean } | null>(null);
  const [knocked, setKnocked] = useState<string[]>([]);
  const [coarse, setCoarse] = useState(false);
  useEffect(() => setCoarse(window.matchMedia("(pointer: coarse)").matches), []);
  const lastEv = useRef(state.lastEvent);
  const playersRef = useRef(state.players);
  playersRef.current = state.players;
  const hop = useRef<ReturnType<typeof setInterval> | null>(null);
  const knockTm = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (hop.current) clearInterval(hop.current);
      if (knockTm.current) clearTimeout(knockTm.current);
    },
    [],
  );

  // hop the moved token along its path; captured tokens wait on the square until the mover lands
  useEffect(() => {
    const ev = state.lastEvent;
    if (ev === lastEv.current) return;
    lastEv.current = ev;
    if (!ev || ev.kind !== "move") return;
    if (hop.current) clearInterval(hop.current);
    const scale = animScale();
    const players = playersRef.current;
    const mover = players.find((p) => p.id === ev.player)!;
    const sq = ev.to <= LAST_TRACK ? absoluteSquare(mover.seat, ev.to) : -1;
    const captured = ev.captured.map((c) => {
      const seat = players.find((p) => p.id === c.player)!.seat;
      return { ...c, progress: (sq - seat * 13 + 52) % 52 };
    });
    const path = ev.from === -1 ? [0] : Array.from({ length: ev.to - ev.from }, (_, i) => ev.from + 1 + i);
    const land = () => {
      const [r, c] = tokenCell(mover.seat, ev.to, ev.token);
      if (captured.length) {
        setBurst({ id: Date.now(), r, c, color: "var(--color-danger)", home: false });
        setKnocked(captured.map((x) => `${x.player}-${x.token}`));
        if (knockTm.current) clearTimeout(knockTm.current);
        knockTm.current = setTimeout(() => setKnocked([]), KNOCK_MS * scale + 50);
        sfx.capture();
        haptic([40, 30, 80]);
      } else if (ev.to === HOME) {
        setBurst({ id: Date.now(), r, c, color: seatColors(useGamePrefs.getState().colorBlind)[mover.seat]!, home: true });
        sfx.win();
        haptic(40);
      }
    };
    if (scale === 0) {
      setAnim(null);
      land();
      return;
    }
    let i = 0;
    setAnim({ player: ev.player, token: ev.token, progress: path[0]!, captured });
    sfx.step();
    hop.current = setInterval(() => {
      i += 1;
      if (i >= path.length) {
        if (hop.current) clearInterval(hop.current);
        hop.current = null;
        setAnim(null);
        land();
        return;
      }
      sfx.step();
      setAnim({ player: ev.player, token: ev.token, progress: path[i]!, captured });
    }, STEP_MS * scale);
  }, [state.lastEvent]);

  // number keys move a token; on your move the first legal token takes focus (arrows cycle, Enter moves)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !myTurn || document.querySelector('[aria-modal="true"]')) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 4 && movable.includes(n - 1)) {
        e.preventDefault();
        onMove(n - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [movable, myTurn, onMove]);
  const board = useRef<HTMLDivElement>(null);
  const movKey = movable.join(",");
  useEffect(() => {
    if (!myTurn || !movable.length) return;
    if (shouldAutoFocus()) board.current?.querySelector<HTMLButtonElement>(`[data-token="${movable[0]}"]`)?.focus({ preventScroll: true });
  }, [movKey, myTurn]);

  const progressOf = (pid: string, tok: number, pos: number) => {
    if (anim?.player === pid && anim.token === tok) return anim.progress;
    const cap = anim?.captured.find((c) => c.player === pid && c.token === tok);
    return cap ? cap.progress : pos;
  };
  const all = state.players.flatMap((q) => q.tokens.map((qp, qt) => ({ q, qp: progressOf(q.id, qt, qp), qt })).map((x) => ({ ...x, cell: tokenCell(x.q.seat, x.qp, x.qt) })));

  // landing preview for the focused / hovered / first-tapped legal token
  const preview = (() => {
    if (!hints && !(confirmMove && coarse)) return null;
    if (focusTok === null || !me || !myTurn || !movable.includes(focusTok) || state.dice === null) return null;
    const from = me.tokens[focusTok]!;
    const to = from === -1 ? 0 : from + state.dice;
    const [r, c] = tokenCell(me.seat, to, focusTok);
    const sq = to <= LAST_TRACK ? absoluteSquare(me.seat, to) : -1;
    const hits = sq >= 0 && !SAFE_SQUARES.has(sq) && state.players.some((o) => o.id !== me.id && o.tokens.some((p) => p >= 0 && p <= LAST_TRACK && absoluteSquare(o.seat, p) === sq));
    return { r, c, hits };
  })();

  const pick = (tok: number) => {
    // touch with "tap twice": the first tap previews the landing square, the second plays
    if (confirmMove && coarse && focusTok !== tok && movable.length > 1) {
      setFocusTok(tok);
      return;
    }
    onMove(tok);
  };

  return (
    <div className="absolute inset-0 grid place-items-center @container-size">
      <div
        ref={board}
        data-game-board
        className="relative aspect-square overflow-hidden rounded-2xl border-4 border-ink-500 bg-[#f4efe6] shadow-2xl"
        style={{ width: "min(100cqw, 100cqh)" }}
        role="group"
        aria-label={t("ludo.title")}
      >
        <div className="grid h-full grid-cols-[repeat(15,1fr)] grid-rows-[repeat(15,1fr)]">
          {Array.from({ length: 225 }, (_, i) => {
            const cell = cells.get(`${Math.floor(i / 15)},${i % 15}`);
            return (
              <div key={i} className="grid place-items-center text-black/30" style={{ background: cell?.bg ?? "transparent", outline: cell ? "1px solid rgba(0,0,0,.12)" : undefined }}>
                {cell?.star && <Star className="size-[60%] fill-current" />}
                {colorBlind && cell?.start !== undefined && (
                  <span className="text-black/45">
                    <SeatShape seat={cell.start} size={14} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {BASE_ORIGIN.map(([r, c], s) => (
          <div key={s} className="absolute grid place-items-center rounded-xl" style={{ top: `${(r / 15) * 100}%`, left: `${(c / 15) * 100}%`, width: "40%", height: "40%", background: colors[s] }}>
            <div className="grid size-[72%] place-items-center rounded-xl bg-white/90 shadow-inner">
              <span className="flex flex-col items-center gap-0.5 text-[0.625rem] font-bold uppercase tracking-wider text-black/35 sm:text-xs">
                {colorBlind && (
                  <span style={{ color: colors[s] }} className="drop-shadow-[0_0_1px_rgba(0,0,0,.6)]">
                    <SeatShape seat={s} size={14} />
                  </span>
                )}
                {SEAT_NAMES[s]}
              </span>
            </div>
          </div>
        ))}
        {/* centre: each seat's triangle on the side its home column enters from */}
        <div className="absolute" style={{ top: "40%", left: "40%", width: "20%", height: "20%" }}>
          {CENTRE_SIDE.map((side, s) => (
            <div key={s} data-centre={SEAT_NAMES[s]} data-side={side} className="absolute inset-0" style={{ background: colors[s], clipPath: TRIANGLE_CLIP[side] }} />
          ))}
          {colorBlind &&
            CENTRE_SIDE.map((side, s) => (
              <span key={s} className="absolute -translate-x-1/2 -translate-y-1/2 text-black/45" style={{ left: SHAPE_AT[side][0], top: SHAPE_AT[side][1] }}>
                <SeatShape seat={s} size={12} />
              </span>
            ))}
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.32] mix-blend-multiply" style={{ backgroundImage: CARDBOARD_GRAIN, backgroundSize: "220px 220px" }} />
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(255,255,255,.16) 0%, rgba(255,255,255,0) 40%, rgba(0,0,0,0) 70%, rgba(0,0,0,.08) 100%)" }} />

        {preview && (
          <div className="pointer-events-none absolute z-10 grid place-items-center" style={{ width: `${100 / 15}%`, height: `${100 / 15}%`, top: `${(preview.r / 15) * 100}%`, left: `${(preview.c / 15) * 100}%` }}>
            <span className="absolute inset-[6%] rounded-full border-[3px] border-dashed" style={{ borderColor: colors[me!.seat] }} />
            {preview.hits && <Swords className="relative size-[60%] text-danger drop-shadow" />}
          </div>
        )}
        {burst && (
          <span key={burst.id} aria-hidden className="pointer-events-none absolute z-30" style={{ width: `${BURST}%`, height: `${BURST}%`, top: `${((burst.r + 0.5) / 15) * 100 - BURST / 2}%`, left: `${((burst.c + 0.5) / 15) * 100 - BURST / 2}%` }}>
            {burst.home && <span className="gk-rays absolute -inset-[120%] rounded-full" style={{ ["--gk-ray" as string]: burst.color }} />}
            <span className="gk-burst absolute inset-0 rounded-full border-4" style={{ borderColor: burst.color }} />
          </span>
        )}

        {all.map(({ q: p, qp, qt: tok, cell: [r, c] }) => {
          const canMove = p.id === myId && myTurn && movable.includes(tok) && !anim;
          const stack = all.filter((x) => x.cell[0] === r && x.cell[1] === c);
          const idx = stack.findIndex((x) => x.q.id === p.id && x.qt === tok);
          const off = stack.length > 1 ? (idx - (stack.length - 1) / 2) * 0.22 : 0;
          const moving = anim?.player === p.id && anim.token === tok;
          const isKnocked = knocked.includes(`${p.id}-${tok}`);
          const glow = canMove && hints;
          return (
            <button
              key={`${p.id}-${tok}`}
              type="button"
              data-token={p.id === myId ? tok : undefined}
              disabled={!canMove}
              onClick={() => pick(tok)}
              onFocus={() => setFocusTok(tok)}
              onBlur={() => setFocusTok((f) => (f === tok ? null : f))}
              onPointerEnter={(e) => canMove && e.pointerType === "mouse" && setFocusTok(tok)}
              onPointerLeave={(e) => e.pointerType === "mouse" && setFocusTok((f) => (f === tok ? null : f))}
              className={`absolute grid place-items-center rounded-full transition-[top,left] ${isKnocked ? "ease-in" : "ease-out"} ${canMove ? "z-20 cursor-pointer" : moving || isKnocked ? "z-30" : "z-10"}`}
              style={{
                // the hit area is a whole cell (big thumb target); the token art sits inside it
                width: `${100 / 15}%`,
                height: `${100 / 15}%`,
                top: `${((r + off * 0.3) / 15) * 100}%`,
                left: `${((c + off) / 15) * 100}%`,
                transitionDuration: moving ? `${Math.max(0, STEP_MS * k - 10)}ms` : isKnocked ? `${KNOCK_MS * k}ms` : `${300 * k}ms`,
              }}
              aria-label={`${SEAT_NAMES[p.seat]} token ${tok + 1}${p.id === me?.id ? " (yours)" : ""}${canMove ? ", can move" : ""}${qp === HOME ? ", home" : ""}`}
            >
              <span
                key={moving ? `hop-${anim!.progress}` : isKnocked ? "knock" : "still"}
                className={`grid size-[80%] place-items-center rounded-full border-2 border-white text-white/90 shadow-[0_3px_6px_rgba(0,0,0,.5)] ${glow ? "gk-legal scale-110" : ""} ${moving ? "gk-hop" : ""} ${isKnocked ? "gk-knock" : ""} ${qp === HOME ? "scale-75" : ""} ${focusTok === tok && canMove && !hints ? "ring-4 ring-white" : ""}`}
                style={{ background: colors[p.seat], transition: "transform .15s", ["--gk-step" as string]: `${STEP_MS * k}ms`, ["--gk-knock" as string]: `${KNOCK_MS * k}ms` }}
              >
                <SeatShape seat={p.seat} size={colorBlind ? 13 : 10} />
                {glow && <span className="num absolute -right-1 -top-1 grid size-[45%] place-items-center rounded-full bg-black/80 text-[0.55rem] font-bold text-white max-sm:hidden">{tok + 1}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SeatLabel({ seat, home }: { seat: number; home: number }) {
  const colorBlind = useGamePrefs((s) => s.colorBlind);
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold">
      <span style={{ color: seatColors(colorBlind)[seat] }}>
        <SeatShape seat={seat} size={11} />
      </span>
      {SEAT_NAMES[seat]} · {t("ludo.home", { n: home })}
    </p>
  );
}

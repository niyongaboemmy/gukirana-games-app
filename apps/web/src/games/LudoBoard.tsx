"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Star, Swords } from "lucide-react";
import { HOME, LAST_TRACK, SAFE_SQUARES, absoluteSquare, type LudoState } from "@gukirana/ludo";
import { BASE_ORIGIN, HOME_COLUMN, SEAT_COLORS, SEAT_NAMES, TRACK_COORDS, tokenCell } from "./ludo-board";
import { SeatShape, DieIcon } from "@/ui/game-icons";
import { haptic, reducedMotion, sfx } from "./feedback";
import { shouldAutoFocus } from "./input";
import { t } from "./i18n";

/** Paper fibre grain for the printed board (feTurbulence, no image download). */
const CARDBOARD_GRAIN = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9 0.35' numOctaves='3' seed='7'/><feColorMatrix values='0 0 0 0 0.45  0 0 0 0 0.36  0 0 0 0 0.25  0 0 0 0.9 0'/></filter><rect width='220' height='220' filter='url(%23n)'/></svg>",
).replace(/%2523/g, "%23")}")`;

const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
export const STEP_MS = 120;
const BURST = (100 / 15) * 1.6; // capture ring size, % of the board

/** Outcome-first die: the tumble is cosmetic, the value always comes from the fair RNG (server or practice seed). */
export function Die({ value, rolling, color }: { value: number | null; rolling: boolean; color: string }) {
  const [face, setFace] = useState(1);
  useEffect(() => {
    if (!rolling) return;
    sfx.dice();
    haptic([12, 30, 12, 30, 12]);
    let i = 0;
    const id = setInterval(() => setFace(((i++ * 5) % 6) + 1), 70);
    return () => clearInterval(id);
  }, [rolling]);
  const v = rolling ? face : (value ?? 1);
  return (
    <div
      role="img"
      className={`grid size-16 shrink-0 grid-cols-3 grid-rows-3 gap-0.5 rounded-2xl bg-white p-2.5 shadow-[0_8px_20px_-4px_rgba(0,0,0,.6)] ${rolling ? "gk-die-roll" : ""}`}
      style={{ outline: `3px solid ${color}` }}
      aria-label={rolling ? t("ludo.rolling") : `Die showing ${v}`}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={`rounded-full ${PIPS[v]!.includes(i) ? "bg-[#1b1b1b]" : ""}`} />
      ))}
    </div>
  );
}

/** Roll button + die + hint, shared by practice and live. The roll button takes focus on your roll (TV / pad). */
export function LudoControls({ die, rolling, color, canRoll, onRoll, hint }: { die: number | null; rolling: boolean; color: string; canRoll: boolean; onRoll: () => void; hint: string }) {
  const btn = useRef<HTMLButtonElement>(null);
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
    <div className="flex min-h-16 items-center justify-center gap-4">
      <Die value={die} rolling={rolling} color={color} />
      {canRoll ? (
        <button
          ref={btn}
          type="button"
          onClick={onRoll}
          disabled={rolling}
          className="press flex min-h-14 items-center gap-2 rounded-2xl bg-game-ludo px-8 font-display text-lg font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255/.3),0_10px_24px_-10px_rgb(255_138_31/.8)]"
        >
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

/**
 * Printed Ludo board. Tokens are big (a full cell hit area), legal ones glow and show where they would land
 * (with a capture marker), moves hop square by square, captures burst. 1–4 move a token, arrows + Enter pick one.
 */
export function LudoBoard({ state, movable, onMove, myId }: { state: LudoState; movable: number[]; onMove: (token: number) => void; myId: string }) {
  const cells = useMemo(() => {
    const map = new Map<string, { bg: string; star?: boolean }>();
    TRACK_COORDS.forEach(([r, c], i) => map.set(`${r},${c}`, { bg: i % 13 === 0 ? SEAT_COLORS[i / 13]! : "#ffffff", star: SAFE_SQUARES.has(i) && i % 13 !== 0 }));
    HOME_COLUMN.forEach((col, s) => col.forEach(([r, c]) => map.set(`${r},${c}`, { bg: SEAT_COLORS[s]! })));
    return map;
  }, []);
  const me = state.players.find((p) => p.id === myId);
  const myTurn = state.players[state.turn]?.id === myId && !state.winner;
  const [focusTok, setFocusTok] = useState<number | null>(null);
  const [anim, setAnim] = useState<Anim>(null);
  const [burst, setBurst] = useState<{ id: number; r: number; c: number } | null>(null);
  const lastEv = useRef(state.lastEvent);
  const playersRef = useRef(state.players);
  playersRef.current = state.players;
  const hop = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => void (hop.current && clearInterval(hop.current)), []);

  // hop the moved token along its path; captured tokens wait on the square until the mover lands
  useEffect(() => {
    const ev = state.lastEvent;
    if (ev === lastEv.current) return;
    lastEv.current = ev;
    if (!ev || ev.kind !== "move") return;
    if (hop.current) clearInterval(hop.current);
    const players = playersRef.current;
    const mover = players.find((p) => p.id === ev.player)!;
    const sq = ev.to <= LAST_TRACK ? absoluteSquare(mover.seat, ev.to) : -1;
    const captured = ev.captured.map((c) => {
      const seat = players.find((p) => p.id === c.player)!.seat;
      return { ...c, progress: (sq - seat * 13 + 52) % 52 };
    });
    const path = ev.from === -1 ? [0] : Array.from({ length: ev.to - ev.from }, (_, i) => ev.from + 1 + i);
    const land = () => {
      if (captured.length) {
        const [r, c] = tokenCell(mover.seat, ev.to, ev.token);
        setBurst({ id: Date.now(), r, c });
        sfx.capture();
        haptic([40, 30, 80]);
      } else if (ev.to === HOME) {
        sfx.win();
        haptic(40);
      }
    };
    if (reducedMotion()) {
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
    }, STEP_MS);
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

  // landing preview for the focused / hovered legal token
  const preview = (() => {
    if (focusTok === null || !me || !myTurn || !movable.includes(focusTok) || state.dice === null) return null;
    const from = me.tokens[focusTok]!;
    const to = from === -1 ? 0 : from + state.dice;
    const [r, c] = tokenCell(me.seat, to, focusTok);
    const sq = to <= LAST_TRACK ? absoluteSquare(me.seat, to) : -1;
    const hits = sq >= 0 && !SAFE_SQUARES.has(sq) && state.players.some((o) => o.id !== me.id && o.tokens.some((p) => p >= 0 && p <= LAST_TRACK && absoluteSquare(o.seat, p) === sq));
    return { r, c, hits };
  })();

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
              </div>
            );
          })}
        </div>
        {BASE_ORIGIN.map(([r, c], s) => (
          <div key={s} className="absolute grid place-items-center rounded-xl" style={{ top: `${(r / 15) * 100}%`, left: `${(c / 15) * 100}%`, width: "40%", height: "40%", background: SEAT_COLORS[s] }}>
            <div className="grid size-[72%] place-items-center rounded-xl bg-white/90 shadow-inner">
              <span className="text-[0.625rem] font-bold uppercase tracking-wider text-black/35 sm:text-xs">{SEAT_NAMES[s]}</span>
            </div>
          </div>
        ))}
        <div className="absolute" style={{ top: "40%", left: "40%", width: "20%", height: "20%", background: `conic-gradient(from 45deg, ${SEAT_COLORS[1]} 0 90deg, ${SEAT_COLORS[2]} 0 180deg, ${SEAT_COLORS[3]} 0 270deg, ${SEAT_COLORS[0]} 0 360deg)` }} />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.32] mix-blend-multiply" style={{ backgroundImage: CARDBOARD_GRAIN, backgroundSize: "220px 220px" }} />
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(255,255,255,.16) 0%, rgba(255,255,255,0) 40%, rgba(0,0,0,0) 70%, rgba(0,0,0,.08) 100%)" }} />

        {preview && (
          <div className="pointer-events-none absolute z-10 grid place-items-center" style={{ width: `${100 / 15}%`, height: `${100 / 15}%`, top: `${(preview.r / 15) * 100}%`, left: `${(preview.c / 15) * 100}%` }}>
            <span className="absolute inset-[6%] rounded-full border-[3px] border-dashed" style={{ borderColor: SEAT_COLORS[me!.seat] }} />
            {preview.hits && <Swords className="relative size-[60%] text-danger drop-shadow" />}
          </div>
        )}
        {burst && (
          <span
            key={burst.id}
            aria-hidden
            className="gk-burst pointer-events-none absolute z-30 rounded-full border-4 border-danger"
            style={{ width: `${BURST}%`, height: `${BURST}%`, top: `${((burst.r + 0.5) / 15) * 100 - BURST / 2}%`, left: `${((burst.c + 0.5) / 15) * 100 - BURST / 2}%` }}
          />
        )}

        {all.map(({ q: p, qp, qt: tok, cell: [r, c] }) => {
          const canMove = p.id === myId && myTurn && movable.includes(tok) && !anim;
          const stack = all.filter((x) => x.cell[0] === r && x.cell[1] === c);
          const k = stack.findIndex((x) => x.q.id === p.id && x.qt === tok);
          const off = stack.length > 1 ? (k - (stack.length - 1) / 2) * 0.22 : 0;
          const moving = anim?.player === p.id && anim.token === tok;
          return (
            <button
              key={`${p.id}-${tok}`}
              type="button"
              data-token={p.id === myId ? tok : undefined}
              disabled={!canMove}
              onClick={() => onMove(tok)}
              onFocus={() => setFocusTok(tok)}
              onBlur={() => setFocusTok((f) => (f === tok ? null : f))}
              onPointerEnter={() => canMove && setFocusTok(tok)}
              onPointerLeave={() => setFocusTok((f) => (f === tok ? null : f))}
              className={`absolute grid place-items-center rounded-full transition-[top,left] ease-out ${canMove ? "z-20 cursor-pointer" : moving ? "z-30" : "z-10"}`}
              style={{
                // the hit area is a whole cell (big thumb target); the token art sits inside it
                width: `${100 / 15}%`,
                height: `${100 / 15}%`,
                top: `${((r + off * 0.3) / 15) * 100}%`,
                left: `${((c + off) / 15) * 100}%`,
                transitionDuration: moving ? `${STEP_MS - 10}ms` : "300ms",
              }}
              aria-label={`${SEAT_NAMES[p.seat]} token ${tok + 1}${p.id === me?.id ? " (yours)" : ""}${canMove ? ", can move" : ""}${qp === HOME ? ", home" : ""}`}
            >
              <span
                className={`grid size-[80%] place-items-center rounded-full border-2 border-white text-white/90 shadow-[0_3px_6px_rgba(0,0,0,.5)] ${canMove ? "gk-legal scale-110" : ""} ${moving ? "scale-125" : ""} ${qp === HOME ? "scale-75" : ""}`}
                style={{ background: SEAT_COLORS[p.seat], transition: "transform .15s" }}
              >
                <SeatShape seat={p.seat} size={10} />
                {canMove && <span className="num absolute -right-1 -top-1 grid size-[45%] place-items-center rounded-full bg-black/80 text-[0.55rem] font-bold text-white max-sm:hidden">{tok + 1}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SeatLabel({ seat, home }: { seat: number; home: number }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold">
      <span style={{ color: SEAT_COLORS[seat] }}>
        <SeatShape seat={seat} size={11} />
      </span>
      {SEAT_NAMES[seat]} · {t("ludo.home", { n: home })}
    </p>
  );
}

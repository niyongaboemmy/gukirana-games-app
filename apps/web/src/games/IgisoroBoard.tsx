"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { playIgisoro, type IgisoroState } from "@gukirana/igisoro";
import { haptic, reducedMotion, sfx } from "./feedback";
import { shouldAutoFocus } from "./input";
import { t } from "./i18n";

type Side = 0 | 1;
export type Cell = { side: Side; idx: number };
export interface SowPreview {
  end: Cell;
  captures: Cell[];
  gain: number;
}

/** Rows from the viewer's side: opponent outer, opponent inner, my inner, my outer (engine facing rules). */
export function rowsFor(me: Side): Cell[][] {
  const opp = (1 - me) as Side;
  return [
    Array.from({ length: 8 }, (_, c) => ({ side: opp, idx: 8 + c })),
    Array.from({ length: 8 }, (_, c) => ({ side: opp, idx: 7 - c })),
    Array.from({ length: 8 }, (_, c) => ({ side: me, idx: c })),
    Array.from({ length: 8 }, (_, c) => ({ side: me, idx: 15 - c })),
  ];
}

/** What a move would do: where the last seed lands, which pits it captures, seeds gained. */
export function previewMove(s: IgisoroState, pit: number): SowPreview {
  const next = playIgisoro(s, pit);
  const me = s.turn;
  let end: Cell = { side: me, idx: pit };
  const captures: Cell[] = [];
  for (const e of next.lastEvents) {
    if (e.kind === "sow") end = { side: e.player, idx: e.pit };
    if (e.kind === "capture") for (const p of e.pits) captures.push({ side: e.from, idx: p });
  }
  const sum = (x: IgisoroState, side: Side) => x.pits[side].reduce((a, b) => a + b, 0);
  return { end, captures, gain: sum(next, me) - sum(s, me) };
}

function Seeds({ n }: { n: number }) {
  const shown = Math.min(n, 12);
  return (
    <div className="pointer-events-none absolute inset-[18%] flex flex-wrap content-center items-center justify-center gap-[2px]">
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} className="block size-[22%] rounded-full shadow-[inset_-1px_-2px_2px_rgba(0,0,0,.45)]" style={{ background: `radial-gradient(circle at 35% 30%, #f3e3c3, ${i % 3 ? "#8a5a2b" : "#6e4420"})` }} />
      ))}
    </div>
  );
}

/** Replays sowing events pit by pit (DESIGN-SPEC §11.4): the hand travels with its seed count, captures flash. */
export function useSowAnimation(speed: number) {
  const [view, setView] = useState<[number[], number[]] | null>(null);
  const [hl, setHl] = useState<Cell | null>(null);
  const [hand, setHand] = useState(0);
  const [captured, setCaptured] = useState<Cell[]>([]);
  const [lastCapture, setLastCapture] = useState<{ id: number; seeds: number } | null>(null);
  const [animating, setAnimating] = useState(false);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const animate = useCallback(
    (from: IgisoroState, next: IgisoroState) =>
      new Promise<void>((resolve) => {
        const ev = next.lastEvents;
        if (reducedMotion() || speedRef.current <= 0) {
          const cap = ev.filter((e) => e.kind === "capture").reduce((a, e) => a + (e.kind === "capture" ? e.seeds : 0), 0);
          if (cap) setLastCapture({ id: Date.now(), seeds: cap });
          resolve();
          return;
        }
        setAnimating(true);
        const pits: [number[], number[]] = [[...from.pits[0]], [...from.pits[1]]];
        let i = 0;
        let inHand = 0;
        const tick = () => {
          const e = ev[i++];
          if (!e) {
            setView(null);
            setHl(null);
            setHand(0);
            setCaptured([]);
            setAnimating(false);
            resolve();
            return;
          }
          let wait = speedRef.current;
          if (e.kind === "pickup") {
            pits[e.player][e.pit] = 0;
            inHand = e.seeds;
            setHl({ side: e.player, idx: e.pit });
            wait = speedRef.current * 1.6;
          } else if (e.kind === "sow") {
            pits[e.player][e.pit]! += 1;
            inHand = Math.max(0, inHand - 1);
            setHl({ side: e.player, idx: e.pit });
            sfx.seed();
          } else {
            const cells = e.pits.map((p) => ({ side: e.from, idx: p }));
            for (const p of e.pits) pits[e.from][p] = 0;
            inHand = e.seeds;
            setCaptured(cells);
            setHl(cells[0]!);
            setLastCapture({ id: Date.now(), seeds: e.seeds });
            sfx.capture();
            haptic([30, 40, 60]);
            wait = speedRef.current * 5;
          }
          setHand(inHand);
          setView([[...pits[0]], [...pits[1]]]);
          // long relay chains (a hundred+ steps) speed up so a move never plays for more than ~6 s
          setTimeout(tick, wait * Math.min(1, 50 / ev.length));
        };
        tick();
      }),
    [],
  );
  return { view, hl, hand, captured, lastCapture, animating, animate };
}

export function IgisoroBoard({
  pits,
  me,
  legal,
  hl,
  hand = 0,
  captured = [],
  preview = null,
  selected,
  autoFocus = false,
  onHover,
  onPick,
}: {
  pits: [number[], number[]];
  me: Side;
  legal: number[];
  hl: Cell | null;
  hand?: number;
  captured?: Cell[];
  preview?: SowPreview | null;
  selected: number | null;
  autoFocus?: boolean;
  onHover?: (pit: number | null) => void;
  onPick: (pit: number) => void;
}) {
  const board = useRef<HTMLDivElement>(null);
  const [handPos, setHandPos] = useState<{ x: number; y: number } | null>(null);
  const same = (a: Cell | null | undefined, b: Cell) => !!a && a.side === b.side && a.idx === b.idx;

  // the travelling hand follows the highlighted pit
  useLayoutEffect(() => {
    if (!hl || !board.current) return setHandPos(null);
    const el = board.current.querySelector<HTMLElement>(`[data-pit="${hl.side}-${hl.idx}"]`);
    if (!el) return;
    const b = board.current.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setHandPos({ x: ((r.left + r.width / 2 - b.left) / b.width) * 100, y: ((r.top - b.top) / b.height) * 100 });
  }, [hl]);

  // your move: the first legal pit takes focus (arrows move between pits, Enter plays)
  const legalKey = legal.join(",");
  useEffect(() => {
    if (!autoFocus || !legal.length) return;
    const act = document.activeElement;
    if (act && board.current?.contains(act)) return;
    if (shouldAutoFocus()) board.current?.querySelector<HTMLButtonElement>(`[data-pit="${me}-${legal[0]}"]`)?.focus({ preventScroll: true });
  }, [autoFocus, legalKey, me]);

  return (
    <div className="absolute inset-0 grid place-items-center @container-size">
      <div
        ref={board}
        data-game-board
        className="relative aspect-[2/1] rounded-[28px] border-[6px] border-[#4a2e17] p-[2.2%] shadow-[0_20px_60px_-10px_rgba(0,0,0,.8),inset_0_2px_0_rgba(255,255,255,.15)]"
        style={{ width: "min(100cqw, 200cqh)", background: "repeating-linear-gradient(95deg,#9a6534 0 18px,#8b5a2d 18px 30px,#a36d3a 30px 44px)" }}
        role="group"
        aria-label={t("igisoro.title")}
      >
        {/* four equal pit rows; the centre line is its own thin row between the two sides */}
        <div className="grid h-full grid-rows-[1fr_1fr_auto_1fr_1fr] gap-y-[2.4%]">
          {rowsFor(me).flatMap((row, r) => [
            ...(r === 2 ? [<div key="divider" aria-hidden className="mx-[1%] h-0 border-t-[3px] border-dashed border-[#5a3416]/55" />] : []),
            <div key={r} className="grid min-h-0 grid-cols-8 gap-x-[2%]">
              {row.map((cell) => {
                const n = pits[cell.side][cell.idx]!;
                const isLegal = cell.side === me && legal.includes(cell.idx);
                const isHl = same(hl, cell);
                const isSel = cell.side === me && selected === cell.idx;
                const isCap = captured.some((c) => same(c, cell));
                const isEnd = !!preview && same(preview.end, cell);
                const willCap = !!preview && preview.captures.some((c) => same(c, cell));
                const ring = isCap
                  ? undefined
                  : isHl
                    ? "0 0 0 3px #FFC83D, 0 0 18px #FFC83D"
                    : isSel
                      ? "0 0 0 3px #22C55E, 0 0 16px #22C55E"
                      : willCap
                        ? "0 0 0 3px #ef4444, inset 0 4px 10px rgba(0,0,0,.6)"
                        : isEnd
                          ? "0 0 0 3px rgba(255,255,255,.9), inset 0 4px 10px rgba(0,0,0,.6)"
                          : isLegal
                            ? "0 0 0 2px rgba(124,255,170,.7), inset 0 4px 10px rgba(0,0,0,.6)"
                            : "inset 0 4px 10px rgba(0,0,0,.6)";
                return (
                  <button
                    key={`${cell.side}-${cell.idx}`}
                    type="button"
                    data-pit={`${cell.side}-${cell.idx}`}
                    disabled={!isLegal}
                    onMouseEnter={() => isLegal && onHover?.(cell.idx)}
                    onMouseLeave={() => onHover?.(null)}
                    // keyboard / remote / pad focus previews; a touch tap must not (tap = preview, second tap = play)
                    onFocus={() => isLegal && document.documentElement.dataset.input === "key" && onHover?.(cell.idx)}
                    onClick={() => onPick(cell.idx)}
                    className={`relative aspect-square w-[92%] max-h-full self-center justify-self-center rounded-full transition-all duration-150 ${isLegal ? "cursor-pointer hover:scale-105" : "cursor-default"} ${isCap ? "gk-captured" : ""}`}
                    style={{ background: "radial-gradient(circle at 50% 40%, #3b2410 0%, #5a3818 60%, #7a4c22 100%)", boxShadow: ring }}
                    aria-label={`${cell.side === me ? "Your" : "Opponent"} pit with ${n} seeds${isLegal ? ", playable" : ""}${willCap ? ", would be captured" : ""}`}
                  >
                    <Seeds n={n} />
                    <span className="num absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-black/75 px-1 text-[0.625rem] font-bold tabular-nums text-white sm:text-xs">{n}</span>
                  </button>
                );
              })}
            </div>,
          ])}
        </div>
        {/* the sowing hand: a seed and the count still in hand, gliding pit to pit */}
        {handPos && hand > 0 && (
          <div aria-hidden className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full transition-[left,top] duration-100 ease-out" style={{ left: `${handPos.x}%`, top: `${handPos.y}%` }}>
            <div className="num flex items-center gap-1 rounded-full bg-black/80 px-2 py-0.5 text-xs font-bold text-white shadow-lg ring-1 ring-[#FFC83D]/70">
              <span className="block size-2.5 rounded-full" style={{ background: "radial-gradient(circle at 35% 30%, #f3e3c3, #8a5a2b)" }} />
              {hand}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

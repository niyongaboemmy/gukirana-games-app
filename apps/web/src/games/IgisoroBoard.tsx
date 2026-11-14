"use client";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { playIgisoro, type IgisoroState } from "@gukirana/igisoro";
import { animScale, haptic, sfx, useGamePrefs } from "./feedback";
import { shouldAutoFocus } from "./input";
import { SKIN, SowingHand } from "./hands";
import { t } from "./i18n";

type Side = 0 | 1;
export type Cell = { side: Side; idx: number };
export interface SowPreview {
  end: Cell;
  captures: Cell[];
  gain: number;
}
/** What the hand is doing on the current animation step. */
export type HandStep = { id: number; kind: "pickup" | "sow" | "capture"; owner: Side; cell: Cell } | null;

/** Base time per sown seed at Normal speed (scaled by the speed setting; 0 = skip). */
export const SOW_MS = 170;

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

/** Seed spots inside a pit (percent): a golden-angle heap with a fixed per-seed wobble, so piles look natural and never move. */
const SPOTS = Array.from({ length: 16 }, (_, i) => {
  const a = i * 2.39996 + 0.7;
  const r = i === 0 ? 0 : 9 + Math.sqrt(i / 15) * 21;
  const wob = ((i * 37) % 11) - 5; // deterministic jitter (no Math.random)
  return { x: 50 + Math.cos(a) * r + wob * 0.35, y: 50 + Math.sin(a) * r * 0.92 - wob * 0.25, rot: (i * 47) % 180, dark: i % 3 === 0 };
});

const Seeds = memo(function Seeds({ n, drop }: { n: number; drop: number }) {
  const shown = Math.min(n, 16);
  return (
    <div className="pointer-events-none absolute inset-[12%]">
      {Array.from({ length: shown }, (_, i) => {
        const s = SPOTS[i]!;
        const fresh = drop > 0 && i === shown - 1;
        return (
          <span
            key={fresh ? `d${drop}` : i}
            className={`absolute block h-[22%] w-[17%] rounded-[50%] shadow-[inset_-1px_-2px_2px_rgba(0,0,0,.45),0_1px_1px_rgba(0,0,0,.4)] ${fresh ? "gk-seed-new" : ""}`}
            style={{ left: `${s.x - 8.5}%`, top: `${s.y - 11}%`, rotate: `${s.rot}deg`, background: `radial-gradient(circle at 35% 30%, #f3e3c3, ${s.dark ? "#6e4420" : "#8a5a2b"})` }}
          />
        );
      })}
    </div>
  );
});

/**
 * Replays the engine's sowing events pit by pit (DESIGN-SPEC §11.4): the mover's hand scoops the pit, drops one seed
 * per pit (each seed falls and settles), and sweeps both captured pits before sowing the catch on. The event log
 * replays to exactly the engine's board (tested in the igisoro package). Speed follows the game settings.
 */
export function useSowAnimation() {
  const [view, setView] = useState<[number[], number[]] | null>(null);
  const [hl, setHl] = useState<Cell | null>(null);
  const [hand, setHand] = useState(0);
  const [step, setStep] = useState<HandStep>(null);
  const [captured, setCaptured] = useState<Cell[]>([]);
  const [lastCapture, setLastCapture] = useState<{ id: number; seeds: number } | null>(null);
  const [animating, setAnimating] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const animate = useCallback(
    (from: IgisoroState, next: IgisoroState) =>
      new Promise<void>((resolve) => {
        const ev = next.lastEvents;
        const base = SOW_MS * animScale();
        if (base <= 0) {
          const cap = ev.reduce((a, e) => a + (e.kind === "capture" ? e.seeds : 0), 0);
          if (cap) setLastCapture({ id: Date.now(), seeds: cap });
          resolve();
          return;
        }
        // expand captures into one scoop per pit
        type Step = { kind: "pickup" | "sow" | "capture"; owner: Side; cell: Cell; seeds?: number; total?: number };
        const steps: Step[] = [];
        for (const e of ev) {
          if (e.kind === "pickup") steps.push({ kind: "pickup", owner: e.player, cell: { side: e.player, idx: e.pit }, seeds: e.seeds });
          else if (e.kind === "sow") steps.push({ kind: "sow", owner: e.player, cell: { side: e.player, idx: e.pit } });
          else e.pits.forEach((p, k) => steps.push({ kind: "capture", owner: (1 - e.from) as Side, cell: { side: e.from, idx: p }, total: k === e.pits.length - 1 ? e.seeds : undefined }));
        }
        setAnimating(true);
        const pits: [number[], number[]] = [[...from.pits[0]], [...from.pits[1]]];
        let i = 0;
        let inHand = 0;
        // long relay chains (a hundred+ steps) speed up so a move never plays for more than ~6 s at Normal
        const pace = Math.min(1, 55 / Math.max(1, steps.length));
        const tick = () => {
          const st = steps[i];
          const id = ++i;
          if (!st) {
            setView(null);
            setHl(null);
            setHand(0);
            setStep(null);
            setCaptured([]);
            setAnimating(false);
            resolve();
            return;
          }
          let wait = base;
          if (st.kind === "pickup") {
            pits[st.cell.side][st.cell.idx] = 0;
            inHand = st.seeds!;
            wait = base * 1.7;
          } else if (st.kind === "sow") {
            pits[st.cell.side][st.cell.idx]! += 1;
            inHand = Math.max(0, inHand - 1);
            sfx.seed();
          } else {
            inHand += pits[st.cell.side][st.cell.idx]!;
            pits[st.cell.side][st.cell.idx] = 0;
            setCaptured((c) => [...c, st.cell]);
            if (st.total !== undefined) {
              setLastCapture({ id: Date.now(), seeds: st.total });
              sfx.capture();
              haptic([30, 40, 60]);
            }
            wait = base * 2.6;
          }
          setHl(st.cell);
          setStep({ id, kind: st.kind, owner: st.owner, cell: st.cell });
          setHand(inHand);
          setView([[...pits[0]], [...pits[1]]]);
          timer.current = setTimeout(tick, wait * pace);
        };
        tick();
      }),
    [],
  );
  return { view, hl, hand, step, captured, lastCapture, animating, animate };
}

/** Touch with "tap twice to confirm": the first tap previews, the second plays (mouse hover is the first "tap"). */
export function useConfirmTap(): boolean {
  const confirm = useGamePrefs((s) => s.confirmMove);
  const [coarse, setCoarse] = useState(false);
  useEffect(() => setCoarse(window.matchMedia("(pointer: coarse)").matches), []);
  return confirm && coarse;
}

export function IgisoroBoard({
  pits,
  me,
  legal,
  hl,
  hand = 0,
  step = null,
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
  step?: HandStep;
  captured?: Cell[];
  preview?: SowPreview | null;
  selected: number | null;
  autoFocus?: boolean;
  onHover?: (pit: number | null) => void;
  onPick: (pit: number) => void;
}) {
  const board = useRef<HTMLDivElement>(null);
  const hints = useGamePrefs((s) => s.hints);
  const [handPos, setHandPos] = useState<{ x: number; y: number } | null>(null);
  const same = (a: Cell | null | undefined, b: Cell) => !!a && a.side === b.side && a.idx === b.idx;
  const stepMs = SOW_MS * animScale();

  // the hand follows the highlighted pit (pit centre, in % of the board)
  useLayoutEffect(() => {
    if (!hl || !board.current) return setHandPos(null);
    const el = board.current.querySelector<HTMLElement>(`[data-pit="${hl.side}-${hl.idx}"]`);
    if (!el) return;
    const b = board.current.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setHandPos({ x: ((r.left + r.width / 2 - b.left) / b.width) * 100, y: ((r.top + r.height / 2 - b.top) / b.height) * 100 });
  }, [hl]);

  // your move: the first legal pit takes focus (arrows move between pits, Enter plays)
  const legalKey = legal.join(",");
  useEffect(() => {
    if (!autoFocus || !legal.length) return;
    const act = document.activeElement;
    if (act && board.current?.contains(act)) return;
    if (shouldAutoFocus()) board.current?.querySelector<HTMLButtonElement>(`[data-pit="${me}-${legal[0]}"]`)?.focus({ preventScroll: true });
  }, [autoFocus, legalKey, me]);

  const oppHand = !!step && step.owner !== me;
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
                const isEnd = hints && !!preview && same(preview.end, cell);
                const willCap = hints && !!preview && preview.captures.some((c) => same(c, cell));
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
                          : isLegal && hints
                            ? "0 0 0 2px rgba(124,255,170,.7), inset 0 4px 10px rgba(0,0,0,.6)"
                            : "inset 0 4px 10px rgba(0,0,0,.6)";
                const drop = step && step.kind === "sow" && same(step.cell, cell) ? step.id : 0;
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
                    className={`relative aspect-square w-[92%] max-h-full self-center justify-self-center rounded-full transition-[transform,box-shadow] duration-150 ${isLegal ? "cursor-pointer hover:scale-105" : "cursor-default"} ${isCap ? "gk-captured" : ""}`}
                    style={{ background: "radial-gradient(circle at 50% 40%, #3b2410 0%, #5a3818 60%, #7a4c22 100%)", boxShadow: ring, ["--gk-seed" as string]: `${Math.round(stepMs * 1.4)}ms` }}
                    aria-label={`${t(cell.side === me ? "igisoro.yourPit" : "igisoro.oppPit", { n })}${isLegal ? ", playable" : ""}${willCap ? ", would be captured" : ""}`}
                  >
                    <Seeds n={n} drop={drop} />
                    <span className="num absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-black/75 px-1 text-[0.625rem] font-bold tabular-nums text-white sm:text-xs">{n}</span>
                  </button>
                );
              })}
            </div>,
          ])}
        </div>
        {/* the sowing hand (yours from the bottom, the opponent's from the top) with the seeds it still holds */}
        {handPos && step && (
          <div
            aria-hidden
            className="pointer-events-none absolute z-20 w-[11%] transition-[left,top] ease-out"
            style={{ left: `${handPos.x}%`, top: `${handPos.y}%`, transitionDuration: `${Math.round(stepMs * 0.8)}ms` }}
          >
            <div key={step.kind === "sow" ? "sow" : step.id} className={`gk-hand ${oppHand ? "gk-opp" : ""} ${step.kind !== "sow" ? "gk-grab" : ""} absolute left-0 top-0 w-full`} style={{ ["--gk-grab" as string]: `${Math.round(stepMs * 1.5)}ms` }}>
              <SowingHand skin={oppHand ? SKIN.opp : SKIN.me} seeds={hand} className="w-full drop-shadow-[0_6px_8px_rgba(0,0,0,.45)]" />
            </div>
            {hand > 0 && (
              <span className={`num absolute left-1/2 grid min-w-6 -translate-x-1/2 place-items-center rounded-full bg-black/80 px-1.5 text-xs font-bold text-white ring-1 ring-[#FFC83D]/70 ${oppHand ? "-top-[5.2em]" : "top-[3.4em]"}`}>{hand}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

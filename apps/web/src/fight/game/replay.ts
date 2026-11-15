import { create } from "zustand";
import type { BoxingSnapshot, FightEvent } from "@gukirana/contracts";
import { useFightBridge } from "../bridge";
import { useFightUi } from "./ui-store";

/**
 * Replay highlights (P3-FGT-05): the last seconds of my fight's snapshots are kept in a small ring buffer; a big moment
 * (knockdown, a clean power punch worth 3+, a 3-hit combo) keeps 2 s before it and 1 s after it as a highlight. On the
 * result card "Watch highlights" plays them back at half speed through the same renderer (fight/fighters.tsx asks
 * `replayFrame()` before the live snapshot), so the replay is the fight itself, re-posed — not a video.
 */
interface Frame {
  snap: BoxingSnapshot;
  events: FightEvent[];
  at: number;
}
const BUFFER_MS = 2200;
const AFTER_MS = 1000;
const MAX_HIGHLIGHTS = 4;
const SPEED = 0.5;

export function isHighlight(e: FightEvent): boolean {
  if (e.k === "knockdown") return true;
  if (e.k === "hit") return e.points >= 3 || e.combo >= 3;
  return false;
}

let buffer: Frame[] = [];
let pendingEvents: FightEvent[] = [];
let open: { frames: Frame[]; until: number; score: number } | null = null;
const highlights: { frames: Frame[]; score: number }[] = [];

interface ReplayStore {
  count: number;
  playing: boolean;
}
export const useReplay = create<ReplayStore>()(() => ({ count: 0, playing: false }));

/** record one snapshot (with the events that came with it) */
export function recordFrame(snap: BoxingSnapshot, events: FightEvent[], at = performance.now()): void {
  const f: Frame = { snap, events, at };
  buffer.push(f);
  while (buffer.length && at - buffer[0]!.at > BUFFER_MS) buffer.shift();
  if (open) {
    open.frames.push(f);
    if (at >= open.until) {
      highlights.push({ frames: open.frames, score: open.score });
      highlights.sort((a, b) => b.score - a.score);
      highlights.length = Math.min(highlights.length, MAX_HIGHLIGHTS);
      open = null;
      useReplay.setState({ count: highlights.length });
    }
  }
  const big = events.filter(isHighlight);
  if (big.length && !open) {
    const score = big.reduce((a, e) => a + (e.k === "knockdown" ? 10 : e.k === "hit" ? e.points + e.combo : 0), 0);
    open = { frames: [...buffer], until: at + AFTER_MS, score };
  }
}

export function resetReplay(): void {
  buffer = [];
  pendingEvents = [];
  open = null;
  highlights.length = 0;
  play = null;
  useReplay.setState({ count: 0, playing: false });
}

let play: { frames: Frame[]; t0: number; origin: number; idx: number } | null = null;
let queue: Frame[][] = [];
export function playHighlights(): void {
  if (open) {
    highlights.push({ frames: open.frames, score: open.score });
    open = null;
  }
  queue = [...highlights].sort((a, b) => a.frames[0]!.at - b.frames[0]!.at).map((h) => h.frames);
  next();
}
function next(): void {
  const frames = queue.shift();
  if (!frames || !frames.length) {
    play = null;
    useReplay.setState({ playing: false });
    return;
  }
  play = { frames, t0: performance.now(), origin: frames[0]!.at, idx: -1 };
  useReplay.setState({ playing: true });
}
export function stopReplay(): void {
  queue = [];
  play = null;
  useReplay.setState({ playing: false });
}

/** the renderer's replay source: the frame to show now (and the events crossed since the last call), or null */
export function replayFrame(now = performance.now()): { snap: BoxingSnapshot; events: FightEvent[] } | null {
  if (!play) return null;
  const at = play.origin + (now - play.t0) * SPEED;
  const fr = play.frames;
  let i = play.idx < 0 ? 0 : play.idx;
  while (i + 1 < fr.length && fr[i + 1]!.at <= at) i++;
  const events: FightEvent[] = [];
  for (let k = Math.max(0, play.idx + 1); k <= i; k++) events.push(...fr[k]!.events);
  play.idx = i;
  const frame = fr[i]!;
  if (at > fr[fr.length - 1]!.at + 400) next();
  return { snap: frame.snap, events };
}

/* the recorder follows my fight (practice and live) */
if (typeof window !== "undefined") {
  useFightUi.subscribe((s, prev) => {
    if (s.feed === prev.feed) return;
    const last = prev.feed[prev.feed.length - 1]?.id ?? 0;
    for (const f of s.feed) if (f.id > last) pendingEvents.push(f.e);
    if (!s.feed.length) pendingEvents = [];
  });
  useFightBridge.subscribe((s, prev) => {
    const snap = s.mine?.snap;
    if (!s.mine && prev.mine) return; // stepped out: keep the highlights for the result card until the next fight
    if (!snap || snap === prev.mine?.snap) return;
    if (prev.mine?.ring !== s.mine?.ring || (prev.mine?.snap && snap.tick < prev.mine.snap.tick)) resetReplay();
    recordFrame(snap, pendingEvents);
    pendingEvents = [];
  });
}

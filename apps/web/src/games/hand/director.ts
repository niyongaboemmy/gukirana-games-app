"use client";
import { create } from "zustand";
import { animScale } from "../feedback";
import { LudoRoll, SowHand, newFrame, type HandFrame, type SowKind } from "./clips";
import type { HandLook } from "./look";

/**
 * One shared game hand per screen (P2-GAME-07). Boards tell the director what is happening (a roll was requested, the
 * value arrived, a sowing step); the overlay samples the director every frame. Presentation only: nothing here feeds
 * back into game state, timers or input.
 *
 * Render mode: "3d" (live WebGL overlay; on the Lite tier — `lite` — it drops to 1× resolution, a coarser mesh and a
 * blob contact shadow instead of the shadow map), or "svg" when there is no WebGL at all (the flat hands).
 * `?hands=3d|lite|svg` overrides for testing. The Pool hands are sprites rendered once from the same 3D hand.
 */
export type HandMode = "3d" | "lite" | "svg";

let modeCache: HandMode | null = null;
export function handMode(): HandMode {
  if (modeCache) return modeCache;
  if (typeof window === "undefined") return "svg";
  const q = new URLSearchParams(location.search).get("hands");
  if (q === "3d" || q === "lite" || q === "svg") return (modeCache = q);
  let gl2 = false;
  try {
    gl2 = !!document.createElement("canvas").getContext("webgl2");
  } catch {
    gl2 = false;
  }
  if (!gl2) return (modeCache = "svg");
  return (modeCache = document.documentElement.dataset.glass === "lite" ? "lite" : "3d");
}

interface HandStore {
  /** the overlay canvas exists (mounted on the first animation, dropped after a quiet spell) */
  mounted: boolean;
  /** bumps when a new clip starts (wakes a demand-driven canvas) */
  seq: number;
}
export const useHandStore = create<HandStore>(() => ({ mounted: false, seq: 0 }));

export interface HandTarget {
  /** the board element: the hand's frame is the board's box */
  board: HTMLElement;
  /** 0 = from the bottom (you), π/2 from the left, π from the top, 3π/2 from the right */
  side: number;
  look: HandLook;
  /** palm width as a fraction of the board width */
  size: number;
}

type Job = { kind: "ludo"; roll: LudoRoll; key: number } | { kind: "sow"; hand: SowHand } | { kind: "still"; frame: HandFrame };

class Director {
  frame: HandFrame = newFrame();
  target: HandTarget | null = null;
  job: Job | null = null;
  rect = { left: 0, top: 0, width: 1, height: 1 };
  private rectAt = 0;
  private last = 0;
  /** set by the overlay: request a frame (demand frameloop) */
  wake: () => void = () => {};

  private begin(t: HandTarget) {
    this.target = t;
    this.readRect(true);
    if (!useHandStore.getState().mounted) useHandStore.setState({ mounted: true });
    useHandStore.setState((s) => ({ seq: s.seq + 1 }));
    this.wake();
  }

  readRect(force = false) {
    const now = performance.now();
    if (!this.target || (!force && now - this.rectAt < 250)) return;
    const r = this.target.board.getBoundingClientRect();
    if (r.width > 0) this.rect = { left: r.left, top: r.top, width: r.width, height: r.height };
    this.rectAt = now;
  }

  /** Screen point → the hand's local board frame (u, v) for a side. */
  toLocal(x: number, y: number, side: number): { u: number; v: number } {
    const r = this.rect;
    const du = (x - r.left) / r.width - 0.5, dv = (y - r.top) / r.height - 0.5;
    const c = Math.cos(-side), s = Math.sin(-side);
    return { u: 0.5 + du * c - dv * s, v: 0.5 + du * s + dv * c };
  }

  /* ---- Ludo ---- */

  /** A roll was requested: the hand reaches for the die and shakes it until `ludoThrow`. */
  ludoGrab(t: HandTarget, o: { key: number; pickup?: { x: number; y: number } | null; prevValue?: number | null }) {
    const k = animScale();
    if (k <= 0) return;
    this.begin(t);
    const pickup = o.pickup ? this.toLocal(o.pickup.x, o.pickup.y, t.side) : { u: 0.62, v: 1.06 };
    const roll = new LudoRoll({ k, pickup, prevValue: o.prevValue, dieVisibleAtStart: !!o.pickup });
    roll.grab(performance.now());
    this.job = { kind: "ludo", roll, key: o.key };
  }

  /** The fair value is known: throw it (grabs quickly first when no grab was shown, e.g. a live opponent's roll). */
  ludoThrow(t: HandTarget, o: { key: number; value: number; rollId: number; pickup?: { x: number; y: number } | null }) {
    const k = animScale();
    if (k <= 0) return;
    let job = this.job;
    if (!job || job.kind !== "ludo" || job.key !== o.key) {
      this.begin(t);
      const pickup = o.pickup ? this.toLocal(o.pickup.x, o.pickup.y, t.side) : { u: 0.6, v: 1.06 };
      job = { kind: "ludo", roll: new LudoRoll({ k, pickup, dieVisibleAtStart: !!o.pickup }), key: o.key };
      this.job = job;
    }
    job.roll.throw(performance.now(), o.value, o.rollId);
    this.wake();
  }

  /** When the 2D die should show the value again (end of the tumble), ms from now; 0 = no 3D throw running. */
  ludoRevealIn(): number {
    const j = this.job;
    if (!j || j.kind !== "ludo") return 0;
    return Math.max(0, j.roll.tumbleEnd - performance.now());
  }

  /* ---- Igisoro ---- */

  sowStep(t: HandTarget, s: { kind: SowKind; x: number; y: number; seeds: number; stepMs: number }) {
    const k = animScale();
    if (k <= 0) return;
    if (!this.job || this.job.kind !== "sow" || this.target?.side !== t.side) {
      this.begin(t);
      this.job = { kind: "sow", hand: new SowHand(k) };
    } else this.target = t;
    const p = this.toLocal(s.x, s.y, t.side);
    this.job.hand.step(performance.now(), { kind: s.kind, u: p.u, v: p.v, seeds: s.seeds, stepMs: s.stepMs });
    this.wake();
  }
  sowEnd() {
    if (this.job?.kind === "sow") this.job.hand.end(performance.now());
    this.wake();
  }

  /** Holds one frame on screen (the dev hand lab). */
  still(t: HandTarget, frame: HandFrame) {
    this.begin(t);
    this.job = { kind: "still", frame };
    this.wake();
  }

  /** Stop everything (screen unmount). */
  clear() {
    this.job = null;
    this.target = null;
    this.frame.visible = false;
    this.frame.die.visible = false;
  }

  /** Samples the current clip into `frame`; false when nothing is animating. */
  tick(now: number): boolean {
    const dt = this.last ? Math.min(64, now - this.last) : 16;
    this.last = now;
    const j = this.job;
    if (!j) {
      this.frame.visible = false;
      this.frame.die.visible = false;
      return false;
    }
    this.readRect();
    if (j.kind === "still") {
      copyFrame(j.frame, this.frame);
      return false;
    }
    const alive = j.kind === "ludo" ? j.roll.sample(now, this.frame) : j.hand.sample(now, dt, this.frame);
    if (!alive) {
      this.job = null;
      this.frame.visible = false;
      this.frame.die.visible = false;
    }
    return alive;
  }
}

function copyFrame(a: HandFrame, b: HandFrame) {
  b.visible = a.visible;
  b.u = a.u;
  b.v = a.v;
  b.h = a.h;
  b.yaw = a.yaw;
  b.pitch = a.pitch;
  b.roll = a.roll;
  b.pose.set(a.pose);
  b.anchor = a.anchor;
  b.seeds = a.seeds;
  Object.assign(b.die, a.die, { q: b.die.q });
  b.die.q.splice(0, 4, ...a.die.q);
}

export const hands = new Director();

/**
 * The ring's motion clock (P3-FGT-07): real time (s), except that a hit-stop holds it for a few frames at a clean
 * connection; afterwards it runs a little fast until it has caught up with real time again (so the fighters never
 * drift behind the engine). Every ring person's motion (fight/fighter-avatar) samples this clock.
 */
const state = { lag: 0, stopUntil: 0, last: 0 };
/** catch-up speed after a stop: 35 % faster than real time until the lag is gone */
const CATCH_UP = 0.35;

/** advance the clock to real time `t` (s) and return the ring time (pure state machine; exported for tests) */
export function ringTimeAt(t: number): number {
  const dt = Math.min(0.1, Math.max(0, t - state.last));
  if (dt > 0) {
    state.last = t;
    if (t < state.stopUntil) state.lag += dt;
    else if (state.lag > 0) state.lag = Math.max(0, state.lag - dt * CATCH_UP);
  }
  return t - state.lag;
}

export const ringNow = (): number => ringTimeAt(performance.now() / 1000);

/** hold the ring's motion for `s` seconds from real time `t` (a longer stop wins over a shorter one already running) */
export function hitStopAt(s: number, t: number): void {
  if (s <= 0) return;
  ringTimeAt(t);
  state.stopUntil = Math.max(state.stopUntil, t + Math.min(0.15, s));
}
export const hitStop = (s: number): void => hitStopAt(s, performance.now() / 1000);

/** a small camera punch towards the action (m), set on a connection, eased out by the fight camera */
export const cameraKick = { v: 0 };

/** (tests) back to real time */
export function resetRingClock(): void {
  state.lag = 0;
  state.stopUntil = 0;
  state.last = 0;
}

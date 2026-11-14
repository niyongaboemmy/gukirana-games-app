/**
 * Visual stability rules for the halls (P2-HAL-10, docs/HALLS-REALISM-REVIEW.md §Stability), in one place:
 *
 * - prompts never flash on / off while you stand at a range boundary: a prompt appears inside `range` and only goes
 *   away beyond `range + margin` (hysteresis); a different candidate takes over only when clearly nearer;
 * - the camera follows with frame-rate independent exponential smoothing (same feel at 30, 60 or 120 fps), with
 *   one set of rates for every hall.
 *
 * Pure functions, unit tested (stability.test.ts).
 */

/** Exponential smoothing factor for a rate (1/s) over `dt` seconds: frame-rate independent. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * Math.max(0, dt));

/** Follow-camera rates (1/s): walking follow, sit / stand / eye-view glides. */
export const CAM_RATE = { follow: 6, glide: 4 } as const;

/** Prompt ranges (m) and the extra distance before a shown prompt goes away. */
export const PROMPT = { seat: 1.5, seatMargin: 0.35, switchGain: 0.25, exitMargin: 0.6 } as const;

/**
 * Nearest candidate with hysteresis. `current` stays chosen while it is still allowed and within `range + margin`;
 * another candidate replaces it only when it is nearer by more than `gain` metres (no ping-pong between two chairs).
 * `dist(id)` returns the distance, or null when that candidate is not allowed right now (taken, refused).
 */
export function stickyNearest<T extends string>(current: T | null, ids: Iterable<T>, dist: (id: T) => number | null, range: number, margin: number, gain: number): T | null {
  let best: T | null = null;
  let bd = range;
  let cur = Infinity;
  for (const id of ids) {
    const d = dist(id);
    if (d == null) continue;
    if (id === current) cur = d;
    if (d < bd) {
      bd = d;
      best = id;
    }
  }
  if (current != null && cur <= range + margin) {
    if (best == null || best === current || bd < cur - gain) return best ?? current;
    return current;
  }
  return best;
}

/** A boolean zone with hysteresis: on when `inside`, off only once `outside` (a larger zone) is left. */
export const stickyZone = (was: boolean, inside: boolean, outside: boolean) => (was ? outside : inside);

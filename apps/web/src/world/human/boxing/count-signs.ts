/**
 * The referee's count on the fingers (P3-FGT-14): each number of a knockdown / standing count shown to the fighter as
 * well as said. One hand counts 1–5 (index, + middle, + ring, + little finger, + thumb: the open hand), 6–10 keep the
 * first hand open and count again on the other. Extension per finger [thumb, index, middle, ring, little], 1 = straight,
 * 0 = folded into the palm; `both` = the second hand is up too (the two-handed count clip).
 */
export interface CountSign {
  /** the counting hand (the referee's right, the rear arm of the referee clips) */
  first: readonly [number, number, number, number, number];
  /** the other hand (6–10); all folded below 6 */
  second: readonly [number, number, number, number, number];
  both: boolean;
}

const ONE_TO_FIVE: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0, 0, 0, 0],
  [0, 1, 0, 0, 0],
  [0, 1, 1, 0, 0],
  [0, 1, 1, 1, 0],
  [0, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
];

/** the hand signs for count n (clamped to 1…10; 0 / undefined = a closed fist, no count) */
export function countSign(n: number | undefined): CountSign {
  const k = Math.max(0, Math.min(10, Math.round(n ?? 0)));
  if (k <= 5) return { first: ONE_TO_FIVE[k]!, second: ONE_TO_FIVE[0]!, both: false };
  return { first: ONE_TO_FIVE[5]!, second: ONE_TO_FIVE[k - 5]!, both: true };
}

/** fingers shown for count n (the sum of both hands): the test of the table above */
export const fingersShown = (s: CountSign) => s.first.reduce((a, b) => a + b, 0) + s.second.reduce((a, b) => a + b, 0);

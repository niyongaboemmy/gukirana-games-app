type V3 = readonly number[];
export function angleAt(a: V3, b: V3, c: V3): number;
export function flexion(a: V3, b: V3, c: V3): number;
export function between(u: V3, v: V3): number;
export function kneeBehind(hip: V3, knee: V3, ankle: V3, footFwd: V3): number;
export const JOINT_LIMITS: Record<"elbowFlexMax" | "kneeFlexMax" | "kneeBehindMax" | "wristDevMax" | "neckBendMax" | "spineTwistMax", number>;
export interface JointCheck {
  joint: string;
  value: number;
  limit: number;
  ok: boolean;
}
export function jointChecks(j: Record<string, V3 | undefined>, limits?: Partial<typeof JOINT_LIMITS>): { checks: JointCheck[]; violations: number };
export function footSlide(
  frames: readonly { t: number; L?: V3; R?: V3 }[],
  opts?: { plantH?: number; plantV?: number },
): { maxSlideCm: number; slideCmPerS: number; plants: number; plantedS: number };
export function cavityStats(rgba: ArrayLike<number>): { personPx: number; skinBackPx: number; garmentBackPx: number; skinBackShare: number; garmentBackShare: number };
export function summary(xs: readonly number[]): { mean: number; worst: number; min: number; n: number } | null;
export function pick(obj: unknown, path: string): unknown;
export interface AcceptanceItem {
  id: string;
  label: string;
  metric: string;
  min?: number | null;
  max?: number | null;
  equals?: unknown;
  source?: string;
}
export interface ScoredItem {
  id: string;
  label: string;
  metric: string;
  value: unknown;
  min: number | null;
  max: number | null;
  equals?: unknown;
  status: "pass" | "fail" | "unset" | "missing";
  source?: string;
}
export function score(metrics: unknown, acceptance: { items: readonly AcceptanceItem[] }): { items: ScoredItem[]; pass: number; fail: number; unset: number; missing: number; ok: boolean };

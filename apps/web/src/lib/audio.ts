"use client";
/**
 * One shared WebAudio context for UI sounds (door whoosh, gate chimes).
 * Browsers refuse to start audio before the first tap/click/key, and warn every time we try —
 * so until the user has interacted, sounds are simply skipped.
 */
let ctx: AudioContext | null = null;

export function uiAudio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (activation && !activation.hasBeenActive) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

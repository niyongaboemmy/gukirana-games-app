import { jumpSeconds } from "./human/motion-layer";

/**
 * The Jump control (P2-AVA-12, NEXT_PUBLIC_FF_JUMP): Space or the HUD's Jump button asks for a jump; the player
 * controller (world/Player.tsx) plays it by putting ACT.jump in its `anim` for the jump's length, so everyone sees it
 * (the pose is cosmetic: the avatar's motion layer, world/human/motion-layer.ts; the server's movement rules are
 * unchanged, the jump never moves you over anything).
 */
export const jumpInput = { requested: 0 };

export function requestJump() {
  jumpInput.requested = performance.now();
}

/** Jump timing for the controller: when a request made at `requested` starts a jump (ms clock), and until when. */
export function nextJump(prevUntil: number, handled: number, requested: number, now: number, running: boolean): { until: number; handled: number } | null {
  if (requested <= handled) return null;
  // one jump at a time (a request during a jump is dropped, not queued), a short recovery after landing
  if (prevUntil > 0 && now < prevUntil + 120) return { until: prevUntil, handled: requested };
  return { until: now + jumpSeconds(running) * 1000, handled: requested };
}

"use client";
import { create } from "zustand";
import { useArena } from "@/arena/arena-client";
import { ARENA_ON } from "@/arena/flags";
import { A, denialText } from "@/arena/strings";
import { closedFor, useBuildings } from "./buildings";
import { PORTALS } from "./layout";
import { W } from "./strings";

/**
 * Why a hall door stays shut for this viewer (GAP-004), in plain words, or null when it opens for them:
 *  - a building closed by staff from the console (Super Admin / IT staff still walk in, world/buildings.ts)
 *  - the Tournament Arena when its status says you may not come in (closed, barred …; arena staff are let in by the
 *    server's `canEnter`)
 * The plaza door shows it (shut leaves, red door lamp, "Closed" sign) and the HUD tells the player on every approach.
 */
export interface DoorRefusal {
  title: string;
  text: string;
}

type BuildingsState = ReturnType<typeof useBuildings.getState>;
type ArenaState = ReturnType<typeof useArena.getState>;

export function doorRefusal(id: string | null | undefined, b: BuildingsState = useBuildings.getState(), a: ArenaState = useArena.getState()): DoorRefusal | null {
  if (!id) return null;
  const p = PORTALS.find((x) => x.id === id);
  if (!p?.href) return null;
  const msg = closedFor(id, b);
  if (msg !== null) return { title: W.closedTitle(p.label), text: msg || W.closedFallback };
  if (ARENA_ON && id === "arena") {
    const st = a.status;
    if (st && !st.canEnter) return { title: st.denial === "ARENA_CLOSED" || !st.denial ? A.closedTitle : A.barredTitle, text: denialText(st.denial ?? "ARENA_CLOSED") };
  }
  return null;
}

/** Reactive: true while the door of `id` is shut for this viewer (buildings switch / arena status). */
export function useDoorShut(id: string | null | undefined): boolean {
  const b = useBuildings((s) => (id ? closedFor(id, s) !== null : false));
  const a = useArena((s) => (ARENA_ON && id === "arena" ? !!s.status && !s.status.canEnter : false));
  return b || a;
}

/** Reactive refusal for the HUD (title + plain-words reason). */
export function useDoorRefusal(id: string | null | undefined): DoorRefusal | null {
  const key = useBuildings((s) => (id ? closedFor(id, s) : null));
  const st = useArena((s) => (ARENA_ON && id === "arena" ? s.status : null));
  void key;
  void st;
  return doorRefusal(id);
}

/** E / Interact at a shut door: shows its notice again (HUD card, arena card) even after it was dismissed. */
export const useDoorNotice = create<{ at: number }>()(() => ({ at: 0 }));
export const showDoorNotice = () => useDoorNotice.setState({ at: Date.now() });

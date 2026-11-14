"use client";
import { create } from "zustand";
import { api, useSession } from "@/lib/session";

/**
 * Open / closed state of plaza buildings, set by staff in the console (GET /buildings, public). A closed building keeps
 * its doors shut for players and shows the staff message at the door; Super Admin / IT staff still walk in.
 */
interface BuildingsState {
  status: Record<string, { open: boolean; message: string }>;
  staff: boolean;
}
export const useBuildings = create<BuildingsState>()(() => ({ status: {}, staff: false }));

const BYPASS = ["super_admin", "it_admin"];
let timer: ReturnType<typeof setInterval> | null = null;
let users = 0;

async function pull(): Promise<void> {
  try {
    const r = await fetch("/api/v1/buildings", { cache: "no-store" });
    if (!r.ok) return;
    const list = (await r.json()) as { id: string; open: boolean; message: string }[];
    useBuildings.setState({ status: Object.fromEntries(list.map((b) => [b.id, { open: b.open, message: b.message }])) });
  } catch {
    /* offline: keep the last known state (default open) */
  }
}

/** start polling while the plaza is shown (ref-counted); returns a stop function */
export function watchBuildings(): () => void {
  users++;
  if (!timer) {
    void pull();
    timer = setInterval(() => void pull(), 20_000);
    if (useSession.getState().status === "authenticated")
      void api<{ roles: string[] }>("/me/roles")
        .then((r) => useBuildings.setState({ staff: r.roles.some((x) => BYPASS.includes(x)) }))
        .catch(() => undefined);
  }
  return () => {
    if (--users <= 0 && timer) {
      clearInterval(timer);
      timer = null;
      users = 0;
    }
  };
}

/** the building is closed for this viewer: its message (may be ""), else null */
export function closedFor(id: string | undefined, s: BuildingsState = useBuildings.getState()): string | null {
  if (!id || s.staff) return null;
  const b = s.status[id];
  return b && !b.open ? b.message : null;
}

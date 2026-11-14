"use client";
import { create } from "zustand";
import { releaseAllInput } from "@/world/navigation";

/** On-screen rectangle (CSS px) the console zooms out of / back into — e.g. the office monitor. */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ConsoleState {
  open: boolean;
  /** office the console was opened from (null = standalone /console or HUD) */
  office: string | null;
  from: ScreenRect | null;
}

export const useConsole = create<ConsoleState>()(() => ({ open: false, office: null, from: null }));

/** Open the staff console full screen (from the office computer, or the HUD launcher). */
export function openConsole(o: { office: string | null; from?: ScreenRect | null } = { office: null }): void {
  releaseAllInput();
  useConsole.setState({ open: true, office: o.office, from: o.from ?? null });
}

/** Log off: the console shrinks back into the monitor it came from. */
export function closeConsole(): void {
  useConsole.setState({ open: false });
}

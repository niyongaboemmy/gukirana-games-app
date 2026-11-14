"use client";
import { openConsole, type ScreenRect } from "@/console/console-store";

/**
 * The officer's computer (P2-ADM-04): staff seated at their desk (or standing behind it) use the monitor, which
 * opens the full-screen staff console zooming out of the monitor's on-screen rectangle. The 3D scene registers a
 * projector (rooms/AdminBlock.tsx) that turns the monitor's corners into CSS pixels with the live camera.
 */
let projector: ((office: string) => ScreenRect | null) | null = null;
export function setMonitorProjector(fn: ((office: string) => ScreenRect | null) | null): void {
  projector = fn;
}
export function monitorRect(office: string): ScreenRect | null {
  try {
    return projector?.(office) ?? null;
  } catch {
    return null;
  }
}
export function openComputer(office: string): void {
  openConsole({ office, from: monitorRect(office) });
}

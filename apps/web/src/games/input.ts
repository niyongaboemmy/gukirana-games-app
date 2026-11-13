"use client";
import { useEffect } from "react";

/**
 * 10-foot / controller input for the game screens (DESIGN-SPEC §14, TV):
 * - Gamepad API: D-pad + left stick → arrow keys (with key repeat), A → Enter (activates the focused control),
 *   B / Start → Escape (game menu / back), X → "x", Y → "y", LB / RB → "q" / "e". Synthetic keydown events go to
 *   the focused element, so every game handles keyboard, TV remote and gamepad through one code path.
 * - Spatial navigation: arrow keys not consumed by a game move focus to the nearest control in that direction,
 *   inside the top-most dialog when one is open.
 * - Input mode: <html data-input="key|pointer"> so focus rings show for keyboard / remote / pad users only.
 */

export interface PadState {
  connected: boolean;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  lt: number;
  rt: number;
}
export const pad: PadState = { connected: false, lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 };
/** a game that reads the sticks itself (Pool aim) sets this, so the left stick doesn't also send arrows */
export const padOptions = { analogSticks: false };

const BUTTON_KEYS: Record<number, string> = { 0: "Enter", 1: "Escape", 2: "x", 3: "y", 4: "q", 5: "e", 9: "Escape", 12: "ArrowUp", 13: "ArrowDown", 14: "ArrowLeft", 15: "ArrowRight" };
const REPEAT_DELAY = 380;
const REPEAT_EVERY = 110;
const DEAD = 0.25;

function setMode(mode: "key" | "pointer") {
  if (document.documentElement.dataset.input !== mode) document.documentElement.dataset.input = mode;
}

/** Dispatches a key to the focused element; A/Enter on a button or link also activates it. */
export function pressKey(key: string) {
  setMode("key");
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  const notHandled = target.dispatchEvent(ev);
  target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
  if (notHandled && key === "Enter" && target !== document.body && (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement || target.getAttribute("role") === "button")) target.click();
}

const FOCUSABLE = 'button:not([disabled]), a[href], select, input:not([type="hidden"]), [tabindex]:not([tabindex="-1"])';

function scope(): HTMLElement {
  const dialogs = document.querySelectorAll<HTMLElement>('[aria-modal="true"]');
  if (dialogs.length) return dialogs[dialogs.length - 1]!;
  return document.querySelector<HTMLElement>(".gk-game") ?? document.body;
}

/** Moves focus to the nearest visible control in the arrow's direction (returns false when nothing is there). */
export function moveFocus(dir: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"): boolean {
  const root = scope();
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[inert]");
  });
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !root.contains(cur) || cur === document.body) {
    const first = root.querySelector<HTMLElement>("[data-autofocus]") ?? items[0];
    first?.focus();
    return !!first;
  }
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const [dx, dy] = dir === "ArrowLeft" ? [-1, 0] : dir === "ArrowRight" ? [1, 0] : dir === "ArrowUp" ? [0, -1] : [0, 1];
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const r = el.getBoundingClientRect();
    const vx = r.left + r.width / 2 - ax;
    const vy = r.top + r.height / 2 - ay;
    const along = vx * dx + vy * dy;
    if (along <= 2) continue;
    const across = Math.abs(vx * dy - vy * dx);
    const score = along + across * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  best?.focus();
  return !!best;
}

/**
 * Move focus to the next control for this turn? Yes for keyboard / remote / pad users (and mouse desktops, where
 * the ring stays hidden); not on touch screens, where a ring on a pit the finger never touched is just noise.
 * Never while a dialog is open.
 */
export function shouldAutoFocus(): boolean {
  if (typeof document === "undefined" || document.querySelector('[aria-modal="true"]')) return false;
  return document.documentElement.dataset.input === "key" || pad.connected || !window.matchMedia("(pointer: coarse)").matches;
}

const isTextInput =(el: Element | null) => !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable);

/** Installs gamepad polling, spatial navigation and input-mode tracking for a game screen. */
export function useGameInput() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      setMode("key");
      if (e.defaultPrevented || isTextInput(e.target as Element)) return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (moveFocus(e.key)) e.preventDefault();
      }
    };
    const onPointer = () => setMode("pointer");
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, { capture: true });

    let raf = 0;
    const held = new Map<string, number>(); // key → next repeat time
    const poll = (now: number) => {
      raf = requestAnimationFrame(poll);
      const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
      const gp = [...pads].find((p): p is Gamepad => !!p && p.connected);
      pad.connected = !!gp;
      if (!gp) {
        held.clear();
        return;
      }
      const ax = (i: number) => {
        const v = gp.axes[i] ?? 0;
        return Math.abs(v) < DEAD ? 0 : v;
      };
      pad.lx = ax(0);
      pad.ly = ax(1);
      pad.rx = ax(2);
      pad.ry = ax(3);
      pad.lt = gp.buttons[6]?.value ?? 0;
      pad.rt = gp.buttons[7]?.value ?? 0;
      const down = new Set<string>();
      for (const [i, key] of Object.entries(BUTTON_KEYS)) if (gp.buttons[Number(i)]?.pressed) down.add(key);
      if (!padOptions.analogSticks) {
        if (pad.lx < -0.6) down.add("ArrowLeft");
        if (pad.lx > 0.6) down.add("ArrowRight");
        if (pad.ly < -0.6) down.add("ArrowUp");
        if (pad.ly > 0.6) down.add("ArrowDown");
      }
      for (const key of down) {
        const next = held.get(key);
        if (next === undefined) {
          held.set(key, now + REPEAT_DELAY);
          pressKey(key);
        } else if (now >= next && key.startsWith("Arrow")) {
          held.set(key, now + REPEAT_EVERY);
          pressKey(key);
        }
      }
      for (const key of [...held.keys()]) if (!down.has(key)) held.delete(key);
    };
    raf = requestAnimationFrame(poll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, { capture: true });
    };
  }, []);
}

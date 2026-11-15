"use client";
import { useEffect } from "react";
import { fightInput } from "./actions";
import { isTyping, keyTable, mouseAction, newPadMemo, padStep, type PadMemo } from "./input-map";
import { useFightPrefs } from "./prefs";

export { swipeAction, PAD_BUTTONS, PAD_GUARD } from "./input-map";

/**
 * Keyboard / mouse / gamepad bindings of a fight (FIGHT-GAMES-PLAN §2.8, scheme in input-map.ts). Listeners sit on
 * `window` in the CAPTURE phase, so the hall's own key handlers (walk, wallet, voice) never see a fight key first, and
 * every fight key is consumed (no page scroll on Space / arrows, no other shortcut). Touch lives in TouchPads.tsx.
 */
export function useFightControls(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let guardKeys = 0;
    let toggled = false;
    const held = new Set<string>();
    const table = () => keyTable(useFightPrefs.getState().keys);
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      // a dialog (Leave, settings, key binding) has the keyboard
      if (document.querySelector('[aria-modal="true"]')) return;
      const a = table().get(e.code);
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat || held.has(e.code)) return;
      held.add(e.code);
      if (a === "guard") {
        guardKeys++;
        if (useFightPrefs.getState().guardToggle) {
          toggled = !toggled;
          fightInput.guard(toggled, "key");
        } else if (guardKeys === 1) fightInput.guard(true, "key");
        return;
      }
      fightInput.press(a, "key");
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!held.delete(e.code)) return;
      e.stopPropagation();
      if (table().get(e.code) !== "guard") return;
      guardKeys = Math.max(0, guardKeys - 1);
      if (!useFightPrefs.getState().guardToggle && guardKeys === 0) fightInput.guard(false, "key");
    };
    // the mouse punches on the 3D view / the fight surface (never on HUD buttons)
    const onSurface = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "CANVAS" || t.dataset.fightSurface === "1");
    const onMouse = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !onSurface(e.target)) return;
      const a = mouseAction(e.button, e.shiftKey);
      if (!a) return;
      e.preventDefault();
      fightInput.press(a, "mouse");
    };
    const onMenu = (e: MouseEvent) => {
      if (onSurface(e.target)) e.preventDefault();
    };
    const onBlur = () => {
      if (guardKeys && !useFightPrefs.getState().guardToggle) fightInput.guard(false, "key");
      guardKeys = 0;
      held.clear();
    };

    // gamepads: polled every frame (the Gamepad API has no events for buttons)
    let raf = 0;
    const memos = new Map<number, PadMemo>();
    let padGuard = false;
    const poll = () => {
      raf = requestAnimationFrame(poll);
      const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
      let guardNow = false;
      let anyPad = false;
      for (const p of pads) {
        if (!p || p.connected === false) continue;
        anyPad = true;
        let memo = memos.get(p.index);
        if (!memo) memos.set(p.index, (memo = newPadMemo()));
        const r = padStep(memo, p);
        for (const a of r.presses) fightInput.press(a, "pad");
        if (r.guard) guardNow = true;
      }
      if (anyPad && guardNow !== padGuard) {
        padGuard = guardNow;
        fightInput.guard(guardNow, "pad");
      }
    };
    raf = requestAnimationFrame(poll);

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("pointerdown", onMouse, true);
    window.addEventListener("contextmenu", onMenu, true);
    window.addEventListener("blur", onBlur);
    return () => {
      cancelAnimationFrame(raf);
      onBlur();
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("pointerdown", onMouse, true);
      window.removeEventListener("contextmenu", onMenu, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [active]);
}

"use client";
import { useEffect } from "react";
import { fightInput } from "./actions";
import { isTyping, keyTable, mouseAction, moveOf, newPadMemo, padStep, pressOf, type BindAction, type PadMemo } from "./input-map";
import { useFightPrefs } from "./prefs";

export { swipeAction, PAD_BUTTONS, PAD_GUARD } from "./input-map";

/**
 * Keyboard / mouse / gamepad bindings of a fight (P3-FGT-10 scheme in input-map.ts). Listeners sit on `window` in the
 * CAPTURE phase, so the hall's own key handlers (walk, wallet, voice) never see a fight key first, and every fight key
 * is consumed (no page scroll on Space / arrows, no hall walking). WASD are the boxer's feet while in a fight.
 * Touch lives in TouchPads.tsx.
 */
export function useFightControls(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let toggled = false;
    /** physical keys held → their bind */
    const keys = new Map<string, BindAction>();
    const held = () => new Set(keys.values());
    let lastMv: [number, number] = [0, 0];
    const table = () => keyTable(useFightPrefs.getState().keys);
    const syncMove = () => {
      const mv = moveOf(held());
      if (mv[0] === lastMv[0] && mv[1] === lastMv[1]) return;
      lastMv = mv;
      fightInput.move(mv, "key");
    };
    const syncGuard = () => {
      if (useFightPrefs.getState().guardToggle) return;
      fightInput.guard(held().has("guard"), "key");
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const a = table().get(e.code);
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat || keys.has(e.code)) return;
      const before = held();
      keys.set(e.code, a);
      if (a === "guard") {
        if (useFightPrefs.getState().guardToggle) {
          toggled = !toggled;
          fightInput.guard(toggled, "key");
        } else if (!before.has("guard")) fightInput.guard(true, "key");
        return;
      }
      if (a === "body") return;
      const p = pressOf(a, before, e.shiftKey);
      syncMove();
      if (p) fightInput.press(p, "key", held().has("body"));
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const a = keys.get(e.code);
      if (!a) return;
      keys.delete(e.code);
      e.stopPropagation();
      if (a === "guard") syncGuard();
      syncMove();
    };
    const onSurface = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "CANVAS" || t.dataset.fightSurface === "1");
    const onMouse = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !onSurface(e.target)) return;
      const a = mouseAction(e.button, e.shiftKey);
      if (!a) return;
      e.preventDefault();
      fightInput.press(a, "mouse", held().has("body"));
    };
    const onMenu = (e: MouseEvent) => {
      if (onSurface(e.target)) e.preventDefault();
    };
    const onBlur = () => {
      if (held().has("guard") && !useFightPrefs.getState().guardToggle) fightInput.guard(false, "key");
      keys.clear();
      syncMove();
    };

    let raf = 0;
    const memos = new Map<number, PadMemo>();
    let padGuard = false;
    let padMv: [number, number] = [0, 0];
    const poll = () => {
      raf = requestAnimationFrame(poll);
      const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
      let guardNow = false;
      let anyPad = false;
      let mv: [number, number] = [0, 0];
      for (const p of pads) {
        if (!p || p.connected === false) continue;
        anyPad = true;
        let memo = memos.get(p.index);
        if (!memo) memos.set(p.index, (memo = newPadMemo()));
        const r = padStep(memo, p);
        for (const a of r.presses) fightInput.press(a, "pad", r.body);
        if (r.guard) guardNow = true;
        if (r.mv[0] || r.mv[1]) mv = r.mv;
      }
      if (!anyPad) return;
      if (guardNow !== padGuard) {
        padGuard = guardNow;
        fightInput.guard(guardNow, "pad");
      }
      if (mv[0] !== padMv[0] || mv[1] !== padMv[1]) {
        padMv = mv;
        fightInput.move(mv, "pad");
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

"use client";
import { useSyncExternalStore } from "react";

/**
 * Window (popup) theme: "light" = cream paper, "dark" = dark grey glass, "auto" = follow the device.
 * Sets <html data-ptheme="light|dark">; the styles live in app/paper.css. The choice is a per-device convenience.
 */
export type PaperTheme = "auto" | "light" | "dark";
const KEY = "gk.paperTheme";
const listeners = new Set<() => void>();

export function getPaperTheme(): PaperTheme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function applyPaperTheme(t: PaperTheme = getPaperTheme()) {
  const dark = t === "dark" || (t === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.ptheme = dark ? "dark" : "light";
}

export function setPaperTheme(t: PaperTheme) {
  try {
    if (t === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* private mode: applies for this visit only */
  }
  applyPaperTheme(t);
  listeners.forEach((l) => l());
}

export function usePaperTheme(): PaperTheme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getPaperTheme,
    () => "auto",
  );
}

/** inline in <head>: sets the attribute before first paint and follows device changes in auto mode */
export const PAPER_THEME_SCRIPT = `(function(){try{var k="${KEY}",m=window.matchMedia("(prefers-color-scheme: dark)");var a=function(){var v=localStorage.getItem(k);var d=v==="dark"||(v!=="light"&&m.matches);document.documentElement.dataset.ptheme=d?"dark":"light"};a();m.addEventListener("change",a)}catch(e){document.documentElement.dataset.ptheme="light"}})();`;

"use client";
import { useEffect } from "react";

/**
 * Glass surfaces (docs/UI-DESIGN-SYSTEM.md): backdrop blur over the WebGL canvas costs GPU time on weak phones, so
 * the Lite tier gets the solid translucent fallback (`html[data-glass="lite"]`, see app/globals.css). Same device
 * heuristic as the 3D Lite tier (world/WorldCanvas pickTier); `?tier=lite|standard` overrides it for testing.
 */
export function useGlassTier() {
  useEffect(() => {
    const q = new URLSearchParams(location.search).get("tier");
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const lite = q ? q === "lite" : mem <= 3 || (navigator.hardwareConcurrency ?? 8) <= 4;
    document.documentElement.dataset.glass = lite ? "lite" : "full";
  }, []);
}

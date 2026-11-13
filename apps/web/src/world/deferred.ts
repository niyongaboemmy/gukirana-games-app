import { useSyncExternalStore } from "react";

/**
 * "The first view is revealed and the HUD is usable": from then on non-critical assets may load (P1-WLD-05:
 * critical download). Set once per session by world/SceneCanvas (DeferredAssets); components that would otherwise
 * request a big file on mount (the everyday-life motion sets, the near-tree meshes) wait for it.
 */
let on = false;
const subs = new Set<() => void>();

export function releaseDeferred() {
  if (on) return;
  on = true;
  subs.forEach((f) => f());
}

export function useDeferredReady(): boolean {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => on,
    () => false,
  );
}

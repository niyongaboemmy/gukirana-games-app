"use client";
import { createXRStore } from "@react-three/xr";

/** The one WebXR store of the persistent stage (gate + plaza); HUD buttons call `xrStore.enterVR()`. */
export const xrStore = createXRStore({
  emulate: false,
  hand: { teleportPointer: true },
  controller: { teleportPointer: true },
});

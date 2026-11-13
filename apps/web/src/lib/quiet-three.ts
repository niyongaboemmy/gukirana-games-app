import { setConsoleFunction } from "three";

/**
 * @react-three/fiber 9.8 (the latest) still creates a THREE.Clock, which three r183+ reports as deprecated on
 * every load. It is not our code and is harmless; drop only that one message, pass everything else through.
 */
setConsoleFunction((type: "log" | "warn" | "error", message: string, ...params: unknown[]) => {
  if (type === "warn" && message.startsWith("THREE.Clock: This module has been deprecated")) return;
  console[type](message, ...params);
});

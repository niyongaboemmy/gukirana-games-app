/**
 * P3-FGT-17 feature flag (docs/HUMAN-REALISM-VR-RESEARCH.md): the rebuilt ring bodies — the athletic sculpt, the baked
 * anatomy detail map, the skin shading pass, body-hugging garments and the re-proportioned gloves / headgear. ON unless
 * NEXT_PUBLIC_FF_BODY_V6=0, which falls back to the P3-FGT-16 bodies (boxer-{m,f}-v5.glb) and their shading.
 */
export const BODY_V6 = process.env.NEXT_PUBLIC_FF_BODY_V6 !== "0";

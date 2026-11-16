/**
 * P3-FGT-17 feature flag (docs/HUMAN-REALISM-VR-RESEARCH.md): the rebuilt ring bodies — the athletic sculpt, the baked
 * anatomy detail map, the skin shading pass, body-hugging garments and the re-proportioned gloves / headgear. ON unless
 * NEXT_PUBLIC_FF_BODY_V6=0, which falls back to the P3-FGT-16 bodies (boxer-{m,f}-v5.glb) and their shading.
 */
export const BODY_V6 = process.env.NEXT_PUBLIC_FF_BODY_V6 !== "0";

/**
 * P3-FGT-18 feature flag (docs/FIGHT-REALISM-V7.md): the art-director pass on the ring people — proportions fixed
 * from an anthropometric audit, a loose satin trunk and a flat vest, product-thick stitched headgear, the broadcast
 * ring lighting with shadows and ambient occlusion, the re-keyed guard. ON unless NEXT_PUBLIC_FF_BOXER_V7=0, which
 * falls back to the P3-FGT-17 bodies (boxer-{m,f}-v6.glb), their shading, lighting and guard. Needs BODY_V6.
 */
export const BOXER_V7 = BODY_V6 && process.env.NEXT_PUBLIC_FF_BOXER_V7 !== "0";

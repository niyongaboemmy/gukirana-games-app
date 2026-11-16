import * as THREE from "three";
import { agasekeTextures } from "./agaseke";
import {
  blobTexture,
  brickTexture,
  brushedAluTexture,
  concreteTexture,
  agasekeTexture,
  curtainWallTextures,
  grassTexture,
  hoardingTexture,
  arenaPerforatedTexture,
  imigongoDiamondTexture,
  standingSeamTexture,
  imigongoTexture,
  lavaStoneTexture,
  pavingTexture,
  pavingWearTexture,
  thatchTexture,
  woodTexture,
} from "./textures";
import { roofMembraneTexture } from "./roofs";
import { emissiveByTime } from "./time-of-day/hooks";
import { agasekeNight, arenaLedNight, arenaScreenNight, fightLedNight } from "./night/material-hooks";
import { glazingMaterial } from "./glazing";
import { GLAZED } from "./glass-capture";
import { weather } from "./weathering";
import { BENCHES, FOUNTAIN_COURT, FOUNTAIN_RADIUS, PAVING_R, PLAZA_RADIUS, PORTALS, ringPoint, SPAWN } from "./layout";

export type Tier = "lite" | "standard";

/** Game colours (DESIGN-SPEC §5.3). */
export const GAME_COLORS = {
  pool: "#2F80ED",
  ludo: "#FF8A1F",
  igisoro: "#27AE60",
  // the arena's accent: warm amber light (the app's chocolate primary-400; P2-WLD-17, was neon purple)
  arena: "#D6A06C",
  admin: "#C9A96B",
  fight: "#C8322A",
  soon: "#8A94A6",
  /** the neutral accent (totem strips, service pavilion, entry gate glow): warm amber — was sky blue, off-brand */
  sky: "#E8B67E",
  gold: "#FFC83D",
  warm: "#FFD9A0",
} as const;
export type LedKey = keyof typeof GAME_COLORS;

/**
 * LED material: unlit, not tone-mapped. It is daytime in the playground, so LEDs only just reach the Bloom threshold
 * (Standard, threshold 1) instead of glowing like night signage; on Lite (no bloom) they stay at their plain hue.
 */
export const LED_BOOST = { lite: 1.0, standard: 1.2 } as const;
export function ledMaterial(color: string, tier: Tier, boost = 1): THREE.MeshBasicMaterial {
  const c = new THREE.Color(color).multiplyScalar(LED_BOOST[tier] * boost);
  return new THREE.MeshBasicMaterial({ color: c, toneMapped: false, fog: true });
}

let shared: { tier: Tier; m: Record<string, THREE.Material> } | null = null;

/** Worn walking lines across the plaza: entrance → fountain → every door, plus the bench ring. */
function wearPaths(): { x: number; z: number }[][] {
  const paths: { x: number; z: number }[][] = [[{ x: SPAWN.x, z: SPAWN.z + 6 }, { x: 0, z: FOUNTAIN_RADIUS + 1 }]];
  for (const p of PORTALS.filter((q) => !q.ring)) paths.push([ringPoint(p.angleDeg, FOUNTAIN_RADIUS + 1), ringPoint(p.angleDeg, PLAZA_RADIUS - 1)]);
  for (const r of [FOUNTAIN_COURT - 1, FOUNTAIN_COURT + 6]) {
    const ring: { x: number; z: number }[] = [];
    for (let a = 0; a <= 360; a += 8) ring.push(ringPoint(a, r));
    paths.push(ring);
  }
  return paths;
}

/** Paving: slab texture (4.8 m tile) × a plaza-wide wear map sampled in world space (± WEAR_HALF m). */
const WEAR_HALF = PAVING_R + 0.5;
function pavingMaterial(): THREE.MeshStandardMaterial {
  const wear = pavingWearTexture(wearPaths(), [...BENCHES.map((b) => ({ x: b.x, z: b.z, r: 2.2 })), { x: 0, z: 0, r: FOUNTAIN_RADIUS + 2.4 }], WEAR_HALF);
  const m = new THREE.MeshStandardMaterial({ map: pavingTexture(), color: "#bcb4a8", roughness: 0.85, metalness: 0, envMapIntensity: 0.45 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWear = { value: wear };
    sh.vertexShader = "varying vec2 vGkW;\n" + sh.vertexShader.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n  vGkW = (modelMatrix * vec4(transformed, 1.0)).xz;");
    sh.fragmentShader =
      "uniform sampler2D uWear;\nvarying vec2 vGkW;\n" +
      sh.fragmentShader.replace(
        "#include <map_fragment>",
        // (the wear map covers the plaza only: beyond it — the campus walks, the avenue, the gate — a neutral tone, so
        // its clamped edge texels never streak out across the campus, P2-WLD-16)
        `#include <map_fragment>\n  float gkWear = 0.55 + 0.45 * texture2D(uWear, vGkW / ${(WEAR_HALF * 2).toFixed(1)} + 0.5).r * 1.0204;\n  diffuseColor.rgb *= mix(0.97, gkWear, 1.0 - smoothstep(${(WEAR_HALF - 3).toFixed(1)}, ${(WEAR_HALF - 0.5).toFixed(1)}, max(abs(vGkW.x), abs(vGkW.y))));`,
      );
  };
  m.customProgramCacheKey = () => "gk-paving-wear";
  return m;
}

/** The PBR palette: volcanic stone, concrete, timber, terracotta, glass, aluminium, Imigongo panels, LEDs. */
export function worldMaterials(tier: Tier): Record<string, THREE.Material> {
  if (shared && shared.tier === tier) return shared.m;
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  // weathering (P2-WLD-22, world/weathering.ts): world-space breakup, a soil-splash band at wall feet, rain streaks
  const W = <M extends THREE.Material>(mm: M, o: Parameters<typeof weather>[1]) => weather(mm, o, tier === "lite");
  // (one look for all masonry, render and board: materials with the same hook key still colour-fold into one batch)
  const STONE = { macro: 0.12, base: 0.32, baseH: 0.5, streak: 0.08 };
  const glassTex = curtainWallTextures(3);
  const glassTexCool = curtainWallTextures(8);
  const glassP = (t: { map: THREE.Texture; emissive: THREE.Texture }): THREE.MeshStandardMaterialParameters => ({
    map: t.map,
    emissiveMap: t.emissive,
    emissive: new THREE.Color("#e9d3ae"),
    emissiveIntensity: 0.3,
    metalness: 0,
    roughness: 0.05,
    envMapIntensity: 1.0,
  });
  const m: Record<string, THREE.Material> = {
    lava: W(std({ map: lavaStoneTexture(), bumpMap: lavaStoneTexture(), bumpScale: 1.2, roughness: 0.95, color: "#8e8b84" }), STONE),
    // honed granite slabs, albedo ≈ 0.35, with world-space grime / foot-traffic wear
    paving: W(pavingMaterial(), { macro: 0.14, base: 0, streak: 0, scale: 0.7 }),
    // flush sawn-basalt band under the wayfinding LEDs, granite + brass spawn medallion
    // (P2-WLD-09: a softer charcoal — the many kerb lines read as calm joints, not black stripes across the plaza)
    basalt: std({ map: concreteTexture(), color: "#605d57", roughness: 0.78 }),
    granite: W(std({ map: concreteTexture(), color: "#a8a196", roughness: 0.7 }), STONE),
    // each hall's glazing: smoked glass, the real forecourt reflected on it (P2-WLD-18, P2-WLD-20: no interior)
    ...Object.fromEntries(GLAZED.map((g) => [`glazing-${g}`, glazingMaterial(g, tier)])),
    basinFloor: std({ map: concreteTexture(), color: "#6d6a64", roughness: 0.9 }),
    brass: std({ color: "#9a7a45", metalness: 1, roughness: 0.45 }),
    aluBrushed: std({ map: brushedAluTexture(), color: "#d4d8de", metalness: 0.85, roughness: 0.42 }),
    // lamp heads: a faint warm glow on the diffuser by day (no bloom), lit at night (P2-WLD-19: the emissive intensity
    // is the time-of-day uniform uGkLamp, 0.15 by day → ~3.8 after dusk: blooms)
    lampHead: emissiveByTime(std({ color: "#f4f0e6", emissive: new THREE.Color("#ffe2b8"), emissiveIntensity: 1, roughness: 0.4 }), "uGkLamp", "gk-tod-lamp"),
    // soft contact / ambient-occlusion decals under furniture (the only grounding on Lite)
    ao: new THREE.MeshBasicMaterial({ map: blobTexture(), color: "#000000", transparent: true, opacity: tier === "lite" ? 0.5 : 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    concrete: W(std({ map: concreteTexture(), roughness: 0.85, color: "#e9e4da" }), STONE),
    // flat-roof single-ply membrane (P2-WLD-11, world/roofs.ts)
    roofMembrane: W(std({ map: roofMembraneTexture(), roughness: 0.8, color: "#e4e5e2" }), { macro: 0.16, base: 0, streak: 0 }),
    // Administrative Block: honed limestone cladding and dark bronze-anodised fins (matte)
    limestone: W(std({ map: concreteTexture(), roughness: 0.88, color: "#d8d0bf" }), STONE),
    bronze: std({ color: "#3f382f", roughness: 0.75, metalness: 0.2 }),
    concreteDark: W(std({ map: concreteTexture(), roughness: 0.8, color: "#8a857e" }), STONE),
    wood: std({ map: woodTexture(), roughness: 0.6, color: "#f0d6b8" }),
    woodDark: std({ map: woodTexture(), roughness: 0.55, color: "#7a5236" }),
    brick: W(std({ map: brickTexture(), roughness: 0.88 }), STONE),
    // dark neutral glazing reflecting the sky (no baked sunset), sparse warm interior panes
    // (P2-WLD-19: the lit interior panes glow ~4× after dusk: time-of-day uniform uGkWin)
    glass: emissiveByTime(std(glassP(glassTex)), "uGkWin", "gk-tod-win"),
    glassCool: emissiveByTime(std(glassP(glassTexCool)), "uGkWin", "gk-tod-win"),
    // see-through shopfront glass (café): the interior behind it is modelled
    glassClear: std({ color: "#3a4a52", metalness: 0, roughness: 0.04, envMapIntensity: 1.0, transparent: true, opacity: 0.32, depthWrite: false }),
    alu: std({ color: "#d8dce2", metalness: 1, roughness: 0.32 }),
    steel: std({ color: "#3a3f47", metalness: 0.9, roughness: 0.4 }),
    white: W(std({ color: "#f3f1ec", roughness: 0.45, metalness: 0.05 }), STONE),
    imigongo: std({ map: imigongoTexture(1), roughness: 0.75 }),
    diamond: std({ map: imigongoDiamondTexture(), roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide }),
    // Tournament Arena (P2-WLD-17): dark chocolate (crown, canopy, fascias, mullions, columns, inner drum) with a soft
    // metallic sheen; the perforated bronze screen panels; the standing-seam dome
    choco: std({ color: "#3b2416", roughness: 0.5, metalness: 0.35 }),
    // (P2-WLD-21: at night the inner drum's warm light shines through the holes in slow rising waves, night/material-hooks)
    arenaScreen: arenaScreenNight(std({ map: arenaPerforatedTexture(), roughness: 0.42, metalness: 0.55, side: THREE.DoubleSide })),
    arenaRoof: std({ map: standingSeamTexture(), roughness: 0.48, metalness: 0.5 }),
    diamondDark: std({ map: imigongoDiamondTexture("#14161c", "#7a3a22", "#2c2f37"), roughness: 0.5, metalness: 0.6 }),
    grass: std({ map: grassTexture(), roughness: 1, color: "#d8f0c8" }),
    // clipped hedges: leaf clumps from world-space noise (were one flat green: P2-WLD-22)
    hedge: W(std({ color: "#33672d", roughness: 0.95 }), { macro: 0.18, base: 0.3, baseH: 0.35, streak: 0, leaf: true }),
    soil: std({ color: "#2b2420", roughness: 1 }),
    water: std({ color: "#2b4a52", metalness: 0, roughness: 0.04, envMapIntensity: 1.6, transparent: true, opacity: 0.9 }),
    fabric: std({ color: "#f4efe6", roughness: 0.9, side: THREE.DoubleSide }),
    screenFrame: std({ color: "#15171d", metalness: 0.6, roughness: 0.35 }),
    asphalt: std({ map: concreteTexture(), color: "#3a3c40", roughness: 0.95 }),
    thatch: W(std({ map: thatchTexture(), bumpMap: thatchTexture(), bumpScale: 1.5, color: "#c2a47a", roughness: 1, side: THREE.DoubleSide }), { macro: 0.2, base: 0, streak: 0, scale: 0.7 }),
    // (the fountain sculpture only; P2-WLD-21: grazed by six basin uplights at night)
    agaseke: agasekeNight(std({ map: agasekeTexture(), bumpMap: agasekeTextures().bump, bumpScale: 0.8, roughness: 0.88 })),
    hoarding: W(std({ map: hoardingTexture(), roughness: 0.7 }), STONE),
    "paint-orange": std({ color: "#F28C28", roughness: 0.7, side: THREE.DoubleSide }),
    "paint-teal": std({ color: "#159A9C", roughness: 0.7, side: THREE.DoubleSide }),
    "paint-pink": std({ color: "#E4508F", roughness: 0.7, side: THREE.DoubleSide }),
    "paint-yellow": std({ color: "#F2C230", roughness: 0.55, metalness: 0.2 }),
    jet: new THREE.MeshStandardMaterial({ color: "#dff3ff", transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.1, depthWrite: false }),
    "led-red": ledMaterial("#ff2a2a", tier),
    // (the arena's amber lines; P2-WLD-21: brighter at night, the roof edge and the lantern breathing)
    "led-halo": arenaLedNight(ledMaterial(GAME_COLORS.arena, tier)),
    // LEDs (unlit)
    "led-pool": ledMaterial(GAME_COLORS.pool, tier),
    "led-ludo": ledMaterial(GAME_COLORS.ludo, tier),
    "led-igisoro": ledMaterial(GAME_COLORS.igisoro, tier),
    "led-arena": ledMaterial(GAME_COLORS.arena, tier),
    "led-admin": ledMaterial(GAME_COLORS.admin, tier, 0.7),
    // (Fight Games' red / blue lines; P2-WLD-21: a slow night pulse, red and blue trading places)
    "led-fight": fightLedNight(ledMaterial(GAME_COLORS.fight, tier), 0),
    "led-corner-blue": fightLedNight(ledMaterial("#2F5DB0", tier, 0.9), 0.5),
    charcoal: W(std({ map: concreteTexture(), color: "#6a6a70", roughness: 0.85 }), STONE),
    "led-soon": ledMaterial(GAME_COLORS.soon, tier, 0.5),
    "led-sky": ledMaterial(GAME_COLORS.sky, tier),
    "led-gold": ledMaterial(GAME_COLORS.gold, tier, 0.9),
    "led-warm": ledMaterial(GAME_COLORS.warm, tier, 0.8),
  };
  shared = { tier, m };
  return m;
}

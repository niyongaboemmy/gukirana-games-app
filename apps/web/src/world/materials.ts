import * as THREE from "three";
import {
  brickTexture,
  concreteTexture,
  agasekeTexture,
  curtainWallTextures,
  grassTexture,
  hoardingTexture,
  imigongoDiamondTexture,
  imigongoTexture,
  lavaStoneTexture,
  pavingTexture,
  woodTexture,
} from "./textures";

export type Tier = "lite" | "standard";

/** Game colours (DESIGN-SPEC §5.3). */
export const GAME_COLORS = {
  pool: "#2F80ED",
  ludo: "#FF8A1F",
  igisoro: "#27AE60",
  arena: "#9B51E0",
  soon: "#8A94A6",
  sky: "#3DA9FC",
  gold: "#FFC83D",
  warm: "#FFD9A0",
} as const;
export type LedKey = keyof typeof GAME_COLORS;

/**
 * LED material: unlit, not tone-mapped, colour pushed above 1.0 so Bloom (Standard tier, threshold 1) only catches
 * the LED ribbons. On Lite there is no bloom, so the boost is small to keep the hue.
 */
export function ledMaterial(color: string, tier: Tier, boost = 1): THREE.MeshBasicMaterial {
  const c = new THREE.Color(color).multiplyScalar((tier === "lite" ? 1.15 : 2.6) * boost);
  return new THREE.MeshBasicMaterial({ color: c, toneMapped: false, fog: true });
}

let shared: { tier: Tier; m: Record<string, THREE.Material> } | null = null;

/** The PBR palette: volcanic stone, concrete, timber, terracotta, glass, aluminium, Imigongo panels, LEDs. */
export function worldMaterials(tier: Tier): Record<string, THREE.Material> {
  if (shared && shared.tier === tier) return shared.m;
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  const glassTex = curtainWallTextures("#FFB46B", 3);
  const glassTexCool = curtainWallTextures("#9fd4ff", 8);
  const m: Record<string, THREE.Material> = {
    lava: std({ map: lavaStoneTexture(), bumpMap: lavaStoneTexture(), bumpScale: 2.5, roughness: 0.92, color: "#9a9890" }),
    // light granite/concrete albedo ≈ 0.4 (was near-white): darker tint, matte
    paving: std({ map: pavingTexture(), color: "#c4bdb2", roughness: 0.8, metalness: 0, envMapIntensity: 0.45 }),
    concrete: std({ map: concreteTexture(), roughness: 0.85, color: "#e9e4da" }),
    concreteDark: std({ map: concreteTexture(), roughness: 0.8, color: "#6f6c68" }),
    wood: std({ map: woodTexture(), roughness: 0.6, color: "#f0d6b8" }),
    woodDark: std({ map: woodTexture(), roughness: 0.55, color: "#7a5236" }),
    brick: std({ map: brickTexture(), roughness: 0.88 }),
    glass: std({
      map: glassTex.map,
      emissiveMap: glassTex.emissive,
      emissive: new THREE.Color("#ffffff"),
      emissiveIntensity: 1.25,
      metalness: 0.85,
      roughness: 0.08,
      envMapIntensity: 1.4,
    }),
    glassCool: std({
      map: glassTexCool.map,
      emissiveMap: glassTexCool.emissive,
      emissive: new THREE.Color("#ffffff"),
      emissiveIntensity: 1.0,
      metalness: 0.85,
      roughness: 0.06,
      envMapIntensity: 1.5,
    }),
    alu: std({ color: "#d8dce2", metalness: 1, roughness: 0.32 }),
    steel: std({ color: "#3a3f47", metalness: 0.9, roughness: 0.4 }),
    white: std({ color: "#f3f1ec", roughness: 0.45, metalness: 0.05 }),
    imigongo: std({ map: imigongoTexture(1), roughness: 0.75 }),
    diamond: std({ map: imigongoDiamondTexture(), roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide }),
    diamondDark: std({ map: imigongoDiamondTexture("#14161c", "#7a3a22", "#2c2f37"), roughness: 0.5, metalness: 0.6 }),
    grass: std({ map: grassTexture(), roughness: 1, color: "#d8f0c8" }),
    hedge: std({ color: "#2f6b33", roughness: 0.95 }),
    soil: std({ color: "#2b2420", roughness: 1 }),
    water: std({ color: "#2b4a52", metalness: 0, roughness: 0.04, envMapIntensity: 1.6, transparent: true, opacity: 0.9 }),
    fabric: std({ color: "#f4efe6", roughness: 0.9, side: THREE.DoubleSide }),
    screenFrame: std({ color: "#15171d", metalness: 0.6, roughness: 0.35 }),
    asphalt: std({ map: concreteTexture(), color: "#3a3c40", roughness: 0.95 }),
    thatch: std({ map: woodTexture(), color: "#b08a55", roughness: 0.95 }),
    agaseke: std({ map: agasekeTexture(), roughness: 0.8 }),
    hoarding: std({ map: hoardingTexture(), roughness: 0.7 }),
    "paint-orange": std({ color: "#F28C28", roughness: 0.7, side: THREE.DoubleSide }),
    "paint-teal": std({ color: "#159A9C", roughness: 0.7, side: THREE.DoubleSide }),
    "paint-pink": std({ color: "#E4508F", roughness: 0.7, side: THREE.DoubleSide }),
    "paint-yellow": std({ color: "#F2C230", roughness: 0.55, metalness: 0.2 }),
    jet: new THREE.MeshStandardMaterial({ color: "#dff3ff", transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.1, depthWrite: false }),
    "led-red": ledMaterial("#ff2a2a", tier),
    "led-halo": ledMaterial(GAME_COLORS.arena, tier),
    // LEDs (unlit)
    "led-pool": ledMaterial(GAME_COLORS.pool, tier),
    "led-ludo": ledMaterial(GAME_COLORS.ludo, tier),
    "led-igisoro": ledMaterial(GAME_COLORS.igisoro, tier),
    "led-arena": ledMaterial(GAME_COLORS.arena, tier),
    "led-soon": ledMaterial(GAME_COLORS.soon, tier, 0.5),
    "led-sky": ledMaterial(GAME_COLORS.sky, tier),
    "led-gold": ledMaterial(GAME_COLORS.gold, tier, 0.9),
    "led-warm": ledMaterial(GAME_COLORS.warm, tier, 0.8),
  };
  shared = { tier, m };
  return m;
}

"use client";
import { useGLTF } from "@react-three/drei";
import { useLoader } from "@react-three/fiber";
import { BitmapTextureLoader } from "@/world/bitmap-texture";
import { INTERIOR_BASE, model, type PbrName } from "./interior-kit";
import { ballAtlas, diceAtlas, feltTexture, imigongo, imigongoPanel, leafCard, loungeRug } from "./room-textures";
import { calmKitenge, KITENGE_ART, KITENGE_RUG, ludoMenu, ludoTableBoard, tableNumbers } from "./ludo-textures";
import type { HallGame } from "./layouts";
import { useStage } from "@/world/stage";

/** What each hall loads (keep in sync with PoolHall / LudoLounge / IgisoroCourt). */
const HALL_ASSETS: Record<HallGame, { models: string[]; pbr: [PbrName, boolean][] }> = {
  pool: {
    models: ["mid_century_lounge_chair", "potted_plant_02", "sofa_02", "wine_bottles_01"],
    pbr: [["oak_veneer_01", true], ["velour_velvet", false], ["white_plaster_02", true]],
  },
  ludo: {
    models: ["modern_arm_chair_01", "Ottoman_01", "potted_plant_02", "potted_plant_04"],
    pbr: [["herringbone_parquet", true], ["oak_veneer_01", true], ["velour_velvet", false], ["white_plaster_02", false]],
  },
  igisoro: {
    models: ["potted_plant_02", "wicker_basket_01", "wicker_basket_02", "wooden_bowl_01", "wooden_stool_02"],
    pbr: [["bark_brown_02", true], ["clay_plaster", true], ["rough_wood", true], ["tatami_mat", true], ["terracotta_floor_tiles", true], ["thatch_roof_angled", true], ["wood_table_worn", true]],
  },
};

const done = new Set<HallGame>();

/** Warm a hall (called every frame while the player is within 12 m of its door), so entering shows no loading gap. */
export function preloadHall(game: HallGame) {
  // mount the hall hidden in the persistent stage: compiled + uploaded before you reach the threshold
  if (useStage.getState().view === "plaza") useStage.getState().warmHall(game);
  if (done.has(game)) return;
  done.add(game);
  const a = HALL_ASSETS[game];
  for (const m of a.models) useGLTF.preload(model(m));
  for (const [name, withMap] of a.pbr) {
    const urls = [`${INTERIOR_BASE}/tex/${name}_nor.webp`, `${INTERIOR_BASE}/tex/${name}_rough.webp`, ...(withMap ? [`${INTERIOR_BASE}/tex/${name}_diff.webp`] : [])];
    useLoader.preload(BitmapTextureLoader, urls);
  }
}

/**
 * Paint the halls' procedural canvas textures in idle time while you are in the plaza (one per idle slice), so the
 * pre-warm of a hall you walk up to finds them ready (rooms/room-textures caches them for the session).
 */
export function prewarmRoomTextures() {
  const jobs: (() => unknown)[] = [
    () => feltTexture("#1a4e85"),
    () => ballAtlas(),
    () => loungeRug(),
    () => ludoTableBoard(),
    () => diceAtlas(),
    () => calmKitenge(KITENGE_RUG),
    () => calmKitenge(KITENGE_ART, [1, 1]),
    () => ludoMenu(),
    () => tableNumbers(),
    () => leafCard(),
    () => imigongoPanel(0),
    () => imigongoPanel(1),
    () => imigongo([20, 1]),
  ];
  const idle = (cb: () => void) => (typeof requestIdleCallback === "function" ? requestIdleCallback(cb, { timeout: 4000 }) : setTimeout(cb, 120));
  const next = () => {
    const job = jobs.shift();
    if (!job) return;
    job();
    idle(next);
  };
  idle(next);
}

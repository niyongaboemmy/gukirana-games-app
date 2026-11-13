"use client";
import { useGLTF, useTexture } from "@react-three/drei";
import { INTERIOR_BASE, model, type PbrName } from "./interior-kit";
import type { HallGame } from "./layouts";

/** What each hall loads (keep in sync with PoolHall / LudoLounge / IgisoroCourt). */
const HALL_ASSETS: Record<HallGame, { models: string[]; pbr: [PbrName, boolean][] }> = {
  pool: {
    models: ["dartboard", "hanging_industrial_lamp", "mid_century_lounge_chair", "potted_plant_02", "sofa_02", "wine_bottles_01"],
    pbr: [["black_walnut_veneer_01", true], ["brown_leather", true], ["dark_wooden_planks", true], ["red_brick_03", true], ["velour_velvet", false]],
  },
  ludo: {
    models: ["modern_arm_chair_01", "modern_ceiling_lamp_01", "potted_plant_02", "potted_plant_04", "throw_pillows_01"],
    pbr: [["herringbone_parquet", true], ["oak_veneer_01", true], ["velour_velvet", false], ["white_plaster_02", true]],
  },
  igisoro: {
    models: ["potted_plant_02", "wicker_basket_01", "wicker_basket_02", "wooden_bowl_01", "wooden_stool_02"],
    pbr: [["bark_brown_02", true], ["clay_plaster", true], ["rough_wood", true], ["tatami_mat", true], ["terracotta_floor_tiles", true], ["thatch_roof_angled", true], ["wood_table_worn", true]],
  },
};

const done = new Set<HallGame>();

/** Warm the caches for a hall (called as the player walks towards its door), so entering shows no loading gap. */
export function preloadHall(game: HallGame) {
  if (done.has(game)) return;
  done.add(game);
  const a = HALL_ASSETS[game];
  for (const m of a.models) useGLTF.preload(model(m));
  for (const [name, withMap] of a.pbr) {
    const urls = [`${INTERIOR_BASE}/tex/${name}_nor.webp`, `${INTERIOR_BASE}/tex/${name}_rough.webp`, ...(withMap ? [`${INTERIOR_BASE}/tex/${name}_diff.webp`] : [])];
    useTexture.preload(urls);
  }
}

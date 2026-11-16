import { BODY_V6, BOXER_V7 } from "./body-v6";

/**
 * P3-FGT-19B (docs/FIGHT-REALISM-V8.md): which generation of ring people the app loads, and where each generation's
 * assets live. One switch for the whole loading path, so the v8 fighters can land behind a flag with v7 as the
 * fallback:
 *
 *  - `NEXT_PUBLIC_FF_BOXER_V8=1` turns the v8 fighters on (default OFF until the v8 design passes its acceptance
 *    checklist, docs/design/fighter-v8/SPEC.md). Needs v7 (it builds on the v7 rig, clips and ring lighting).
 *  - In development builds the labs and the QA harness (qa/e2e/fighter-v8) can pick a generation per page with
 *    `?boxer=v7|v8`, so one dev server renders the before / after pairs.
 *  - The v8 asset set is only used once it is marked shipped (`V8_ASSETS_READY`); until then a v8 request falls
 *    back to the v7 assets, so turning the flag on can never load a missing file.
 */
export type BoxerGeneration = "v5" | "v6" | "v7" | "v8";
export type BoxerGender = "m" | "f";

/** set to true in the commit that ships apps/web/public/assets/characters/v8/* (Phase 1 of P3-FGT-19B) */
export const V8_ASSETS_READY = false;

export interface GenerationInput {
  /** NEXT_PUBLIC_FF_BODY_V6 / _BOXER_V7 resolved */
  v6: boolean;
  v7: boolean;
  /** NEXT_PUBLIC_FF_BOXER_V8 raw value */
  v8Env: string | undefined;
  /** location.search (null on the server / in tests) */
  search: string | null;
  /** development build: the per-page override is honoured */
  dev: boolean;
  /** the v8 asset set is shipped */
  v8Ready: boolean;
}

/** The generation to load (pure: tested in generation.test.ts). */
export function generationOf(i: GenerationInput): BoxerGeneration {
  const base: BoxerGeneration = !i.v6 ? "v5" : !i.v7 ? "v6" : "v7";
  if (base !== "v7") return base;
  return v8Requested(i) && i.v8Ready ? "v8" : "v7";
}

/** what was asked for (the flag or the override), whether or not the assets are there: the harness reports it */
export function v8Requested(i: Pick<GenerationInput, "v8Env" | "search" | "dev">): boolean {
  if (i.dev && i.search) {
    const o = new URLSearchParams(i.search).get("boxer");
    if (o === "v7" || o === "v8") return o === "v8";
  }
  return i.v8Env === "1";
}

const SEARCH = typeof window === "undefined" ? null : window.location.search;
const DEV = process.env.NODE_ENV !== "production";

export const BOXER_GENERATION: BoxerGeneration = generationOf({ v6: BODY_V6, v7: BOXER_V7, v8Env: process.env.NEXT_PUBLIC_FF_BOXER_V8, search: SEARCH, dev: DEV, v8Ready: V8_ASSETS_READY });
/** P3-FGT-19B: the v8 fighters are loaded (flag on and assets shipped) */
export const BOXER_V8 = BOXER_GENERATION === "v8";
/** P3-FGT-19B: v8 was asked for (it may have fallen back to v7 while the assets are not shipped) */
export const BOXER_V8_REQUESTED = v8Requested({ v8Env: process.env.NEXT_PUBLIC_FF_BOXER_V8, search: SEARCH, dev: DEV });

export interface BoxerAssetSet {
  generation: BoxerGeneration;
  /** the ring-people GLB per gender */
  glb: Record<BoxerGender, string>;
  /** photo skin (albedo), full and phone / Lite resolution */
  skin: (g: BoxerGender, lite: boolean) => string;
  /** baked anatomy detail (RG detail normal, B cavity) */
  anatomy: (g: BoxerGender) => string;
  /** textures are KTX2 / Basis (world/human/boxer/v8/ktx2.ts) */
  ktx2: boolean;
}

const C = "/assets/characters";
const LEGACY_SKIN = (g: BoxerGender, lite: boolean) => `${C}/skin-${g}${lite ? "-1k" : ""}.webp`;
const LEGACY_ANATOMY = (g: BoxerGender) => `${C}/body-detail-${g}.webp`;

const SETS: Record<BoxerGeneration, BoxerAssetSet> = {
  v5: { generation: "v5", glb: { m: `${C}/boxer-m-v5.glb`, f: `${C}/boxer-f-v5.glb` }, skin: LEGACY_SKIN, anatomy: LEGACY_ANATOMY, ktx2: false },
  v6: { generation: "v6", glb: { m: `${C}/boxer-m-v6.glb`, f: `${C}/boxer-f-v6.glb` }, skin: LEGACY_SKIN, anatomy: LEGACY_ANATOMY, ktx2: false },
  v7: { generation: "v7", glb: { m: `${C}/boxer-m.glb`, f: `${C}/boxer-f.glb` }, skin: LEGACY_SKIN, anatomy: LEGACY_ANATOMY, ktx2: false },
  // the v8 set: its own folder, so v7 stays byte-for-byte as the fallback
  v8: {
    generation: "v8",
    glb: { m: `${C}/v8/boxer-m.glb`, f: `${C}/v8/boxer-f.glb` },
    skin: (g, lite) => `${C}/v8/skin-${g}${lite ? "-1k" : ""}.ktx2`,
    anatomy: (g) => `${C}/v8/body-detail-${g}.ktx2`,
    ktx2: true,
  },
};

export function boxerAssets(gen: BoxerGeneration = BOXER_GENERATION): BoxerAssetSet {
  return SETS[gen];
}

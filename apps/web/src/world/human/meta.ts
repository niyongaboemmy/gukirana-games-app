import type { BodyType } from "../outfits";

/**
 * Realistic human assets (Microsoft Rocketbox avatar library, MIT licence — see docs/ASSET-LICENSES.md).
 * Built offline from the original FBX files: FBX2glTF → texture resize to 1024 px WebP → meshopt compression,
 * plus a per-texel recolour mask (R skin · G top/hair · B bottom/collar) derived from skin weights, UV islands and
 * skin-colour classification. Values below come from that build (scripts documented in docs/ASSET-LICENSES.md).
 */
export type HumanModelId = BodyType | "guard";

export interface HumanModelMeta {
  url: string;
  anim: "m" | "f";
  /** Rest height of the Bip01 root (m) — animation root translation is scaled by hipY / clip rootY. */
  hipY: number;
  /** Mean skin albedo of the base texture (linear RGB), used to re-tint skin to the chosen tone. */
  skinRef: [number, number, number];
  /** Mean linear luminance of each recolourable region in the base texture (keeps fabric folds when recoloured). */
  regions: { skin: number; top: number; bottom: number; shoes: number; hair: number };
  /** Base model already has hair cards (separate mesh named "haircards"). */
  hairCards: boolean;
  /** The base head has a painted beard (shaved off in the shader unless the chosen facial hair covers it). */
  beard?: boolean;
}

const BASE = "/assets/characters";

export const HUMAN_MODELS: Record<HumanModelId, HumanModelMeta> = {
  masculine: {
    url: `${BASE}/masculine.glb`,
    anim: "m",
    hipY: 0.8952,
    skinRef: [0.0872, 0.0335, 0.0184],
    regions: { skin: 0.0637, top: 0.0855, bottom: 0.1527, shoes: 0.3992, hair: 0.0066 },
    hairCards: false,
  },
  feminine: {
    url: `${BASE}/feminine.glb`,
    anim: "f",
    hipY: 0.9233,
    skinRef: [0.4608, 0.1791, 0.0697],
    regions: { skin: 0.1811, top: 0.0594, bottom: 0.0082, shoes: 0.0261, hair: 0.0091 },
    hairCards: true,
  },
  neutral: {
    url: `${BASE}/neutral.glb`,
    anim: "m",
    hipY: 0.8952,
    skinRef: [0.2368, 0.0818, 0.0308],
    regions: { skin: 0.1284, top: 0.1166, bottom: 0.0357, shoes: 0.3117, hair: 0.012 },
    hairCards: false,
    beard: true,
  },
  guard: {
    url: `${BASE}/guard.glb`,
    anim: "m",
    hipY: 0.8952,
    skinRef: [0.38, 0.1448, 0.0863],
    regions: { skin: 0.2358, top: 0.039, bottom: 0.0078, shoes: 0.0061, hair: 0.0653 },
    hairCards: false,
  },
};

export type BaseClipKey = "idle" | "walk" | "walkfast" | "run" | "sprint" | "wave" | "clap" | "dance" | "sit" | "sitdown" | "standup" | "talk";
/** Everyday-life clips (life-*.glb, lazy-loaded after the base set): see docs/PEOPLE-BEHAVIOUR.md. */
export type LifeClipKey =
  | "idle2"
  | "look"
  | "phone"
  | "stretch"
  | "dust"
  | "fold"
  | "nod"
  | "shake"
  | "laugh"
  | "shrug"
  | "think"
  | "cheer"
  | "listen"
  | "drink"
  | "photo"
  | "sitb"
  | "sitlook";
export type ClipKey = BaseClipKey | LifeClipKey;

export interface AnimSetMeta {
  url: string;
  /** everyday-life clips on the same skeleton (lazy) */
  lifeUrl: string;
  rootY: number;
  /** native ground speed (m/s) of the in-place locomotion cycles, measured from the root motion before it was removed */
  speed: Partial<Record<ClipKey, number>>;
}

export const ANIM_SETS: Record<"m" | "f", AnimSetMeta> = {
  m: { url: `${BASE}/anim-m.glb`, lifeUrl: `${BASE}/life-m.glb`, rootY: 0.8952, speed: { walk: 1.012, walkfast: 1.495, run: 2.88, sprint: 5.839 } },
  f: { url: `${BASE}/anim-f.glb`, lifeUrl: `${BASE}/life-f.glb`, rootY: 0.9194, speed: { walk: 1.214, walkfast: 1.53, run: 2.765, sprint: 5.379 } },
};

/**
 * Sit-down / stand-up timing per skeleton set (measured on the clips' root tracks): the mocap starts with a long
 * standing lead-in (f: 1.2 s) and ends with a slow settle, so playback starts at `offset`, runs at `scale`, and the
 * state machine moves on at clip time `done`. `front` = how far in front of the seat the person stands when the
 * sit-down starts (root z at `offset`), i.e. where the walk up to the bench has to end; `upFront` = where the
 * stand-up ends (root z at `done`).
 */
export const SIT_TIMING: Record<"m" | "f", { down: { offset: number; scale: number; done: number }; up: { offset: number; scale: number; done: number }; front: number; upFront: number }> = {
  m: { down: { offset: 0.3, scale: 1.2, done: 1.95 }, up: { offset: 0.45, scale: 1.25, done: 1.95 }, front: 0.4, upFront: 0.41 },
  f: { down: { offset: 1.15, scale: 1.5, done: 3.3 }, up: { offset: 1.2, scale: 1.4, done: 2.7 }, front: 0.43, upFront: 0.41 },
};
/** Wall-clock length of the sit-down / stand-up transitions (s). */
export const sitDownSeconds = (set: "m" | "f") => (SIT_TIMING[set].down.done - SIT_TIMING[set].down.offset) / SIT_TIMING[set].down.scale;
export const standUpSeconds = (set: "m" | "f") => (SIT_TIMING[set].up.done - SIT_TIMING[set].up.offset) / SIT_TIMING[set].up.scale;

/** Seat height the seated loop (anim 13) is built for; the avatar origin is the seat centre on the floor. */
export const SEAT_HEIGHT = 0.46;

export const ALL_HUMAN_URLS = [...Object.values(HUMAN_MODELS).map((m) => m.url), ...Object.values(ANIM_SETS).map((a) => a.url)];

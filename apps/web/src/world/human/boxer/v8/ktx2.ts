import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

/**
 * P3-FGT-19B: KTX2 / Basis Universal textures for the v8 fighters (docs/FIGHT-REALISM-V8.md §Textures). A 2048² RGBA8
 * texture is 21 MB on the GPU with mips; the same map as ETC1S (colour) or UASTC (normals / detail) transcodes to a
 * GPU block format (BC7 / ASTC 4×4 / ETC2: 1 byte per texel; BC1 / ETC1: 0.5) — 4–8× less memory, and the download
 * is smaller than the WebP. Encoded by apps/web/scripts/boxer/ktx2.mjs (basisu), transcoded in a worker by three's
 * Basis transcoder (copied to /basis/, Apache-2.0, docs/ASSET-LICENSES.md).
 *
 * The loader needs the renderer (to pick the block format the GPU supports): BoxerAvatar registers it; loads asked
 * for earlier wait for it. Only the v8 asset set uses this path (generation.ts `ktx2: true`).
 */
export const BASIS_TRANSCODER_PATH = "/basis/";

let loader: KTX2Loader | null = null;
const waiting: (() => void)[] = [];

/** Give the KTX2 loader the renderer (once; later calls are ignored). */
export function registerKtx2Renderer(gl: THREE.WebGLRenderer) {
  if (loader) return;
  loader = new KTX2Loader().setTranscoderPath(BASIS_TRANSCODER_PATH).detectSupport(gl);
  for (const f of waiting.splice(0)) f();
}

export const isKtx2 = (url: string) => /\.ktx2(\?|$)/i.test(url);

interface Entry {
  tex: THREE.Texture | null;
  wait: ((t: THREE.Texture) => void)[];
}
const CACHE = new Map<string, Entry>();

export interface TexOpts {
  repeat?: boolean;
  /** colour data (albedo) vs data (normals, masks) */
  srgb?: boolean;
  anisotropy?: number;
}

/**
 * Load a texture (KTX2 or an image) into a uniform slot; `onLoad` runs once it is there. Cached by URL: every person
 * shares one GPU copy. Image textures keep the boxer pipeline's conventions (flipY false, NoColorSpace unless srgb).
 */
export function loadTextureInto(slot: { value: THREE.Texture | null }, url: string, opts: TexOpts, onLoad: () => void) {
  const put = (t: THREE.Texture) => {
    slot.value = t;
    onLoad();
  };
  const hit = CACHE.get(url);
  if (hit) {
    if (hit.tex) queueMicrotask(() => put(hit.tex!));
    else hit.wait.push(put);
    return;
  }
  const e: Entry = { tex: null, wait: [put] };
  CACHE.set(url, e);
  const done = (t: THREE.Texture) => {
    t.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = opts.anisotropy ?? 4;
    if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    e.tex = t;
    for (const f of e.wait.splice(0)) f(t);
  };
  if (isKtx2(url)) {
    const go = () => loader!.load(url, done, undefined, (err) => console.warn("ktx2: failed", url, err));
    if (loader) go();
    else waiting.push(go);
  } else {
    const t = new THREE.TextureLoader().load(url, () => done(t));
    t.flipY = false;
  }
}

/** the KTX2 textures loaded so far (the harness's texture-memory count reads their mip chains) */
export function ktx2Loaded(): THREE.Texture[] {
  return [...CACHE.values()].map((e) => e.tex).filter((t): t is THREE.Texture => !!t && (t as THREE.CompressedTexture).isCompressedTexture === true);
}

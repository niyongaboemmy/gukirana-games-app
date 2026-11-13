import * as THREE from "three";

/**
 * Texture loader that decodes images OFF the main thread (P1-WLD-05).
 *
 * THREE.TextureLoader hands WebGL an <img>: the browser decodes the WebP/JPEG lazily, synchronously, inside the
 * first `texImage2D` (a 1024² WebP costs 30–80 ms on the main thread, i.e. a dropped frame while you walk up to a
 * hall that is pre-warming). `createImageBitmap` decodes on the browser's decoder threads instead, so the upload is
 * a plain copy. The bitmap is decoded already flipped (`imageOrientation: "flipY"`), so the texture behaves exactly
 * like a TextureLoader texture (same UVs), with `flipY = false` (WebGL ignores UNPACK_FLIP_Y for bitmaps anyway).
 *
 * Shape-compatible with R3F's `useLoader` (constructor(manager), load(url, onLoad, onProgress, onError)).
 */
export class BitmapTextureLoader extends THREE.Loader<THREE.Texture> {
  private readonly bitmaps: THREE.ImageBitmapLoader | null;
  private readonly fallback: THREE.TextureLoader;

  constructor(manager?: THREE.LoadingManager) {
    super(manager);
    this.fallback = new THREE.TextureLoader(manager);
    this.bitmaps = typeof createImageBitmap === "function" ? new THREE.ImageBitmapLoader(manager) : null;
    this.bitmaps?.setOptions({ imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" });
  }

  override load(url: string, onLoad?: (t: THREE.Texture) => void, onProgress?: (e: ProgressEvent) => void, onError?: (e: unknown) => void): THREE.Texture {
    if (!this.bitmaps) return this.fallback.load(url, onLoad, onProgress, onError);
    const texture = new THREE.Texture();
    this.bitmaps.setCrossOrigin(this.crossOrigin);
    this.bitmaps.setPath(this.path);
    this.bitmaps.load(
      url,
      (bitmap) => {
        texture.image = bitmap;
        texture.flipY = false;
        texture.needsUpdate = true;
        onLoad?.(texture);
      },
      onProgress,
      onError,
    );
    return texture;
  }
}

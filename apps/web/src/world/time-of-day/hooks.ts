import * as THREE from "three";

/**
 * Shared time-of-day uniforms and material hooks (P2-WLD-19). Every changing value reaches the GPU as a uniform:
 * a time change never recompiles a shader (the programs are built once, at mount, with these hooks in place).
 *
 * Why hooks and not `material.emissiveIntensity = …`: the outdoor StaticMerge batches meshes by their materials'
 * VALUE signature and takes a mesh whose material signature changes out of the batch for good (it must be animated).
 * A material with a shader hook is keyed by its uuid instead, so its uniforms can change every frame while the
 * meshes stay merged. Only materials that never colour-fold with others get a hook (the LED palette folds into one
 * draw call and is left alone: LEDs read brighter at night by themselves, against the dark).
 */
export const todUniforms = {
  /** lamp diffusers (world material `lampHead`): emissive intensity, 0.15 by day → ~3.8 at night (blooms) */
  uGkLamp: { value: 0.15 },
  /** facade window panes (`glass`, `glassCool`): emissive multiplier, 1 by day → ~4 at night (warm lit rooms) */
  uGkWin: { value: 1 },
  /** volcano / far-hill haze colour (sRGB, applied after the colour-space conversion: Landscape volcano shader) */
  uGkHaze: { value: new THREE.Vector3(0.706, 0.765, 0.812) },
  /** tint of unlit "daylight-baked" shader materials (fountain spray): white by day, dim blue at night */
  uGkUnlit: { value: new THREE.Color(1, 1, 1) },
};

/** Multiply a standard material's emissive by a time-of-day uniform (set before its first compile). */
export function emissiveByTime(m: THREE.MeshStandardMaterial, uniform: "uGkLamp" | "uGkWin", key: string): THREE.MeshStandardMaterial {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms[uniform] = todUniforms[uniform];
    sh.fragmentShader = `uniform float ${uniform};\n` + sh.fragmentShader.replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n  totalEmissiveRadiance *= ${uniform};`);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

/**
 * Unlit materials that carry daylight in their colour (tree impostors, mist banks, fountain ripples / foam): their
 * colour follows the time-of-day `unlit` tint (registered with their daylight colour). Weakly held: a material that is
 * garbage-collected drops out (not on `dispose`: React StrictMode disposes and then reuses memoised materials). Only
 * register materials that have a shader hook or are outside the StaticMerge (see above).
 */
type Tintable = THREE.Material & { color: THREE.Color };
const tinted: WeakRef<Tintable>[] = [];
const bases = new WeakMap<Tintable, THREE.Color>();
const _c = new THREE.Color(1, 1, 1);
export function tintByDaylight<M extends Tintable>(m: M): M {
  if (!bases.has(m)) tinted.push(new WeakRef(m));
  bases.set(m, m.color.clone());
  m.color.multiply(_c);
  return m;
}
export function applyDaylightTint(unlit: [number, number, number]) {
  _c.setRGB(...unlit);
  todUniforms.uGkUnlit.value.copy(_c);
  for (let i = tinted.length - 1; i >= 0; i--) {
    const m = tinted[i]!.deref();
    if (!m) {
      tinted.splice(i, 1);
      continue;
    }
    m.color.copy(bases.get(m)!).multiply(_c);
  }
}

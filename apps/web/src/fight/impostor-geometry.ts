import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Far-ring fighters (P3-FGT-03): a low-poly adult boxer in kit — headgear, head, neck, bare arms, gloves, vest,
 * trunks with a white waistband, legs, black boots — in a believable orthodox stance (left foot forward, knees soft,
 * torso bladed, gloves at the chin). One merged geometry per pose, ~1 k triangles. Local frame: feet on y = 0, facing
 * +z, 1.78 m tall.
 *
 * Every vertex carries a colour slot (`aSlot`): 0 = baked colour (boots, waistband, laces), 1 = skin (the instance
 * colour), 2 = kit (the per-instance `aKit` colour: the corner). `impostorMaterial` picks the colour per slot, so one
 * instanced draw call per pose draws every far fighter of the hall in their corner's kit and their own skin tone.
 */

export type ImpostorPose = "guard" | "jab" | "cross";
export const IMPOSTOR_POSES: readonly ImpostorPose[] = ["guard", "jab", "cross"];

const SLOT = { baked: 0, skin: 1, kit: 2 } as const;
type Slot = keyof typeof SLOT;

class Figure {
  private list: THREE.BufferGeometry[] = [];
  add(g: THREE.BufferGeometry, slot: Slot, color: THREE.ColorRepresentation = "#ffffff", m?: THREE.Matrix4) {
    let geo = g.index ? g.toNonIndexed() : g;
    if (m) geo.applyMatrix4(m);
    for (const k of Object.keys(geo.attributes)) if (!["position", "normal"].includes(k)) geo.deleteAttribute(k);
    const n = geo.getAttribute("position").count;
    const c = new THREE.Color(color);
    const col = new Float32Array(n * 3);
    const sl = new Float32Array(n).fill(SLOT[slot]);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute("aSlot", new THREE.Float32BufferAttribute(sl, 1));
    if (geo !== g) g.dispose();
    geo = geo as THREE.BufferGeometry;
    this.list.push(geo);
  }
  /** a tapered limb between two points */
  limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, slot: Slot, color?: THREE.ColorRepresentation, seg = 6) {
    const d = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(r1, r0, d.length(), seg, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    this.add(g, slot, color, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    // a joint ball at the far end (no cracks at elbows / knees)
    this.add(new THREE.SphereGeometry(r1, seg, 4), slot, color, new THREE.Matrix4().makeTranslation(b.x, b.y, b.z));
  }
  ellipsoid(p: THREE.Vector3, r: [number, number, number], slot: Slot, color?: THREE.ColorRepresentation, seg = 8, rotY = 0) {
    const g = new THREE.SphereGeometry(1, seg, Math.max(4, seg - 2));
    g.scale(r[0], r[1], r[2]);
    this.add(g, slot, color, new THREE.Matrix4().makeRotationY(rotY).setPosition(p));
  }
  geometry(): THREE.BufferGeometry {
    const g = mergeGeometries(this.list, false)!;
    this.list.forEach((x) => x.dispose());
    this.list = [];
    g.computeBoundingSphere();
    return g;
  }
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const BOOT = "#151517";
const BAND = "#f1efe8";

/** the boxer in one pose */
export function impostorGeometry(pose: ImpostorPose): THREE.BufferGeometry {
  const f = new Figure();
  // bladed stance: the body turns ~25° to its right (lead shoulder forward); the punching poses turn more
  const twist = pose === "cross" ? -0.05 : pose === "jab" ? -0.55 : -0.42;
  const rot = (p: THREE.Vector3, y0 = 0) => p.clone().sub(v(0, y0, 0)).applyAxisAngle(v(0, 1, 0), twist).add(v(0, y0, 0));
  const lean = pose === "guard" ? 0.04 : 0.09; // weight forward over the lead leg when punching

  /* legs: lead (left, −x) forward, rear (right, +x) back on the ball of the foot */
  const hipY = 0.9;
  const hips = { L: v(-0.1, hipY, 0.03), R: v(0.1, hipY, -0.03) };
  const feet = { L: v(-0.16, 0.07, 0.26), R: v(0.17, 0.07, -0.24) };
  const knees = { L: v(-0.15, 0.48, 0.22), R: v(0.15, 0.47, -0.08) };
  for (const s of ["L", "R"] as const) {
    f.limb(hips[s], knees[s], 0.085, 0.06, "skin");
    f.limb(knees[s], feet[s], 0.058, 0.045, "skin");
    // high-top boots
    f.limb(feet[s].clone().setY(0.06), feet[s].clone().setY(0.22), 0.055, 0.05, "baked", BOOT);
    f.ellipsoid(feet[s].clone().add(v(0, -0.02, 0.06)), [0.055, 0.045, 0.12], "baked", BOOT, 6, s === "L" ? -0.15 : 0.5);
  }
  // trunks: a short, loose cylinder over the hips and thighs, white waistband
  const pelvis = v(0, hipY + 0.02, 0);
  f.add(new THREE.CylinderGeometry(0.175, 0.19, 0.26, 10, 1), "kit", undefined, new THREE.Matrix4().makeRotationY(twist * 0.5).setPosition(pelvis.x, pelvis.y - 0.04, pelvis.z));
  f.add(new THREE.CylinderGeometry(0.176, 0.176, 0.06, 10, 1), "baked", BAND, new THREE.Matrix4().setPosition(pelvis.x, pelvis.y + 0.1, pelvis.z));
  for (const s of ["L", "R"] as const) f.limb(hips[s].clone().setY(hipY - 0.06), hips[s].clone().lerp(knees[s], 0.4), 0.1, 0.09, "kit", undefined, 7);

  /* torso: vest, tapered from the waist to the chest, bladed, leaning forward a little */
  const waist = v(0, hipY + 0.14, 0);
  const chest = v(0, 1.38, lean);
  const torso = new THREE.CylinderGeometry(0.2, 0.16, chest.y - waist.y, 10, 1);
  torso.scale(1, 1, 0.68);
  const tq = new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), chest.clone().sub(waist).normalize());
  tq.premultiply(new THREE.Quaternion().setFromAxisAngle(v(0, 1, 0), twist));
  f.add(torso, "kit", undefined, new THREE.Matrix4().compose(waist.clone().add(chest).multiplyScalar(0.5), tq, v(1, 1, 1)));
  // shoulders (skin: a vest is sleeveless) and the neck
  const sh = { L: rot(v(-0.2, 1.4, lean)), R: rot(v(0.2, 1.4, lean)) };
  f.ellipsoid(chest.clone().add(v(0, 0.02, 0)), [0.21, 0.07, 0.13], "kit", 8, twist);
  for (const s of ["L", "R"] as const) f.ellipsoid(sh[s], [0.07, 0.07, 0.07], "skin", 6);
  f.limb(v(0, 1.44, lean), v(0, 1.54, lean + 0.02), 0.05, 0.048, "skin");

  /* head: chin tucked, headgear in the corner colour over the crown, cheeks and back */
  const head = v(0, 1.64, lean + 0.04);
  f.ellipsoid(head, [0.088, 0.112, 0.1], "skin", 10);
  const cap = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.56);
  cap.scale(0.1, 0.12, 0.112);
  f.add(cap, "kit", undefined, new THREE.Matrix4().makeRotationX(-0.12).setPosition(head.x, head.y + 0.012, head.z - 0.006));
  // cheek pads
  for (const s of [-1, 1]) f.ellipsoid(head.clone().add(v(s * 0.075, -0.03, 0.02)), [0.03, 0.05, 0.05], "kit", 6);

  /* arms: guard = gloves at the chin, elbows in; jab = lead arm out; cross = rear arm out, hips turned */
  const chin = head.clone().add(v(0, -0.1, 0.08));
  const reach = 0.62;
  const glove = {
    L: pose === "jab" ? rot(v(-0.06, 1.52, lean + reach)) : rot(chin.clone().add(v(-0.1, 0.02, 0.12))),
    R: pose === "cross" ? rot(v(0.02, 1.5, lean + reach)) : rot(chin.clone().add(v(0.1, 0, 0.06))),
  };
  for (const s of ["L", "R"] as const) {
    const sx = s === "L" ? -1 : 1;
    const out = (pose === "jab" && s === "L") || (pose === "cross" && s === "R");
    const elbow = out ? sh[s].clone().lerp(glove[s], 0.5).add(v(sx * 0.03, -0.03, 0)) : rot(v(sx * 0.17, 1.15, lean + 0.08));
    f.limb(sh[s], elbow, 0.05, 0.042, "skin");
    f.limb(elbow, glove[s], 0.042, 0.036, "skin");
    // the glove: a padded fist and the cuff
    f.ellipsoid(glove[s].clone().add(v(0, 0, out ? 0.05 : 0.03)), [0.068, 0.075, 0.09], "kit", 8);
    f.limb(glove[s].clone().add(v(0, 0, -0.07)), glove[s].clone().add(v(0, 0, -0.01)), 0.05, 0.06, "baked", BAND, 7);
  }
  return f.geometry();
}

/**
 * The impostor material: matte, per-slot colours (instance colour = skin, `aKit` = the corner colour). Instanced
 * meshes using it need `instanceColor` and an `aKit` InstancedBufferAttribute (vec3) on the geometry.
 */
export function impostorMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
  m.customProgramCacheKey = () => "gk-boxer-impostor";
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aSlot;\nattribute vec3 aKit;")
      .replace(
        "#include <color_vertex>",
        `#include <color_vertex>
#ifdef USE_INSTANCING_COLOR
  vColor.rgb = aSlot > 1.5 ? aKit : (aSlot > 0.5 ? instanceColor.rgb : color.rgb);
#endif`,
      );
  };
  return m;
}

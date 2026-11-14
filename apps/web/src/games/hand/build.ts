import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildHandMesh, type HandMesh } from "./geometry";
import { B, BONE_COUNT, REST, poseRotations, restLocal, type Pose } from "./rig";
import type { HandLook } from "./look";

/**
 * three.js side of the game hand (P2-GAME-07): one shared skinned mesh (geometry built once per session), a skin
 * material with the avatars' skin shading (look skin tone, wrapped per-channel diffuse as a subsurface stand-in,
 * lighter palms, nail beds, knuckle creases, fingertip flush), a sleeve cuff in the player's top colour, the die and
 * the seeds. Everything is allocated once; posing is allocation-free.
 */

let meshData: HandMesh | null = null;
/** Builds (or returns) the hand mesh data; call from an idle callback so the first roll never waits for it. */
export function handMeshData(lite = false): HandMesh {
  if (!meshData) meshData = buildHandMesh({ cell: lite ? 0.0026 : 0.0021 });
  return meshData;
}

let geo: THREE.BufferGeometry | null = null;
function handGeometry(lite: boolean): THREE.BufferGeometry {
  if (geo) return geo;
  const m = handMeshData(lite);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.position, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(m.normal, 3));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(m.skinIndex, 4));
  g.setAttribute("skinWeight", new THREE.BufferAttribute(m.skinWeight, 4));
  g.setAttribute("aRegion", new THREE.BufferAttribute(m.region, 4, true));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  g.computeBoundingSphere();
  // skinned meshes move far from their bind pose: a generous bound so the overlay never culls the hand
  g.boundingSphere!.radius = 0.6;
  geo = g;
  return g;
}

/* ---------- skin shader ---------- */

const SKIN_VERT_HEAD = /* glsl */ `
attribute vec4 aRegion;
varying vec4 vRegion;
varying vec3 vRest;
`;
const SKIN_FRAG_HEAD = /* glsl */ `
uniform vec3 uSkin;
uniform vec3 uPalm;
uniform vec3 uNail;
varying vec4 vRegion;
varying vec3 vRest;
float gkHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float gkNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(gkHash(i), gkHash(i + vec3(1,0,0)), f.x), mix(gkHash(i + vec3(0,1,0)), gkHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(gkHash(i + vec3(0,0,1)), gkHash(i + vec3(1,0,1)), f.x), mix(gkHash(i + vec3(0,1,1)), gkHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float gkNail;
float gkHeight;
`;
const SKIN_ALBEDO = /* glsl */ `
#include <color_fragment>
{
  vec3 mm = vRest * 1000.0; // rest-pose position in millimetres: detail stays glued to the skin
  float blotch = gkNoise(mm * 0.11) * 0.6 + gkNoise(mm * 0.37) * 0.4;
  vec3 c = mix(uSkin, uPalm, vRegion.r);
  // uneven tone: the back of the hand is a little darker and mottled, veins never (too small at this size)
  c *= 0.94 + 0.12 * blotch;
  // knuckle creases: fine wrinkles across the finger, darker in the folds
  float wr = 0.5 + 0.5 * sin(mm.y * 5.2 + gkNoise(mm * 0.6) * 4.0);
  float crease = vRegion.b * (0.35 + 0.65 * wr);
  c *= 1.0 - 0.26 * crease;
  // blood under thin skin: fingertips, knuckles, the palm's pads
  c = mix(c, c * vec3(1.18, 0.86, 0.84), vRegion.a * 0.6);
  gkNail = smoothstep(0.18, 0.8, vRegion.g);
  // nail plate: pink-beige bed, a paler free edge towards the tip (the lunula is hidden at this size)
  c = mix(c, uNail * (0.92 + 0.1 * gkNoise(mm * vec3(2.2, 0.4, 2.2))), gkNail);
  gkHeight = crease * wr * 0.6 + (gkNoise(mm * 1.6) - 0.5) * 0.18 * (1.0 - gkNail) - gkNail * 0.2 + smoothstep(0.05, 0.25, vRegion.g) * (1.0 - smoothstep(0.25, 0.5, vRegion.g)) * 0.5;
  diffuseColor.rgb = c;
}
`;
const SKIN_ROUGH = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mix(mix(0.55, 0.66, vRegion.r), 0.26, gkNail) + vRegion.b * 0.08;
`;
const SKIN_BUMP = /* glsl */ `
#include <normal_fragment_maps>
{
  // derivative bump from the procedural height (wrinkles, cuticle ridge, nail edge)
  vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
  float hx = dFdx(gkHeight), hy = dFdy(gkHeight);
  vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (hx * r1 + hy * r2);
  normal = normalize(abs(det) * normal - grad * 0.0009);
}
`;
const WRAP_FROM = "reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );";
// same wrapped per-channel diffuse as the avatars' skin (world/human/materials.ts): red light bleeds further round
// the terminator than blue, so shadow edges are soft and warm instead of the hard Lambert line
const WRAP_TO = /* glsl */ `
vec3 gkW = vec3(0.46, 0.22, 0.13);
vec3 gkNL = clamp((vec3(dot(geometryNormal, directLight.direction)) + gkW) / (1.0 + gkW), 0.0, 1.0);
reflectedLight.directDiffuse += gkNL * directLight.color * diffuseBRDF * ( 1.0 - F );
`;
const SKIN_WARM = /* glsl */ `
#include <lights_fragment_end>
reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.06, 0.022, 0.012);
`;

export interface SkinUniforms {
  uSkin: { value: THREE.Color };
  uPalm: { value: THREE.Color };
  uNail: { value: THREE.Color };
}

export function makeSkinMaterial(): THREE.MeshStandardMaterial & { userData: { u: SkinUniforms } } {
  const u: SkinUniforms = { uSkin: { value: new THREE.Color() }, uPalm: { value: new THREE.Color() }, uNail: { value: new THREE.Color() } };
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0 });
  m.userData.u = u;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = SKIN_VERT_HEAD + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvRegion = aRegion;\nvRest = position;");
    shader.fragmentShader =
      SKIN_FRAG_HEAD +
      shader.fragmentShader
        .replace("#include <lights_physical_pars_fragment>", THREE.ShaderChunk.lights_physical_pars_fragment.replace(WRAP_FROM, WRAP_TO))
        .replace("#include <color_fragment>", SKIN_ALBEDO)
        .replace("#include <roughnessmap_fragment>", SKIN_ROUGH)
        .replace("#include <normal_fragment_maps>", SKIN_BUMP)
        .replace("#include <lights_fragment_end>", SKIN_WARM);
  };
  m.customProgramCacheKey = () => "gk-hand-skin-1";
  return m as THREE.MeshStandardMaterial & { userData: { u: SkinUniforms } };
}

/** Skin, palm and nail colours (linear) for a look. */
export function applySkin(u: SkinUniforms, look: HandLook) {
  const s = new THREE.Color(look.skin);
  u.uSkin.value.copy(s);
  // palms and the undersides of the fingers carry far less melanin: lift dark tones more than light ones
  u.uPalm.value.setRGB(Math.pow(s.r, 0.74) * 1.02, Math.pow(s.g, 0.76) * 0.94, Math.pow(s.b, 0.78) * 0.9);
  // nail plates: the pink of the nail bed seen through a pale, low-saturation plate
  const p = u.uPalm.value;
  const l = 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b;
  u.uNail.value.setRGB(l * 1.5, l * 1.18, l * 1.08).lerp(p, 0.35);
}

/* ---------- sleeve ---------- */

/** Forearm half-width at y (matches the field in geometry.ts). */
const armRx = (y: number) => 0.0262 + (0.037 - 0.0262) * Math.min(1, Math.max(0, (-y - 0.012) / 0.348));

const sleeveCache = new Map<string, THREE.BufferGeometry>();
/**
 * Sleeve tube from the cuff down the arm: a soft ribbed cuff hugging the wrist (hoodies, track tops), a stiff shirt
 * cuff, a roomy blazer sleeve, or — for short sleeves — the hem above the elbow. Fabric folds are deterministic.
 */
export function sleeveGeometry(kind: HandLook["sleeve"]): THREE.BufferGeometry | null {
  if (kind === "none") return null;
  const hit = sleeveCache.get(kind);
  if (hit) return hit;
  const cfg = {
    rib: { y0: -0.062, gap: 0.0024, bulge: 0.012, folds: 0.0026, lip: 0.0022 },
    cuff: { y0: -0.052, gap: 0.0045, bulge: 0.006, folds: 0.0012, lip: 0.0018 },
    blazer: { y0: -0.072, gap: 0.0085, bulge: 0.01, folds: 0.0016, lip: 0.0016 },
    short: { y0: -0.27, gap: 0.006, bulge: 0.012, folds: 0.002, lip: 0.0016 },
  }[kind];
  const rings = 44, seg = 48;
  const y1 = -0.64;
  const pos: number[] = [];
  const uv: number[] = [];
  // the rolled lip: a few rings that turn inwards at the opening
  const lipRings = 5;
  for (let r = 0; r <= rings + lipRings; r++) {
    let y: number, grow: number, inward = 0;
    if (r < lipRings) {
      const a = (r / lipRings) * Math.PI; // 0 = inside, π = outside edge
      y = cfg.y0 + Math.sin(a) * cfg.lip * 1.2;
      grow = 0;
      inward = (1 - Math.cos(a)) * 0.5; // 0 inside → 1 outside
      inward = inward - 1; // −1 inside, 0 outside
    } else {
      const t = (r - lipRings) / rings;
      y = cfg.y0 + (y1 - cfg.y0) * t * t * 0.6 + (y1 - cfg.y0) * t * 0.4;
      // ribbed cuffs are tight for ~4 cm, then the sleeve body balloons a little
      const d = cfg.y0 - y;
      grow = kind === "rib" ? Math.min(1, Math.max(0, (d - 0.035) / 0.03)) : Math.min(1, d / 0.06);
    }
    for (let s = 0; s <= seg; s++) {
      const th = (s / seg) * Math.PI * 2;
      const rx0 = armRx(y) + cfg.gap + cfg.bulge * grow;
      // folds: low-frequency ripples that drift along the sleeve
      const fold = cfg.folds * grow * (Math.sin(th * 3 + y * 70) * 0.6 + Math.sin(th * 5 - y * 110 + 1.3) * 0.4) + (kind === "rib" && grow < 0.5 && r >= lipRings ? 0.001 * Math.cos(th * 36) : 0);
      const rx = rx0 + fold + inward * cfg.lip;
      const rz = rx * (0.74 + 0.12 * grow);
      pos.push(Math.cos(th) * rx, y, Math.sin(th) * rz + 0.0015);
      uv.push(s / seg, (cfg.y0 - y) * 8);
    }
  }
  const idx: number[] = [];
  const total = rings + lipRings;
  for (let r = 0; r < total; r++)
    for (let s = 0; s < seg; s++) {
      const a = r * (seg + 1) + s, b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  sleeveCache.set(kind, g);
  return g;
}

export function makeSleeveMaterial(): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ color: 0x333333, roughness: 0.9, metalness: 0, sheen: 0.25, sheenRoughness: 0.8, side: THREE.DoubleSide });
  return m;
}

/* ---------- the rig ---------- */

export interface HandRig {
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  sleeve: THREE.Mesh;
  skin: ReturnType<typeof makeSkinMaterial>;
  sleeveMat: THREE.MeshPhysicalMaterial;
  rots: Float32Array;
  restQ: THREE.Quaternion[];
  /** hand-bone child marking the palm centre / the pinch point (placement anchors) */
  anchors: { palm: THREE.Object3D; pinch: THREE.Object3D; hold: THREE.Object3D };
  look: string;
}

export function makeHandRig(lite = false): HandRig {
  const bones: THREE.Bone[] = [];
  const restQ: THREE.Quaternion[] = [];
  for (let i = 0; i < BONE_COUNT; i++) {
    const b = new THREE.Bone();
    const rl = restLocal(i);
    b.position.set(...rl.pos);
    b.quaternion.set(...rl.rot);
    restQ.push(b.quaternion.clone());
    const parent = REST[i]!.parent;
    if (parent >= 0) bones[parent]!.add(b);
    bones.push(b);
  }
  const skin = makeSkinMaterial();
  const mesh = new THREE.SkinnedMesh(handGeometry(lite), skin);
  mesh.add(bones[0]!);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  const sleeveMat = makeSleeveMaterial();
  const sleeve = new THREE.Mesh(new THREE.BufferGeometry(), sleeveMat);
  sleeve.castShadow = true;
  sleeve.frustumCulled = false;
  bones[B.arm]!.add(sleeve);
  const anchor = (x: number, y: number, z: number) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    bones[B.hand]!.add(o);
    return o;
  };
  const root = new THREE.Group();
  root.add(mesh);
  return {
    root,
    mesh,
    bones,
    sleeve,
    skin,
    sleeveMat,
    rots: new Float32Array(BONE_COUNT * 4),
    restQ,
    anchors: { palm: anchor(0, 0.06, -0.012), pinch: anchor(-0.03, 0.1, -0.026), hold: anchor(-0.002, 0.066, -0.03) },
    look: "",
  };
}

const tq = new THREE.Quaternion();
/** Writes a pose into the bones (allocation-free). */
export function poseRig(rig: HandRig, p: Pose) {
  poseRotations(p, rig.rots);
  const r = rig.rots;
  for (let i = 0; i < BONE_COUNT; i++) {
    tq.set(r[i * 4]!, r[i * 4 + 1]!, r[i * 4 + 2]!, r[i * 4 + 3]!);
    rig.bones[i]!.quaternion.copy(rig.restQ[i]!).multiply(tq);
  }
}

export function dressRig(rig: HandRig, look: HandLook) {
  const key = `${look.skin}|${look.sleeve}|${look.sleeveColor}`;
  if (rig.look === key) return;
  rig.look = key;
  applySkin(rig.skin.userData.u, look);
  const g = sleeveGeometry(look.sleeve);
  rig.sleeve.visible = !!g;
  if (g) rig.sleeve.geometry = g;
  rig.sleeveMat.color.set(look.sleeveColor);
  rig.sleeveMat.sheenColor.set(look.sleeveColor).lerp(WHITE, 0.2);
  rig.sleeveMat.roughness = look.sleeve === "blazer" || look.sleeve === "cuff" ? 0.72 : 0.92;
}

const WHITE = new THREE.Color(0xffffff);

/* ---------- die ---------- */

/** Die face normals in die space: 1 +Z, 6 −Z, 2 +Y, 5 −Y, 3 +X, 4 −X (opposite faces sum to 7). */
export const DIE_NORMALS: Record<number, [number, number, number]> = { 1: [0, 0, 1], 6: [0, 0, -1], 2: [0, 1, 0], 5: [0, -1, 0], 3: [1, 0, 0], 4: [-1, 0, 0] };
const PIP_UV: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

export function makeDie(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(1, 1, 1, 4, 0.14), new THREE.MeshStandardMaterial({ color: 0xf6f2ea, roughness: 0.32, metalness: 0 }));
  body.castShadow = true;
  const pips: THREE.BufferGeometry[] = [];
  for (let v = 1; v <= 6; v++) {
    const n = new THREE.Vector3(...DIE_NORMALS[v]!);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    for (const [a, b] of PIP_UV[v]!) {
      const d = new THREE.CircleGeometry(v === 1 ? 0.13 : 0.095, 20);
      d.translate(a * 0.27, b * 0.27, 0.5015);
      d.applyQuaternion(q);
      pips.push(d);
    }
  }
  const pipMesh = new THREE.Mesh(mergeGeometries(pips)!, new THREE.MeshStandardMaterial({ color: 0x15110f, roughness: 0.55 }));
  g.add(body, pipMesh);
  g.userData.mats = [body.material, pipMesh.material];
  return g;
}

/** Rotation (die → world) that puts `value` face up (+Z) with a yaw about the vertical. */
export function dieUpQuat(value: number, yaw: number, out = new THREE.Quaternion()): THREE.Quaternion {
  const n = DIE_NORMALS[value] ?? DIE_NORMALS[1]!;
  out.setFromUnitVectors(tv.set(n[0], n[1], n[2]), up);
  return out.premultiply(tq2.setFromAxisAngle(up, yaw));
}
const tv = new THREE.Vector3();
const up = new THREE.Vector3(0, 0, 1);
const tq2 = new THREE.Quaternion();

/** Which face is up (+Z world) for a die rotation. */
export function topFace(q: THREE.Quaternion): number {
  let best = 1, bz = -2;
  for (let v = 1; v <= 6; v++) {
    const n = DIE_NORMALS[v]!;
    const z = tv.set(n[0], n[1], n[2]).applyQuaternion(q).z;
    if (z > bz) {
      bz = z;
      best = v;
    }
  }
  return best;
}

/* ---------- seeds ---------- */

export function makeSeeds(max = 7): THREE.InstancedMesh {
  const geo = new THREE.SphereGeometry(1, 14, 10);
  geo.scale(1, 0.78, 0.7);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.45 });
  const m = new THREE.InstancedMesh(geo, mat, max);
  m.castShadow = true;
  m.frustumCulled = false;
  m.count = 0;
  return m;
}

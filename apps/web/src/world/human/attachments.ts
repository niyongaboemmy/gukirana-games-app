import * as THREE from "three";
import { GK_SKIN_GLSL } from "./skin/skin-shading";
import { campusHumansOn } from "./realism-flag";
import { fabricTexture } from "../textures";
import { itemById, type AvatarLook } from "../outfits";

/**
 * Look attachments that the base bodies don't have: accessories (glasses, sunglasses, earrings, watch) and skirt /
 * long-wrap garments (hair and headwear are fitted geometry on the head mesh since P2-AVA-10: hair.ts, headwear.ts). They are parented to the head / pelvis / forearm bones through a "neutral frame" helper whose axes
 * match the avatar's (x right, y up, z forward) in the bind pose, so all offsets below are in plain avatar metres.
 */

export interface Anchors {
  head: THREE.Object3D;
  pelvis: THREE.Object3D;
  wristL: THREE.Object3D;
  /** the body's skinned mesh: garments below the waist are skinned to its legs (they follow the thighs when seated) */
  body?: THREE.SkinnedMesh;
  /**
   * Face frame → `head` local (P2-AVA-10): face-frame metres (origin between the eyes, x = the person's left, y up,
   * z forward) to the head anchor, so glasses sit on the nose / ears and earrings on the lobes of this very head.
   */
  face?: (x: number, y: number, z: number) => THREE.Vector3;
  /** ear landmarks of this head (face frame, m) */
  ears?: { earTop: number; earBack: number; earFront: number; earX: number };
}

/** Head-local reference (neutral frame at the head bone): skull centre and radii, tuned to the Rocketbox heads. */
const SKULL = { y: 0.125, z: 0.0, rx: 0.09, ry: 0.1, rz: 0.105 };

export function buildAttachments(look: AvatarLook, a: Anchors, shadows: boolean): THREE.Object3D[] {
  const made: THREE.Object3D[] = [];
  const add = (parent: THREE.Object3D, o: THREE.Object3D) => {
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        c.castShadow = shadows;
        c.frustumCulled = false; // follows animated bones; the avatar root is culled as a whole
      }
    });
    parent.add(o);
    made.push(o);
  };
  const sy = SKULL.y, sz = SKULL.z;

  // ---------- accessories ----------
  const acc = itemById(look.outfit.accessory);
  const accColor = acc ? (acc.color === "accent" ? look.accent : acc.color) : "#111111";
  if (acc?.kind === "glasses" || acc?.kind === "sunglasses") {
    const frame = new THREE.MeshStandardMaterial({ color: accColor, roughness: 0.3, metalness: 0.5 });
    const g = new THREE.Group();
    // fitted (P2-AVA-10): lenses ~2 cm in front of the eyes, the bridge on the nose, the arms back to the ears
    const fitted = !!a.face;
    const earZ = a.ears ? a.ears.earFront + 0.004 : -0.05;
    const earX = a.ears ? a.ears.earX - 0.004 : 0.075;
    if (a.face) g.position.copy(a.face(0, -0.002, 0.021));
    else g.position.set(0, sy - 0.018, sz + SKULL.rz + 0.012);
    const lensW = fitted ? 0.024 : 0.019;
    for (const s of [-1, 1]) {
      // rounded-rectangle frames (a squashed torus with a flatter top)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(lensW, 0.0021, 6, 28), frame);
      ring.position.x = s * (fitted ? 0.031 : 0.033);
      ring.scale.set(1, fitted ? 0.66 : 0.8, 1);
      ring.rotation.y = s * -0.08;
      g.add(ring);
      if (acc.kind === "sunglasses") {
        const lens = new THREE.Mesh(new THREE.CircleGeometry(lensW, 28), new THREE.MeshStandardMaterial({ color: "#0b0b0e", roughness: 0.05, metalness: 0.7 }));
        lens.position.copy(ring.position);
        lens.scale.copy(ring.scale);
        lens.rotation.copy(ring.rotation);
        g.add(lens);
      }
      // temple arm: from the outer edge of the frame back to the top of the ear
      const from = new THREE.Vector3(s * (fitted ? 0.031 + lensW : 0.052), 0.004, -0.002);
      const to = fitted ? new THREE.Vector3(s * earX, (a.ears?.earTop ?? 0) - 0.004 + 0.002, earZ - 0.021) : new THREE.Vector3(s * 0.068, 0.004, -0.1);
      const len = from.distanceTo(to);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.0028, 0.0035, len), frame);
      arm.position.copy(from).add(to).multiplyScalar(0.5);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), to.clone().sub(from).normalize());
      g.add(arm);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(fitted ? 0.016 : 0.026, 0.003, 0.003), frame);
    bridge.position.y = 0.006;
    g.add(bridge);
    add(a.head, g);
  } else if (acc?.kind === "earrings") {
    const gold = new THREE.MeshStandardMaterial({ color: "#e8b53a", roughness: 0.25, metalness: 1 });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0022, 6, 20), gold);
      // on the ear lobe of this head when its face frame is known
      if (a.face && a.ears) e.position.copy(a.face(s * (a.ears.earX - 0.006), a.ears.earTop - 0.052, (a.ears.earFront + a.ears.earBack) / 2 + 0.004));
      else e.position.set(s * (SKULL.rx + 0.004), sy - 0.065, sz - 0.005);
      e.rotation.y = Math.PI / 2;
      add(a.head, e);
    }
  } else if (acc?.kind === "watch") {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 6, 20), new THREE.MeshStandardMaterial({ color: accColor, roughness: 0.4 }));
    band.rotation.y = Math.PI / 2;
    band.scale.set(1, 0.8, 1);
    add(a.wristL, band);
  }

  // ---------- skirt / long wrap ----------
  const bottom = itemById(look.outfit.bottom);
  if (bottom && (bottom.kind === "skirt" || bottom.kind === "longwrap")) {
    const long = bottom.kind === "longwrap";
    const color = bottom.color === "accent" ? look.accent : bottom.color;
    let map: THREE.Texture | null = null;
    if (bottom.print) {
      map = fabricTexture(bottom.print).clone();
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(4, long ? 3 : 1.6);
      map.needsUpdate = true;
    }
    const h = long ? 0.86 : 0.5;
    const v2 = campusHumansOn();
    const geo = new THREE.CylinderGeometry(0.17, long ? 0.24 : 0.3, h, v2 ? 72 : 40, v2 ? 12 : 6, true);
    // soft folds (P2-AVA-12: irregular drape folds that deepen towards the hem, not a regular star)
    const p = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
      const ang = Math.atan2(z, x);
      const down = 0.5 - y / h;
      const k = v2
        ? 1 + (0.03 * Math.sin(ang * 9 + 0.7) + 0.018 * Math.sin(ang * 17 + 2.1) + 0.012 * Math.sin(ang * 5 + 4.0)) * down * down * 1.6
        : 1 + 0.035 * Math.sin(ang * 14) * down;
      p.setXYZ(i, x * k, y, z * k * 0.86);
    }
    geo.computeVertexNormals();
    const mat = v2 ? skirtMaterial(map ? "#ffffff" : color, map) : new THREE.MeshStandardMaterial({ color: map ? "#ffffff" : color, map, roughness: 0.86, side: THREE.DoubleSide });
    const skinned = a.body ? skinToLegs(geo, a.pelvis, new THREE.Vector3(0, 0.06 - h / 2, -0.005), a.body, mat) : null;
    if (skinned) {
      skinned.castShadow = shadows;
      skinned.frustumCulled = false;
      a.body!.parent!.add(skinned);
      made.push(skinned);
    } else {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(0, 0.06 - h / 2, -0.005);
      add(a.pelvis, m);
    }
  }

  return made;
}

/**
 * A skirt / long wrap skinned to the legs (P2-AVA-06). A rigid tube hung from the pelvis stayed vertical when the
 * person sat down: it went straight down through the seat and swallowed the thighs. Skinned, the cloth follows the
 * thighs (and below the knees, the shins) and drapes over the lap, so sitting reads like sitting in a skirt.
 * Weights: the waistband rides the pelvis; down the leg the cloth hands over to the thigh of its side (soft across
 * the middle, so the front and back panels span between the legs), and towards the hem to the shin, so a seated
 * skirt falls at the knees instead of jutting forward (a long wrap goes on down the shins).
 * The tube (`geo`, in the pelvis frame at `offset`) is converted into the body mesh's bind space with the inverse
 * of each vertex's own blend of bone matrices, so it renders exactly where it was built and then deforms with them.
 */
const _sv = new THREE.Vector3();
const _sm = new THREE.Matrix4();
const _sb = new THREE.Matrix4();
function skinToLegs(geo: THREE.BufferGeometry, frame: THREE.Object3D, offset: THREE.Vector3, body: THREE.SkinnedMesh, mat: THREE.Material): THREE.SkinnedMesh | null {
  const skel = body.skeleton;
  const idx = (n: string) => skel.bones.findIndex((b) => b.name === n);
  const ids = { pelvis: idx("Bip01_Pelvis"), thighL: idx("Bip01_L_Thigh"), thighR: idx("Bip01_R_Thigh"), calfL: idx("Bip01_L_Calf"), calfR: idx("Bip01_R_Calf") };
  if (Object.values(ids).some((i) => i < 0)) return null;
  if (!body.parent) return null;
  frame.updateWorldMatrix(true, false);
  body.updateWorldMatrix(true, false);
  skel.bones.forEach((b) => b.updateMatrixWorld(true));
  // the avatar frame (x = the person's left, y up, z forward) at the pelvis: side = local x of a world point
  const toFrame = new THREE.Matrix4().copy(frame.matrixWorld).invert();
  const at = (i: number) => new THREE.Vector3().setFromMatrixPosition(skel.bones[i]!.matrixWorld);
  const hipY = (at(ids.thighL).applyMatrix4(toFrame).y + at(ids.thighR).applyMatrix4(toFrame).y) / 2;
  const kneeY = (at(ids.calfL).applyMatrix4(toFrame).y + at(ids.calfR).applyMatrix4(toFrame).y) / 2;
  // which side a point is on: towards the left or the right hip joint (whatever the frame's handedness)
  const xL = at(ids.thighL).applyMatrix4(toFrame).x;
  const xR = at(ids.thighR).applyMatrix4(toFrame).x;
  const mid = (xL + xR) / 2;
  const toLeft = Math.sign(xL - xR) || 1;
  const legLen = Math.max(0.2, hipY - kneeY);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const n = pos.count;
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const bindInv = body.bindMatrixInverse;
  const bind = body.bindMatrix;
  const smooth = (e0: number, e1: number, x: number) => {
    const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  for (let v = 0; v < n; v++) {
    _sv.fromBufferAttribute(pos, v).add(offset); // pelvis frame
    // 0 at the hip joints, 1 at the knees (negative above the hips: the waistband)
    const u = (hipY - _sv.y) / legLen;
    // a little ease round the knees: seated, the kneecap must not poke through where thigh and shin hand over
    const ease = 0.035 * Math.exp(-(((u - 1) / 0.22) ** 2));
    const rr = Math.hypot(_sv.x, _sv.z - offset.z) || 1;
    _sv.x += (_sv.x / rr) * ease;
    _sv.z += ((_sv.z - offset.z) / rr) * ease;
    const leg = THREE.MathUtils.clamp(0.4 + 1.3 * u, 0, 1) * smooth(-0.3, 0.05, u);
    const calf = smooth(0.55, 1.1, u);
    const left = smooth(-0.07, 0.07, (_sv.x - mid) * toLeft);
    const w = [
      [ids.pelvis, 1 - leg],
      [ids.thighL, leg * (1 - calf) * left],
      [ids.thighR, leg * (1 - calf) * (1 - left)],
      [ids.calfL, leg * calf * left],
      [ids.calfR, leg * calf * (1 - left)],
    ]
      .sort((p, q) => q[1]! - p[1]!)
      .slice(0, 4);
    const sum = w.reduce((t, x) => t + x[1]!, 0) || 1;
    // world position of the vertex, then back through this vertex's blend of bone matrices into bind space
    frame.localToWorld(_sv);
    _sb.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const [bi, bw] = w[k]!;
      skinIndex[v * 4 + k] = bi!;
      skinWeight[v * 4 + k] = bw! / sum;
      _sm.multiplyMatrices(skel.bones[bi!]!.matrixWorld, skel.boneInverses[bi!]!);
      const e = _sm.elements;
      for (let j = 0; j < 16; j++) _sb.elements[j]! += e[j]! * (bw! / sum);
    }
    _sm.copy(body.matrixWorld).multiply(bindInv).multiply(_sb).multiply(bind).invert();
    _sv.applyMatrix4(_sm);
    pos.setXYZ(v, _sv.x, _sv.y, _sv.z);
  }
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const m = new THREE.SkinnedMesh(geo, mat);
  m.name = "skirt";
  // same place in the hierarchy as the body, so both render through the same bind matrices
  m.position.copy(body.position);
  m.quaternion.copy(body.quaternion);
  m.scale.copy(body.scale);
  m.bind(skel, bind);
  return m;
}

/**
 * Neutral frame helper: a child of `bone` whose world orientation equals the avatar root's in the current
 * (bind) pose, so children can be positioned in avatar axes.
 */
export function neutralFrame(bone: THREE.Object3D, root: THREE.Object3D): THREE.Object3D {
  root.updateMatrixWorld(true);
  const helper = new THREE.Object3D();
  helper.name = `${bone.name}-frame`;
  const qb = new THREE.Quaternion();
  const qr = new THREE.Quaternion();
  bone.getWorldQuaternion(qb);
  root.getWorldQuaternion(qr);
  helper.quaternion.copy(qb.invert().multiply(qr));
  // undo any bone scale so offsets stay metric
  const s = new THREE.Vector3();
  bone.getWorldScale(s);
  const rs = new THREE.Vector3();
  root.getWorldScale(rs);
  helper.scale.set(rs.x / s.x, rs.y / s.y, rs.z / s.z);
  bone.add(helper);
  return helper;
}

/**
 * Skirt / wrap cloth (P2-AVA-12): cotton twill weave (micro-normal), a cloth sheen lobe, a turned hem (a stitched band
 * with a little relief at the bottom edge) and the inside a shade darker — instead of a flat, plastic-looking cone.
 */
function skirtMaterial(color: string, map: THREE.Texture | null): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ color, map, roughness: 0.84, side: THREE.DoubleSide, sheen: 1, sheenRoughness: 0.6 });
  m.sheenColor.set(color).multiplyScalar(0.3).lerp(new THREE.Color(0.3, 0.3, 0.3), 0.4);
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${GK_SKIN_GLSL.detailNormal}\n${GK_SKIN_GLSL.breakup}`)
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
{
  // hem: a 2 cm turned band, its stitch line; inside of the cloth darker
  float hem = 1.0 - smoothstep(0.03, 0.045, vUv.y);
  float stitch = (1.0 - smoothstep(0.0, 0.004, abs(vUv.y - 0.038))) * step(0.5, fract(vUv.x * 260.0));
  diffuseColor.rgb *= (1.0 - 0.08 * hem) * (1.0 - 0.25 * stitch) * (gl_FrontFacing ? 1.0 : 0.62);
}`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
{
  vec2 p = vUv * vec2(260.0, 120.0);
  float w = sin((p.x + p.y) * 6.2832);
  float lod = gkDetailLod(vUv, 260.0, 4.0);
  normal = gkDetailN(normal, -vViewPosition, p, vec2(w, w) * 0.3 * lod, 0.35);
  // the hem's fold: a rounded ridge at the bottom edge
  float hr = smoothstep(0.0, 0.012, vUv.y) * (1.0 - smoothstep(0.012, 0.03, vUv.y));
  normal = normalize(normal + vec3(0.0, -0.35, 0.0) * hr);
}`,
      );
  };
  m.defines = { ...(m.defines ?? {}), USE_UV: "" };
  m.customProgramCacheKey = () => "gk-skirt-1";
  return m;
}

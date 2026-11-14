"use client";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { blobTexture } from "./textures";
import { encodeLook, itemById, type AvatarLook } from "./outfits";
import { ANIM_SETS, HUMAN_MODELS, type HumanModelId, type HumanModelMeta } from "./human/meta";
import { makeHairCardMaterial, makeLookMaterial, type LookUniforms } from "./human/materials";
import { faceFrameOf, FaceRig } from "./human/face-rig";
import { smoothHeadNormals, tessellateHead } from "./human/head-geometry";
import { buildAttachments, neutralFrame } from "./human/attachments";
import { clipsFor, HumanAnimator } from "./human/animator";
import { aimBone, ProceduralLayer, type ArmBones } from "./human/procedural";
import { footstep } from "./human/footsteps";
import { seedOf } from "./human/life";
import { SeatFit } from "./human/seat-fit";
import { SEAT_PROFILES, type SeatProfile } from "./human/seat-profiles";
import { HandRestLayer, SKIRT_LAP } from "./human/hand-rest";
import type { SeatActivity } from "./human/activity";
import { SeatedLayer } from "./human/seated-layer";
import { useVoice } from "@/voice/voice";
import { useDeferredReady } from "./deferred";

/**
 * Realistic human avatar (DESIGN-SPEC §7): photographic, rigged Rocketbox bodies (MIT) — feminine, masculine and
 * neutral bases with real faces, hands and hair — recoloured from the player's look (skin tone, hair colour,
 * outfit colours/prints) and animated with motion-captured clips: idle, natural walk / fast walk / run / sprint
 * matched to ground speed, turning on the spot, wave, clap, dance, talk gestures, sit-down / seated / stand-up.
 * Extra per-frame layers: jaw motion while speaking on voice, eye-level head turn towards a speaker.
 *
 * Usable anywhere (plaza, rooms, previews): the only inputs are the props below.
 */
export interface AvatarProps {
  look: AvatarLook;
  name?: string;
  level?: number;
  /** 0 idle · 1 walk · 2 run · 10 wave · 11 dance · 12 clap · 13 sit (seated on a 0.46 m seat; origin = seat centre) */
  animRef: React.RefObject<number>;
  showTag?: boolean;
  /** Remote players: distance LOD (simplified mesh beyond 12 m, throttled animation further out). */
  lod?: boolean;
  shadows?: boolean;
  /** "lite" = simplified mesh always + lower animation rate (weak devices). */
  quality?: "lite" | "standard";
  /** Voice: remote session id (talking state from useVoice().talking[id]) … */
  voiceId?: string;
  /** … or the local player (useVoice().selfTalking). */
  self?: boolean;
  /** Optional world-space point to turn the head towards (e.g. a nearby speaker); null = look ahead. */
  lookAtRef?: React.RefObject<THREE.Vector3 | null>;
  /** Override the base model (e.g. "guard" for non-player staff). Defaults to look.bodyType. */
  model?: HumanModelId;
  /** Keep the base model's own clothes (staff uniforms) instead of the look's outfit colours. */
  keepClothes?: boolean;
  /** Crowds: hide the name tag + speaking bars beyond this camera distance (m). Default: always shown. */
  tagRange?: number;
  /** Hold a phone in both hands, forearms raised (signing in at the gate). */
  holdPhone?: boolean;
  /** Hold your open wallet (the wallet sheet is open): same arm pose as the phone, a leather bifold in the hand. */
  holdWallet?: boolean;
  /** Person id (session / account): seeds this person's idle habits, timing and gait offsets. */
  seedId?: string;
  /** Sit / stand root motion: "clip" (plaza benches: origin on the seat / at the standing spot) or "inPlace" (default). */
  rootMotion?: "clip" | "inPlace";
  /** Someone talks nearby / stands close (more attentive idle: listening, nods). */
  socialRef?: React.RefObject<{ listening: boolean; company: boolean }>;
  /** 0 … 1 visibility (fading in / out at doors). */
  fadeRef?: React.RefObject<number>;
  /** Play footstep sounds from the foot plants. */
  footsteps?: boolean;
  /**
   * The seat this person sits on (world/human/seat-profiles): fits the seated pose to it — buttocks on the cushion,
   * feet planted, legs clear of the seat front / the row in front. null / absent = the mocap's 0.46 m bench.
   */
  seatRef?: React.RefObject<SeatProfile | null>;
  /**
   * What the person does at the table while seated (world/human/activity.ts, P2-HAL-10): lean in, hands on the
   * table, typing, moving a counter, sowing seeds, nodding; its `focus` is where the eyes rest by default.
   */
  activityRef?: React.RefObject<SeatActivity | null>;
  /** 0…1 someone needs this person's attention (staff at a counter): the task pauses, they sit up */
  attendRef?: React.RefObject<number>;
  /** Talking without voice chat (staff replying in the reception chat): the jaw moves. */
  talkRef?: React.RefObject<boolean>;
}

const FONT = "/fonts/Baloo2.ttf";
const NEAR_LOD = 12;

/** Top of the head (m) per body type: speech bubbles float 0.25 m above it. */
export const headTop = (bodyType: string | undefined) => (bodyType === "feminine" ? 1.72 : 1.8);
/** Name tags hide up close (< 2.5 m) unless the person is hovered, and beyond `range`. */
export const TAG_NEAR = 2.5;
/** Person currently under the mouse pointer (set by social/SocialLayer). */
export const tagHover: { id: string | null } = { id: null };
export const tagVisible = (d: number, id: string | undefined, range = Infinity) => d < range && (d >= TAG_NEAR || (!!id && tagHover.id === id));
/** Name tags keep a readable size: 0.6× up close … 1.0× from 10 m on. */
export const tagScale = (d: number) => THREE.MathUtils.clamp(d / 10, 0.6, 1);

/**
 * Smooth (Phong-tessellated) head geometry per base head geometry (P2-AVA-08), shared by everyone with that body.
 * People within HEAD_HI_RANGE get it; further away the original ~1.4k-triangle head (with smoothed normals) is enough.
 */
const headHi = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
const HEAD_HI_RANGE = 9;

/**
 * Prepare a loaded base model once: pull the recolour masks out of the emissive slot, set shadow/culling flags,
 * smooth the head normals (no facets on cheeks / jaw / nose) and build its tessellated near version.
 */
function prepareBase(scene: THREE.Object3D) {
  if (scene.userData.gkPrepared) return;
  scene.userData.gkPrepared = true;
  const heads = new Set<THREE.BufferGeometry>();
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!m || !(o as THREE.Mesh).isMesh) return;
    if (m.name === "head" && (o as THREE.SkinnedMesh).isSkinnedMesh) heads.add((o as THREE.Mesh).geometry);
    if (m.emissiveMap) {
      m.emissiveMap.colorSpace = THREE.NoColorSpace;
      m.userData.gkMask = m.emissiveMap;
      m.emissiveMap = null;
    }
    if (m.name === "lashes" || m.name === "haircards") {
      m.alphaTest = 0.4;
      m.transparent = false;
      m.side = THREE.DoubleSide;
    }
    if (m.map) m.map.anisotropy = 4;
  });
  for (const g of heads) {
    smoothHeadNormals(g);
    if (!headHi.has(g)) headHi.set(g, tessellateHead(g, 0.6));
  }
}

const PARTS = new Set(["body", "lod1", "haircards"]);
/**
 * Part a mesh belongs to: "body" | "lod1" | "haircards" (the nearest ancestor with one of those names; "" = none).
 * The models nest the parts under a "RootNode" (scene → RootNode → body / lod1 → primitives): the old "top-level
 * child of the scene" test always answered "RootNode", so the near / far switch found no meshes and BOTH the detailed
 * body and its low-poly copy were drawn on top of each other (P2-HAL-11: limbs of the copy poking through clothes).
 */
export function partOf(o: THREE.Object3D, root: THREE.Object3D): string {
  for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (PARTS.has(p.name)) return p.name;
  return "";
}

const SHOW_CARDS = new Set(["short", "bun"]);

interface Instance {
  root: THREE.Object3D;
  full: THREE.Object3D[];
  lite: THREE.Object3D[];
  materials: THREE.Material[];
  /** every material this person renders with (own copies), for fading in / out */
  fadeable: THREE.Material[];
  extras: THREE.Object3D[];
  head: THREE.Bone | null;
  jaw: THREE.Bone | null;
  arms: ArmBones[];
  spine: THREE.Bone | null;
  /** head material uniforms (face detail LOD) */
  faceU: LookUniforms | null;
  /** the near head mesh with its original and tessellated geometry (swapped by distance) */
  headMesh: { mesh: THREE.Mesh; lo: THREE.BufferGeometry; hi: THREE.BufferGeometry } | null;
}

function buildInstance(src: THREE.Object3D, look: AvatarLook, meta: HumanModelMeta, shadows: boolean, keepClothes: boolean): Instance {
  prepareBase(src);
  const root = cloneSkinned(src);
  const full: THREE.Object3D[] = [];
  const lite: THREE.Object3D[] = [];
  const materials: THREE.Material[] = [];
  const matCache = new Map<THREE.Material, THREE.Material>();
  // face frame of the bind pose (eye / lip bones) for the head shader's painted details
  let frame: ReturnType<typeof faceFrameOf> = null;
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!frame && m.isSkinnedMesh && m.skeleton.bones.some((b) => b.name === "Bip01_LEye")) frame = faceFrameOf(m);
  });
  let faceU: LookUniforms | null = null;
  let headMesh: Instance["headMesh"] = null;
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    const part = partOf(mesh, root);
    const hi = part === "body" ? headHi.get(mesh.geometry) : undefined;
    if (hi && !headMesh) headMesh = { mesh, lo: mesh.geometry, hi };
    const base = mesh.material as THREE.MeshStandardMaterial;
    let m = matCache.get(base);
    if (!m) {
      if (base.name === "body" || base.name === "head") {
        m = makeLookMaterial(base, look, meta, base.name === "head", keepClothes, frame);
        if (base.name === "head") faceU = (m.userData.gkUniforms as LookUniforms | undefined) ?? null;
      }
      else if (base.name === "haircards") m = makeHairCardMaterial(base, look, meta);
      // own copy (lashes, eyes …) so one person fading at a door never fades everyone's eyes
      else m = base.clone();
      materials.push(m);
      matCache.set(base, m);
    }
    mesh.material = m;
    mesh.castShadow = shadows;
    mesh.receiveShadow = false;
    // Skinned bounds come from the bind pose, so per-mesh frustum culling wrongly hid the head at some camera
    // angles (close / looking down). Never cull the parts of a person individually — attachments already do the same.
    mesh.frustumCulled = false;
    if (part === "body") full.push(mesh);
    else if (part === "lod1") lite.push(mesh);
    // hair cards stick out through headwear (the dark "notch" at the back of every cap): hide them under a hat
    if (part === "haircards") mesh.visible = SHOW_CARDS.has(look.hairStyle) && (look.outfit.headwear === "no-hat" || look.outfit.headwear === "none");
  });
  const bone = (n: string) => (root.getObjectByName(n) as THREE.Bone | undefined) ?? null;
  const head = bone("Bip01_Head");
  const pelvis = bone("Bip01_Pelvis");
  const handL = bone("Bip01_L_Hand");
  let extras: THREE.Object3D[] = [];
  // the body's skinned mesh (the one whose skeleton has the legs; eyes / lashes are skinned to the head only)
  let body: THREE.SkinnedMesh | undefined;
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!body && m.isSkinnedMesh && o.parent?.name !== "lod1" && m.skeleton.bones.some((b) => b.name === "Bip01_L_Calf")) body = m;
  });
  if (head && pelvis && handL) extras = buildAttachments(look, { head: neutralFrame(head, root), pelvis: neutralFrame(pelvis, root), wristL: handL, body }, shadows);
  const arms: ArmBones[] = [];
  for (const [k, side] of [
    ["R", 1],
    ["L", -1],
  ] as const) {
    const upper = bone(`Bip01_${k}_UpperArm`);
    const fore = bone(`Bip01_${k}_Forearm`);
    const hand = bone(`Bip01_${k}_Hand`);
    const fingers: THREE.Bone[][] = [0, 1, 2, 3, 4].map((f) => [`Bip01_${k}_Finger${f}`, `Bip01_${k}_Finger${f}1`, `Bip01_${k}_Finger${f}2`].map(bone).filter((b): b is THREE.Bone => !!b));
    if (upper && fore && hand) arms.push({ upper, fore, hand, side, fingers });
  }
  const fadeable = [...materials];
  for (const e of extras)
    e.traverse((c) => {
      const m = (c as THREE.Mesh).material;
      if ((c as THREE.Mesh).isMesh && m) (Array.isArray(m) ? m : [m]).forEach((x) => fadeable.push(x));
    });
  // compile the hashed-alpha variant up front: at opacity 1 it looks identical, and a fade then only changes
  // opacity (toggling alphaHash at fade time recompiled every avatar shader → ~0.3–0.7 s hitches for onlookers)
  for (const m of fadeable) {
    const mm = m as THREE.Material & { alphaHash?: boolean };
    if (!mm.alphaHash) {
      mm.alphaHash = true;
      mm.needsUpdate = true;
    }
  }
  return { root, full, lite, materials, fadeable, extras, head, jaw: bone("Bip01_MJaw"), arms, spine: bone("Bip01_Spine1"), faceU, headMesh };
}

function disposeInstance(inst: Instance) {
  inst.materials.forEach((m) => m.dispose());
  inst.extras.forEach((e) =>
    e.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
      }
    }),
  );
}

/** Small hand-held props (phone, coffee cup, pool cue + chalk), parented to the hands. */
function buildProps() {
  const mats: THREE.Material[] = [];
  const mat = <T extends THREE.Material>(m: T) => (mats.push(m), m);
  const phone = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.074, 0.152, 0.009), mat(new THREE.MeshStandardMaterial({ color: "#1b1d22", metalness: 0.6, roughness: 0.35 })));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.142), mat(new THREE.MeshBasicMaterial({ color: "#9fc8ff", toneMapped: true })));
  screen.position.z = 0.0048;
  phone.add(body, screen);
  // in the palm: the phone's long side along the fingers, its screen facing out of the palm
  // a leather bifold held open (the wallet sheet is open): two matte halves with notes peeking out
  const wallet = new THREE.Group();
  const leather = mat(new THREE.MeshStandardMaterial({ color: "#5a3b26", roughness: 0.92 }));
  const halfA = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.085, 0.008), leather);
  const halfB = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.085, 0.008), leather);
  halfA.position.set(-0.048, 0, 0);
  halfA.rotation.y = 0.35;
  halfB.position.set(0.048, 0, 0);
  halfB.rotation.y = -0.35;
  const notes = new THREE.Mesh(new THREE.PlaneGeometry(0.088, 0.05), mat(new THREE.MeshStandardMaterial({ color: "#cdd8c4", roughness: 0.9, side: THREE.DoubleSide })));
  notes.position.set(0.045, 0.02, 0.006);
  notes.rotation.y = -0.35;
  wallet.add(halfA, halfB, notes);
  wallet.visible = false;
  const inHand = new THREE.Group();
  inHand.add(phone, wallet);
  phone.position.set(0, 0, 0);
  inHand.visible = false;
  // takeaway coffee cup: paper cup with a lid and a sleeve
  const cup = new THREE.Group();
  const paper = mat(new THREE.MeshStandardMaterial({ color: "#f1ece3", roughness: 0.8 }));
  const sleeve = mat(new THREE.MeshStandardMaterial({ color: "#7a4b2a", roughness: 0.9 }));
  const lid = mat(new THREE.MeshStandardMaterial({ color: "#2b2b2e", roughness: 0.5 }));
  const c1 = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.031, 0.12, 14), paper);
  const c2 = new THREE.Mesh(new THREE.CylinderGeometry(0.0405, 0.035, 0.05, 14), sleeve);
  c2.position.y = 0.005;
  const c3 = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.042, 0.014, 14), lid);
  c3.position.y = 0.065;
  cup.add(c1, c2, c3);
  cup.visible = false;
  // pool cue (held upright while chalking) + the chalk cube in the other hand
  const cue = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0145, 1.45, 8), mat(new THREE.MeshStandardMaterial({ color: "#c8a26b", roughness: 0.45 })));
  shaft.position.y = 0.42;
  const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.016, 0.45, 8), mat(new THREE.MeshStandardMaterial({ color: "#2a1a12", roughness: 0.4 })));
  butt.position.y = -0.2;
  cue.add(shaft, butt);
  cue.visible = false;
  const chalk = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.022, 0.022), mat(new THREE.MeshStandardMaterial({ color: "#2f6fd6", roughness: 0.9 })));
  chalk.visible = false;
  for (const o of [inHand, cup, cue, chalk]) o.traverse((c) => ((c as THREE.Mesh).isMesh ? ((c as THREE.Mesh).castShadow = true) : undefined));
  return { phone: inHand, phoneMesh: phone, wallet, cup, cue, chalk, mats };
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _q3 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();

/** Lazily streamed everyday-life clips (idle fidgets, gestures, coffee, photo …): added to the animator when ready. */
function LifeClips({ set, hipY, animator }: { set: "m" | "f"; hipY: number; animator: HumanAnimator }) {
  const life = useGLTF(ANIM_SETS[set].lifeUrl, false);
  useEffect(() => {
    animator.addClips(clipsFor(set, life.animations, hipY, "life"));
  }, [animator, life.animations, set, hipY]);
  return null;
}

/** Leaning (anim 30): the whole body tilts back from the ankles against the wall / railing behind. */
const LEAN = 30;
const LEAN_TILT = -0.085;

function HumanBody({
  look,
  animRef,
  shadows,
  quality,
  lod,
  modelId,
  keepClothes,
  talkingRef,
  lookAtRef,
  holdPhone = false,
  holdWallet = false,
  seed,
  rootMotion,
  socialRef,
  fadeRef,
  footsteps,
  seatRef,
  activityRef,
  attendRef,
}: {
  seatRef?: React.RefObject<SeatProfile | null>;
  activityRef?: React.RefObject<SeatActivity | null>;
  attendRef?: React.RefObject<number>;
  holdPhone?: boolean;
  /** Hold your open wallet (the wallet sheet is open): same arm pose as the phone, a leather bifold in the hand. */
  holdWallet?: boolean;
  look: AvatarLook;
  animRef: React.RefObject<number>;
  shadows: boolean;
  quality: "lite" | "standard";
  lod: boolean;
  modelId: HumanModelId;
  keepClothes: boolean;
  talkingRef: React.RefObject<boolean>;
  lookAtRef?: React.RefObject<THREE.Vector3 | null>;
  seed: number;
  rootMotion: "clip" | "inPlace";
  socialRef?: React.RefObject<{ listening: boolean; company: boolean }>;
  fadeRef?: React.RefObject<number>;
  footsteps: boolean;
}) {
  const meta = HUMAN_MODELS[modelId];
  const model = useGLTF(meta.url, false);
  const anims = useGLTF(ANIM_SETS[meta.anim].url, false);
  const lifeOk = useDeferredReady();
  const key = encodeLook(look);
  // `key` (the encoded look) captures every look field, so `look` itself is not a dependency
  const inst = useMemo(() => buildInstance(model.scene, look, meta, shadows, keepClothes), [model.scene, key, meta, shadows, keepClothes]);
  const animator = useMemo(() => new HumanAnimator(inst.root, clipsFor(meta.anim, anims.animations, meta.hipY), meta.anim, seed), [inst, anims.animations, meta, seed]);
  const proc = useMemo(() => new ProceduralLayer({ root: inst.root, arms: inst.arms, spine: inst.spine, head: inst.head }), [inst]);
  // (built before the first mixer update: it measures the standing foot heights in the bind pose)
  const fit = useMemo(() => new SeatFit(inst.root, (n) => (inst.root.getObjectByName(n) as THREE.Bone | undefined) ?? null, inst.spine, inst.head), [inst]);
  // seated hands rest on the thighs / in the lap / on armrests, measured on this body (P2-AVA-09; bind pose too)
  // (a skirt / long wrap, world/human/attachments.ts, drapes over the lap: the hands rest on the cloth, not under it)
  const lapCloth = itemById(look.outfit.bottom)?.kind;
  const handRest = useMemo(
    () => new HandRestLayer(inst.root, inst.arms, (n) => (inst.root.getObjectByName(n) as THREE.Bone | undefined) ?? null, seed, lapCloth === "skirt" || lapCloth === "longwrap" ? SKIRT_LAP : 0),
    [inst, seed, lapCloth],
  );
  // seated activities at the table (P2-HAL-10): same deterministic schedule on every screen
  const seatedL = useMemo(() => new SeatedLayer(inst.root, inst.arms, inst.spine, inst.head, seed), [inst, seed]);
  // face proportions (bind pose) + blinking / eye life (P2-AVA-07); `inst` is rebuilt whenever the look changes
  const face = useMemo(() => new FaceRig(inst.root, look.face, modelId, seed), [inst, modelId, seed]);
  /** the seat being sat on / stood up from (kept through the stand-up after the seat itself is released) */
  const seatLatch = useRef<SeatProfile | null>(null);
  useEffect(() => {
    animator.start();
    return () => {
      animator.stop();
      disposeInstance(inst);
    };
  }, [inst, animator]);

  const st = useRef({ last: new THREE.Vector3(), has: false, speed: 0, fwd: 0, yaw: 0, yawRate: 0, frame: seed % 8, acc: 0, jaw: 0, jawT: 0, look: 0, near: null as boolean | null, phone: 0, tilt: 0, fade: 1, faded: false, faceLod: -1, headHi: null as boolean | null });
  // a rebuilt person (new look) starts with every level visible and the original head: pick the levels again
  useEffect(() => {
    Object.assign(st.current, { near: null, faceLod: -1, headHi: null });
  }, [inst]);
  const props = useMemo(buildProps, []);
  const tilt = useRef<THREE.Group>(null);
  useEffect(() => {
    const r = inst.arms.find((a) => a.side === 1)?.hand;
    const l = inst.arms.find((a) => a.side === -1)?.hand;
    if (!r || !l) return;
    // bones may carry a scale (cm rigs): props keep their real size
    inst.root.updateMatrixWorld(true);
    const s = 1 / Math.max(1e-4, r.getWorldScale(_v).x / inst.root.getWorldScale(_v2).x);
    // phone in the right palm (bone x = along the fingers, bone y = out of the palm)
    props.phone.scale.setScalar(s);
    props.phone.position.set(0.085 / s, 0.028 / s, 0.0);
    props.phone.quaternion.setFromRotationMatrix(_m.makeBasis(_bz.set(0, 0, 1), _bx.set(1, 0, 0), _by.set(0, 1, 0)));
    // cup in the right hand, upright along the bone z axis when held at the waist
    props.cup.scale.setScalar(s);
    props.cup.position.set(0.07 / s, 0.05 / s, 0);
    props.cup.rotation.set(Math.PI / 2, 0, 0);
    props.chalk.scale.setScalar(s);
    props.chalk.position.set(0.07 / s, 0.03 / s, 0);
    r.add(props.phone, props.cup, props.chalk);
    inst.root.add(props.cue);
    return () => {
      r.remove(props.phone, props.cup, props.chalk);
      inst.root.remove(props.cue);
    };
  }, [inst, props]);
  useEffect(
    () => () => {
      for (const o of [props.phone, props.cup, props.cue, props.chalk]) o.traverse((c) => ((c as THREE.Mesh).isMesh ? (c as THREE.Mesh).geometry.dispose() : undefined));
      props.mats.forEach((m) => m.dispose());
    },
    [props],
  );

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const s = st.current;
    const root = inst.root;
    // measured ground speed, forward speed (signed) + yaw rate from the avatar's own world transform
    root.getWorldPosition(_v);
    root.getWorldQuaternion(_q);
    _e.setFromQuaternion(_q, "YXZ");
    if (s.has) {
      const vx = (_v.x - s.last.x) / Math.max(dt, 1e-3);
      const vz = (_v.z - s.last.z) / Math.max(dt, 1e-3);
      const v = Math.min(9, Math.hypot(vx, vz));
      const k = 1 - Math.exp(-dt * 12);
      s.speed += (v - s.speed) * k;
      s.fwd += (Math.max(-9, Math.min(9, vx * Math.sin(_e.y) + vz * Math.cos(_e.y))) - s.fwd) * k;
      let d = _e.y - s.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      s.yawRate += (d / Math.max(dt, 1e-3) - s.yawRate) * (1 - Math.exp(-dt * 10));
    }
    s.last.copy(_v);
    s.yaw = _e.y;
    s.has = true;

    // fading in / out (doors, joining, leaving): dithered alpha, no sorting problems
    const fade = fadeRef?.current ?? 1;
    if (Math.abs(fade - s.fade) > 0.002 || (fade < 1) !== s.faded) {
      const on = fade < 0.999;
      for (const m of inst.fadeable) m.opacity = on ? fade : 1;
      s.fade = fade;
      s.faded = on;
      root.visible = fade > 0.01;
    }

    // distance LOD + animation throttling (DESIGN-SPEC §16: cap animated mixers by distance)
    const dist = camera.position.distanceTo(_v);
    const near = quality !== "lite" && (!lod || dist < NEAR_LOD);
    // (near starts unset: the first frame always picks one level; `frame` starts at a per-person offset, so the
    // old `frame === 0` test never ran for most people and both levels stayed visible: every body drawn twice)
    if (near !== s.near) {
      s.near = near;
      inst.full.forEach((m) => (m.visible = near));
      inst.lite.forEach((m) => (m.visible = !near));
    }
    // face detail LOD: hair-fine stipple / freckles up close, their mean colour further away
    const faceLod = dist < 7 ? 1 : dist < 14 ? Math.round(((14 - dist) / 7) * 10) / 10 : 0;
    if (faceLod !== s.faceLod && inst.faceU) {
      s.faceLod = faceLod;
      inst.faceU.uFaceDetail.value = faceLod;
    }
    // smooth (tessellated) head up close, the original head further out (both shared by everyone with this body)
    const headHiNow = near && dist < HEAD_HI_RANGE;
    if (headHiNow !== s.headHi && inst.headMesh) {
      s.headHi = headHiNow;
      inst.headMesh.mesh.geometry = headHiNow ? inst.headMesh.hi : inst.headMesh.lo;
    }
    const every = (dist < 15 ? 1 : dist < 30 ? 2 : dist < 60 ? 4 : 8) * (quality === "lite" && dist > 8 ? 2 : 1);
    s.frame++;
    s.acc += dt;
    if (s.frame % every !== 0) return;
    const step = s.acc;
    s.acc = 0;
    const talking = !!talkingRef.current;
    const anim = animRef.current ?? 0;
    const social = socialRef?.current;
    animator.update(step, {
      anim,
      speed: s.speed,
      forward: s.fwd,
      yawRate: s.yawRate,
      talking,
      listening: social?.listening,
      company: social?.company,
      rootMotion,
    });
    // fit the seated pose to the actual seat (P2-AVA-06): on the cushion, feet planted, clear of seat fronts / rows
    const seatNow = seatRef?.current ?? null;
    if (seatNow) seatLatch.current = seatNow;
    else if (animator.out.sit === "none") seatLatch.current = null;
    fit.apply(animator.out.seated ? seatLatch.current : null, animator.out.sitW, dist < 30);
    // what they do at the table (lean in, hands on it, typing, moving a counter …): people up close only
    // (only with a seat fit: it re-places the body every frame, the activity's slide along the seat adds to that)
    const act = animator.out.seated && seatLatch.current ? (activityRef?.current ?? null) : null;
    // hands at rest (thighs / lap / armrests) unless a prop is in them; a table activity then takes over from it
    if (dist < 22) handRest.apply(animator.out.seated ? (seatLatch.current ?? SEAT_PROFILES.bench) : null, animator.out.sitW, 1 - Math.max(animator.out.phone, animator.out.cup), 1 - animator.out.phone);
    if (dist < 22) seatedL.apply(act, animator.out.sitW, step, Date.now(), animator.out.fidget === "sitlook", attendRef?.current ?? 0);
    // procedural hands (handshake, fist bump, hug, thumbs-up, pointing, chalk): close people only
    if (dist < 25) proc.update(step, anim);

    // footsteps from the real foot plants (near people only)
    const steps = animator.takeSteps();
    if (footsteps && steps.length && dist < 14) {
      // pan: where the person is left / right of the camera
      _v2.copy(_v).sub(camera.position);
      camera.getWorldDirection(_v3);
      const side = _v3.x * _v2.z - _v3.z * _v2.x;
      const pan = THREE.MathUtils.clamp(side / Math.max(1, _v2.length()), -1, 1);
      for (const f of steps) footstep(dist, pan, f.kind, f.level, seed);
    }

    // leaning back against a wall / railing
    s.tilt += ((anim === LEAN ? LEAN_TILT : 0) - s.tilt) * (1 - Math.exp(-step * 4));
    if (tilt.current) tilt.current.rotation.x = s.tilt;

    // props
    props.phone.visible = animator.out.phone > 0.5 || s.phone > 0.5;
    props.wallet.visible = holdWallet;
    props.phoneMesh.visible = !holdWallet;
    props.cup.visible = animator.out.cup > 0.35;
    const chalkW = proc.chalkWeight;
    props.cue.visible = props.chalk.visible = chalkW > 0.4;
    if (props.cue.visible) {
      // the cue stands in the left hand, its tip by the right hand
      root.worldToLocal(_v2.copy(proc.cueGrip));
      root.worldToLocal(_v3.copy(proc.cueTip));
      props.cue.position.copy(_v2);
      _bx.subVectors(_v3, _v2).normalize();
      props.cue.quaternion.setFromUnitVectors(UP, _bx);
    }

    // holding a phone: upper arms down by the sides, forearms raised ~70° towards the chest, phone in the right hand
    s.phone += ((holdPhone || holdWallet ? 1 : 0) - s.phone) * (1 - Math.exp(-step * 6));
    if (s.phone > 0.01 && inst.arms.length) {
      root.getWorldQuaternion(_q2);
      for (const arm of inst.arms) {
        aimBone(arm.upper, arm.fore, _v2.set(arm.side * -0.1, -0.96, 0.22).normalize().applyQuaternion(_q2), s.phone);
        aimBone(arm.fore, arm.hand, _v2.set(arm.side * 0.42, 0.34, 0.84).normalize().applyQuaternion(_q2), s.phone);
      }
    }

    // jaw: syllable-like open/close while speaking
    if (inst.jaw) {
      s.jawT += step;
      const target = talking ? Math.max(0, Math.sin(s.jawT * 13) * 0.6 + Math.sin(s.jawT * 7.3) * 0.4) * 0.22 : 0;
      s.jaw += (target - s.jaw) * (1 - Math.exp(-step * 18));
      const rest = (inst.jaw.userData.rest as THREE.Quaternion | undefined) ?? (inst.jaw.userData.rest = inst.jaw.quaternion.clone());
      inst.jaw.quaternion.copy(rest);
      if (s.jaw > 0.002) inst.jaw.rotateZ(-s.jaw);
    }
    // head turn towards a point of interest (limited to ±55°, smoothed); not during contact actions
    const head = inst.head;
    let want = 0;
    // seated with nothing else to look at: the eyes rest on the board / the screen / the stage
    const focus = act?.focus;
    const p = lookAtRef?.current ?? (focus ? _v3.set(focus.x, focus.y, focus.z) : null);
    if (head && head.parent && dist < 20) {
      if (p && proc.active < 0.2) {
        root.worldToLocal(_v2.copy(p));
        const a = Math.atan2(_v2.x, _v2.z);
        if (Math.abs(a) < 2.2) want = THREE.MathUtils.clamp(a, -0.95, 0.95);
      }
      s.look += (want - s.look) * (1 - Math.exp(-step * 5));
      if (Math.abs(s.look) > 0.002) {
        head.getWorldQuaternion(_q);
        root.getWorldQuaternion(_q2);
        const axis = _v2.copy(UP).applyQuaternion(_q2);
        _q.premultiply(_q3.setFromAxisAngle(axis, s.look));
        head.parent.getWorldQuaternion(_q2);
        head.quaternion.copy(_q2.invert().multiply(_q));
      }
    }
    // face life: blinking, saccades, eyes leading the head towards the person looked at (close people only)
    if (dist < 16) {
      const dev = process.env.NODE_ENV !== "production" ? (globalThis as { __gkFace?: { blink?: number } }).__gkFace : undefined;
      face.force = dev?.blink ?? null;
      face.update({ dt: step, talking, gazeYaw: THREE.MathUtils.clamp((want - s.look) * 0.9, -0.4, 0.4), gazePitch: 0, engaged: want !== 0 });
    }
  });

  return (
    <group ref={tilt}>
      <primitive object={inst.root} />
      {/* the everyday-life clips stream once the first view is up (they never delay it) */}
      {lifeOk && (
        <Suspense fallback={null}>
          <LifeClips set={meta.anim} hipY={meta.hipY} animator={animator} />
        </Suspense>
      )}
    </group>
  );
}

/** Tiny placeholder while the model streams in (a soft silhouette, never a "fake player"). */
function Placeholder() {
  return (
    <mesh position={[0, 0.88, 0]}>
      <capsuleGeometry args={[0.2, 1.3, 4, 10]} />
      <meshStandardMaterial color="#9aa0aa" transparent opacity={0.35} roughness={0.9} />
    </mesh>
  );
}

/**
 * Speaking indicator above the head: a dark-grey glass disc with a pulsing green ring and four sound bars.
 * Shown while the person's mic is live; the bars bounce harder when sound is actually picked up (`levelRef`).
 * Drawn on top (no depth test) so a head, a bench or a lamp never hides it.
 */
function SpeakingBars({ talkingRef, levelRef, y }: { talkingRef: React.RefObject<boolean>; levelRef: React.RefObject<boolean>; y: number }) {
  const g = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const bars = useRef<(THREE.Mesh | null)[]>([]);
  const amp = useRef(0);
  useFrame(({ clock }, dt) => {
    const on = !!talkingRef.current;
    if (g.current) g.current.visible = on;
    if (!on) return;
    amp.current += ((levelRef.current ? 1 : 0.35) - amp.current) * Math.min(1, dt * 10);
    const t = clock.elapsedTime;
    bars.current.forEach((b, i) => {
      if (b) b.scale.y = 0.3 + Math.abs(Math.sin(t * (6.5 + i * 2.1) + i * 1.3)) * 0.95 * amp.current;
    });
    if (ring.current) {
      const p = (t * 1.4) % 1;
      ring.current.scale.setScalar(1 + p * 0.45);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - p) * amp.current;
    }
  });
  return (
    <Billboard position={[0, y, 0]}>
      <group ref={g} visible={false} renderOrder={20}>
        <mesh ref={ring} renderOrder={20}>
          <ringGeometry args={[0.165, 0.185, 40]} />
          <meshBasicMaterial color="#22C55E" transparent opacity={0.6} depthTest={false} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0, -0.002]} renderOrder={20}>
          <circleGeometry args={[0.16, 40]} />
          <meshBasicMaterial color="#18191C" transparent opacity={0.86} depthTest={false} depthWrite={false} />
        </mesh>
        <mesh renderOrder={20}>
          <ringGeometry args={[0.15, 0.16, 40]} />
          <meshBasicMaterial color="#22C55E" transparent opacity={0.9} depthTest={false} depthWrite={false} toneMapped={false} />
        </mesh>
        {[-1.5, -0.5, 0.5, 1.5].map((i, k) => (
          <mesh
            key={i}
            ref={(m) => {
              bars.current[k] = m;
            }}
            position={[i * 0.05, 0, 0.001]}
            renderOrder={21}
          >
            <planeGeometry args={[0.03, 0.15]} />
            <meshBasicMaterial color="#4ADE80" depthTest={false} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </Billboard>
  );
}

export function Avatar({
  look,
  name,
  level = 1,
  animRef,
  showTag = true,
  lod = false,
  shadows = true,
  quality = "standard",
  voiceId,
  self = false,
  lookAtRef,
  model,
  keepClothes = false,
  tagRange,
  holdPhone = false,
  holdWallet = false,
  seedId,
  rootMotion = "inPlace",
  socialRef,
  fadeRef,
  footsteps = false,
  seatRef,
  activityRef,
  attendRef,
  talkRef,
}: AvatarProps) {
  const blob = useMemo(() => blobTexture(), []);
  const talkingRef = useRef(false);
  /** sound actually picked up right now (drives how hard the bars bounce) */
  const levelRef = useRef(false);
  const tags = useRef<THREE.Group>(null);
  const tagPlate = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    if (tags.current) {
      // seated (anim 13): the head is ~0.75 m lower, so is the name tag
      const y = tags.current.position.y;
      tags.current.position.y = y + ((animRef.current === 13 ? -0.58 : 0) - y) * 0.12;
      const d = camera.position.distanceTo(tags.current.getWorldPosition(_v));
      if (tagRange) tags.current.visible = d < tagRange;
      if (tagPlate.current) {
        tagPlate.current.visible = tagVisible(d, voiceId, tagRange ?? Infinity);
        tagPlate.current.scale.setScalar(tagScale(d));
      }
    }
    if (talkRef) talkingRef.current = !!talkRef.current;
    if (!voiceId && !self) return;
    const v = useVoice.getState();
    // you: shown whenever your mic is live (held push-to-talk / locked open), not only above a loudness threshold;
    // others: while their client reports them speaking
    talkingRef.current = self ? v.status === "on" && v.transmitting : !!(voiceId && v.talking[voiceId]);
    levelRef.current = self ? v.selfTalking : talkingRef.current;
  });
  const modelId: HumanModelId = model ?? (HUMAN_MODELS[look.bodyType] ? look.bodyType : "neutral");
  const seed = useMemo(() => seedOf(seedId ?? name ?? encodeLook(look)), [seedId, name, look]);
  const tagY = modelId === "feminine" ? 2.02 : 2.1;
  return (
    <group>
      {/* contact blob (0.38 m radius core): the only grounding on Lite, a soft AO under the real shadow on Standard */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} renderOrder={1}>
        <planeGeometry args={[1.0, 1.0]} />
        <meshBasicMaterial map={blob} color="#000000" transparent opacity={quality === "lite" || !shadows ? 0.42 : 0.3} depthWrite={false} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      <Suspense fallback={<Placeholder />}>
        <HumanBody
          look={look}
          animRef={animRef}
          shadows={shadows}
          quality={quality}
          lod={lod}
          modelId={modelId}
          keepClothes={keepClothes}
          talkingRef={talkingRef}
          lookAtRef={lookAtRef}
          holdPhone={holdPhone}
          holdWallet={holdWallet}
          seed={seed}
          rootMotion={rootMotion}
          socialRef={socialRef}
          fadeRef={fadeRef}
          footsteps={footsteps}
          seatRef={seatRef}
          activityRef={activityRef}
          attendRef={attendRef}
        />
      </Suspense>
      <group ref={tags}>
      {(voiceId || self) && <SpeakingBars talkingRef={talkingRef} levelRef={levelRef} y={showTag && name ? tagY + 0.3 : tagY + 0.14} />}
      {showTag && name && (
        // light, distance-scaled tag; upright (no pitch) so it never slices into the wearer's head
        <UprightBillboard position={[0, tagY, 0]}>
          <group ref={tagPlate}>
            <RoundedPlate w={Math.max(0.62, (name.length + 5) * 0.058 + 0.2)} h={0.19} />
            <Text font={FONT} fontSize={0.105} color="#ffffff" anchorX="center" anchorY="middle" outlineWidth={0.004} outlineColor="#000000" outlineOpacity={0.25}>
              {`Lv ${level} · ${name}`}
            </Text>
          </group>
        </UprightBillboard>
      )}
      </group>
    </group>
  );
}

const _bbP = new THREE.Vector3();
const _bbC = new THREE.Vector3();
/**
 * Upright billboard: turns only about the vertical axis to face the camera (never pitches), so a tag or bubble above
 * a head can't tilt down into it. Works under rotated parents (avatars turn), unlike locked-axis billboards.
 */
export function UprightBillboard({ position, children }: { position?: [number, number, number]; children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    const o = g.current;
    if (!o?.parent) return;
    _bbC.copy(camera.position);
    o.parent.worldToLocal(_bbC);
    _bbP.copy(o.position);
    o.rotation.set(0, Math.atan2(_bbC.x - _bbP.x, _bbC.z - _bbP.z), 0);
  });
  return (
    <group ref={g} position={position}>
      {children}
    </group>
  );
}

/** Pill-shaped translucent backing for name tags (rgba(0,0,0,.35)). */
function RoundedPlate({ w, h }: { w: number; h: number }) {
  const geo = useMemo(() => {
    const r = h / 2;
    const s = new THREE.Shape();
    s.moveTo(-w / 2 + r, -r);
    s.lineTo(w / 2 - r, -r);
    s.absarc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
    s.lineTo(-w / 2 + r, r);
    s.absarc(-w / 2 + r, 0, r, Math.PI / 2, (Math.PI * 3) / 2, false);
    return new THREE.ShapeGeometry(s, 8);
  }, [w, h]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} position={[0, 0, -0.005]}>
      <meshBasicMaterial color="#000000" transparent opacity={0.35} depthWrite={false} />
    </mesh>
  );
}

/** Start downloading the human assets early (optional; Avatar works without it). */
export function preloadHumans(ids: HumanModelId[] = ["feminine", "masculine", "neutral"]) {
  const sets = new Set<"m" | "f">();
  for (const id of ids) {
    useGLTF.preload(HUMAN_MODELS[id].url, false);
    sets.add(HUMAN_MODELS[id].anim);
  }
  sets.forEach((s) => useGLTF.preload(ANIM_SETS[s].url, false));
}

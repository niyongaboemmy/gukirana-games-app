"use client";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { blobTexture } from "./textures";
import { encodeLook, type AvatarLook } from "./outfits";
import { ANIM_SETS, HUMAN_MODELS, type HumanModelId, type HumanModelMeta } from "./human/meta";
import { makeHairCardMaterial, makeLookMaterial } from "./human/materials";
import { buildAttachments, neutralFrame } from "./human/attachments";
import { clipsFor, HumanAnimator } from "./human/animator";
import { useVoice } from "@/voice/voice";

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
}

const FONT = "/fonts/Baloo2.ttf";
const NEAR_LOD = 12;

/** Prepare a loaded base model once: pull the recolour masks out of the emissive slot, set shadow/culling flags. */
function prepareBase(scene: THREE.Object3D) {
  if (scene.userData.gkPrepared) return;
  scene.userData.gkPrepared = true;
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!m || !(o as THREE.Mesh).isMesh) return;
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
}

/** Top-level part a mesh belongs to: "body" | "lod1" | "haircards". */
function partOf(o: THREE.Object3D, root: THREE.Object3D): string {
  let p: THREE.Object3D = o;
  while (p.parent && p.parent !== root) p = p.parent;
  return p.name;
}

const SHOW_CARDS = new Set(["short", "bun"]);

interface Instance {
  root: THREE.Object3D;
  full: THREE.Object3D[];
  lite: THREE.Object3D[];
  materials: THREE.Material[];
  extras: THREE.Object3D[];
  head: THREE.Bone | null;
  jaw: THREE.Bone | null;
}

function buildInstance(src: THREE.Object3D, look: AvatarLook, meta: HumanModelMeta, shadows: boolean, keepClothes: boolean): Instance {
  prepareBase(src);
  const root = cloneSkinned(src);
  const full: THREE.Object3D[] = [];
  const lite: THREE.Object3D[] = [];
  const materials: THREE.Material[] = [];
  const matCache = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    const part = partOf(mesh, root);
    const base = mesh.material as THREE.MeshStandardMaterial;
    let m = matCache.get(base);
    if (!m) {
      if (base.name === "body" || base.name === "head") m = makeLookMaterial(base, look, meta, base.name === "head", keepClothes);
      else if (base.name === "haircards") m = makeHairCardMaterial(base, look, meta);
      else m = base;
      if (m !== base) materials.push(m);
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
    if (part === "haircards") mesh.visible = SHOW_CARDS.has(look.hairStyle);
  });
  const bone = (n: string) => (root.getObjectByName(n) as THREE.Bone | undefined) ?? null;
  const head = bone("Bip01_Head");
  const pelvis = bone("Bip01_Pelvis");
  const handL = bone("Bip01_L_Hand");
  let extras: THREE.Object3D[] = [];
  if (head && pelvis && handL) extras = buildAttachments(look, { head: neutralFrame(head, root), pelvis: neutralFrame(pelvis, root), wristL: handL }, shadows);
  return { root, full, lite, materials, extras, head, jaw: bone("Bip01_MJaw") };
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

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

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
}: {
  look: AvatarLook;
  animRef: React.RefObject<number>;
  shadows: boolean;
  quality: "lite" | "standard";
  lod: boolean;
  modelId: HumanModelId;
  keepClothes: boolean;
  talkingRef: React.RefObject<boolean>;
  lookAtRef?: React.RefObject<THREE.Vector3 | null>;
}) {
  const meta = HUMAN_MODELS[modelId];
  const model = useGLTF(meta.url, false);
  const anims = useGLTF(ANIM_SETS[meta.anim].url, false);
  const key = encodeLook(look);
  // `key` (the encoded look) captures every look field, so `look` itself is not a dependency
  const inst = useMemo(() => buildInstance(model.scene, look, meta, shadows, keepClothes), [model.scene, key, meta, shadows, keepClothes]);
  const animator = useMemo(() => new HumanAnimator(inst.root, clipsFor(meta.anim, anims.animations, meta.hipY), meta.anim), [inst, anims.animations, meta]);
  useEffect(() => {
    animator.start();
    return () => {
      animator.stop();
      disposeInstance(inst);
    };
  }, [inst, animator]);

  const st = useRef({ last: new THREE.Vector3(), has: false, speed: 0, yaw: 0, yawRate: 0, frame: Math.floor(Math.random() * 8), acc: 0, jaw: 0, jawT: 0, look: 0, near: true });

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const s = st.current;
    const root = inst.root;
    // measured ground speed + yaw rate from the avatar's own world transform (works for local, remote and seated)
    root.getWorldPosition(_v);
    if (s.has) {
      const v = Math.min(9, Math.hypot(_v.x - s.last.x, _v.z - s.last.z) / Math.max(dt, 1e-3));
      s.speed += (v - s.speed) * (1 - Math.exp(-dt * 12));
    }
    s.last.copy(_v);
    root.getWorldQuaternion(_q);
    _e.setFromQuaternion(_q, "YXZ");
    if (s.has) {
      let d = _e.y - s.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      s.yawRate += (d / Math.max(dt, 1e-3) - s.yawRate) * (1 - Math.exp(-dt * 10));
    }
    s.yaw = _e.y;
    s.has = true;

    // distance LOD + animation throttling (DESIGN-SPEC §16: cap animated mixers by distance)
    const dist = camera.position.distanceTo(_v);
    const near = quality !== "lite" && (!lod || dist < NEAR_LOD);
    if (near !== s.near || s.frame === 0) {
      s.near = near;
      inst.full.forEach((m) => (m.visible = near));
      inst.lite.forEach((m) => (m.visible = !near));
    }
    const every = (dist < 15 ? 1 : dist < 30 ? 2 : dist < 60 ? 4 : 8) * (quality === "lite" && dist > 8 ? 2 : 1);
    s.frame++;
    s.acc += dt;
    if (s.frame % every !== 0) return;
    const step = s.acc;
    s.acc = 0;
    const talking = !!talkingRef.current;
    animator.update(step, { anim: animRef.current ?? 0, speed: s.speed, yawRate: s.yawRate, talking });

    // jaw: syllable-like open/close while speaking
    if (inst.jaw) {
      s.jawT += step;
      const target = talking ? Math.max(0, Math.sin(s.jawT * 13) * 0.6 + Math.sin(s.jawT * 7.3) * 0.4) * 0.22 : 0;
      s.jaw += (target - s.jaw) * (1 - Math.exp(-step * 18));
      const rest = (inst.jaw.userData.rest as THREE.Quaternion | undefined) ?? (inst.jaw.userData.rest = inst.jaw.quaternion.clone());
      inst.jaw.quaternion.copy(rest);
      if (s.jaw > 0.002) inst.jaw.rotateZ(-s.jaw);
    }
    // head turn towards a point of interest (limited to ±55°, smoothed)
    const head = inst.head;
    if (head && head.parent && dist < 20) {
      let want = 0;
      const p = lookAtRef?.current;
      if (p) {
        root.worldToLocal(_v2.copy(p));
        const a = Math.atan2(_v2.x, _v2.z);
        if (Math.abs(a) < 2.2) want = THREE.MathUtils.clamp(a, -0.95, 0.95);
      }
      s.look += (want - s.look) * (1 - Math.exp(-step * 5));
      if (Math.abs(s.look) > 0.002) {
        head.getWorldQuaternion(_q);
        root.getWorldQuaternion(_q2);
        const axis = _v2.copy(UP).applyQuaternion(_q2);
        _q.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, s.look));
        head.parent.getWorldQuaternion(_q2);
        head.quaternion.copy(_q2.invert().multiply(_q));
      }
    }
  });

  return <primitive object={inst.root} />;
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

/** Speaking indicator: three pulsing bars above the head while the player talks on voice. */
function SpeakingBars({ talkingRef, y }: { talkingRef: React.RefObject<boolean>; y: number }) {
  const g = useRef<THREE.Group>(null);
  const bars = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    const on = !!talkingRef.current;
    if (g.current) g.current.visible = on;
    if (!on) return;
    bars.current.forEach((b, i) => {
      if (b) b.scale.y = 0.35 + Math.abs(Math.sin(clock.elapsedTime * (7 + i * 2.3) + i)) * 0.9;
    });
  });
  return (
    <Billboard position={[0, y, 0]}>
      <group ref={g} visible={false}>
        <mesh position={[0, 0, -0.01]}>
          <circleGeometry args={[0.13, 24]} />
          <meshBasicMaterial color="#12142b" transparent opacity={0.75} />
        </mesh>
        {[-1, 0, 1].map((i) => (
          <mesh
            key={i}
            ref={(m) => {
              bars.current[i + 1] = m;
            }}
            position={[i * 0.05, 0, 0]}
          >
            <planeGeometry args={[0.028, 0.12]} />
            <meshBasicMaterial color="#22C55E" toneMapped={false} />
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
}: AvatarProps) {
  const blob = useMemo(() => blobTexture(), []);
  const talkingRef = useRef(false);
  useFrame(() => {
    if (!voiceId && !self) return;
    const v = useVoice.getState();
    talkingRef.current = self ? v.selfTalking : !!(voiceId && v.talking[voiceId]);
  });
  const modelId: HumanModelId = model ?? (HUMAN_MODELS[look.bodyType] ? look.bodyType : "neutral");
  const tagY = modelId === "feminine" ? 2.02 : 2.1;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} renderOrder={1}>
        <planeGeometry args={[0.9, 0.9]} />
        <meshBasicMaterial map={blob} color="#000000" transparent opacity={0.34} depthWrite={false} />
      </mesh>
      <Suspense fallback={<Placeholder />}>
        <HumanBody look={look} animRef={animRef} shadows={shadows} quality={quality} lod={lod} modelId={modelId} keepClothes={keepClothes} talkingRef={talkingRef} lookAtRef={lookAtRef} />
      </Suspense>
      {(voiceId || self) && <SpeakingBars talkingRef={talkingRef} y={showTag && name ? tagY + 0.27 : tagY - 0.05} />}
      {showTag && name && (
        <Billboard position={[0, tagY, 0]}>
          <mesh position={[0, 0, -0.01]}>
            <planeGeometry args={[Math.max(0.9, name.length * 0.085 + 0.45), 0.26]} />
            <meshBasicMaterial color="#12142b" transparent opacity={0.72} />
          </mesh>
          <Text font={FONT} fontSize={0.14} color="#ffffff" anchorX="center" anchorY="middle">
            {`Lv ${level}  ${name}`}
          </Text>
        </Billboard>
      )}
    </group>
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

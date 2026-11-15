"use client";
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { AvatarLook } from "@/world/outfits";
import { BoxingRig } from "../boxing/rig";
import type { BoxingMotion } from "../boxing/motion";
import { P } from "../boxing/pose";
import { BOXER_URL, buildOf, facePickOf, makeBoxer, type BoxerGender, type BoxerInstance, type BoxerOutfit } from "./boxer-body";
import { BoxerFace } from "./boxer-face";
import { driveHelpers, fingerRig, helperRig, signFingers } from "./helpers";
import type { CountSign } from "../boxing/count-signs";

/**
 * A ring person on the boxer body (P3-FGT-13): fighters in kit, the referee, corner staff, judges, hall staff. Posed
 * every frame by a BoxingMotion through the boxing rig (the same clips, the same clock as before), with its own face
 * driver; one skinned mesh, one material (boxer-body.ts / boxer-material.ts). Exposes a probe (head / body / glove
 * points in world space) for contact IK and the camera.
 */
export interface BoxerProbe {
  inst: BoxerInstance;
  rig: BoxingRig;
  /** the point a head shot lands on: the face / headgear front (world) */
  head(out: THREE.Vector3): THREE.Vector3;
  /** the point a body shot lands on: the lower ribs / stomach front (world) */
  body(out: THREE.Vector3): THREE.Vector3;
  /** a glove's centre (world) */
  glove(lead: boolean, out: THREE.Vector3): THREE.Vector3;
}

export interface BoxerAvatarProps {
  look: AvatarLook;
  outfit: BoxerOutfit;
  /** boxer kit colour (the corner) */
  kit?: string;
  polo?: string;
  motion: BoxingMotion;
  clock: () => number;
  /** layer weight (1 = the motion fully drives the body) */
  weight?: { current: number };
  /** sweat 0…1 / redness [head, torso] 0…1, read every frame */
  sweat?: { current: number };
  red?: { current: [number, number] };
  /** weight class −1 (light) … +1 (heavy): both fighters of a ring share it */
  klass?: number;
  seed: number;
  lite?: boolean;
  noHeadgear?: boolean;
  probe?: React.MutableRefObject<BoxerProbe | null>;
  /** skip posing while hidden (corner staff during the round) */
  paused?: { current: boolean };
  noGloves?: boolean;
  /** dithered fade 0…1 (the material alpha-hashes; hidden at 0) */
  fade?: { current: number };
  /** the body alone (lab) */
  bare?: boolean;
  /** another GLB of the same layout (lab: before / after comparisons) */
  src?: string;
  /** finger signs over the pose (the referee's count, P3-FGT-14): first = the right hand, second = the left */
  fingers?: { current: CountSign | null };
}

const BEARD: Record<string, number> = { none: 0, stubble: 0.45, shadow: 0.35, moustache: 0.55, goatee: 0.6, chinstrap: 0.6, short: 0.78, full: 0.95 };
const BROW: Record<string, number> = { thin: 0.55, natural: 0.85, arched: 0.85, straight: 0.9, full: 1, bold: 1 };
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const FWD = new THREE.Vector3(0, 0, 1);

export function BoxerAvatar(props: BoxerAvatarProps) {
  const gender: BoxerGender = props.look.bodyType === "feminine" ? "f" : "m";
  const gltf = useGLTF(props.src ?? BOXER_URL[gender], false);
  const { look, outfit, kit, polo, seed, klass = 0, lite = false, noHeadgear = false, noGloves = false, bare = false } = props;
  const fadeable = !!props.fade;
  const inst = useMemo(() => {
    const extras = gltf.scene.userData as Parameters<typeof makeBoxer>[1];
    const facial = gender === "m" ? (BEARD[look.face?.facialHair ?? "none"] ?? 0) : 0;
    return makeBoxer(gltf.scene, extras, {
      outfit,
      colors: { skin: look.skinTone, hair: look.hairColor, iris: look.face?.eyeColor ?? "#3d2314", kit, polo },
      build: buildOf(outfit === "boxer" ? klass : 0.1, seed, look.age),
      noHeadgear,
      noGloves,
      fadeable,
      face: { beard: facial, brow: BROW[look.face?.brows ?? "natural"] ?? 0.85 },
      facePick: facePickOf(look.face),
      shadows: !lite,
      bare,
    });
  }, [gltf, gender, look, outfit, kit, polo, seed, klass, lite, noHeadgear, noGloves, fadeable, bare]);
  useEffect(() => () => inst.dispose(), [inst]);
  const rig = useMemo(() => new BoxingRig(inst.root, inst.arms, { torso: inst.torso }), [inst]);
  const face = useMemo(() => new BoxerFace(inst.bone, seed), [inst, seed]);
  const helpers = useMemo(() => helperRig(inst.bone), [inst]);
  const fingerBones = useMemo(() => fingerRig(inst.bone), [inst]);
  // bind pose of every bone: restored before each frame's pose (no mixer underneath: finger curls must not accumulate)
  const bind = useMemo(() => inst.mesh.skeleton.bones.map((b) => ({ b, q: b.quaternion.clone(), p: b.position.clone() })), [inst]);
  const parts = useMemo(() => ({ head: inst.bone("Bip01_Head"), spine: inst.bone("Bip01_Spine1"), pelvis: inst.bone("Bip01_Pelvis") }), [inst]);
  useEffect(() => {
    if (!props.probe) return;
    const p: BoxerProbe = {
      inst,
      rig,
      head(out) {
        // the face: ~9 cm in front of the head joint, 3 cm up (the headgear front / the chin line)
        if (!parts.head) return out.set(0, 0, 0);
        parts.head.getWorldPosition(out);
        inst.root.getWorldQuaternion(_q);
        return out.add(_v.copy(FWD).applyQuaternion(_q).multiplyScalar(0.1)).add(_v.set(0, 0.03, 0));
      },
      body(out) {
        if (!parts.spine) return out.set(0, 0, 0);
        parts.spine.getWorldPosition(out);
        inst.root.getWorldQuaternion(_q);
        return out.add(_v.copy(FWD).applyQuaternion(_q).multiplyScalar(0.12));
      },
      glove(lead, out) {
        return rig.gloveCentre(lead, false, out);
      },
    };
    props.probe.current = p;
    return () => {
      if (props.probe?.current === p) props.probe.current = null;
    };
  }, [inst, rig, parts, props.probe]);

  useFrame(({ camera }, dt) => {
    if (props.fade) {
      const f = props.fade.current;
      inst.material.opacity = f;
      inst.root.visible = f > 0.01;
      if (f <= 0.01) return;
    }
    if (props.paused?.current) return;
    const w = props.weight?.current ?? 1;
    for (const x of bind) {
      x.b.quaternion.copy(x.q);
      x.b.position.copy(x.p);
    }
    const t = props.clock();
    const pose = props.motion.sample(t);
    inst.root.getWorldPosition(_v);
    const near = camera.position.distanceTo(_v) < 16;
    rig.apply(pose, w, !!props.motion.current().mirrored, near && !lite);
    driveHelpers(helpers);
    const sign = props.fingers?.current;
    if (sign && near) {
      signFingers(fingerBones, "R", sign.first, w);
      signFingers(fingerBones, "L", sign.second, w);
    }
    if (near)
      face.apply(
        { focus: pose[P.focus]!, effort: pose[P.effort]!, wince: pose[P.wince]!, smile: pose[P.smile]!, jaw: pose[P.jaw]!, eyes: pose[P.eyes]! },
        t,
        Math.min(0.05, dt),
      );
    const u = inst.uniforms;
    if (props.sweat) u.uSweat.value = props.sweat.current;
    if (props.red) u.uRed.value.set(props.red.current[0], props.red.current[1]);
    u.uDetail.value = near ? 1 : 0;
  });
  return <primitive object={inst.root} />;
}

/** preload both bodies (the hall / lab mounts ring people on demand) */
export function preloadBoxers() {
  useGLTF.preload(BOXER_URL.m, false);
  useGLTF.preload(BOXER_URL.f, false);
}

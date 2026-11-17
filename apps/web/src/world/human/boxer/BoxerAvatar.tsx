"use client";
import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { OUTFITS, type AvatarLook } from "@/world/outfits";
import { BoxingRig } from "../boxing/rig";
import type { Obstacle } from "../boxing/arm-fk";
import type { BoxingMotion } from "../boxing/motion";
import { armRad, GUARD_V8_LEAD_ARM, GUARD_V8_REAR_ARM, P, V8_GUARD_BIAS_F } from "../boxing/pose";
import { BOXER_URL, boxerUrlFor, buildOf, facePickOf, makeBoxer, type BoxerGender, type BoxerInstance, type BoxerOutfit } from "./boxer-body";
import { BoxerFace } from "./boxer-face";
import { BOXER_V8 } from "./generation";
import { registerKtx2Renderer } from "./v8/ktx2";
import { driveHelpers, fingerRig, helperRig, signFingers } from "./helpers";
import { driveCorrectives } from "./corrective";
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
  /** P3-FGT-19B (dev labs / the fighter-v8 harness's pose fitter): pose the body NOW from a pose vector (bind restored,
   * the rig applied in full, helpers driven, world matrices updated); the next frame re-poses it from its motion */
  poseNow?(pose: Float32Array): void;
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
  /** P3-FGT-17 lab: the P3-FGT-16 shading (with `src` = a v5 GLB: the before view) */
  v5?: boolean;
  /** P3-FGT-18 lab: the P3-FGT-17 shading (with `src` = a v6 GLB: the before view of docs/QA/boxing-v7) */
  v6?: boolean;
  /** finger signs over the pose (the referee's count, P3-FGT-14): first = the right hand, second = the left */
  fingers?: { current: CountSign | null };
  /** P3-FGT-16: the other fighter: my arms are kept out of their head, trunk and arms (keyed-arm keep-out) */
  opponent?: React.MutableRefObject<BoxerProbe | null>;
}

/**
 * The other fighter's body as obstacles for my keyed arms (world space, refreshed every frame from their bones as last
 * posed): the head (with headgear), the chest and belly as a capsule, and their arms (upper arm, forearm, glove).
 */
function opponentObstacles(o: BoxerProbe, out: Obstacle[]) {
  const b = (n: string, v: THREE.Vector3) => {
    const x = o.inst.bone(n);
    return x ? x.getWorldPosition(v) : null;
  };
  let n = 0;
  const put = (a: THREE.Vector3 | null, c: THREE.Vector3 | null, r: number) => {
    if (!a) return;
    if (!out[n]) out[n] = { a: new THREE.Vector3(), b: null, r: 0 };
    const ob = out[n]!;
    ob.a.copy(a);
    ob.b = c ? (ob.b ?? new THREE.Vector3()).copy(c) : null;
    ob.r = r;
    n++;
  };
  const h = b("Bip01_Head", _oa);
  if (h) put(h.add(_ob.set(0, 0.06, 0)), null, 0.13);
  put(b("Bip01_Spine1", _oa), b("Bip01_Spine2", _ob)?.add(_oc.set(0, 0.1, 0)) ?? null, 0.15);
  put(b("Bip01_Pelvis", _oa)?.add(_oc.set(0, 0.08, 0)) ?? null, b("Bip01_Spine1", _ob), 0.14);
  for (const S of ["L", "R"]) {
    put(b(`Bip01_${S}_UpperArm`, _oa), b(`Bip01_${S}_Forearm`, _ob), 0.05);
    put(b(`Bip01_${S}_Forearm`, _oa), b(`Bip01_${S}_Hand`, _ob), 0.045);
    put(o.glove(S === "L", _oa), null, 0.07);
  }
  out.length = n;
}
const _oa = new THREE.Vector3();
const _ob = new THREE.Vector3();
const _oc = new THREE.Vector3();

/** an everyday person's colours from their look (world/outfits.ts catalogue): the top's colour (accent-coloured tops take
 * the player's top / accent colour), the bottom's colour (prints and wraps read as a dark neutral here) */
function casualTop(look: AvatarLook): string {
  const it = OUTFITS.find((o) => o.id === look.outfit.top);
  const c = it?.color ?? "accent";
  return c === "accent" ? (look.topColor ?? look.accent) : it?.print ? "#e9e4da" : c;
}
function casualBottom(look: AvatarLook): string {
  const it = OUTFITS.find((o) => o.id === look.outfit.bottom);
  return it && !it.print && it.color !== "accent" ? it.color : "#23252e";
}
const BEARD: Record<string, number> = { none: 0, stubble: 0.45, shadow: 0.35, moustache: 0.55, goatee: 0.6, chinstrap: 0.6, short: 0.78, full: 0.95 };
const BROW: Record<string, number> = { thin: 0.55, natural: 0.85, arched: 0.85, straight: 0.9, full: 1, bold: 1 };
const _v = new THREE.Vector3();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _q = new THREE.Quaternion();
const FWD = new THREE.Vector3(0, 0, 1);
/** dev labs: ?push=0 shows the v8 fighters without the cloth push / skin tuck (before / after comparisons) */
const NO_PUSH = process.env.NODE_ENV !== "production" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("push") === "0";
/** dev labs: ?corr=0 turns the garments' pose correctives off (comparisons, and the bake's own measurements) */
const NO_CORR = process.env.NODE_ENV !== "production" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("corr") === "0";
/** dev labs: ?armpush=0 turns the singlet's arm push off (comparisons) */
const ARM_PUSH = !(process.env.NODE_ENV !== "production" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("armpush") === "0");
const COARSE = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

export function BoxerAvatar(props: BoxerAvatarProps) {
  const gender: BoxerGender = props.look.bodyType === "feminine" ? "f" : "m";
  const gl = useThree((s) => s.gl);
  // P3-FGT-19B: the v8 textures are KTX2 (the loader picks the GPU's block format from the renderer)
  if (BOXER_V8) registerKtx2Renderer(gl);
  const gltf = useGLTF(props.src ?? boxerUrlFor(gender, props.outfit), false);
  const { look, outfit, kit, polo, seed, klass = 0, lite = false, noHeadgear = false, noGloves = false, bare = false } = props;
  const fadeable = !!props.fade;
  const inst = useMemo(() => {
    const extras = gltf.scene.userData as Parameters<typeof makeBoxer>[1];
    const facial = gender === "m" ? (BEARD[look.face?.facialHair ?? "none"] ?? 0) : 0;
    return makeBoxer(gltf.scene, extras, {
      outfit,
      colors: { skin: look.skinTone, hair: look.hairColor, iris: look.face?.eyeColor ?? "#3d2314", kit, polo: polo ?? (outfit === "casual" ? casualTop(look) : undefined), trousers: outfit === "casual" ? casualBottom(look) : undefined },
      // (P3-FGT-19B: the v8 fighters are adult athletes of 25–27 (SPEC checklist 25): no mature morph in the ring)
      build: buildOf(outfit === "boxer" ? klass : 0.1, seed, BOXER_V8 && outfit === "boxer" && !props.src ? undefined : look.age),
      noHeadgear,
      noGloves,
      fadeable,
      face: { beard: facial, brow: BROW[look.face?.brows ?? "natural"] ?? 0.85 },
      facePick: facePickOf(look.face),
      shadows: !lite,
      bare,
      gender,
      lite: lite || COARSE,
      ...(props.v5 ? { v6: false } : {}),
      ...(props.v6 ? { v7: false } : {}),
    });
  }, [gltf, gender, look, outfit, kit, polo, seed, klass, lite, noHeadgear, noGloves, fadeable, bare, props.v5, props.v6]);
  useEffect(() => () => inst.dispose(), [inst]);
  // (P3-FGT-19B: the v8 female fighter carries her guard correction: pose.ts V8_GUARD_BIAS_F)
  const v8Female = BOXER_V8 && outfit === "boxer" && gender === "f" && !props.src;
  const rig = useMemo(
    () => new BoxingRig(inst.root, inst.arms, { torso: inst.torso, armBias: v8Female ? { lead: armRad(V8_GUARD_BIAS_F.lead), rear: armRad(V8_GUARD_BIAS_F.rear), guardLead: armRad(GUARD_V8_LEAD_ARM), guardRear: armRad(GUARD_V8_REAR_ARM) } : null }),
    [inst, v8Female],
  );
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
      poseNow(pose) {
        for (const x of bind) {
          x.b.quaternion.copy(x.q);
          x.b.position.copy(x.p);
        }
        rig.apply(pose, 1, false, true);
        driveHelpers(helpers);
        driveCorrectives(inst.corr, inst.uniforms, !NO_CORR);
        inst.root.updateMatrixWorld(true);
      },
    };
    props.probe.current = p;
    return () => {
      if (props.probe?.current === p) props.probe.current = null;
    };
  }, [inst, rig, parts, props.probe, bind, helpers]);

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
    const opp = props.opponent?.current;
    if (opp && near) opponentObstacles(opp, rig.opponent);
    else rig.opponent.length = 0;
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
    // P3-FGT-15: the face flushes with the work done and with effort (blood to the skin; separate from hit redness)
    const sw = props.sweat?.current ?? 0;
    u.uFlush.value += (Math.min(1, Math.max(0, (sw - 0.3) / 0.6) * 0.7 + pose[P.effort]! * 0.3) - u.uFlush.value) * Math.min(1, dt * 2);
    u.uDetail.value = near ? 1 : 0;
    // P3-FGT-19B: the cloth push cones from this frame's bones (the mesh's space)
    const caps = inst.caps;
    u.uPush.value = caps && near && !NO_PUSH ? 1 : 0;
    u.uArmPush.value = ARM_PUSH ? 1 : 0;
    driveCorrectives(inst.corr, u, near && !NO_CORR);
    if (caps && near) {
      const L = (n: string, out: THREE.Vector3) => {
        const b = inst.bone(n);
        return b ? inst.root.worldToLocal(b.getWorldPosition(out)) : out;
      };
      const set = (k: number, a: string, b: string, r: number[]) => {
        L(a, _pa);
        L(b, _pb);
        u.uCapA.value[k]!.set(_pa.x, _pa.y, _pa.z, r[0]!);
        u.uCapB.value[k]!.set(_pb.x, _pb.y, _pb.z, r[1]!);
      };
      set(0, "Bip01_L_UpperArm", "Bip01_L_Forearm", caps.arm);
      set(1, "Bip01_R_UpperArm", "Bip01_R_Forearm", caps.arm);
      set(2, "Bip01_L_Thigh", "Bip01_L_Calf", caps.thigh);
      set(3, "Bip01_R_Thigh", "Bip01_R_Calf", caps.thigh);
      L("Bip01_Pelvis", u.uAxisA.value);
      L("Bip01_Neck", u.uAxisB.value);
    }
  });
  return <primitive object={inst.root} />;
}

/** preload both bodies (the hall / lab mounts ring people on demand) */
export function preloadBoxers() {
  useGLTF.preload(BOXER_URL.m, false);
  useGLTF.preload(BOXER_URL.f, false);
  if (BOXER_V8) {
    useGLTF.preload(boxerUrlFor("m", "referee"), false);
    useGLTF.preload(boxerUrlFor("f", "referee"), false);
  }
}

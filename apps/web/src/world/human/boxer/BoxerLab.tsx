"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { DEFAULT_LOOK, SKIN_TONES, HAIR_COLORS, type AvatarLook } from "../../outfits";
import { BOXING_CLIPS, type BoxingClipName } from "../boxing/clips";
import { BoxingMotion } from "../boxing/motion";
import { boxingLayer } from "../boxing/layer";
import { boxingKitOverride } from "../boxing/kit";
import { Avatar } from "../../Avatar";
import { BoxerAvatar, type BoxerProbe } from "./BoxerAvatar";
import type { BoxerOutfit } from "./boxer-body";

/**
 * Boxer body debug view (P3-FGT-14, dev-only, /play/boxing-lab?mode=boxer): one ring person on the boxer body, one clip
 * frozen at a time, with skinning diagnostics:
 *  - debug=bones   the skeleton overlay (SkeletonHelper) over the mesh;
 *  - debug=weights a per-bone weight heatmap (bone=<Bip01 name>, default the left upper arm: blue 0 → red 1), or
 *    bone=arm (clavicle red / upper arm green / forearm blue / spine2 grey): where the shoulder blends;
 *  - bind=1        the bind pose (no rig: what the GLB ships); bare=1 the body alone (no garments, nothing culled);
 * Query: clip=<name> · at=<s into the clip> (or at=impact) · gender=m|f · outfit=boxer|referee|staff ·
 * glb=before (the P3-FGT-13 GLB, kept untracked under public/assets/characters/_before/ for comparisons) ·
 * cam=<VIEWS key> (in the chest frame; az / el / dist / fov override it) · headgear=0 · cmp=1 (the old Rocketbox fighter beside it, same
 * clip and clock: the rig's reference body).
 */
const LOOK: Record<"m" | "f", AvatarLook> = {
  m: { ...DEFAULT_LOOK, bodyType: "masculine", skinTone: SKIN_TONES[4]!, hairColor: HAIR_COLORS[0]!, face: { ...DEFAULT_LOOK.face } },
  f: { ...DEFAULT_LOOK, bodyType: "feminine", skinTone: SKIN_TONES[5]!, hairColor: HAIR_COLORS[0]!, face: { ...DEFAULT_LOOK.face } },
};

const ARM_COLORS: Record<string, [number, number, number]> = {
  Clavicle: [0.95, 0.2, 0.2],
  UpperArm: [0.2, 0.9, 0.25],
  Forearm: [0.2, 0.4, 1],
  Hand: [1, 0.9, 0.2],
  ShoulderTwist: [1, 0.3, 1],
  UpperArmTwist: [0.2, 1, 1],
  ForearmTwist: [1, 0.6, 0.1],
};

function heat(w: number): [number, number, number] {
  // blue → cyan → green → yellow → red
  const c = new THREE.Color().setHSL((1 - w) * 0.66, 1, 0.5);
  return [c.r, c.g, c.b];
}

function debugMaterial(mesh: THREE.SkinnedMesh, mode: string) {
  const g = mesh.geometry;
  const si = g.getAttribute("skinIndex") as THREE.BufferAttribute;
  const sw = g.getAttribute("skinWeight") as THREE.BufferAttribute;
  const bones = mesh.skeleton.bones;
  const col = new Float32Array(si.count * 3);
  const want = mode === "arm" ? null : bones.findIndex((b) => b.name === mode);
  for (let i = 0; i < si.count; i++) {
    let rgb: [number, number, number] = [0.25, 0.25, 0.27];
    if (want === null) {
      const acc = [0.35, 0.35, 0.37];
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w <= 0) continue;
        const name = bones[si.getComponent(i, k)]?.name ?? "";
        const key = Object.keys(ARM_COLORS).find((n) => name.endsWith(`_${n}`));
        if (!key) continue;
        const c = ARM_COLORS[key]!;
        if (sum === 0) acc.fill(0);
        acc[0]! += c[0] * w;
        acc[1]! += c[1] * w;
        acc[2]! += c[2] * w;
        sum += w;
      }
      if (sum > 0 && sum < 1) for (let k = 0; k < 3; k++) acc[k] = acc[k]! + 0.35 * (1 - sum);
      rgb = acc as [number, number, number];
    } else {
      let w = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === want) w += sw.getComponent(i, k);
      rgb = w > 0.001 ? heat(w) : [0.12, 0.12, 0.16];
    }
    col.set(rgb, i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}

/** lab views in the CHEST frame (the torso is turned in a stance): [az° (0 = in front of the chest, 90 = the person's left), el°, distance, target, fov] */
const VIEWS: Record<string, [number, number, number, "chest" | "shL" | "shR" | "body", number]> = {
  front: [0, 8, 1.3, "chest", 40],
  back: [180, 12, 1.3, "chest", 40],
  left: [90, 8, 1.3, "chest", 40],
  right: [-90, 8, 1.3, "chest", 40],
  shoulderL: [55, 12, 0.8, "shL", 36],
  shoulderR: [-55, 12, 0.8, "shR", 36],
  backL: [130, 15, 0.8, "shL", 36],
  backR: [-130, 15, 0.8, "shR", 36],
  armpitL: [75, -25, 0.75, "shL", 36],
  armpitR: [-75, -25, 0.75, "shR", 36],
  top: [10, 70, 1.3, "chest", 40],
  full: [20, 6, 3.6, "body", 36],
  fullBack: [160, 8, 3.6, "body", 36],
  fullSide: [90, 6, 3.6, "body", 36],
};

function CamRig({ q, probe }: { q: URLSearchParams; probe: React.RefObject<BoxerProbe | null> }) {
  const { camera } = useThree();
  const v = VIEWS[q.get("cam") ?? "front"] ?? VIEWS.front!;
  useFrame(() => {
    const p = probe.current;
    if (!p) return;
    const b = (n: string) => {
      const o = p.inst.bone(n);
      return o ? o.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.3, 0);
    };
    const sp = p.inst.bone("Bip01_Spine2");
    const fwd = new THREE.Vector3(0, 0, 1);
    if (sp) fwd.applyQuaternion(sp.getWorldQuaternion(new THREE.Quaternion()));
    fwd.y = 0;
    fwd.normalize();
    const left = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const az = THREE.MathUtils.degToRad(Number(q.get("az") ?? v[0]));
    const el = THREE.MathUtils.degToRad(Number(q.get("el") ?? v[1]));
    const dist = Number(q.get("dist") ?? v[2]);
    const tgt = v[3] === "shL" ? b("Bip01_L_UpperArm") : v[3] === "shR" ? b("Bip01_R_UpperArm") : v[3] === "body" ? b("Bip01_Pelvis").setY(0.95) : b("Bip01_Spine2").add(new THREE.Vector3(0, 0.08, 0));
    const dir = fwd.clone().multiplyScalar(Math.cos(az)).addScaledVector(left, Math.sin(az)).multiplyScalar(Math.cos(el)).add(new THREE.Vector3(0, Math.sin(el), 0));
    camera.position.copy(tgt).addScaledVector(dir, dist);
    camera.lookAt(tgt);
    const pc = camera as THREE.PerspectiveCamera;
    pc.fov = Number(q.get("fov") ?? v[4]);
    pc.near = 0.02;
    pc.updateProjectionMatrix();
  });
  return null;
}

export function BoxerLab({ q, setInfo }: { q: URLSearchParams; setInfo: (s: string) => void }) {
  const clip = ((q.get("clip") as BoxingClipName) ?? "guard") in BOXING_CLIPS ? ((q.get("clip") as BoxingClipName) ?? "guard") : "guard";
  const gender = q.get("gender") === "f" ? "f" : "m";
  const outfit = (q.get("outfit") as BoxerOutfit) ?? "boxer";
  const debug = q.get("debug") ?? "";
  const bind = q.get("bind") === "1";
  const info = BOXING_CLIPS[clip];
  const atQ = q.get("at");
  const at = atQ === "impact" ? (info.impact ?? 0) : atQ !== null ? Number(atQ) : (info.impact ?? Math.min(0.5, info.duration * 0.5));
  const motion = useMemo(() => {
    const m = new BoxingMotion();
    m.play({ clip, start: 0, blend: 0 });
    return m;
  }, [clip]);
  const clock = useMemo(() => () => at, [at]);
  const weight = useMemo(() => ({ current: bind ? 0 : 1 }), [bind]);
  const probe = useRef<BoxerProbe | null>(null);
  const { scene } = useThree();
  useEffect(() => setInfo(`boxer ${gender} ${outfit} · ${clip} @ ${at.toFixed(2)} s${debug ? ` · ${debug}` : ""}${bind ? " · bind" : ""}`), [gender, outfit, clip, at, debug, bind, setInfo]);
  // debug overlays once the person exists
  useEffect(() => {
    let helper: THREE.SkeletonHelper | null = null;
    const id = setInterval(() => {
      const p = probe.current;
      if (!p) return;
      clearInterval(id);
      if (debug === "weights") p.inst.mesh.material = debugMaterial(p.inst.mesh, q.get("bone") ?? "arm") as never;
      if (debug === "bones" || q.get("bones") === "1") {
        helper = new THREE.SkeletonHelper(p.inst.root);
        (helper.material as THREE.LineBasicMaterial).depthTest = false;
        (helper.material as THREE.LineBasicMaterial).linewidth = 2;
        helper.renderOrder = 10;
        scene.add(helper);
        if (debug === "bones") {
          const m = p.inst.material;
          m.transparent = true;
          m.opacity = 0.45;
          m.depthWrite = false;
        }
      }
      (window as unknown as { __gkBoxer?: object }).__gkBoxer = { ready: true, bones: p.inst.mesh.skeleton.bones.length, probe: p, scene };
    }, 50);
    return () => {
      clearInterval(id);
      if (helper) scene.remove(helper);
    };
  }, [debug, q, scene]);
  return (
    <>
      <BoxerAvatar look={LOOK[gender]} outfit={outfit} kit="#c0262d" polo="#2b2e34" motion={motion} clock={clock} weight={weight} seed={7} klass={0} noHeadgear={q.get("headgear") === "0"} bare={q.get("bare") === "1"} src={q.get("glb") === "before" ? `/assets/characters/_before/boxer-${gender}.glb` : undefined} probe={probe} />
      {q.get("cmp") === "1" && <Reference look={LOOK[gender]} motion={motion} clock={clock} />}
      <CamRig q={q} probe={probe} />
    </>
  );
}

/** the Rocketbox fighter the boxing rig was authored on, for side-by-side comparison (cmp=1) */
function Reference({ look, motion, clock }: { look: AvatarLook; motion: BoxingMotion; clock: () => number }) {
  const kit = useMemo(() => boxingKitOverride(look, "blue", { headgear: false }), [look]);
  const layer = useMemo(() => boxingLayer({ motion, clock, kit }), [motion, clock, kit]);
  const anim = useRef(0);
  return (
    <group position={[-1.1, 0, 0]}>
      <Avatar look={kit.look} animRef={anim} showTag={false} shadows rigLayer={layer} seedId="lab-ref" />
    </group>
  );
}

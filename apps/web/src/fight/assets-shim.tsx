"use client";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CORNER_COLORS, type BoxingClip, type Corner, type RingId, type RingStatus } from "@gukirana/contracts";
import { Avatar } from "@/world/Avatar";
import { encodeLook, type AvatarLook } from "@/world/outfits";
import { reach, type ArmBones } from "@/world/human/procedural";

/**
 * PLACEHOLDERS for the Boxing assets agent (P3-FGT-02). DELETE / SWAP AT INTEGRATION — this is the only file to change:
 *
 *   BoxingRingKit        → apps/web/src/rooms/fight/ring-kit*.tsx   (instanced ring kit: rings from transforms + status)
 *   boxingKitOverride    → apps/web/src/world/human/boxing/kit*.ts  (temporary AvatarLook in the corner's kit)
 *   boxingPose / clips   → apps/web/src/world/human/boxing/*        (procedural motion library, BOXING_CLIPS)
 *
 * The world side (fight/**, world/Avatar.tsx) imports these names from here only. The shapes below are what the plan
 * (§0 assets table) promises; if the real modules differ, adapt them here (a re-export or a thin adapter).
 */

/* ------------------------------------------------------------ ring kit ------------------------------------------------------------ */

export interface RingKitRing {
  id: RingId;
  x: number;
  z: number;
  rotY: number;
  feature?: boolean;
  status: RingStatus;
}

/** status → lamp colour (colour is never the only signal: the number boxes also say the status in words) */
export const STATUS_LAMP: Record<RingStatus, string> = {
  free: "#2E9D57",
  waiting: "#E3A21A",
  starting: "#C8322A",
  fighting: "#C8322A",
  result: "#C8322A",
  practice: "#EDEDE8",
  closed: "#2a2a2a",
};

const STD = { platform: 4.9, canvasY: 0.9 };
const FEAT = { platform: 6.7, canvasY: 2.1, base: 1.2 };
const dims = (r: RingKitRing) => (r.feature ? FEAT : { ...STD, base: 0 });

/**
 * Placeholder instanced ring kit: platform + canvas, apron status band, four corner posts (red / blue / two neutral),
 * three ropes a side, two corner steps and stools. Seven instanced meshes for all rings (7 draw calls).
 */
export function BoxingRingKit({ rings, lite = false }: { rings: RingKitRing[]; lite?: boolean }) {
  const n = rings.length;
  const refs = {
    platform: useRef<THREE.InstancedMesh>(null),
    canvas: useRef<THREE.InstancedMesh>(null),
    band: useRef<THREE.InstancedMesh>(null),
    post: useRef<THREE.InstancedMesh>(null),
    rope: useRef<THREE.InstancedMesh>(null),
    step: useRef<THREE.InstancedMesh>(null),
    stool: useRef<THREE.InstancedMesh>(null),
  };
  const geo = useMemo(
    () => ({
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, lite ? 6 : 10),
    }),
    [lite],
  );
  const mats = useMemo(
    () => ({
      platform: new THREE.MeshStandardMaterial({ color: "#1d1d20", roughness: 0.8 }),
      canvas: new THREE.MeshStandardMaterial({ color: "#d9d6cf", roughness: 0.92 }),
      band: new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
      post: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.6 }),
      rope: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.7 }),
      step: new THREE.MeshStandardMaterial({ color: "#2b2b2e", roughness: 0.75, metalness: 0.2 }),
      stool: new THREE.MeshStandardMaterial({ color: "#3a3a3d", roughness: 0.7 }),
    }),
    [],
  );
  useEffect(() => () => {
    Object.values(geo).forEach((g) => g.dispose());
    Object.values(mats).forEach((m) => m.dispose());
  }, [geo, mats]);

  // static transforms (rebuilt only when the ring list changes shape)
  const layoutKey = rings.map((r) => `${r.id}:${r.x}:${r.z}:${r.rotY}:${r.feature ? 1 : 0}`).join("|");
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    const put = (mesh: THREE.InstancedMesh | null, i: number, r: RingKitRing, lx: number, y: number, lz: number, sx: number, sy: number, sz: number, ry = 0) => {
      if (!mesh) return;
      const cs = Math.cos(r.rotY);
      const sn = Math.sin(r.rotY);
      v.set(r.x + lx * cs + lz * sn, y, r.z - lx * sn + lz * cs);
      q.setFromEuler(e.set(0, r.rotY + ry, 0));
      s.set(sx, sy, sz);
      mesh.setMatrixAt(i, m.compose(v, q, s));
    };
    let pi = 0;
    let ri = 0;
    rings.forEach((r, i) => {
      const d = dims(r);
      const h = d.platform / 2;
      put(refs.platform.current, i, r, 0, (d.canvasY - 0.04) / 2, 0, d.platform, d.canvasY - 0.04, d.platform);
      put(refs.canvas.current, i, r, 0, d.canvasY - 0.02, 0, d.platform - 0.5, 0.04, d.platform - 0.5);
      put(refs.band.current, i, r, 0, d.base + 0.14, 0, d.platform + 0.04, 0.08, d.platform + 0.04);
      const inner = h - 0.3;
      // posts: red (−x,+z), blue (+x,−z), neutral
      const corners: [number, number, string][] = [
        [-inner, inner, CORNER_COLORS.red],
        [inner, -inner, CORNER_COLORS.blue],
        [inner, inner, "#f2f2f0"],
        [-inner, -inner, "#f2f2f0"],
      ];
      for (const [lx, lz, col] of corners) {
        put(refs.post.current, pi, r, lx, d.canvasY + 0.7, lz, 0.14, 1.4, 0.14);
        refs.post.current?.setColorAt(pi, c.set(col));
        pi++;
      }
      // ropes: three heights, four sides (slight sag is the real kit's job)
      for (const y of [0.45, 0.85, 1.25])
        for (const [lx, lz, len, rot] of [
          [0, inner, inner * 2, 0],
          [0, -inner, inner * 2, 0],
          [inner, 0, inner * 2, Math.PI / 2],
          [-inner, 0, inner * 2, Math.PI / 2],
        ] as const) {
          put(refs.rope.current, ri, r, lx, d.canvasY + y, lz, len, 0.035, 0.035, rot);
          ri++;
        }
      // steps at the red and blue corners (diagonally out), stools in those corners
      for (const [k, sgn] of [
        [0, -1],
        [1, 1],
      ] as const) {
        const o = h + 0.35;
        put(refs.step.current, i * 2 + k, r, sgn * o, d.canvasY / 2 - 0.1, -sgn * o, 0.9, d.canvasY - 0.2, 0.9, Math.PI / 4);
        put(refs.stool.current, i * 2 + k, r, sgn * (inner - 0.45), d.canvasY + 0.25, -sgn * (inner - 0.45), 0.4, 0.5, 0.4);
      }
    });
    for (const k of Object.values(refs)) {
      const mesh = k.current;
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [layoutKey]);

  // status lamps (band colours); the result status blinks
  const statusKey = rings.map((r) => r.status).join(",");
  const blink = useRef(false);
  const paint = (on: boolean) => {
    const mesh = refs.band.current;
    if (!mesh) return;
    const c = new THREE.Color();
    rings.forEach((r, i) => mesh.setColorAt(i, c.set(r.status === "result" && !on ? "#3a1512" : STATUS_LAMP[r.status])));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  useLayoutEffect(() => paint(true), [statusKey, layoutKey]);
  useFrame(({ clock }) => {
    if (!statusKey.includes("result")) return;
    const on = Math.floor(clock.elapsedTime * 2) % 2 === 0;
    if (on !== blink.current) {
      blink.current = on;
      paint(on);
    }
  });

  return (
    <group userData={{ noMerge: true }}>
      <instancedMesh ref={refs.platform} args={[geo.box, mats.platform, n]} castShadow={!lite} receiveShadow />
      <instancedMesh ref={refs.canvas} args={[geo.box, mats.canvas, n]} receiveShadow />
      <instancedMesh ref={refs.band} args={[geo.box, mats.band, n]} />
      <instancedMesh ref={refs.post} args={[geo.cyl, mats.post, n * 4]} />
      <instancedMesh ref={refs.rope} args={[geo.box, mats.rope, n * 12]} />
      <instancedMesh ref={refs.step} args={[geo.box, mats.step, n * 2]} />
      <instancedMesh ref={refs.stool} args={[geo.box, mats.stool, n * 2]} />
    </group>
  );
}

/* ------------------------------------------------------------ kit (look override) ------------------------------------------------------------ */

/**
 * PLACEHOLDER for `boxingKitOverride(look, corner)` (world/human/boxing/kit*.ts): a temporary look in the corner
 * colours (sports top + shorts + boots). Never mutates `look`; never saved. The real kit adds gloves, headgear,
 * trunks with the white waistband and the fitted vest.
 */
const kitCache = new Map<string, AvatarLook>();
export function boxingKitOverride(look: AvatarLook, corner: Corner): AvatarLook {
  const key = `${encodeLook(look)}|${corner}`;
  let k = kitCache.get(key);
  if (!k) {
    const c = CORNER_COLORS[corner];
    k = { ...look, accent: c, topColor: c, outfit: { ...look.outfit, top: "jersey", bottom: "shorts", shoes: "boots", accessory: "none", headwear: "no-hat" } };
    if (kitCache.size > 64) kitCache.clear();
    kitCache.set(key, k);
  }
  return k;
}

/* ------------------------------------------------------------ motion (pose) ------------------------------------------------------------ */

/** what the renderer asks the motion library for, per fighter per frame */
export interface FighterPose {
  clip: BoxingClip;
  /** seconds into the clip (actT / TICK_HZ) */
  t: number;
  /** a hit reaction blended on top (HIT_REACTION[punch]), with its own time */
  react: { clip: BoxingClip; t: number } | null;
}
/** nominal clip lengths (s) for the placeholder timing curves */
const DUR: Partial<Record<BoxingClip, number>> = { jab: 0.4, cross: 0.55, hookL: 0.6, hookR: 0.6, uppercutL: 0.6, uppercutR: 0.6, slipL: 0.45, slipR: 0.45, stepIn: 0.4, stepOut: 0.4, hitHeadLight: 0.3, hitHeadHeavy: 0.45, hitBodyLight: 0.3, hitBodyHeavy: 0.45 };
const bell = (clip: BoxingClip, t: number) => {
  const d = DUR[clip] ?? 1;
  const k = THREE.MathUtils.clamp(t / d, 0, 1);
  return Math.sin(Math.PI * k) ** 1.5;
};
type V3 = [number, number, number];
/** hand targets in the fighter's frame (faces +z; L = the fighter's left = +x) */
function handTargets(p: FighterPose, bob: number): { L: V3; R: V3; off: V3; tilt: number } {
  const g = (y: number): { L: V3; R: V3 } => ({ L: [0.15, 1.47 + y, 0.26], R: [-0.13, 1.43 + y, 0.2] });
  const low = { L: [0.2, 1.12, 0.22] as V3, R: [-0.2, 1.1, 0.2] as V3 };
  let { L, R } = g(bob);
  const off: V3 = [0, 0, 0];
  let tilt = 0;
  const e = bell(p.clip, p.t);
  const mix = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  switch (p.clip) {
    case "guardLow":
    case "stoolRest":
    case "defeat":
      ({ L, R } = low);
      if (p.clip === "defeat") tilt = 0.12;
      break;
    case "jab":
      L = mix(L, [0.06, 1.5, 0.66], e);
      break;
    case "cross":
      R = mix(R, [-0.02, 1.5, 0.7], e);
      off[1] = 0;
      break;
    case "hookL":
      L = mix(L, e < 0.5 ? [0.42, 1.48, 0.32] : [-0.04, 1.5, 0.5], e);
      break;
    case "hookR":
      R = mix(R, e < 0.5 ? [-0.42, 1.48, 0.32] : [0.04, 1.5, 0.5], e);
      break;
    case "uppercutL":
    case "uppercutR": {
      const right = p.clip === "uppercutR";
      const from: V3 = right ? [-0.1, 1.05, 0.32] : [0.1, 1.05, 0.32];
      const to: V3 = right ? [-0.03, 1.56, 0.46] : [0.03, 1.56, 0.46];
      const k = THREE.MathUtils.clamp(p.t / (DUR[p.clip] ?? 0.6), 0, 1);
      const arc = k < 0.35 ? mix(right ? R : L, from, k / 0.35) : k < 0.65 ? mix(from, to, (k - 0.35) / 0.3) : mix(to, right ? R : L, (k - 0.65) / 0.35);
      if (right) R = arc;
      else L = arc;
      break;
    }
    case "blockHigh":
    case "blockLow":
      L = [0.08, p.clip === "blockHigh" ? 1.6 : 1.25, 0.2];
      R = [-0.08, p.clip === "blockHigh" ? 1.58 : 1.23, 0.2];
      break;
    case "slipL":
    case "slipR":
      off[0] = (p.clip === "slipL" ? 0.2 : -0.2) * e;
      off[1] = -0.05 * e;
      break;
    case "duck":
      off[1] = -0.18;
      break;
    case "stepIn":
    case "stepOut":
      off[2] = (p.clip === "stepIn" ? 0.18 : -0.18) * e;
      break;
    case "knockdown":
    case "countIdle":
      if (p.clip === "knockdown") {
        off[1] = -0.55 * Math.min(1, p.t / 0.5);
        tilt = 0.35 * Math.min(1, p.t / 0.5);
        ({ L, R } = low);
      }
      break;
    case "getUp":
      off[1] = -0.55 * Math.max(0, 1 - p.t / 1.2);
      break;
    case "victory":
      L = [0.28, 2.05, 0.08];
      R = [-0.28, 2.05, 0.08];
      break;
    case "gloveTouch":
      L = mix(L, [0.07, 1.32, 0.58], bell("jab", (p.t % 1.4) * 0.35));
      R = mix(R, [-0.07, 1.32, 0.58], bell("jab", (p.t % 1.4) * 0.35));
      break;
    default:
      break;
  }
  if (p.react) {
    const k = bell(p.react.clip, p.react.t);
    tilt -= (p.react.clip.endsWith("Heavy") ? 0.22 : 0.12) * k;
    off[2] -= 0.08 * k;
  }
  return { L, R, off, tilt };
}

const _t = new THREE.Vector3();
const _pole = new THREE.Vector3();
/**
 * PLACEHOLDER fighter avatar: the person in the kit, posed by two-bone IK on the hands (guard, punches along their
 * stage curve, blocks, slips, steps, reactions, knockdown / rise, victory). The real motion library (P3-FGT-02,
 * `boxingPose` through the Avatar `rigLayer`) replaces this component's body at integration; its props stay.
 */
export function FighterAvatar({ look, corner, poseRef, lite = false }: { look: AvatarLook; corner: Corner; poseRef: React.RefObject<FighterPose | null>; lite?: boolean }) {
  const outer = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const anim = useRef(0);
  const shown = useMemo(() => boxingKitOverride(look, corner), [look, corner]);
  const arms = useRef<{ L: ArmBones; R: ArmBones } | null>(null);
  const seed = useMemo(() => [...encodeLook(look)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 1000, [look]);
  useFrame(({ clock, camera }) => {
    const p = poseRef.current;
    const g = inner.current;
    if (!p || !g || !outer.current) return;
    const bob = Math.sin(clock.elapsedTime * Math.PI * 4 + seed) * 0.012;
    const t = handTargets(p, bob);
    g.position.set(t.off[0], t.off[1] + bob * 0.6, t.off[2]);
    g.rotation.x = -t.tilt;
    if (camera.position.distanceTo(outer.current.getWorldPosition(_t)) > 25) return;
    if (!arms.current) {
      const b = (n: string) => g.getObjectByName(n) as THREE.Bone | undefined;
      const arm = (k: "L" | "R", side: 1 | -1): ArmBones | null => {
        const upper = b(`Bip01_${k}_UpperArm`);
        const fore = b(`Bip01_${k}_Forearm`);
        const hand = b(`Bip01_${k}_Hand`);
        return upper && fore && hand ? { upper, fore, hand, side, fingers: [] } : null;
      };
      const L = arm("L", -1);
      const R = arm("R", 1);
      if (!L || !R) return;
      arms.current = { L, R };
    }
    g.updateMatrixWorld(true);
    for (const [k, v] of [
      ["L", t.L],
      ["R", t.R],
    ] as const) {
      const a = arms.current[k];
      _t.set(v[0], v[1], v[2]);
      outer.current.localToWorld(_t);
      _pole.set(k === "L" ? 0.7 : -0.7, -1, -0.3).applyQuaternion(outer.current.getWorldQuaternion(new THREE.Quaternion()));
      reach(a, _t, _pole, 1);
    }
  }, 0.5);
  return (
    <group ref={outer}>
      <group ref={inner}>
        <Avatar look={shown} animRef={anim} showTag={false} shadows={!lite} quality={lite ? "lite" : "standard"} lod />
      </group>
    </group>
  );
}

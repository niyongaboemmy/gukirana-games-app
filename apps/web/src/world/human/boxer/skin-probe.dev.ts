import * as THREE from "three";
import { loadBodyNode } from "../boxing/load-glb.dev";
import { BoxingMotion } from "../boxing/motion";
import { BoxingRig, depth, type TorsoSlices } from "../boxing/rig";
import type { BoxingClipName } from "../boxing/clips";
import { BOXING_CLIPS } from "../boxing/clips";
import { makeBoxer, type BoxerInstance, type BoxerOutfit } from "./boxer-body";
import { driveHelpers, helperRig } from "./helpers";

/**
 * Node-side skinning probe for the boxer body (P3-FGT-14, dev / test only): loads a boxer GLB, builds a person, poses
 * it with the real motion library + rig + helpers, and measures the skinned mesh on the CPU:
 *  - `foreIn`: share of forearm / hand vertices inside the torso (the arm through the chest);
 *  - `stretch`: the worst edge stretch / squash round each shoulder joint (posed ÷ bind edge length: tearing,
 *    volume collapse, candy wrapping);
 *  - joints: shoulder / elbow / wrist world positions (the elbow flare: an elbow at shoulder height in the guard).
 */
export interface PoseProbe {
  clip: BoxingClipName;
  foreIn: number;
  /** the same per side (L = the lead in an orthodox pose) and the worst inside point (chest-local) */
  foreInSide: { L: number; R: number };
  stretchMax: number;
  stretchMin: number;
  /** bind position of the worst-stretched edge's first vertex (diagnostics) */
  stretchAt: THREE.Vector3;
  /** 95th / 99th percentile of the edge stretch (the typical worst, not one armpit sliver) */
  stretchP95: number;
  stretchP99: number;
  shoulder: { L: THREE.Vector3; R: THREE.Vector3 };
  elbow: { L: THREE.Vector3; R: THREE.Vector3 };
  wrist: { L: THREE.Vector3; R: THREE.Vector3 };
}

export interface ProbeBody {
  inst: BoxerInstance;
  rig: BoxingRig;
  torso: TorsoSlices | null;
  pose(clip: BoxingClipName, at?: number): PoseProbe;
}

export async function probeBody(path: string, opts: { outfit?: BoxerOutfit; bare?: boolean; measure?: TorsoSlices } = {}): Promise<ProbeBody> {
  const { outfit = "boxer", bare = true } = opts;
  const scene = await loadBodyNode(path);
  const extras = scene.userData as Parameters<typeof makeBoxer>[1];
  const inst = makeBoxer(scene, extras, { outfit, colors: { skin: "#7a4a2a", hair: "#111111", iris: "#3d2314", kit: "#c0262d" }, build: { heavy: 0, slim: 0, mature: 0 }, face: { beard: 0, brow: 0.85 }, shadows: false, bare });
  const rig = new BoxingRig(inst.root, inst.arms, { torso: inst.torso });
  const helpers = helperRig(inst.bone);
  const mesh = inst.mesh;
  const bones = mesh.skeleton.bones;
  const bind = bones.map((b) => ({ b, q: b.quaternion.clone(), p: b.position.clone() }));
  const geo = mesh.geometry;
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const si = geo.getAttribute("skinIndex") as THREE.BufferAttribute;
  const sw = geo.getAttribute("skinWeight") as THREE.BufferAttribute;
  const idx = (n: string) => bones.findIndex((b) => b.name === n);
  const wOf = (i: number, set: Set<number>) => {
    let w = 0;
    for (let k = 0; k < 4; k++) if (set.has(si.getComponent(i, k))) w += sw.getComponent(i, k);
    return w;
  };
  const foreSet = new Set(["L", "R"].flatMap((S) => [`Bip01_${S}_Forearm`, `Bip01_${S}_ForearmTwist`, `Bip01_${S}_Hand`].map(idx)).filter((k) => k >= 0));
  const fore: number[] = [];
  for (let i = 0; i < pos.count; i++) if (wOf(i, foreSet) > 0.6) fore.push(i);
  const foreSide = fore.map((i) => (pos.getX(i) > 0 ? "L" : "R"));
  // shoulder edges (bind): within 12 cm of either shoulder joint
  inst.root.updateMatrixWorld(true);
  const joint = (n: string) => inst.bone(n)!.getWorldPosition(new THREE.Vector3());
  const shoulders = [joint("Bip01_L_UpperArm"), joint("Bip01_R_UpperArm")];
  const ix = geo.index!;
  const edges: [number, number, number][] = [];
  const seen = new Set<string>();
  const P0 = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i);
  for (let t = 0; t < ix.count; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = ix.getX(t + e),
        b = ix.getX(t + ((e + 1) % 3));
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pa = P0(a);
      if (!shoulders.some((s) => s.distanceTo(pa) < 0.12)) continue;
      const l = pa.distanceTo(P0(b));
      if (l > 0.002) edges.push([a, b, l]);
    }
  }
  const sk = (i: number, out: THREE.Vector3) => mesh.localToWorld(mesh.getVertexPosition(i, out));
  const _a = new THREE.Vector3(),
    _b = new THREE.Vector3(),
    _l = new THREE.Vector3();
  const chest = inst.bone("Bip01_Spine2")!;
  return {
    inst,
    rig,
    torso: inst.torso,
    pose(clip, at) {
      for (const x of bind) {
        x.b.quaternion.copy(x.q);
        x.b.position.copy(x.p);
      }
      const m = new BoxingMotion();
      m.play({ clip, start: 0, blend: 0 });
      const t = at ?? BOXING_CLIPS[clip].impact ?? Math.min(0.5, BOXING_CLIPS[clip].duration * 0.5);
      rig.apply(m.sample(t), 1, false, true);
      driveHelpers(helpers);
      inst.root.updateMatrixWorld(true);
      mesh.skeleton.update();
      // forearm vertices inside the trunk (deflated 1 cm: touching skin is fine)
      let inside = 0;
      const side = { L: 0, R: 0 };
      const toChest = new THREE.Matrix4().copy(chest.matrixWorld).invert();
      const meas = opts.measure ?? inst.torso;
      if (meas)
        for (const i of fore) {
          sk(i, _l).applyMatrix4(toChest);
          if (depth(meas, _l, -0.01) > 0) {
            inside++;
            side[foreSide[fore.indexOf(i)] as "L" | "R"]++;
          }
        }
      let smax = 0,
        smin = 9,
        worst = 0;
      const all: number[] = [];
      for (const [a, b, l] of edges) {
        const r = sk(a, _a).distanceTo(sk(b, _b)) / l;
        all.push(r);
        if (r > smax) {
          smax = r;
          worst = a;
        }
        smin = Math.min(smin, r);
      }
      all.sort((x, y) => x - y);
      const J = (n: string) => joint(n);
      return {
        clip,
        foreIn: fore.length ? inside / fore.length : 0,
        foreInSide: { L: (side.L * 2) / (fore.length || 1), R: (side.R * 2) / (fore.length || 1) },
        stretchMax: smax,
        stretchMin: smin,
        stretchAt: P0(worst),
        stretchP95: all[Math.floor(all.length * 0.95)] ?? 0,
        stretchP99: all[Math.floor(all.length * 0.99)] ?? 0,
        shoulder: { L: J("Bip01_L_UpperArm"), R: J("Bip01_R_UpperArm") },
        elbow: { L: J("Bip01_L_Forearm"), R: J("Bip01_R_Forearm") },
        wrist: { L: J("Bip01_L_Hand"), R: J("Bip01_R_Hand") },
      };
    },
  };
}

import type { AvatarRig, AvatarRigLayer, AvatarRigLayerFactory } from "../../Avatar";
import { BoxingFace, type FaceWeights } from "./face";
import { dressBody, type Dressing } from "./kit-mesh";
import type { BoxingKit } from "./kit";
import type { BoxingMotion } from "./motion";
import { P } from "./pose";
import { BoxingRig } from "./rig";

/**
 * The boxing layer for <Avatar rigLayer={…}> (P3-FGT-02): every animation step it samples the fighter's
 * BoxingMotion at the shared clock and puts the pose on the body (rig.ts), then the expression on the face (face.ts);
 * with a kit it dresses the body (kit-mesh.ts) for as long as the layer lives.
 *
 *   const motion = useMemo(() => new BoxingMotion(), []);                 // one per fighter, outlives look swaps
 *   const layer = useMemo(() => boxingLayer({ motion, clock, kit }), [motion, kit]);
 *   <Avatar look={wearing ? kit.look : saved} rigLayer={layer} … />
 *
 * `weight` (a ref, 0…1) blends the whole layer in / out over the normal clips (walking up the ring steps → guard).
 */
export interface BoxingLayerOptions {
  motion: BoxingMotion;
  /** the shared match clock (s); default: performance.now() / 1000 */
  clock?: () => number;
  /** dress the body in the ring kit (null: motion only, e.g. the referee) */
  kit?: BoxingKit | null;
  weight?: { current: number };
  /** drive the face (default true) */
  face?: boolean;
}

const _fw: FaceWeights = { focus: 0, effort: 0, wince: 0, smile: 0, jaw: 0, eyes: 0 };

export function boxingLayer(opts: BoxingLayerOptions): AvatarRigLayerFactory {
  return (rig: AvatarRig): AvatarRigLayer => {
    const r = new BoxingRig(rig.root, rig.arms);
    const face = opts.face === false ? null : new BoxingFace(rig.root);
    let dress: Dressing | null = null;
    const clock = opts.clock ?? (() => performance.now() / 1000);
    let last = 0;
    let lastPose: Float32Array | null = null;
    let dbg: { calls: number } | null = null;
    // expose the rig for the lab (dev builds only)
    if (process.env.NODE_ENV !== "production") {
      (rig.root.userData as { gkBoxRig?: BoxingRig }).gkBoxRig = r;
      const g = globalThis as { __gkBoxFaces?: { face: BoxingFace | null; root: typeof rig.root; calls: number }[] };
      (g.__gkBoxFaces ??= []).push((dbg = { face, root: rig.root, calls: 0 }));
    }
    return {
      attach() {
        if (opts.kit && !dress) dress = dressBody(rig.root, rig.arms, rig.materials, rig.modelId, opts.kit, rig.shadows);
      },
      update(_dt, dist) {
        const w = opts.weight?.current ?? 1;
        if (w < 0.002) {
          lastPose = null;
          return;
        }
        const t = clock();
        last = t;
        const p = opts.motion.sample(t);
        lastPose = p;
        r.apply(p, w, !!opts.motion.current().mirrored, dist < 20);
      },
      afterFace(dt) {
        if (!face || !lastPose) return;
        const p = lastPose;
        _fw.focus = p[P.focus]!;
        _fw.effort = p[P.effort]!;
        _fw.wince = p[P.wince]!;
        _fw.smile = p[P.smile]!;
        _fw.jaw = p[P.jaw]!;
        _fw.eyes = p[P.eyes]!;
        face.apply(_fw, dt, opts.weight?.current ?? 1);
        if (dbg) dbg.calls++;
        void last;
      },
      dispose() {
        dress?.dispose();
        dress = null;
      },
    };
  };
}

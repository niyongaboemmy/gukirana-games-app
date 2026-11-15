import * as THREE from "three";

/**
 * The ring person's face (P3-FGT-13): the boxer body's face bones (jaw, eyelids, brows, mouth corners; boxer-body.ts)
 * driven by the motion library's face channels — focus, effort, wince, smile, mouth open (breathing), eyes closed —
 * plus blinking. Bind rotations are identity, so each bone turns about the body's own axes: +x opens the jaw / closes
 * the upper lid. Deterministic from the clock and a seed (no randomness).
 */
export interface FaceChannels {
  focus: number;
  effort: number;
  wince: number;
  smile: number;
  jaw: number;
  eyes: number;
}

interface Part {
  bone: THREE.Bone;
  rest: THREE.Vector3;
}

const _q = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);

export class BoxerFace {
  private readonly jaw: THREE.Bone | null;
  private readonly lids: { up: THREE.Bone | null; low: THREE.Bone | null }[];
  private readonly brows: Part[];
  private readonly corners: (Part & { side: number })[];
  private readonly sm: FaceChannels = { focus: 0, effort: 0, wince: 0, smile: 0, jaw: 0, eyes: 0 };

  constructor(
    bone: (n: string) => THREE.Bone | null,
    private readonly seed: number,
  ) {
    this.jaw = bone("Bip01_Jaw");
    this.lids = (["L", "R"] as const).map((s) => ({ up: bone(`Bip01_${s}_UpperLid`), low: bone(`Bip01_${s}_LowerLid`) }));
    const part = (n: string): Part | null => {
      const b = bone(n);
      return b ? { bone: b, rest: b.position.clone() } : null;
    };
    this.brows = (["L", "R"] as const).map((s) => part(`Bip01_${s}_Brow`)).filter((p): p is Part => !!p);
    this.corners = (["L", "R"] as const).flatMap((s) => {
      const p = part(`Bip01_${s}_MouthCorner`);
      return p ? [{ ...p, side: s === "L" ? 1 : -1 }] : [];
    });
  }

  /** after the body pose: `t` the clock (s), `dt` the frame time, `w` the layer weight */
  apply(ch: FaceChannels, t: number, dt: number) {
    const k = 1 - Math.exp(-dt * 14);
    const s = this.sm;
    for (const key of ["focus", "effort", "wince", "smile", "jaw", "eyes"] as const) s[key] += (ch[key] - s[key]) * k;
    // the mouth: open to breathe, a little with effort, set (closed) in focus
    if (this.jaw) this.jaw.quaternion.copy(_q.setFromAxisAngle(X, Math.min(0.36, 0.3 * s.jaw + 0.06 * s.effort + 0.05 * s.wince)));
    // blink every ~3–5 s (seeded), a wince narrows the eyes, "eyes" closes them
    const period = 3.2 + ((this.seed % 97) / 97) * 1.8;
    const ph = (t + (this.seed % 13) * 0.37) % period;
    const blink = ph < 0.12 ? Math.sin((ph / 0.12) * Math.PI) : 0;
    const close = Math.min(1, Math.max(blink, s.eyes, 0.45 * s.wince + 0.12 * s.focus));
    for (const l of this.lids) {
      if (l.up) l.up.quaternion.copy(_q.setFromAxisAngle(X, 0.62 * close));
      if (l.low) l.low.quaternion.copy(_q.setFromAxisAngle(X, -0.18 * close));
    }
    // brows: down and in when focused / wincing, up a little with a smile
    for (const b of this.brows) b.bone.position.set(b.rest.x * (1 - 0.06 * s.wince), b.rest.y - 0.0035 * s.wince - 0.0018 * s.focus + 0.0012 * s.smile, b.rest.z);
    // mouth corners: out and up for a smile, back and out in a wince / effort (teeth set)
    for (const c of this.corners) c.bone.position.set(c.rest.x + c.side * (0.004 * s.smile + 0.003 * s.wince + 0.002 * s.effort), c.rest.y + 0.004 * s.smile - 0.0015 * s.wince, c.rest.z - 0.002 * s.wince);
  }
}

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { pickRest, restPose, seedUnit, type RestInputs, type RestPose } from "./hand-rest";
import { reach, type ArmBones } from "./procedural";
import { SEAT_PROFILES, type HandRest, type SeatKind } from "./seat-profiles";

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** distance from p to the segment a–b */
function segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const ab = b.clone().sub(a);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/** a seated body on seat `k` in the avatar frame (+z forward, +y up, −x = the person's right), like the mocap */
function seated(k: SeatKind, thighR: number) {
  const p = SEAT_PROFILES[k];
  const hipY = p.seatH + 0.09;
  const back = p.lean * 0.5;
  return {
    p,
    hip: { R: V(-0.095, hipY, p.hipFwd), L: V(0.095, hipY, p.hipFwd) },
    knee: { R: V(-0.11, hipY + 0.03, p.hipFwd + 0.43), L: V(0.11, hipY + 0.03, p.hipFwd + 0.43) },
    shoulder: { R: V(-0.19, p.seatH + 0.6, p.hipFwd - 0.03 - back), L: V(0.19, p.seatH + 0.6, p.hipFwd - 0.03 - back) },
    torso: [V(0, p.seatH + 0.1, p.hipFwd - 0.03), V(0, p.seatH + 0.62, p.hipFwd - 0.06 - back)] as const,
    thighR,
  };
}

const BODIES = [
  { name: "slim (feminine)", thighR: 0.093, palm: 0.022 },
  { name: "masculine", thighR: 0.111, palm: 0.027 },
  { name: "broad (neutral)", thighR: 0.125, palm: 0.03 },
  { name: "skirt over the lap", thighR: 0.19, palm: 0.022 },
];
const ARM = 0.285 + 0.265; // upper arm + forearm (Rocketbox male)

describe("seated hand rest (P2-AVA-09)", () => {
  for (const kind of Object.keys(SEAT_PROFILES) as SeatKind[]) {
    it(`${kind}: every rest keeps the hands on top of the body, outside thighs / torso, within reach`, () => {
      for (const body of BODIES) {
        const b = seated(kind, body.thighR);
        const rests = new Set<HandRest>(b.p.hands.flat());
        for (const rest of rests) {
          for (const side of [1, -1] as const) {
            const k = side === 1 ? "R" : "L";
            const o = side === 1 ? "L" : "R";
            for (const along of [0.5, 0.64]) {
              const inp: RestInputs = {
                hip: b.hip[k],
                knee: b.knee[k],
                mid: b.hip.R.clone().add(b.hip.L).multiplyScalar(0.5),
                up: V(0, 1, 0),
                fwd: V(0, 0, 1),
                left: V(1, 0, 0),
                origin: V(),
                side,
                thighR: body.thighR,
                palm: body.palm,
                along,
                lean: b.p.lean,
              };
              const out: RestPose = { wrist: V(), fingers: V(), palm: V() };
              restPose(rest, inp, b.p.armrest, out);
              const what = `${kind} ${body.name} ${rest} ${k} along ${along}`;
              for (const v of [out.wrist, out.fingers, out.palm]) expect(Number.isFinite(v.x + v.y + v.z), what).toBe(true);
              // outside both thighs (the wrist sits a palm's depth over the surface) and the torso
              // (on an armrest the furniture decides: a skirt's lap may reach out under a narrow stadium armrest)
              if (rest !== "armrest" || body.thighR < 0.15) expect(segDist(out.wrist, b.hip[k], b.knee[k]), what).toBeGreaterThanOrEqual(body.thighR + body.palm * 0.8);
              expect(segDist(out.wrist, b.hip[o], b.knee[o]), what).toBeGreaterThanOrEqual(body.thighR);
              expect(segDist(out.wrist, b.torso[0], b.torso[1]), what).toBeGreaterThanOrEqual(0.12);
              // reachable from the shoulder without locking the elbow
              expect(out.wrist.distanceTo(b.shoulder[k]), what).toBeLessThan(ARM - 0.01);
              // on this side of the body (a hand never crosses over to the other side, even in the lap)
              expect(out.wrist.x * (side === 1 ? -1 : 1), what).toBeGreaterThan(-0.02);
              // palm down, fingers forward-ish, orthonormal
              expect(out.palm.y, what).toBeLessThan(-0.6);
              expect(out.fingers.z + Math.abs(out.fingers.x), what).toBeGreaterThan(0.5);
              expect(Math.abs(out.palm.dot(out.fingers)), what).toBeLessThan(1e-6);
              expect(out.palm.length()).toBeCloseTo(1, 6);
              expect(out.fingers.length()).toBeCloseTo(1, 6);
              if (rest === "armrest" && b.p.armrest) {
                // over the armrest, not inside it
                expect(out.wrist.y, what).toBeGreaterThan(b.p.armrest.y + body.palm * 0.9);
                expect(Math.abs(Math.abs(out.wrist.x) - b.p.armrest.x), what).toBeLessThan(0.01);
              }
            }
          }
        }
      }
    });
  }

  it("armrests only where the chair has them; choices are deterministic and varied per person", () => {
    for (const [kind, p] of Object.entries(SEAT_PROFILES)) {
      if (!p.armrest) expect(p.hands.flat().includes("armrest"), kind).toBe(false);
      expect(p.hands.length).toBeGreaterThan(1);
      const picks = new Set<string>();
      for (let s = 0; s < 400; s++) {
        const r = pickRest(p, s * 7919);
        expect(pickRest(p, s * 7919)).toBe(r);
        expect(p.hands).toContain(r);
        picks.add(r.join("/"));
      }
      expect(picks.size, kind).toBeGreaterThan(2);
    }
    for (let k = 0; k < 50; k++) {
      const u = seedUnit(12345, k);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });

  it("arm IK: no NaN, no flip, for reachable, unreachable and degenerate targets", () => {
    const root = new THREE.Group();
    const upper = new THREE.Bone();
    const fore = new THREE.Bone();
    const hand = new THREE.Bone();
    root.add(upper);
    upper.add(fore);
    fore.add(hand);
    upper.position.set(-0.19, 1.06, 0);
    fore.position.set(0, -0.285, 0);
    hand.position.set(0, -0.265, 0);
    const arm: ArmBones = { upper, fore, hand, side: 1, fingers: [] };
    const pole = V(-0.7, -1, -0.45);
    const targets = [V(-0.12, 0.66, 0.25), V(-0.44, 0.7, 0.3), V(-0.19, 1.06, 0), V(-0.19, 0.0, 0), V(-2, 1, 3), V(-0.19, 0.6, 0)];
    for (const t of targets) {
      upper.quaternion.identity();
      fore.quaternion.identity();
      root.updateMatrixWorld(true);
      reach(arm, t, pole, 1);
      root.updateMatrixWorld(true);
      for (const q of [upper.quaternion, fore.quaternion]) expect(Number.isFinite(q.x + q.y + q.z + q.w)).toBe(true);
      const s = upper.getWorldPosition(V());
      const e = fore.getWorldPosition(V());
      const h = hand.getWorldPosition(V());
      expect(Number.isFinite(h.x + h.y + h.z)).toBe(true);
      // bone lengths kept
      expect(s.distanceTo(e)).toBeCloseTo(0.285, 4);
      expect(e.distanceTo(h)).toBeCloseTo(0.265, 4);
      const d = s.distanceTo(t);
      if (d > 0.06 && d < 0.54) {
        // reachable: the hand gets there, and the elbow bends towards the pole (out and back), not inwards
        expect(h.distanceTo(t)).toBeLessThan(0.01);
        const n = t.clone().sub(s).normalize();
        const pp = pole.clone().addScaledVector(n, -pole.dot(n)).normalize();
        expect(e.clone().sub(s).dot(pp)).toBeGreaterThan(0);
      }
    }
  });
});

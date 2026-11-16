import { describe, it } from "vitest";
import * as THREE from "three";
import { armPoints, clampArm, DEG, handRot, newPoints, type ArmDims } from "./arm-fk";
import { sampleClip, type BoxingClipName } from "./clips";
import { ARM, P } from "./pose";

// authoring aid (skipped unless FITROOT is set): keyed angles that put the glove / elbow at root-frame targets at a key
// of a clip (its torso as authored).
// FITROOT='[[clip, t, side(1 lead / -1 rear), [glove x,y,z], [elbow x,y,z], [palm x,y,z]?], …]'
const dims = (s: number): ArmDims => ({ s, clav: new THREE.Vector3(0.023 * s, 0.138, 0.074), shoulder: new THREE.Vector3(0.207 * s, 0.109, 0.068), upper: 0.257, fore: 0.268, glove: 0.085 });
const K_LEG = 0.946 / 0.8952;
function chestFrame(p: Float32Array) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p[P.lean]!, p[P.yaw]! + p[P.chest]!, -p[P.bend]!, "YXZ"));
  const pos = new THREE.Vector3(p[P.hx]! * K_LEG, p[P.hy]! * K_LEG, p[P.hz]! * K_LEG).add(new THREE.Vector3(0, 0.349, 0.006).applyQuaternion(q));
  return { q, pos };
}

describe.skipIf(!process.env.FITROOT)("fit keys to root-frame targets", () => {
  it("prints", () => {
    const T = JSON.parse(process.env.FITROOT!) as [BoxingClipName, number, number, number[], number[], number[]?, string?][];
    for (const [clip, t, side, g0, e0, pm, rel] of T) {
      const pose = sampleClip(clip, t);
      const { q, pos } = chestFrame(pose);
      const qi = q.clone().invert();
      // rel = "head": the glove / elbow are offsets from the head joint (the chest's head, root axes): a guarding glove
      // stays by the face whatever the torso does
      const head = new THREE.Vector3(0, 0.31, 0.097).applyQuaternion(q).add(pos);
      const g = rel === "head" ? [g0[0]! + head.x, g0[1]! + head.y, g0[2]! + head.z] : g0;
      const e = rel === "head" ? [e0[0]! + head.x, e0[1]! + head.y, e0[2]! + head.z] : e0;
      const G = new THREE.Vector3(...g).sub(pos).applyQuaternion(qi);
      const E = new THREE.Vector3(...e).sub(pos).applyQuaternion(qi);
      const PM = pm ? new THREE.Vector3(...pm).normalize().applyQuaternion(qi) : null;
      const d = dims(side);
      const a = new Float32Array([50, 0, 20, 110, 30, 0, 4, 6].map((x) => x * DEG));
      const p = newPoints();
      const qh = new THREE.Quaternion();
      const cost = () => {
        armPoints(d, a, 0, p);
        let c = p.gl.distanceToSquared(G) * 4 + 0.6 * p.el.distanceToSquared(E);
        // comfort: of the poses that put the glove there, the one nearest a relaxed arm (no extreme twists)
        const NAT = [50, 10, 20, 100, 40];
        free.forEach((i, j) => (c += 0.0006 * (a[i]! - NAT[j]! * DEG) ** 2));
        c += 0.08 * Math.max(0, -a[ARM.rot]! - 25 * DEG) ** 2;
        if (PM) {
          handRot(a, 0, side, qh);
          c += 0.01 * (1 - new THREE.Vector3(-side, 0, 0).applyQuaternion(qh).dot(PM));
        }
        return c;
      };
      const free = PM ? [ARM.flex, ARM.abd, ARM.rot, ARM.elbow, ARM.pron] : [ARM.flex, ARM.abd, ARM.rot, ARM.elbow];
      let c = cost();
      for (let restart = 0; restart < 8; restart++) {
        const b = Float32Array.from(a);
        if (restart > 0) for (const i of free) a[i] = a[i]! + (((restart * 7919 + i * 104729) % 1000) / 1000 - 0.5) * 70 * DEG;
        clampArm(a, 0);
        let cc = cost();
        for (let step = 10 * DEG; step > 0.05 * DEG; step *= 0.6)
          for (let it = 0; it < 80; it++) {
            let improved = false;
            for (const i of free)
              for (const sg of [1, -1]) {
                const v = a[i]!;
                a[i] = v + sg * step;
                clampArm(a, 0);
                const c2 = cost();
                if (c2 < cc) {
                  cc = c2;
                  improved = true;
                } else a[i] = v;
              }
            if (!improved) break;
          }
        if (cc < c) c = cc;
        else a.set(b);
      }
      armPoints(d, a, 0, p);
      const f = (i: number) => Math.round(a[i]! / DEG);
      const gr = p.gl.clone().applyQuaternion(q).add(pos);
      const er = p.el.clone().applyQuaternion(q).add(pos);
      handRot(a, 0, side, qh);
      const palm = new THREE.Vector3(-side, 0, 0).applyQuaternion(qh).applyQuaternion(q);
      const s3 = (v: THREE.Vector3) => v.toArray().map((x) => x.toFixed(2)).join(",");
      console.log(`${clip}@${t} ${side === 1 ? "leadArm" : "rearArm"}: { flex: ${f(ARM.flex)}, abd: ${f(ARM.abd)}, rot: ${f(ARM.rot)}, elbow: ${f(ARM.elbow)}, pron: ${f(ARM.pron)} } // glove ${s3(gr)} (${(gr.distanceTo(new THREE.Vector3(...g)) * 100).toFixed(1)} cm) elbow ${s3(er)} palm ${s3(palm)}`);
    }
  });
});

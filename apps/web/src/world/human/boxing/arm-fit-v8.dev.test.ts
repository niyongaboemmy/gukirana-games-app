import { describe, it } from "vitest";
import * as THREE from "three";
import { armPoints, clampArm, DEG, handRot, newPoints, type ArmDims } from "./arm-fk";
import { sampleClip, type BoxingClipName } from "./clips";
import { ARM, P } from "./pose";

// P3-FGT-19B authoring aid (skipped unless FITV8 is set): keyed angles for the v8 guard / punches from the design's
// targets (docs/design/fighter-v8/SPEC.md §9) — the glove centre relative to the HEAD joint and the elbow relative to
// its SHOULDER (root axes, metres), the wrist fixed straight, the clavicle angles given. Run with the v8 torso:
//   NEXT_PUBLIC_FF_BOXER_V8=1 FITV8='[[clip, t, side, glove, elbow, palm|null, elev, prot, gloveRel?], …]' \
//     npx vitest run src/world/human/boxing/arm-fit-v8.dev.test.ts
// gloveRel: "head" (default) or "shoulder".
const dims = (s: number): ArmDims => ({ s, clav: new THREE.Vector3(0.023 * s, 0.138, 0.074), shoulder: new THREE.Vector3(0.207 * s, 0.109, 0.068), upper: 0.257, fore: 0.268, glove: 0.085 });
const K_LEG = 0.946 / 0.8952;
function chestFrame(p: Float32Array) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p[P.lean]!, p[P.yaw]! + p[P.chest]!, -p[P.bend]!, "YXZ"));
  const pos = new THREE.Vector3(p[P.hx]! * K_LEG, p[P.hy]! * K_LEG, p[P.hz]! * K_LEG).add(new THREE.Vector3(0, 0.349, 0.006).applyQuaternion(q));
  return { q, pos };
}

describe.skipIf(!process.env.FITV8)("fit v8 keys", () => {
  it("prints", () => {
    const T = JSON.parse(process.env.FITV8!) as [BoxingClipName, number, number, number[], number[], number[] | null, number, number, string?][];
    for (const [clip, t, side, g0, e0, pm, elev, prot, gRel] of T) {
      const pose = sampleClip(clip, t);
      const { q, pos } = chestFrame(pose);
      const qi = q.clone().invert();
      const head = new THREE.Vector3(0, 0.31, 0.097).applyQuaternion(q).add(pos);
      const d = dims(side);
      const a = new Float32Array([50, 0, 20, 110, 30, 0, elev, prot].map((x) => x * DEG));
      const p = newPoints();
      // the shoulder at these clavicle angles (root frame)
      armPoints(d, a, 0, p);
      const sh = p.sh.clone().applyQuaternion(q).add(pos);
      const gAbs = new THREE.Vector3(...g0).add(gRel === "shoulder" ? sh : head);
      const eAbs = new THREE.Vector3(...e0).add(sh);
      const G = gAbs.clone().sub(pos).applyQuaternion(qi);
      const E = eAbs.clone().sub(pos).applyQuaternion(qi);
      const PM = pm ? new THREE.Vector3(...pm).normalize().applyQuaternion(qi) : null;
      const qh = new THREE.Quaternion();
      const free = [ARM.flex, ARM.abd, ARM.rot, ARM.elbow, ARM.pron];
      const cost = () => {
        armPoints(d, a, 0, p);
        let c = p.gl.distanceToSquared(G) * 4 + 1.2 * p.el.distanceToSquared(E);
        const NAT = [50, 10, 20, 100, 40];
        free.forEach((i, j) => (c += 0.0004 * (a[i]! - NAT[j]! * DEG) ** 2));
        if (PM) {
          handRot(a, 0, side, qh);
          c += 0.02 * (1 - new THREE.Vector3(-side, 0, 0).applyQuaternion(qh).dot(PM));
        }
        return c;
      };
      let c = cost();
      for (let restart = 0; restart < 10; restart++) {
        const b = Float32Array.from(a);
        if (restart > 0) for (const i of free) a[i] = a[i]! + (((restart * 7919 + i * 104729) % 1000) / 1000 - 0.5) * 80 * DEG;
        clampArm(a, 0);
        let cc = cost();
        for (let step = 10 * DEG; step > 0.05 * DEG; step *= 0.6)
          for (let it = 0; it < 100; it++) {
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
      const fa = er.clone().sub(p.wr.clone().applyQuaternion(q).add(pos)).normalize();
      const s3 = (v: THREE.Vector3) => v.toArray().map((x) => x.toFixed(3)).join(",");
      console.log(
        `${clip}@${t} ${side === 1 ? "leadArm" : "rearArm"}: { flex: ${f(ARM.flex)}, abd: ${f(ARM.abd)}, rot: ${f(ARM.rot)}, elbow: ${f(ARM.elbow)}, pron: ${f(ARM.pron)}, wrist: 0, elev: ${elev}, prot: ${prot} } // glove err ${(gr.distanceTo(gAbs) * 100).toFixed(1)} cm, elbow err ${(er.distanceTo(eAbs) * 100).toFixed(1)} cm, forearm ${(Math.asin(Math.abs(fa.y)) / DEG).toFixed(0)}° from horizontal, elbow-shoulder dy ${((er.y - sh.y) * 100).toFixed(0)} cm, palm ${s3(palm)}`,
      );
    }
  });
});

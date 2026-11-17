// P3-FGT-19B fighter-v8 harness: the per-pose acceptance checks (docs/design/fighter-v8/SPEC.md §15), injected after
// inpage.js. One ring person at a time (the boxing lab's boxer view), measured on its skinned surface and posed bones.
//
// window.__fv8c = {
//   pose(person, kind)      → kind "guard" | "jab" | "hook": the 15a numbers (forearm angles, elbows, gloves, wrists,
//                             palms, extension, elbow angle, eyes visible, rear glove → cheek gap)
//   garments(person)        → share of singlet / trunks / band vertices inside the skin; singlet vertices outside the
//                             band within its height (garment–garment)
//   armCover(person)        → 14a: outer upper-arm vertices covered by singlet cloth within 4 cm, from the front, both
//                             broadcast sides and the 3/4 camera (ray test)
//   faceOpen(person)        → 16: eyes, nose tip and mouth corners unoccluded by the headgear from the front camera
//   f0(people)              → 20: the skin specular F0 uniform of every person
// }
(() => {
  const SLOT = { skin: 0, vest: 1, vestTrim: 2, trunks: 3, glove: 8, gloveTarget: 9, gloveCuff: 10, headgear: 11, headgearTrim: 12, belt: 24, vestLining: 25 };
  const T = () => window.__fv8.ctx().three;
  const V3 = (a) => new (T().Vector3)(a[0], a[1], a[2]);
  const bone = (person, n) => person.bones.find((b) => b.name === n) ?? null;
  const W = (person, n) => {
    const b = bone(person, n);
    if (!b) return null;
    const v = b.getWorldPosition(new (T().Vector3)());
    return [v.x, v.y, v.z];
  };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => {
    const l = len(a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const DEG = 180 / Math.PI;
  const r3 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(4));

  /** the person's boxer mesh, skinned to world space: positions, normals, slots, dominant bone per vertex, triangles */
  function surface(person) {
    const mesh = person.meshes.find((m) => m.geometry.attributes._mat) ?? person.meshes[0];
    const g = mesh.geometry;
    const n = g.attributes.position.count;
    const P = new Float32Array(n * 3);
    const v = new (T().Vector3)();
    mesh.updateMatrixWorld(true);
    // (the garments' pose correctives, corrective.ts: added in bind space before skinning, as the shader does)
    const U = mesh.material?.userData?.u;
    const CN = U?.uCorrN?.value ?? 0;
    const CT = CN > 0 ? U.uCorr.value.image.data : null;
    const crow = g.attributes._crow;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(g.attributes.position, i);
      const r = CT && crow ? crow.getX(i) : -1;
      if (r >= 0) {
        const base = Math.round(r) * (CN + 1);
        const side = CT[base * 4],
          grp = CT[base * 4 + 1],
          am = CT[base * 4 + 2];
        for (let s = 0; s < CN; s++) {
          const w = U.uCw.value[s];
          const ws = (grp < 0.5 ? w.y + (w.x - w.y) * side : w.w + (w.z - w.w) * side) * am;
          if (ws > 0.002) {
            const o = (base + 1 + s) * 4;
            v.x += CT[o] * ws;
            v.y += CT[o + 1] * ws;
            v.z += CT[o + 2] * ws;
          }
        }
      }
      mesh.applyBoneTransform(i, v);
      v.applyMatrix4(mesh.matrixWorld);
      P[i * 3] = v.x;
      P[i * 3 + 1] = v.y;
      P[i * 3 + 2] = v.z;
    }
    // the material's cloth push and skin tuck (boxer-material.ts, P3-FGT-19B), mirrored so the checks measure what is
    // drawn. The cones are rebuilt from this instant's bones (a synchronously posed sample has no rendered frame yet).
    const caps = mesh.material?.userData?.caps;
    const idx = g.index.array;
    const normals = () => {
      const N = new Float32Array(n * 3);
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t] * 3,
          b = idx[t + 1] * 3,
          c = idx[t + 2] * 3;
        const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]],
          e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
        const fn = cross(e1, e2);
        for (const q of [a, b, c]) for (let k = 0; k < 3; k++) N[q + k] += fn[k];
      }
      for (let i = 0; i < n; i++) {
        const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1;
        for (let k = 0; k < 3; k++) N[i * 3 + k] /= l;
      }
      return N;
    };
    let N = normals();
    if (caps) {
      const slot0 = g.attributes._mat;
      const bw = (name) => {
        const b0 = mesh.skeleton.bones.find((x) => x.name === name);
        const q = b0.getWorldPosition(new (T().Vector3)());
        return [q.x, q.y, q.z];
      };
      const cone = (a, b, r) => [[...bw(a), r[0]], [...bw(b), r[1]]];
      const C = [cone("Bip01_L_UpperArm", "Bip01_L_Forearm", caps.arm), cone("Bip01_R_UpperArm", "Bip01_R_Forearm", caps.arm), cone("Bip01_L_Thigh", "Bip01_L_Calf", caps.thigh), cone("Bip01_R_Thigh", "Bip01_R_Calf", caps.thigh)];
      const A = C.map((c) => c[0]),
        Bc = C.map((c) => c[1]);
      const ax = bw("Bip01_Pelvis"),
        bx = bw("Bip01_Neck");
      const seg = (p, a, b) => {
        const ab = sub(b, a);
        const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / Math.max(dot(ab, ab), 1e-8)));
        return [add(a, scl(ab, t)), t];
      };
      const tuck = g.attributes._tuck;
      for (let i = 0; i < n; i++) {
        const sl = Math.round(slot0.getX(i));
        let p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
        if (sl === 0) {
          const tk = tuck ? tuck.getX(i) : 0;
          if (tk <= 0) continue;
          p = sub(p, scl([N[i * 3], N[i * 3 + 1], N[i * 3 + 2]], tk * 0.03));
        } else if ((mesh.material.userData.u?.uArmPush?.value ?? 1) > 0.5 && (sl === 1 || sl === 2 || sl === 25) && g.attributes.position.getY(i) < (caps.shoulderY ?? 99) - 0.06) {
          for (let k = 0; k < 2; k++)
            for (let it = 0; it < 3; it++) {
              const [c, t] = seg(p, A[k], Bc[k]);
              const r = A[k][3] + (Bc[k][3] - A[k][3]) * t + 0.006;
              const d = len(sub(p, c));
              if (d >= r || t <= 0.12) break;
              const [q] = seg(p, ax, bx);
              p = add(p, scl(norm(sub(q, p)), r - d));
            }
        } else if (sl === 3) {
          for (let k = 2; k < 4; k++) {
            const [c, t] = seg(p, A[k], Bc[k]);
            const r = A[k][3] + (Bc[k][3] - A[k][3]) * t + 0.008 + 0.012 * t;
            const dv = sub(p, c);
            const d = len(dv);
            if (d < r && d > 1e-5 && t > 0.08) p = add(c, scl(dv, r / d));
          }
        } else continue;
        P[i * 3] = p[0];
        P[i * 3 + 1] = p[1];
        P[i * 3 + 2] = p[2];
      }
      N = normals();
    }
    const slot = g.attributes._mat;
    const si = g.attributes.skinIndex,
      sw = g.attributes.skinWeight;
    const dom = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      let bj = 0,
        bw = -1;
      for (let q = 0; q < 4; q++) if (sw.getComponent(i, q) > bw) ((bw = sw.getComponent(i, q)), (bj = si.getComponent(i, q)));
      dom[i] = bj;
    }
    const S = (i) => Math.round(slot.getX(i));
    const p = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    const nrm = (i) => [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];
    const boneName = (i) => mesh.skeleton.bones[dom[i]]?.name ?? "";
    const trisOf = (pred) => {
      const out = [];
      for (let t = 0; t < idx.length; t += 3) if (pred(S(idx[t]), idx[t])) out.push([idx[t], idx[t + 1], idx[t + 2]]);
      return out;
    };
    return { n, P, N, S, p, nrm, boneName, idx, trisOf, mesh };
  }

  /** Möller–Trumbore: distance along the ray (o, unit d) to triangle abc, or Infinity */
  function rayTri(o, d, a, b, c) {
    const e1 = sub(b, a),
      e2 = sub(c, a);
    const pv = cross(d, e2);
    const det = dot(e1, pv);
    if (Math.abs(det) < 1e-12) return Infinity;
    const inv = 1 / det;
    const tv = sub(o, a);
    const u = dot(tv, pv) * inv;
    if (u < 0 || u > 1) return Infinity;
    const qv = cross(tv, e1);
    const v = dot(d, qv) * inv;
    if (v < 0 || u + v > 1) return Infinity;
    const t = dot(e2, qv) * inv;
    return t > 1e-6 ? t : Infinity;
  }
  /** first hit distance of a ray against a triangle list (with a bounding-sphere pre-cull per triangle) */
  function firstHit(s, tris, o, d, maxT = Infinity) {
    let best = Infinity;
    for (const [a, b, c] of tris) {
      const t = rayTri(o, d, s.p(a), s.p(b), s.p(c));
      if (t < best && t < maxT) best = t;
    }
    return best;
  }

  function headFrame(person) {
    const h = bone(person, "Bip01_Head");
    const q = h.getWorldQuaternion(new (T().Quaternion)());
    const f = new (T().Vector3)(0, 0, 1).applyQuaternion(q);
    const fwd = norm([f.x, 0, f.z]);
    return { head: W(person, "Bip01_Head"), fwd };
  }

  /** 15a: the guard / jab / hook numbers (orthodox: the lead arm is the left) */
  function pose(person, kind) {
    const s = surface(person);
    const J = (n) => W(person, n);
    const out = { kind };
    const arm = (S) => {
      const sh = J(`Bip01_${S}_UpperArm`),
        el = J(`Bip01_${S}_Forearm`),
        wr = J(`Bip01_${S}_Hand`),
        kn = J(`Bip01_${S}_Finger2`),
        tip = J(`Bip01_${S}_Finger22`) ?? J(`Bip01_${S}_Finger21`);
      const fa = sub(wr, el);
      const hd = sub(kn, wr);
      const faN = norm(fa);
      const palmRaw = tip ? sub(tip, kn) : [0, -1, 0];
      const palm = norm(sub(palmRaw, scl(faN, dot(palmRaw, faN))));
      return {
        sh,
        el,
        wr,
        forearmDeg: Math.asin(Math.min(1, Math.abs(fa[1]) / len(fa))) * DEG,
        elbowBelow: sh[1] - el[1],
        wristDev: Math.acos(Math.max(-1, Math.min(1, dot(faN, norm(hd))))) * DEG,
        palm,
        extension: len(sub(wr, sh)) / (len(sub(el, sh)) + len(sub(wr, el))),
        elbowAngle: Math.acos(Math.max(-1, Math.min(1, dot(norm(sub(sh, el)), norm(sub(wr, el)))))) * DEG,
        glove: add(wr, scl(faN, 0.08)),
      };
    };
    const L = arm("L"),
      R = arm("R");
    const mid = scl(add(L.sh, R.sh), 0.5);
    const xAxis = norm(sub(L.sh, R.sh));
    const halfW = len(sub(L.sh, mid));
    const inside = (a) => Math.abs(dot(sub(a.el, mid), xAxis)) <= halfW;
    out.wristDevMax = r3(Math.max(L.wristDev, R.wristDev));
    if (kind === "guard") {
      const { fwd } = headFrame(person);
      const eL = J("Bip01_L_Eye"),
        eR = J("Bip01_R_Eye");
      const eyes = scl(add(eL, eR), 0.5);
      out.forearmLead = r3(L.forearmDeg);
      out.forearmRear = r3(R.forearmDeg);
      out.forearmMin = r3(Math.min(L.forearmDeg, R.forearmDeg));
      out.forearmMax = r3(Math.max(L.forearmDeg, R.forearmDeg));
      out.elbowBelowMin = r3(Math.min(L.elbowBelow, R.elbowBelow));
      out.elbowsInside = inside(L) && inside(R);
      out.leadGloveDy = r3(L.glove[1] - eyes[1]);
      out.leadGloveFwd = r3(dot(sub(L.glove, eyes), fwd));
      // eyes visible from the front camera: no glove triangle on the ray to either eye
      const gloves = s.trisOf((sl) => sl === SLOT.glove || sl === SLOT.gloveTarget || sl === SLOT.gloveCuff);
      const cam = add(eyes, scl(fwd, 1.6));
      const seen = (e) => {
        const d = norm(sub(e, cam));
        return firstHit(s, gloves, cam, d, len(sub(e, cam)) - 0.005) === Infinity;
      };
      out.eyesVisible = seen(eL) && seen(eR);
      // the rear glove's gap to the cheek: its vertices against the face skin on the rear side
      let gap = Infinity;
      const face = [];
      for (let i = 0; i < s.n; i++) if (s.S(i) === SLOT.skin && s.boneName(i) === "Bip01_Head") face.push(i);
      const rearG = [];
      for (let i = 0; i < s.n; i++) if ((s.S(i) === SLOT.glove || s.S(i) === SLOT.gloveTarget || s.S(i) === SLOT.gloveCuff) && /_R_/.test(s.boneName(i))) rearG.push(i);
      for (let k = 0; k < rearG.length; k += 2) for (const f of face) gap = Math.min(gap, len(sub(s.p(rearG[k]), s.p(f))));
      out.rearGloveCheekGap = r3(gap);
    }
    if (kind === "jab") {
      out.palmDown = r3(-L.palm[1]);
      out.extension = r3(L.extension);
    }
    if (kind === "hook") {
      out.elbowAngle = r3(L.elbowAngle);
      out.elbowVsShoulder = r3(Math.abs(L.el[1] - L.sh[1]));
      const toMid = norm([mid[0] - L.wr[0], 0, mid[2] - L.wr[2]]);
      out.palmDownOrIn = r3(Math.max(-L.palm[1], dot(L.palm, toMid)));
    }
    return out;
  }

  /** 7: singlet / trunks / band vertices inside the skin; singlet outside the band within its height */
  /** closest point on triangle abc to p → [q, u, v, w] (Ericson 5.1.5) */
  function closestOnTri(p, a, b, c) {
    const ab = sub(b, a),
      ac = sub(c, a),
      ap = sub(p, a);
    const d1 = dot(ab, ap),
      d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return [a, 1, 0, 0];
    const bp = sub(p, b);
    const d3 = dot(ab, bp),
      d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return [b, 0, 1, 0];
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      return [add(a, scl(ab, v)), 1 - v, v, 0];
    }
    const cp = sub(p, c);
    const d5 = dot(ab, cp),
      d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return [c, 0, 0, 1];
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      return [add(a, scl(ac, w)), 1 - w, 0, w];
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      return [add(b, scl(sub(c, b), w)), 0, 1 - w, w];
    }
    const den = 1 / (va + vb + vc);
    const v = vb * den,
      w = vc * den;
    return [add(add(a, scl(ab, v)), scl(ac, w)), 1 - v - w, v, w];
  }

  function garments(person) {
    const s = surface(person);
    const g0 = s.mesh.geometry;
    const cell = 0.03,
      grid = new Map();
    const used = new Uint8Array(s.n);
    for (const v of s.idx) used[v] = 1;
    // the DRAWN skin triangles in a grid (each in every cell its box touches)
    const skinT = s.trisOf((sl) => sl === SLOT.skin);
    skinT.forEach((t, k) => {
      const ps = t.map((i) => s.p(i));
      const lo = [0, 1, 2].map((ax) => Math.floor(Math.min(ps[0][ax], ps[1][ax], ps[2][ax]) / cell));
      const hi = [0, 1, 2].map((ax) => Math.floor(Math.max(ps[0][ax], ps[1][ax], ps[2][ax]) / cell));
      for (let x = lo[0]; x <= hi[0]; x++)
        for (let y = lo[1]; y <= hi[1]; y++)
          for (let z = lo[2]; z <= hi[2]; z++) {
            const key = `${x},${y},${z}`;
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key).push(k);
          }
    });
    // (the layers under the band are not visible: the singlet's tucked part and the trunks' gathered top ring — the band
    // hold below checks those; the turned facing is a lining inside the singlet, out of the count)
    const gp0 = g0.attributes.position;
    let bandLo = Infinity,
      bandHi = -Infinity;
    for (let i = 0; i < s.n; i++)
      if (used[i] && s.S(i) === SLOT.belt) {
        bandLo = Math.min(bandLo, gp0.getY(i));
        bandHi = Math.max(bandHi, gp0.getY(i));
      }
    const hidden = (i, sl) => (sl === SLOT.trunks && gp0.getY(i) > bandLo - 0.012) || ((sl === SLOT.vest || sl === SLOT.vestTrim) && gp0.getY(i) < bandHi && gp0.getY(i) > bandLo - 0.03);
    let occluded = 0,
      tested = 0,
      inside = 0,
      worst = 0;
    const bySlot = {},
      byBone = {},
      hits = [];
    for (let i = 0; i < s.n; i++) {
      const sl = s.S(i);
      if (!used[i] || ![SLOT.vest, SLOT.vestTrim, SLOT.trunks, SLOT.belt].includes(sl) || hidden(i, sl)) continue;
      const p = s.p(i);
      const cx = Math.floor(p[0] / cell),
        cy = Math.floor(p[1] / cell),
        cz = Math.floor(p[2] / cell);
      let best = null,
        bd = 0.03;
      const seen = new Set();
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++)
            for (const k of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
              if (seen.has(k)) continue;
              seen.add(k);
              const [a, b, c] = skinT[k];
              const h = closestOnTri(p, s.p(a), s.p(b), s.p(c));
              const d = len(sub(p, h[0]));
              if (d < bd) ((bd = d), (best = [k, h]));
            }
      if (!best) continue;
      tested++;
      const [k, h] = best;
      const [a, b, c] = skinT[k];
      const nn = norm(add(add(scl(s.nrm(a), h[1]), scl(s.nrm(b), h[2])), scl(s.nrm(c), h[3])));
      const sd = dot(sub(p, h[0]), nn);
      // (singlet inside an arm: the arm is in front of the cloth there — occlusion, not cloth torn by skin; item 14a
      // checks the other way round, no arm inside the cloth)
      const limb = /_(UpperArm|UpperArmTwist|Forearm|ForearmTwist|Hand|Finger)/.test(s.boneName(skinT[k][0]));
      if (sd < -0.002 && limb && (sl === SLOT.vest || sl === SLOT.vestTrim)) {
        occluded++;
        continue;
      }
      if (sd < -0.002) {
        inside++;
        bySlot[sl] = (bySlot[sl] ?? 0) + 1;
        const bn = s.boneName(skinT[k][0]).replace("Bip01_", "");
        if (hits.length < 16) hits.push({ sl, bone: bn, mm: +(sd * 1000).toFixed(1), bindY: +g0.attributes.position.getY(i).toFixed(3), skinTuck: +(g0.attributes._tuck?.getX(skinT[k][0]) ?? -1).toFixed(2), vBone: s.boneName(i).replace("Bip01_", "") });
        byBone[bn] = (byBone[bn] ?? 0) + 1;
        worst = Math.max(worst, -sd);
      }
    }
    // the singlet inside the band: each tucked singlet vertex (in the band's height, bind pose) paired with its nearest
    // band vertex in the bind pose — the build's own pairing — and tested along that band vertex's posed outward
    // normal (a radius round a centroid breaks down once the hips lean or kneel)
    const band = [];
    for (let i = 0; i < s.n; i++) if (used[i] && s.S(i) === SLOT.belt) band.push(i);
    let out = 0,
      bt = 0;
    if (band.length) {
      const bp = g0.attributes.position;
      const B3 = (i) => [bp.getX(i), bp.getY(i), bp.getZ(i)];
      const lo = Math.min(...band.map((i) => bp.getY(i))),
        hi = Math.max(...band.map((i) => bp.getY(i)));
      for (let i = 0; i < s.n; i++) {
        if (!used[i] || (s.S(i) !== SLOT.vest && s.S(i) !== SLOT.vestTrim)) continue;
        const q = B3(i);
        if (q[1] < lo + 0.01 || q[1] > hi - 0.01) continue;
        let best = -1,
          bd = 0.05;
        for (const j of band) {
          const d = len(sub(B3(j), q));
          if (d < bd) ((bd = d), (best = j));
        }
        if (best < 0) continue;
        bt++;
        if (dot(sub(s.p(i), s.p(best)), s.nrm(best)) > 0.001) out++;
      }
    }
    return { tested, inside, share: tested ? +(inside / tested).toFixed(5) : 0, worstMm: +(worst * 1000).toFixed(1), bySlot, byBone, hits, occludedByArm: occluded, bandTested: bt, outsideBand: out };
  }

  /** 14a: outer upper-arm skin covered by singlet cloth within 4 cm, from four cameras */
  function armCover(person) {
    const s = surface(person);
    const vest = s.trisOf((sl) => sl === SLOT.vest || sl === SLOT.vestTrim);
    const used = new Uint8Array(s.n);
    for (const v of s.idx) used[v] = 1;
    const { head, fwd } = headFrame(person);
    const left = [fwd[2], 0, -fwd[0]];
    const centre = [head[0], head[1] - 0.45, head[2]];
    const cams = { front: fwd, "broadcast-lead": left, "broadcast-rear": scl(left, -1), "34": norm(add(fwd, scl(left, 0.84))) };
    const res = {};
    let worst = 0;
    for (const [name, dir] of Object.entries(cams)) {
      const cam = add(centre, scl(dir, 2.6));
      let tested = 0,
        covered = 0;
      for (let i = 0; i < s.n; i++) {
        if (!used[i] || s.S(i) !== SLOT.skin) continue;
        if (!/_(UpperArm|UpperArmTwist|ShoulderTwist)$/.test(s.boneName(i))) continue;
        const p = s.p(i);
        const toCam = norm(sub(cam, p));
        if (dot(s.nrm(i), toCam) < 0.2) continue; // facing the camera
        // outer: away from the trunk's axis
        const radial = norm([p[0] - head[0], 0, p[2] - head[2]]);
        if (dot(s.nrm(i), radial) < 0) continue;
        tested++;
        const d = norm(sub(p, cam));
        const dist = len(sub(p, cam));
        const t = firstHit(s, vest, cam, d, dist);
        if (t < dist && dist - t < 0.04) covered++;
      }
      const f = tested ? covered / tested : 0;
      worst = Math.max(worst, f);
      res[name] = { tested, covered, fraction: +f.toFixed(4) };
    }
    return { cams: res, worst: +worst.toFixed(4) };
  }

  /** 16: the face opening shows the eyes, nose tip and mouth corners from the front camera */
  function faceOpen(person) {
    const s = surface(person);
    const hg = s.trisOf((sl) => sl === SLOT.headgear || sl === SLOT.headgearTrim);
    const { head, fwd } = headFrame(person);
    // the nose tip: the head skin vertex farthest forward
    let nose = null,
      best = -Infinity;
    for (let i = 0; i < s.n; i++)
      if (s.S(i) === SLOT.skin && s.boneName(i) === "Bip01_Head") {
        const f = dot(sub(s.p(i), head), fwd);
        if (f > best) ((best = f), (nose = s.p(i)));
      }
    const pts = { eyeL: W(person, "Bip01_L_Eye"), eyeR: W(person, "Bip01_R_Eye"), nose, mouthL: W(person, "Bip01_L_MouthCorner"), mouthR: W(person, "Bip01_R_MouthCorner") };
    const cam = add(head, scl(fwd, 1.6));
    const vis = {};
    for (const [k, p] of Object.entries(pts)) {
      if (!p) continue;
      const d = norm(sub(p, cam));
      vis[k] = firstHit(s, hg, cam, d, len(sub(p, cam)) - 0.004) === Infinity;
    }
    return { visible: vis, all: Object.values(vis).every(Boolean) };
  }

  function f0(people) {
    const v = people.map((p) => {
      const m = p.meshes.find((x) => x.material?.userData?.u);
      return m?.material.userData.u.uSkinF0?.value ?? null;
    });
    return { values: v, same: v.length > 0 && v.every((x) => x !== null && x === v[0]), value: v[0] };
  }

  /**
   * 6: screen points (CSS px) along a line across the deltoid–arm border on the camera-facing outer upper arm (lead
   * side): from the deltoid cap down past its insertion. The node side samples the screenshot's luminance along them.
   */
  function deltoid(person, S = "L") {
    const s = surface(person);
    const { camera, gl } = window.__fv8.ctx();
    const sh = W(person, `Bip01_${S}_UpperArm`),
      el = W(person, `Bip01_${S}_Forearm`);
    const sp = W(person, "Bip01_Spine2");
    const out = norm([sh[0] - sp[0], 0, sh[2] - sp[2]]);
    const camP = [camera.position.x, camera.position.y, camera.position.z];
    const cand = [];
    for (let i = 0; i < s.n; i++) {
      if (s.S(i) !== SLOT.skin || !/_(UpperArm|UpperArmTwist|ShoulderTwist|Clavicle)$/.test(s.boneName(i))) continue;
      if (dot(s.nrm(i), norm(sub(camP, s.p(i)))) < 0.3) continue;
      cand.push(i);
    }
    const pts = [];
    for (let k = 0; k <= 15; k++) {
      const t = k / 15;
      const target = add(add(sh, scl(sub(el, sh), -0.05 + 0.6 * t)), scl(out, 0.05));
      let best = -1,
        bd = Infinity;
      for (const i of cand) {
        const d = len(sub(s.p(i), target));
        if (d < bd) ((bd = d), (best = i));
      }
      if (best < 0) continue;
      const v = V3(s.p(best)).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      pts.push([Math.round(((v.x + 1) / 2) * r.width), Math.round(((1 - v.y) / 2) * r.height)]);
    }
    return pts;
  }

  /**
   * 7 between the keys: the fighter posed synchronously (BoxerProbe.poseNow) at `n` + 1 instants along each clip, the
   * garment checks at every one — intermediate frames, not only the key poses. → { worst, worstAt, band, bandAt, byClip }
   */
  function sweep(person, clips, n = 12) {
    const B = window.__gkBoxer;
    if (!B?.sampleClip || !B.probe?.poseNow) return null;
    const res = { worst: 0, worstAt: null, band: 0, bandAt: null, samples: 0, byClip: {} };
    for (const clip of clips) {
      const info = B.clips[clip];
      if (!info) continue;
      let w = 0,
        bandOut = 0;
      for (let k = 0; k <= n; k++) {
        const t = (info.duration * k) / n;
        B.probe.poseNow(B.sampleClip(clip, t));
        const gm = garments(person);
        res.samples++;
        if (gm.share > w) w = gm.share;
        if (gm.share > res.worst) ((res.worst = gm.share), (res.worstAt = `${clip}@${t.toFixed(2)}`));
        if (gm.outsideBand > bandOut) bandOut = gm.outsideBand;
        if (gm.outsideBand > res.band) ((res.band = gm.outsideBand), (res.bandAt = `${clip}@${t.toFixed(2)}`));
      }
      res.byClip[clip] = { worst: +w.toFixed(5), band: bandOut };
    }
    return res;
  }

  /* ---------------------------------------------------------------------------------- P3-FGT-19B corrective bake */
  const CORR_BONES = { arm: ["Bip01_{S}_Clavicle", "Bip01_{S}_UpperArm", "Bip01_{S}_Forearm", "Bip01_Spine2"], leg: ["Bip01_{S}_Thigh", "Bip01_{S}_Calf", "Bip01_Pelvis"] };
  /** each limb's joint quaternions now (corrective.ts features) */
  function corrFeats(person) {
    const mesh = person.meshes.find((m) => m.geometry.attributes._mat) ?? person.meshes[0];
    const q = (n) => {
      const b = mesh.skeleton.bones.find((x) => x.name === n);
      return b ? [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w].map((x) => +x.toFixed(5)) : [0, 0, 0, 1];
    };
    const f = {};
    for (const [lim, list] of [["arm", CORR_BONES.arm], ["leg", CORR_BONES.leg]]) for (const S of ["L", "R"]) f[lim + S] = list.flatMap((n) => q(n.replace("{S}", S)));
    return f;
  }
  /** one state: the world push that clears every visible singlet / trunks vertex of the drawn skin by `gap`, smoothed
   *  over the cloth (pushed vertices hold their push, their neighbours take a decaying share), in bind space */
  function bakeState(person, opt = {}) {
    const gap = opt.gap ?? 0.004,
      rounds = opt.rounds ?? 3,
      iters = opt.iters ?? 8,
      decay = opt.decay ?? 0.8;
    const s = surface(person);
    const mesh = s.mesh,
      g0 = mesh.geometry,
      gp0 = g0.attributes.position;
    const used = new Uint8Array(s.n);
    for (const v of s.idx) used[v] = 1;
    const cell = 0.03,
      grid = new Map();
    const skinT = s.trisOf((sl) => sl === SLOT.skin);
    skinT.forEach((t, k) => {
      const ps = t.map((i) => s.p(i));
      const lo = [0, 1, 2].map((ax) => Math.floor(Math.min(ps[0][ax], ps[1][ax], ps[2][ax]) / cell));
      const hi = [0, 1, 2].map((ax) => Math.floor(Math.max(ps[0][ax], ps[1][ax], ps[2][ax]) / cell));
      for (let x = lo[0]; x <= hi[0]; x++)
        for (let y = lo[1]; y <= hi[1]; y++)
          for (let z = lo[2]; z <= hi[2]; z++) {
            const key = `${x},${y},${z}`;
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key).push(k);
          }
    });
    let bandLo = Infinity,
      bandHi = -Infinity;
    for (let i = 0; i < s.n; i++)
      if (used[i] && s.S(i) === SLOT.belt) {
        bandLo = Math.min(bandLo, gp0.getY(i));
        bandHi = Math.max(bandHi, gp0.getY(i));
      }
    const cloth = (sl) => sl === SLOT.vest || sl === SLOT.vestTrim || sl === SLOT.trunks;
    // (the tucked singlet and the trunks' gathered top stay where the band holds them: anchors)
    const anchor = (i, sl) => (sl === SLOT.trunks && gp0.getY(i) > bandLo - 0.012) || ((sl === SLOT.vest || sl === SLOT.vestTrim) && gp0.getY(i) < bandHi + 0.005);
    const nb = new Map();
    const link = (a, b) => {
      if (!nb.has(a)) nb.set(a, new Set());
      nb.get(a).add(b);
    };
    for (let t = 0; t < s.idx.length; t += 3) {
      const tri = [s.idx[t], s.idx[t + 1], s.idx[t + 2]];
      for (let e = 0; e < 3; e++) {
        const a = tri[e],
          b = tri[(e + 1) % 3];
        if (cloth(s.S(a)) && cloth(s.S(b))) (link(a, b), link(b, a));
      }
    }
    const D = new Float64Array(s.n * 3);
    const req = new Map();
    const LIMB = /_(UpperArm|UpperArmTwist|Forearm|ForearmTwist|Hand|Finger)/;
    // (14a: singlet already inside an upper arm's cone — plus 1 cm — is behind the arm; pushing it off the ribs only
    // wrapped it over the arm)
    const caps = mesh.material?.userData?.caps;
    const bw = (name) => {
      const b = mesh.skeleton.bones.find((x) => x.name === name);
      const q = b.getWorldPosition(new (T().Vector3)());
      return [q.x, q.y, q.z];
    };
    const armCones = caps
      ? ["L", "R"].map((S) => [bw(`Bip01_${S}_UpperArm`), bw(`Bip01_${S}_Forearm`)])
      : [];
    const inArm = (p) => {
      for (const [a, b] of armCones) {
        const ab = sub(b, a);
        const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / Math.max(dot(ab, ab), 1e-8)));
        if (t <= 0.12) continue;
        const r = caps.arm[0] + (caps.arm[1] - caps.arm[0]) * t + (opt.armClear ?? 0.01);
        if (len(sub(p, add(a, scl(ab, t)))) < r) return true;
      }
      return false;
    };
    const nearest = (p, torsoOnly = false) => {
      const cx = Math.floor(p[0] / cell),
        cy = Math.floor(p[1] / cell),
        cz = Math.floor(p[2] / cell);
      let best = null,
        bd = 0.03;
      const seen = new Set();
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++)
            for (const k of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
              if (seen.has(k)) continue;
              seen.add(k);
              const [a, b, c] = skinT[k];
              if (torsoOnly && LIMB.test(s.boneName(a))) continue;
              const h = closestOnTri(p, s.p(a), s.p(b), s.p(c));
              const d = len(sub(p, h[0]));
              if (d < bd) ((bd = d), (best = [k, h]));
            }
      if (!best) return null;
      const [k, h] = best;
      const [a, b, c] = skinT[k];
      const nn = norm(add(add(scl(s.nrm(a), h[1]), scl(s.nrm(b), h[2])), scl(s.nrm(c), h[3])));
      return { h: h[0], nn, limb: LIMB.test(s.boneName(a)) };
    };
    const Dp = (i) => [D[i * 3], D[i * 3 + 1], D[i * 3 + 2]];
    const left = [];
    const measure = (apply) => {
      let inside = 0,
        tested = 0;
      for (let i = 0; i < s.n; i++) {
        const sl = s.S(i);
        if (!used[i] || !cloth(sl) || anchor(i, sl)) continue;
        const p = add(s.p(i), Dp(i));
        const r = nearest(p);
        if (!r) continue;
        // (the singlet under an arm that lies on it: the arm is in front, as garments() counts it)
        if (r.limb && sl !== SLOT.trunks) continue;
        tested++;
        const sd = dot(sub(p, r.h), r.nn);
        if (sd < -0.002) {
          inside++;
          if (!apply && opt.debug && left.length < 30) left.push({ i, sl, bind: [gp0.getX(i), gp0.getY(i), gp0.getZ(i)].map((x) => +x.toFixed(3)), mm: +(sd * 1000).toFixed(1), pushMm: +(len(Dp(i)) * 1000).toFixed(1), req: req.has(i) });
        }
        // (pushed out of the torso's skin only: in the armpit crease the arm's skin is the other wall, and pushing off
        // whichever wall is nearer walked the cloth from one into the other)
        const rt = apply ? (sl === SLOT.trunks ? r : inArm(p) ? null : nearest(p, true)) : null;
        const st = rt ? dot(sub(p, rt.h), rt.nn) : 1;
        if (apply && st < gap) {
          const need = gap - st;
          for (let k = 0; k < 3; k++) D[i * 3 + k] += rt.nn[k] * need;
          req.set(i, [rt.nn, dot(Dp(i), rt.nn)]);
        }
      }
      return { inside, tested };
    };
    const before = measure(false);
    for (let round = 0; round < rounds; round++) {
      measure(true);
      for (let it = 0; it < iters; it++) {
        const Dn = Float64Array.from(D);
        for (const [i, set] of nb) {
          if (anchor(i, s.S(i))) {
            Dn[i * 3] = Dn[i * 3 + 1] = Dn[i * 3 + 2] = 0;
            continue;
          }
          let a = Dp(i);
          for (const j of set) a = add(a, Dp(j));
          a = scl(a, 1 / (1 + set.size));
          const rq = req.get(i);
          if (rq) {
            const c = dot(a, rq[0]);
            if (c < rq[1]) a = add(a, scl(rq[0], rq[1] - c));
          } else a = scl(a, decay);
          Dn[i * 3] = a[0];
          Dn[i * 3 + 1] = a[1];
          Dn[i * 3 + 2] = a[2];
        }
        D.set(Dn);
      }
    }
    // (a last direct pass: smoothing between the walls of a crease can carry a vertex back in)
    for (let k = 0; k < (opt.final ?? 2); k++) measure(true);
    left.length = 0;
    const after = measure(false);
    // the turned facing (lining) moves with the singlet vertex it doubles
    if (!window.__fv8twin) {
      const tw = new Int32Array(s.n).fill(-1);
      const vest = [];
      for (let i = 0; i < s.n; i++) if (s.S(i) === SLOT.vest || s.S(i) === SLOT.vestTrim) vest.push(i);
      for (let i = 0; i < s.n; i++) {
        if (s.S(i) !== SLOT.vestLining) continue;
        let best = -1,
          bd = 0.004;
        for (const j of vest) {
          const d = Math.hypot(gp0.getX(i) - gp0.getX(j), gp0.getY(i) - gp0.getY(j), gp0.getZ(i) - gp0.getZ(j));
          if (d < bd) ((bd = d), (best = j));
        }
        tw[i] = best;
      }
      window.__fv8twin = tw;
    }
    const twin = window.__fv8twin;
    for (let i = 0; i < s.n; i++) if (twin[i] >= 0) for (let k = 0; k < 3; k++) D[i * 3 + k] = D[twin[i] * 3 + k];
    // world push → bind space through the vertex's own skinning (and the mesh's world matrix): solve M · d = D
    const V = T().Vector3;
    const f = (i, x, y, z) => {
      const v = new V(x, y, z);
      mesh.applyBoneTransform(i, v);
      return v.applyMatrix4(mesh.matrixWorld);
    };
    const out = [];
    let maxMm = 0;
    for (let i = 0; i < s.n; i++) {
      const d = Dp(i);
      if (len(d) < 2e-4) continue;
      maxMm = Math.max(maxMm, len(d) * 1000);
      const x = gp0.getX(i),
        y = gp0.getY(i),
        z = gp0.getZ(i);
      const c0 = f(i, x, y, z);
      const cx = f(i, x + 0.01, y, z).sub(c0).multiplyScalar(100),
        cy = f(i, x, y + 0.01, z).sub(c0).multiplyScalar(100),
        cz = f(i, x, y, z + 0.01).sub(c0).multiplyScalar(100);
      const m = new (T().Matrix3)().set(cx.x, cy.x, cz.x, cx.y, cy.y, cz.y, cx.z, cy.z, cz.z).invert();
      const b = new V(d[0], d[1], d[2]).applyMatrix3(m);
      out.push([i, +b.x.toFixed(5), +b.y.toFixed(5), +b.z.toFixed(5)]);
    }
    return { before, after, maxMm: +maxMm.toFixed(1), deltas: out, left };
  }
  /** the bake's fixed facts: part offsets in the merged geometry, the left arm's side (+1 / −1 in x, bind), and each
   *  singlet vertex's arm mask (0…255): the corrective is held off the front and back of each arm hole within 3 cm of
   *  its edge (fading out by 6 cm; more than 1–3 cm in depth from the hole's centre) — pushed off the pectoral / deltoid
   *  it stood over the upper arm (14a); the side seam keeps it */
  function corrInfo(person, opt = {}) {
    const mesh = person.meshes.find((m) => m.geometry.attributes._mat) ?? person.meshes[0];
    const g = mesh.geometry;
    const k = mesh.skeleton.bones.findIndex((b) => b.name === "Bip01_L_UpperArm");
    const bind = mesh.skeleton.boneInverses[k].clone().invert();
    const e = bind.elements;
    const pos = g.attributes.position,
      nrm = g.attributes.normal,
      mat = g.attributes._mat;
    const caps = mesh.material?.userData?.caps ?? {};
    const isVest = (i) => {
      const s = Math.round(mat.getX(i));
      return s === SLOT.vest || s === SLOT.vestTrim;
    };
    // the singlet's open edges (an edge of one singlet triangle), the arm holes only (not the neck, not the hem)
    const ec = new Map();
    const idx = g.index.array;
    for (let t = 0; t < idx.length; t += 3) {
      const tri = [idx[t], idx[t + 1], idx[t + 2]];
      if (!tri.every(isVest)) continue;
      for (let q = 0; q < 3; q++) {
        const a = tri[q],
          b = tri[(q + 1) % 3];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        ec.set(key, (ec.get(key) ?? 0) + 1);
      }
    }
    const rim = new Set();
    for (const [key, c] of ec)
      if (c === 1)
        for (const v of key.split(",").map(Number)) {
          const y = pos.getY(v),
            x = Math.abs(pos.getX(v));
          if (y > (caps.shoulderY ?? 1.4) - 0.25 && x > (caps.shoulderX ?? 0.2) * 0.45) rim.add(v);
        }
    const rimP = [...rim].map((v) => [pos.getX(v), pos.getY(v), pos.getZ(v)]);
    // each arm hole's centre in depth (z): the front and the back of the hole are where a push stands the cloth over the
    // arm; the side seam (the hole's depth centre), where the armpit crease needs the corrective, is not masked
    const zc = [1, -1].map((sg) => {
      const zs = rimP.filter((r) => Math.sign(r[0]) === sg).map((r) => r[2]);
      return zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : 0;
    });
    const sm = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const mask = {};
    for (let i = 0; i < pos.count; i++) {
      if (!isVest(i)) continue;
      let d = Infinity;
      for (const r of rimP) d = Math.min(d, Math.hypot(r[0] - pos.getX(i), r[1] - pos.getY(i), r[2] - pos.getZ(i)));
      const off = Math.abs(pos.getZ(i) - zc[pos.getX(i) >= 0 ? 0 : 1]);
      const m = 1 - (opt.armMask ?? 1) * (1 - sm(0.03, 0.06, d)) * sm(0.01, 0.03, off);
      if (m < 0.999) mask[i] = Math.round(m * 255);
    }
    return { parts: g.userData.parts, leftX: Math.sign(e[12]) || 1, bones: CORR_BONES, mask };
  }

  window.__fv8c = { pose, garments, armCover, faceOpen, f0, surface, deltoid, sweep, corrFeats, bakeState, corrInfo };
})();

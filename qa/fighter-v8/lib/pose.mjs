// P3-FGT-19A fighter v8 prototype (dev only): posing on the MakeHuman skeleton (our two-bone IK, spine / neck
// distribution, foot roll, fist) and pose baking (CPU skinning). Shared by the page (browser, import map) and the
// Node cloth simulation (cloth-sim.mjs), so both see exactly the same posed body.
import * as THREE from "three";

export const deg = Math.PI / 180;
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/** quaternion that maps an orthonormal frame (d0, u0) onto (d1, u1) */
function frameQuat(d0, u0, d1, u1) {
  const m0 = new THREE.Matrix4(), m1 = new THREE.Matrix4();
  const a0 = d0.clone().normalize(), b0 = u0.clone().sub(a0.clone().multiplyScalar(u0.dot(a0))).normalize(), c0 = a0.clone().cross(b0);
  const a1 = d1.clone().normalize(), b1 = u1.clone().sub(a1.clone().multiplyScalar(u1.dot(a1))).normalize(), c1 = a1.clone().cross(b1);
  m0.makeBasis(a0, b0, c0);
  m1.makeBasis(a1, b1, c1);
  return new THREE.Quaternion().setFromRotationMatrix(m1.multiply(m0.transpose()));
}
const yawQ = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
const eulerQ = (x, y, z, order = "YXZ") => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, order));

/** pose a loaded fighter glTF and bake every skinned mesh: Map name → BufferGeometry (positions / normals in world) */
export function poseAndBake(gltf, pose, alpha = 1) {
  const root = gltf.scene;
  const ex = gltf.parser.json.scenes?.[0]?.extras ?? gltf.parser.json.extras ?? {};
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => o.isSkinnedMesh && meshes.push(o));
  const skeleton = meshes[0].skeleton;
  const bones = skeleton.bones;
  const byName = new Map(bones.map((b) => [b.name, b]));
  const san = (n) => THREE.PropertyBinding.sanitizeNodeName(n);
  const B = (n) => byName.get(san(n));
  // back to the bind pose before measuring the rest joints (the scene is reused between calls)
  for (const b of bones) {
    if (!b.userData.bindPos) b.userData.bindPos = b.position.clone();
    b.position.copy(b.userData.bindPos);
    b.quaternion.identity();
  }
  root.updateMatrixWorld(true);
  const rest = new Map();
  const extras = gltf.parser.json.extras ?? ex;
  const tails = extras.tails;
  const L = extras.landmarks;
  bones.forEach((b, i) => {
    b.updateMatrixWorld(true);
    const head = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
    rest.set(b.name, { head, tail: tails ? V3(tails[i]) : head.clone() });
  });
  const R = (n) => rest.get(san(n));

  /* ------------------------------------------------------------------------------------------- posing */
  const setWorldQ = (bone, q) => {
    bone.parent.updateMatrixWorld(true);
    const pq = new THREE.Quaternion();
    bone.parent.getWorldQuaternion(pq);
    bone.quaternion.copy(pq.invert().multiply(q));
    bone.updateMatrixWorld(true);
  };
  const worldPos = (n) => {
    B(n).updateMatrixWorld(true);
    return new THREE.Vector3().setFromMatrixPosition(B(n).matrixWorld);
  };
  const worldQ = (n) => B(n).getWorldQuaternion(new THREE.Quaternion());
  const rootBone = B("root");

  /** two-bone IK: chain [upper bones], [lower bones], end bone; target end position, pole direction */
  function twoBone(up, low, end, target, pole, restPole) {
    const S = worldPos(up[0]);
    const a = R(low[0]).head.distanceTo(R(up[0]).head);
    const b = R(end).head.distanceTo(R(low[0]).head);
    const toT = target.clone().sub(S);
    let d = toT.length();
    d = Math.min(Math.max(d, Math.abs(a - b) + 1e-3), (a + b) * 0.9995);
    const dir = toT.normalize();
    const x = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    const perp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const E = S.clone().add(dir.clone().multiplyScalar(x)).add(perp.clone().multiplyScalar(h));
    const W = S.clone().add(dir.clone().multiplyScalar(d));
    const uDir = E.clone().sub(S).normalize();
    const fDir = W.clone().sub(E).normalize();
    const hinge = uDir.clone().cross(perp.clone().negate()).normalize();
    // rest frames
    const u0 = R(low[0]).head.clone().sub(R(up[0]).head).normalize();
    const f0 = R(end).head.clone().sub(R(low[0]).head).normalize();
    const rp = restPole.clone();
    const rperp = rp.clone().sub(u0.clone().multiplyScalar(rp.dot(u0))).normalize();
    const h0 = u0.clone().cross(rperp.clone().negate()).normalize();
    const qU = frameQuat(u0, h0, uDir, hinge);
    const qF = frameQuat(f0, h0, fDir, hinge);
    for (const n of up) setWorldQ(B(n), qU);
    for (const n of low) setWorldQ(B(n), qF);
    return { E, W, qF, fDir };
  }

  /** rest hand frame (wrist → middle knuckle, dorsal) per side, as in kit.mjs */
  function restHand(S) {
    const s = `.${S}`;
    const W = R(`wrist${s}`).head, K = R(`finger3-1${s}`).head, I = R(`finger2-1${s}`).head, Pk = R(`finger5-1${s}`).head, T = R(`finger1-2${s}`).head;
    const fwd = K.clone().sub(W).normalize();
    let lat = I.clone().sub(Pk);
    lat.sub(fwd.clone().multiplyScalar(lat.dot(fwd))).normalize();
    let dors = lat.clone().cross(fwd).normalize();
    if (T.clone().sub(I).dot(dors) > 0) dors.negate();
    lat = fwd.clone().cross(dors).normalize();
    if (T.clone().sub(K).dot(lat) < 0) lat.negate();
    return { fwd, dors, lat };
  }

  function arm(S, target, pole, gloveFwd, gloveDors) {
    const s = `.${S}`;
    const r = twoBone([`upperarm01${s}`, `upperarm02${s}`], [`lowerarm01${s}`, `lowerarm02${s}`], `wrist${s}`, target, pole, new THREE.Vector3(0, -0.2, -1));
    const rh = restHand(S);
    const qW = frameQuat(rh.fwd, rh.dors, gloveFwd, gloveDors);
    // forearm twist bone takes half the roll between the forearm and the hand
    const rel = qW.clone().multiply(r.qF.clone().invert());
    const axis = r.fDir;
    const proj = new THREE.Vector3(rel.x, rel.y, rel.z);
    const p = axis.clone().multiplyScalar(proj.dot(axis));
    const twist = new THREE.Quaternion(p.x, p.y, p.z, rel.w).normalize();
    const half = new THREE.Quaternion().slerp(twist, 0.5);
    setWorldQ(B(`lowerarm02${s}`), half.multiply(r.qF));
    setWorldQ(B(`wrist${s}`), qW);
    // fist: curl the fingers about the rest knuckle axis
    const curl = (n, ang) => {
      const b = B(n);
      if (!b) return;
      const axisL = rh.lat.clone();
      let q = new THREE.Quaternion().setFromAxisAngle(axisL, ang);
      const test = rh.fwd.clone().applyQuaternion(q);
      if (test.dot(rh.dors) > 0) q = new THREE.Quaternion().setFromAxisAngle(axisL, -ang);
      b.quaternion.copy(q);
      b.updateMatrixWorld(true);
    };
    for (let f = 2; f <= 5; f++) {
      curl(`finger${f}-1${s}`, 80 * deg);
      curl(`finger${f}-2${s}`, 95 * deg);
      curl(`finger${f}-3${s}`, 65 * deg);
    }
    curl(`finger1-2${s}`, 25 * deg);
    curl(`finger1-3${s}`, 35 * deg);
    return r;
  }

  /**
   * place a glove: its centre G (the fist inside), the elbow near E, the back of the hand towards dorsHint; the wrist
   * stays straight (the glove continues the forearm), as coaches insist
   */
  function glove(S, G, E, dorsHint) {
    const s = `.${S}`;
    let Sh = worldPos(`upperarm01${s}`);
    let d = G.clone().sub(E).normalize();
    const W = G.clone().sub(d.clone().multiplyScalar(0.085));
    let pole = E.clone().sub(Sh);
    let r = twoBone([`upperarm01${s}`, `upperarm02${s}`], [`lowerarm01${s}`, `lowerarm02${s}`], `wrist${s}`, W, pole, new THREE.Vector3(0, -0.2, -1));
    // the shoulder girdle moves with the arm (scapula / deltoid / armpit), then the arm is solved again from there
    {
      const qU = worldQ(`upperarm01${s}`);
      const qC = worldQ(`clavicle${s}`);
      setWorldQ(B(`shoulder01${s}`), qC.clone().slerp(qU, 0.3));
      Sh = worldPos(`upperarm01${s}`);
      pole = E.clone().sub(Sh);
      r = twoBone([`upperarm01${s}`, `upperarm02${s}`], [`lowerarm01${s}`, `lowerarm02${s}`], `wrist${s}`, W, pole, new THREE.Vector3(0, -0.2, -1));
    }
    d = r.fDir.clone();
    const dh = dorsHint.clone().sub(d.clone().multiplyScalar(dorsHint.dot(d))).normalize();
    return arm(S, r.W, pole, d, dh);
  }

  function leg(S, ball, yaw, heel, kneeOut = 0.15) {
    const s = `.${S}`;
    const ankle0 = R(`foot${s}`).head, ball0 = R(`foot${s}`).tail;
    const f0 = new THREE.Vector3(ball0.x - ankle0.x, 0, ball0.z - ankle0.z).normalize();
    const footFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(yawQ(yaw));
    const lat = new THREE.Vector3(0, 1, 0).cross(footFwd).normalize();
    // the foot rotates about the ball by the heel lift
    const qFoot = new THREE.Quaternion().setFromAxisAngle(lat, -heel).multiply(frameQuat(f0, new THREE.Vector3(0, 1, 0), footFwd, new THREE.Vector3(0, 1, 0)));
    const off = ankle0.clone().sub(ball0).applyQuaternion(frameQuat(f0, new THREE.Vector3(0, 1, 0), footFwd, new THREE.Vector3(0, 1, 0)));
    off.applyAxisAngle(lat, -heel);
    const ballW = new THREE.Vector3(ball[0], ball0.y, ball[2]);
    const ankleT = ballW.clone().add(off);
    const pole = footFwd.clone().add(lat.clone().multiplyScalar(S === "L" ? -kneeOut : kneeOut)).add(new THREE.Vector3(0, 0.1, 0));
    twoBone([`upperleg01${s}`, `upperleg02${s}`], [`lowerleg01${s}`, `lowerleg02${s}`], `foot${s}`, ankleT, pole, new THREE.Vector3(0, 0, 1));
    setWorldQ(B(`foot${s}`), qFoot);
    // toes stay flat on the floor
    const qToe = frameQuat(f0, new THREE.Vector3(0, 1, 0), footFwd, new THREE.Vector3(0, 1, 0));
    for (const b of bones) if (b.name.startsWith("toe") && b.name.endsWith(san(s)) && b.name.includes("-1")) setWorldQ(b, qToe);
  }

  /** spine / neck / head distribution and clavicles */
  function trunk({ drop = 0, shift = [0, 0], hipYaw = 0, hipTilt = 0, chestYaw = 0, lean = 0, side = 0, headYaw = 0, headPitch = 0, headRoll = 0, clavL = [0, 0], clavR = [0, 0] }) {
    rootBone.position.copy(rootBone.userData.rest ?? (rootBone.userData.rest = rootBone.position.clone()));
    rootBone.position.y -= drop;
    rootBone.position.x += shift[0];
    rootBone.position.z += shift[1];
    rootBone.quaternion.copy(eulerQ(hipTilt, hipYaw, 0));
    rootBone.updateMatrixWorld(true);
    const spines = ["spine05", "spine04", "spine03", "spine02", "spine01"];
    const fr = [0.1, 0.2, 0.25, 0.25, 0.2];
    spines.forEach((n, i) => {
      B(n).quaternion.copy(eulerQ(lean * fr[i], chestYaw * fr[i], side * fr[i]));
      B(n).updateMatrixWorld(true);
    });
    // head: world orientation wanted (yaw / pitch relative to the world), spread over the neck
    const want = eulerQ(headPitch, headYaw, headRoll);
    const base = worldQ("spine01");
    const rel = base.clone().invert().multiply(want);
    const parts = [["neck01", 0.3], ["neck02", 0.3], ["neck03", 0.2]];
    for (const [n, f] of parts) {
      B(n).quaternion.copy(new THREE.Quaternion().slerp(rel, f));
      B(n).updateMatrixWorld(true);
    }
    setWorldQ(B("head"), want);
    for (const [S, c] of [["L", clavL], ["R", clavR]]) {
      const sg = S === "L" ? 1 : -1;
      B(`clavicle.${S}`).quaternion.copy(eulerQ(0, -sg * c[1], sg * c[0]));
      B(`clavicle.${S}`).updateMatrixWorld(true);
    }
  }

  const H = extras.stature ?? 1.76;
  const k = H / 1.76;
  const headPos = () => worldPos("head");
  const chin = () => {
    const h = headPos();
    return new THREE.Vector3(h.x, L.chinY - (R("head").head.y - h.y), h.z + 0.08);
  };

  /** pose library (orthodox: left foot / left hand lead; the opponent is towards +z) */
  const POSES = {
    stand() {
      trunk({ drop: 0.005, headPitch: 0.04, clavL: [-0.04, 0], clavR: [-0.04, 0] });
      leg("L", [0.12 * k, 0, 0.09], 0.12, 0, 0.05);
      leg("R", [-0.12 * k, 0, 0.09], -0.12, 0, 0.05);
      for (const S of ["L", "R"]) {
        const sg = S === "L" ? 1 : -1;
        const sh = worldPos(`upperarm01.${S}`);
        const t = sh.clone().add(new THREE.Vector3(sg * 0.07, -0.5 * k, 0.1));
        arm(S, t, new THREE.Vector3(sg * 0.3, 0, -1), new THREE.Vector3(sg * 0.15, -0.5, 1).normalize(), new THREE.Vector3(sg, 0.2, 0).normalize());
      }
    },
    guard() {
      // shoulders slightly raised and rolled forward (clavicles up and forward), chin tucked behind the lead shoulder
      trunk({ drop: 0.055 * k, shift: [0.01, 0], hipYaw: -36 * deg, hipTilt: 0.06, chestYaw: -6 * deg, lean: 0.17, side: 0.03, headYaw: -10 * deg, headPitch: 0.2, clavL: [0.2, 0.22], clavR: [0.12, 0.18] });
      leg("L", [0.11 * k, 0, 0.24 * k], -18 * deg, 4 * deg, 0.12);
      leg("R", [-0.12 * k, 0, -0.24 * k], -58 * deg, 26 * deg, 0.18);
      const h = headPos();
      const shL = worldPos("upperarm01.L"), shR = worldPos("upperarm01.R");
      // rear glove at the cheekbone / jaw, beside and a little in front of the face (eyes stay clear over it);
      // lead glove a fist in front, between eye and chin height. Elbows down and in, near the ribs: the forearms
      // rise at ~55–70° and angle slightly in, wrists straight, knuckles forward, thumbs up and in.
      glove("R", new THREE.Vector3(h.x - 0.095 * k, h.y - 0.09 * k, h.z + 0.11 * k), new THREE.Vector3(shR.x + 0.08 * k, shR.y - 0.27 * k, shR.z + 0.02 * k), new THREE.Vector3(-1, 0.25, 0.35));
      glove("L", new THREE.Vector3(h.x + 0.075 * k, h.y - 0.065 * k, h.z + 0.29 * k), new THREE.Vector3(shL.x - 0.05 * k, shL.y - 0.26 * k, shL.z + 0.1 * k), new THREE.Vector3(1, 0.3, 0.15));
    },
    jab() {
      trunk({ drop: 0.05 * k, shift: [0.02, 0.04], hipYaw: -46 * deg, hipTilt: 0.07, chestYaw: -16 * deg, lean: 0.2, side: 0.08, headYaw: -10 * deg, headPitch: 0.28, headRoll: -0.05, clavL: [0.3, 0.2], clavR: [0.08, 0.05] });
      leg("L", [0.11 * k, 0, 0.26 * k], -18 * deg, 2 * deg, 0.12);
      leg("R", [-0.12 * k, 0, -0.24 * k], -58 * deg, 34 * deg, 0.15);
      const h = headPos();
      const shL = worldPos("upperarm01.L"), shR = worldPos("upperarm01.R");
      glove("R", new THREE.Vector3(h.x - 0.095 * k, h.y - 0.09 * k, h.z + 0.11 * k), new THREE.Vector3(shR.x + 0.08 * k, shR.y - 0.27 * k, shR.z + 0.02 * k), new THREE.Vector3(-1, 0.25, 0.35));
      // full extension, knuckles flat, palm down: elbow on the line shoulder → fist
      const G = new THREE.Vector3(shL.x - 0.06 * k, shL.y + 0.02 * k, shL.z + 0.66 * k);
      glove("L", G, shL.clone().lerp(G, 0.5).add(new THREE.Vector3(0.02, -0.02, 0)), new THREE.Vector3(0, 1, 0));
    },
    hook() {
      trunk({ drop: 0.06 * k, shift: [0.0, 0.01], hipYaw: -8 * deg, hipTilt: 0.06, chestYaw: 22 * deg, lean: 0.17, side: -0.08, headYaw: 6 * deg, headPitch: 0.26, headRoll: 0.05, clavL: [0.22, 0.25], clavR: [0.08, 0.02] });
      leg("L", [0.11 * k, 0, 0.24 * k], 15 * deg, 22 * deg, 0.12);
      leg("R", [-0.12 * k, 0, -0.24 * k], -48 * deg, 10 * deg, 0.15);
      const h = headPos();
      const shL = worldPos("upperarm01.L"), shR = worldPos("upperarm01.R");
      glove("R", new THREE.Vector3(h.x - 0.095 * k, h.y - 0.09 * k, h.z + 0.11 * k), new THREE.Vector3(shR.x + 0.08 * k, shR.y - 0.27 * k, shR.z + 0.02 * k), new THREE.Vector3(-1, 0.25, 0.35));
      // 90° at the elbow, elbow up at shoulder height, forearm level across the body, palm down
      const E = new THREE.Vector3(shL.x + 0.04 * k, shL.y - 0.03 * k, shL.z + 0.24 * k);
      glove("L", new THREE.Vector3(E.x - 0.27 * k, E.y + 0.005, E.z + 0.04 * k), E, new THREE.Vector3(0, 1, 0.1));
    },
  };
  // reset to the bind pose first (the glTF scene is reused between calls)
  for (const b of bones) {
    if (!b.userData.bindPos) b.userData.bindPos = b.position.clone();
    b.position.copy(b.userData.bindPos);
    b.quaternion.identity();
  }
  if (rootBone.userData.rest) rootBone.userData.rest.copy(rootBone.userData.bindPos);
  root.updateMatrixWorld(true);
  if (pose !== "rest") (POSES[pose] ?? POSES.guard)();
  // a partial pose (the cloth is carried into the pose in stages): every joint part-way from the bind pose
  if (alpha < 1) {
    const I = new THREE.Quaternion();
    for (const b of bones) {
      b.quaternion.copy(I.clone().slerp(b.quaternion.clone(), alpha));
      b.position.lerpVectors(b.userData.bindPos, b.position.clone(), alpha);
    }
  }
  root.updateMatrixWorld(true);

  /* --------------------------------------------------------------------------------- bake the pose */
  const boneMats = bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, skeleton.boneInverses[i]));
  const baked = new Map();
  for (const m of meshes) {
    const g = m.geometry;
    const pos = g.attributes.position, nor = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const n = pos.count;
    const op = new Float32Array(n * 3), on = new Float32Array(n * 3);
    const v = new THREE.Vector3(), nn = new THREE.Vector3(), acc = new THREE.Vector3(), accN = new THREE.Vector3(), t = new THREE.Vector3();
    const nm = new THREE.Matrix3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i);
      nn.fromBufferAttribute(nor, i);
      acc.set(0, 0, 0);
      accN.set(0, 0, 0);
      for (let c = 0; c < 4; c++) {
        const w = sw.getComponent(i, c);
        if (!w) continue;
        const M = boneMats[si.getComponent(i, c)];
        acc.add(t.copy(v).applyMatrix4(M).multiplyScalar(w));
        nm.setFromMatrix4(M);
        accN.add(t.copy(nn).applyMatrix3(nm).multiplyScalar(w));
      }
      accN.normalize();
      op.set([acc.x, acc.y, acc.z], i * 3);
      on.set([accN.x, accN.y, accN.z], i * 3);
    }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute("position", new THREE.BufferAttribute(op, 3));
    ng.setAttribute("normal", new THREE.BufferAttribute(on, 3));
    if (g.attributes.uv) ng.setAttribute("uv", g.attributes.uv.clone());
    if (g.attributes._cover) ng.setAttribute("_cover", g.attributes._cover.clone());
    if (m.name === "body") {
      // upper-arm weight per vertex (the arm-visibility test of the page)
      const isUA = bones.map((b) => /^upperarm0[12]/.test(b.name));
      const ua = new Float32Array(n);
      for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) if (isUA[si.getComponent(i, c)]) ua[i] += sw.getComponent(i, c);
      ng.setAttribute("_upperArm", new THREE.BufferAttribute(ua, 1));
    }
    ng.setIndex(g.index.clone());
    baked.set(m.name, ng);
  }
  return { baked, root, bones, B, R, worldPos, extras, L, H, skeleton };
}

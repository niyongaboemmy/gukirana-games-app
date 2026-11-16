// QA-HUM-01: in-page measurement library for the human realism assessment (injected with page.evaluate(source)).
// Works on any three.js scene in the app: the human lab (window.__gkHuman), the world (window.__gkProbe.root / .gl in
// development builds), the boxing lab (window.__gkBoxer.scene). No imports: three.js classes are taken from live objects.
//
// window.__humanAssess = {
//   people(root)                → [{ id, root, meshes, bones }]           people = skinned meshes grouped by skeleton
//   measure(person)             → static checks: proportions, fingers, garments, penetration, materials, textures
//   isolate(root, person, gl, camera) → { calls, tris } of the person alone (one render, then restored)
//   sample(person, seconds)     → Promise<motion report>: foot sliding per step, cadence, blinks, saccades, idle
//                                 micro-motion, arm angle (T-pose), worst bone snap
//   project(point, camera, w, h) → [x, y] in CSS px
// }
(() => {
  const RX = {
    head: /(^|[_.:])head$/i,
    neck: /neck0?1?$/i,
    pelvis: /pelvis$|(^|[_.:])hips$/i,
    upperArm: /upper_?arm0?1?([._]?[LR])?$|upperarm/i,
    forearm: /fore_?arm$|lower_?arm0?1?([._]?[LR])?$/i,
    hand: /(^|[_.:])(hand|wrist)([._]?[LR])?$/i,
    thigh: /thigh$|upper_?leg0?1?([._]?[LR])?$|upleg$/i,
    calf: /calf$|shin$|lower_?leg0?1?([._]?[LR])?$|(^|[_.:])leg$/i,
    foot: /(^|[_.:])foot([._]?[LR])?$/i,
    toe: /toe0?([._]?[LR])?$|toebase$/i,
    eye: /(^|[_.:])(L_|R_|L|R|left|right)?eye([._]?[LR])?$/i,
    lid: /blink|lid/i,
    finger: /finger|thumb|index|middle|ring|pinky/i,
  };
  const side = (n) =>
    /(^|[_.:\s])(L|Left)([_.:\s]|$)|[._]L$|^Left|Bip01_L|_L_|LEye|LeftHand/i.test(n)
      ? "L"
      : /(^|[_.:\s])(R|Right)([_.:\s]|$)|[._]R$|^Right|Bip01_R|_R_|REye|RightHand/i.test(n)
        ? "R"
        : "";
  // non-anatomical meshes / materials (excluded from stature: hair can be 10 cm above the crown)
  const NOT_BODY = /hair|headwear|hat|cap|lash|brow|card|beard|glasses|wrap|helmet|headgear/i;
  const GARMENT =
    /shirt|top|tee|vest|polo|trouser|pant|short|trunk|shoe|boot|dress|skirt|jacket|hoodie|garment|cloth|sock|glove|coat|belt|sole/i;
  // the boxer pipeline's per-vertex material slots (world/human/boxer/boxer-material.ts SLOT): 0 skin, 19 hair, 20 eye,
  // 21 lash, 22 teeth; everything else is a garment or kit
  const SLOT_SKIN = 0;
  const SLOT_NON_GARMENT = new Set([0, 19, 20, 21, 22]);

  const shown = (o) => {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  const mats = (m) => (Array.isArray(m.material) ? m.material : [m.material]);
  const Vec = (proto) => new proto.constructor();

  function people(root) {
    const groups = new Map();
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isSkinnedMesh || !shown(o) || !o.skeleton?.bones?.length) return;
      // key: the top bone of the skeleton (meshes of one person share bones)
      let top = o.skeleton.bones[0];
      while (top.parent && top.parent.isBone) top = top.parent;
      const k = top.uuid;
      if (!groups.has(k)) {
        let pr = top;
        for (let p = o; p; p = p.parent)
          if (p.userData?.gkPerson) {
            pr = p;
            break;
          }
        groups.set(k, {
          id: groups.size,
          root: pr === top ? (top.parent ?? top) : pr,
          top,
          meshes: [],
          bones: [],
        });
      }
      groups.get(k).meshes.push(o);
    });
    for (const g of groups.values()) {
      const seen = new Set();
      for (const m of g.meshes)
        for (const b of m.skeleton.bones) if (!seen.has(b)) (seen.add(b), g.bones.push(b));
    }
    return [...groups.values()];
  }

  const findBone = (person, re, s) =>
    person.bones.find(
      (b) =>
        re.test(b.name) &&
        (!s || side(b.name) === s) &&
        !RX.finger.test(b.name) &&
        !/twist|helper|roll/i.test(b.name),
    );
  const wp = (o) => o.getWorldPosition(Vec(o.position));

  /** skinned world-space positions of a mesh (optionally only vertices used by triangles) */
  function skinnedPositions(m, usedOnly = true) {
    const g = m.geometry,
      n = g.attributes.position.count,
      out = new Float32Array(n * 3);
    const used = new Uint8Array(n);
    if (usedOnly && g.index) for (let i = 0; i < g.index.count; i++) used[g.index.getX(i)] = 1;
    else used.fill(1);
    const v = Vec(m.position);
    m.updateMatrixWorld(true);
    m.skeleton.update();
    for (let i = 0; i < n; i++) {
      if (!used[i]) continue;
      m.getVertexPosition(i, v);
      v.applyMatrix4(m.matrixWorld);
      out[i * 3] = v.x;
      out[i * 3 + 1] = v.y;
      out[i * 3 + 2] = v.z;
    }
    return { pos: out, used };
  }
  /** skinned world-space normal of vertex i (finite difference through the bone transform) */
  function skinnedNormal(m, i, base, out) {
    const g = m.geometry,
      nrm = g.attributes.normal;
    if (!nrm) return out.set(0, 0, 0);
    const p = Vec(m.position).fromBufferAttribute(g.attributes.position, i);
    p.x += nrm.getX(i) * 0.01;
    p.y += nrm.getY(i) * 0.01;
    p.z += nrm.getZ(i) * 0.01;
    m.applyBoneTransform(i, p);
    p.applyMatrix4(m.matrixWorld);
    return out.set(p.x - base[0], p.y - base[1], p.z - base[2]).normalize();
  }
  const slotOf = (m) => m.geometry.attributes._mat ?? null;
  const headWeight = (m, i, headSet) => {
    const si = m.geometry.attributes.skinIndex,
      sw = m.geometry.attributes.skinWeight;
    if (!si || !sw) return 0;
    let w = 0;
    for (let k = 0; k < 4; k++) {
      const b = m.skeleton.bones[si.getComponent(i, k)];
      if (b && headSet.has(b)) w += sw.getComponent(i, k);
    }
    return w;
  };

  function measure(person) {
    const r = { meshes: [], bones: person.bones.length, warnings: [] };
    const B = (k, s) => findBone(person, RX[k], s);
    const head = B("head");
    const headSet = new Set();
    if (head) head.traverse((o) => o.isBone && headSet.add(o));
    // ---------------- meshes, materials, textures
    const texs = new Map();
    const matInfo = [];
    for (const m of person.meshes) {
      const g = m.geometry;
      const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      r.meshes.push({
        name: m.name,
        tris,
        verts: g.attributes.position.count,
        materials: mats(m).map((x) => x.name || x.type),
        morphs: Object.keys(m.morphTargetDictionary ?? {}).length,
        slots: !!slotOf(m),
      });
      for (const mt of mats(m)) {
        const info = {
          mesh: m.name,
          name: mt.name,
          type: mt.type,
          roughness: mt.roughness,
          metalness: mt.metalness,
          map: !!mt.map,
          normalMap: !!mt.normalMap,
          bumpMap: !!mt.bumpMap,
          roughnessMap: !!mt.roughnessMap,
          clearcoat: mt.clearcoat ?? 0,
          sheen: mt.sheen ?? 0,
          transmission: mt.transmission ?? 0,
          alphaTest: mt.alphaTest,
          alphaHash: !!mt.alphaHash,
          alphaToCoverage: !!mt.alphaToCoverage,
          transparent: mt.transparent,
          customShader: !!(mt.onBeforeCompile && String(mt.onBeforeCompile).length > 40),
        };
        matInfo.push(info);
        for (const v of Object.values(mt)) if (v && v.isTexture && v.image) texs.set(v.uuid, v);
        // shader uniforms (ShaderMaterial, onBeforeCompile hooks keep theirs in userData)
        const pools = [
          mt.uniforms,
          mt.userData?.gkUniforms,
          mt.userData?.shader?.uniforms,
          ...Object.values(mt.userData ?? {}),
        ];
        for (const pool of pools)
          if (pool && typeof pool === "object")
            for (const u of Object.values(pool))
              if (u?.value?.isTexture && u.value.image) texs.set(u.value.uuid, u.value);
      }
    }
    r.materials = matInfo;
    let texBytes = 0;
    r.textures = [...texs.values()].map((t) => {
      const w = t.image.width ?? t.image.videoWidth ?? 0,
        h = t.image.height ?? t.image.videoHeight ?? 0;
      const bytes = Math.round(w * h * 4 * (t.generateMipmaps === false ? 1 : 1.33));
      texBytes += bytes;
      return { name: t.name, w, h, mb: +(bytes / 1048576).toFixed(2) };
    });
    r.textureMB = +(texBytes / 1048576).toFixed(1);
    r.tris = r.meshes.reduce((a, m) => a + m.tris, 0);
    // ---------------- stature and head height from the skinned surface
    let minY = Infinity,
      maxY = -Infinity,
      headMaxY = -Infinity,
      chinY = Infinity;
    const skinPts = [];
    const garmentPts = [];
    for (const m of person.meshes) {
      const names =
        m.name +
        " " +
        mats(m)
          .map((x) => x.name)
          .join(" ");
      if (NOT_BODY.test(names) && !/body/i.test(m.name)) continue;
      const { pos, used } = skinnedPositions(m);
      const slot = slotOf(m);
      const isGarmentMesh = !slot && GARMENT.test(names) && !/body|head|skin/i.test(names);
      for (let i = 0; i < used.length; i++) {
        if (!used[i]) continue;
        const s = slot ? slot.getX(i) : isGarmentMesh ? 99 : SLOT_SKIN;
        if (s === 19 || s === 21) continue; // hair / lashes
        const y = pos[i * 3 + 1];
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (s === SLOT_SKIN && headSet.size && headWeight(m, i, headSet) > 0.98) {
          if (y > headMaxY) headMaxY = y;
          if (y < chinY) chinY = y;
        }
        if (s === SLOT_SKIN) skinPts.push([m, i, pos[i * 3], y, pos[i * 3 + 2]]);
        else if (!SLOT_NON_GARMENT.has(s)) garmentPts.push([m, i, pos[i * 3], y, pos[i * 3 + 2]]);
      }
    }
    const H = maxY - minY;
    const prop = { stature: +H.toFixed(3) };
    if (isFinite(chinY) && headMaxY > chinY) {
      prop.headHeight = +(headMaxY - chinY).toFixed(3);
      prop.headRatio = +(H / (headMaxY - chinY)).toFixed(2);
    }
    const seg = (a, b) => (a && b ? +(wp(a).distanceTo(wp(b)) / H).toFixed(3) : null);
    for (const s of ["L", "R"]) {
      prop[`upperArm${s}`] = seg(B("upperArm", s), B("forearm", s));
      prop[`forearm${s}`] = seg(B("forearm", s), B("hand", s));
      prop[`thigh${s}`] = seg(B("thigh", s), B("calf", s));
      prop[`shank${s}`] = seg(B("calf", s), B("foot", s));
    }
    const uaL = B("upperArm", "L"),
      uaR = B("upperArm", "R");
    prop.shoulderJoints = seg(uaL, uaR);
    const thL = B("thigh", "L"),
      thR = B("thigh", "R");
    prop.hipJoints = seg(thL, thR);
    r.proportions = prop;
    // ---------------- hands: fingers = leaf bones under the hand, segments = finger bones on the way
    r.hands = {};
    for (const s of ["L", "R"]) {
      const hand = B("hand", s);
      if (!hand) {
        r.hands[s] = { fingers: 0, segments: [] };
        continue;
      }
      const leaves = [];
      const walk = (b, depth, fingerBones) => {
        const kids = b.children.filter((c) => c.isBone && !/twist|helper|nub|end$|_end/i.test(c.name));
        const fb = fingerBones + (RX.finger.test(b.name) ? 1 : 0);
        if (!kids.length && b !== hand) leaves.push(fb);
        for (const c of kids) walk(c, depth + 1, fb);
      };
      walk(hand, 0, 0);
      r.hands[s] = { fingers: leaves.length, segments: leaves };
    }
    // ---------------- garments: separate geometry? body poking through?
    const garmentMeshes = person.meshes.filter(
      (m) =>
        !slotOf(m) &&
        GARMENT.test(
          m.name +
            " " +
            mats(m)
              .map((x) => x.name)
              .join(" "),
        ) &&
        !/body|head|skin/i.test(m.name),
    );
    r.garments = {
      separateGeometry: garmentPts.length > 0,
      garmentMeshes: garmentMeshes.map((m) => m.name),
      perVertexSlots: person.meshes.some((m) => !!slotOf(m)),
      garmentVerts: garmentPts.length,
      skinVerts: skinPts.length,
    };
    if (garmentPts.length && skinPts.length) {
      // spatial hash of the skin
      const cell = 0.03,
        grid = new Map();
      const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
      skinPts.forEach((p, k) => {
        const kk = key(p[2], p[3], p[4]);
        if (!grid.has(kk)) grid.set(kk, []);
        grid.get(kk).push(k);
      });
      const nrm = Vec(person.meshes[0].position);
      let inside = 0,
        tested = 0,
        worst = 0;
      const hits = [];
      for (const g of garmentPts) {
        let best = -1,
          bd = 0.04 * 0.04;
        const cx = Math.floor(g[2] / cell),
          cy = Math.floor(g[3] / cell),
          cz = Math.floor(g[4] / cell);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dz = -1; dz <= 1; dz++) {
              const l = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
              if (!l) continue;
              for (const k of l) {
                const p = skinPts[k];
                const d = (p[2] - g[2]) ** 2 + (p[3] - g[3]) ** 2 + (p[4] - g[4]) ** 2;
                if (d < bd) ((bd = d), (best = k));
              }
            }
        if (best < 0) continue;
        tested++;
        const p = skinPts[best];
        skinnedNormal(p[0], p[1], [p[2], p[3], p[4]], nrm);
        const sd = (g[2] - p[2]) * nrm.x + (g[3] - p[3]) * nrm.y + (g[4] - p[4]) * nrm.z;
        if (sd < -0.002) {
          inside++;
          if (-sd > worst) worst = -sd;
          if (hits.length < 12)
            hits.push([+g[2].toFixed(2), +g[3].toFixed(2), +g[4].toFixed(2), +(sd * 1000).toFixed(1)]);
        }
      }
      r.garments.penetration = {
        tested,
        inside,
        fraction: tested ? +(inside / tested).toFixed(4) : 0,
        worstMm: +(worst * 1000).toFixed(1),
        samples: hits,
      };
    }
    // ---------------- face rig / expression channels
    r.face = {
      eyes: person.bones.filter((b) => RX.eye.test(b.name) && !RX.lid.test(b.name)).length,
      lidBones: person.bones.filter((b) => RX.lid.test(b.name)).length,
      faceBones: [...headSet].length - 1,
      morphs: person.meshes.reduce((a, m) => a + Object.keys(m.morphTargetDictionary ?? {}).length, 0),
    };
    return r;
  }

  /** draw calls / triangles of this person alone (the rest of the scene hidden for one render) */
  function isolate(root, person, gl, camera) {
    const keep = new Set();
    for (let p = person.root; p; p = p.parent) keep.add(p);
    const hidden = [];
    const hide = (o) => {
      for (const c of o.children) {
        if (c === person.root || c.isLight) continue;
        if (keep.has(c)) hide(c);
        else if (c.visible) (hidden.push(c), (c.visible = false));
      }
    };
    if (person.root !== root) hide(root);
    const auto = gl.info.autoReset;
    gl.info.autoReset = false;
    gl.info.reset();
    gl.render(root, camera);
    const res = { calls: gl.info.render.calls, tris: gl.info.render.triangles };
    gl.info.reset();
    gl.info.autoReset = auto;
    for (const o of hidden) o.visible = true;
    return res;
  }

  function project(pt, camera, w, h) {
    const v = Vec(camera.position).set(pt[0], pt[1], pt[2]).project(camera);
    return [Math.round(((v.x + 1) / 2) * w), Math.round(((1 - v.y) / 2) * h), v.z];
  }

  /** screen-space bounds of a person (skinned surface sampled) */
  function screenBox(person, camera, w, h) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const m of person.meshes) {
      const { pos, used } = skinnedPositions(m);
      for (let i = 0; i < used.length; i += 7) {
        if (!used[i]) continue;
        const [x, y] = project([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], camera, w, h);
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  const angle = (qa, qb) =>
    2 * Math.acos(Math.min(1, Math.abs(qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w)));

  /** sample the animated person for `seconds` (rAF): feet, lids, eyes, idle motion, bone snaps */
  function sample(person, seconds = 6) {
    const B = (k, s) => findBone(person, RX[k], s);
    const feet = { L: B("foot", "L"), R: B("foot", "R") };
    const toes = { L: B("toe", "L"), R: B("toe", "R") };
    const head = B("head"),
      pelvis = B("pelvis");
    const ua = { L: B("upperArm", "L"), R: B("upperArm", "R") },
      fa = { L: B("forearm", "L"), R: B("forearm", "R") };
    const eyes = person.bones.filter((b) => RX.eye.test(b.name) && !RX.lid.test(b.name));
    const lids = person.bones.filter((b) => RX.lid.test(b.name) && /top|upper/i.test(b.name));
    const major = person.bones.filter(
      (b) =>
        !RX.finger.test(b.name) &&
        !headSet(b) &&
        /pelvis|spine|neck|head|clavicle|arm|hand|thigh|calf|foot/i.test(b.name) &&
        !/twist|helper/i.test(b.name),
    );
    function headSet(b) {
      for (let p = b.parent; p; p = p.parent) if (p === head) return true;
      return false;
    }
    const lidMorphs = [];
    for (const m of person.meshes)
      for (const [n, k] of Object.entries(m.morphTargetDictionary ?? {}))
        if (/blink|eye_?clos|lid/i.test(n)) lidMorphs.push([m, k]);
    const T = [],
      F = { L: [], R: [] },
      TO = { L: [], R: [] },
      LID = [],
      EYE = [],
      HEADREL = [],
      ROOT = [],
      ARM = [];
    const prevQ = new Map();
    const lid0 = [];
    let worstSnap = { deg: 0, bone: "" };
    const v = Vec(person.top.position);
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = () => {
        const t = (performance.now() - t0) / 1000;
        person.top.updateWorldMatrix(true, true);
        T.push(t);
        for (const s of ["L", "R"]) {
          if (feet[s]) F[s].push(wp(feet[s]).toArray());
          if (toes[s]) TO[s].push(wp(toes[s]).toArray());
        }
        // lids: offset of the upper-lid bones from their first sample (bone rigs), or the blink morphs
        if (!lid0.length) for (const b of lids) lid0.push([b.position.clone(), b.quaternion.clone()]);
        LID.push(
          lids.reduce(
            (a, b, k) => a + b.position.distanceTo(lid0[k][0]) * 10 + angle(b.quaternion, lid0[k][1]),
            0,
          ) + lidMorphs.reduce((a, [m, k]) => a + (m.morphTargetInfluences?.[k] ?? 0), 0),
        );
        EYE.push(eyes.map((e) => e.quaternion.clone()));
        if (head && pelvis) HEADREL.push(wp(head).sub(wp(pelvis)).toArray());
        ROOT.push(wp(person.top).toArray());
        // upper arm angle from straight down (T-pose check)
        ARM.push(
          ["L", "R"].map((s) =>
            ua[s] && fa[s]
              ? Math.acos(Math.max(-1, Math.min(1, -wp(fa[s]).sub(wp(ua[s])).normalize().y))) * 57.3
              : null,
          ),
        );
        const dtf = T.length > 1 ? T[T.length - 1] - T[T.length - 2] : 1 / 60;
        for (const b of major) {
          const pq = prevQ.get(b);
          if (pq && dtf > 0) {
            const deg = (angle(pq, b.quaternion) * 57.3) / Math.max(dtf * 60, 1); // per 60 Hz frame
            if (deg > worstSnap.deg) worstSnap = { deg: +deg.toFixed(1), bone: b.name, t: +t.toFixed(2) };
          }
          prevQ.set(b, b.quaternion.clone());
        }
        if (t < seconds) requestAnimationFrame(step);
        else resolve(analyse());
      };
      requestAnimationFrame(step);
    });

    function analyse() {
      const dur = T[T.length - 1] - T[0];
      const fps = (T.length - 1) / dur;
      const out = { seconds: +dur.toFixed(2), fps: +fps.toFixed(1), worstSnap };
      // root travel
      const r0 = ROOT[0],
        r1 = ROOT[ROOT.length - 1];
      out.rootSpeed = +(Math.hypot(r1[0] - r0[0], r1[2] - r0[2]) / dur).toFixed(2);
      // ---- feet: the ball of the foot (toe bone) is planted while it is within 1.5 cm of its lowest point for at least
      // 0.1 s (flat foot + toe-off: the foot rolls about it, it must not move); slide = its horizontal travel then.
      // Without toe bones the ankle is used (over-reports: the heel rocker moves the ankle legitimately).
      const steps = [];
      for (const s of ["L", "R"]) {
        const f = TO[s].length ? TO[s] : F[s];
        if (!f.length) continue;
        const minY = Math.min(...f.map((p) => p[1]));
        let start = -1;
        for (let i = 0; i <= f.length; i++) {
          const down = i < f.length && f[i][1] < minY + 0.015;
          if (down && start < 0) start = i;
          if (!down && start >= 0) {
            if (T[i - 1] - T[start] >= 0.1 && start > 0 && i < f.length) {
              let path = 0;
              for (let k = start + 1; k < i; k++)
                path += Math.hypot(f[k][0] - f[k - 1][0], f[k][2] - f[k - 1][2]);
              const net = Math.hypot(f[i - 1][0] - f[start][0], f[i - 1][2] - f[start][2]);
              steps.push({
                foot: s,
                t: +T[start].toFixed(2),
                dur: +(T[i - 1] - T[start]).toFixed(2),
                slideCm: +(path * 100).toFixed(1),
                netCm: +(net * 100).toFixed(1),
                joint: TO[s].length ? "toe" : "ankle",
              });
            }
            start = -1;
          }
        }
      }
      steps.sort((a, b) => a.t - b.t);
      out.steps = steps;
      if (steps.length) {
        const sl = steps.map((x) => x.netCm);
        out.footSlide = {
          steps: steps.length,
          meanCm: +(sl.reduce((a, b) => a + b, 0) / sl.length).toFixed(1),
          maxCm: Math.max(...sl),
          meanPathCm: +(steps.reduce((a, b) => a + b.slideCm, 0) / steps.length).toFixed(1),
        };
        out.cadence = +((steps.length / dur) * 60).toFixed(0);
      }
      // ---- blinks: lid signal far from its median for < 0.45 s
      const lid = LID.slice();
      const sorted = lid.slice().sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)],
        range = Math.max(...lid.map((x) => Math.abs(x - med)));
      let blinks = 0;
      if (range > 1e-4) {
        let on = -1;
        for (let i = 0; i < lid.length; i++) {
          const hi = Math.abs(lid[i] - med) > range * 0.5;
          if (hi && on < 0) on = i;
          if (!hi && on >= 0) {
            if (T[i] - T[on] < 0.45) blinks++;
            on = -1;
          }
        }
      }
      out.blinks = {
        count: blinks,
        perMin: +((blinks / dur) * 60).toFixed(1),
        channels: lids.length + lidMorphs.length,
      };
      // ---- saccades: eye rotation speed above 120 °/s
      let sacc = 0,
        maxEye = 0;
      if (EYE.length && EYE[0].length) {
        let inSac = false;
        for (let i = 1; i < EYE.length; i++) {
          const d = (angle(EYE[i][0], EYE[i - 1][0]) * 57.3) / Math.max(T[i] - T[i - 1], 1e-3);
          const a0 = angle(EYE[i][0], EYE[0][0]) * 57.3;
          if (a0 > maxEye) maxEye = a0;
          if (d > 120 && !inSac) (sacc++, (inSac = true));
          if (d < 60) inSac = false;
        }
      }
      out.saccades = { count: sacc, perMin: +((sacc / dur) * 60).toFixed(1), maxEyeDeg: +maxEye.toFixed(1) };
      // ---- idle micro-motion: head relative to pelvis
      if (HEADREL.length > 2) {
        const mean = [0, 1, 2].map((k) => HEADREL.reduce((a, p) => a + p[k], 0) / HEADREL.length);
        const sd = Math.sqrt(
          HEADREL.reduce(
            (a, p) => a + (p[0] - mean[0]) ** 2 + (p[1] - mean[1]) ** 2 + (p[2] - mean[2]) ** 2,
            0,
          ) / HEADREL.length,
        );
        out.headSwayMm = +(sd * 1000).toFixed(1);
      }
      const arms = ARM.filter((a) => a[0] !== null);
      if (arms.length)
        out.armFromDownDeg = +(arms.reduce((a, x) => a + (x[0] + x[1]) / 2, 0) / arms.length).toFixed(1);
      return out;
    }
  }

  window.__humanAssess = { people, measure, isolate, project, screenBox, sample, RX };
})();

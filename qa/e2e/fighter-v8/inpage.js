// P3-FGT-19B fighter-v8 harness, in-page probes. Injected AFTER qa/e2e/human-assess/inpage.js (window.__humanAssess:
// people / measure / isolate) and metrics.mjs (window.__fv8m: the pure maths). Works on the boxing lab
// (window.__gkProbe.scene / camera / gl) and the fight lab (window.__gkRingLab.scene / camera / gl).
//
// window.__fv8 = {
//   ctx()                       → { scene, camera, gl, three } of the page (the labs' dev probes expose them)
//   people()                    → the ring people (skinned boxer bodies), largest first
//   joints(person)              → jointChecks of the posed skeleton
//   cavity(people)              → cavityStats of an id render from the page camera (inside of the body / garments)
//   textures(person)            → { mb, list } GPU texture memory (compressed textures counted by their mips)
//   perFighter(person)          → { calls, tris } of the person alone
//   fps(ms)                     → Promise<frames per second over ms>
//   feet(person, seconds)       → Promise<footSlide of the toes>
// }
(() => {
  const M = window.__fv8m;
  const H = window.__humanAssess;
  const ctx = () => {
    const p = window.__gkProbe?.scene ? window.__gkProbe : window.__gkRingLab;
    return { scene: p?.scene, camera: p?.camera, gl: p?.gl, three: p?.three };
  };
  const boxerish = (person) => person.meshes.some((m) => m.name === "boxer-body" || m.geometry?.attributes?._mat);
  function people() {
    const { scene } = ctx();
    if (!scene) return [];
    return H.people(scene)
      .filter(boxerish)
      .sort((a, b) => b.meshes[0].geometry.attributes.position.count - a.meshes[0].geometry.attributes.position.count);
  }
  const V = (o) => {
    const v = o.getWorldPosition(new o.position.constructor());
    return [v.x, v.y, v.z];
  };
  const bone = (person, name) => person.bones.find((b) => b.name === name) ?? null;
  const fwdOf = (b) => {
    if (!b) return undefined;
    const q = b.getWorldQuaternion(new b.quaternion.constructor());
    const v = new b.position.constructor(0, 0, 1).applyQuaternion(q);
    return [v.x, v.y, v.z];
  };
  function jointPoints(person) {
    const j = {};
    const put = (k, n) => {
      const b = bone(person, n);
      if (b) j[k] = V(b);
    };
    for (const s of ["L", "R"]) {
      put(`${s}.shoulder`, `Bip01_${s}_UpperArm`);
      put(`${s}.elbow`, `Bip01_${s}_Forearm`);
      put(`${s}.wrist`, `Bip01_${s}_Hand`);
      put(`${s}.knuckle`, `Bip01_${s}_Finger2`);
      put(`${s}.hip`, `Bip01_${s}_Thigh`);
      put(`${s}.knee`, `Bip01_${s}_Calf`);
      put(`${s}.ankle`, `Bip01_${s}_Foot`);
      put(`${s}.toe`, `Bip01_${s}_Toe0`);
    }
    put("chest", "Bip01_Spine2");
    put("neck", "Bip01_Neck");
    put("head", "Bip01_Head");
    j.pelvisFwd = fwdOf(bone(person, "Bip01_Pelvis"));
    j.chestFwd = fwdOf(bone(person, "Bip01_Spine2"));
    return j;
  }
  const joints = (person, limits) => M.jointChecks(jointPoints(person), limits);

  /** an id render of the people only: B = person, R = back face, G = skin slot (0) */
  function cavity(list, opts = {}) {
    const { scene, camera, gl } = ctx();
    if (!scene || !camera || !gl || !list.length) return null;
    const T = ctx().three;
    const keep = new Set(list.flatMap((p) => p.meshes));
    const mat = new T.MeshBasicMaterial();
    mat.side = 2; // DoubleSide
    mat.onBeforeCompile = (s) => {
      s.vertexShader = "attribute float _mat;\nvarying float vGkMat;\n" + s.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvGkMat = _mat;");
      s.fragmentShader =
        "varying float vGkMat;\n" +
        s.fragmentShader.replace(
          /}\s*$/,
          "  bool face = vGkMat > 18.5 && vGkMat < 22.5;\n  gl_FragColor = vec4((gl_FrontFacing || face) ? 0.0 : 1.0, vGkMat < 0.5 ? 1.0 : 0.0, 1.0, ((vGkMat > 0.5 && vGkMat < 2.5) || (vGkMat > 24.5 && vGkMat < 25.5)) ? 1.0 : 0.6);\n}",
        );
    };
    mat.customProgramCacheKey = () => "fv8-cavity";
    // (P3-FGT-19B: a v8 fighter is measured with its own vertex stage — the cloth push, the pose correctives and the skin
    // anchors move the garments on the GPU, and a plain material drew the raw skinning the game never shows; the turned
    // facing's back faces are culled as the game culls them: front-side only, they never draw)
    const FRAG =
      "flat varying float vMat;\n" +
      "void main() {\n  if (!gl_FrontFacing && vMat > 24.5 && vMat < 25.5) discard;\n  bool face = vMat > 18.5 && vMat < 22.5;\n  gl_FragColor = vec4((gl_FrontFacing || face) ? 0.0 : 1.0, vMat < 0.5 ? 1.0 : 0.0, 1.0, ((vMat > 0.5 && vMat < 2.5) || (vMat > 24.5 && vMat < 25.5)) ? 1.0 : 0.6);\n}";
    const own = (o) => {
      const src = o.material;
      if (!src?.userData?.u || !src.onBeforeCompile) return mat;
      const m = new T.MeshBasicMaterial();
      m.side = 2;
      m.onBeforeCompile = (s) => {
        src.onBeforeCompile(s);
        s.fragmentShader = FRAG;
      };
      m.customProgramCacheKey = () => "fv8-cavity-own";
      return m;
    };
    const hidden = [];
    const swapped = [];
    scene.traverse((o) => {
      if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
        if (keep.has(o)) {
          swapped.push([o, o.material]);
          o.material = own(o);
        } else if (o.visible) {
          hidden.push(o);
          o.visible = false;
        }
      }
    });
    const w = gl.domElement.width,
      h = gl.domElement.height;
    let rt = window.__fv8RT;
    if (!rt || rt.width !== w || rt.height !== h) {
      rt?.dispose();
      rt = window.__fv8RT = new T.WebGLRenderTarget(w, h, { depthBuffer: true });
    }
    const prevTarget = gl.getRenderTarget();
    const prevBg = scene.background;
    const prevFog = scene.fog;
    const prevTone = gl.toneMapping;
    scene.background = null;
    scene.fog = null;
    gl.toneMapping = 0;
    gl.setRenderTarget(rt);
    gl.setClearColor(0x000000, 0);
    gl.clear(true, true, true);
    gl.render(scene, camera);
    const px = new Uint8Array(w * h * 4);
    gl.readRenderTargetPixels(rt, 0, 0, w, h, px);
    gl.setRenderTarget(prevTarget);
    gl.toneMapping = prevTone;
    scene.background = prevBg;
    scene.fog = prevFog;
    for (const o of hidden) o.visible = true;
    for (const [o, m] of swapped) {
      if (o.material !== mat) o.material.dispose();
      o.material = m;
    }
    mat.dispose();
    // (skinSamples: front-facing skin pixels, every n-th, in screenshot coordinates — the T1 chroma check)
    let skin = null;
    if (opts.skinSamples) {
      skin = [];
      const st = opts.skinSamples;
      for (let y = 0; y < h; y += st) for (let x = 0; x < w; x += st) {
        const o = (y * w + x) * 4;
        if (px[o + 2] >= 128 && px[o] < 128 && px[o + 1] >= 128) skin.push([x, h - 1 - y]);
      }
    }
    // (png: the render as an image — singlet inner face yellow, singlet red, other garment back faces magenta, skin grey;
    // a debugging aid for item 8)
    let png = null;
    if (opts.png) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g2 = c.getContext("2d");
      const im = g2.createImageData(w, h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4,
            o = ((h - 1 - y) * w + x) * 4;
          let col = [22, 24, 28];
          if (px[i + 2] >= 128) {
            const vest = px[i + 3] > 200,
              back = px[i] >= 128,
              sk = px[i + 1] >= 128;
            col = vest ? (back ? [255, 230, 0] : [150, 20, 30]) : back ? [255, 0, 255] : sk ? [120, 120, 120] : [60, 60, 70];
          }
          im.data.set([...col, 255], o);
        }
      g2.putImageData(im, 0, 0);
      png = c.toDataURL("image/png");
    }
    return { ...M.cavityStats(px), w, h, ...(skin ? { skin } : {}), ...(png ? { png } : {}) };
  }

  function textures(person) {
    const texs = new Map();
    for (const m of person.meshes) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mt of mats) {
        for (const v of Object.values(mt)) if (v && v.isTexture) texs.set(v.uuid, v);
        for (const pool of [mt.uniforms, mt.userData?.u, mt.userData?.shader?.uniforms])
          if (pool && typeof pool === "object") for (const u of Object.values(pool)) if (u?.value?.isTexture) texs.set(u.value.uuid, u.value);
      }
    }
    let bytes = 0;
    const list = [...texs.values()].map((t) => {
      let b = 0,
        w = 0,
        h = 0,
        kind = "image";
      if (t.isCompressedTexture && t.mipmaps?.length) {
        kind = "compressed";
        w = t.mipmaps[0].width;
        h = t.mipmaps[0].height;
        for (const mm of t.mipmaps) b += mm.data?.byteLength ?? 0;
      } else if (t.image) {
        w = t.image.width ?? 0;
        h = t.image.height ?? 0;
        b = Math.round(w * h * 4 * (t.generateMipmaps === false ? 1 : 4 / 3));
      }
      bytes += b;
      return { name: t.name || t.source?.data?.src?.split("/").pop() || t.uuid.slice(0, 8), kind, w, h, mb: +(b / 1048576).toFixed(2) };
    });
    return { mb: +(bytes / 1048576).toFixed(2), list };
  }

  function perFighter(person) {
    const { scene, camera, gl } = ctx();
    if (!scene || !camera || !gl) return null;
    return H.isolate(scene, person, gl, camera);
  }

  const fps = (ms = 3000) =>
    new Promise((res) => {
      let n = 0;
      const t0 = performance.now();
      const tick = () => {
        n++;
        const t = performance.now() - t0;
        if (t >= ms) res(Math.round((n * 1000) / t));
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

  const feet = (person, seconds = 6, opts) =>
    new Promise((res) => {
      const L = bone(person, "Bip01_L_Toe0") ?? bone(person, "Bip01_L_Foot");
      const R = bone(person, "Bip01_R_Toe0") ?? bone(person, "Bip01_R_Foot");
      const frames = [];
      const t0 = performance.now();
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        frames.push({ t, L: L ? V(L) : undefined, R: R ? V(R) : undefined });
        if (t >= seconds) res({ ...M.footSlide(frames, opts), frames: frames.length });
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

  window.__fv8 = { ctx, people, joints, jointPoints, cavity, textures, perFighter, fps, feet };
})();

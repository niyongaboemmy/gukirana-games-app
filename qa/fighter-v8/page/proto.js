// P3-FGT-19A fighter v8 design prototype page (DEV ONLY). Loads a prototype GLB from qa/fighter-v8/out, poses it with
// our own IK on the MakeHuman skeleton, bakes the pose, keeps the cloth out of the skin, dresses it with physical
// materials and path traces it (three-gpu-pathtracer). Driven by query parameters; shoot.mjs reads window.__fighter.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshBVH } from "three-mesh-bvh";
import { GradientEquirectTexture, PhysicalCamera, WebGLPathTracer } from "three-gpu-pathtracer";
import { deg, poseAndBake } from "../lib/pose.mjs";

const Q = new URLSearchParams(location.search);
const num = (k, d) => (Q.has(k) ? Number(Q.get(k)) : d);
const str = (k, d) => Q.get(k) ?? d;
const P = {
  fighter: str("f", "mW"),
  tone: num("tone", 0),
  corner: str("corner", "red"),
  pose: str("pose", "guard"),
  light: str("light", "studio"),
  spp: num("spp", 200),
  w: num("w", 900),
  h: num("h", 1200),
  az: num("az", 0),
  el: num("el", 4),
  dist: num("dist", 7),
  fov: num("fov", 16),
  tx: num("tx", 0),
  ty: num("ty", -1),
  tz: num("tz", 0),
  target: str("target", ""),
  headgear: num("hg", 1),
  gloves: num("gl", 1),
  wraps: num("wr", 0),
  sweat: num("sweat", 0.35),
  expr: str("expr", "focus"),
  yaw: num("yaw", 0),
  ring: num("ring", 0),
  bounces: num("b", 6),
  exposure: num("exp", 1),
  bg: str("bg", "#16130f"),
  floor: num("floor", 1),
  debug: num("debug", 0),
};
window.__fighter = { ready: false, samples: 0, error: null, info: {} };

async function main() {
  const gltf = await new GLTFLoader().loadAsync(`/out/${P.fighter}.glb`);
  const { baked, worldPos, extras, L, H } = poseAndBake(gltf, P.pose);
  // simulated garments (cloth-sim.mjs) replace the sculpted vest / trunks when present
  if (num("sim", 1)) {
    const res = await fetch(`/out/cloth/${P.fighter}-${P.pose}.json`).catch(() => null);
    if (res && res.ok) {
      const cj = await res.json();
      const dec = (b64, T) => {
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return new T(u8.buffer);
      };
      for (const n of ["vest_jersey", "vest_binding", "trunks_satin", "trunks_band"]) baked.delete(n);
      for (const m of cj.meshes) {
        const pos = dec(m.position, Float32Array), nor = dec(m.normal, Float32Array), uv = dec(m.uv, Float32Array), cls = dec(m.cls, Uint8Array), idx = dec(m.index, Uint32Array);
        const split = (want) => {
          const keep = [];
          for (let i = 0; i < idx.length; i += 3) {
            const c = cls[idx[i]] + cls[idx[i + 1]] + cls[idx[i + 2]] >= 2 ? 1 : 0;
            if (c === want) keep.push(idx[i], idx[i + 1], idx[i + 2]);
          }
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
          g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
          g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
          g.setIndex(keep);
          return g;
        };
        if (m.name === "vest") {
          baked.set("vest_jersey", split(0));
          baked.set("vest_binding", split(1));
        } else if (m.name === "trunks") {
          const g = split(0);
          // trunks uv: pattern x across the leg panel → 0..1 (side stripe at the middle), y in metres
          const a = g.attributes.uv;
          for (let i = 0; i < a.count; i++) a.setX(i, a.getX(i) / m.panels.Wlc);
          baked.set("trunks_satin", g);
          window.__fighter.info.simTrunks = true;
        } else if (m.name === "band") baked.set("trunks_band", split(0));
      }
      window.__fighter.info.sim = true;
      window.__simTrunks = true;
    }
  }
  const names = [...baked.keys()];
  window.__fighter.info.meshes = names;

  // body: cull triangles under gloves / boots
  const body = baked.get("body");
  {
    const cover = body.attributes._cover;
    const idx = body.index.array;
    const keep = [];
    // with simulated garments only the gloves / boots hide skin (the sculpted cover bits do not match the sim)
    const mask = (P.gloves ? 1 : 0) | 2 | (num("sim", 1) ? 0 : 4 | 8);
    for (let i = 0; i < idx.length; i += 3) {
      const c = cover ? cover.getX(idx[i]) & cover.getX(idx[i + 1]) & cover.getX(idx[i + 2]) : 0;
      if (c & mask) continue;
      keep.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    body.setIndex(keep);
  }
  // keep cloth out of the posed skin (closest point on the body; push to a minimum gap along the body normal)
  const bodyBVH = new MeshBVH(body);
  const pushOut = (g, gap) => {
    const pos = g.attributes.position;
    const tgt = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
    const p = new THREE.Vector3(), nrm = new THREE.Vector3(), tri = new THREE.Triangle();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const bi = body.index.array, bp = body.attributes.position;
    let moved = 0;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      if (!bodyBVH.closestPointToPoint(p, tgt, 0, 0.05)) continue;
      const f = tgt.faceIndex;
      a.fromBufferAttribute(bp, bi[f * 3]);
      b.fromBufferAttribute(bp, bi[f * 3 + 1]);
      c.fromBufferAttribute(bp, bi[f * 3 + 2]);
      tri.set(a, b, c);
      tri.getNormal(nrm);
      const sd = p.clone().sub(tgt.point).dot(nrm);
      if (sd < gap) {
        p.copy(tgt.point).add(nrm.multiplyScalar(gap));
        pos.setXYZ(i, p.x, p.y, p.z);
        moved++;
      }
    }
    pos.needsUpdate = true;
    return moved / pos.count;
  };
  const measureInside = (g) => {
    const pos = g.attributes.position;
    const tgt = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
    const p = new THREE.Vector3(), nrm = new THREE.Vector3(), tri = new THREE.Triangle();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const bi = body.index.array, bp = body.attributes.position;
    let n = 0;
    for (let i = 0; i < pos.count; i += 2) {
      p.fromBufferAttribute(pos, i);
      if (!bodyBVH.closestPointToPoint(p, tgt, 0, 0.05)) continue;
      const f = tgt.faceIndex;
      a.fromBufferAttribute(bp, bi[f * 3]);
      b.fromBufferAttribute(bp, bi[f * 3 + 1]);
      c.fromBufferAttribute(bp, bi[f * 3 + 2]);
      tri.set(a, b, c);
      tri.getNormal(nrm);
      if (p.clone().sub(tgt.point).dot(nrm) < -0.001) n++;
    }
    return n / Math.ceil(pos.count / 2);
  };
  const inside = {};
  for (const [n, gap] of [["vest_jersey", 0.0006], ["vest_binding", 0.0006], ["trunks_satin", 0.0006], ["trunks_band", 0.0004]]) {
    // measured (not applied by default): the body under the garments' cores is culled instead
    if (baked.has(n)) inside[n] = num("push", 0) ? pushOut(baked.get(n), gap) : measureInside(baked.get(n));
  }
  window.__fighter.info.pushedFraction = inside;
  for (const g of baked.values()) if (g.attributes.uv && g.index) g.computeTangents();

  /* --------------------------------------------------------------------------------- materials */
  const tex = new THREE.TextureLoader();
  const load = (url, srgb = false, rep = null) =>
    new Promise((res) =>
      tex.load(url, (t) => {
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.flipY = false;
        if (rep) {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.repeat.set(rep[0], rep[1]);
        }
        t.anisotropy = 8;
        res(t);
      }),
    );
  const sex = extras.sex ?? "m";
  const toneIds = ["t1-deep", "t2-dark", "t3-brown", "t4-light"];
  const [albedo, normal, rough, sweat, eyeTex] = await Promise.all([
    load(`/out/skin-${sex}/albedo-${toneIds[P.tone]}.jpg`, true),
    load(`/out/skin-${sex}/normal.png`),
    load(`/out/skin-${sex}/roughness.png`),
    load(`/out/skin-${sex}/sweat.png`),
    load(`/out/eye.png`, true),
  ]);
  const red = P.corner === "red";
  const KIT = red ? new THREE.Color("#c8102e") : new THREE.Color("#0033a0"); // Pantone 186-ish / 286 (IBA 49.3.6)
  const KIT_SAT = red ? new THREE.Color("#b80f2a") : new THREE.Color("#002f94");
  const CHOC = new THREE.Color("#5b3a24");
  const fabric = makeFabricTextures();
  const sheenTone = [new THREE.Color("#6d5a50"), new THREE.Color("#80624f"), new THREE.Color("#9a7258"), new THREE.Color("#b08865")][P.tone];
  const M = {
    skin: new THREE.MeshPhysicalMaterial({ map: albedo, normalMap: normal, normalScale: new THREE.Vector2(1, 1), roughnessMap: rough, roughness: 1.05 - P.sweat * 0.2, metalness: 0, ior: 1.4, specularIntensity: 0.85, sheen: num("skinSheen", 0), sheenRoughness: 0.7, sheenColor: sheenTone, clearcoat: P.sweat * 0.5, clearcoatMap: sweat, clearcoatRoughness: 0.28 }),
    eye: new THREE.MeshPhysicalMaterial({ map: eyeTex, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03 }),
    jersey: new THREE.MeshPhysicalMaterial({ color: KIT, roughness: 0.82, normalMap: fabric.knit, normalScale: new THREE.Vector2(0.3, 0.3), sheen: 0.12, sheenRoughness: 0.7, sheenColor: KIT.clone().lerp(new THREE.Color("#ffffff"), 0.35), side: THREE.DoubleSide }),
    binding: new THREE.MeshPhysicalMaterial({ color: CHOC, roughness: 0.7, sheen: 0.4, sheenColor: new THREE.Color("#9a7458"), side: THREE.DoubleSide }),
    satin: new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: fabric.trunks(red), roughness: 0.52, normalMap: fabric.satin, normalScale: new THREE.Vector2(0.25, 0.25), sheen: 0.45, sheenRoughness: 0.5, sheenColor: KIT_SAT.clone().lerp(new THREE.Color("#ffffff"), 0.4), clearcoat: 0.0, side: THREE.DoubleSide }),
    band: new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: fabric.band(red), roughness: 0.8, normalMap: fabric.rib, normalScale: new THREE.Vector2(1.1, 1.1), side: THREE.DoubleSide }),
    leather: new THREE.MeshPhysicalMaterial({ color: KIT_SAT, roughness: 0.5, normalMap: fabric.leather, normalScale: new THREE.Vector2(0.45, 0.45), clearcoat: 0.25, clearcoatRoughness: 0.4 }),
    target: new THREE.MeshPhysicalMaterial({ color: new THREE.Color("#efece6"), roughness: 0.45, normalMap: fabric.leather, normalScale: new THREE.Vector2(0.3, 0.3), clearcoat: 0.4, clearcoatRoughness: 0.3 }),
    tape: new THREE.MeshPhysicalMaterial({ color: new THREE.Color("#f1efe9"), roughness: 0.85, normalMap: fabric.rib, normalScale: new THREE.Vector2(0.4, 0.4) }),
    hgShell: new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: fabric.headgear(red), roughness: 0.62, normalMap: fabric.leather, normalScale: new THREE.Vector2(0.9, 0.9), clearcoat: 0.15, clearcoatRoughness: 0.45 }),
    webbing: new THREE.MeshPhysicalMaterial({ color: new THREE.Color("#1b1918"), roughness: 0.85, normalMap: fabric.rib, normalScale: new THREE.Vector2(0.7, 0.7) }),
    bootUpper: new THREE.MeshPhysicalMaterial({ color: new THREE.Color("#141312"), roughness: 0.55, normalMap: fabric.leather, normalScale: new THREE.Vector2(0.5, 0.5), clearcoat: 0.25, clearcoatRoughness: 0.4 }),
    sole: new THREE.MeshPhysicalMaterial({ color: new THREE.Color("#e9e5dc"), roughness: 0.75 }),
    lace: new THREE.MeshPhysicalMaterial({ color: new THREE.Color("#ece9e2"), roughness: 0.8 }),
    hair: new THREE.MeshPhysicalMaterial({ color: new THREE.Color("#0d0907"), roughness: 0.45, side: THREE.DoubleSide }),
    wrap: new THREE.MeshPhysicalMaterial({ color: new THREE.Color("#f2f0ea"), map: fabric.wrap, roughness: 0.85, normalMap: fabric.rib, normalScale: new THREE.Vector2(0.5, 0.5) }),
  };
  for (const m of Object.values(M)) {
    if (num("nm", 1) === 0) m.normalMap = null;
    if (num("cc", 1) === 0) m.clearcoat = 0;
    if (num("sh", 1) === 0) m.sheen = 0;
    if (num("mp", 1) === 0) m.map = null;
  }
  const matOf = (n) => {
    if (n === "body") return M.skin;
    if (n === "eyes") return M.eye;
    if (n === "facehair") return M.hair;
    if (n === "vest_jersey") return M.jersey;
    if (n === "vest_binding") return M.binding;
    if (n === "trunks_satin") return M.satin;
    if (n === "trunks_band") return M.band;
    if (/glove._leather/.test(n)) return M.leather;
    if (/glove._target/.test(n)) return M.target;
    if (/glove._tape/.test(n)) return M.tape;
    if (n === "headgear_shell") return M.hgShell;
    if (/headgear_(chinstrap|velcro)/.test(n)) return M.webbing;
    if (/boot._upper/.test(n)) return M.bootUpper;
    if (/boot._sole/.test(n)) return M.sole;
    if (/boot._lace/.test(n)) return M.lace;
    if (/wraps/.test(n)) return M.wrap;
    return M.skin;
  };
  const scene = new THREE.Scene();
  const fig = new THREE.Group();
  fig.rotation.y = P.yaw * deg;
  // lift by the boot sole
  fig.position.y = 0.006;
  for (const [n, g] of baked) {
    if (/^glove/.test(n) && !P.gloves) continue;
    if (/^headgear/.test(n) && !P.headgear) continue;
    if (/^wraps/.test(n) && !P.wraps) continue;
    if (Q.has("only") && !new RegExp(Q.get("only")).test(n)) continue;
    const mesh = new THREE.Mesh(g, matOf(n));
    mesh.name = n;
    fig.add(mesh);
  }
  scene.add(fig);
  fig.updateMatrixWorld(true);

  /* --------------------------------------------------------------------------------- set */
  const floorMat = P.light === "arena" ? new THREE.MeshPhysicalMaterial({ color: new THREE.Color("#b9b3a8"), roughness: 0.95, normalMap: fabric.canvas, normalScale: new THREE.Vector2(0.6, 0.6) }) : new THREE.MeshPhysicalMaterial({ color: new THREE.Color("#2a2622"), roughness: 0.92 });
  if (P.floor) {
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorMat);
    fl.rotation.x = -Math.PI / 2;
    if (fabric.canvas) fabric.canvas.repeat.set(40, 40);
    scene.add(fl);
  }
  const env = new GradientEquirectTexture();
  env.topColor.set(P.light === "arena" ? "#0b0a0a" : "#2b2824");
  env.bottomColor.set("#050505");
  env.update();
  scene.environment = env;
  scene.background = new THREE.Color(P.bg);
  scene.environmentIntensity = P.light === "arena" ? 0.25 : 0.55;
  const LK = num("lk", 4);
  const area = (w, h, intensity, color, pos, look) => {
    const l = new THREE.RectAreaLight(color, intensity * LK, w, h);
    l.position.set(...pos);
    l.lookAt(...look);
    scene.add(l);
    return l;
  };
  if (P.light === "arena") {
    // broadcast ring: one hard-ish overhead key a little towards camera, four truss fixtures at ~55°, dark room
    area(1.4, 1.4, 22, "#fff4e6", [0, 6.2, 0.9], [0, 0, 0]);
    for (const [x, z] of [[4.5, 4.5], [-4.5, 4.5], [4.5, -4.5], [-4.5, -4.5]]) area(1.2, 0.8, 7, "#fff2e2", [x, 6.0, z], [0, 1.1, 0]);
    if (P.ring) addRing(scene, [Math.sin(P.az * deg), Math.cos(P.az * deg)]);
  } else {
    // studio: large soft key (front-left, 40° up), soft fill (right), two rims behind
    area(1.6, 2.2, 9, "#fff3e6", [2.4, 3.0, 3.2], [0, 1.1, 0]);
    area(2.4, 2.4, 1.6, "#f2efe8", [-3.5, 1.8, 2.5], [0, 1.0, 0]);
    area(0.6, 2.4, 10, "#fff0e0", [-2.4, 2.4, -2.6], [0, 1.2, 0]);
    area(0.6, 2.4, 8, "#fff0e0", [2.6, 2.4, -2.4], [0, 1.2, 0]);
  }

  /* --------------------------------------------------------------------------------- camera */
  const target = new THREE.Vector3(P.tx, P.ty >= 0 ? P.ty : H * 0.52, P.tz);
  if (P.target) {
    const [bn, ox = 0, oy = 0, oz = 0] = P.target.split(",");
    const bp = worldPos(bn).applyMatrix4(fig.matrixWorld);
    target.copy(bp).add(new THREE.Vector3(+ox, +oy, +oz));
  }
  const camera = new PhysicalCamera(P.fov, P.w / P.h, 0.05, 100);
  const az = P.az * deg, el = P.el * deg;
  camera.position.set(target.x + Math.sin(az) * Math.cos(el) * P.dist, target.y + Math.sin(el) * P.dist, target.z + Math.cos(az) * Math.cos(el) * P.dist);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  {
    // screen positions of the joints (the sheet annotations are placed with them)
    const proj = {};
    const names = ["head", "neck01", "clavicle.L", "upperarm01.L", "upperarm01.R", "lowerarm01.L", "lowerarm01.R", "wrist.L", "wrist.R", "spine02", "spine04", "root", "upperleg01.L", "upperleg01.R", "lowerleg01.L", "lowerleg01.R", "foot.L", "foot.R", "eye.L"];
    for (const n of names) {
      const v = worldPos(n).applyMatrix4(fig.matrixWorld).project(camera);
      proj[n] = [+((v.x * 0.5 + 0.5) * P.w).toFixed(1), +((1 - (v.y * 0.5 + 0.5)) * P.h).toFixed(1)];
    }
    const pt = (x, y, z) => {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(fig.matrixWorld).project(camera);
      return [+((v.x * 0.5 + 0.5) * P.w).toFixed(1), +((1 - (v.y * 0.5 + 0.5)) * P.h).toFixed(1)];
    };
    proj.top = pt(0, H + 0.006, 0);
    proj.floor = pt(0, 0, 0);
    proj.band = pt(0, L.bandTop, 0.11);
    proj.chin = pt(0, L.chinY, L.chinZ);
    window.__fighter.info.proj = proj;
  }
  camera.bokehSize = 0;
  camera.fStop = 64;
  camera.focusDistance = P.dist;

  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(P.w, P.h);
  renderer.toneMapping = Q.get("tm") === "agx" ? THREE.AgXToneMapping : Q.get("tm") === "aces" ? THREE.ACESFilmicToneMapping : THREE.NeutralToneMapping;
  renderer.toneMappingExposure = P.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  // automated check: the outer upper arm must be visible skin, never cloth (singlets have no sleeves).
  // Rays from the camera to every camera-facing upper-arm vertex; covered = the first hit is a singlet mesh.
  if (num("armtest", 0)) {
    const { acceleratedRaycast, computeBoundsTree } = await import("three-mesh-bvh");
    THREE.Mesh.prototype.raycast = acceleratedRaycast;
    const targets = [];
    fig.traverse((o) => {
      if (o.isMesh && /^(body|vest_|trunks_|glove)/.test(o.name)) {
        o.geometry.computeBoundsTree = computeBoundsTree;
        o.geometry.computeBoundsTree();
        targets.push(o);
      }
    });
    const bodyMesh = targets.find((o) => o.name === "body");
    const ua = bodyMesh.geometry.attributes._upperArm, pos = bodyMesh.geometry.attributes.position, nor = bodyMesh.geometry.attributes.normal;
    const rc = new THREE.Raycaster();
    rc.firstHitOnly = true;
    const cam = camera.position.clone();
    const used = new Set(bodyMesh.geometry.index.array);
    let tested = 0, covered = 0, hidden = 0;
    const v = new THREE.Vector3(), nn = new THREE.Vector3();
    const axis = worldPos("spine02").applyMatrix4(fig.matrixWorld);
    for (let i = 0; i < pos.count; i += 3) {
      if (!used.has(i) || ua.getX(i) < 0.7) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(fig.matrixWorld);
      nn.fromBufferAttribute(nor, i).transformDirection(fig.matrixWorld);
      const dir = v.clone().sub(cam);
      const dist = dir.length();
      dir.normalize();
      if (nn.dot(dir) > -0.25) continue; // facing away
      // the outer arm only (the cloth may touch the inner arm at the arm hole)
      const out = new THREE.Vector3(v.x - axis.x, 0, v.z - axis.z).normalize();
      if (nn.x * out.x + nn.z * out.z < 0.2) continue;
      rc.set(cam, dir);
      rc.far = dist + 0.01;
      const hit = rc.intersectObjects(targets, false)[0];
      tested++;
      if (!hit || hit.distance > dist - 0.004) continue;
      // a singlet hit within 4 cm in front of the skin is cloth on the arm (a sleeve); further away it is the torso in front of the far arm
      if (/^vest_/.test(hit.object.name) && hit.distance > dist - 0.04) covered++;
      else hidden++;
    }
    window.__fighter.info.armTest = { tested, coveredByVest: covered, hiddenByOther: hidden, coveredFraction: +(covered / Math.max(1, tested)).toFixed(4) };
  }
  if (num("pt", 1) === 0) {
    // raster preview (geometry checks): hemisphere + directional light, no path tracing
    scene.add(new THREE.HemisphereLight(0xffffff, 0x333333, 1.2));
    const dl = new THREE.DirectionalLight(0xffffff, 2.5);
    dl.position.set(2, 4, 3);
    scene.add(dl);
    scene.traverse((o) => {
      if (o.isMesh && num("flat", 0)) o.material = new THREE.MeshStandardMaterial({ color: o.material.color ?? 0xcccccc, map: o.material.map ?? null, side: THREE.DoubleSide, roughness: 0.6 });
    });
    renderer.render(scene, camera);
    window.__fighter.samples = 1;
    window.__fighter.done = true;
    return;
  }
  const pt = new WebGLPathTracer(renderer);
  pt.tiles.set(2, 2);
  pt.bounces = P.bounces;
  pt.transmissiveBounces = 4;
  pt.filterGlossyFactor = 0.75;
  pt.minSamples = 1;
  pt.renderDelay = 0;
  pt.fadeDuration = 0;
  pt.textureSize.set(2048, 2048);
  pt.multipleImportanceSampling = true;
  // make sure every texture is decoded and uploaded before the path tracer packs them (first-page black otherwise)
  const texs = new Set();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const k of ["map", "normalMap", "roughnessMap", "clearcoatMap", "sheenColorMap"]) if (o.material[k]) texs.add(o.material[k]);
  });
  for (const t of texs) renderer.initTexture(t);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  pt.setScene(scene, camera);
  window.__fighter.ready = true;
  const t0 = performance.now();
  const loop = () => {
    if (pt.samples < P.spp) {
      pt.renderSample();
      window.__fighter.samples = pt.samples;
      requestAnimationFrame(loop);
    } else {
      window.__fighter.done = true;
      window.__fighter.ms = performance.now() - t0;
    }
  };
  loop();
}

/** procedural fabric / leather detail (tiling normal maps, the trunks' print), drawn on canvases */
function makeFabricTextures() {
  const canvasTex = (size, draw, normal = true, rep = [1, 1]) => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    draw(g, size);
    let tex;
    if (normal) {
      // height (grey) → normal
      const img = g.getImageData(0, 0, size, size);
      const h = (x, y) => img.data[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
      const out = g.createImageData(size, size);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const dx = (h(x + 1, y) - h(x - 1, y)) * 2.0, dy = (h(x, y + 1) - h(x, y - 1)) * 2.0;
          const l = Math.hypot(dx, dy, 1);
          const i = (y * size + x) * 4;
          out.data[i] = (-dx / l * 0.5 + 0.5) * 255;
          out.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
          out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
          out.data[i + 3] = 255;
        }
      g.putImageData(out, 0, 0);
    }
    tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(rep[0], rep[1]);
    if (!normal) tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    return tex;
  };
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const knit = canvasTex(512, (g, s) => {
    g.fillStyle = "#808080";
    g.fillRect(0, 0, s, s);
    const n = 64;
    const cw = s / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const v = 110 + rnd() * 30;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.beginPath();
        g.ellipse((x + 0.5 + (y % 2) * 0.5) * cw, (y + 0.5) * cw, cw * 0.32, cw * 0.48, 0, 0, Math.PI * 2);
        g.fill();
      }
  }, true, [60, 60]);
  const rib = canvasTex(256, (g, s) => {
    for (let x = 0; x < s; x++) {
      const v = 128 + 70 * Math.sin((x / s) * Math.PI * 2 * 24);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, 0, 1, s);
    }
  }, true, [40, 40]);
  // satin: warp floats run lengthwise (down the leg) → fine vertical grooves, an anisotropic-looking highlight
  const satin = canvasTex(256, (g, s) => {
    for (let x = 0; x < s; x++) {
      const v = 128 + 34 * Math.sin((x / s) * Math.PI * 2 * 64) + (rnd() - 0.5) * 12;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, 0, 1, s);
    }
  }, true, [60, 40]);
  const leather = canvasTex(512, (g, s) => {
    g.fillStyle = "#808080";
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 9000; i++) {
      const v = 100 + rnd() * 70;
      g.fillStyle = `rgba(${v},${v},${v},0.5)`;
      g.beginPath();
      g.arc(rnd() * s, rnd() * s, 1 + rnd() * 2.5, 0, Math.PI * 2);
      g.fill();
    }
  }, true, [20, 20]);
  const canvas = canvasTex(256, (g, s) => {
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const v = 128 + 40 * Math.sin(x * 0.8) * Math.sin(y * 0.8) + (rnd() - 0.5) * 30;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x, y, 1, 1);
      }
  }, true, [40, 40]);
  const wrap = canvasTex(512, (g, s) => {
    g.fillStyle = "#f2f0ea";
    g.fillRect(0, 0, s, s);
    g.strokeStyle = "rgba(150,140,125,0.55)";
    g.lineWidth = 3;
    for (let i = -20; i < 40; i++) {
      g.beginPath();
      g.moveTo(0, i * 22);
      g.lineTo(s, i * 22 + s * 0.35);
      g.stroke();
    }
  }, false, [1, 6]);
  const trunks = (red) =>
    canvasTex(1024, (g, s) => {
      // (u: across the leg panel 0..1, side seam / stripe at 0.5; v: metres from the hem × 2)
      g.fillStyle = red ? "#b80f2a" : "#002f94";
      g.fillRect(0, 0, s, s);
      // chocolate side piping (u = 0.25 / 0.75 is the athlete's side)
      const us = window.__simTrunks ? [0.5] : [0.25, 0.75];
      g.fillStyle = "#5b3a24";
      for (const u of us) g.fillRect(u * s - s * 0.012, 0, s * 0.024, s);
      g.fillStyle = "#e9e3d6";
      for (const u of us) {
        g.fillRect(u * s - s * 0.018, 0, s * 0.004, s);
        g.fillRect(u * s + s * 0.014, 0, s * 0.004, s);
      }
      // twin-needle hem stitching (1.2 and 1.8 cm above the hem)
      g.fillStyle = "rgba(60,10,15,0.55)";
      for (const v of [0.012, 0.018])
        for (let x = 0; x < s; x += 6) g.fillRect(x, v * s - 1, 4, 2);
    }, false, [1, 1]);
  // headgear print: spherical uv (u = azimuth, v = elevation); panel seams with stitch rows, darker piping
  const headgear = (red) =>
    canvasTex(1024, (g, s) => {
      g.fillStyle = red ? "#a90f26" : "#002a80";
      g.fillRect(0, 0, s, s);
      // leather tone variation
      for (let i = 0; i < 1600; i++) {
        g.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.04})`;
        g.beginPath();
        g.arc(rnd() * s, rnd() * s, 4 + rnd() * 18, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = red ? "rgba(70,5,15,0.9)" : "rgba(0,10,40,0.9)";
      g.lineWidth = 3;
      for (let k = 0; k < 11; k++) {
        const x = (k / 11) * s;
        g.beginPath();
        g.moveTo(x, s * 0.5);
        g.lineTo(x, 0);
        g.stroke();
        g.fillStyle = "rgba(240,230,220,0.55)";
        for (let y = 0; y < s * 0.5; y += 9) {
          g.fillRect(x - 7, y, 2, 5);
          g.fillRect(x + 5, y, 2, 5);
        }
      }
      // brow / crown ring seam
      g.fillStyle = "rgba(240,230,220,0.5)";
      for (let x = 0; x < s; x += 9) g.fillRect(x, s * 0.36, 5, 2);
    }, false, [1, 1]);
  // waistband print: v = metres × 10 across the 8.5 cm band, two woven kit-colour stripes near the edges
  const band = (red) => {
    const t = canvasTex(256, (g, s) => {
      g.fillStyle = "#ebe6dc";
      g.fillRect(0, 0, s, s);
      g.fillStyle = red ? "#b80f2a" : "#002f94";
      for (const v of [0.012, 0.074]) g.fillRect(0, v * 10 * s, s, 0.006 * 10 * s);
      g.fillStyle = "rgba(0,0,0,0.05)";
      for (let x = 0; x < s; x += 4) g.fillRect(x, 0, 1, s);
    }, false, [12, 10]);
    return t;
  };
  return { knit, rib, satin, leather, canvas, wrap, trunks, headgear, band };
}

function addRing(scene, cam = [1, 1]) {
  const ropeMat = (c) => new THREE.MeshPhysicalMaterial({ color: new THREE.Color(c), roughness: 0.45, clearcoat: 0.3 });
  const half = 3.05;
  const ropes = [[0.45, "#e9e5dc"], [0.8, "#0033a0"], [1.15, "#e9e5dc"], [1.5, "#c8102e"]];
  for (const [y, c] of ropes) {
    // far sides only: the broadcast camera sits outside the near ropes, they would cross the fighter
    const sx = cam[0] >= 0 ? -half : half, sz = cam[1] >= 0 ? -half : half;
    for (const [ax, z] of [["x", sz], ["z", sx]]) {
      const g = new THREE.CylinderGeometry(0.02, 0.02, half * 2, 16);
      const m = new THREE.Mesh(g, ropeMat(c));
      if (ax === "x") {
        m.rotation.z = Math.PI / 2;
        m.position.set(0, y, z);
      } else {
        m.rotation.x = Math.PI / 2;
        m.position.set(z, y, 0);
      }
      scene.add(m);
    }
  }
  const sx2 = cam[0] >= 0 ? -half : half, sz2 = cam[1] >= 0 ? -half : half;
  for (const [x, z, c] of [[sx2, sz2, "#c8102e"], [-sx2, sz2, "#e9e5dc"], [sx2, -sz2, "#e9e5dc"]]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.6, 24), new THREE.MeshPhysicalMaterial({ color: new THREE.Color(c), roughness: 0.6 }));
    m.position.set(x, 0.8, z);
    scene.add(m);
  }
}

main().catch((e) => {
  console.error(e);
  window.__fighter.error = String(e && e.stack ? e.stack : e);
});

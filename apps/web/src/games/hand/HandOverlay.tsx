"use client";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { DIE_HALF } from "./clips";
import { dressRig, handMeshData, makeDie, makeHandRig, makeSeeds } from "./build";
import { hands, handMode, useHandStore } from "./director";
import { placeRig, localToScreen, type Placement } from "./place";

/**
 * The game-hand overlay (P2-GAME-07): one transparent canvas over the whole game screen, above the board and below
 * the dialogs, pointer-events off. Mounted on the first animation and dropped after a quiet spell; it renders only
 * while a clip plays (demand frameloop), so an idle board costs nothing. One hand mesh, one material, one die.
 */
const IDLE_UNMOUNT_MS = 9000;

export function HandOverlay() {
  const mounted = useHandStore((s) => s.mounted);
  const seq = useHandStore((s) => s.seq);
  const [mode, setMode] = useState<ReturnType<typeof handMode> | null>(null);
  useEffect(() => {
    setMode(handMode());
    // build the mesh while the player reads the board, never on the first roll
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const run = () => {
      if (handMode() === "svg") return;
      handMeshData(handMode() === "lite");
      // warm the canvas once (context + shader compile) so the first roll starts on time; it drops after a quiet spell
      lastActive.t = performance.now();
      useHandStore.setState({ mounted: true });
    };
    const id = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 2500 }) : window.setTimeout(run, 800);
    return () => {
      hands.clear();
      useHandStore.setState({ mounted: false });
      if (!w.requestIdleCallback) clearTimeout(id);
    };
  }, []);
  // drop the canvas (and its GL context) after a quiet spell
  useEffect(() => {
    if (!mounted) return;
    const tm = setInterval(() => {
      if (!hands.job && performance.now() - lastActive.t > IDLE_UNMOUNT_MS) useHandStore.setState({ mounted: false });
    }, 2000);
    return () => clearInterval(tm);
  }, [mounted]);
  useEffect(() => {
    lastActive.t = performance.now();
  }, [seq]);
  if (!mounted || !mode || mode === "svg") return null;
  const lite = mode === "lite";
  return (
    <Canvas
      frameloop="demand"
      dpr={lite ? 1 : [1, 1.75]}
      shadows={lite ? false : { type: THREE.PCFShadowMap }}
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance", premultipliedAlpha: true }}
      camera={{ fov: 28, near: 10, far: 20000, position: [0, 0, 1000] }}
      style={{ position: "fixed", inset: 0, zIndex: 35, pointerEvents: "none" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = 1.05;
        gl.setClearColor(0x000000, 0);
      }}
    >
      <HandScene lite={lite} />
    </Canvas>
  );
}
const lastActive = { t: 0 };

/** Debug counters for QA (fps / draw calls during an animation). */
export const handStats = { frames: 0, calls: 0, tris: 0, ms: 0, t0: 0, animFrames: 0, animMs: 0, maxGap: 0, last: 0 };
if (typeof window !== "undefined") {
  // QA hook: fps, draw calls and CPU time per frame while a hand clip plays
  (window as unknown as { __gkHandStats: () => object }).__gkHandStats = () => ({
    fps: handStats.animMs > 0 ? Math.round((handStats.animFrames / handStats.animMs) * 1000) : 0,
    frames: handStats.animFrames,
    maxFrameGapMs: Math.round(handStats.maxGap),
    drawCalls: handStats.calls,
    triangles: handStats.tris,
    cpuMsPerFrame: +(handStats.ms / Math.max(1, handStats.frames)).toFixed(2),
  });
}

function shadowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(0,0,0,1)");
  gr.addColorStop(0.45, "rgba(0,0,0,.55)");
  gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function HandScene({ lite }: { lite: boolean }) {
  const { camera, size, gl, scene, invalidate } = useThree();
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const parts = useMemo(() => {
    const rig = makeHandRig(lite);
    const die = makeDie();
    const seeds = makeSeeds(7);
    rig.bones[1]!.add(seeds);
    const tex = shadowTexture();
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.4 }));
    const dieBlob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.5 }));
    blob.renderOrder = dieBlob.renderOrder = -1;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.34, color: 0x1a0d05 }));
    ground.receiveShadow = true;
    const key = new THREE.DirectionalLight(0xfff0e0, 2.6);
    key.castShadow = !lite;
    key.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
    key.shadow.radius = 6;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.6;
    const hemi = new THREE.HemisphereLight(0xf6efe6, 0x6a4a30, 1.15);
    const fill = new THREE.DirectionalLight(0xc9d6ff, 0.35);
    return { rig, die, seeds, blob, dieBlob, ground, key, hemi, fill };
  }, [coarse, lite]);

  useEffect(() => {
    const { rig, die, blob, dieBlob, ground, key, hemi, fill } = parts;
    scene.add(rig.root, die, blob, dieBlob, ground, key, key.target, hemi, fill, fill.target);
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.42;
    hands.wake = () => invalidate();
    // compile every program now (hand, sleeve, die, shadows), not on the first animated frame
    const vis0 = rig.root.visible, vis1 = die.visible;
    rig.root.visible = die.visible = true;
    rig.root.position.set(-1e4, 0, 0);
    die.position.set(-1e4, 0, 0);
    gl.compile(scene, camera);
    gl.render(scene, camera);
    rig.root.visible = vis0;
    die.visible = vis1;
    invalidate();
    return () => {
      hands.wake = () => {};
      scene.environment = null;
      env.dispose();
      pm.dispose();
    };
  }, [camera, gl, invalidate, parts, scene]);

  // camera over the middle of the viewport, so that the plane z = 0 maps 1 world unit to 1 CSS pixel
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const d = size.height / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    cam.position.set(size.width / 2, -size.height / 2, d);
    cam.lookAt(size.width / 2, -size.height / 2, 0);
    cam.near = d * 0.2;
    cam.far = d * 2;
    cam.updateProjectionMatrix();
    parts.ground.scale.set(size.width * 3, size.height * 3, 1);
    parts.ground.position.set(size.width / 2, -size.height / 2, 0);
    invalidate();
  }, [camera, invalidate, parts, size]);

  const anchor = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), q: new THREE.Quaternion(), s: { x: 0, y: 0 }, place: { rect: hands.rect, side: 0, scale: 1 } as Placement }), []);
  useFrame(() => {
    const now = performance.now();
    const t0 = now;
    const active = hands.tick(now);
    const f = hands.frame;
    const tg = hands.target;
    const { rig, die, seeds, blob, dieBlob, key } = parts;
    rig.root.visible = !!tg && f.visible;
    die.visible = !!tg && f.die.visible;
    blob.visible = rig.root.visible;
    dieBlob.visible = die.visible && !f.die.held;
    if (tg) {
      dressRig(rig, tg.look);
      const P = tmp.place;
      P.rect = hands.rect;
      P.side = tg.side;
      P.scale = (tg.size * hands.rect.width) / 0.085;
      if (rig.root.visible) {
        placeRig(rig, f, P, anchor);
        rig.root.updateMatrixWorld(true);
        // contact shadow: tight and dark near the board, wide and faint as the hand lifts
        const hh = Math.max(0, anchor.z / P.scale);
        const sc = P.scale * (0.13 + hh * 1.1);
        blob.position.set(anchor.x + P.scale * 0.01, anchor.y - P.scale * 0.012, 0.5);
        blob.scale.set(sc * 1.25, sc, 1);
        blob.rotation.z = rig.root.rotation.z;
        (blob.material as THREE.MeshBasicMaterial).opacity = 0.42 * Math.max(0, 1 - hh / 0.16);
        // key light follows the hand; the shadow camera frames the hand + forearm
        key.target.position.set(anchor.x, anchor.y, 0);
        key.position.set(anchor.x - 0.35 * P.scale * 3, anchor.y + 0.5 * P.scale * 3, P.scale * 3);
        const cam = key.shadow.camera;
        const ext = P.scale * 0.42;
        if (cam.right !== ext) {
          cam.left = -ext;
          cam.right = ext;
          cam.top = ext;
          cam.bottom = -ext;
          cam.near = 1;
          cam.far = P.scale * 8;
          cam.updateProjectionMatrix();
        }
        // seeds peeking out between the thumb and the index
        const n = Math.min(7, f.seeds);
        seeds.count = n;
        for (let i = 0; i < n; i++) {
          const a = i * 2.39996;
          const r = 0.0028 + Math.sqrt(i) * 0.0042;
          tmp.v.set(-0.02 + Math.cos(a) * r, 0.074 + Math.sin(a) * r * 0.8, -0.021 - (i % 2) * 0.002);
          tmp.q.setFromAxisAngle(ZAXIS, a);
          mat4.compose(tmp.v, tmp.q, seedScale);
          seeds.setMatrixAt(i, mat4);
        }
        seeds.instanceMatrix.needsUpdate = true;
      }
      if (die.visible) {
        const ds = DIE_HALF * 2 * P.scale;
        die.scale.setScalar(ds);
        if (f.die.held) {
          rig.anchors.hold.getWorldPosition(die.position);
          rig.bones[1]!.getWorldQuaternion(die.quaternion);
        } else {
          localToScreen(P, f.die.u, f.die.v, tmp.s);
          die.position.set(tmp.s.x, -tmp.s.y, f.die.h * P.scale);
          die.quaternion.set(f.die.q[0], f.die.q[1], f.die.q[2], f.die.q[3]);
          dieBlob.position.set(tmp.s.x + ds * 0.08, -tmp.s.y - ds * 0.1, 0.4);
          const lift = Math.max(0, f.die.h - DIE_HALF) / 0.05;
          dieBlob.scale.setScalar(ds * (1.5 + lift));
          (dieBlob.material as THREE.MeshBasicMaterial).opacity = 0.55 * f.die.opacity * Math.max(0.2, 1 - lift);
        }
        for (const m of die.userData.mats as THREE.MeshStandardMaterial[]) {
          const tr = f.die.opacity < 0.999;
          if (m.transparent !== tr) {
            m.transparent = tr;
            m.needsUpdate = true;
          }
          m.opacity = f.die.opacity;
        }
      }
    }
    if (active) {
      invalidate();
      lastActive.t = now;
    }
    handStats.frames++;
    // gl.info still holds the previous frame here (it resets at the start of each render)
    if (gl.info.render.calls > 1) {
      handStats.calls = Math.max(handStats.calls, gl.info.render.calls);
      handStats.tris = Math.max(handStats.tris, gl.info.render.triangles);
    }
    handStats.ms += performance.now() - t0;
    if (active) {
      if (handStats.last && now - handStats.last < 250) {
        handStats.animMs += now - handStats.last;
        handStats.animFrames++;
        handStats.maxGap = Math.max(handStats.maxGap, now - handStats.last);
      }
      handStats.last = now;
    } else handStats.last = 0;
  });
  return null;
}
const mat4 = new THREE.Matrix4();
const ZAXIS = new THREE.Vector3(0, 0, 1);
const seedScale = new THREE.Vector3(0.0058, 0.0058, 0.0058);

"use client";
import { startTransition, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Canvas, createPortal, useFrame, useThree } from "@react-three/fiber";
import { AdaptiveDpr, PerformanceMonitor, useGLTF, useProgress } from "@react-three/drei";
import { XR, useXR } from "@react-three/xr";
import { useStore } from "zustand";
import * as THREE from "three";
import { Plaza } from "./Plaza";
import { Effects } from "./Lighting";
import { Avatar } from "./Avatar";
import { Gate } from "./gate/Gate";
import { GateActors } from "./gate/GateCanvas";
import { PlazaActors, pickTier } from "./WorldCanvas";
import { xrStore } from "./xr-store";
import { PORTALS, portalTransform } from "./layout";
import { doorOpen } from "./transition";
import { AreaContext, areaOf, areaTopUp, getArea, hallOf, knownAreas, useStage, type Area } from "./stage";
import { useDoorway } from "./doorway";
import { HallActors, HallInterior } from "@/rooms/RoomCanvas";
import { HALLS, type HallGame } from "@/rooms/layouts";
import { selfPose, useWorld } from "@/lib/world-store";
import { lookOf, useProfile } from "@/lib/profile-store";
import { preloadHall } from "@/rooms/preload";
import { preloadVegetation } from "./Vegetation";
import { ANIM_SETS, HUMAN_MODELS } from "./human/meta";

/**
 * The ONE persistent WebGL canvas of the session (mounted once by world/SceneHost in the root layout).
 *
 * Every place is an area scene hung under the renderer's root scene (world/stage.ts); only the one on screen is
 * visible, so the WebGL context, the shader-program cache, GPU textures and the loader caches survive every
 * crossing. A hall you walk up to (≤ 12 m, rooms/preload.ts) is mounted hidden and made GPU-ready while you walk
 * (`AreaWarm`: compileAsync + texture upload + one 1-pixel draw), and the plaza stays mounted while you are in a
 * hall, so walking through a door is a same-frame switch.
 */

/**
 * Cold boot: request EVERYTHING the first view needs at once, in parallel, before React mounts the tree (nested
 * components would otherwise each suspend on their own loader in turn — a request waterfall). GLBs go through the
 * shared loader cache; textures / fonts loaded by plain loaders are warmed in the HTTP cache.
 */
function preloadFor(path: string) {
  preloadVegetation();
  useGLTF.preload(HUMAN_MODELS.guard.url, false);
  for (const s of Object.values(ANIM_SETS)) useGLTF.preload(s.lifeUrl, false);
  for (const url of ["/assets/env/ground-grass.webp", "/assets/env/ground-grass-n.webp", "/assets/env/acacia-imp.webp", "/assets/env/eucalyptus-imp.webp", "/fonts/Baloo2.ttf"])
    void fetch(url, { cache: "force-cache" }).catch(() => undefined);
  const hall = /^\/room\/(pool|ludo|igisoro)/.exec(path)?.[1] as HallGame | undefined;
  if (hall) preloadHall(hall);
}
if (typeof window !== "undefined") preloadFor(location.pathname);

/** Hall you walked away from: released beyond this distance from its door (phones keep less around). */
const COOL_DIST = { lite: 22, standard: 40 } as const;

/* ---------------- warm-up: compile + upload a (hidden) area so its first visible frame never stalls ---------------- */

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const frames = async (n: number) => {
  for (let i = 0; i < n; i++) await nextFrame();
};

let fxTarget: THREE.WebGLRenderTarget | null = null;
/** With the bloom composer on, the scene is drawn into a (linear, untone-mapped) render target: compile for that. */
const targetFor = (fx: boolean) => (fx ? (fxTarget ??= new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType })) : null);

function texturesOf(root: THREE.Object3D): THREE.Texture[] {
  const out = new Set<THREE.Texture>();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m])
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) {
        const t = v as THREE.Texture | null;
        if (t && t.isTexture && !(t as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture && !(t as THREE.VideoTexture).isVideoTexture && t.image) out.add(t);
      }
  });
  return [...out];
}

/** pending 1-pixel warm draws, run inside the next frame before the real render (never outside a frame) */
const warmDraws: (() => void)[] = [];

function AreaWarm({ area, content }: { area: Area; content: RefObject<THREE.Group | null> }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let alive = true;
    const shown = <T,>(fn: () => T): T => {
      // lights are only gathered from visible objects: show the area for the synchronous call only
      // (warm-only stand-ins such as the proxy avatar are drawn too, so their shadow-depth programs exist)
      const g = content.current;
      const sv = scene.visible;
      const gv = g?.visible ?? true;
      const extra: THREE.Object3D[] = [];
      scene.traverse((o) => o.userData.gkWarmOnly && !o.visible && extra.push(o));
      scene.visible = true;
      if (g) g.visible = true;
      extra.forEach((o) => (o.visible = true));
      try {
        return fn();
      } finally {
        scene.visible = sv;
        if (g) g.visible = gv;
        extra.forEach((o) => (o.visible = false));
      }
    };
    /** compile for one output path: a render target (bloom composer) or the canvas, which tone-maps itself (ACES)
     *  when the composer is off; while the composer is mounted it zeroes gl.toneMapping, so set it for the call */
    const compileFor = (rt: THREE.WebGLRenderTarget | null) =>
      shown(() => {
        const prev = gl.getRenderTarget();
        const tm = gl.toneMapping;
        gl.setRenderTarget(rt);
        if (!rt) gl.toneMapping = THREE.ACESFilmicToneMapping;
        try {
          return gl.compileAsync(scene, camera).catch(() => undefined);
        } finally {
          gl.toneMapping = tm;
          gl.setRenderTarget(prev);
        }
      });
    const prog = (v: number) =>
      useStage.setState((st) => (v > (st.warmProgress[area] ?? 0) ? { warmProgress: { ...st.warmProgress, [area]: v } } : st));
    void (async () => {
      mark(`${area}:content`);
      await frames(4); // environment maps, the windows' cube capture and lazy children settle first
      if (!alive) return;
      const t0 = performance.now();
      // compile for both paths the frame can take (bloom composer → render target; no bloom → screen): the
      // performance monitor may switch bloom at any time, and either variant compiling later would stall a frame
      const st = useStage.getState();
      const targets = st.tier === "standard" ? [targetFor(st.fx), targetFor(!st.fx)] : [null];
      const ps: Promise<unknown>[] = [];
      for (const rt of targets) ps.push(compileFor(rt));
      await Promise.all(ps);
      if (!alive) return;
      prog(0.5);
      mark(`${area}:compiled`);
      // upload textures within a per-frame time budget (no long frame while you are walking); while booting on
      // screen behind the boot screen nobody is moving yet, so the budget is generous
      const tex = texturesOf(scene);
      const view = useStage.getState().view;
      const budget = view && areaOf(view) === area && !useStage.getState().ready[area] ? 40 : 4;
      let slice = performance.now();
      for (let i = 0; i < tex.length; i++) {
        try {
          gl.initTexture(tex[i]!);
        } catch {
          /* exotic texture: uploads on first use */
        }
        if (performance.now() - slice > budget) {
          prog(0.5 + (0.4 * i) / tex.length);
          await nextFrame();
          slice = performance.now();
        }
        if (!alive) return;
      }
      // draw the area into a single pixel, a batch of meshes per frame (geometry buffers, uniform reflection, shadow
      // passes, late uploads): spread over frames so warming a hall while you walk never costs one long frame. While
      // booting on screen (nobody walking) the batches are large.
      const drawables: THREE.Object3D[] = [];
      scene.traverse((o) => ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) && drawables.push(o));
      const batch = budget > 4 ? 1e9 : 24;
      for (let i = 0; i < drawables.length; i += batch) {
        await new Promise<void>((resolve) => {
          warmDraws.push(() => {
            if (alive)
              shown(() => {
                const saved = drawables.map((o) => o.visible);
                drawables.forEach((o, j) => (o.visible = saved[j]! && j >= i && j < i + batch));
                const fxRt = targetFor(useStage.getState().fx);
                const prev = gl.getRenderTarget();
                const sc = gl.getScissorTest();
                const ac = gl.autoClear;
                gl.autoClear = false;
                if (fxRt) gl.setRenderTarget(fxRt);
                else {
                  gl.setScissorTest(true);
                  gl.setScissor(0, 0, 1, 1);
                }
                try {
                  gl.render(scene, camera);
                } finally {
                  gl.setScissorTest(sc);
                  gl.setRenderTarget(prev);
                  gl.autoClear = ac;
                  drawables.forEach((o, j) => (o.visible = saved[j]!));
                }
              });
            resolve();
          });
        });
        if (!alive) return;
      }
      await nextFrame();
      if (!alive) return;
      if (process.env.NODE_ENV !== "production") console.debug(`[stage] ${area} ready in ${(performance.now() - t0).toFixed(0)} ms (${tex.length} textures)`);
      prog(1);
      mark(`${area}:ready`);
      useStage.getState().setReady(area, true);
      // top-up right before a crossing: parts that resolved after this warm-up (nested Suspense, late text
      // atlases, props streamed in) get compiled + uploaded too; everything already warm is a cheap no-op
      areaTopUp.set(area, async () => {
        if (!alive) return;
        const st2 = useStage.getState();
        const ts = st2.tier === "standard" ? [targetFor(st2.fx), targetFor(!st2.fx)] : [null];
        const ps2: Promise<unknown>[] = [];
        for (const rt of ts) ps2.push(compileFor(rt));
        await Promise.all(ps2);
        for (const t of texturesOf(scene))
          try {
            gl.initTexture(t);
          } catch {
            /* uploads on first use */
          }
      });
    })();
    return () => {
      alive = false;
      areaTopUp.delete(area);
      useStage.getState().setReady(area, false);
      useStage.setState((st) => ({ warmProgress: { ...st.warmProgress, [area]: 0 } }));
    };
  }, [area, gl, scene, camera, content]);
  return null;
}

/**
 * An area's content: hidden until it is GPU-ready (the boot screen covers a cold area meanwhile; the scene never
 * stalls on a first-frame shader compile), people mount once it is ready and on screen.
 */
function AreaContent({ area, actors, children }: { area: Area; actors: ReactNode; children: ReactNode }) {
  const ready = useStage((s) => !!s.ready[area]);
  const content = useRef<THREE.Group>(null);
  return (
    <>
      <group ref={content} visible={ready}>
        <Suspense fallback={null}>
          {children}
          <AreaWarm area={area} content={content} />
        </Suspense>
      </group>
      {ready && actors}
    </>
  );
}

/** Keeps the shader programs of your own avatar compiled for this area's lights (never drawn). */
function ProxyAvatar({ tier, at = [0, -400, 0] }: { tier: "lite" | "standard"; at?: [number, number, number] }) {
  const profile = useProfile();
  const look = useMemo(() => lookOf(profile), [profile]);
  const anim = useRef(0);
  return (
    <group position={at} visible={false} userData={{ gkWarmOnly: true }}>
      <Avatar look={look} animRef={anim} showTag={false} shadows={tier !== "lite"} quality={tier} />
    </group>
  );
}

/* ---------------- areas ---------------- */

function AreaRig({ camera, active }: { camera: THREE.PerspectiveCamera; active: boolean }) {
  const size = useThree((s) => s.size);
  const setEvents = useThree((s) => s.setEvents);
  useLayoutEffect(() => {
    camera.aspect = size.width / Math.max(1, size.height);
    camera.updateProjectionMatrix();
  }, [size, camera]);
  // pointer events only reach the area on screen
  useEffect(() => setEvents({ enabled: active }), [active, setEvents]);
  return null;
}

function AreaPortal({ area, children }: { area: Area; children: ReactNode }) {
  const { scene, camera } = getArea(area);
  const active = useStage((s) => !!s.view && areaOf(s.view) === area);
  return (
    <>
      <primitive object={scene} dispose={null} />
      {createPortal(
        <AreaContext.Provider value={area}>
          <AreaRig camera={camera} active={active} />
          {children}
        </AreaContext.Provider>,
        scene,
        { camera },
      )}
    </>
  );
}

function OutdoorArea({ tier }: { tier: "lite" | "standard" }) {
  const view = useStage((s) => s.view);
  const nearPortal = useWorld((s) => s.nearPortal);
  const inXR = useXR((s) => s.session != null);
  return (
    <AreaContent area="outdoor" actors={view === "gate" ? <GateActors /> : view === "plaza" ? <PlazaActors tier={tier} /> : null}>
      <Plaza nearPortal={view === "plaza" ? nearPortal : null} tier={tier} />
      {/* the arrival gate at the south end of the avenue (sign-in, sign-out) */}
      <Gate tier={tier} inXR={inXR} />
      <ProxyAvatar tier={tier} />
    </AreaContent>
  );
}

function HallArea({ game, tier }: { game: HallGame; tier: "lite" | "standard" }) {
  const layout = HALLS[game];
  const active = useStage((s) => s.view === `hall:${game}`);
  return (
    <AreaContent area={`hall:${game}`} actors={active ? <HallActors layout={layout} tier={tier} /> : null}>
      <HallInterior layout={layout} lite={tier === "lite"} />
      {/* where you will appear: inside the hall lights' shadow range for the warm draw */}
      <ProxyAvatar tier={tier} at={[layout.door.x, 0, layout.size.d / 2 - 1.2]} />
    </AreaContent>
  );
}

/* ---------------- per-frame compositing: one root scene, the active area visible, its camera drives the view ---------------- */

/** cheap read-only counters for QA scripts (frames drawn, view, area readiness, person pose, GPU resources) */
const probe = { frames: 0, view: null as string | null, ready: false, self: selfPose, doors: doorOpen, programs: 0, textures: 0, geometries: 0, marks: {} as Record<string, number>, cam: null as THREE.Camera | null, dt: 0 };
/** first-time milestones (ms since navigation start) for boot timing */
function mark(k: string) {
  probe.marks[k] ??= Math.round(performance.now());
}
mark("chunk");
if (typeof window !== "undefined") (window as unknown as { __gkProbe: typeof probe }).__gkProbe = probe;

const ESTABLISH_MS = 1300;
const _aim = new THREE.Vector3();

function Compositor() {
  const gl = useThree((s) => s.gl);
  const root = useThree((s) => s.scene);
  const rootCam = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const steady = useRef(0);
  useFrame((_, dt) => {
    for (const run of warmDraws.splice(0)) run();
    const st = useStage.getState();
    const area = st.view ? areaOf(st.view) : null;
    for (const [k, o] of knownAreas()) o.scene.visible = k === area;
    probe.view = st.view;
    probe.cam = rootCam;
    probe.dt = dt;
    probe.ready = !!area && !!st.ready[area];
    if (!area) return;
    const a = getArea(area);
    // scene-level settings come from the area on screen
    root.background = a.scene.background;
    root.backgroundIntensity = a.scene.backgroundIntensity;
    root.backgroundBlurriness = a.scene.backgroundBlurriness;
    root.backgroundRotation.copy(a.scene.backgroundRotation);
    root.environmentRotation.copy(a.scene.environmentRotation);
    root.environment = a.scene.environment;
    root.environmentIntensity = a.scene.environmentIntensity;
    root.fog = a.scene.fog;
    // the gate is framed a little tighter than the plaza: ease the lens across the walk-in, never snap
    if (area === "outdoor") {
      const want = st.view === "gate" ? 55 : 60;
      if (Math.abs(a.camera.fov - want) > 0.01) {
        a.camera.fov += (want - a.camera.fov) * Math.min(1, dt * 2.5);
        a.camera.updateProjectionMatrix();
      }
    }
    if (!gl.xr.isPresenting) {
      const c = a.camera;
      rootCam.position.copy(c.position);
      rootCam.quaternion.copy(c.quaternion);
      // establishing move after a cold reveal: a wide lens settling onto the follow framing while the view eases
      // back from just over the shoulder. Only the rendered view is blended (the controllers keep driving the area
      // camera), and it moves along the camera→person line, which the follow camera keeps clear of walls.
      let fov = c.fov;
      const est = st.establish;
      if (est && est.area === area) {
        const k = (performance.now() - est.t0) / ESTABLISH_MS;
        if (k >= 1) useStage.setState({ establish: null });
        else {
          const u = 1 - (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
          _aim.set(selfPose.x, 1.45, selfPose.z).sub(c.position);
          const dist = _aim.length();
          if (dist > 1e-3) rootCam.position.addScaledVector(_aim, (Math.min(1.4, dist * 0.35) / dist) * u);
          fov = c.fov + 20 * u;
        }
      }
      if (rootCam.fov !== fov || rootCam.near !== c.near || rootCam.far !== c.far) {
        rootCam.fov = fov;
        rootCam.near = c.near;
        rootCam.far = c.far;
        rootCam.updateProjectionMatrix();
      }
    }
    if (!st.fx) {
      gl.autoClear = true;
      gl.render(root, rootCam);
    }
    probe.frames++;
    probe.programs = gl.info.programs?.length ?? 0;
    probe.textures = gl.info.memory.textures;
    probe.geometries = gl.info.memory.geometries;
    // a held frame (cold fallback) reveals once the area on screen is ready and frames are on time again
    if (st.ready[area] && useDoorway.getState().phase === "closed") {
      steady.current = dt < 0.05 ? steady.current + 1 : 0;
      if (steady.current >= 3) useDoorway.getState().ready();
    } else steady.current = 0;
  }, 1);
  return null;
}

/** Releases a warm hall once you have walked well away from its door (and its assets are no longer needed). */
function WarmKeeper() {
  const acc = useRef(0);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 0.5) return;
    acc.current = 0;
    const st = useStage.getState();
    if (st.view !== "plaza") return;
    for (const g of st.warm) {
      const p = PORTALS.find((x) => x.id === g);
      if (!p) continue;
      const t = portalTransform(p);
      if (Math.hypot(t.entryX - selfPose.x, t.entryZ - selfPose.z) > COOL_DIST[st.tier]) st.coolHall(g);
    }
  });
  return null;
}

function Stage() {
  const view = useStage((s) => s.view);
  const warm = useStage((s) => s.warm);
  const tier = useStage((s) => s.tier);
  const outdoorReady = useStage((s) => !!s.ready.outdoor);
  const activeHall = hallOf(view);
  const activeReady = useStage((s) => (activeHall ? !!s.ready[`hall:${activeHall}`] : true));
  // deep link into a hall: the hall boots and reveals first; the plaza is built afterwards, once the reveal and the
  // HUD are in, as a low-priority (time-sliced) transition, so leaving is instant without stalling the reveal
  const [outdoorOn, setOutdoorOn] = useState(false);
  const hud = useStage((s) => s.hud);
  useEffect(() => {
    if (outdoorOn) return;
    // (built straight away, also for a hall deep link: the boot screen waits for it, so it never stalls the hall)
    if (view) return setOutdoorOn(true);
    if (!activeReady || !hud) return;
    const t = setTimeout(() => startTransition(() => setOutdoorOn(true)), 1200);
    return () => clearTimeout(t);
  }, [view, activeReady, hud, outdoorOn]);
  const wanted = [...new Set([...(activeHall ? [activeHall] : []), ...(outdoorReady || activeHall ? warm : [])])];
  // a hall you walk up to is mounted as a low-priority, time-sliced transition (the plaza keeps rendering smoothly
  // while its tree builds); the hall on screen (deep link, back button) mounts at once
  const key = wanted.join(",");
  const [halls, setHalls] = useState<HallGame[]>(wanted);
  useEffect(() => {
    const next = key ? (key.split(",") as HallGame[]) : [];
    if (activeHall && !halls.includes(activeHall)) setHalls(next);
    else startTransition(() => setHalls(next));
  }, [key, activeHall]);
  return (
    <>
      {outdoorOn && (
        <AreaPortal area="outdoor">
          <OutdoorArea tier={tier} />
        </AreaPortal>
      )}
      {halls.map((g) => (
        <AreaPortal key={g} area={`hall:${g}`}>
          <HallArea game={g} tier={tier} />
        </AreaPortal>
      ))}
      <Compositor />
      <WarmKeeper />
    </>
  );
}

/** Publishes asset loading progress to the boot screen (which lives outside this lazily loaded chunk). */
function ProgressBridge() {
  const { progress, active } = useProgress();
  useEffect(() => {
    useStage.setState({ assets: active ? progress / 100 : progress >= 100 ? 1 : useStage.getState().assets });
  }, [progress, active]);
  return null;
}

export default function SceneCanvas() {
  const tier = useMemo(pickTier, []);
  const [fxWanted, setFx] = useState(tier === "standard");
  const inXR = useStore(xrStore, (s) => s.session != null);
  const view = useStage((s) => s.view);
  const hud = useStage((s) => s.hud);
  const fx = fxWanted && !inXR;
  useLayoutEffect(() => {
    useStage.setState({ tier, fx });
  }, [tier, fx]);
  return (
    <>
    <ProgressBridge />
    <Canvas
      shadows={tier === "lite" ? false : "percentage"}
      dpr={tier === "lite" ? [1, 1.25] : [1, 1.75]}
      frameloop={view ? "always" : "never"}
      camera={{ fov: 60, near: 0.15, far: 3200, position: [0, 4, 24] }}
      gl={{
        antialias: tier !== "lite",
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.0,
      }}
      onCreated={({ gl }) => {
        gl.domElement.dataset.gkStage = "1";
        // production: don't read back every program's info log (a synchronous GPU round-trip per shader that defeats
        // the parallel compile of the warm-up); dev keeps the checks for readable shader errors
        if (process.env.NODE_ENV === "production") gl.debug.checkShaderErrors = false;
      }}
      style={{ touchAction: "none" }}
    >
      {/* Dynamic quality (§16.3): drop bloom first when frame time is over budget, restore when it recovers. Only
          after the first reveal: loading frames are slow by nature and must not blur the DPR or flip bloom mid-reveal. */}
      {hud && <PerformanceMonitor onDecline={() => setFx(false)} onIncline={() => setFx(tier === "standard")} flipflops={3} onFallback={() => setFx(false)} />}
      {hud && <AdaptiveDpr pixelated={false} />}
      <XR store={xrStore}>
        <Stage />
      </XR>
      {/* bloom only on Standard, only outside XR (post-processing breaks foveation / layers on Quest), only while fps holds */}
      {fx && <Effects />}
    </Canvas>
    </>
  );
}

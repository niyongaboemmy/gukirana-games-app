"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { selfPose } from "@/lib/world-store";
import { uiAudio } from "@/lib/audio";
import { isOnScreen, useArea } from "./stage";
import { DOOR_RING, PORTALS, ringPoint } from "./layout";
import { ADMIN_FLAGPOLES, ADMIN_FLAG_Z } from "./District";
import type { Tier } from "./materials";
import { useGamePrefs } from "@/games/feedback";
import { kigaliHour } from "./activities";

/*
 * Plaza life that isn't geometry: wind-blown flags on the arena flagpoles and a quiet, synthesized soundscape
 * (fountain water by distance, highland breeze, the odd bird, sensor doors sliding). No audio files; nothing plays
 * until the visitor has interacted with the page (browser autoplay rules, see lib/audio.ts).
 */

/* ---------------- sound ---------------- */

/** Cosmetic pseudo-random sequence (not game randomness). */
function lcg(seed: number) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function noiseBuffer(ctx: AudioContext, seconds: number, seed: number) {
  const rnd = lcg(seed);
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
  return buf;
}

/**
 * Levels (P2-WLD-09 calmer mix): the whole bed sits on one ambience bus (AMBIENCE) well under the UI sounds (UI
 * chimes peak at ~0.08–0.12, the bed at ~0.02–0.03), the fountain falls off steeply with distance, nothing is a
 * short audible loop (noise buffers of 7–10 s, different lengths per layer, slowly modulated), and the bed follows
 * the player's "Game sounds" setting (Settings), fading out when it is off.
 */
const AMBIENCE = 0.8;
const soundOn = () => useGamePrefs.getState().sound;

type Bed = { master: GainNode; fountain: GainNode; babble: GainNode; wind: GainNode; windFilter: BiquadFilterNode };
let bed: Bed | null = null;

function loopNoise(ctx: AudioContext, seconds: number, seed: number) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, seconds, seed);
  src.loop = true;
  return src;
}

function ensureBed(): Bed | null {
  if (bed) return bed;
  const ctx = uiAudio();
  if (!ctx) return null;
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  // fountain, two soft layers (no hiss): a low wash of falling water and a quieter mid "babble"
  const fSrc = loopNoise(ctx, 7.3, 11);
  const wash = ctx.createBiquadFilter();
  wash.type = "bandpass";
  wash.frequency.value = 420;
  wash.Q.value = 0.55;
  const fountain = ctx.createGain();
  fountain.gain.value = 0;
  fSrc.connect(wash).connect(fountain).connect(master);
  fSrc.start();
  const bSrc = loopNoise(ctx, 8.9, 17);
  const bab = ctx.createBiquadFilter();
  bab.type = "bandpass";
  bab.frequency.value = 1050;
  bab.Q.value = 0.9;
  const babbleLp = ctx.createBiquadFilter();
  babbleLp.type = "lowpass";
  babbleLp.frequency.value = 1900;
  const babble = ctx.createGain();
  babble.gain.value = 0;
  bSrc.connect(bab).connect(babbleLp).connect(babble).connect(master);
  bSrc.start();

  // highland breeze: low rumble whose brightness drifts slowly
  const wSrc = loopNoise(ctx, 9.7, 29);
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = "lowpass";
  windFilter.frequency.value = 320;
  windFilter.Q.value = 0.5;
  const wind = ctx.createGain();
  wind.gain.value = 0.02;
  wSrc.connect(windFilter).connect(wind).connect(master);
  wSrc.start();

  bed = { master, fountain, babble, wind, windFilter };
  return bed;
}

/** One distant bird call: a few soft falling notes (a sunbird-like twitter), far away, softened by the air. */
function birdCall(rnd: () => number) {
  const ctx = uiAudio();
  if (!ctx || !bed) return;
  const t0 = ctx.currentTime + 0.05;
  const notes = 2 + Math.floor(rnd() * 3);
  const base = 2100 + rnd() * 1300;
  const pan = ctx.createStereoPanner();
  pan.pan.value = rnd() * 1.6 - 0.8;
  const air = ctx.createBiquadFilter(); // distance: the highs go first
  air.type = "lowpass";
  air.frequency.value = 3800;
  pan.connect(air).connect(bed.master);
  const peak = 0.006 + rnd() * 0.004;
  for (let i = 0; i < notes; i++) {
    const t = t0 + i * (0.1 + rnd() * 0.06);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(base * (1.12 - i * 0.04), t);
    o.frequency.exponentialRampToValueAtTime(base * 0.8, t + 0.08);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g).connect(pan);
    o.start(t);
    o.stop(t + 0.12);
  }
}

/** One water droplet landing in the basin: a soft, low rounded "plip". */
function droplet(rnd: () => number, level: number) {
  const ctx = uiAudio();
  if (!ctx || !bed || level < 0.0015) return;
  const t = ctx.currentTime + 0.01;
  const f0 = 520 + rnd() * 560;
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f0 * (1.4 + rnd() * 0.3), t + 0.05);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level * (0.5 + rnd() * 0.5), t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1 + rnd() * 0.05);
  const pan = ctx.createStereoPanner();
  pan.pan.value = rnd() * 1.0 - 0.5;
  o.connect(g).connect(pan).connect(bed.master);
  o.start(t);
  o.stop(t + 0.17);
}

/** Level for a one-shot plaza sound at (x, z): distance falloff from the listener, 0 when muted / off screen. */
function oneShotLevel(x: number, z: number, peak: number, k: number) {
  if (!soundOn() || !isOnScreen("outdoor")) return 0; // the plaza is kept warm while you are in a hall: silent there
  const dist = Math.hypot(selfPose.x - x, selfPose.z - z);
  return (peak * AMBIENCE) / (1 + dist * k);
}

/** A plaza sensor door sliding open/closed, attenuated by distance from the listener. */
export function plazaDoorSound(x: number, z: number, opening: boolean) {
  const ctx = uiAudio();
  const vol = ctx ? oneShotLevel(x, z, 0.04, 0.35) : 0;
  if (!ctx || vol < 0.003) return;
  const len = 0.8;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, len, opening ? 5 : 9);
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 0.8;
  const t = ctx.currentTime;
  f.frequency.setValueAtTime(opening ? 420 : 950, t);
  f.frequency.exponentialRampToValueAtTime(opening ? 1150 : 360, t + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.12);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t);
  src.stop(t + len);
}

/** Pigeons taking off (world/PlazaActivities): a soft flutter of wingbeats, by distance. */
export function birdFlutter(x: number, z: number) {
  const ctx = uiAudio();
  const vol = ctx ? oneShotLevel(x, z, 0.035, 0.3) : 0;
  if (!ctx || vol < 0.003) return;
  const len = 1.1;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, len, 41);
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = 900;
  f.Q.value = 0.7;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  // ~16 wingbeats a second, fading as the flock climbs away
  g.gain.setValueAtTime(0.0001, t);
  for (let i = 0; i < 16; i++) {
    const at = t + i * 0.065;
    const v = vol * (1 - i / 17);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0002, at + 0.05);
  }
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t);
  src.stop(t + len);
}

/** Drives the soundscape from the listener's position: fountain near the basin, breeze always, distant birds. */
function Soundscape() {
  const rnd = useMemo(() => lcg(77), []);
  const nextBird = useRef(0);
  const nextDrop = useRef(0);
  const area = useArea();
  const level = useRef(-1);
  useEffect(
    () => () => {
      // leaving the plaza (into a hall, signing out): fade the bed out
      const ctx = uiAudio();
      if (bed && ctx) bed.master.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      bed = null;
    },
    [],
  );
  useFrame(({ clock }) => {
    // the plaza stays mounted (warm) while you are in a hall: its soundscape fades out there and back in on return;
    // "Game sounds" off (Settings) fades it out too
    const here = isOnScreen(area);
    const on = here && soundOn();
    if (!on && !bed) return;
    const b = ensureBed();
    const ctx = uiAudio();
    if (!b || !ctx) return;
    const target = on ? AMBIENCE : 0;
    if (target !== level.current) {
      level.current = target;
      b.master.gain.setTargetAtTime(target, ctx.currentTime, on ? 1.2 : 0.3);
    }
    if (!on) return;
    const t = clock.elapsedTime;
    const d = Math.hypot(selfPose.x, selfPose.z); // fountain at the plaza centre
    // a calm murmur at the basin, falling off steeply: about a quarter at 10 m, nearly gone by 25 m
    const q = Math.max(0, d - 4) / 5;
    const near = 1 / (1 + q * q);
    // slow swell (the jets are not a machine): two slow sines on the level
    const sw = 1 + 0.12 * Math.sin(t * 0.37) + 0.06 * Math.sin(t * 0.91 + 0.8);
    b.fountain.gain.setTargetAtTime(0.02 * near * sw, ctx.currentTime, 0.5);
    b.babble.gain.setTargetAtTime(0.008 * near * (2 - sw), ctx.currentTime, 0.5);
    // a few soft droplets close by only
    if (near > 0.3 && t > nextDrop.current) {
      droplet(rnd, 0.007 * near);
      nextDrop.current = t + 0.25 + rnd() * (0.9 / near);
    }
    // gusts: two slow sines → loudness and brightness drift
    const gust = 0.5 + 0.3 * Math.sin(t * 0.13) + 0.2 * Math.sin(t * 0.37 + 1.3);
    b.wind.gain.setTargetAtTime(0.018 + gust * 0.022, ctx.currentTime, 1.2);
    b.windFilter.frequency.setTargetAtTime(220 + gust * 260, ctx.currentTime, 1.2);
    // distant birds: now and then, a little more often in the early morning (Kigali time)
    if (t > nextBird.current) {
      if (nextBird.current > 0) birdCall(rnd);
      const morning = kigaliHour(Date.now()) < 9 ? 0.6 : 1;
      nextBird.current = t + (9 + rnd() * 16) * morning;
    }
  });
  return null;
}

/* ---------------- flags ---------------- */

const FLAG_W = 1.8;
const FLAG_H = 1.1;
const POLES = [-11.5, -10, 10, 11.5];
const FLAG_COLORS = ["#00A1DE", "#FAD201", "#20603D", "#9B51E0"]; // Rwanda blue/yellow/green + arena purple

/** Cloth flag: vertices sway with a travelling wave whose amplitude grows away from the pole (pinned edge stays still). */
function Flag({ x, color, phase, tier, y = 10.3, z = -DOOR_RING + 3, map }: { x: number; color: string; phase: number; tier: Tier; y?: number; z?: number; map?: THREE.Texture }) {
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color, map: map ?? null, roughness: 0.85, side: THREE.DoubleSide });
    m.onBeforeCompile = (s) => {
      s.uniforms.uTime = { value: 0 };
      s.uniforms.uPhase = { value: phase };
      m.userData.shader = s;
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uPhase;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           float u = clamp(position.x / ${FLAG_W.toFixed(2)}, 0.0, 1.0);
           float w = uTime * 5.0 + uPhase - u * 6.0;
           transformed.z += sin(w) * 0.16 * u + sin(w * 1.7 + 0.6) * 0.05 * u;
           transformed.y += sin(w * 0.8) * 0.04 * u - 0.06 * u * u;
           transformed.x -= 0.05 * u * u * (1.0 + 0.3 * sin(w));`,
        );
    };
    return m;
  }, [color, phase, map]);
  const geo = useMemo(() => new THREE.PlaneGeometry(FLAG_W, FLAG_H, tier === "lite" ? 8 : 20, tier === "lite" ? 3 : 6).translate(FLAG_W / 2, 0, 0), [tier]);
  useFrame(({ clock }) => {
    const s = mat.userData.shader as { uniforms: { uTime: { value: number } } } | undefined;
    if (s) s.uniforms.uTime.value = clock.elapsedTime;
  });
  // arena door on the ring at 0°: local +z faces the fountain; poles stand 3 m in front of the facade
  return <mesh geometry={geo} material={mat} position={[x + 0.06, y, z]} castShadow={tier !== "lite"} />;
}

export function PlazaLife({ tier }: { tier: Tier }) {
  return (
    <group>
      {POLES.map((x, i) => (
        <Flag key={x} x={x} color={FLAG_COLORS[i]!} phase={i * 1.7} tier={tier} />
      ))}
      <AdminFlags tier={tier} />
      <Soundscape />
    </group>
  );
}

/** Rwanda's flag (blue, yellow, green; the golden sun in the fly-side top corner), painted once. */
let rwanda: THREE.CanvasTexture | null = null;
function rwandaFlag() {
  if (rwanda) return rwanda;
  const c = document.createElement("canvas");
  c.width = 192;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#00A1DE";
  g.fillRect(0, 0, 192, 64);
  g.fillStyle = "#FAD201";
  g.fillRect(0, 64, 192, 32);
  g.fillStyle = "#20603D";
  g.fillRect(0, 96, 192, 32);
  g.fillStyle = "#E5BE01";
  const cx = 160;
  const cy = 26;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a - 0.09) * 10, cy + Math.sin(a - 0.09) * 10);
    g.lineTo(cx + Math.cos(a) * 18, cy + Math.sin(a) * 18);
    g.lineTo(cx + Math.cos(a + 0.09) * 10, cy + Math.sin(a + 0.09) * 10);
    g.fill();
  }
  g.beginPath();
  g.arc(cx, cy, 9, 0, Math.PI * 2);
  g.fill();
  rwanda = new THREE.CanvasTexture(c);
  rwanda.colorSpace = THREE.SRGBColorSpace;
  return rwanda;
}

/** The Administrative Block's three flags (Rwanda in the middle, the compound's gold either side). */
function AdminFlags({ tier }: { tier: Tier }) {
  const p = PORTALS.find((q) => q.id === "admin");
  const map = useMemo(() => (typeof document === "undefined" ? undefined : rwandaFlag()), []);
  if (!p) return null;
  const d = ringPoint(p.angleDeg, DOOR_RING);
  return (
    <group position={[d.x, 0, d.z]} rotation={[0, d.rotY, 0]}>
      {ADMIN_FLAGPOLES.map((x, i) => (
        <Flag key={x} x={x} y={8.3} z={ADMIN_FLAG_Z} color={i === 1 ? "#ffffff" : "#C9A96B"} map={i === 1 ? map : undefined} phase={i * 1.3 + 0.4} tier={tier} />
      ))}
    </group>
  );
}

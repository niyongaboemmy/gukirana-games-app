"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { selfPose } from "@/lib/world-store";
import { uiAudio } from "@/lib/audio";
import { DOOR_RING } from "./layout";
import type { Tier } from "./materials";

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

type Bed = { master: GainNode; fountain: GainNode; wind: GainNode; windFilter: BiquadFilterNode };
let bed: Bed | null = null;

function ensureBed(): Bed | null {
  if (bed) return bed;
  const ctx = uiAudio();
  if (!ctx) return null;
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  // fountain: broadband splash noise, band-limited like falling water
  const fSrc = ctx.createBufferSource();
  fSrc.buffer = noiseBuffer(ctx, 3, 11);
  fSrc.loop = true;
  const fHp = ctx.createBiquadFilter();
  fHp.type = "highpass";
  fHp.frequency.value = 500;
  const fLp = ctx.createBiquadFilter();
  fLp.type = "lowpass";
  fLp.frequency.value = 5200;
  const fountain = ctx.createGain();
  fountain.gain.value = 0;
  fSrc.connect(fHp).connect(fLp).connect(fountain).connect(master);
  fSrc.start();

  // highland breeze: low rumble whose brightness drifts slowly
  const wSrc = ctx.createBufferSource();
  wSrc.buffer = noiseBuffer(ctx, 4, 29);
  wSrc.loop = true;
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = "lowpass";
  windFilter.frequency.value = 380;
  windFilter.Q.value = 0.6;
  const wind = ctx.createGain();
  wind.gain.value = 0.05;
  wSrc.connect(windFilter).connect(wind).connect(master);
  wSrc.start();

  master.gain.setTargetAtTime(1, ctx.currentTime, 1.5); // fade in gently
  bed = { master, fountain, wind, windFilter };
  return bed;
}

/** One short bird call: a few quick falling chirps (a sunbird-like twitter), far away and quiet. */
function birdCall(rnd: () => number) {
  const ctx = uiAudio();
  if (!ctx || !bed) return;
  const t0 = ctx.currentTime + 0.05;
  const notes = 2 + Math.floor(rnd() * 4);
  const base = 2600 + rnd() * 1800;
  const pan = ctx.createStereoPanner();
  pan.pan.value = rnd() * 1.6 - 0.8;
  pan.connect(bed.master);
  for (let i = 0; i < notes; i++) {
    const t = t0 + i * (0.09 + rnd() * 0.05);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(base * (1.15 - i * 0.04), t);
    o.frequency.exponentialRampToValueAtTime(base * 0.78, t + 0.07);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.018, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g).connect(pan);
    o.start(t);
    o.stop(t + 0.1);
  }
}

/** A plaza sensor door sliding open/closed, attenuated by distance from the listener. */
export function plazaDoorSound(x: number, z: number, opening: boolean) {
  const ctx = uiAudio();
  if (!ctx) return;
  const dist = Math.hypot(selfPose.x - x, selfPose.z - z);
  const vol = 0.06 / (1 + dist * 0.35);
  if (vol < 0.004) return;
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

/** Drives the soundscape from the listener's position: fountain loud near the basin, breeze always, birds now and then. */
function Soundscape() {
  const rnd = useMemo(() => lcg(77), []);
  const nextBird = useRef(0);
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
    const b = ensureBed();
    const ctx = uiAudio();
    if (!b || !ctx) return;
    const t = clock.elapsedTime;
    const d = Math.hypot(selfPose.x, selfPose.z); // fountain at the plaza centre
    b.fountain.gain.setTargetAtTime(0.11 / (1 + Math.max(0, d - 3) * 0.28), ctx.currentTime, 0.25);
    // gusts: two slow sines → loudness and brightness drift
    const gust = 0.5 + 0.3 * Math.sin(t * 0.21) + 0.2 * Math.sin(t * 0.53 + 1.3);
    b.wind.gain.setTargetAtTime(0.03 + gust * 0.04, ctx.currentTime, 0.8);
    b.windFilter.frequency.setTargetAtTime(260 + gust * 320, ctx.currentTime, 0.8);
    if (t > nextBird.current) {
      if (nextBird.current > 0) birdCall(rnd);
      nextBird.current = t + 6 + rnd() * 14;
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
function Flag({ x, color, phase, tier }: { x: number; color: string; phase: number; tier: Tier }) {
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide });
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
  }, [color, phase]);
  const geo = useMemo(() => new THREE.PlaneGeometry(FLAG_W, FLAG_H, tier === "lite" ? 8 : 20, tier === "lite" ? 3 : 6).translate(FLAG_W / 2, 0, 0), [tier]);
  useFrame(({ clock }) => {
    const s = mat.userData.shader as { uniforms: { uTime: { value: number } } } | undefined;
    if (s) s.uniforms.uTime.value = clock.elapsedTime;
  });
  // arena door on the ring at 0°: local +z faces the fountain; poles stand 3 m in front of the facade
  return <mesh geometry={geo} material={mat} position={[x + 0.06, 10.3, -DOOR_RING + 3]} castShadow={tier !== "lite"} />;
}

export function PlazaLife({ tier }: { tier: Tier }) {
  return (
    <group>
      {POLES.map((x, i) => (
        <Flag key={x} x={x} color={FLAG_COLORS[i]!} phase={i * 1.7} tier={tier} />
      ))}
      <Soundscape />
    </group>
  );
}

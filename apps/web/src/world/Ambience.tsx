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
  // soft, rounded water: no harsh hiss (cut the highs, keep a gentle mid "babble")
  const fHp = ctx.createBiquadFilter();
  fHp.type = "highpass";
  fHp.frequency.value = 280;
  const fLp = ctx.createBiquadFilter();
  fLp.type = "lowpass";
  fLp.frequency.value = 1500;
  fLp.Q.value = 0.4;
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

/** One water droplet landing in the basin: a soft rounded "plip" (pitch drops as the bubble closes). */
function droplet(rnd: () => number, level: number) {
  const ctx = uiAudio();
  if (!ctx || !bed || level < 0.002) return;
  const t = ctx.currentTime + 0.01;
  const f0 = 700 + rnd() * 900;
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f0 * (1.6 + rnd() * 0.5), t + 0.045); // rising "plip" of a small drop
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level * (0.5 + rnd() * 0.5), t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09 + rnd() * 0.05);
  const pan = ctx.createStereoPanner();
  pan.pan.value = rnd() * 1.2 - 0.6;
  o.connect(g).connect(pan).connect(bed.master);
  o.start(t);
  o.stop(t + 0.16);
}

/** A plaza sensor door sliding open/closed, attenuated by distance from the listener. */
export function plazaDoorSound(x: number, z: number, opening: boolean) {
  const ctx = uiAudio();
  if (!ctx || !isOnScreen("outdoor")) return; // the plaza is kept warm while you are in a hall: silent there
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
  const nextDrop = useRef(0);
  const area = useArea();
  const muted = useRef(false);
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
    // the plaza stays mounted (warm) while you are in a hall: its soundscape fades out there and back in on return
    const here = isOnScreen(area);
    if (here === muted.current) {
      muted.current = !here;
      b.master.gain.setTargetAtTime(here ? 1 : 0, ctx.currentTime, here ? 0.6 : 0.3);
    }
    if (!here) return;
    const d = Math.hypot(selfPose.x, selfPose.z); // fountain at the plaza centre
    // near the basin it is a calm murmur (not a roar); it fades out within ~20 m
    const near = 1 / (1 + Math.max(0, d - 3) * 0.45);
    b.fountain.gain.setTargetAtTime(0.022 * near, ctx.currentTime, 0.4);
    // a few soft droplets per second close by, fewer and fainter further away
    if (near > 0.15 && t > nextDrop.current) {
      droplet(rnd, 0.012 * near);
      nextDrop.current = t + 0.12 + rnd() * (0.5 / near);
    }
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

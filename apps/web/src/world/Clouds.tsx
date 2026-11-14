"use client";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Tier } from "./materials";
import { rng } from "./textures";
import { StaticMerge } from "./static-merge";

/**
 * Daytime clouds (P1-WLD-03): soft cumulus banks billowing over the Virunga volcanoes (they build up over the peaks
 * every morning) and a few fair-weather clouds elsewhere, 900–1,500 m out. Billboard planes facing the plaza with
 * a procedural, sun-lit cumulus texture: a handful of draw calls, no per-frame work. Lite gets fewer.
 */
interface CloudDef {
  az: number;
  dist: number;
  y: number;
  w: number;
  h: number;
  seed: number;
  o: number;
}

/** Cumulus puff texture: flat-ish shaded base, bright sunlit tops, soft alpha edges. */
function cumulusTexture(seed: number): THREE.CanvasTexture {
  const W = 256;
  const H = 128;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const r = rng(seed);
  const puffs: [number, number, number][] = [];
  for (let i = 0; i < 26; i++) {
    const x = 30 + r() * (W - 60);
    const t = 1 - Math.abs(x - W / 2) / (W / 2); // taller in the middle
    const rad = 14 + r() * 26 * (0.5 + t);
    const y = H - 26 - r() * 40 * t - rad * 0.3;
    puffs.push([x, y, rad]);
  }
  // shadowed body first, then the sunlit caps offset up-left
  for (const [pass, col, dy] of [
    [0, "170,182,198", 0],
    [1, "255,255,255", -5],
  ] as const) {
    for (const [x, y, rad] of puffs) {
      const gr = g.createRadialGradient(x - pass * 3, y + dy, 0, x - pass * 3, y + dy, rad);
      gr.addColorStop(0, `rgba(${col},${pass ? 0.75 : 0.9})`);
      gr.addColorStop(0.6, `rgba(${col},${pass ? 0.35 : 0.6})`);
      gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x - pass * 3, y + dy, rad, 0, Math.PI * 2);
      g.fill();
    }
  }
  // flatten the base (cumulus have flat bottoms at the condensation level)
  g.globalCompositeOperation = "destination-out";
  const base = g.createLinearGradient(0, H - 30, 0, H - 14);
  base.addColorStop(0, "rgba(0,0,0,0)");
  base.addColorStop(1, "rgba(0,0,0,1)");
  g.fillStyle = base;
  g.fillRect(0, H - 30, W, 30);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function Clouds({ tier }: { tier: Tier }) {
  const defs = useMemo<CloudDef[]>(() => {
    const r = rng(73);
    const list: CloudDef[] = [];
    // banks over the volcano azimuths (north-west … north-east)
    for (const az of [-48, -30, -8, 14, 30])
      list.push({
        az: az + (r() - 0.5) * 6,
        dist: 1250 + r() * 250,
        y: 300 + r() * 120,
        w: 420 + r() * 260,
        h: 150 + r() * 70,
        seed: 100 + list.length,
        o: 0.6,
      });
    // fair-weather clouds around the rest of the sky
    for (const az of [60, 95, 140, 175, 215, 250, 290])
      list.push({
        az: az + (r() - 0.5) * 10,
        dist: 900 + r() * 500,
        y: 170 + r() * 160,
        w: 260 + r() * 200,
        h: 90 + r() * 50,
        seed: 200 + list.length,
        o: 0.55,
      });
    return tier === "lite" ? list.filter((_, i) => i % 2 === 0) : list;
  }, [tier]);
  const mats = useMemo(
    () =>
      [0, 1, 2].map(
        (k) =>
          new THREE.MeshBasicMaterial({
            map: cumulusTexture(500 + k),
            transparent: true,
            depthWrite: false,
            fog: false,
            toneMapped: false,
            color: "#f4f6f8",
            opacity: 0.62,
          }),
      ),
    [],
  );
  useEffect(
    () => () =>
      mats.forEach((m) => {
        m.map?.dispose();
        m.dispose();
      }),
    [mats],
  );
  // (static billboards sharing three materials: batched into three draw calls)
  return (
    <StaticMerge>
      {defs.map((d, i) => {
        const a = (d.az * Math.PI) / 180;
        const x = Math.sin(a) * d.dist;
        const z = -Math.cos(a) * d.dist;
        const m = mats[d.seed % 3]!;
        return (
          <mesh
            key={i}
            position={[x, d.y, z]}
            rotation={[0, Math.atan2(-x, -z), 0]}
            material={m}
            renderOrder={-2}
          >
            <planeGeometry args={[d.w, d.h]} />
          </mesh>
        );
      })}
    </StaticMerge>
  );
}

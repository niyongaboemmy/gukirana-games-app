"use client";
import { useEffect, useMemo } from "react";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { GeoBatch } from "./geo";
import { worldMaterials, type Tier } from "./materials";
import { campusMaterials } from "./campus-materials";
import { NearOnly } from "./static-merge";
import { SITE } from "./campus-strings";
import { sitePlan } from "./footprints";
import { FIGHT_BUILDING } from "@/fight/plan";
import { EXPANSION_PLOTS, EXPANSION_RING, PORTALS, ringPoint } from "./layout";
import {
  CAMPUS_LOOP,
  DISTRICT_WALKS,
  FORECOURT,
  LOOP,
  LOOP_ARC_DEG,
  PARKING,
  SERVICE_GATE,
  serviceSpur,
  WALK_TOTEMS,
  type P,
} from "./campus";

/**
 * The campus loop road and the district walks (P2-WLD-12, docs/CAMPUS-MASTER-PLAN.md §3.3): the 6 m service and
 * shuttle loop with its kerbs, footpaths, lane markings and service spurs to the halls' yards; the paved walks from
 * the plaza between the inner halls to the outer promenade; wayfinding totems at every junction. Static primitives
 * under the outdoor StaticMerge (they fold into the world's and the road looks), totem lettering as Text up close.
 */

const FONT = "/fonts/Baloo2.ttf";
const FLAT = new Set(["asphaltC", "paintW", "granite", "basalt"]);

/** Offset polyline (lateral offset `o`, + = left of the direction of travel) with mitred joints. */
function offset(pts: P[], o: number): P[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    return { x: p.x - (tz / l) * o, z: p.z + (tx / l) * o };
  });
}

/** A flat ribbon between lateral offsets o0 and o1 along a polyline, world-metre UVs (GeoBatch tile). */
function ribbon(b: GeoBatch, key: string, pts: P[], o0: number, o1: number, y: number, tile: number) {
  if (pts.length < 2) return;
  const A = offset(pts, o0);
  const B = offset(pts, o1);
  const pos: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a0 = A[i]!;
    const a1 = A[i + 1]!;
    const b0 = B[i]!;
    const b1 = B[i + 1]!;
    pos.push(a0.x, y, a0.z, b0.x, y, b0.z, b1.x, y, b1.z, a0.x, y, a0.z, b1.x, y, b1.z, a1.x, y, a1.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  g.computeVertexNormals();
  // up-facing (the winding depends on the offset order)
  if (g.getAttribute("normal").getY(0) < 0) {
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i += 3) {
      const x = p.getX(i + 1);
      const yy = p.getY(i + 1);
      const z = p.getZ(i + 1);
      p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
      p.setXYZ(i + 2, x, yy, z);
    }
    g.computeVertexNormals();
  }
  b.add(key, g, { tile });
}
/** A vertical kerb face along a polyline at lateral offset o, from y0 to y1. */
function curtain(b: GeoBatch, key: string, pts: P[], o: number, y0: number, y1: number) {
  const A = offset(pts, o);
  const pos: number[] = [];
  for (let i = 0; i < A.length - 1; i++) {
    const p = A[i]!;
    const q = A[i + 1]!;
    pos.push(p.x, y0, p.z, q.x, y0, q.z, q.x, y1, q.z, p.x, y0, p.z, q.x, y1, q.z, p.x, y1, p.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  g.computeVertexNormals();
  b.add(key, new THREE.BufferGeometry().copy(g), { tile: 2 });
  // both faces (the kerb is seen from the road and from the path)
  const back = g.clone();
  const p = back.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 3) {
    const x = p.getX(i + 1);
    const yy = p.getY(i + 1);
    const z = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, x, yy, z);
  }
  back.computeVertexNormals();
  b.add(key, back, { tile: 2 });
}

/** Sub-polylines of `pts` between arc-length s0 and s1. */
function slice(pts: P[], cum: number[], s0: number, s1: number): P[] {
  const out: P[] = [];
  const at = (s: number) => {
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1]! < s) i++;
    const t = (s - cum[i]!) / Math.max(1e-6, cum[i + 1]! - cum[i]!);
    return { x: pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * t, z: pts[i]!.z + (pts[i + 1]!.z - pts[i]!.z) * t };
  };
  out.push(at(s0));
  for (let i = 0; i < pts.length; i++) if (cum[i]! > s0 && cum[i]! < s1) out.push(pts[i]!);
  out.push(at(s1));
  return out;
}

/** Runs of consecutive points that pass `keep` (each run ≥ 2 points). */
function runs(pts: P[], keep: (p: P) => boolean): P[][] {
  const out: P[][] = [];
  let cur: P[] = [];
  for (const p of pts) {
    if (keep(p)) cur.push(p);
    else {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** The plots served by a spur from the loop arc: their bearing and the radius of the building's back wall. */
function servedPlots(): { deg: number; back: number }[] {
  const out = EXPANSION_PLOTS.map((e) => ({ deg: e.angleDeg, back: EXPANSION_RING - sitePlan(0).z1 + 0.2 }));
  for (const p of PORTALS.filter((q) => q.kind === "fight")) out.push({ deg: p.angleDeg, back: EXPANSION_RING - FIGHT_BUILDING.back + 0.2 });
  return out.filter((q) => Math.abs(q.deg) < LOOP_ARC_DEG - 4);
}

export function buildCampusRoads(): Map<string, THREE.BufferGeometry> {
  const b = new GeoBatch();
  const pts = CAMPUS_LOOP;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
  const total = cum[cum.length - 1]!;
  const H = LOOP.hw;

  /* ---------- the loop: carriageway, markings, kerbs, footpaths ---------- */
  ribbon(b, "asphaltC", pts, -H, H, 0.012, 4);
  for (let s = 4; s < total - 6; s += 9) ribbon(b, "paintW", slice(pts, cum, s, s + 3), -0.06, 0.06, 0.02, 4);
  const inParking = (p: P) => Math.abs(p.x) > PARKING.x0 - 0.5 && Math.abs(p.x) < PARKING.x1 + 0.5 && p.z > LOOP.southZ - 1;
  const onLinks = (p: P) => p.z > LOOP.southZ + 1 && Math.abs(p.x) < FORECOURT.openingHw + 8;
  const spurs = servedPlots();
  const atSpur = (p: P) => {
    const deg = (Math.atan2(p.x, -p.z) * 180) / Math.PI;
    return spurs.some((q) => Math.abs(deg - q.deg) * (Math.PI / 180) * LOOP.r < 4.2);
  };
  const atService = (p: P) => Math.abs(Math.abs(p.x) - SERVICE_GATE.x) < SERVICE_GATE.hw + 0.6 && p.x > 0 && p.z > LOOP.southZ;
  // edge lines (not along the car parks, where the bays open onto the road)
  for (const side of [-1, 1]) for (const run of runs(pts, (p) => !inParking(p) && !onLinks(p) && !(side > 0 && atSpur(p)) && !(side < 0 && atService(p)))) ribbon(b, "paintW", run, side * (H - 0.3), side * (H - 0.4), 0.02, 4);
  // raised footpaths with kerbs both sides (+ = inner side)
  const F = LOOP.foot;
  for (const side of [-1, 1])
    for (const run of runs(pts, (p) => !inParking(p) && !onLinks(p) && !(side > 0 && atSpur(p)) && !(side < 0 && atService(p)))) {
      ribbon(b, "granite", run, side * (H + 0.15), side * (H + F), 0.12, 2.4);
      ribbon(b, "concrete", run, side * H, side * (H + 0.15), 0.14, 2);
      curtain(b, "concrete", run, side * H, 0, 0.14);
    }
  // gully grates along the kerbs, manholes on the crown
  for (let s = 12; s < total; s += 30) {
    const p = slice(pts, cum, s, s + 0.8);
    ribbon(b, "steel", p, H - 0.6, H - 0.2, 0.021, 1);
    if (Math.floor(s / 30) % 3 === 0) ribbon(b, "steel", slice(pts, cum, s + 9, s + 9.7), -1.6, -0.9, 0.021, 1);
  }

  /* ---------- service spurs to the halls' yards ---------- */
  for (const q of spurs) {
    const sp = serviceSpur(q.deg, q.back);
    const m = ringPoint(q.deg, (sp.r0 + sp.r1) / 2);
    b.box("asphaltC", sp.hw * 2, 0.02, sp.r1 - sp.r0, { p: [m.x, 0.01, m.z], r: [0, m.rotY, 0], tile: 4 });
    const y = ringPoint(q.deg, (sp.r0 + sp.yardR1) / 2);
    b.box("concrete", sp.yardHw * 2, 0.05, sp.yardR1 - sp.r0, { p: [y.x, 0.015, y.z], r: [0, y.rotY, 0], tile: 2 });
    // bollards marking the yard, a "no entry" bar at the loop
    for (const s of [-1, 1]) {
      const k = ringPoint(q.deg, sp.yardR1 + 0.3);
      const a = (q.deg * Math.PI) / 180;
      b.cyl("steel", 0.08, 0.1, 0.9, 8, { p: [k.x + Math.cos(a) * s * sp.yardHw, 0.45, k.z + Math.sin(a) * s * sp.yardHw] });
    }
  }

  /* ---------- district walks: honed granite between basalt kerbs ---------- */
  for (const w of DISTRICT_WALKS) {
    for (let i = 0; i < w.pts.length - 1; i++) {
      const a = w.pts[i]!;
      const c = w.pts[i + 1]!;
      const len = Math.hypot(c.x - a.x, c.z - a.z) + w.hw;
      const rot = Math.atan2(c.x - a.x, c.z - a.z);
      const m: [number, number, number] = [(a.x + c.x) / 2, 0.011, (a.z + c.z) / 2];
      b.box("granite", w.hw * 2, 0.02, len, { p: m, r: [0, rot, 0], tile: 4.8 });
      for (const s of [-1, 1]) {
        const ox = Math.cos(rot) * s * (w.hw + 0.1);
        const oz = -Math.sin(rot) * s * (w.hw + 0.1);
        b.box("basalt", 0.2, 0.05, len - w.hw, { p: [m[0] + ox, 0.02, m[2] + oz], r: [0, rot, 0], tile: 1.2 });
      }
    }
    // a round paved node at every bend (the legs meet cleanly)
    for (const p of w.pts.slice(1, -1)) b.add("granite", new THREE.CircleGeometry(w.hw + 0.1, 20).rotateX(-Math.PI / 2), { p: [p.x, 0.013, p.z], tile: 4.8 });
  }

  /* ---------- wayfinding totems (lettering: Text, CampusRoads below) ---------- */
  for (const t of WALK_TOTEMS)
    b.frame([t.x, 0, t.z], t.rotY, () => {
      b.box("aluBrushed", 1.0, 2.4, 0.16, { p: [0, 1.4, 0] });
      b.box("lava", 0.7, 0.2, 0.4, { p: [0, 0.1, 0], tile: 1.2 });
      b.box("screenFrame", 0.9, 1.9, 0.172, { p: [0, 1.45, 0] });
      b.box("led-warm", 0.92, 0.02, 0.17, { p: [0, 2.58, 0] });
    });
  return b.build();
}

const SITE_NAME = (id: string) => {
  const p = PORTALS.find((q) => q.id === id);
  if (p) return p.label;
  const e = EXPANSION_PLOTS.find((q) => q.id === id);
  return e ? SITE.plot(e.n) : id;
};

export function CampusRoads({ tier }: { tier: Tier }) {
  const geos = useMemo(() => buildCampusRoads(), []);
  const mats = useMemo(() => ({ ...worldMaterials(tier), ...campusMaterials(tier) }), [tier]);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  const signs = useMemo(
    () =>
      WALK_TOTEMS.map((t) => ({
        t,
        head: t.district === "plaza" ? SITE.plaza : SITE.district[t.district],
        rows: t.rows.map((r) => `${SITE_NAME(r.id)}\n${SITE.walk(r.m, r.s)}`).join("\n"),
      })),
    [],
  );
  return (
    <group name="campus-roads">
      {[...geos.entries()].map(([key, g]) => {
        const m = mats[key];
        if (!m) return null;
        const unlit = m instanceof THREE.MeshBasicMaterial;
        return <mesh key={key} geometry={g} material={m} castShadow={!unlit && !m.transparent && !FLAT.has(key) && tier !== "lite"} receiveShadow={!unlit && tier !== "lite"} />;
      })}
      {signs.map(({ t, head, rows }, i) => (
        <NearOnly key={i} max={18} position={[t.x, 0, t.z]} rotation={[0, t.rotY, 0]}>
          {[0, Math.PI].map((face) => (
            <group key={face} rotation={[0, face, 0]}>
              <Text font={FONT} fontSize={0.11} position={[0, 2.26, 0.092]} anchorX="center" anchorY="middle" color="#ffd9a0" maxWidth={0.82} textAlign="center">
                {head}
              </Text>
              <Text font={FONT} fontSize={0.085} lineHeight={1.3} position={[0, 1.45, 0.092]} anchorX="center" anchorY="middle" color="#eef0f3" maxWidth={0.82} textAlign="center">
                {rows}
              </Text>
            </group>
          ))}
        </NearOnly>
      ))}
    </group>
  );
}

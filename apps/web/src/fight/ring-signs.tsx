"use client";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { RingStatus } from "@gukirana/contracts";
import { useFightBridge } from "./bridge";
import { useFightUi } from "./ui-store";
import { STATUS_LAMP } from "./assets-shim";
import { RINGS, type RingPlace } from "./plan";
import { useRingStatuses } from "./rings";
import { F } from "./strings";

/**
 * Ring number signs (P3-FGT-03): ONE sign per ring, hung over its centre, always turned to the viewer (a camera-facing
 * billboard in the vertex shader), so it reads the same from every aisle and never doubles up like a four-sided box.
 * The look follows the feature-ring screens: a near-black glass panel, the number large in white, "RING" small above,
 * and the status as a coloured pill WITH its word (colour is never the only signal). All 50 signs are one merged quad
 * batch on one canvas atlas (one draw call); a cell is redrawn only when its ring's status changes.
 *
 * Stability (P3-FGT-04): the signs turn with the VIEW (all parallel to the screen, upright), not towards the camera
 * position: a position-facing billboard spun half a turn whenever the camera passed under or beside a sign (the fight
 * and watch cameras orbit close to their ring) and signs near the edges of the view fanned out at odd angles. The sign
 * over the ring you fight in, or watch with a ring camera, is folded away (it hung right in that camera's view).
 */

const COLS = 8;
const CELL_W = 256;
const CELL_H = 128;
const ROWS = Math.ceil(RINGS.length / COLS);
const RING_INDEX: Record<string, number> = Object.fromEntries(RINGS.map((r, i) => [r.id, i]));
/** world size of a sign (m) */
const SIGN = { std: [1.5, 0.75], feature: [2.3, 1.15] } as const;
/** sign heights: over the heads of people on the canvas, under the ring light panels */
export const signY = (r: RingPlace) => (r.feature ? r.canvasY + 3.7 : 4.25);

/** pill colours: the status lamp, with readable ink */
const PILL_INK: Partial<Record<RingStatus, string>> = { practice: "#141416", waiting: "#141416" };
const pillFill = (s: RingStatus) => (s === "closed" ? "#4a4a4f" : STATUS_LAMP[s]);

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** one sign face into its atlas cell */
export function drawSignCell(g: CanvasRenderingContext2D, i: number, number: string, status: RingStatus) {
  const x0 = (i % COLS) * CELL_W;
  const y0 = Math.floor(i / COLS) * CELL_H;
  g.clearRect(x0, y0, CELL_W, CELL_H);
  // the glass panel (opaque inside, rounded: the alpha test cuts the corners)
  roundRect(g, x0 + 4, y0 + 4, CELL_W - 8, CELL_H - 8, 18);
  g.fillStyle = "#121214";
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = "rgba(255,255,255,0.16)";
  g.stroke();
  // the status colour as a thin light line along the bottom edge
  g.fillStyle = pillFill(status);
  g.fillRect(x0 + 22, y0 + CELL_H - 13, CELL_W - 44, 4);
  // number
  g.fillStyle = "#ffffff";
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.font = "800 78px sans-serif";
  g.fillText(number, x0 + 20, y0 + 96);
  // "RING" over the pill
  g.textAlign = "right";
  g.font = "700 20px sans-serif";
  g.fillStyle = "rgba(255,255,255,0.6)";
  g.fillText(F.ringWord.toUpperCase(), x0 + CELL_W - 22, y0 + 40);
  // the status pill with its word
  const word = F.status[status].toUpperCase();
  g.font = "800 22px sans-serif";
  const tw = g.measureText(word).width;
  const pw = Math.min(CELL_W * 0.6, tw + 26);
  const px = x0 + CELL_W - 20 - pw;
  roundRect(g, px, y0 + 56, pw, 36, 18);
  g.fillStyle = pillFill(status);
  g.fill();
  g.fillStyle = PILL_INK[status] ?? "#ffffff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(word, px + pw / 2, y0 + 75);
}

export function RingSigns() {
  const statuses = useRingStatuses();
  const drawn = useRef<(RingStatus | null)[]>(RINGS.map(() => null));
  const parts = useMemo(() => {
    const cv = document.createElement("canvas");
    cv.width = COLS * CELL_W;
    cv.height = THREE.MathUtils.ceilPowerOfTwo(ROWS * CELL_H);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    // the quads: corner offsets in `position` (x, y in the sign plane), the sign centre in `aCenter`
    const n = RINGS.length;
    const pos = new Float32Array(n * 4 * 3);
    const ctr = new Float32Array(n * 4 * 3);
    const uv = new Float32Array(n * 4 * 2);
    const ring = new Float32Array(n * 4);
    const idx: number[] = [];
    RINGS.forEach((r, i) => {
      const [w, h] = r.feature ? SIGN.feature : SIGN.std;
      const u0 = ((i % COLS) * CELL_W) / cv.width;
      const u1 = u0 + CELL_W / cv.width;
      const v1 = 1 - (Math.floor(i / COLS) * CELL_H) / cv.height;
      const v0 = v1 - CELL_H / cv.height;
      const corners = [
        [-w / 2, -h / 2, u0, v0],
        [w / 2, -h / 2, u1, v0],
        [w / 2, h / 2, u1, v1],
        [-w / 2, h / 2, u0, v1],
      ];
      corners.forEach(([x, y, u, v], k) => {
        pos.set([x!, y!, 0], (i * 4 + k) * 3);
        ctr.set([r.x, signY(r), r.z], (i * 4 + k) * 3);
        uv.set([u!, v!], (i * 4 + k) * 2);
        ring[i * 4 + k] = i;
      });
      const b = i * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aCenter", new THREE.BufferAttribute(ctr, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setAttribute("aRing", new THREE.BufferAttribute(ring, 1));
    geo.setIndex(idx);
    // the rounded corners: alpha-to-coverage (MSAA-smoothed edges) instead of a hard 0.5 alpha test, whose stair-stepped
    // corners crawled and sparkled on every sign as the camera moved (P3-FGT-12); without MSAA it behaves as before
    const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.02, alphaToCoverage: true, toneMapped: false, side: THREE.DoubleSide });
    mat.customProgramCacheKey = () => "gk-ring-sign";
    const hide = { value: -1 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uHide = hide;
      // an upright, view-aligned billboard: every panel lies parallel to the screen (the camera's right vector flattened
      // onto the floor plane), so no sign ever spins or flips as the camera moves round it
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec3 aCenter;\nattribute float aRing;\nuniform float uHide;").replace(
        "#include <project_vertex>",
        `vec3 right = vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]);
right = length(right) > 1e-4 ? normalize(right) : vec3(1.0, 0.0, 0.0);
float keep = abs(aRing - uHide) < 0.5 ? 0.0 : 1.0;
vec3 wp = aCenter + (right * transformed.x + vec3(0.0, transformed.y, 0.0)) * keep;
vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
gl_Position = projectionMatrix * mvPosition;`,
      );
    };
    return { cv, tex, geo, mat, hide, g: cv.getContext("2d")! };
  }, []);
  useFrame(() => {
    const b = useFightBridge.getState();
    const id = b.mine?.ring ?? (useFightUi.getState().watchCam ? b.watched?.ring : null) ?? null;
    parts.hide.value = id ? (RING_INDEX[id] ?? -1) : -1;
  });
  useLayoutEffect(() => {
    let changed = false;
    RINGS.forEach((r, i) => {
      const st = statuses[i] ?? "free";
      if (drawn.current[i] === st) return;
      drawn.current[i] = st;
      drawSignCell(parts.g, i, r.id.slice(1), st);
      changed = true;
    });
    if (changed) parts.tex.needsUpdate = true;
  }, [statuses, parts]);
  useEffect(() => () => (parts.tex.dispose(), parts.geo.dispose(), parts.mat.dispose()), [parts]);
  return <mesh geometry={parts.geo} material={parts.mat} frustumCulled={false} renderOrder={2} userData={{ noMerge: true }} />;
}

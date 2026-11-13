"use client";
import { useEffect, useMemo, useRef } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { tick } from "./sfx";

/**
 * World-space keyboard for VR (and clickable on screens): the whole keyboard is ONE plane with a canvas texture
 * (1 draw call); the pressed key is found from the hit UV. Works with XR controller rays and hand pinch pointers.
 */
type Key = { k: string; label: string; w: number };
const k = (s: string): Key[] => s.split("").map((c) => ({ k: c, label: c, w: 1 }));
const LAYOUTS: Record<"full" | "digits", Key[][]> = {
  full: [
    k("1234567890"),
    k("qwertyuiop"),
    k("asdfghjkl@"),
    k("zxcvbnm._-"),
    [
      { k: "+", label: "+", w: 1 },
      { k: "DEL", label: "DEL", w: 3 },
      { k: "OK", label: "OK", w: 6 },
    ],
  ],
  digits: [k("123"), k("456"), k("789"), [{ k: "DEL", label: "DEL", w: 1 }, { k: "0", label: "0", w: 1 }, { k: "OK", label: "OK", w: 1 }]],
};

const W = 1024;

export function VirtualKeyboard({ mode, onKey, width = 0.8, accent = "#3DA9FC" }: { mode: "full" | "digits"; onKey: (k: string) => void; width?: number; accent?: string }) {
  const rows = LAYOUTS[mode];
  const cols = Math.max(...rows.map((r) => r.reduce((s, x) => s + x.w, 0)));
  const keyPx = W / cols;
  const H = Math.round(rows.length * keyPx * (mode === "digits" ? 0.62 : 1));
  const rowPx = H / rows.length;
  const canvas = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    return c;
  }, [H]);
  const tex = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [canvas]);
  const pressed = useRef<string | null>(null);

  const draw = () => {
    const g = canvas.getContext("2d");
    if (!g) return;
    g.fillStyle = "#121314";
    g.fillRect(0, 0, W, H);
    rows.forEach((row, ri) => {
      const rowW = row.reduce((s, x) => s + x.w, 0) * keyPx;
      let x = (W - rowW) / 2;
      for (const key of row) {
        const w = key.w * keyPx;
        const on = pressed.current === key.k;
        g.fillStyle = on ? accent : key.k === "OK" ? "#2F80ED" : key.k === "DEL" ? "#2F3136" : "#1E1F23";
        g.beginPath();
        g.roundRect(x + 6, ri * rowPx + 6, w - 12, rowPx - 12, 18);
        g.fill();
        g.fillStyle = "#ffffff";
        g.font = `700 ${Math.round(rowPx * (key.label.length > 1 ? 0.34 : 0.46))}px system-ui, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(key.label, x + w / 2, ri * rowPx + rowPx / 2 + 2);
        x += w;
      }
    });
    tex.needsUpdate = true;
  };
  useEffect(draw);
  useEffect(() => () => tex.dispose(), [tex]);

  const hit = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const uv = e.uv;
    if (!uv) return;
    const px = uv.x * W;
    const ri = Math.min(rows.length - 1, Math.floor((1 - uv.y) * rows.length));
    const row = rows[ri];
    if (!row) return;
    const rowW = row.reduce((s, x) => s + x.w, 0) * keyPx;
    let x = (W - rowW) / 2;
    for (const key of row) {
      const w = key.w * keyPx;
      if (px >= x && px < x + w) {
        pressed.current = key.k;
        draw();
        tick();
        onKey(key.k);
        setTimeout(() => {
          pressed.current = null;
          draw();
        }, 140);
        return;
      }
      x += w;
    }
  };

  return (
    <mesh onClick={hit}>
      <planeGeometry args={[width, (width * H) / W]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  );
}

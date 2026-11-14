"use client";
import { useId } from "react";
/**
 * Stylised hands for the board games (SVG, no textures): a fist that rattles and throws the Ludo die, and an
 * open, cupped hand that scoops and sows Igisoro seeds. Skin tones are deterministic per player side.
 */

export const SKIN = { me: { base: "#a86b45", shade: "#7d4a2c", light: "#c98a60" }, opp: { base: "#8a5434", shade: "#5f3820", light: "#ad7048" } } as const;
export type Skin = (typeof SKIN)[keyof typeof SKIN];

/** A closed fist seen from the side, knuckles up (holds the die while it rattles). */
export function Fist({ skin = SKIN.me, className, style }: { skin?: Skin; className?: string; style?: React.CSSProperties }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 64 64" className={className} style={style} aria-hidden>
      <defs>
        <linearGradient id={`f${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={skin.light} />
          <stop offset="1" stopColor={skin.shade} />
        </linearGradient>
      </defs>
      {/* forearm / wrist */}
      <path d="M38 40 L62 52 L58 64 L30 52 Z" fill={skin.shade} />
      <path d="M40 41 L61 51" stroke="rgb(0 0 0 / .18)" strokeWidth="1.5" />
      {/* palm block */}
      <rect x="10" y="18" width="34" height="30" rx="11" fill={`url(#f${id})`} />
      {/* four curled fingers */}
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={11 + i * 8.2} y={13 + (i === 0 || i === 3 ? 2 : 0)} width="8.6" height="16" rx="4.3" fill={skin.base} stroke={skin.shade} strokeWidth="1" />
      ))}
      {/* knuckle creases */}
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M${12.5 + i * 8.2} ${27 + (i === 0 || i === 3 ? 2 : 0)} q3 2 6 0`} stroke={skin.shade} strokeWidth="1.1" fill="none" opacity=".7" />
      ))}
      {/* thumb across the front */}
      <path d="M12 36 C14 30 24 29 33 33 C36 34.5 35 38.5 31.5 38.5 L17 39 C13.5 39 11.2 38.5 12 36 Z" fill={skin.light} stroke={skin.shade} strokeWidth="1" />
      <ellipse cx="31" cy="35.4" rx="2.6" ry="1.6" fill="#e9c3a8" opacity=".75" />
    </svg>
  );
}

/**
 * An open hand seen from above, fingers pointing up (towards the board), cupped around `seeds` seeds.
 * Rotate 180° for the player across the board.
 */
export function SowingHand({ skin = SKIN.me, seeds = 0, className, style }: { skin?: Skin; seeds?: number; className?: string; style?: React.CSSProperties }) {
  const shown = Math.min(seeds, 7);
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 80 100" className={className} style={style} aria-hidden>
      <defs>
        <radialGradient id={`p${id}`} cx="0.5" cy="0.45" r="0.6">
          <stop offset="0" stopColor={skin.light} />
          <stop offset="1" stopColor={skin.base} />
        </radialGradient>
        <radialGradient id={`s${id}`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#f3e3c3" />
          <stop offset="1" stopColor="#7a4c22" />
        </radialGradient>
      </defs>
      {/* soft shadow on the board */}
      <ellipse cx="44" cy="62" rx="30" ry="34" fill="rgb(0 0 0 / .28)" />
      {/* forearm going off the bottom edge */}
      <path d="M24 70 L56 70 L60 100 L20 100 Z" fill={skin.shade} />
      {/* fingers, slightly curled (tips shaded) */}
      {[
        [17, 22, -14],
        [29, 12, -4],
        [42, 11, 4],
        [54, 18, 13],
      ].map(([x, y, r], i) => (
        <g key={i} transform={`rotate(${r} ${x! + 5} ${y! + 22})`}>
          <rect x={x} y={y} width="11" height="30" rx="5.5" fill={skin.base} stroke={skin.shade} strokeWidth="1" />
          <ellipse cx={x! + 5.5} cy={y! + 4} rx="3.6" ry="2.4" fill="#e9c3a8" opacity=".55" />
        </g>
      ))}
      {/* palm, cupped */}
      <path d="M14 42 C14 33 66 33 66 42 L64 66 C62 76 18 76 16 66 Z" fill={`url(#p${id})`} stroke={skin.shade} strokeWidth="1.2" />
      {/* thumb on the left */}
      <path d="M15 56 C6 52 4 42 9 37 C12 34 16 38 18 44 Z" fill={skin.base} stroke={skin.shade} strokeWidth="1" />
      {/* seeds held in the cup */}
      {Array.from({ length: shown }, (_, i) => {
        const a = i * 2.39996; // golden angle: an even, deterministic heap
        const rr = 3 + Math.sqrt(i) * 5.2;
        return <ellipse key={i} cx={40 + Math.cos(a) * rr} cy={52 + Math.sin(a) * rr * 0.7} rx="4.4" ry="3.6" fill={`url(#s${id})`} stroke="rgb(0 0 0 / .35)" strokeWidth=".6" />;
      })}
    </svg>
  );
}

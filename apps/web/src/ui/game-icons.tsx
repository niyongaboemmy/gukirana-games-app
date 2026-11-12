import type { SVGProps } from "react";

/** Game glyphs in the Lucide line style (24px grid, 2px stroke, round caps) — no emoji (design rule). */
type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 24, p: P) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, ...p });

export const PoolBallIcon = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="10" r="3.6" />
    <path d="M12 8.6v2.8" />
  </svg>
);

export const DieIcon = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
    <circle cx="8.5" cy="8.5" r="1" fill="currentColor" />
    <circle cx="15.5" cy="15.5" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </svg>
);

export const SeedsIcon = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <ellipse cx="12" cy="13" rx="9" ry="6" />
    <circle cx="9" cy="12.5" r="1.4" fill="currentColor" />
    <circle cx="13" cy="11.5" r="1.4" fill="currentColor" />
    <circle cx="14.5" cy="14.5" r="1.4" fill="currentColor" />
  </svg>
);

/** Colour-blind-safe Ludo seat shapes (DESIGN-SPEC §5.3): circle, triangle, square, diamond. */
export function SeatShape({ seat, size = 12, className }: { seat: number; size?: number; className?: string }) {
  const props = { width: size, height: size, viewBox: "0 0 12 12", className, fill: "currentColor" };
  if (seat === 1) return <svg {...props}><path d="M6 1.5 11 10.5H1Z" /></svg>;
  if (seat === 2) return <svg {...props}><rect x="2" y="2" width="8" height="8" rx="1" /></svg>;
  if (seat === 3) return <svg {...props}><path d="M6 1 11 6 6 11 1 6Z" /></svg>;
  return <svg {...props}><circle cx="6" cy="6" r="4.5" /></svg>;
}

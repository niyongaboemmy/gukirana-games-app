/**
 * Campus aerial view: zooming out past the follow camera's range keeps going up into the sky until the whole
 * Gukirana campus (plaza, halls, the Fight hall, the ring road and the gate) is in view, with Musanze's volcanoes
 * behind it. Pure numbers (no three.js, no React) so it is unit tested (aerial.test.ts).
 *
 *  - up to FOLLOW_MAX the camera follows you as before (orbit around your head, linear zoom steps);
 *  - beyond it the zoom is multiplicative (each step goes ×ZOOM_FACTOR further), the orbit pivot glides from you to
 *    the campus centre, the camera tilts down towards a bird's-eye view and nothing pulls it in (no spring arm);
 *  - AERIAL_MAX frames the whole campus with its surroundings.
 */

/** The farthest follow distance (m): the old zoom limit. */
export const FOLLOW_MAX = 24;
/** The farthest aerial distance (m): the whole campus (ring road r 165 m) with the valley around it. */
export const AERIAL_MAX = 640;
export const ZOOM_MIN = 2.5;
/** Per wheel notch / button press in the aerial range. */
export const ZOOM_FACTOR = 1.45;
/** Linear step (m) in the follow range (the old button step). */
export const FOLLOW_STEP = 1.5;
/** The campus centre the aerial view orbits (the plaza fountain). */
export const CAMPUS_CENTER = { x: 0, z: 0 } as const;
/** Distance (m) by which the view is fully aerial (pivot on the campus, bird's-eye tilt). */
export const AERIAL_FULL = 110;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** 0 = normal follow camera, 1 = full campus aerial view. */
export const aerialBlend = (distance: number) => smooth(FOLLOW_MAX, AERIAL_FULL, distance);

/** Is the camera out in the aerial range (shows the "back to me" control, labels the buildings)? */
export const isAerial = (distance: number) => distance > FOLLOW_MAX + 0.5;

/**
 * One zoom step: dir > 0 zooms out, dir < 0 zooms in. Linear steps up close, multiplicative in the aerial range, so
 * a few presses go from your shoulder to the whole campus and back. Zooming in from the sky lands on FOLLOW_MAX.
 */
export function stepZoom(distance: number, dir: number): number {
  if (dir > 0) {
    if (distance < FOLLOW_MAX - 0.01) return Math.min(FOLLOW_MAX, distance + FOLLOW_STEP);
    return Math.min(AERIAL_MAX, Math.max(distance, FOLLOW_MAX) * ZOOM_FACTOR);
  }
  if (distance > FOLLOW_MAX + 0.01) {
    const d = distance / ZOOM_FACTOR;
    return d < FOLLOW_MAX + 4 ? FOLLOW_MAX : d;
  }
  return Math.max(ZOOM_MIN, distance - FOLLOW_STEP);
}

/** Wheel / trackpad: linear up close (as before), exponential (constant feel) in the aerial range. */
export function wheelZoom(distance: number, deltaY: number): number {
  if (distance < FOLLOW_MAX || (distance <= FOLLOW_MAX && deltaY < 0)) return clamp(distance + deltaY * 0.006, ZOOM_MIN, FOLLOW_MAX);
  const d = distance * Math.exp(deltaY * 0.0016);
  return d < FOLLOW_MAX ? FOLLOW_MAX : Math.min(AERIAL_MAX, d);
}

/** Pinch: scale the distance by the change in finger spread (spread shrinking = zoom out). */
export function pinchZoom(distance: number, prevSpread: number, spread: number): number {
  if (prevSpread <= 0 || spread <= 0) return distance;
  return clamp(distance * (prevSpread / spread), ZOOM_MIN, AERIAL_MAX);
}

/** Highest drag pitch (rad): the follow camera stops at 63°, the aerial view may look almost straight down. */
export const maxPitch = (distance: number) => 1.1 + 0.32 * aerialBlend(distance);

/** The pitch actually used: in the aerial range it never drops below a bird's-eye minimum (no skimming the grass). */
export const viewPitch = (pitch: number, distance: number) => {
  const k = aerialBlend(distance);
  return pitch + (Math.max(pitch, 0.62) - pitch) * k;
};

/**
 * What the aerial view orbits: the campus centre, or a place picked in Go To's "Show on map" (P2-WLD-13), until
 * "Back to me". Mutable (read every frame by the camera rig).
 */
export const aerialFocus: { x: number; z: number } = { ...CAMPUS_CENTER };
export const resetAerialFocus = () => Object.assign(aerialFocus, CAMPUS_CENTER);

/** Orbit pivot: your head up close, the campus centre (or the Go To focus) in the aerial view (blended in between). */
export function aerialPivot(px: number, pz: number, aimY: number, distance: number, focus: { x: number; z: number } = aerialFocus): { x: number; y: number; z: number } {
  const k = aerialBlend(distance);
  return { x: px + (focus.x - px) * k, y: aimY * (1 - k), z: pz + (focus.z - pz) * k };
}

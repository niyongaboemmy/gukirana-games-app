import * as THREE from "three";
import type { BodyType } from "../outfits";

/**
 * Skull template (P2-AVA-10), generated offline from the Rocketbox heads (tool notes in docs/ASSET-LICENSES.md):
 * the masculine head's outer surface (scalp + ~4 mm of short hair, ears left out) as a radius grid around a skull
 * centre, in the FACE FRAME (metres; origin between the eyes, +x the person's left, +y up, +z forward; the frame of
 * face-rig.ts faceFrameOf in metres instead of eye distances). Each body has a fit (centre + per-axis scale) to its own
 * forehead / temple skin and short back hair, so hair shells, deflated hair, caps and hats sit on that body's skull.
 */
const EL0 = -50;
const EL1 = 90;
const NEL = 15;
const NAZ = 32;
/** template centre (face frame, m) */
export const SKULL_CENTRE: readonly [number, number, number] = [0.0, 0.025, -0.075];
/** radius (0.1 mm) per elevation row (-50° … 90°, 10° steps) and azimuth column (0 = forward, then towards +x) */
const GRID: readonly (readonly number[])[] = [
  [
    1694, 1613, 1498, 1384, 1271, 1182, 806, 803, 829, 872, 1117, 1146, 1176, 1203, 1239, 1251, 1273, 1251,
    1239, 1203, 1176, 1146, 1117, 872, 829, 803, 806, 1191, 1273, 1384, 1498, 1613,
  ],
  [
    1487, 1417, 1357, 1268, 1159, 864, 806, 803, 829, 872, 924, 1070, 1110, 1161, 1195, 1211, 1225, 1211,
    1195, 1161, 1110, 1070, 925, 872, 829, 803, 806, 864, 1160, 1268, 1357, 1421,
  ],
  [
    1331, 1227, 1225, 1193, 1063, 864, 806, 803, 829, 872, 924, 1024, 1080, 1129, 1170, 1184, 1198, 1184,
    1170, 1129, 1080, 1027, 925, 872, 829, 803, 806, 864, 1063, 1193, 1223, 1227,
  ],
  [
    1206, 1054, 1069, 1059, 967, 864, 806, 803, 829, 872, 924, 990, 1054, 1113, 1159, 1174, 1192, 1174, 1159,
    1113, 1054, 971, 925, 872, 829, 803, 806, 864, 967, 1059, 1069, 1054,
  ],
  [
    982, 983, 1037, 1012, 928, 864, 806, 803, 829, 872, 924, 971, 1034, 1095, 1152, 1176, 1188, 1176, 1152,
    1095, 1033, 971, 925, 872, 829, 803, 806, 864, 928, 1012, 1038, 983,
  ],
  [
    1001, 1025, 1018, 974, 909, 846, 806, 803, 829, 872, 924, 971, 1021, 1090, 1142, 1164, 1175, 1164, 1142,
    1090, 1021, 971, 925, 872, 829, 803, 806, 846, 909, 974, 1011, 1025,
  ],
  [
    979, 977, 968, 949, 887, 838, 806, 803, 829, 872, 925, 956, 1016, 1079, 1112, 1132, 1146, 1132, 1112,
    1079, 1016, 959, 926, 872, 829, 803, 806, 838, 887, 949, 967, 977,
  ],
  [
    957, 954, 953, 925, 893, 861, 837, 832, 846, 880, 912, 965, 1003, 1062, 1110, 1115, 1126, 1115, 1110,
    1062, 1003, 966, 913, 880, 846, 832, 837, 861, 893, 925, 953, 954,
  ],
  [
    936, 931, 929, 914, 875, 868, 859, 857, 870, 895, 919, 957, 1022, 1044, 1072, 1086, 1093, 1086, 1072,
    1044, 1022, 957, 919, 895, 870, 857, 860, 870, 890, 914, 929, 931,
  ],
  [
    908, 903, 903, 884, 903, 913, 904, 893, 892, 905, 929, 964, 1003, 1046, 1060, 1063, 1066, 1063, 1060,
    1046, 1003, 964, 929, 905, 892, 893, 904, 913, 903, 884, 903, 903,
  ],
  [
    943, 936, 946, 953, 947, 947, 934, 927, 922, 931, 958, 967, 981, 1010, 1025, 1038, 1052, 1038, 1025, 1010,
    981, 967, 958, 931, 922, 927, 934, 947, 947, 953, 946, 937,
  ],
  [
    965, 960, 965, 963, 953, 944, 937, 939, 932, 934, 943, 961, 984, 987, 999, 997, 1006, 997, 999, 987, 984,
    961, 943, 934, 932, 940, 937, 944, 953, 963, 965, 960,
  ],
  [
    953, 949, 947, 949, 943, 940, 943, 944, 939, 938, 941, 948, 958, 972, 978, 984, 991, 984, 978, 972, 958,
    948, 941, 938, 939, 944, 943, 940, 943, 949, 947, 949,
  ],
  [
    943, 942, 941, 942, 944, 948, 949, 947, 945, 944, 943, 943, 944, 945, 947, 950, 953, 950, 947, 945, 944,
    943, 943, 944, 945, 947, 949, 948, 944, 942, 941, 942,
  ],
  [
    946, 946, 946, 946, 946, 946, 946, 946, 946, 946, 946, 946, 946, 946, 946, 946, 946, 946, 946, 946, 946,
    946, 946, 946, 946, 946, 946, 946, 946, 946, 946, 946,
  ],
];

/** Per-body fit of the template: skull point = c + s ⊙ (dir · R(dir)) (face frame, m). */
export const SKULL_FITS: Record<BodyType, { c: [number, number, number]; s: [number, number, number] }> = {
  masculine: { c: [0, 0.0276, -0.0766], s: [1.0053, 0.9851, 0.996] },
  feminine: { c: [0, 0.0335, -0.0693], s: [0.9379, 0.9379, 0.9379] },
  neutral: { c: [0, 0.0311, -0.0642], s: [0.995, 0.9892, 0.889] },
};

/** Ear landmarks per body (face frame, m): top of the ear, its back / front edge, half width across the ears. */
export const EAR_LANDMARKS: Record<
  BodyType,
  { earTop: number; earBack: number; earFront: number; earX: number }
> = {
  masculine: { earTop: 0.0084, earBack: -0.1144, earFront: -0.0453, earX: 0.0867 },
  feminine: { earTop: 0.008, earBack: -0.0956, earFront: -0.0551, earX: 0.0837 },
  neutral: { earTop: 0.0154, earBack: -0.0937, earFront: -0.0515, earX: 0.0928 },
};

/** Template radius (m) in a unit direction of template space (bilinear in azimuth / elevation). */
export function templateRadius(dx: number, dy: number, dz: number): number {
  let az = Math.atan2(dx, dz);
  if (az < 0) az += Math.PI * 2;
  az = (az / (Math.PI * 2)) * NAZ;
  const el = THREE.MathUtils.clamp(
    ((THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dy, -1, 1))) - EL0) / (EL1 - EL0)) * (NEL - 1),
    0,
    NEL - 1 - 1e-6,
  );
  const i0 = Math.floor(az) % NAZ;
  const i1 = (i0 + 1) % NAZ;
  const fa = az - Math.floor(az);
  const j0 = Math.floor(el);
  const j1 = Math.min(j0 + 1, NEL - 1);
  const fe = el - j0;
  const r0 = GRID[j0]!;
  const r1 = GRID[j1]!;
  return ((r0[i0]! * (1 - fa) + r0[i1]! * fa) * (1 - fe) + (r1[i0]! * (1 - fa) + r1[i1]! * fa) * fe) * 1e-4;
}

const _q = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Skull surface point (face frame, m) of `body` in the template-space unit direction `dir`. */
export function skullPoint(body: BodyType, dir: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const f = SKULL_FITS[body];
  const r = templateRadius(dir.x, dir.y, dir.z);
  return out.set(f.c[0] + f.s[0] * dir.x * r, f.c[1] + f.s[1] * dir.y * r, f.c[2] + f.s[2] * dir.z * r);
}

/** Template-space unit direction of the face-frame point `p` for `body`. */
export function skullDir(body: BodyType, p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const f = SKULL_FITS[body];
  return out.set((p.x - f.c[0]) / f.s[0], (p.y - f.c[1]) / f.s[1], (p.z - f.c[2]) / f.s[2]).normalize();
}

/**
 * How far the face-frame point `p` stands off the skull of `body` along the ray from the skull centre (m, > 0 =
 * outside). `surface` receives the skull point on that ray.
 */
export function skullStandoff(body: BodyType, p: THREE.Vector3, surface: THREE.Vector3 = _s): number {
  const f = SKULL_FITS[body];
  skullDir(body, p, _q);
  skullPoint(body, _q, surface);
  const dp = Math.hypot(p.x - f.c[0], p.y - f.c[1], p.z - f.c[2]);
  const ds = Math.hypot(surface.x - f.c[0], surface.y - f.c[1], surface.z - f.c[2]);
  return dp - ds;
}

const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _du = new THREE.Vector3();
const _up = new THREE.Vector3();

/** Outward unit normal of the skull of `body` at the template direction `dir` (central differences). */
export function skullNormal(body: BodyType, dir: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const e = 0.03;
  _up.set(Math.abs(dir.y) > 0.95 ? 1 : 0, Math.abs(dir.y) > 0.95 ? 0 : 1, 0);
  _t1.crossVectors(_up, dir).normalize();
  _t2.crossVectors(dir, _t1).normalize();
  skullPoint(body, _a.copy(dir).addScaledVector(_t1, e).normalize(), _a);
  skullPoint(body, _b.copy(dir).addScaledVector(_t1, -e).normalize(), _b);
  _du.subVectors(_a, _b);
  skullPoint(body, _a.copy(dir).addScaledVector(_t2, e).normalize(), _a);
  skullPoint(body, _b.copy(dir).addScaledVector(_t2, -e).normalize(), _b);
  out.crossVectors(_du, _a.sub(_b)).normalize();
  if (out.dot(dir) < 0) out.negate();
  return out;
}

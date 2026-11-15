/**
 * Sun and moon positions for the campus (P2-WLD-19, docs/TIME-OF-DAY.md §2). Pure functions, no external API.
 *
 *  - Sun: the NOAA solar calculator (Meeus, "Astronomical Algorithms" ch. 25, low precision): declination and the
 *    equation of time from the Julian century, the hour angle from the true solar time, then altitude / azimuth for
 *    the site, with the standard atmospheric refraction near the horizon. ≈ 1 arc-minute in the 20th–21st century,
 *    sunrise / sunset to ≈ 1 minute.
 *  - Moon: the short series used by Astronomy Answers / suncalc (Meeus ch. 47 truncated to the largest terms):
 *    good to ≈ 0.5° — far finer than a 0.5° moon disc needs. Phase (illuminated fraction) from the sun–moon
 *    elongation.
 *  - Stars: the local sidereal time, for the rotation of the star field (equatorial → local horizon).
 *
 * Angles in degrees unless named `…Rad`. Azimuth: from north, clockwise (east = 90°). World axes (Lighting.tsx):
 * x = east, y = up, −z = north.
 */

/** Gukirana campus, Musanze (Northern Province, Rwanda): latitude, longitude (east +), altitude, time zone. */
export const SITE = { lat: -1.5, lon: 29.6, altM: 1850, utcOffsetH: 2, tz: "Africa/Kigali" } as const;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const norm360 = (a: number) => ((a % 360) + 360) % 360;

/** Julian day of a timestamp (ms since the Unix epoch, UTC). */
export const julianDay = (ms: number) => ms / 86_400_000 + 2_440_587.5;

export interface SkyPos {
  /** altitude above the horizon, degrees (refracted for the sun) */
  el: number;
  /** azimuth from north, clockwise, degrees */
  az: number;
}

/** Atmospheric refraction (degrees) for a geometric altitude (NOAA's piecewise fit; 0 high up, ≈ 0.57° at the horizon). */
export function refraction(el: number): number {
  if (el > 85) return 0;
  const te = Math.tan(el * RAD);
  let r: number; // arc-seconds
  if (el > 5) r = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (el > -0.575) r = 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)));
  else r = -20.774 / te;
  return r / 3600;
}

/** Sun declination (°) and equation of time (minutes) for a Julian day. */
export function sunEquatorial(jd: number): { decl: number; eqTimeMin: number; ra: number } {
  const T = (jd - 2_451_545) / 36_525;
  const L0 = norm360(280.46646 + T * (36000.76983 + T * 0.0003032));
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * RAD;
  const C =
    Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mr) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) * DEG;
  const ra = norm360(Math.atan2(Math.cos(eps * RAD) * Math.sin(lambda * RAD), Math.cos(lambda * RAD)) * DEG);
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const L0r = L0 * RAD;
  const eq =
    y * Math.sin(2 * L0r) -
    2 * e * Math.sin(Mr) +
    4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
    0.5 * y * y * Math.sin(4 * L0r) -
    1.25 * e * e * Math.sin(2 * Mr);
  return { decl, eqTimeMin: 4 * eq * DEG, ra };
}

/** Horizontal position from declination and hour angle (degrees) at a latitude. */
function horizontal(decl: number, haDeg: number, lat: number): SkyPos {
  const d = decl * RAD;
  const h = haDeg * RAD;
  const p = lat * RAD;
  const sinEl = Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(h);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl))) * DEG;
  // azimuth from north, clockwise
  const az = norm360(
    Math.atan2(
      -Math.sin(h) * Math.cos(d),
      Math.cos(p) * Math.sin(d) - Math.sin(p) * Math.cos(d) * Math.cos(h),
    ) * DEG,
  );
  return { el, az };
}

/** Sun altitude (refracted) and azimuth at the campus for a timestamp. */
export function sunPosition(ms: number, lat: number = SITE.lat, lon: number = SITE.lon): SkyPos {
  const { decl, eqTimeMin } = sunEquatorial(julianDay(ms));
  const utcMin = (((ms / 60_000) % 1440) + 1440) % 1440;
  const tst = utcMin + eqTimeMin + 4 * lon; // true solar time, minutes
  const ha = tst / 4 - 180;
  const p = horizontal(decl, ha, lat);
  return { el: p.el + refraction(p.el), az: p.az };
}

/** Greenwich mean sidereal time (degrees) for a Julian day. */
export const gmst = (jd: number) => norm360(280.46061837 + 360.98564736629 * (jd - 2_451_545));
/** Local sidereal time (degrees) at the campus. */
export const localSidereal = (ms: number, lon: number = SITE.lon) => norm360(gmst(julianDay(ms)) + lon);

export interface MoonState extends SkyPos {
  /** illuminated fraction of the disc, 0 (new) … 1 (full) */
  fraction: number;
  /** waxing (true) or waning */
  waxing: boolean;
  /** right ascension / declination (degrees) */
  ra: number;
  decl: number;
}

/** Moon position (geocentric, ≈ 0.5°) and phase at the campus for a timestamp. */
export function moonPosition(ms: number, lat: number = SITE.lat, lon: number = SITE.lon): MoonState {
  const d = julianDay(ms) - 2_451_545;
  const L = (218.316 + 13.176396 * d) * RAD; // ecliptic longitude
  const M = (134.963 + 13.064993 * d) * RAD; // mean anomaly
  const F = (93.272 + 13.22935 * d) * RAD; // mean distance
  const l = L + 6.289 * RAD * Math.sin(M);
  const b = 5.128 * RAD * Math.sin(F);
  const e = 23.4397 * RAD;
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l)) * DEG;
  const decl = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)) * DEG;
  const ha = localSidereal(ms, lon) - ra;
  const p = horizontal(decl, ha, lat);
  // phase from the elongation (the sun ~ 400× farther than the moon: the phase angle ≈ 180° − elongation)
  const sun = sunEquatorial(julianDay(ms));
  const sd = sun.decl * RAD;
  const md = decl * RAD;
  const dra = (sun.ra - ra) * RAD;
  const elong = Math.acos(
    Math.max(-1, Math.min(1, Math.sin(sd) * Math.sin(md) + Math.cos(sd) * Math.cos(md) * Math.cos(dra))),
  );
  const inc = Math.atan2(149_598_000 * Math.sin(elong), 385_001 - 149_598_000 * Math.cos(elong));
  const fraction = (1 + Math.cos(inc)) / 2;
  // waxing while the moon is east of the sun (its ecliptic longitude ahead of the sun's)
  const sunLong = Math.atan2(Math.sin(sun.ra * RAD), Math.cos(sun.ra * RAD));
  const waxing = Math.sin(l - sunLong) > 0;
  return { el: p.el + refraction(p.el), az: p.az, fraction, waxing, ra: norm360(ra), decl };
}

/** World direction (x east, y up, −z north) of an altitude / azimuth. */
export function skyDir(p: SkyPos): [number, number, number] {
  const el = p.el * RAD;
  const az = p.az * RAD;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)];
}

/**
 * Column-major 3×3 matrix (THREE.Matrix3.fromArray order) taking a world direction to equatorial cartesian
 * coordinates (x → RA 0h, z → north celestial pole): the star field turns with the sidereal time.
 */
export function worldToEquatorial(ms: number, lat: number = SITE.lat, lon: number = SITE.lon): number[] {
  const L = localSidereal(ms, lon) * RAD;
  const p = lat * RAD;
  // ENU = R · q, R rows: [−sinL, cosL, 0], [−sinφ cosL, −sinφ sinL, cosφ], [cosφ cosL, cosφ sinL, sinφ]; q = Rᵀ · ENU
  const sL = Math.sin(L);
  const cL = Math.cos(L);
  const sp = Math.sin(p);
  const cp = Math.cos(p);
  const R = [
    [-sL, cL, 0],
    [-sp * cL, -sp * sL, cp],
    [cp * cL, cp * sL, sp],
  ];
  // world → ENU: E = x, N = −z, U = y. q_i = Σ_j R[j][i] · ENU_j
  // q = A · world, A[i][x] = R[0][i], A[i][y] = R[2][i], A[i][z] = −R[1][i]
  const A = [0, 1, 2].map((i) => [R[0]![i]!, R[2]![i]!, -R[1]![i]!]);
  // column-major
  return [A[0]![0]!, A[1]![0]!, A[2]![0]!, A[0]![1]!, A[1]![1]!, A[2]![1]!, A[0]![2]!, A[1]![2]!, A[2]![2]!];
}

/* ---------------------------------------------------------------- Kigali clock ---------------------------------------------------------------- */

/** Minutes after midnight on the Kigali clock (CAT, UTC+2, no daylight saving) for a timestamp. */
export const kigaliMinutes = (ms: number) => (((ms / 60_000 + SITE.utcOffsetH * 60) % 1440) + 1440) % 1440;

/** Timestamp of a Kigali clock time (minutes after midnight, may be outside 0…1440) on the Kigali day of `dayOf`. */
export function kigaliTime(dayOf: number, minutes: number): number {
  const local = dayOf + SITE.utcOffsetH * 3_600_000;
  const midnightLocal = Math.floor(local / 86_400_000) * 86_400_000;
  return midnightLocal - SITE.utcOffsetH * 3_600_000 + minutes * 60_000;
}

/**
 * Kigali clock minute at which the sun crosses `el` (default −0.833°: the upper limb on the horizon with refraction)
 * on the Kigali day of `dayOf`, rising (morning) or setting. Bisection on the sun model; null if it never crosses.
 */
export function sunCrossing(dayOf: number, rising: boolean, el = -0.833): number | null {
  const f = (m: number) => {
    // geometric altitude (the −0.833° convention already includes refraction)
    const ms = kigaliTime(dayOf, m);
    const s = sunPosition(ms);
    return s.el - refraction(s.el - refraction(s.el)) - el;
  };
  let a = rising ? 0 : 720;
  let b = rising ? 720 : 1440;
  if (Math.sign(f(a)) === Math.sign(f(b))) return null;
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2;
    if (Math.sign(f(m)) === Math.sign(f(a))) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

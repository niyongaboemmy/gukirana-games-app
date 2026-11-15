import * as THREE from "three";
import { tod, type TodFrame } from "./store";

/**
 * The sky dome (P2-WLD-19, docs/TIME-OF-DAY.md §4): a tuned analytic gradient sky driven by the time-of-day look —
 * replaces the fixed Preetham <Sky> (which goes black 2° below the horizon: no blue hour, no twilight glow).
 *
 *  - zenith → horizon gradient (highland blue by day; deep blue twilight; near-black night, lifted by moonlight);
 *  - the twilight / sunset glow band hugging the horizon towards the sun (it follows the sun below the horizon), a
 *    forward-scattering (Henyey–Greenstein) halo round the sun, the Belt of Venus over Earth's shadow on the
 *    anti-solar horizon in civil twilight;
 *  - the sun's disc (HDR: it blooms), limb-darkened, orange at the horizon;
 *  - the moon: a disc whose lit side is shaded from the real sun direction, so the phase AND the tilt of the
 *    terminator are right for the date and hour, a faint earthshine and a soft halo;
 *  - stars: a fixed procedural field in equatorial coordinates, turned by the local sidereal time (they rise in the
 *    east and set in the west like the real sky), energy-conserving anti-aliased points (stable when the camera
 *    moves: no sub-pixel sparkle), a subtle twinkle (off on Lite and with reduced motion), extinction near the
 *    horizon, the Milky Way band brightening towards Sagittarius;
 *  - a ±½ LSB dither: no banding in the dark gradients.
 * Drawn at the far plane (z = w) with the camera at its centre: one draw, any size, never clipped. Everything is a
 * uniform: changing the time never recompiles it.
 */

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = (modelMatrix * vec4(position, 0.0)).xyz;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const frag = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform float uGlowK;
uniform float uBeltK;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform float uSunDiscI;
uniform vec3 uMoonDir;
uniform float uMoonDiscI;
uniform float uMoonFrac;
uniform float uStars;
uniform float uTwinkle;
uniform float uTime;
uniform mat3 uStarMat;
varying vec3 vDir;

float gkH13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 gkH33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float gkN3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(gkH13(i), gkH13(i + vec3(1, 0, 0)), f.x), mix(gkH13(i + vec3(0, 1, 0)), gkH13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(gkH13(i + vec3(0, 0, 1)), gkH13(i + vec3(1, 0, 1)), f.x), mix(gkH13(i + vec3(0, 1, 1)), gkH13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

// one layer of stars on a 3D cell grid over the unit sphere (q: equatorial direction)
vec3 gkStarLayer(vec3 q, float scale, float keep, float gain) {
  vec3 p = q * scale;
  vec3 cell = floor(p);
  float h = gkH13(cell);
  if (h < keep) return vec3(0.0);
  vec3 c = 0.25 + 0.5 * gkH33(cell + 7.13);
  vec3 d = (p - cell) - c;
  d -= q * dot(d, q); // distance across the line of sight only
  float r2 = dot(d, d);
  // anti-aliased point: at least one pixel wide, its energy kept (a star never flickers as it crosses pixels)
  float px = length(fwidth(p)) * 0.5;
  float s = max(px, 0.03);
  float mag = pow((h - keep) / (1.0 - keep), 5.0);
  float b = exp(-r2 / (2.0 * s * s)) * (0.03 * 0.03) / (s * s) * (0.12 + 2.6 * mag) * gain;
  float tw = 1.0 + uTwinkle * 0.5 * sin(uTime * (1.3 + 3.7 * h) + h * 91.0);
  vec3 tint = mix(vec3(0.72, 0.8, 1.0), vec3(1.0, 0.84, 0.66), gkH13(cell + 3.7));
  return tint * b * tw;
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float yh = max(y, 0.0);
  // gradient: the horizon colour holds low down, the zenith colour takes over overhead
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 1.0, pow(yh, 0.42)));
  // a brighter, hazier strip right on the horizon
  col = mix(col, uHorizon * 1.06, exp(-yh * 22.0) * 0.35);

  vec3 sd = uSunDir;
  float cosT = dot(d, sd);
  // 1 towards the sun's azimuth, 0 opposite; 0.5 straight up / with the sun overhead (no azimuth there). (Guarded:
  // normalising a zero vector at the zenith is NaN, and one NaN texel turns the whole filtered environment black.)
  float dl = length(d.xz);
  float sl = length(sd.xz);
  float az = (dl > 1e-4 && sl > 1e-4) ? dot(d.xz / dl, sd.xz / sl) * 0.5 + 0.5 : 0.5;
  az = mix(0.5, az, smoothstep(0.0, 0.05, min(dl, sl)));
  // twilight / sunset glow: a band on the horizon towards the sun and a wider warm wash above it
  col += uGlow * uGlowK * (0.55 * exp(-yh * 7.0) * pow(az, 5.0) + 0.18 * exp(-yh * 2.4) * pow(az, 1.6));
  // forward scattering round the sun (Henyey–Greenstein, g = 0.78), fading as the sun sets
  float g = 0.78;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5);
  float sunUp = smoothstep(-0.1, 0.04, sd.y);
  col += uSunCol * hg * 0.006 * sunUp * (0.6 + 0.4 * uGlowK);
  // Earth's shadow (a darker blue band right on the anti-solar horizon) under the pink Belt of Venus
  float anti = pow(1.0 - az, 2.5) * uBeltK;
  col *= 1.0 - anti * 0.35 * exp(-yh * 26.0);
  col += vec3(0.2, 0.1, 0.12) * anti * exp(-pow((yh - 0.07) / 0.05, 2.0)) * 0.55;
  // below the horizon (seen past the far hills from up high): a darker haze
  col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.18, y));

  // stars and the Milky Way (equatorial frame, turned by the sidereal time)
  if (uStars > 0.001 && y > -0.02) {
    vec3 q = normalize(uStarMat * d);
    vec3 st = gkStarLayer(q, 140.0, 0.955, 1.0) + gkStarLayer(q, 310.0, 0.985, 0.55);
#ifndef GK_LITE
    // galactic plane (north galactic pole and centre in equatorial coordinates, J2000)
    float b = dot(q, vec3(-0.8676, -0.1981, 0.4560));
    float core = 0.5 + 0.5 * dot(q, vec3(-0.0550, -0.8738, -0.4833));
    float mw = exp(-b * b / 0.022) * (0.45 + 0.55 * gkN3(q * 9.0)) * (0.55 + 0.45 * gkN3(q * 23.0 + 4.0)) * (0.5 + core * core);
    st += vec3(0.010, 0.011, 0.014) * mw;
#endif
    col += st * uStars * smoothstep(-0.02, 0.22, y);
  }

  // the sun's disc (≈ 0.86° across: a touch larger than real, readable on a phone), limb darkened
  float ang = acos(clamp(cosT, -1.0, 1.0));
  const float SR = 0.0075;
  float disc = 1.0 - smoothstep(SR * 0.82, SR, ang);
  float limb = 1.0 - 0.45 * pow(clamp(ang / SR, 0.0, 1.0), 2.0);
  col += uSunCol * uSunDiscI * disc * limb * smoothstep(-0.01, 0.004, y);

  // the moon: phase and terminator tilt from the real sun direction, earthshine, a soft halo
  vec3 m = uMoonDir;
  float mang = acos(clamp(dot(d, m), -1.0, 1.0));
  const float MR = 0.0072;
  if (uMoonDiscI > 0.001 && y > -0.01) {
    col += vec3(0.55, 0.6, 0.72) * uMoonDiscI * uMoonFrac * 0.05 * exp(-mang / 0.035);
    if (mang < MR * 1.2) {
      vec3 up = abs(m.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
      vec3 tx = normalize(cross(m, up));
      vec3 ty = cross(tx, m);
      vec2 uv = vec2(dot(d, tx), dot(d, ty)) / MR;
      float rr = dot(uv, uv);
      if (rr < 1.0) {
        vec3 n = normalize(uv.x * tx + uv.y * ty - sqrt(1.0 - rr) * m);
        float lit = smoothstep(-0.06, 0.08, dot(n, uSunDir));
        float maria = 0.78 + 0.22 * gkN3(n * 4.0 + 2.0);
        vec3 mc = vec3(1.0, 0.97, 0.92) * (lit * maria + 0.025);
        float a = 1.0 - smoothstep(0.86, 1.0, rr);
        col = mix(col, max(col, mc * uMoonDiscI), a);
      }
    }
  }

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // ±½ LSB dither: no banding in the dark twilight / night gradients
  gl_FragColor.rgb += (gkH13(vec3(gl_FragCoord.xy, 1.7)) - 0.5) / 255.0;
}`;

export interface SkyOpts {
  lite: boolean;
  /** stars / moon drawn (off for the environment-map capture: no sparkle in reflections) */
  night?: boolean;
}

/** A sky material (every instance shares one program: same source and defines per tier). */
export function skyMaterial({ lite }: SkyOpts): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    defines: lite ? { GK_LITE: "" } : {},
    uniforms: {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uGlowK: { value: 0 },
      uBeltK: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color() },
      uSunDiscI: { value: 0 },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uMoonDiscI: { value: 0 },
      uMoonFrac: { value: 0 },
      uStars: { value: 0 },
      uTwinkle: { value: 0 },
      uTime: { value: 0 },
      uStarMat: { value: new THREE.Matrix3() },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  return m;
}

const Y = new THREE.Vector3(0, 1, 0);
/**
 * Copy the time-of-day state into a sky material. `yaw` turns the sky (a hall's window capture is taken in the
 * hall's own frame); `night` false leaves out the stars and moon (environment capture); `twinkle` 0…1.
 */
export function updateSky(
  m: THREE.ShaderMaterial,
  opts: { yaw?: number; night?: boolean; twinkle?: number; time?: number; f?: TodFrame } = {},
) {
  const f = opts.f ?? tod;
  const L = f.look;
  const u = m.uniforms;
  (u.uZenith!.value as THREE.Color).setRGB(...L.zenith);
  (u.uHorizon!.value as THREE.Color).setRGB(...L.horizon);
  (u.uGlow!.value as THREE.Color).setRGB(...L.glow);
  u.uGlowK!.value = L.glowK;
  u.uBeltK!.value = L.beltK;
  const sd = u.uSunDir!.value as THREE.Vector3;
  const md = u.uMoonDir!.value as THREE.Vector3;
  sd.copy(f.sunDir);
  md.copy(f.moonDir);
  if (opts.yaw) {
    sd.applyAxisAngle(Y, opts.yaw);
    md.applyAxisAngle(Y, opts.yaw);
  }
  (u.uSunCol!.value as THREE.Color).setRGB(...L.sunDisc);
  u.uSunDiscI!.value = L.sunDiscI;
  const night = opts.night ?? true;
  u.uMoonDiscI!.value = night ? L.moonDiscI : 0;
  u.uMoonFrac!.value = f.moon.fraction;
  u.uStars!.value = night ? L.stars : 0;
  u.uTwinkle!.value = opts.twinkle ?? 0;
  u.uTime!.value = opts.time ?? 0;
  const sm = u.uStarMat!.value as THREE.Matrix3;
  sm.copy(f.starMat);
  // a direction in the turned frame is R_y(yaw) · world, so world = R_y(−yaw) · d
  if (opts.yaw) sm.multiply(_m3.setFromMatrix4(_m4.makeRotationY(-opts.yaw)));
}
const _m3 = new THREE.Matrix3();
const _m4 = new THREE.Matrix4();

/** Keep a sky mesh centred on whatever camera draws it (it is drawn at the far plane: only directions matter). */
export function followCamera(mesh: THREE.Mesh) {
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.onBeforeRender = (_r, _s, cam) => {
    mesh.position.setFromMatrixPosition(cam.matrixWorld);
    mesh.updateMatrixWorld();
  };
}

/** The sky geometry: a unit sphere (drawn at the far plane, so its size does not matter). */
let skyGeo: THREE.SphereGeometry | null = null;
export const skyGeometry = () => (skyGeo ??= new THREE.SphereGeometry(1, 32, 16));

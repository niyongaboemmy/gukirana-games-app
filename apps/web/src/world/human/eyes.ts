import * as THREE from "three";
import { GK_SKIN_GLSL } from "./skin/skin-shading";

/**
 * Real eyeballs for the plaza people (P2-AVA-12). The Rocketbox heads paint the eyes on two small low-poly caps of
 * the head mesh (≈ 37–130 vertices each, flat colour, the cornea highlight a smear): the single biggest "doll" cue up
 * close. Here each eye becomes its own eyeball, fitted to the original caps (least-squares sphere through the vertices
 * the eye bone owns), rigid on the eye bone (so blinks, saccades and the gaze still move it):
 *
 *  - a convex **cornea** (the front cap bulges ≈ 7 % of the radius) under a wet clear coat (roughness 0.03): a small,
 *    sharp catchlight that rides on the eye as it moves;
 *  - a **parallax iris** below the cornea (the iris plane ≈ 2.5–3 mm behind the cornea apex: its texture is offset
 *    along the view direction, so the iris shifts inside the eye from an angle, the cue that reads as depth), radial
 *    fibres, a lighter collarette round the pupil, a dark **limbal ring**, a black pupil;
 *  - an off-white, warm **sclera**, darker and pinker towards the corners, with faint vessels;
 *  - **eye occlusion**: the upper lid and lashes shade the top of the eyeball (direct and ambient light), and the
 *    sclera darkens where the lids meet it, so the eye sits *in* the socket instead of on the face.
 * The original caps are pulled inside the new eyeball (never seen again). One skinned mesh for both eyes (one draw
 * call), drawn for people within the near LOD only.
 */

export interface EyeFit {
  /** skeleton bone index of the eye */
  bone: number;
  /** sphere centre / radius in the head geometry's bind space */
  center: THREE.Vector3;
  radius: number;
}

/** Least-squares sphere through points (algebraic fit: |p|² = 2a·p + d). */
export function fitSphere(pts: THREE.Vector3[]): { center: THREE.Vector3; radius: number } | null {
  if (pts.length < 6) return null;
  // normal equations of [2x 2y 2z 1]·[a b c d]ᵀ = x²+y²+z²
  const A = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  const b = [0, 0, 0, 0];
  for (const p of pts) {
    const r = [2 * p.x, 2 * p.y, 2 * p.z, 1];
    const s = p.lengthSq();
    for (let i = 0; i < 4; i++) {
      b[i]! += r[i]! * s;
      for (let j = 0; j < 4; j++) A[i]![j]! += r[i]! * r[j]!;
    }
  }
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < 4; c++) {
    let piv = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    if (Math.abs(A[piv]![c]!) < 1e-14) return null;
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    [b[c], b[piv]] = [b[piv]!, b[c]!];
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = A[r]![c]! / A[c]![c]!;
      for (let k = c; k < 4; k++) A[r]![k]! -= f * A[c]![k]!;
      b[r]! -= f * b[c]!;
    }
  }
  const x = b.map((v, i) => v / A[i]![i]!);
  const center = new THREE.Vector3(x[0], x[1], x[2]);
  const r2 = x[3]! + center.lengthSq();
  return r2 > 0 ? { center, radius: Math.sqrt(r2) } : null;
}

/** The eye bones' own vertices in a head geometry (dominant skin weight ≥ 0.5), per eye bone index. */
function eyeVerts(g: THREE.BufferGeometry, eyeBones: number[]): Map<number, number[]> {
  const si = g.attributes.skinIndex as THREE.BufferAttribute;
  const sw = g.attributes.skinWeight as THREE.BufferAttribute;
  const out = new Map<number, number[]>(eyeBones.map((b) => [b, []]));
  if (!si || !sw) return out;
  for (let i = 0; i < si.count; i++) {
    for (let k = 0; k < 4; k++) {
      const bi = si.getComponent(i, k);
      if (sw.getComponent(i, k) >= 0.5 && out.has(bi)) out.get(bi)!.push(i);
    }
  }
  return out;
}

/** Fit both eyes of a head geometry (bind space). */
export function fitEyes(g: THREE.BufferGeometry, eyeBones: number[]): EyeFit[] {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const fits: EyeFit[] = [];
  for (const [bone, idx] of eyeVerts(g, eyeBones)) {
    const s = fitSphere(idx.map((i) => new THREE.Vector3().fromBufferAttribute(pos, i)));
    // sanity: a human eyeball is ≈ 11–13 mm in radius; a bad fit (too few / coplanar vertices) is skipped
    if (s && s.radius > 0.006 && s.radius < 0.02) fits.push({ bone, ...s });
  }
  return fits;
}

/** Pull the original painted eye caps inside the new eyeballs (in place; call before tessellating the head). */
export function sinkEyeCaps(g: THREE.BufferGeometry, fits: EyeFit[], k = 0.8) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const map = eyeVerts(
    g,
    fits.map((f) => f.bone),
  );
  const p = new THREE.Vector3();
  for (const f of fits)
    for (const i of map.get(f.bone) ?? []) {
      p.fromBufferAttribute(pos, i).sub(f.center).multiplyScalar(k).add(f.center);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
  pos.needsUpdate = true;
}

/** Iris radius (m): ⌀ ≈ 11.7 mm on every adult eye, whatever the fitted sphere (the caps fit 15–18 mm spheres). */
const IRIS_R = 0.0059;
/** Limbus (iris edge) angle from the front pole (rad) on a sphere of radius r. */
const limbusOf = (r: number) => Math.asin(Math.min(0.9, IRIS_R / r));

/**
 * Both eyeballs as one skinned geometry in the head's bind space: `fwd` / `up` = the face's forward / up in that space.
 * Attributes: position, normal, uv (iris coordinates: |uv| = 1 at the limbus, +y = up), skinIndex / skinWeight (rigid
 * on the eye bone).
 */
export function eyeballGeometry(fits: EyeFit[], fwd: THREE.Vector3, up: THREE.Vector3, rings = 16, segs = 28): THREE.BufferGeometry {
  const P: number[] = [];
  const N: number[] = [];
  const UV: number[] = [];
  const SI: number[] = [];
  const SW: number[] = [];
  const I: number[] = [];
  const f = fwd.clone().normalize();
  const x = new THREE.Vector3().crossVectors(up, f).normalize();
  const y = new THREE.Vector3().crossVectors(f, x).normalize();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const maxTh = Math.PI * 0.7;
  for (const e of fits) {
    const LIMBUS = limbusOf(e.radius);
    // the cornea: ≈ 2.2 mm proud of the sclera's sphere at its apex, blending out just past the limbus
    const bulge = (th: number) => {
      const t = th / (LIMBUS * 1.08);
      return t < 1 ? (0.0022 / e.radius) * (1 - t * t) * (1 - t * t) : 0;
    };
    const base = P.length / 3;
    for (let r = 0; r <= rings; r++) {
      // denser rings over the cornea and the iris
      const th = maxTh * Math.pow(r / rings, 1.6);
      for (let s = 0; s <= segs; s++) {
        const ph = (s / segs) * Math.PI * 2;
        n.copy(f)
          .multiplyScalar(Math.cos(th))
          .addScaledVector(x, Math.sin(th) * Math.cos(ph))
          .addScaledVector(y, Math.sin(th) * Math.sin(ph));
        const rr = e.radius * (1 + bulge(th));
        p.copy(e.center).addScaledVector(n, rr);
        P.push(p.x, p.y, p.z);
        N.push(n.x, n.y, n.z);
        const u = th / LIMBUS;
        // +x of the iris coordinates = the person's left on both eyes (mirror-free fibres are fine)
        UV.push(u * Math.cos(ph), u * Math.sin(ph));
        SI.push(e.bone, 0, 0, 0);
        SW.push(1, 0, 0, 0);
      }
    }
    for (let r = 0; r < rings; r++)
      for (let s = 0; s < segs; s++) {
        const a = base + r * (segs + 1) + s;
        const b = a + segs + 1;
        I.push(a, b, a + 1, a + 1, b, b + 1);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(SI, 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(SW, 4));
  g.setIndex(I);
  // smooth normals across the cornea / sclera seam
  g.computeVertexNormals();
  g.userData.gkShared = true;
  return g;
}

/**
 * Eyeball material: physically based (the scene's lights and environment), a wet clear coat, and the iris / sclera /
 * occlusion pattern of this file's header in the shader. `iris` = the look's eye colour (sRGB hex).
 */
export function makeEyeMaterial(iris: string, seed = 0): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.32,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
    ior: 1.376,
    specularIntensity: 0.6,
  });
  m.name = "gk-eyes";
  const u = { uIris: { value: new THREE.Color(iris) }, uEyeSeed: { value: (seed % 997) / 997 } };
  m.userData.gkUniforms = u;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGkEye;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvGkEye = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec2 vGkEye;
uniform vec3 uIris; uniform float uEyeSeed;
float gkEyeAO = 1.0;
${GK_SKIN_GLSL.breakup}`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
{
  // view vector in the iris' tangent frame (derivatives), for the parallax of the iris under the cornea
  vec3 gkV = normalize(vViewPosition);
  vec3 gkN = normalize(vNormal);
  vec3 q0 = dFdx(-vViewPosition); vec3 q1 = dFdy(-vViewPosition);
  vec2 s0 = dFdx(vGkEye); vec2 s1 = dFdy(vGkEye);
  vec3 q1p = cross(q1, gkN); vec3 q0p = cross(gkN, q0);
  vec3 gkT = q1p * s0.x + q0p * s1.x;
  vec3 gkB = q1p * s0.y + q0p * s1.y;
  float gkS = inversesqrt(max(max(dot(gkT, gkT), dot(gkB, gkB)), 1e-12));
  gkT *= gkS; gkB *= gkS;
  vec3 gkVt = vec3(dot(gkV, gkT), dot(gkV, gkB), dot(gkV, gkN));
  float r0 = length(vGkEye);
  float depth = 0.34 * max(0.0, 1.0 - r0 * r0);
  vec2 iuv = vGkEye - gkVt.xy / max(gkVt.z, 0.3) * depth;
  float r = length(iuv);
  float a = atan(iuv.y, iuv.x);
  // ---- iris: radial fibres, crypts, collarette, limbal ring, pupil
  float fib = gkBNoise(vec2(a * 14.0 + uEyeSeed * 40.0, r * 2.5)) * 0.6 + gkBNoise(vec2(a * 38.0, r * 7.0 + 3.0)) * 0.4;
  float crypt = smoothstep(0.62, 0.8, gkBNoise(vec2(a * 9.0 + 5.0, r * 5.0)));
  vec3 irisC = max(uIris, vec3(0.02, 0.012, 0.007)) * (0.7 + 0.9 * fib) * (1.0 - 0.3 * crypt);
  float pupil = 0.31;
  float coll = exp(-pow((r - pupil - 0.17) / 0.07, 2.0));
  irisC += uIris * vec3(1.15, 1.0, 0.8) * 0.45 * coll;
  irisC *= mix(1.0, 0.22, smoothstep(0.72, 1.0, r));
  irisC = mix(irisC, vec3(0.004), 1.0 - smoothstep(pupil - 0.025, pupil + 0.02, r));
  // ---- sclera: warm off-white, darker / pinker towards the corners, faint vessels
  float rs = r0;
  vec3 scl = vec3(0.57, 0.52, 0.46);
  float edge = smoothstep(1.3, 3.2, rs);
  scl *= mix(vec3(1.0), vec3(0.78, 0.6, 0.55), edge);
  // the corners (caruncle side and outer canthus) sit in the lids' shadow; a soft shade along the lower lid
  scl *= 1.0 - 0.4 * smoothstep(1.5, 2.8, abs(vGkEye.x)) - 0.18 * smoothstep(-0.9, -1.8, vGkEye.y);
  float ves = smoothstep(0.55, 0.9, gkBNoise(vec2(a * 6.0 + 2.0, rs * 4.0))) * smoothstep(1.5, 3.0, rs);
  scl = mix(scl, vec3(0.5, 0.2, 0.17), ves * 0.25);
  // limbus: a soft dark blend from iris to sclera
  float lim = smoothstep(0.95, 1.07, r0);
  vec3 c = mix(irisC, scl * mix(0.72, 1.0, smoothstep(1.0, 1.18, r0)), lim);
  // ---- occlusion: the upper lid / lashes shade the top of the eye, the lids' contact line all round
  float top = smoothstep(0.2, 2.0, vGkEye.y);
  gkEyeAO = (1.0 - 0.4 * top) * (1.0 - 0.35 * smoothstep(1.8, 3.2, rs));
  diffuseColor.rgb = c * mix(1.0, gkEyeAO, 0.6);
}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
roughnessFactor = mix(0.42, 0.3, smoothstep(1.0, 1.2, length(vGkEye)));`,
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
reflectedLight.indirectDiffuse *= gkEyeAO;
reflectedLight.indirectSpecular *= mix(0.5, 1.0, gkEyeAO);
// catchlight: the bright sky / a window reflected in the wet cornea (the small sharp highlight up and to the side of
// the pupil every real eye shows), scaled by the ambient light so it never shines in the dark
{
  vec3 gkR = reflect(-normalize(vViewPosition), normalize(vNormal));
  float gkAmb = dot(irradiance + iblIrradiance, vec3(0.2126, 0.7152, 0.0722));
  float gkC = pow(max(dot(gkR, normalize(vec3(0.32, 0.5, 0.8))), 0.0), 420.0);
  reflectedLight.directSpecular += vec3(gkC) * clamp(gkAmb, 0.0, 2.5) * 1.6 * smoothstep(1.4, 0.8, length(vGkEye));
}`,
      );
  };
  m.customProgramCacheKey = () => "gk-eyes-1";
  return m;
}

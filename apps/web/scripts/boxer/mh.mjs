// MakeHuman 1.x data readers for the boxer-body build (P3-FGT-13). All inputs are CC0 1.0 (MakeHuman assets:
// base mesh, macro targets, default skeleton + weights). Pure functions over plain arrays.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** base.obj: positions (dm), and faces (vertex indices, 0-based) per group */
export function readObj(path) {
  const v = [];
  const groups = new Map();
  let g = "default";
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.startsWith("v ")) {
      const p = line.split(/\s+/);
      v.push(+p[1], +p[2], +p[3]);
    } else if (line.startsWith("g ")) g = line.slice(2).trim();
    else if (line.startsWith("f ")) {
      const idx = line.trim().split(/\s+/).slice(1).map((t) => parseInt(t.split("/")[0], 10) - 1);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(idx);
    }
  }
  return { pos: Float64Array.from(v), groups };
}

/** a .target file: sparse vertex offsets (dm) */
export function readTarget(path) {
  const out = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line || line[0] === "#") continue;
    const p = line.trim().split(/\s+/);
    if (p.length < 4) continue;
    out.push(+p[0], +p[1], +p[2], +p[3]);
  }
  return out;
}

/**
 * The MakeHuman macro model: gender, age, muscle, weight, height, proportions, ethnic mix → target weights.
 * (makehuman/apps/humanmodifier.py MacroModifier semantics, linear interpolation between the named levels)
 */
export function macroTargets(dir, m) {
  const md = join(dir, "targets/macrodetails");
  const lv = (x, lo, mid, hi) => (x < 0.5 ? [[lo, 1 - x * 2], [mid, x * 2]] : [[mid, 2 - x * 2], [hi, x * 2 - 1]]);
  const gender = [["female", 1 - m.gender], ["male", m.gender]];
  // MakeHuman age: 0 = 1 y, 0.1875 = 11 y, 0.5 = 25 y, 1 = 90 y (adults only here: age >= 0.5)
  const age = m.age <= 0.5 ? [["young", 1]] : [["young", 1 - (m.age - 0.5) * 2], ["old", (m.age - 0.5) * 2]];
  const muscle = lv(m.muscle, "minmuscle", "averagemuscle", "maxmuscle");
  const weight = lv(m.weight, "minweight", "averageweight", "maxweight");
  const height = m.height >= 0.5 ? [["maxheight", (m.height - 0.5) * 2]] : [["minheight", (0.5 - m.height) * 2]];
  const ethnic = [["african", m.african], ["asian", m.asian], ["caucasian", m.caucasian]];
  const list = [];
  const add = (file, w) => {
    if (w > 1e-4 && existsSync(join(md, file))) list.push([join(md, file), w]);
  };
  for (const [g, gw] of gender)
    for (const [a, aw] of age) {
      for (const [e, ew] of ethnic) add(`${e}-${g}-${a}.target`, ew * gw * aw);
      for (const [mu, mw] of muscle)
        for (const [we, ww] of weight) {
          add(`universal-${g}-${a}-${mu}-${we}.target`, gw * aw * mw * ww);
          for (const [h, hw] of height) add(`height/${g}-${a}-${mu}-${we}-${h}.target`, gw * aw * mw * ww * hw);
          add(`proportions/${g}-${a}-${mu}-${we}-idealproportions.target`, gw * aw * mw * ww * m.proportions);
        }
    }
  return list;
}

/** base positions + Σ w·target */
export function morph(base, targets) {
  const out = Float64Array.from(base);
  for (const [file, w] of targets) {
    const t = readTarget(file);
    for (let i = 0; i < t.length; i += 4) {
      const k = t[i] * 3;
      out[k] += t[i + 1] * w;
      out[k + 1] += t[i + 2] * w;
      out[k + 2] += t[i + 3] * w;
    }
  }
  return out;
}

export function readSkeleton(dir) {
  const skel = JSON.parse(readFileSync(join(dir, "rigs/default.mhskel"), "utf8"));
  const weights = JSON.parse(readFileSync(join(dir, "rigs/default_weights.mhw"), "utf8")).weights;
  return { skel, weights };
}

/** a joint's position: the mean of its reference vertices (dm) */
export function jointPos(skel, pos, name) {
  const ids = skel.joints[name];
  let x = 0,
    y = 0,
    z = 0;
  for (const i of ids) {
    x += pos[i * 3];
    y += pos[i * 3 + 1];
    z += pos[i * 3 + 2];
  }
  return [x / ids.length, y / ids.length, z / ids.length];
}

// runs in the page: find overlapping horizontal surfaces at (almost) the same height in the visible scene
window.__zscan = function (opts = {}) {
  const root = window.__gkProbe.root;
  const maxY = opts.maxY ?? 1.5, tol = opts.tol ?? 0.004, cell = 2;
  const tris = [];
  const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const v = [0, 0, 0].map(() => ({ x: 0, y: 0, z: 0 }));
  root.updateMatrixWorld(true);
  let meshId = 0;
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || !shown(o) || (o.layers.mask & 1) === 0) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((m) => m.polygonOffset || m.transparent && m.opacity < 0.5 || !m.depthWrite && !m.depthTest)) return;
    const g = o.geometry, pos = g.attributes.position; if (!pos) return;
    const idx = g.index, n = idx ? idx.count : pos.count, e = o.matrixWorld.elements;
    const id = ++meshId, name = (o.name || o.parent?.name || o.type) + ":" + (mats[0].name || mats[0].type) + ":" + (mats[0].color ? mats[0].color.getHexString() : "");
    const inst = o.isInstancedMesh ? o.count : 1;
    for (let k = 0; k < inst; k++) {
      let M = e;
      if (o.isInstancedMesh) { const m = new o.matrixWorld.constructor(); o.getMatrixAt(k, m); m.premultiply(o.matrixWorld); M = m.elements; }
      for (let t = 0; t + 2 < n; t += 3) {
        for (let j = 0; j < 3; j++) {
          const i = idx ? idx.getX(t + j) : t + j;
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          v[j].x = M[0] * x + M[4] * y + M[8] * z + M[12]; v[j].y = M[1] * x + M[5] * y + M[9] * z + M[13]; v[j].z = M[2] * x + M[6] * y + M[10] * z + M[14];
        }
        const y0 = v[0].y; if (y0 > maxY || y0 < -0.1) continue;
        if (Math.abs(v[1].y - y0) > 1e-4 || Math.abs(v[2].y - y0) > 1e-4) continue;
        const cr = (v[1].z - v[0].z) * (v[2].x - v[0].x) - (v[1].x - v[0].x) * (v[2].z - v[0].z); // >0: facing up (CCW seen from above)
        const area = Math.abs(cr) / 2;
        if (area < 1e-3 || cr <= 0) continue;
        tris.push({ id, name, y: y0, x0: Math.min(v[0].x, v[1].x, v[2].x), x1: Math.max(v[0].x, v[1].x, v[2].x), z0: Math.min(v[0].z, v[1].z, v[2].z), z1: Math.max(v[0].z, v[1].z, v[2].z) });
      }
    }
  });
  const grid = new Map();
  tris.forEach((t, i) => { for (let gx = Math.floor(t.x0 / cell); gx <= Math.floor(t.x1 / cell); gx++) for (let gz = Math.floor(t.z0 / cell); gz <= Math.floor(t.z1 / cell); gz++) { const k = gx + "," + gz; (grid.get(k) ?? grid.set(k, []).get(k)).push(i); } });
  const hits = new Map();
  for (const [, list] of grid) {
    if (list.length > 4000) continue;
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const A = tris[list[a]], B = tris[list[b]];
      if (A.name === B.name) continue;
      if (Math.abs(A.y - B.y) > tol) continue;
      const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), oz = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0);
      if (ox < 0.05 || oz < 0.05) continue;
      const key = [A.name, B.name].sort().join(" | ") + " @y" + A.y.toFixed(3) + "/" + B.y.toFixed(3);
      const h = hits.get(key) ?? hits.set(key, { n: 0, x: (Math.max(A.x0, B.x0) + Math.min(A.x1, B.x1)) / 2, z: (Math.max(A.z0, B.z0) + Math.min(A.z1, B.z1)) / 2 }).get(key);
      h.n++;
    }
  }
  return { tris: tris.length, hits: [...hits.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, opts.top ?? 40).map(([k, h]) => `${h.n}\t(${h.x.toFixed(1)}, ${h.z.toFixed(1)})\t${k}`) };
};

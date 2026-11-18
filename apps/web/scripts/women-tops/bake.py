"""Step 3: bake the folds and export one top for the phone.

    blender -b apps/web/scripts/women-tops/work/<kind>.blend -P apps/web/scripts/women-tops/bake.py -- --kind tee

  1. UVs for the low garment (smart project, one island set in 0..1) and the bare-arm skin;
  2. Cycles bakes: the dense simulation's folds into a tangent-space normal map of the low garment (selected to
     active, rays from a 1 cm cage), and ambient occlusion of the garment on the body (the armpits, under the bust,
     the folds' own valleys). Packed into one texture: R, G = the normal's x, y (z is rebuilt), B = occlusion;
  3. a far version (decimated to ~40 %) of the garment and of the skin;
  4. the binary file the runtime reads (women-tops.ts parseTopAsset): quantised positions / normals / UVs, skin
     weights by bone name, in the body geometry's own bind space (three.js).
Writes work/out/wt-<kind>.bin and work/out/wt-<kind>.png (publish.mjs turns it into WebP).
"""
import math
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
from common import WORK, Matrix, Vector, apply_mod, args, copy_object, link, log, read_json, write_json  # noqa: E402

A = args({"kind": "tee", "size": 512, "samples": 128, "far": 0.4})
kind = A["kind"]
lo = bpy.data.objects[f"{kind}_lo"]
hi = bpy.data.objects.get(f"{kind}_hi")
skin = bpy.data.objects.get(f"{kind}_skin")
under = bpy.data.objects.get(f"{kind}_under")
band = bpy.data.objects.get(f"{kind}_band")
form = bpy.data.objects["form"]
prep = read_json(os.path.join(WORK, "prep.json"))
info = read_json(os.path.join(WORK, f"{kind}.json"))
BW = Matrix(prep["body_matrix_world"])
BWI = BW.inverted()
BR = BWI.to_3x3()
OUT = os.path.join(WORK, "out")
os.makedirs(OUT, exist_ok=True)
scene = bpy.context.scene
for o in bpy.data.objects:
    if o.type == "MESH":
        o.hide_render = o not in (lo, hi, form)
        o.hide_set(False)


def unwrap(ob, margin=0.01):
    # (the form's voxel remesh carried the body's UVs over as a point attribute: start from a clean corner UV map)
    me = ob.data
    for name in [a.name for a in me.attributes if a.data_type == "FLOAT2" or a.name.lower().startswith("uvmap")]:
        if name in me.attributes:
            me.attributes.remove(me.attributes[name])
    me.uv_layers.new(name="UVMap")
    me.uv_layers.active = me.uv_layers["UVMap"]
    hem = ob.data.attributes.get("hem")
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(72), island_margin=margin, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    # the islands move up / right by 5 %: the corner [0, 0.05]^2 stays a flat patch (normal up, no occlusion). The hem
    # lips and facings keep their own islands next to the cloth they turn from (the bake source has them too; a
    # separate patch for them broke the weave into beads along every edge)
    uvl = ob.data.uv_layers.active.data
    for p in ob.data.polygons:
        for li in p.loop_indices:
            u, v = uvl[li].uv
            uvl[li].uv = (0.05 + u * 0.95, 0.05 + v * 0.95)


def triangulate(ob):
    m = ob.modifiers.new("tri", "TRIANGULATE")
    apply_mod(ob, m)


triangulate(lo)
unwrap(lo)
for o in (skin, under, band):
    if o:
        triangulate(o)
        unwrap(o, 0.02)

# ---- bake
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = A["samples"]
img = bpy.data.images.new(f"wt_{kind}_n", A["size"], A["size"], alpha=False, float_buffer=False)
img.colorspace_settings.name = "Non-Color"
ao = bpy.data.images.new(f"wt_{kind}_ao", A["size"], A["size"], alpha=False, float_buffer=False)
ao.colorspace_settings.name = "Non-Color"
mat = bpy.data.materials.new(f"wt_{kind}")
mat.use_nodes = True
nt = mat.node_tree
tex = nt.nodes.new("ShaderNodeTexImage")
lo.data.materials.clear()
lo.data.materials.append(mat)
for o in (hi, form):
    if o and not o.data.materials:
        o.data.materials.append(bpy.data.materials.new("plain"))
bake = scene.render.bake
bake.margin = 6
if hi:
    # the bake source: the low garment made smooth (two Catmull-Clark levels) and laid onto the dense simulation where
    # it is within 8 mm along its normal: its fine folds where they match, a smooth surface (no facets) elsewhere
    src = copy_object(lo, f"{kind}_bake_src")
    src.data.materials.clear()
    src.data.materials.append(bpy.data.materials.new("plain_src"))
    hemg = src.vertex_groups.new(name="cloth")
    ha = src.data.attributes.get("hem")
    cloth_v = set()
    for p in src.data.polygons:
        if not (ha and ha.data[p.index].value):
            cloth_v.update(p.vertices)
    hemg.add(list(cloth_v), 1.0, "REPLACE")
    ss = src.modifiers.new("smooth", "SUBSURF")
    ss.levels = 2
    apply_mod(src, ss)
    sw = src.modifiers.new("onto", "SHRINKWRAP")
    sw.target = hi
    sw.wrap_method = "PROJECT"
    sw.use_negative_direction = True
    sw.use_positive_direction = True
    sw.project_limit = 0.008
    sw.vertex_group = "cloth"
    apply_mod(src, sw)
    src.hide_render = False
    hi.hide_render = True
    tex.image = img
    nt.nodes.active = tex
    for o in bpy.data.objects:
        o.select_set(False)
    src.select_set(True)
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    bake.use_selected_to_active = True
    bake.cage_extrusion = 0.012
    bake.max_ray_distance = 0.03
    bake.normal_space = "TANGENT"
    bpy.ops.object.bake(type="NORMAL")
    log("baked normals")
for o in (hi, bpy.data.objects.get(f"{kind}_bake_src")):
    if o:
        o.hide_render = True
tex.image = ao
nt.nodes.active = tex
for o in bpy.data.objects:
    o.select_set(False)
lo.select_set(True)
bpy.context.view_layer.objects.active = lo
bake.use_selected_to_active = False
scene.world = scene.world or bpy.data.worlds.new("w")
scene.world.light_settings.distance = 0.07
bpy.ops.object.bake(type="AO")
log("baked occlusion")
_a = ao.pixels[:]
_n = img.pixels[:]
log("ao nonzero texels", sum(1 for i in range(0, len(_a), 4) if _a[i] > 0.01), "normal non-flat", sum(1 for i in range(0, len(_n), 4) if abs(_n[i] - 0.5) > 0.02))
uvs = lo.data.uv_layers.active.data
log("uv range", min(l.uv[0] for l in uvs), max(l.uv[0] for l in uvs), "layers", [u.name for u in lo.data.uv_layers])
# pack: R G normal xy, B occlusion
n = list(img.pixels) if hi else [0.5, 0.5, 1.0, 1.0] * (A["size"] * A["size"])
import numpy as np  # noqa: E402

# the occlusion softened (normalised blur over the baked texels only: the islands keep their edges)
_ao = np.array(ao.pixels[:]).reshape(A["size"], A["size"], 4)[:, :, 0]
_m = (_ao > 0.001).astype(np.float64)


def _blur(x, r=3):
    k = np.exp(-np.arange(-r, r + 1) ** 2 / (2 * (r / 2) ** 2))
    k /= k.sum()
    y = np.apply_along_axis(lambda row: np.convolve(row, k, mode="same"), 1, x)
    return np.apply_along_axis(lambda col: np.convolve(col, k, mode="same"), 0, y)


_aob = _blur(_ao * _m) / np.maximum(_blur(_m), 1e-4)
_aob = np.where(_m > 0, _aob, 0.0)
a = np.repeat(_aob.reshape(-1, 1), 4, axis=1).reshape(-1).tolist()
out = bpy.data.images.new(f"wt_{kind}", A["size"], A["size"], alpha=False)
out.colorspace_settings.name = "Non-Color"
px = [0.0] * len(n)
S = A["size"]
for i in range(0, len(n), 4):
    k = i // 4
    x, y = k % S, k // S
    if x < S * 0.05 and y < S * 0.05:
        px[i], px[i + 1], px[i + 2], px[i + 3] = 0.5, 0.5, 1.0, 1.0
        continue
    px[i] = n[i]
    px[i + 1] = n[i + 1]
    px[i + 2] = a[i]
    px[i + 3] = 1.0
out.pixels = px
out.filepath_raw = os.path.join(OUT, f"wt-{kind}.png")
out.file_format = "PNG"
out.save()
log("wrote", out.filepath_raw)
ims = scene.render.image_settings
ims.file_format = "WEBP"
ims.color_mode = "RGB"
ims.quality = 88
ims.color_management = "OVERRIDE"
ims.view_settings.view_transform = "Standard"
ims.display_settings.display_device = "sRGB"
out.save_render(os.path.join(OUT, f"wt-{kind}.webp"), scene=scene)
log("wrote webp", os.path.getsize(os.path.join(OUT, f"wt-{kind}.webp")))

# ---- far versions
def far_copy(ob, ratio):
    f = copy_object(ob, ob.name + "_far")
    d = f.modifiers.new("dec", "DECIMATE")
    d.ratio = ratio
    d.use_collapse_triangulate = True
    apply_mod(f, d)
    return f


lo_far = far_copy(lo, A["far"])
# the skin and the trousers band are mostly hidden: lighter (the bare arms keep enough rings to stay round)
for o in (skin, under):
    if o:
        d = o.modifiers.new("dec", "DECIMATE")
        d.ratio = 0.55
        d.use_collapse_triangulate = True
        apply_mod(o, d)
skin_far = far_copy(skin, 0.45) if skin else None
under_far = far_copy(under, 0.5) if under else None


# ---- export
def part(ob, bones):
    me = ob.data
    # sharp where the hem turns (the lip meets the cloth at ~90 degrees): smooth normals across it shaded every edge
    # as a dark band
    me.set_sharp_from_angle(angle=math.radians(50))
    me.calc_loop_triangles()
    cn = me.corner_normals
    uvl = me.uv_layers.active.data if me.uv_layers.active else None
    vg = {g.index: g.name.replace(" ", "_") for g in ob.vertex_groups}
    key = {}
    verts = []  # (vertex index, uv)
    idx = []
    for tri in me.loop_triangles:
        for li in tri.loops:
            vi = me.loops[li].vertex_index
            uv = tuple(round(c, 5) for c in uvl[li].uv) if uvl else (0.0, 0.0)
            nk = tuple(round(c, 3) for c in cn[li].vector)
            k = (vi, uv, nk)
            if k not in key:
                key[k] = len(verts)
                verts.append(k)
            idx.append(key[k])
    # winding: three.js front faces are counter-clockwise, Blender's too; the axis change (x, z, -y) is a rotation
    pos, nrm, uvs, ji, jw = [], [], [], [], []
    me.update()
    for vi, uv, nk in verts:
        v = me.vertices[vi]
        p = BWI @ v.co
        q = (BR @ Vector(nk)).normalized()
        pos.append((p.x, p.z, -p.y))
        nrm.append((q.x, q.z, -q.y))
        uvs.append((uv[0], 1.0 - uv[1]))
        gs = sorted(((vg[g.group], g.weight) for g in v.groups if g.group in vg and g.weight > 0 and vg[g.group] != "pin"), key=lambda x: -x[1])[:4]
        tot = sum(w for _, w in gs) or 1.0
        js, ws = [], []
        for name, w in gs:
            if name not in bones:
                bones.append(name)
            js.append(bones.index(name))
            ws.append(w / tot)
        while len(js) < 4:
            js.append(0)
            ws.append(0.0)
        # weights to bytes summing to 255
        b = [int(round(w * 255)) for w in ws]
        b[0] += 255 - sum(b)
        ji.append(js)
        jw.append(b)
    return dict(pos=pos, nrm=nrm, uv=uvs, ji=ji, jw=jw, idx=idx)


bones = []
parts = [(0, part(lo, bones)), (1, part(lo_far, bones))]
if skin:
    parts += [(2, part(skin, bones)), (3, part(skin_far, bones))]
if under:
    parts += [(4, part(under, bones)), (5, part(under_far, bones))]
if band:
    parts += [(6, part(band, bones)), (7, part(band, bones))]
# the hem height (lowest garment point) and the trousers cover line in the body's bind space (three.js y)
hem_y = min(p[1] for p in parts[0][1]["pos"])
# UV metres: mean |dUV| / |dP| over the garment's edges (the weave's scale)
me = lo.data
uvl = me.uv_layers.active.data
num = den = 0.0
for poly in me.polygons:
    ls = list(poly.loop_indices)
    for a_, b_ in zip(ls, ls[1:] + ls[:1]):
        va, vb = me.loops[a_].vertex_index, me.loops[b_].vertex_index
        dp = (me.vertices[va].co - me.vertices[vb].co).length
        du = (Vector(uvl[a_].uv) - Vector(uvl[b_].uv)).length
        if dp > 1e-5:
            num += du
            den += dp
uv_per_m = num / max(den, 1e-6)


def pack(parts, bones):
    allp = [p for _, d in parts for p in d["pos"]]
    lo3 = [min(p[i] for p in allp) for i in range(3)]
    hi3 = [max(p[i] for p in allp) for i in range(3)]
    b = bytearray()
    b += b"GKWT"
    b += struct.pack("<II", 1, len(bones))
    for name in bones:
        e = name.encode("utf8")
        b += struct.pack("<B", len(e)) + e
    while len(b) % 4:
        b += b"\0"
    b += struct.pack("<6f", *lo3, *hi3)
    b += struct.pack("<I", len(parts))
    for pid, d in parts:
        nv, ni = len(d["pos"]), len(d["idx"])
        b += struct.pack("<III", pid, nv, ni)
        for p in d["pos"]:
            b += struct.pack("<3H", *[int(round((p[i] - lo3[i]) / max(hi3[i] - lo3[i], 1e-6) * 65535)) for i in range(3)]) + b"\0\0"
        for q in d["nrm"]:
            b += struct.pack("<4b", *[max(-127, min(127, int(round(c * 127)))) for c in q], 0)
        for uv in d["uv"]:
            b += struct.pack("<2H", *[max(0, min(65535, int(round(c * 65535)))) for c in uv])
        for j in d["ji"]:
            b += struct.pack("<4B", *j)
        for w in d["jw"]:
            b += struct.pack("<4B", *w)
        fmt = "<%dH" % ni if nv < 65536 else "<%dI" % ni
        b += struct.pack(fmt, *d["idx"])
        while len(b) % 4:
            b += b"\0"
    return bytes(b)


blob = pack(parts, bones)
with open(os.path.join(OUT, f"wt-{kind}.bin"), "wb") as f:
    f.write(blob)
meta = {"kind": kind, "bytes": len(blob), "hem_y": round(hem_y, 4), "uv_per_m": round(uv_per_m, 4), "tris": {str(pid): len(d["idx"]) // 3 for pid, d in parts}, "verts": {str(pid): len(d["pos"]) for pid, d in parts}, "bones": len(bones)}
write_json(os.path.join(OUT, f"wt-{kind}.json"), meta)
log("exported", meta)

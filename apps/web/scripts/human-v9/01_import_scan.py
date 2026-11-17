"""Step 1: import a scanned, clothed person and clean it into one standing body.

    blender -b -P apps/web/scripts/human-v9/01_import_scan.py -- --input work/in/scans/<id>/source.glb \
        --out work/out/<id>/01-scan.blend --height 1.70 [--turn 0] [--base auto|none|<metres>] [--report r.json]

What it does (every decision is printed and written to --report):
  1. imports GLB / glTF / OBJ / FBX (boxer-v9/common.py importer), joins every mesh into one object "body", applies
     the file's transforms; Sketchfab splits big scans into several primitives, so coincident vertices are welded;
  2. makes +Z the tallest axis, then turns the body so the shoulders lie along X and the toes point to -Y (the feet
     are the most reliable "front" of a clothed scan: toes stick out past the ankle), plus --turn degrees;
  3. removes the ground / scan base: if the lowest few centimetres are much wider than the feet, everything below the
     height where the cross-section shrinks to foot size is cut (--base <m> forces a cut height, none skips it);
  4. drops loose debris (islands under 0.5 % of the vertices), fills the holes (open soles after the cut, the crown,
     armpits) and triangulates the fills;
  5. scales to --height metres (crown), puts the feet on z = 0 and the pelvis on x = y = 0;
  6. gives the body a principled material with its scan colour (image texture, or the vertex colours of a scan that
     has no UVs, which step 2 bakes into a texture), so the bake step can read the colour.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
from hcommon import Matrix, Vector, apply_transforms, args, band, bounds, centroid, ctx, fail, import_any, log, meshes, reset_scene, save, select_only, tris, world_verts, write_json  # noqa: E402

A = args({"input": None, "out": None, "height": 1.70, "turn": 0.0, "base": "auto", "report": ""})
reset_scene()
if not os.path.exists(A["input"]):
    fail(f"scan not found: {A['input']} (docs/design/human-v9/ASSET-SOURCES.md lists the free scans and how to fetch them)")
rep = {"input": A["input"]}
objs = import_any(os.path.abspath(A["input"]))
ms = meshes(objs)
if not ms:
    fail("no mesh in " + A["input"])
for o in objs:
    if o.type not in ("MESH",):
        continue
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
for o in [o for o in objs if o.type != "MESH"]:
    bpy.data.objects.remove(o, do_unlink=True)
for m in ms:
    if m.data.shape_keys:
        m.shape_key_clear()
apply_transforms(ms)
select_only(ms, ms[0])
with ctx(ms[0], ms):
    if len(ms) > 1:
        bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = body.data.name = "body"
with ctx(body):
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
rep["source_tris"] = tris(body)

# ---- 1. weld the primitive splits (scale-relative distance), drop loose debris
pts = world_verts(body)
lo, hi = bounds(pts)
size = max(hi - lo)
bm = bmesh.new()
bm.from_mesh(body.data)
n0 = len(bm.verts)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=size * 2e-6)
rep["welded"] = n0 - len(bm.verts)
# islands
bm.verts.ensure_lookup_table()
seen = set()
islands = []
for v in bm.verts:
    if v.index in seen:
        continue
    stack, isl = [v], []
    seen.add(v.index)
    while stack:
        a = stack.pop()
        isl.append(a)
        for e in a.link_edges:
            b = e.other_vert(a)
            if b.index not in seen:
                seen.add(b.index)
                stack.append(b)
    islands.append(isl)
islands.sort(key=len, reverse=True)
small = [isl for isl in islands[1:] if len(isl) < 0.005 * len(bm.verts)]
bmesh.ops.delete(bm, geom=[v for isl in small for v in isl], context="VERTS")
rep["debris_islands_removed"] = len(small)
rep["islands_kept"] = len(islands) - len(small)
bm.to_mesh(body.data)
bm.free()

# ---- 2. orientation: tallest axis -> Z
pts = world_verts(body)
lo, hi = bounds(pts)
ext = hi - lo
axis = max(range(3), key=lambda i: ext[i])
R = Matrix.Identity(4)
if axis == 0:
    R = Matrix.Rotation(math.radians(90), 4, "Y")
elif axis == 1:
    R = Matrix.Rotation(math.radians(-90), 4, "X")
if axis != 2:
    body.data.transform(R)
    log(f"turned the tallest axis ({'XYZ'[axis]}) up")
pts = [v.co.copy() for v in body.data.vertices]
lo, hi = bounds(pts)
H = hi.z - lo.z
# upside down? the feet band (lowest 10 %) is narrower than the shoulder band (75-85 %)
def width(ps):
    if not ps:
        return 0.0
    a, b = bounds(ps)
    return max(b.x - a.x, b.y - a.y)


feet_w = width(band(pts, lo.z, lo.z + 0.1 * H))
shoulder_w = width(band(pts, lo.z + 0.75 * H, lo.z + 0.85 * H))
head_w = width(band(pts, hi.z - 0.08 * H, hi.z))
if head_w > shoulder_w * 1.05 and feet_w > head_w:
    body.data.transform(Matrix.Rotation(math.pi, 4, "X"))
    log("the scan was upside down: flipped")
    pts = [v.co.copy() for v in body.data.vertices]
    lo, hi = bounds(pts)

# shoulders along X: compare the chest band's extents
chest = band(pts, lo.z + 0.70 * H, lo.z + 0.80 * H)
a, b = bounds(chest)
turn = 0.0
if (b.y - a.y) > (b.x - a.x):
    turn += 90.0
    body.data.transform(Matrix.Rotation(math.radians(90), 4, "Z"))
    pts = [v.co.copy() for v in body.data.vertices]
    lo, hi = bounds(pts)

# stand it up straight: a scan can be stored leaning (fwild's lean ~20 degrees forward); the feet-to-neck line
# becomes vertical (a pivot about the feet)
H = hi.z - lo.z
fc = centroid(band(pts, lo.z, lo.z + 0.08 * H))
nc = centroid(band(pts, lo.z + 0.80 * H, lo.z + 0.88 * H))
if fc is not None and nc is not None:
    v = nc - fc
    tilt = math.degrees(v.angle(Vector((0, 0, 1))))
    if tilt > 2.5:
        q = v.rotation_difference(Vector((0, 0, 1)))
        body.data.transform(Matrix.Translation(fc) @ q.to_matrix().to_4x4() @ Matrix.Translation(-fc))
        log(f"straightened a {tilt:.1f} degree lean")
        rep["lean_fixed_deg"] = round(tilt, 1)
        pts = [v.co.copy() for v in body.data.vertices]
        lo, hi = bounds(pts)

# ---- 3. the base (before the facing test: a base hides the feet)
cut = None
if A["base"] != "none":
    if A["base"] != "auto":
        cut = lo.z + float(A["base"])
    else:
        # cross-section width per 5 mm slice over the lowest 15 %
        step = 0.003 * H
        prof = []
        z = lo.z
        while z < lo.z + 0.15 * H:
            prof.append((z, width(band(pts, z, z + step))))
            z += step
        ref = max((w for z_, w in prof if lo.z + 0.08 * H <= z_ < lo.z + 0.12 * H), default=0.0)  # ankles / shins
        bottom = prof[0][1] if prof else 0.0
        if ref > 0 and bottom > 2.2 * ref:
            # the base: the slices that are much wider than the legs; cut just above the last of them
            last = max(z_ for z_, w in prof if w > 1.8 * ref and z_ < lo.z + 0.08 * H)
            cut = last + step * 1.5
            log(f"base found: bottom {bottom:.3f} vs legs {ref:.3f} wide -> cut at {cut - lo.z:.3f} above the lowest point")
    if cut is not None:
        bm = bmesh.new()
        bm.from_mesh(body.data)
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, cut), plane_no=(0, 0, 1), clear_inner=True)
        bm.to_mesh(body.data)
        bm.free()
        rep["base_cut_m"] = round(cut - lo.z, 4)
        pts = [v.co.copy() for v in body.data.vertices]
        lo, hi = bounds(pts)
rep["base_removed"] = cut is not None

# ---- 4. facing: toes forward (-Y). Per foot: the ankle-band centre vs the foot-band extremes along Y.
H = hi.z - lo.z
foot = band(pts, lo.z, lo.z + 0.035 * H)
ankle = band(pts, lo.z + 0.06 * H, lo.z + 0.09 * H)
score = 0.0
for side in (-1, 1):
    f = [p for p in foot if p.x * side > 0]
    k = [p for p in ankle if p.x * side > 0]
    if f and k:
        ay = centroid(k).y
        fy = [p.y for p in f]
        score += (max(fy) - ay) - (ay - min(fy))  # > 0: toes towards +Y
if score > 0:
    body.data.transform(Matrix.Rotation(math.pi, 4, "Z"))
    turn += 180.0
    log("turned 180 degrees: the toes pointed to +Y")
if A["turn"]:
    body.data.transform(Matrix.Rotation(math.radians(A["turn"]), 4, "Z"))
    turn += A["turn"]
rep["turn_deg"] = turn

# ---- 5. holes
bm = bmesh.new()
bm.from_mesh(body.data)
boundary = [e for e in bm.edges if e.is_boundary]
filled = bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
new_faces = filled.get("faces", [])
if new_faces:
    bmesh.ops.triangulate(bm, faces=new_faces)
rep["holes_filled"] = len(new_faces)
rep["boundary_edges_before"] = len(boundary)
bm.to_mesh(body.data)
bm.free()

# ---- 6. scale, floor, centre on the pelvis
pts = [v.co.copy() for v in body.data.vertices]
lo, hi = bounds(pts)
s = A["height"] / (hi.z - lo.z)
body.data.transform(Matrix.Scale(s, 4))
pts = [v.co.copy() for v in body.data.vertices]
lo, hi = bounds(pts)
mid_x = (lo.x + hi.x) / 2
pel = [p for p in band(pts, lo.z + 0.50 * (hi.z - lo.z), lo.z + 0.54 * (hi.z - lo.z)) if abs(p.x - mid_x) < 0.13]
c = centroid(pel) or (lo + hi) / 2
cx = (min(p.x for p in pel) + max(p.x for p in pel)) / 2 if pel else c.x
cy = (min(p.y for p in pel) + max(p.y for p in pel)) / 2 if pel else c.y
body.data.transform(Matrix.Translation((-cx, -cy, -lo.z)))
body.data.update()
for p in body.data.polygons:
    p.use_smooth = True

# ---- 7. material: principled, scan colour from the texture or the vertex colours
mat = body.active_material
has_uv = len(body.data.uv_layers) > 0
has_col = len(body.data.color_attributes) > 0
img = None
if mat and mat.use_nodes:
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image is not None:
            img = n.image
            break
for i in range(len(body.data.materials) - 1, 0, -1):
    body.data.materials.pop(index=i)
m = bpy.data.materials.new("scan")
m.use_nodes = True
nt = m.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Roughness"].default_value = 0.75
bsdf.inputs["Metallic"].default_value = 0.0
if img is not None and has_uv:
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    rep["colour"] = f"texture {img.size[0]}x{img.size[1]}"
elif has_col:
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = body.data.color_attributes[0].name
    nt.links.new(ca.outputs["Color"], bsdf.inputs["Base Color"])
    rep["colour"] = "vertex colours (baked to a texture in step 2)"
else:
    rep["colour"] = "none (grey)"
body.data.materials.clear()
body.data.materials.append(m)
for p in body.data.polygons:
    p.material_index = 0
rep["uv"] = has_uv
rep["tris"] = tris(body)
rep["height_m"] = round(hi.z - lo.z, 4)
log(f"body: {rep['tris']} triangles, {rep['height_m']} m, colour {rep['colour']}, base removed {rep['base_removed']}, holes filled {rep['holes_filled']}")
save(A["out"])
if A["report"]:
    write_json(A["report"], rep)

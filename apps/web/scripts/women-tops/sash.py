"""Step 2b (sash tops only): the sash, a band of the item's second colour worn over the right shoulder to the left hip.

    blender -b apps/web/scripts/women-tops/work/sash.blend -P apps/web/scripts/women-tops/sash.py

A ribbon laid onto the simulated top (so it carries the top's folds and moves with it): a grid along the sash's
centre line, every point cast onto the top from the front (front panel) or the back (back panel), lifted 3.5 mm off
it, straight clean edges, its borders turned under (2.5 mm lip). Skinned like the top under it (nearest vertex).
Writes object `sash_band` into the same file.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
from common import WORK, Vector, bone_heads, bvh_of, log  # noqa: E402
from mathutils.kdtree import KDTree  # noqa: E402

rig = bpy.data.objects["Bip01"]
lo = bpy.data.objects["sash_lo"]
J = bone_heads(rig)
neck = J["Bip01 Neck"]
hip_z = (J["Bip01 L Thigh"].z + J["Bip01 R Thigh"].z) / 2
right = 1 if J["Bip01 R UpperArm"].y > 0 else -1
# centre line in the side (y, z) plane: from the right shoulder (beside the neck) to the left hip
A0 = Vector((right * 0.095, neck.z - 0.03))
A1 = Vector((-right * 0.15, hip_z - 0.07))
HALF, LIFT, ROWS, COLS = 0.045, 0.0035, 40, 6
bvh = bvh_of(lo)
d2 = (A1 - A0).normalized()
side2 = Vector((-d2.y, d2.x))
bm = bmesh.new()
for panel, sign in (("front", -1), ("back", 1)):
    grid = []
    for r in range(ROWS + 1):
        s = r / ROWS
        row = []
        for c in range(COLS + 1):
            w = (c / COLS - 0.5) * 2 * HALF
            yz = A0 + (A1 - A0) * s + side2 * w
            origin = Vector((sign * 0.6 + 0.05, yz.x, yz.y))
            hit = bvh.ray_cast(origin, Vector((-sign, 0, 0)), 1.2)
            if hit[0] is None:
                row.append(None)
                continue
            p, n = hit[0], hit[1]
            if n.x * sign < 0:
                n = -n
            row.append(bm.verts.new(p + n * LIFT))
        grid.append(row)
    for r in range(ROWS):
        for c in range(COLS):
            q = [grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]]
            if all(q):
                # outward winding: front faces -x, back faces +x
                bm.faces.new(q if sign < 0 else q[::-1])
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.004)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.normal_update()
# keep the outward orientation (the first face of the front panel faces -x)
if bm.faces and sum(f.normal.x * (1 if f.calc_center_median().x < 0.03 else -1) for f in bm.faces) > 0:
    bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
bm.normal_update()
border_edges = [e for e in bm.edges if e.is_boundary]
nrm = {v: v.normal.copy() for e in border_edges for v in e.verts}
r = bmesh.ops.extrude_edge_only(bm, edges=border_edges)
for v in [g for g in r["geom"] if isinstance(g, bmesh.types.BMVert)]:
    o = next((e.other_vert(v) for e in v.link_edges if e.other_vert(v) in nrm), None)
    if o is not None:
        v.co = o.co - nrm[o] * 0.0025
me = bpy.data.meshes.new("sash_band")
bm.to_mesh(me)
bm.free()
band = bpy.data.objects.new("sash_band", me)
bpy.context.scene.collection.objects.link(band)
for g in lo.vertex_groups:
    band.vertex_groups.new(name=g.name)
kd = KDTree(len(lo.data.vertices))
for v in lo.data.vertices:
    kd.insert(v.co, v.index)
kd.balance()
names = {g.index: g.name for g in lo.vertex_groups}
for v in me.vertices:
    _co, i, _d = kd.find(v.co)
    for g in lo.data.vertices[i].groups:
        band.vertex_groups[names[g.group]].add([v.index], g.weight, "REPLACE")
for p in me.polygons:
    p.use_smooth = True
log(f"sash band: {len(me.polygons)} faces")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "sash.blend"))

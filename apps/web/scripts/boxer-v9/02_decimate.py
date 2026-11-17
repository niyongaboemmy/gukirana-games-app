"""Step 2: decimate the body to the phone budget and write the FBX you upload to Mixamo's auto-rigger.

UNTESTED: needs Blender (4.2+).

    blender -b work/out/m/01-body.blend -P apps/web/scripts/boxer-v9/02_decimate.py -- \
        --out work/out/m/02-body.blend --fbx work/out/m/body-for-mixamo.fbx [--target 19000] [--face-keep 0.5]

Budget (docs/design/boxer-v9/BLENDER-PIPELINE.md, "Triangle budget"): one fighter <= 35k triangles at LOD0, ~12k at
LOD1. The body gets ~19k of that (the face ~5k of it), the rest goes to singlet, trunks, gloves, shoes, headgear.
LOD1 is made from the finished, rigged fighter in step 8, so it shares the skeleton.

The untouched mesh is kept as the hidden object "body_hi": step 7 bakes its detail (pores, wrinkles, muscle
definition) into the low mesh's normal map, which is where most of the realism of a 20k body comes from.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from common import apply_modifier, args, fail, log, save, select_only, tris  # noqa: E402

A = args({"out": None, "fbx": "", "target": 19000, "face_keep": 0.5})
body = bpy.data.objects.get("body")
if body is None:
    fail("no object named 'body' (run step 1 first)")
if body.data.shape_keys:
    fail("the body has shape keys: decimate before adding any (the Decimate modifier cannot be applied with them)")

hi = body.copy()
hi.data = body.data.copy()
hi.name = "body_hi"
bpy.context.collection.objects.link(hi)
hi.hide_render = True
hi.hide_set(True)

n0 = tris(body)
if n0 <= A["target"]:
    log(f"body already {n0} triangles <= {A['target']}: nothing to decimate")
else:
    # the face reads first: keep relatively more triangles above the chin (z > 88 % of the height)
    zmax = max(v.co.z for v in body.data.vertices)
    vg = body.vertex_groups.new(name="decimate_weight")
    for v in body.data.vertices:
        face = v.co.z > 0.88 * zmax
        vg.add([v.index], (1.0 - A["face_keep"]) if face else 1.0, "REPLACE")
    for _ in range(3):  # the ratio is not exact on scans: converge in a few passes
        n = tris(body)
        if n <= A["target"] * 1.02:
            break
        mod = body.modifiers.new("decimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = max(0.01, A["target"] / n)
        mod.use_symmetry = True
        mod.symmetry_axis = "X"
        mod.use_collapse_triangulate = False
        mod.vertex_group = vg.name
        # (check the face in the saved .blend: if it lost MORE detail than the body, flip this flag)
        mod.invert_vertex_group = False
        mod.vertex_group_factor = 1.0
        apply_modifier(body, mod)
    body.vertex_groups.remove(vg)
log(f"body: {n0} -> {tris(body)} triangles (target {A['target']})")

for p in body.data.polygons:
    p.use_smooth = True
save(A["out"])

if A["fbx"]:
    # Mixamo's auto-rigger wants one plain mesh in a T- or A-pose, no skeleton
    os.makedirs(os.path.dirname(os.path.abspath(A["fbx"])), exist_ok=True)
    select_only([body])
    bpy.ops.export_scene.fbx(
        filepath=os.path.abspath(A["fbx"]),
        use_selection=True,
        object_types={"MESH"},
        apply_unit_scale=True,
        add_leaf_bones=False,
        path_mode="COPY",
        embed_textures=True,
    )
    log("wrote", A["fbx"], "- upload this file at mixamo.com (Upload Character)")

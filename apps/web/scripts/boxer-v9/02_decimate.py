"""Step 2: decimate the body to the phone budget and write the FBX you upload to Mixamo's auto-rigger.

Verified on Blender 5.2.4 (P3-FGT-22, test body).

    blender -b work/out/m/01-body.blend -P apps/web/scripts/boxer-v9/02_decimate.py -- \
        --out work/out/m/02-body.blend --fbx work/out/m/body-for-mixamo.fbx [--target 19000] [--face-tris 5000] [--unwrap]

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
from common import apply_modifier, args, ctx, fail, log, save, select_only, tris  # noqa: E402

A = args({"out": None, "fbx": "", "target": 19000, "face_tris": 5000, "unwrap": False})
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

def face_tris(o):
    """triangles above the chin (z > 88 % of the height): the face and the head"""
    zmax = max(v.co.z for v in o.data.vertices)
    return sum(len(p.vertices) - 2 for p in o.data.polygons if p.center.z > 0.88 * zmax)


def collapse(target, face_first):
    """Collapse decimation to `target` triangles. Blender 5.2 (measured on the test body): with a vertex group, a
    vertex of weight 1 is collapsed first and weight 0 is protected. So face_first decimates only the head, else only
    the rest. A few passes, as the ratio is not exact."""
    zmax = max(v.co.z for v in body.data.vertices)
    vg = body.vertex_groups.new(name="decimate_weight")
    vg_name = vg.name
    for v in body.data.vertices:
        vg.add([v.index], 1.0 if (v.co.z > 0.88 * zmax) == face_first else 0.0, "REPLACE")
    for _ in range(4):
        n = tris(body)
        if n <= target * 1.01:
            break
        mod = body.modifiers.new("decimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = max(0.01, target / n)
        mod.use_symmetry = True
        mod.symmetry_axis = "X"
        mod.use_collapse_triangulate = False
        mod.vertex_group = vg_name
        mod.invert_vertex_group = False
        mod.vertex_group_factor = 1.0
        apply_modifier(body, mod)
    body.vertex_groups.remove(body.vertex_groups[vg_name])  # (5.2: the Python handle dies with the modifier apply)


n0, f0 = tris(body), face_tris(body)
if n0 <= A["target"]:
    log(f"body already {n0} triangles <= {A['target']}: nothing to decimate")
else:
    # the face reads first: it gets its own budget (--face-tris), the rest of the body the remainder
    face_target = min(f0, A["face_tris"])
    if f0 > face_target:
        collapse(n0 - (f0 - face_target), face_first=True)
    collapse(A["target"], face_first=False)
log(f"body: {n0} -> {tris(body)} triangles (target {A['target']}); head {f0} -> {face_tris(body)} (target {A['face_tris']})")

for p in body.data.polygons:
    p.use_smooth = True
if A["unwrap"]:
    # (P3-FGT-22) new non-overlapping UVs for the low body: the v8 test body's MakeHuman UVs overlap (eyes, teeth,
    # tongue and the skin share texels), which baked into garbage patches. A MetaHuman / scan keeps its own UVs.
    select_only([body])
    with ctx(body):
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.004)
        bpy.ops.object.mode_set(mode="OBJECT")
    log("body: new UVs (smart project)")
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

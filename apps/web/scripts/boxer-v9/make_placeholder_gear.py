"""Placeholder gear for testing the pipeline without a downloaded scan (P3-FGT-22). Not for shipping.

    blender -b --factory-startup -P apps/web/scripts/boxer-v9/make_placeholder_gear.py -- \
        --out work/in/gear/placeholder/glove.glb [--kind glove]

glove: a 12 oz boxing-glove shape built from primitives in the canonical frame 06_fit_gear.py expects (length along
+Z, cuff at the bottom, knuckles at the top, thumb towards +X): a padded fist (a squashed sphere), a cuff (a short
tube), a thumb bump, joined with a voxel remesh into one closed surface, then smoothed. About 0.30 m long. It has
enough geometry to exercise the fit, the decimation, the UV unwrap, the bake and the export, and nothing else: the
real gloves come from a scan (ASSET-SOURCES.md).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from common import apply_modifier, args, ctx, fail, log, reset_scene, select_only, tris  # noqa: E402

A = args({"out": None, "kind": "glove"})
if A["kind"] != "glove":
    fail("only --kind glove is made here")
reset_scene()


def sphere(name, loc, scale):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1.0, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    return o


def tube(name, loc, r, depth):
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=r, depth=depth, location=loc)
    o = bpy.context.active_object
    o.name = name
    return o


fist = sphere("fist", (0, 0, 0.19), (0.062, 0.072, 0.10))  # the padded fist, knuckles at the top (z ~ 0.29)
palm = sphere("palm", (0, 0, 0.13), (0.058, 0.064, 0.075))
thumb = sphere("thumb", (0.055, -0.022, 0.15), (0.026, 0.028, 0.07))
cuff = tube("cuff", (0, 0, 0.055), 0.052, 0.11)  # cuff from z ~ 0 to 0.11
parts = [fist, palm, thumb, cuff]
select_only(parts, fist)
with ctx(fist, parts):
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.join()
glove = bpy.context.view_layer.objects.active
glove.name = "glove"
rm = glove.modifiers.new("remesh", "REMESH")
rm.mode = "VOXEL"
rm.voxel_size = 0.004
apply_modifier(glove, rm)
sm = glove.modifiers.new("smooth", "CORRECTIVE_SMOOTH")
sm.iterations = 8
sm.use_only_smooth = True
apply_modifier(glove, sm)
for p in glove.data.polygons:
    p.use_smooth = True
mat = bpy.data.materials.new("glove_leather")
mat.diffuse_color = (0.55, 0.05, 0.06, 1.0)
glove.data.materials.append(mat)
with ctx(glove):
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)  # (no node offset in the GLB)
zmin = min(v.co.z for v in glove.data.vertices)
for v in glove.data.vertices:
    v.co.z -= zmin
log(f"placeholder glove: {tris(glove)} triangles, {max(v.co.z for v in glove.data.vertices):.3f} m long")
os.makedirs(os.path.dirname(os.path.abspath(A["out"])), exist_ok=True)
select_only([glove])
bpy.ops.export_scene.gltf(filepath=os.path.abspath(A["out"]), export_format="GLB", use_selection=True, export_yup=True)
log("wrote", A["out"])

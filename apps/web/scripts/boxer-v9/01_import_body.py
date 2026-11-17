"""Step 1: import the source body (MetaHuman full-body FBX, or a scanned body) into a clean .blend.

UNTESTED: needs Blender (4.2+). Run through run.mjs, or:

    blender -b -P apps/web/scripts/boxer-v9/01_import_body.py -- \
        --input work/in/metahuman/boxer_m_full.fbx --out work/out/m/01-body.blend [--height 1.80] [--keep-skeleton]

What it does:
  1. imports the file; joins all its meshes into one object named "body" (MetaHuman exports head and body as two
     skeletal meshes; a scan is usually one mesh). Hair-card / eyebrow / eyelash meshes are kept as separate objects
     when their names contain hair, brow, lash or groom (they are re-attached in step 6);
  2. drops the source skeleton unless --keep-skeleton (the default route re-rigs with Mixamo, which needs a plain mesh);
  3. applies rotation / scale, puts the feet on z = 0, centres the body on x = y = 0 and turns it to face -Y;
  4. optionally scales it to --height metres (crown height, A-pose);
  5. prints the triangle count and saves the .blend.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from common import Vector, apply_transforms, args, armature, ctx, fail, import_any, log, meshes, reset_scene, save, select_only, tris  # noqa: E402

A = args({"input": None, "out": None, "height": 0.0, "keep_skeleton": False})
reset_scene()
objs = import_any(os.path.abspath(A["input"]))
ms = meshes(objs)
if not ms:
    fail("no mesh in " + A["input"])

# keep hair / brows / lashes apart (they become cards with alpha in later steps)
EXTRA = ("hair", "brow", "lash", "groom", "beard", "fuzz")
extra = [m for m in ms if any(k in m.name.lower() for k in EXTRA)]
skin = [m for m in ms if m not in extra]
# MetaHuman also exports eye / teeth / tongue / cartilage meshes: they stay inside the joined body
arm = armature(objs)
if arm is not None and not A["keep_skeleton"]:
    for m in ms:
        for mod in list(m.modifiers):
            if mod.type == "ARMATURE":
                m.modifiers.remove(mod)
        m.parent = None
        m.matrix_world = m.matrix_world.copy()
        for vg in list(m.vertex_groups):
            m.vertex_groups.remove(vg)
    bpy.data.objects.remove(arm, do_unlink=True)
    log("dropped the source skeleton and its weights (re-rigged in step 3)")

apply_transforms(ms)
select_only(skin, skin[0])
with ctx(skin[0], skin):
    if len(skin) > 1:
        bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = "body"
body.data.name = "body"

# feet on the floor, centred, facing -Y (MetaHuman and Mixamo already face -Y in Blender after FBX import; a scan
# may not: check the printed facing and pass the turn in pipeline.json -> gear/rotate if needed)
pts = [body.matrix_world @ v.co for v in body.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
height = hi.z - lo.z
if A["height"] > 0:
    s = A["height"] / height
    for m in ms:
        m.scale = (s, s, s)
    apply_transforms(ms)
    log(f"scaled {height:.3f} m -> {A['height']:.3f} m")
    pts = [body.matrix_world @ v.co for v in body.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
shift = Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
for m in ms:
    m.location += shift
apply_transforms(ms)
with ctx(body, ms):
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

# the nose is the most forward point of the head: it should be at -Y
head = [v.co for v in body.data.vertices if v.co.z > 0.9 * (hi.z - lo.z)]
nose_y = min(v.y for v in head) if head else 0.0
facing = "-Y (good)" if abs(nose_y) > 0 and nose_y < 0 else "+Y (turn the body 180 degrees about Z)"
log(f"body: {tris(body)} triangles, height {hi.z - lo.z:.3f} m, facing {facing}")
for e in extra:
    log(f"kept apart: {e.name} ({tris(e)} triangles)")
save(A["out"])

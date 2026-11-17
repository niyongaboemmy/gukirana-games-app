"""Step 6: export one person as a single GLB with three levels of detail on one skeleton (no animation, no images).

    blender -b work/out/<id>/04-clips.blend -P apps/web/scripts/human-v9/06_export.py -- \
        --out work/out/<id>/<id>.glb [--lod0 20000] [--lod1 6000] [--lod2 1500] [--report r.json]

The GLB holds the Bip01 skeleton and three skinned meshes named lod0 / lod1 / lod2 (collapse-decimated copies of the
rigged body, so they keep its UVs and skin weights). The runtime shows one of them by distance; the skeleton, the
clips and the textures are shared. Maps are not embedded: the runtime loads the KTX2 maps (2k desktop, 1k phone)
listed in maps.json, as the v8 boxers do. The clip library is exported separately, once, by the boxer export step
(boxer-v9/08_export.py --what clips, reused read-only).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from hcommon import RIG, apply_modifier, args, ctx, fail, log, select_only, tris, write_json  # noqa: E402

A = args({"out": None, "lod0": 20000, "lod1": 6000, "lod2": 1500, "report": ""})
rig = bpy.data.objects.get(RIG)
body = bpy.data.objects.get("body")
if rig is None or body is None:
    fail("no rig / body (run steps 1-4)")
for o in list(bpy.data.objects):
    if o.type == "MESH" and o is not body:
        bpy.data.objects.remove(o, do_unlink=True)
rig.animation_data_create()
rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.location = (0, 0, 0)
for a in list(bpy.data.actions):
    a.use_fake_user = False
    bpy.data.actions.remove(a)

# a clean material per mesh (the maps are applied at runtime)
m = bpy.data.materials.new("scan")
m.use_nodes = True
body.data.materials.clear()
body.data.materials.append(m)
if tris(body) > A["lod0"]:
    fail(f"LOD0 has {tris(body)} triangles > {A['lod0']}: lower --target in step 2")
body.name = "lod0"
lods = [body]
for name, target in (("lod1", A["lod1"]), ("lod2", A["lod2"])):
    c = body.copy()
    c.data = body.data.copy()
    c.name = name
    bpy.context.collection.objects.link(c)
    dec = c.modifiers.new("dec", "DECIMATE")
    dec.ratio = min(1.0, target / tris(c))
    with ctx(c):
        bpy.ops.object.modifier_move_to_index(modifier=dec.name, index=0)
    apply_modifier(c, dec)
    select_only([c])
    with ctx(c):
        bpy.ops.object.vertex_group_limit_total(limit=4)
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    lods.append(c)
rep = {o.name: tris(o) for o in lods}
log("LOD triangles:", rep)

os.makedirs(os.path.dirname(os.path.abspath(A["out"])), exist_ok=True)
select_only([rig] + lods, rig)
want = dict(
    filepath=os.path.abspath(A["out"]),
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_apply=False,
    export_skins=True,
    export_all_influences=False,
    export_morph=False,
    export_animations=False,
    export_image_format="NONE",
    export_materials="EXPORT",
    export_extras=False,
    export_def_bones=False,
)
known = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
bpy.ops.export_scene.gltf(**{k: v for k, v in want.items() if k in known})
rep["kb"] = os.path.getsize(A["out"]) // 1024
log(f"wrote {A['out']} ({rep['kb']} KB)")
if A["report"]:
    write_json(A["report"], rep)

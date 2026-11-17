"""Step 8: export the fighter (LOD0 + LOD1) and the shared clip library as GLB.

UNTESTED: needs Blender (4.2+, its bundled glTF exporter).

    blender -b work/out/m/07-baked.blend -P apps/web/scripts/boxer-v9/08_export.py -- \
        --what fighter --out work/out/m/boxer-m.glb [--lod1 work/out/m/boxer-m-lod1.glb] [--lod1-tris 12000]
    blender -b work/out/m/07-baked.blend -P apps/web/scripts/boxer-v9/08_export.py -- \
        --what clips --out work/out/clips/boxer-clips.glb

fighter: the skeleton + body, singlet, trunks, gloves, shoes, headgear, hair cards; skin weights and the cloth
correctives (morph targets); NO animation and NO images (the maps ship as separate KTX2 files, as v8 does, so the
phone picks 1k and the desktop 2k). It fails if LOD0 is over 35k triangles. LOD1 is a decimated copy without
morph targets and without the hidden hands / feet geometry, same skeleton.

clips: the skeleton and every action as a glTF animation (no mesh). Because every bone of our skeleton has an
identity bind rotation, the same quaternion tracks play on the male and the female fighter (only the root height
differs, and the runtime scales it), so the library is exported once.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from common import apply_modifier, args, fail, log, meshes, select_only, tris  # noqa: E402

A = args({"what": None, "out": None, "lod1": "", "lod1_tris": 12000, "max_tris": 35000})
rig = bpy.data.objects.get("boxer")
if rig is None:
    fail("no 'boxer' armature")


def gltf(path, objs, animations, morph):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    select_only(objs, rig)
    want = dict(
        filepath=os.path.abspath(path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_all_influences=False,  # 4 influences per vertex (three.js default)
        export_morph=morph,
        export_morph_normal=False,
        export_animations=animations,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_step=1,
        export_def_bones=False,
        export_image_format="NONE",
        export_materials="EXPORT",
        export_extras=False,
    )
    known = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    dropped = [k for k in want if k not in known]
    if dropped:
        log("this Blender's glTF exporter lacks:", ", ".join(dropped), "(skipped)")
    bpy.ops.export_scene.gltf(**{k: v for k, v in want.items() if k in known})
    log(f"wrote {path} ({os.path.getsize(path) // 1024} KB)")


SKIP = ("_hi", "_lo_guard", "_static")
parts = [o for o in meshes() if not o.name.endswith(SKIP) and o.parent == rig]

if A["what"] == "clips":
    acts = [a for a in bpy.data.actions if not a.name.startswith("_")]
    log(f"{len(acts)} clips:", ", ".join(sorted(a.name for a in acts)))
    gltf(A["out"], [rig], animations=True, morph=False)
elif A["what"] == "fighter":
    rig.animation_data_create()
    rig.animation_data.action = None
    total = sum(tris(o) for o in parts)
    for o in parts:
        log(f"  {o.name}: {tris(o)} triangles" + (f", {len(o.data.shape_keys.key_blocks) - 1} correctives" if o.data.shape_keys else ""))
    log(f"LOD0 total: {total} triangles (budget {A['max_tris']})")
    if total > A["max_tris"]:
        fail("over the phone budget: lower --target in steps 2 / 5 / 6")
    acts = list(bpy.data.actions)
    for a in acts:  # keep the fighter file free of animation
        a.use_fake_user = False
    gltf(A["out"], [rig] + parts, animations=False, morph=True)
    if A["lod1"]:
        lod = []
        for o in parts:
            c = o.copy()
            c.data = o.data.copy()
            bpy.context.collection.objects.link(c)
            if c.data.shape_keys:
                c.shape_key_clear()
            share = A["lod1_tris"] * tris(o) / total
            if tris(c) > share:
                dec = c.modifiers.new("lod1", "DECIMATE")
                dec.ratio = max(0.05, share / tris(c))
                with bpy.context.temp_override(object=c, active_object=c):
                    bpy.ops.object.modifier_move_to_index(modifier=dec.name, index=0)
                apply_modifier(c, dec)
            lod.append(c)
        log(f"LOD1 total: {sum(tris(o) for o in lod)} triangles")
        gltf(A["lod1"], [rig] + lod, animations=False, morph=False)
        for c in lod:
            bpy.data.objects.remove(c, do_unlink=True)
    for a in acts:
        a.use_fake_user = True
else:
    fail("--what is fighter or clips")

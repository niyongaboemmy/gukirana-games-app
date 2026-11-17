"""Step 7: bake the detailed sources onto the budget meshes: normal, base colour, AO, roughness at 2k, plus 1k copies.

Verified on Blender 5.2.4 (P3-FGT-22, test body, 1k maps, 16 samples: 15 s on an M2 Pro CPU). Cycles; Metal GPU is faster.

    blender -b work/out/m/06-gear.blend -P apps/web/scripts/boxer-v9/07_bake.py -- \
        --out-dir work/out/m/maps --out work/out/m/07-baked.blend --plan work/out/m/ktx2-plan.json \
        [--pairs body_hi:body,glove_L_hi:glove_L,glove_R_hi:glove_R,headgear_hi:headgear,singlet_hi_guard:singlet_lo_guard,trunks_hi_guard:trunks_lo_guard] \
        [--maps normal,color,ao,roughness] [--size 2048] [--rough-min 0.42]

Each pair is <high>:<low>. The low mesh's own UVs are used; a low mesh with several materials (MetaHuman head +
body) gets one map set per material. Garment pairs bake only the normal map (wrinkles of the dense guard drape); the
fabric colour is a flat colour + weave detail in the runtime material. --rough-min clamps the BODY roughness from
below: the v8 skin looked shiny, real skin under arena light is matte except the sweaty forehead / shoulders, which
the runtime sweat map (P3-FGT-19B) adds back.

Writes PNGs to --out-dir (<low>-<material>-<map>.png and -1k.png) and the job list for
apps/web/scripts/boxer/ktx2.mjs --plan (colour -> ETC1S, normal -> UASTC normal, AO / roughness -> UASTC linear).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from common import args, fail, log, save, select_only, write_json  # noqa: E402

DEFAULT_PAIRS = "body_hi:body,glove_L_hi:glove_L,glove_R_hi:glove_R,headgear_hi:headgear,singlet_hi_guard:singlet_lo_guard,trunks_hi_guard:trunks_lo_guard"
A = args({"out_dir": None, "out": "", "plan": "", "pairs": DEFAULT_PAIRS.split(","), "maps": ["normal", "color", "ao", "roughness"], "size": 2048, "rough_min": 0.42, "samples": 64})
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = A["samples"]
bake = scene.render.bake
bake.use_selected_to_active = True
bake.use_cage = False
bake.cage_extrusion = 0.012
bake.max_ray_distance = 0.03
bake.margin = 8
os.makedirs(A["out_dir"], exist_ok=True)

TYPE = {"normal": "NORMAL", "color": "DIFFUSE", "ao": "AO", "roughness": "ROUGHNESS"}
plan = []


def target_node(mat, img):
    if mat.node_tree is None:
        mat.use_nodes = True
    nt = mat.node_tree
    node = nt.nodes.get("_bake") or nt.nodes.new("ShaderNodeTexImage")
    node.name = "_bake"
    node.image = img
    for n in nt.nodes:
        n.select = False
    node.select = True
    nt.nodes.active = node


for pair in A["pairs"]:
    hi_name, lo_name = pair.split(":")
    hi, lo = bpy.data.objects.get(hi_name), bpy.data.objects.get(lo_name)
    if hi is None or lo is None:
        log(f"SKIP {pair}: object missing")
        continue
    garment = lo_name.endswith("_lo_guard")
    maps = ["normal"] if garment else A["maps"]
    for o in (hi, lo):
        o.hide_set(False)
        o.hide_render = False
    if not lo.data.materials:
        lo.data.materials.append(bpy.data.materials.new(lo_name))
    for m in maps:
        imgs = {}
        for slot in lo.material_slots:
            mat = slot.material
            img = bpy.data.images.new(f"{lo_name}-{mat.name}-{m}", A["size"], A["size"], alpha=False, float_buffer=(m == "normal"))
            img.colorspace_settings.name = "sRGB" if m == "color" else "Non-Color"
            target_node(mat, img)
            imgs[mat.name] = img
        select_only([hi, lo], lo)
        kw = {"type": TYPE[m]}
        if m == "color":
            kw["pass_filter"] = {"COLOR"}
        if m == "normal":
            kw["normal_space"] = "TANGENT"
        try:
            bpy.ops.object.bake(**kw)
        except RuntimeError as e:
            fail(f"bake {pair} {m}: {e}")
        for mname, img in imgs.items():
            if m == "roughness" and lo_name == "body" and A["rough_min"] > 0:
                px = list(img.pixels)
                for i in range(0, len(px), 4):
                    for c in range(3):
                        px[i + c] = max(px[i + c], A["rough_min"])
                img.pixels = px
            base = os.path.join(A["out_dir"], f"{lo_name.replace('_lo_guard', '')}-{mname}-{m}".replace(" ", "_"))
            img.filepath_raw = base + ".png"
            img.file_format = "PNG"
            img.save()
            small = img.copy()
            small.scale(A["size"] // 2, A["size"] // 2)
            small.filepath_raw = base + "-1k.png"
            small.file_format = "PNG"
            small.save()
            for suffix, sz in (("", A["size"]), ("-1k", A["size"] // 2)):
                plan.append(
                    {
                        "in": base + suffix + ".png",
                        "out": os.path.join(A["out_dir"], "ktx2", os.path.basename(base) + suffix + ".ktx2"),
                        "codec": "etc1s" if m == "color" else "uastc",
                        "linear": m != "color",
                        "normal": m == "normal",
                        "size": sz,
                        "object": lo_name.replace("_lo_guard", ""),
                        "map": m,
                        "variant": "desktop" if suffix == "" else "phone",
                    }
                )
            log(f"baked {base}.png")
    hi.hide_set(True)
    hi.hide_render = True

if A["plan"]:
    os.makedirs(os.path.join(A["out_dir"], "ktx2"), exist_ok=True)
    write_json(A["plan"], plan)
if A["out"]:
    save(A["out"])

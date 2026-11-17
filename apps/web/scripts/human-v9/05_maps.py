"""Step 5: the texture maps of one person, at 2k (desktop) and 1k (phone), plus the KTX2 job list.

    blender -b work/out/<id>/<latest>.blend -P apps/web/scripts/human-v9/05_maps.py -- \
        --out-dir work/out/<id>/maps --plan work/out/<id>/ktx2-plan.json --id <id>

A scan that was decimated in step 2 has had its colour and normal maps baked from the full scan by the boxer bake
step (boxer-v9/07_bake.py, reused read-only: <out-dir>/body-scan-color.png, body-scan-normal.png). A scan that was
already within the budget keeps its own UVs and photo texture: that texture is written out here unchanged (no
upscaling: a 1k source stays 1k on the desktop too). Either way this writes the job list for
apps/web/scripts/boxer/ktx2.mjs (colour -> ETC1S sRGB, normal -> UASTC linear) and maps.json for the runtime.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from hcommon import args, fail, log, write_json  # noqa: E402

A = args({"out_dir": None, "plan": None, "id": None})
os.makedirs(A["out_dir"], exist_ok=True)
body = bpy.data.objects.get("body")
if body is None:
    fail("no 'body'")
mat = body.active_material
jobs = []


def job(src, kind, variant, size):
    out = os.path.join(A["out_dir"], "ktx2", f"{A['id']}-{kind}{'' if variant == 'desktop' else '-1k'}.ktx2")
    jobs.append({"in": src, "out": out, "codec": "etc1s" if kind in ("color", "mask") else "uastc", "linear": kind != "color", "normal": kind == "normal", "size": size, "object": A["id"], "map": kind, "variant": variant})


baked = {k: os.path.join(A["out_dir"], f"body-scan-{k}.png") for k in ("color", "normal")}
if os.path.exists(baked["color"]):
    for k, p in baked.items():
        if os.path.exists(p):
            img = bpy.data.images.load(p)
            size = img.size[0]
            job(p, k, "desktop", size)
            job(p, k, "phone", min(1024, size))
    log("maps: baked colour + normal")
else:
    img = None
    if mat and mat.node_tree:
        for n in mat.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image is not None and n.name != "_bake":
                img = n.image
                break
    if img is None:
        fail("no scan texture and no baked maps (run the bake step: run.mjs does it for decimated scans)")
    p = os.path.join(A["out_dir"], "body-scan-color.png")
    img.filepath_raw = p
    img.file_format = "PNG"
    img.save()
    size = img.size[0]
    job(p, "color", "desktop", min(2048, size))
    job(p, "color", "phone", min(1024, size))
    log(f"maps: the scan's own {size} px texture")


# ---- skin mask (R = skin 0..1) from the colour map, for the runtime material: skin gets the shared skin shading
# (pore detail normal, roughness breakup, lower roughness), everything else matte cloth. A plain colour rule (hue
# 0-50 degrees, moderate saturation, not too dark) on a blurred copy: good enough to keep cloth matte and let skin
# take a soft highlight; a hand-painted or segmented mask can replace the file with the same name.
def skin_mask(src, out):
    import numpy as np

    img = bpy.data.images.load(src)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[:, :, :3]
    mx, mn = px.max(axis=2), px.min(axis=2)
    d = mx - mn + 1e-6
    r, g, b = px[:, :, 0], px[:, :, 1], px[:, :, 2]
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    sat = d / (mx + 1e-6)
    m = ((hue < 42) | (hue > 350)) & (sat > 0.18) & (sat < 0.75) & (mx > 0.10) & (r > b * 1.15) & (r > g * 1.12)
    m = m.astype(np.float32)
    # soften the edges a little (3x3 box, twice)
    for _ in range(2):
        m = (m + np.roll(m, 1, 0) + np.roll(m, -1, 0) + np.roll(m, 1, 1) + np.roll(m, -1, 1)) / 5
    o = bpy.data.images.new("mask", w, h, alpha=False)
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    rgba[:, :, 0] = m
    rgba[:, :, 3] = 1
    o.pixels[:] = rgba.ravel()
    o.colorspace_settings.name = "Non-Color"
    o.filepath_raw = out
    o.file_format = "PNG"
    o.save()
    return float(m.mean())


color_src = next(j["in"] for j in jobs if j["map"] == "color")
mask = os.path.join(A["out_dir"], "body-scan-mask.png")
share = skin_mask(color_src, mask)
job(mask, "mask", "phone", 1024)
log(f"maps: skin mask ({share * 100:.1f} % of the texels)")
os.makedirs(os.path.join(A["out_dir"], "ktx2"), exist_ok=True)
write_json(A["plan"], jobs)

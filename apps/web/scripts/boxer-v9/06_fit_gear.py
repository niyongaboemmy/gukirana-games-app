"""Step 6: fit a downloaded gear model (glove, headgear, shoe) to the rigged body and skin it.

Verified on Blender 5.2.4 (P3-FGT-22) with the placeholder glove (make_placeholder_gear.py), L and R. Shoe and
headgear modes are not run yet (no model). Run once per item, e.g.

    blender -b work/out/m/05-cloth.blend -P apps/web/scripts/boxer-v9/06_fit_gear.py -- \
        --input work/in/gear/glove/glove.glb --mode glove --side L --rotate 0,0,90 --length 0.30 \
        --cut-below 0.004 --target 2200 --hide-hands --out work/out/m/06-gear.blend
    blender -b work/out/m/06-gear.blend -P ...06_fit_gear.py -- --input <same> --mode glove --side R --mirror ...
    blender -b ... -- --input work/in/gear/headgear/headgear.fbx --mode headgear --rotate 90,0,0 ...
    blender -b ... -- --input work/in/gear/shoe/boot.glb --mode shoe --side L ...

--rotate (degrees, XYZ) turns the downloaded model into the canonical frame below; every model arrives differently,
so look at it once in Blender (or in the preview render) and write the turn into pipeline.json:
  glove:    length along +Z (cuff at the bottom, knuckles at the top), thumb towards +X;
  headgear: crown up (+Z), face opening towards -Y;
  shoe:     sole on z = 0, toe towards -Y.
--mirror flips the model in X after the turn (a right glove / shoe from a left one). --cut-below removes the scan's
floor plate (everything under that height, after the turn). The untouched model is kept as <name>_hi (hidden) for
the step 7 bake; the fitted one is decimated to --target triangles and gets clean UVs.

Skinning: gloves are rigid on the hand, with the cuff blended onto the forearm twist bone; headgear is rigid on the
head; shoes take the body's foot / toe weights (the sole bends at the ball of the foot). --hide-hands / --hide-feet
delete the body's hand / foot faces the gear covers (they would poke through, and cost triangles).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Euler, Matrix  # noqa: E402
from common import Vector, apply_modifier, apply_transforms, args, ctx, fail, import_any, log, meshes, save, select_only, tris  # noqa: E402

A = args({"input": None, "out": None, "mode": None, "side": "L", "rotate": [], "mirror": False, "length": 0.0, "cut_below": -1.0, "target": 2200, "along": 0.38, "hide_hands": False, "hide_feet": False})
body, rig = bpy.data.objects.get("body"), bpy.data.objects.get("boxer")
if body is None or rig is None:
    fail("needs 'body' and 'boxer' (steps 3+)")
S = A["side"]
name = {"glove": f"glove_{S}", "shoe": f"shoe_{S}", "headgear": "headgear"}[A["mode"]]
J = {b.name: b.head_local.copy() for b in rig.data.bones}

# ---- load, join, canonical frame
objs = meshes(import_any(os.path.abspath(A["input"])))
for o in objs:
    o.parent = None
select_only(objs)
with ctx(objs[0], objs):
    if len(objs) > 1:
        bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
ob.name = name
ob.data.name = name
apply_transforms([ob])
# (P3-FGT-22) the location too: a downloaded model (and the placeholder) can carry a node offset, and everything below
# works on the mesh coordinates; a 19 cm offset left the test gloves floating over the forearms
with ctx(ob):
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
rot = [math.radians(float(x)) for x in (A["rotate"] or ["0", "0", "0"])]
ob.data.transform(Euler(rot, "XYZ").to_matrix().to_4x4())
if A["mirror"]:
    ob.data.transform(Matrix.Scale(-1, 4, (1, 0, 0)))
    ob.data.flip_normals()
    if A["mode"] == "glove":  # the mirrored thumb points to -X: turn it back to +X (a right glove, canonical frame)
        ob.data.transform(Matrix.Rotation(math.pi, 4, "Z"))
if A["cut_below"] >= 0:
    zmin = min(v.co.z for v in ob.data.vertices)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < zmin + A["cut_below"]], context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()


def bounds(vs):
    return Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs))), Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))


def body_part(keys):
    out = []
    for v in body.data.vertices:
        g = max(v.groups, key=lambda g: g.weight, default=None)
        if g and any(k in body.vertex_groups[g.group].name for k in keys):
            out.append(v.co.copy())
    return out


lo, hi = bounds([v.co for v in ob.data.vertices])
size = hi - lo

# ---- place
if A["mode"] == "glove":
    wrist, fore = J[f"Bip01_{S}_Hand"], J[f"Bip01_{S}_Forearm"]
    zdir = (wrist - fore).normalized()
    thumb = J.get(f"Bip01_{S}_Finger0", wrist) - J.get(f"Bip01_{S}_Finger4", wrist)
    xdir = (thumb - zdir * thumb.dot(zdir)).normalized() if thumb.length > 1e-4 else zdir.orthogonal().normalized()
    ydir = zdir.cross(xdir)
    s = (A["length"] or 0.30) / size.z
    pivot = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z + A["along"] * size.z))
    basis = Matrix((xdir, ydir, zdir)).transposed().to_4x4()
    ob.data.transform(Matrix.Translation(wrist) @ basis @ Matrix.Scale(s, 4) @ Matrix.Translation(-pivot))
elif A["mode"] == "headgear":
    hv = body_part(["Bip01_Head"])
    hlo, hhi = bounds(hv)
    s = ((hhi.x - hlo.x) + 2 * 0.022) / size.x  # ~22 mm of padding each side
    ob.data.transform(Matrix.Scale(s, 4))
    lo, hi = bounds([v.co for v in ob.data.vertices])
    ob.data.transform(Matrix.Translation(Vector(((hlo.x + hhi.x) / 2 - (lo.x + hi.x) / 2, (hlo.y + hhi.y) / 2 - (lo.y + hi.y) / 2, hhi.z + 0.018 - hi.z))))
elif A["mode"] == "shoe":
    fv = [c for c in body_part([f"Bip01_{S}_Foot", f"Bip01_{S}_Toe0"])]
    flo, fhi = bounds(fv)
    s = (fhi.y - flo.y) * 1.06 / size.y
    ob.data.transform(Matrix.Scale(s, 4))
    lo, hi = bounds([v.co for v in ob.data.vertices])
    ob.data.transform(Matrix.Translation(Vector(((flo.x + fhi.x) / 2 - (lo.x + hi.x) / 2, (flo.y + fhi.y) / 2 - (lo.y + hi.y) / 2 - 0.005, -lo.z))))
else:
    fail("--mode is glove, headgear or shoe")

# ---- keep the detailed copy for the bake, then the budget copy with clean UVs
hi_ob = ob.copy()
hi_ob.data = ob.data.copy()
hi_ob.name = name + "_hi"
bpy.context.collection.objects.link(hi_ob)
hi_ob.hide_render = True
hi_ob.hide_set(True)
n = tris(ob)
if n > A["target"]:
    dec = ob.modifiers.new("budget", "DECIMATE")
    dec.ratio = A["target"] / n
    apply_modifier(ob, dec)
select_only([ob])
with ctx(ob):
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.008)
    bpy.ops.object.mode_set(mode="OBJECT")
for p in ob.data.polygons:
    p.use_smooth = True
log(f"{name}: {n} -> {tris(ob)} triangles, scale {s:.4f}")

# ---- skin
for vg in list(ob.vertex_groups):
    ob.vertex_groups.remove(vg)
if A["mode"] == "glove":
    hand, twist = ob.vertex_groups.new(name=f"Bip01_{S}_Hand"), ob.vertex_groups.new(name=f"Bip01_{S}_ForearmTwist")
    for v in ob.data.vertices:
        t = (v.co - J[f"Bip01_{S}_Hand"]).dot(zdir)  # < 0 towards the elbow (the cuff)
        k = max(0.0, min(0.6, -t / 0.08 * 0.6))
        hand.add([v.index], 1 - k, "REPLACE")
        if k > 0:
            twist.add([v.index], k, "REPLACE")
elif A["mode"] == "headgear":
    ob.vertex_groups.new(name="Bip01_Head").add([v.index for v in ob.data.vertices], 1.0, "REPLACE")
else:
    dt = ob.modifiers.new("weights", "DATA_TRANSFER")
    dt.object = body
    dt.use_vert_data = True
    dt.data_types_verts = {"VGROUP_WEIGHTS"}
    dt.vert_mapping = "POLYINTERP_NEAREST"
    dt.layers_vgroup_select_src = "ALL"
    dt.layers_vgroup_select_dst = "NAME"
    with ctx(ob):
        bpy.ops.object.datalayout_transfer(modifier=dt.name)
    apply_modifier(ob, dt)
mod = ob.modifiers.new("skin", "ARMATURE")
mod.object = rig
ob.parent = rig

# ---- hide what the gear covers
hide = []
if A["hide_hands"] and A["mode"] == "glove":
    hide = [f"Bip01_{S}_Hand", f"Bip01_{S}_Finger"]
if A["hide_feet"] and A["mode"] == "shoe":
    hide = [f"Bip01_{S}_Foot", f"Bip01_{S}_Toe0"]
if hide:
    if body.data.shape_keys:
        fail("the body has shape keys: hide hands / feet before adding them")
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    dl = bm.verts.layers.deform.active
    idx = {i for i, g in enumerate(body.vertex_groups) if any(g.name.startswith(h) for h in hide)}

    def covered(v):
        d = v[dl]
        return sum(w for i, w in d.items() if i in idx) > 0.6

    faces = [f for f in bm.faces if all(covered(v) for v in f.verts)]
    bmesh.ops.delete(bm, geom=faces, context="FACES_ONLY")
    bm.to_mesh(body.data)
    bm.free()
    log(f"body: removed {len(faces)} faces under the {A['mode']}, now {tris(body)} triangles")
save(A["out"])

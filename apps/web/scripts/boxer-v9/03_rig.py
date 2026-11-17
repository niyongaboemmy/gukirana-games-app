"""Step 3: rig the body on OUR skeleton (Bip01 names, identity bind rotations) using Mixamo's auto-rig weights.

UNTESTED: needs Blender (4.2+).

    blender -b work/out/m/02-body.blend -P apps/web/scripts/boxer-v9/03_rig.py -- \
        --mixamo work/in/mixamo/m/character.fbx --out work/out/m/03-rigged.blend

Input --mixamo: the body you uploaded to Mixamo, downloaded back from Mixamo with "FBX Binary, With Skin, T-pose"
(no animation) after the auto-rigger ran. Mixamo may re-order or split vertices, so its mesh is NOT used: only its
skin weights are copied onto our own body (Data Transfer, nearest face), which keeps our UVs and materials.

Why our own skeleton instead of Mixamo's: the runtime boxing rig (world/human/boxing/rig.ts, arm-fk.ts,
boxer/helpers.ts) finds bones by their Bip01 names and assumes every bind rotation is identity. Building that
skeleton at Mixamo's joint positions keeps the keyed arms, joint limits, keep-out and helper bones working, and the
Mixamo clips are retargeted onto it in step 4 (same joints, so the retarget is exact).

Every bone is created pointing straight up (+Z) with roll 0: in glTF (Y-up) that is the identity rotation.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from common import BONE_MAP, Vector, apply_modifier, apply_transforms, args, armature, bip_of, ctx, fail, import_any, log, meshes, mixamo_name, save, select_only  # noqa: E402

A = args({"mixamo": None, "out": None, "shoulder_radius": 0.09})
body = bpy.data.objects.get("body")
if body is None:
    fail("no 'body' object (run steps 1-2 first)")
extra = [o for o in meshes() if o.name not in ("body", "body_hi")]

new = import_any(os.path.abspath(A["mixamo"]))
src_arm = armature(new)
src_mesh = max(meshes(new), key=lambda o: len(o.data.vertices)) if meshes(new) else None
if src_arm is None or src_mesh is None:
    fail("the Mixamo file needs a skeleton AND the skinned mesh (download 'With Skin')")
apply_transforms([src_arm] + meshes(new))


# Mixamo can rescale / move the upload: fit its bounding box onto our body
def bbox(o):
    ps = [o.matrix_world @ v.co for v in o.data.vertices]
    return Vector((min(p.x for p in ps), min(p.y for p in ps), min(p.z for p in ps))), Vector((max(p.x for p in ps), max(p.y for p in ps), max(p.z for p in ps)))


(blo, bhi), (slo, shi) = bbox(body), bbox(src_mesh)
s = (bhi.z - blo.z) / max(1e-6, shi.z - slo.z)
if abs(s - 1) > 0.01 or (slo - blo).length > 0.01:
    log(f"fitting the Mixamo rig onto the body: scale {s:.4f}")
    for o in [src_arm] + meshes(new):
        o.scale = (s, s, s)
    apply_transforms([src_arm] + meshes(new))
    (slo, shi) = bbox(src_mesh)
    d = Vector(((blo.x + bhi.x - slo.x - shi.x) / 2, (blo.y + bhi.y - slo.y - shi.y) / 2, blo.z - slo.z))
    for o in [src_arm] + meshes(new):
        o.location += d
    select_only([src_arm] + meshes(new))
    with ctx(src_arm, [src_arm] + meshes(new)):
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

# ---- 1. copy the skin weights (all Mixamo groups) onto our body
for vg in list(body.vertex_groups):
    body.vertex_groups.remove(vg)
dt = body.modifiers.new("weights", "DATA_TRANSFER")
dt.object = src_mesh
dt.use_vert_data = True
dt.data_types_verts = {"VGROUP_WEIGHTS"}
dt.vert_mapping = "POLYINTERP_NEAREST"
dt.layers_vgroup_select_src = "ALL"
dt.layers_vgroup_select_dst = "NAME"
with ctx(body):
    bpy.ops.object.datalayout_transfer(modifier=dt.name)
apply_modifier(body, dt)

# ---- 2. our skeleton at Mixamo's joints
src_bones = {mixamo_name(b.name): b for b in src_arm.data.bones}
joint = {}
for mname, bip in BONE_MAP["mixamo_to_bip01"].items():
    if mname in src_bones:
        joint[bip] = src_arm.matrix_world @ src_bones[mname].head_local
missing = [b for b in BONE_MAP["mixamo_to_bip01"].values() if b not in joint and "Finger" not in b]
if missing:
    fail("Mixamo skeleton lacks: " + ", ".join(missing))
joint["Bip01_Pelvis"] = joint["Bip01"].copy()
for S in ("L", "R"):
    joint[f"Bip01_{S}_ShoulderHelper"] = joint[f"Bip01_{S}_UpperArm"].copy()
    joint[f"Bip01_{S}_ForearmTwist"] = (joint[f"Bip01_{S}_Forearm"] + joint[f"Bip01_{S}_Hand"]) / 2

parent = BONE_MAP["bip01_parent"]
children = {}
for b, p in parent.items():
    if p:
        children.setdefault(p, []).append(b)

arm_data = bpy.data.armatures.new("boxer")
rig = bpy.data.objects.new("boxer", arm_data)
bpy.context.collection.objects.link(rig)
select_only([rig])
with ctx(rig):
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones
    for name in parent:
        if name not in joint:
            continue  # fingers Mixamo did not make (it can skip them on low-res hands)
        e = eb.new(name)
        kids = [joint[c] for c in children.get(name, []) if c in joint and (joint[c] - joint[name]).length > 0.005]
        length = min((k - joint[name]).length for k in kids) if kids else 0.05
        e.head = joint[name]
        e.tail = joint[name] + Vector((0, 0, max(0.02, length)))  # straight up, roll 0 = identity in glTF
        e.roll = 0.0
    for name, p in parent.items():
        if name in eb and p and p in eb:
            eb[name].parent = eb[p]
            eb[name].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
log(f"skeleton: {len(arm_data.bones)} bones")

# ---- 3. rename the weight groups to Bip01 (Hips -> Bip01_Pelvis: the root itself carries no skin, as in v8)
dropped = []
for vg in list(body.vertex_groups):
    m = mixamo_name(vg.name)
    bip = "Bip01_Pelvis" if m == "Hips" else bip_of(vg.name)
    if bip and bip in arm_data.bones:
        vg.name = bip
    else:
        dropped.append(vg.name)
        body.vertex_groups.remove(vg)
if dropped:
    log("dropped unmapped weight groups (end / leaf bones, normally empty):", ", ".join(dropped))


# ---- 4. helper bones (boxer/helpers.ts): forearm twist takes the wrist half of the forearm, the shoulder helper half
# of the deltoid around the joint
def group(name):
    return body.vertex_groups.get(name) or body.vertex_groups.new(name=name)


def weight(vg, i):
    try:
        return vg.weight(i)
    except RuntimeError:
        return 0.0


for S in ("L", "R"):
    fa, tw, ha = group(f"Bip01_{S}_Forearm"), group(f"Bip01_{S}_ForearmTwist"), joint[f"Bip01_{S}_Hand"]
    e = joint[f"Bip01_{S}_Forearm"]
    axis = ha - e
    for v in body.data.vertices:
        w = weight(fa, v.index)
        if w <= 0:
            continue
        t = max(0.0, min(1.0, (v.co - e).dot(axis) / axis.length_squared))
        fa.add([v.index], w * (1 - t), "REPLACE")
        tw.add([v.index], w * t, "REPLACE")
    ua, cl, sh = group(f"Bip01_{S}_UpperArm"), group(f"Bip01_{S}_Clavicle"), group(f"Bip01_{S}_ShoulderHelper")
    j = joint[f"Bip01_{S}_UpperArm"]
    for v in body.data.vertices:
        d = (v.co - j).length
        if d >= A["shoulder_radius"]:
            continue
        k = 0.5 * (1 - d / A["shoulder_radius"])
        wu, wc = weight(ua, v.index), weight(cl, v.index)
        if wu + wc <= 0:
            continue
        ua.add([v.index], wu * (1 - k), "REPLACE")
        cl.add([v.index], wc * (1 - k), "REPLACE")
        sh.add([v.index], (wu + wc) * k, "REPLACE")

# ---- 5. bind body (and hair / brows / lashes, rigid to the head) to our skeleton, remove Mixamo's
for o in [body] + extra:
    for mod in list(o.modifiers):
        if mod.type == "ARMATURE":
            o.modifiers.remove(mod)
    if o is not body:
        g = o.vertex_groups.get("Bip01_Head") or o.vertex_groups.new(name="Bip01_Head")
        g.add([v.index for v in o.data.vertices], 1.0, "REPLACE")
    mod = o.modifiers.new("skin", "ARMATURE")
    mod.object = rig
    o.parent = rig
for o in new:
    bpy.data.objects.remove(o, do_unlink=True)
save(A["out"])

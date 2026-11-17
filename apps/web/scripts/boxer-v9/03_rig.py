"""Step 3: rig the body on OUR skeleton (Bip01 names, identity bind rotations) using Mixamo's auto-rig weights.

Verified on Blender 5.2.4 (P3-FGT-22) with --map bip01 on the v8 test body; the Mixamo route is not run yet (needs
the user's Mixamo download).

    blender -b work/out/m/02-body.blend -P apps/web/scripts/boxer-v9/03_rig.py -- \
        --mixamo work/in/mixamo/m/character.fbx --out work/out/m/03-rigged.blend [--map mixamo|bip01] [--source-mesh body]

--map bip01 takes the joints and weights from a skeleton that already has our names (the v8 test body GLB).

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
from common import BONE_MAP, Vector, apply_modifier, apply_transforms, args, armature, ctx, fail, import_any, log, meshes, mixamo_name, save, select_only, source_map  # noqa: E402

A = args({"mixamo": None, "out": None, "shoulder_radius": 0.09, "map": "mixamo", "source_mesh": ""})
body = bpy.data.objects.get("body")
if body is None:
    fail("no 'body' object (run steps 1-2 first)")
if not os.path.exists(A["mixamo"]):
    fail(f"rigged source not found: {A['mixamo']} (the Mixamo auto-rig download, or run.mjs --body test)")
extra = [o for o in meshes() if o.name not in ("body", "body_hi")]
MAP = source_map(A["map"])

new = import_any(os.path.abspath(A["mixamo"]))
src_arm = armature(new)
# the skinned mesh: --source-mesh by name (prefix match: the import renames "body" to "body.001"), else the mesh
# with the most weight groups (a GLB / FBX can carry other meshes too)
skinned = [o for o in meshes(new) if o.vertex_groups]
if A["source_mesh"]:
    skinned = [o for o in skinned if o.name.split(".")[0] == A["source_mesh"]]
src_mesh = max(skinned, key=lambda o: (len(o.vertex_groups), len(o.data.vertices))) if skinned else None
if src_arm is None or src_mesh is None:
    fail("the rigged source needs a skeleton AND the skinned mesh (Mixamo: download 'With Skin')")
for o in meshes(new):
    if o is not src_mesh:
        new.remove(o)
        bpy.data.objects.remove(o, do_unlink=True)
# unparent (keeping the world transform) so the fit below moves the mesh once, not once more through its parent
for o in (src_arm, src_mesh):
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
apply_transforms([src_arm, src_mesh])


# Mixamo can rescale / move the upload: fit its bounding box onto our body
def bbox(o):
    ps = [o.matrix_world @ v.co for v in o.data.vertices]
    return Vector((min(p.x for p in ps), min(p.y for p in ps), min(p.z for p in ps))), Vector((max(p.x for p in ps), max(p.y for p in ps), max(p.z for p in ps)))


(blo, bhi), (slo, shi) = bbox(body), bbox(src_mesh)
s = (bhi.z - blo.z) / max(1e-6, shi.z - slo.z)
if abs(s - 1) > 0.01 or (slo - blo).length > 0.01:
    log(f"fitting the source rig onto the body: scale {s:.4f}")
    for o in (src_arm, src_mesh):
        o.scale = (s, s, s)
    apply_transforms([src_arm, src_mesh])
    (slo, shi) = bbox(src_mesh)
    d = Vector(((blo.x + bhi.x - slo.x - shi.x) / 2, (blo.y + bhi.y - slo.y - shi.y) / 2, blo.z - slo.z))
    for o in (src_arm, src_mesh):
        o.location += d
    select_only([src_arm, src_mesh])
    with ctx(src_arm, [src_arm, src_mesh]):
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

# ---- 0. on the source: fold every unmapped weight group (face bones, end bones, twist / helper bones of another rig)
# into its nearest mapped ancestor, so no skin is left unweighted when the groups are renamed below
src_bones = {mixamo_name(b.name): b for b in src_arm.data.bones}


def mapped_ancestor(name):
    b = src_bones.get(name)
    while b is not None:
        if mixamo_name(b.name) in MAP:
            return mixamo_name(b.name)
        b = b.parent
    return None


folded = {}
for vg in list(src_mesh.vertex_groups):
    n = mixamo_name(vg.name)
    if n in MAP:
        continue
    to = mapped_ancestor(n)
    if to is None:
        continue
    tgt = next((g for g in src_mesh.vertex_groups if mixamo_name(g.name) == to), None) or src_mesh.vertex_groups.new(name=to)
    gi = vg.index
    for v in src_mesh.data.vertices:
        for g in v.groups:
            if g.group == gi and g.weight > 0:
                try:
                    w0 = tgt.weight(v.index)
                except RuntimeError:
                    w0 = 0.0
                tgt.add([v.index], w0 + g.weight, "REPLACE")
    folded[n] = to
    src_mesh.vertex_groups.remove(vg)
if folded:
    log("folded unmapped weight groups:", ", ".join(f"{a}->{b}" for a, b in sorted(folded.items())))

# ---- 1. copy the skin weights (all source groups) onto our body
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

# ---- 2. our skeleton at the source's joints
joint = {}
for mname, bip in MAP.items():
    if mname in src_bones:
        joint[bip] = src_arm.matrix_world @ src_bones[mname].head_local
missing = [b for b in MAP.values() if b not in joint and "Finger" not in b]
if missing:
    fail(f"the {A['map']} skeleton lacks: " + ", ".join(missing))
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
    bip = MAP.get(mixamo_name(vg.name))
    if bip == "Bip01":
        bip = "Bip01_Pelvis"
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
rig.name = arm_data.name = "boxer"  # (the source rig may have been called "boxer" too: the new one got ".001")

# ---- 6. checks: every vertex weighted, at most 4 influences after the glTF export's normalisation
bare = sum(1 for v in body.data.vertices if sum(g.weight for g in v.groups) < 1e-4)
many = sum(1 for v in body.data.vertices if sum(1 for g in v.groups if g.weight > 1e-4) > 4)
log(f"weights: {len(body.data.vertices)} vertices, {bare} unweighted, {many} with more than 4 influences (the exporter keeps the 4 largest)")
if bare:
    fail(f"{bare} body vertices have no skin weight (the source mesh does not cover the body?)")
save(A["out"])

"""Step 3: auto-rig a cleaned scan onto the Bip01 skeleton the boxers and the campus people use. No Mixamo upload.

    blender -b work/out/<id>/02-body.blend -P apps/web/scripts/human-v9/03_autorig.py -- \
        --out work/out/<id>/03-rigged.blend [--report r.json] [--voxel 0.012]

1. Joints from the mesh itself (an A- or T-pose scan, feet on z = 0, facing -Y, left = +X), by cross-sections:
   - crotch: the lowest height where the mesh closes between the legs (a skirt or dress closes it early: then the
     anthropometric 46 % is used); hip joints just above it, at 85 % of the upper-thigh centres;
   - knees, ankles: the leg centres at 28.5 % and 4.5 % of the height; the ball of the foot two thirds of the way
     from the ankle to the toe tip;
   - spine / neck / head: the torso's middle (the central run of the cross-section, which leaves the arms out) at
     fixed fractions of the height;
   - shoulder joints: 3.2 % of the height in from the outside of the deltoids; the fingertips are the arm points
     farthest from the shoulder; elbow and wrist start at the average arm proportions (0.42 / 0.755 of the way) and
     are moved to the centre of the arm's own cross-section there, so a bent arm gets a bent skeleton.
2. Bones as in boxer-v9/03_rig.py: every bone points straight up with roll 0 (identity rest rotation in glTF), Bip01
   names and parents from boxer-v9/bone-map.json; no finger, helper or face bones (a scan's hands are mittens and
   its face cannot move).
3. Weights: Blender's bone-heat weighting on a watertight voxel copy of the body (heat fails on raw scans with holes
   and loose shells), copied back onto the real mesh (nearest face, interpolated), at most 4 influences, normalised.
   If bone heat still fails, a distance fall-off weighting by limb segment is used and the report says so.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from hcommon import BONE_MAP, RIG, Vector, apply_modifier, args, band, bounds, centroid, ctx, fail, log, save, select_only, write_json  # noqa: E402

A = args({"out": None, "report": "", "voxel": 0.012})
body = bpy.data.objects.get("body")
if body is None:
    fail("no 'body' object (run steps 1-2 first)")
P = [v.co.copy() for v in body.data.vertices]
lo, hi = bounds(P)
H = hi.z - lo.z
rep = {"height": round(H, 4), "warnings": []}


def z(f):
    return lo.z + f * H


def central(pts, gap=0.012):
    """the central run of a horizontal slice along X (from x = 0 outwards while the slice stays filled, gaps up to
    `gap` metres): the torso without the arms. Returns (xmin, xmax) or None."""
    if not pts:
        return None
    xs = sorted(p.x for p in pts)
    near = min(xs, key=abs)
    if abs(near) > 0.08:
        return None
    i = xs.index(near)
    a = b = i
    while a > 0 and xs[a] - xs[a - 1] < gap:
        a -= 1
    while b < len(xs) - 1 and xs[b + 1] - xs[b] < gap:
        b += 1
    return xs[a], xs[b]


def slab_torso(f0, f1):
    pts = band(P, z(f0), z(f1))
    c = central(pts)
    if c is None:
        return pts, centroid(pts)
    t = [p for p in pts if c[0] <= p.x <= c[1]]
    return t, centroid(t)


# a denser sample of the surface for the cross-sections (low-poly scans have only a few vertices per slice)
DENSE = P + [p.center.copy() for p in body.data.polygons] + [(body.data.vertices[e.vertices[0]].co + body.data.vertices[e.vertices[1]].co) / 2 for e in body.data.edges]
J = {}
# ---- legs
# rays front -> back through the middle (x = 0), top down: the first height where a ray misses is the crotch
from mathutils.bvhtree import BVHTree  # noqa: E402

TREE = BVHTree.FromPolygons([v.co for v in body.data.vertices], [tuple(p.vertices) for p in body.data.polygons])


def closed_at(zz, x=0.0):
    return TREE.ray_cast(Vector((x, lo.y - 0.5, zz)), Vector((0, 1, 0)), (hi.y - lo.y) + 1.0)[0] is not None


crotch = None
f = 0.56
while f > 0.30:
    if not closed_at(z(f)) and not closed_at(z(f), 0.006 * H) and not closed_at(z(f), -0.006 * H):
        crotch = f
        break
    f -= 0.004
skirt = crotch is None or crotch < 0.39
if skirt:
    rep["warnings"].append(f"crotch not found or low ({crotch}): skirt / dress assumed, crotch at 46 %")
    crotch = 0.46
rep["crotch_frac"] = round(crotch, 3)
hip_f = min(0.53, max(0.45, crotch + 0.045))
for S, sgn in (("L", 1), ("R", -1)):
    up = [p for p in band(P, z(crotch - 0.07), z(crotch - 0.03)) if p.x * sgn > 0.01 * H]
    cu = centroid(up)
    if cu is None:
        fail("no upper thigh found: is the scan standing, feet on the floor, facing -Y?")
    J[f"Bip01_{S}_Thigh"] = Vector((cu.x * 0.85, cu.y, z(hip_f)))
    kn = [p for p in band(P, z(0.275), z(0.295)) if p.x * sgn > 0]
    ck = centroid(kn)
    J[f"Bip01_{S}_Calf"] = Vector((ck.x, ck.y, z(0.285)))
    an = [p for p in band(P, z(0.055), z(0.075)) if p.x * sgn > 0]
    ca = centroid(an)
    J[f"Bip01_{S}_Foot"] = Vector((ca.x, ca.y, z(0.045)))
    ft = [p for p in band(P, z(0.0), z(0.03)) if p.x * sgn > 0]
    tip = min(ft, key=lambda p: p.y) if ft else ca + Vector((0, -0.14, 0))
    t = ca + (tip - ca) * 0.68
    J[f"Bip01_{S}_Toe0"] = Vector((t.x, t.y, z(0.015)))
    rep[f"foot_len_{S}"] = round((tip - ca).length, 3)
J["Bip01"] = Vector((0, (J["Bip01_L_Thigh"].y + J["Bip01_R_Thigh"].y) / 2, z(hip_f + 0.02)))
J["Bip01_Pelvis"] = J["Bip01"].copy()
# ---- spine, neck, head
for name, f0 in (("Bip01_Spine", 0.585), ("Bip01_Spine1", 0.655), ("Bip01_Spine2", 0.725), ("Bip01_Neck", 0.832), ("Bip01_Head", 0.862)):
    _, c = slab_torso(f0 - 0.01, f0 + 0.01)
    J[name] = Vector((0, c.y if c else J["Bip01"].y, z(f0)))
# the head joint sits behind the face's middle: use the middle of the skull slice a little higher
_, ch = slab_torso(0.90, 0.93)
if ch:
    J["Bip01_Head"].y = ch.y + 0.004 * H
# ---- arms
sh_slab = band(P, z(0.785), z(0.805))
for S, sgn in (("L", 1), ("R", -1)):
    side = [p for p in sh_slab if p.x * sgn > 0]
    outer = max(p.x * sgn for p in side)
    # (clamped to the adult range of the shoulder-joint half width, 9-11.5 % of the height: a sloping or hunched
    # shoulder line otherwise puts the joint at the neck)
    meas = outer - 0.032 * H
    sx = min(0.115 * H, max(0.09 * H, meas)) * sgn
    rep[f"shoulder_measured_{S}"] = round(meas / H, 4)
    near = [p for p in side if abs(p.x - sx) < 0.03 * H]
    sy = centroid(near).y if near else J["Bip01_Neck"].y
    shoulder = Vector((sx, sy, z(0.80)))
    J[f"Bip01_{S}_UpperArm"] = shoulder
    J[f"Bip01_{S}_Clavicle"] = Vector((0.022 * H * sgn, J["Bip01_Neck"].y - 0.004 * H, z(0.815)))
    # arm points: per slice, split the cross-section into runs along X (gaps over 1.5 % of the height); the run
    # through x = 0 is the torso (arms are the runs beyond it); with the legs apart no run crosses 0, then the
    # innermost run on each side is a leg and only runs beyond it are arm
    arm = []
    for k in range(int(0.30 * 150), int(0.80 * 150)):
        f0 = k / 150
        sl = [p for p in band(DENSE, z(f0), z(f0 + 1 / 150)) if p.x * sgn > 0 or abs(p.x) < 0.03 * H]
        if not sl:
            continue
        xs = sorted(sl, key=lambda p: p.x * sgn)
        runs, cur = [], [xs[0]]
        for a, b in zip(xs, xs[1:]):
            if (b.x - a.x) * sgn > 0.015 * H:
                runs.append(cur)
                cur = []
            cur.append(b)
        runs.append(cur)
        mid = [i for i, r in enumerate(runs) if min(p.x * sgn for p in r) <= 0.0]
        first = (mid[0] + 1) if mid else 1
        for r in runs[first:]:
            if (sum(p.x for p in r) / len(r)) * sgn > 0.07 * H:
                arm.extend(r)
    arm = [p for p in arm if (p - shoulder).length < 0.52 * H]
    if len(arm) < 50:
        rep["warnings"].append(f"{S} arm hardly separable from the torso ({len(arm)} points): proportions used")
        tipv = shoulder + Vector((0.18 * H * sgn, 0, -0.40 * H))
    else:
        tipv = max(arm, key=lambda p: (p - shoulder).length)
    rep[f"arm_len_{S}"] = round((tipv - shoulder).length / H, 3)

    def refine(a, b, t, pts, r=0.07 * H):
        d = (b - a).normalized()
        g = a + (b - a) * t
        sl = [p for p in pts if abs((p - g).dot(d)) < 0.012 * H and ((p - a) - d * (p - a).dot(d) - (g - a - d * (g - a).dot(d))).length < r]
        c = centroid(sl)
        return c if c is not None else g

    pool = arm if len(arm) >= 50 else []
    elbow = refine(shoulder, tipv, 0.42, pool) if pool else shoulder + (tipv - shoulder) * 0.42
    wrist = refine(elbow, tipv, (0.755 - 0.42) / (1 - 0.42), pool) if pool else shoulder + (tipv - shoulder) * 0.755
    J[f"Bip01_{S}_Forearm"] = elbow
    J[f"Bip01_{S}_Hand"] = wrist
    J[f"_tip_{S}"] = tipv
rep["joints"] = {k: [round(c, 4) for c in v] for k, v in J.items()}

# ---- skeleton (identity rest rotations)
BONES = ["Bip01", "Bip01_Pelvis", "Bip01_Spine", "Bip01_Spine1", "Bip01_Spine2", "Bip01_Neck", "Bip01_Head"] + [
    f"Bip01_{S}_{b}" for S in "LR" for b in ("Clavicle", "UpperArm", "Forearm", "Hand", "Thigh", "Calf", "Foot", "Toe0")
]
parent = BONE_MAP["bip01_parent"]
kids = {}
for b in BONES:
    p = parent[b]
    if p:
        kids.setdefault(p, []).append(b)
TAIL = {"Bip01_Head": J["Bip01_Head"].z + 0.0, "Bip01_L_Hand": None, "Bip01_R_Hand": None}
old = bpy.data.objects.get(RIG)
if old is not None:
    bpy.data.objects.remove(old, do_unlink=True)
arm_data = bpy.data.armatures.new(RIG)
rig = bpy.data.objects.new(RIG, arm_data)
bpy.context.collection.objects.link(rig)
select_only([rig])
with ctx(rig):
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones
    for b in BONES:
        e = eb.new(b)
        h = J[b]
        ks = [J[c] for c in kids.get(b, []) if (J[c] - h).length > 0.005]
        if b == "Bip01_Head":
            length = hi.z - h.z
        elif b.endswith("_Hand"):
            length = (J[f"_tip_{b[6]}"] - h).length
        elif b.endswith("_Toe0"):
            length = 0.04
        else:
            length = min((k - h).length for k in ks) if ks else 0.06
        e.head = h
        e.tail = h + Vector((0, 0, max(0.02, length)))
        e.roll = 0.0
    for b in BONES:
        p = parent[b]
        if p:
            eb[b].parent = eb[p]
            eb[b].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
arm_data.bones["Bip01"].use_deform = False
log(f"skeleton: {len(arm_data.bones)} bones")


# ---- weights. Bone heat wants bones that point along the limb: a temporary "heat" armature with the same joints,
# each bone from its joint to its child joint, gives the heat solver the limb segments; the weights (named per bone)
# then drive the real, straight-up skeleton.
def heat_rig():
    d = bpy.data.armatures.new("heat")
    o = bpy.data.objects.new("heat", d)
    bpy.context.collection.objects.link(o)
    select_only([o])
    with ctx(o):
        bpy.ops.object.mode_set(mode="EDIT")
        for b in BONES:
            if b == "Bip01":
                continue
            e = d.edit_bones.new(b)
            h = J[b]
            child = {
                "Bip01_Pelvis": J["Bip01_Spine"],
                "Bip01_Spine2": J["Bip01_Neck"],
                "Bip01_Head": Vector((J["Bip01_Head"].x, J["Bip01_Head"].y, hi.z - 0.02 * H)),
                "Bip01_L_Hand": J["_tip_L"],
                "Bip01_R_Hand": J["_tip_R"],
                "Bip01_L_Toe0": J["Bip01_L_Toe0"] + Vector((0, -0.05, 0)),
                "Bip01_R_Toe0": J["Bip01_R_Toe0"] + Vector((0, -0.05, 0)),
            }.get(b)
            if child is None:
                ks = [J[c] for c in kids.get(b, []) if not c.endswith(("Clavicle", "Thigh"))]
                child = ks[0] if ks else h + Vector((0, 0, 0.05))
            if b in ("Bip01_L_Clavicle", "Bip01_R_Clavicle"):
                child = J[b.replace("Clavicle", "UpperArm")]
            if (child - h).length < 0.01:
                child = h + Vector((0, 0, 0.03))
            e.head, e.tail = h, child
        bpy.ops.object.mode_set(mode="OBJECT")
    return o


proxy = body.copy()
proxy.data = body.data.copy()
proxy.name = "proxy"
bpy.context.collection.objects.link(proxy)
for vg in list(proxy.vertex_groups):
    proxy.vertex_groups.remove(vg)
rm = proxy.modifiers.new("vox", "REMESH")
rm.mode = "VOXEL"
rm.voxel_size = A["voxel"] * H / 1.7
apply_modifier(proxy, rm)
if len(proxy.data.vertices) > 60000:
    dec = proxy.modifiers.new("dec", "DECIMATE")
    dec.ratio = 60000 / len(proxy.data.vertices)
    apply_modifier(proxy, dec)
rep["proxy_verts"] = len(proxy.data.vertices)
hr = heat_rig()
select_only([proxy, hr], hr)
method = "bone heat (voxel proxy)"
try:
    with ctx(hr, [proxy, hr]):
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
except RuntimeError as e:
    rep["warnings"].append(f"bone heat raised: {e}")
covered = sum(1 for v in proxy.data.vertices if any(g.weight > 1e-4 for g in v.groups))
rep["proxy_weighted_frac"] = round(covered / max(1, len(proxy.data.vertices)), 4)
if covered < 0.98 * len(proxy.data.vertices):
    method = "distance fall-off (bone heat failed)"
    rep["warnings"].append(f"bone heat weighted only {covered} of {len(proxy.data.vertices)} proxy vertices")
    for vg in list(proxy.vertex_groups):
        proxy.vertex_groups.remove(vg)
    segs = []
    for pb in hr.data.bones:
        segs.append((pb.name, hr.matrix_world @ pb.head_local, hr.matrix_world @ pb.tail_local))
    groups = {n: proxy.vertex_groups.new(name=n) for n, _, _ in segs}
    for v in proxy.data.vertices:
        ws = []
        for n, a, b in segs:
            ab = b - a
            t = max(0.0, min(1.0, (v.co - a).dot(ab) / max(1e-9, ab.length_squared)))
            d = (v.co - (a + ab * t)).length
            # limbs only weight their own side
            if ("_L_" in n and v.co.x < -0.02) or ("_R_" in n and v.co.x > 0.02):
                continue
            ws.append((n, 1.0 / max(1e-4, d) ** 4))
        ws.sort(key=lambda w: -w[1])
        ws = ws[:4]
        s = sum(w for _, w in ws)
        for n, w in ws:
            groups[n].add([v.index], w / s, "REPLACE")
rep["weights"] = method
log("weights:", method)

for vg in list(body.vertex_groups):
    body.vertex_groups.remove(vg)
for vg in proxy.vertex_groups:
    body.vertex_groups.new(name=vg.name)
dt = body.modifiers.new("weights", "DATA_TRANSFER")
dt.object = proxy
dt.use_vert_data = True
dt.data_types_verts = {"VGROUP_WEIGHTS"}
dt.vert_mapping = "POLYINTERP_NEAREST"
dt.layers_vgroup_select_src = "ALL"
dt.layers_vgroup_select_dst = "NAME"
apply_modifier(body, dt)
select_only([body])
with ctx(body):
    bpy.ops.object.vertex_group_limit_total(limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
for o in (proxy, hr):
    bpy.data.objects.remove(o, do_unlink=True)
for mod in list(body.modifiers):
    if mod.type == "ARMATURE":
        body.modifiers.remove(mod)
mod = body.modifiers.new("skin", "ARMATURE")
mod.object = rig
body.parent = rig
hi_obj = bpy.data.objects.get("body_hi")
if hi_obj is not None:
    hi_obj.parent = None

# stray vertices the proxy did not reach (hair wisps, loose shells): the weights of the nearest weighted vertex
from mathutils.kdtree import KDTree  # noqa: E402

bare_ix = [v.index for v in body.data.vertices if sum(g.weight for g in v.groups) < 1e-4]
if bare_ix:
    bare_set = set(bare_ix)
    ok = [v for v in body.data.vertices if v.index not in bare_set]
    kd = KDTree(len(ok))
    for i, v in enumerate(ok):
        kd.insert(v.co, i)
    kd.balance()
    names = {g.index: g.name for g in body.vertex_groups}
    for i in bare_ix:
        _, j, _ = kd.find(body.data.vertices[i].co)
        for g in ok[j].groups:
            body.vertex_groups[names[g.group]].add([i], g.weight, "REPLACE")
    rep["strays_filled"] = len(bare_ix)
bare = sum(1 for v in body.data.vertices if sum(g.weight for g in v.groups) < 1e-4)
rep["unweighted_vertices"] = bare
log(f"weights: {len(body.data.vertices)} vertices, {bare} unweighted")
if bare > 0.002 * len(body.data.vertices):
    fail(f"{bare} body vertices have no skin weight")
if rep["warnings"]:
    for w in rep["warnings"]:
        log("WARNING:", w)
save(A["out"])
if A["report"]:
    write_json(A["report"], rep)

"""Step 1: the feminine body without its blazer, and the form the tops are cut from and draped on.

    blender -b -P apps/web/scripts/women-tops/prep.py -- [--voxel 0.008]

Writes work/prep.blend with:
  - Bip01   the armature (pose reset to rest)
  - src     the body in its rest world frame (transform applied), face attribute `region` from the recolour mask
  - kept    src without the blazer (the top region + its pocket flaps): what the runtime still draws under a top
  - form    the outer envelope of the body (solidify -> voxel remesh -> outer faces): even quads of --voxel metres.
            The blazer's tailoring (lapels, pocket flaps, the collar) is smoothed out and the torso brought in by the
            jacket's thickness (never inside the kept body: the neck / chest skin, the trousers); the sleeves are
            reshaped to an adult woman's arm (round the bone axis, from the deltoid to the wrist). The tops are cut
            from it, it is their collider, and its bare-arm part is the skin of the short sleeves.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from common import BOTTOM, GLB, HEAD, POCKET, SKIN, TOP, WORK, Vector, apply_mod, args, bone_heads, bvh_of, components, copy_object, edge_pairs, log, taubin, write_json  # noqa: E402

A = args({"voxel": 0.008, "shrink": 0.004})
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
for n in ("lod1", "haircards", "Icosphere"):
    o = bpy.data.objects.get(n)
    if o:
        bpy.data.objects.remove(o)
rig = bpy.data.objects["Bip01"]
for pb in rig.pose.bones:
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.location = (0, 0, 0)
    pb.scale = (1, 1, 1)
bpy.context.view_layer.update()
body = bpy.data.objects["body"]
J = bone_heads(rig)

# ---- regions from the recolour mask (R skin, G top, B bottom, none shoes; head material separately)
me = body.data


def mask_of(mat):
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image.name.endswith("_mask"):
            return n.image
    return None


mk = mask_of(me.materials[0])
W, H = mk.size
px = np.array(mk.pixels[:]).reshape(H, W, 4)
uv = me.uv_layers.active.data
ra = me.attributes.new("region", "INT", "FACE")
counts = {}
for p in me.polygons:
    us = [uv[i].uv for i in p.loop_indices]
    u = sum(x[0] for x in us) / len(us)
    v = sum(x[1] for x in us) / len(us)
    if p.material_index == 1:
        k = HEAD
    else:
        r, g, b, _a = px[min(H - 1, int((v % 1) * H)), min(W - 1, int((u % 1) * W))]
        if g > 0.5:
            k = TOP
        elif r > 0.5:
            # the shirt cuffs under the blazer sleeves are skin in the mask: part of the blazer here (women-tops.ts
            # isShirtCuffUv: u < 0.066 or > 0.934, glTF v 0.265-0.505)
            k = POCKET if ((u % 1) < 0.066 or (u % 1) > 0.934) and 0.265 < (1 - v) % 1 < 0.505 else SKIN
        elif b > 0.5:
            # the blazer's pocket flaps are trousers in the mask (P2-AVA-16): u 0.31-0.415 / 0.585-0.69, v (glTF)
            # 0.685-0.76 -> Blender v = 1 - that
            vv = 1 - v
            k = POCKET if (0.31 < u < 0.415 or 0.585 < u < 0.69) and 0.685 < vv < 0.76 else BOTTOM
        else:
            k = 4
    ra.data[p.index].value = k
    counts[k] = counts.get(k, 0) + 1
log("regions", counts)

# ---- src: the body in rest world space (weights kept)
src = copy_object(body, "src")
src.parent = None
src.data.transform(body.matrix_world)
src.matrix_world.identity()
region = [ra.data[p.index].value for p in src.data.polygons]

src_bvh = bvh_of(src)

# ---- kept: what stays of the body under a new top
kept = copy_object(src, "kept")
bm = bmesh.new()
bm.from_mesh(kept.data)
lay = bm.faces.layers.int["region"]
bm.normal_update()
HIPZ = (J["Bip01 L Thigh"].z + J["Bip01 R Thigh"].z) / 2
PX = J["Bip01 Pelvis"].x


def lining(f):
    """trouser faces round the hips that face inwards: the jacket's lining (culled from outside while the jacket was
    on; with it gone they would stand out as flaps). Same rule as the runtime (women-tops.ts isLining)."""
    c = f.calc_center_median()
    if not (HIPZ - 0.3 < c.z < HIPZ + 0.15):
        return False
    rad = Vector((c.x - PX, c.y, 0))
    return rad.length > 0.11 and f.normal.dot(rad.normalized()) < -0.2


drop = [f for f in bm.faces if f[lay] in (TOP, POCKET) or (f[lay] == BOTTOM and lining(f))]
log("kept: dropping", len(drop), "faces (", sum(1 for f in drop if f[lay] == BOTTOM), "lining)")
bmesh.ops.delete(bm, geom=drop, context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
bm.to_mesh(kept.data)
bm.free()
kept_bvh = bvh_of(kept)

# ---- form: outer envelope
form = copy_object(src, "form")
bm = bmesh.new()
bm.from_mesh(form.data)
lay = bm.faces.layers.int["region"]
neck = J["Bip01 Neck"]
# the shirt collar and the lapels' top roll round the neck go before the envelope is made: the envelope falls onto
# the neck / chest skin under them
coll = [f for f in bm.faces if f[lay] in (TOP, POCKET) and f.calc_center_median().z > neck.z - 0.035 and abs(f.calc_center_median().y) < 0.11]
# (kept: deleting it left notches between the neck and the shoulders, where nothing lies under the collar; the collar
# is laid onto the neck skin after the envelope is made instead)
log("collar faces", len(coll))
bm.to_mesh(form.data)
bm.free()
so = form.modifiers.new("solid", "SOLIDIFY")
so.thickness = 0.02
so.offset = -1
so.use_rim = True
apply_mod(form, so)
rm = form.modifiers.new("remesh", "REMESH")
rm.mode = "VOXEL"
rm.voxel_size = A["voxel"]
rm.adaptivity = 0
apply_mod(form, rm)
for vg in list(form.vertex_groups):
    form.vertex_groups.remove(vg)
bm = bmesh.new()
bm.from_mesh(form.data)
bm.normal_update()
from mathutils.bvhtree import BVHTree  # noqa: E402

bvh = BVHTree.FromBMesh(bm)
outer = set()
for f in bm.faces:
    c, n = f.calc_center_median(), f.normal
    hit = bvh.ray_cast(c + n * 0.002, n, 2.0)
    if hit[0] is None or hit[3] > 0.06:
        outer.add(f)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in outer], context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
keep = set(components(bm)[0])
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v not in keep], context="VERTS")
# small holes (where nothing lay under the removed collar): filled, then evened out with the smoothing below
loops = []
seen = set()
for e in bm.edges:
    if not e.is_boundary or e in seen:
        continue
    loop, stack = [], [e]
    seen.add(e)
    while stack:
        x = stack.pop()
        loop.append(x)
        for v in x.verts:
            for e2 in v.link_edges:
                if e2.is_boundary and e2 not in seen:
                    seen.add(e2)
                    stack.append(e2)
    loops.append(loop)
log("loop lengths", sorted(round(sum(x.calc_length() for x in lp), 3) for lp in loops)[-12:], [round(sum(v.co.z for e in lp for v in e.verts) / (2 * len(lp)), 2) for lp in sorted(loops, key=lambda lp: sum(x.calc_length() for x in lp))[-8:]])
small = [e for lp in loops if sum(x.calc_length() for x in lp) < 1.5 for e in lp]
log(f"form: {len(loops)} open borders, filling {sum(1 for lp in loops if sum(x.calc_length() for x in lp) < 0.5)}")
if small:
    res = bmesh.ops.holes_fill(bm, edges=small, sides=0)
    bmesh.ops.triangulate(bm, faces=res["faces"])
    # subdivide the fill so it can be smoothed into the surface
    big = [f for f in res["faces"]]
    for _ in range(3):
        es = list({e for f in big if f.is_valid for e in f.edges if e.calc_length() > A["voxel"] * 1.6})
        if not es:
            break
        r2 = bmesh.ops.subdivide_edges(bm, edges=es, cuts=1, use_grid_fill=True)
        big = [f for f in bm.faces if any(v in set(r2["geom_inner"]) for v in f.verts)] if r2.get("geom_inner") else big
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
rest = [e for e in bm.edges if e.is_boundary]
if rest:
    log("remaining open", [(round(e.verts[0].co.z, 3), round(e.verts[0].co.y, 3)) for e in rest][:40])
    tf = bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=rest)
    log("triangle fill", len(tf["geom"]))
log("open edges after fill", sum(1 for e in bm.edges if e.is_boundary), "non-manifold", sum(1 for e in bm.edges if len(e.link_faces) > 2))
bm.verts.ensure_lookup_table()
bm.verts.index_update()
n = len(bm.verts)
co = np.array([v.co[:] for v in bm.verts])

# per form vertex: the region of the nearest body face, distance to it, dominant bone side
reg = np.zeros(n, dtype=np.int64)
dist = np.zeros(n)
gnames = {g.index: g.name for g in src.vertex_groups}
dom = []
for v in src.data.vertices:
    best = max(v.groups, key=lambda g: g.weight, default=None)
    dom.append(gnames[best.group] if best else "")
ARMK = ("UpperArm", "Forearm", "Hand", "Finger")
arm_side = np.zeros(n, dtype=np.int64)  # +1 / -1: the arm on +y / -y, 0 not an arm
for i, v in enumerate(bm.verts):
    loc, nrm, idx, d = src_bvh.find_nearest(v.co)
    reg[i] = region[idx]
    dist[i] = d
    names = [dom[k] for k in src.data.polygons[idx].vertices]
    armn = [x for x in names if any(a in x for a in ARMK)]
    if len(armn) * 2 > len(names):
        arm_side[i] = 1 if v.co.y > 0 else -1
blazer = np.isin(reg, (TOP, POCKET)).astype(np.float64)
# filled collar holes count as blazer (they are smoothed with it)
blazer[dist > 0.012] = 1.0
log("form verts", n, "blazer share", round(blazer.mean(), 3))

# 0. the collar onto the neck: envelope vertices of the blazer round the neck (above the collar's foot, near the neck
# axis) go onto the nearest kept skin (the neck / chest of the head mesh) when it is close
nax = Vector((neck.x, neck.y, 0))
collar = np.zeros(n)
for i, v in enumerate(bm.verts):
    if blazer[i] < 0.5 or v.co.z < neck.z - 0.06:
        continue
    if (Vector((v.co.x, v.co.y, 0)) - nax).length > 0.125:
        continue
    loc, kn, idx, d = kept_bvh.find_nearest(v.co)
    if loc is not None and d < 0.06:
        co[i] = (loc + kn * 0.001)[:]
        collar[i] = 1.0
log("collar vertices laid onto the neck", int(collar.sum()))
# ... and the jacket's skirt (below the waist) onto the trousers' hips: the tops end on the hips, not on a flared hem
hipz = (J["Bip01 L Thigh"].z + J["Bip01 R Thigh"].z) / 2
skirt = 0
for i, v in enumerate(bm.verts):
    if blazer[i] < 0.5 or v.co.z > hipz - 0.12 or arm_side[i] != 0:
        continue
    loc, kn, idx, d = kept_bvh.find_nearest(v.co)
    if loc is not None and d < 0.06 and region[src_bvh.find_nearest(loc)[2]] == BOTTOM:
        co[i] = (loc + kn * 0.002)[:]
        skirt += 1
log("jacket skirt vertices laid onto the hips", skirt)
# 1. smooth the blazer's tailoring away (lapel steps, pocket flaps, the collar's cut edge): Taubin smoothing of the
# blazer part only, everything else fixed
src_i, dst_i, deg = edge_pairs(np, bm, border_rule=True)
# the whole trunk from the low hips to the shoulders is smoothed (the trousers in the jacket's front opening, its
# button and pocket lumps too), only the neck / chest skin and the hands stay
trunk = (arm_side == 0) & (co[:, 2] > hipz - 0.14) & (co[:, 2] < neck.z - 0.02) & ~np.isin(reg, (HEAD, SKIN))
smooth_w = np.maximum(blazer, trunk.astype(np.float64))
fixed = 1.0 - smooth_w
# soft hand-over: the first rings next to the fixed part move less
for _ in range(2):
    acc = np.zeros(n)
    np.add.at(acc, src_i, fixed[dst_i])
    fixed = np.maximum(fixed, 0.6 * acc / deg)
co0 = co.copy()
co = taubin(np, co, src_i, dst_i, deg, 60, fixed=np.clip(fixed, 0, 1), lam=0.5, mu=0.0)
log("smoothing moved max", np.abs(co - co0).max(), "mean", np.abs(co - co0).mean(), "fixed mean", fixed.mean())
for i, v in enumerate(bm.verts):
    v.co = co[i]
bm.normal_update()

# 2. the torso in by the jacket's thickness (not the arms: reshaped below), never inside the kept body
arm_w = (arm_side != 0).astype(np.float64)
nrm = np.array([v.normal[:] for v in bm.verts])
shrink = A["shrink"] * smooth_w * (1 - arm_w) * (1 + np.clip((hipz + 0.15 - co[:, 2]) / 0.2, 0, 1.5))
co = co - nrm * shrink[:, None]
for i in range(n):
    if smooth_w[i] <= 0 or arm_w[i] > 0:
        continue
    p = Vector(co[i])
    loc, kn, idx, d = kept_bvh.find_nearest(p)
    if loc is not None and d < 0.05 and (p - loc).dot(kn) < 0.002:
        co[i] = (loc + kn * 0.002)[:]

# 2b. hips: the jacket's flared skirt (and the trousers' bulge into it) is no body shape. Between the upper thighs
# (Z_LO, the trousers below the jacket are real legs) and the waist (Z_HI) every direction round the trunk takes a
# radius blended from the two cross-sections, with a soft hip curve (+1.2 cm at the widest)
Z_LO, Z_HI = hipz - 0.155, hipz + 0.11
TX = J["Bip01 Pelvis"].x + 0.01
NBIN = 90


def section(z0, z1):
    R = np.zeros(NBIN)
    sel = (arm_side == 0) & (co[:, 2] >= z0) & (co[:, 2] <= z1)
    ang = np.arctan2(co[sel, 1], -(co[sel, 0] - TX))
    r = np.hypot(co[sel, 0] - TX, co[sel, 1])
    b = ((ang + np.pi) / (2 * np.pi) * NBIN).astype(int) % NBIN
    np.maximum.at(R, b, r)
    for _ in range(6):
        e = R == 0
        if not e.any():
            break
        R[e] = np.maximum(np.roll(R, 1), np.roll(R, -1))[e]
    return (np.roll(R, 1) + np.roll(R, -1) + 2 * R) / 4


R_LO, R_HI = section(Z_LO - 0.012, Z_LO), section(Z_HI, Z_HI + 0.012)
hipsel = np.nonzero((arm_side == 0) & (co[:, 2] > Z_LO) & (co[:, 2] < Z_HI))[0]
for i in hipsel:
    s = (co[i, 2] - Z_LO) / (Z_HI - Z_LO)
    a = np.arctan2(co[i, 1], -(co[i, 0] - TX))
    fb = ((a + np.pi) / (2 * np.pi) * NBIN - 0.5) % NBIN
    b0 = int(fb) % NBIN
    w = fb - int(fb)
    rl = R_LO[b0] * (1 - w) + R_LO[(b0 + 1) % NBIN] * w
    rh = R_HI[b0] * (1 - w) + R_HI[(b0 + 1) % NBIN] * w
    k = s * s * (3 - 2 * s)
    rt = rl + (rh - rl) * k + 0.012 * np.sin(np.pi * min(1.0, s * 1.4))
    # hand back to the body's own surface over the top and bottom 3 cm (no ledge where the reshaping ends)
    r0 = np.hypot(co[i, 0] - TX, co[i, 1])
    edge = min(1.0, (co[i, 2] - Z_LO) / 0.03, (Z_HI - co[i, 2]) / 0.03)
    rt = r0 + (rt - r0) * max(0.0, edge)
    co[i, 0] = TX - np.cos(a) * rt
    co[i, 1] = np.sin(a) * rt
smooth_w[hipsel] = 1.0
log(f"hips: {len(hipsel)} vertices reshaped between z {Z_LO:.3f} and {Z_HI:.3f}")

# 3. the sleeves become arms: each ring round the upper arm / forearm axis scaled to an adult woman's arm
#    (radius in m along the arm from the shoulder joint; t = 0 shoulder, 1 elbow, 2 wrist)
PROFILE = [(0.0, 0.052), (0.25, 0.047), (0.6, 0.043), (0.95, 0.037), (1.15, 0.038), (1.5, 0.033), (1.85, 0.027), (2.0, 0.026)]


def prof(t):
    for (t0, r0), (t1, r1) in zip(PROFILE, PROFILE[1:]):
        if t <= t1:
            k = max(0.0, min(1.0, (t - t0) / (t1 - t0)))
            return r0 + (r1 - r0) * k
    return PROFILE[-1][1]


report = {}
for side in ("L", "R"):
    S, E, Hd = J[f"Bip01 {side} UpperArm"], J[f"Bip01 {side} Forearm"], J[f"Bip01 {side} Hand"]
    sgn = 1 if S.y > 0 else -1
    segs = [(S, E, 0.0), (E, Hd, 1.0)]
    # arm vertices: past the armpit and nearest to this arm's axis
    rings = {}
    for i in range(n):
        if arm_side[i] != sgn:
            continue
        p = Vector(co[i])
        best = None
        for a, b, t0 in segs:
            ab = b - a
            t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
            d = (p - (a + ab * t)).length
            if best is None or d < best[0]:
                best = (d, t0 + t, a + ab * t)
        d, t, axis = best
        if reg[i] == SKIN and t > 1.9:
            continue  # the hand itself
        rings.setdefault(round(t * 40), []).append((i, d, axis))
    for key, lst in rings.items():
        t = key / 40
        mean = sum(d for _, d, _ in lst) / len(lst)
        if t < 0.12:
            continue  # the shoulder: blends from the torso
        k = prof(t) / max(mean, 1e-4)
        k = min(1.0, k)  # only ever in
        fade = min(1.0, (t - 0.12) / 0.25)
        for i, d, axis in lst:
            if reg[i] == SKIN:
                continue
            p = Vector(co[i])
            q = axis + (p - axis) * k
            co[i] = (p + (q - p) * fade)[:]
        report.setdefault(side, []).append((round(t, 3), round(mean, 4), round(prof(t), 4)))
for side in report:
    report[side].sort()
    log(side, "sleeve radius (t, was, now):", report[side][::6])
for i, v in enumerate(bm.verts):
    v.co = co[i]
# a light overall smoothing of the moved parts (no ridges where the reshaping hands over)
moved = np.clip(np.maximum(blazer, smooth_w), 0, 1)
co = taubin(np, co, src_i, dst_i, deg, 8, fixed=1.0 - moved)
band_w = ((arm_side == 0) & (co[:, 2] > Z_LO - 0.04) & (co[:, 2] < Z_HI + 0.06)).astype(np.float64) * moved
co = taubin(np, co, src_i, dst_i, deg, 25, fixed=1.0 - band_w, lam=0.5, mu=0.0)
for i, v in enumerate(bm.verts):
    v.co = co[i]
bm.to_mesh(form.data)
bm.free()
form.data.update()
reg_attr = form.data.attributes.new("blazer", "FLOAT", "POINT")
for i in range(n):
    reg_attr.data[i].value = float(blazer[i])
rg = form.data.attributes.new("near_region", "INT", "POINT")
for i in range(n):
    rg.data[i].value = int(reg[i])

# weights onto the form (nearest face, interpolated) from the body
dt = form.modifiers.new("weights", "DATA_TRANSFER")
dt.object = src
dt.use_vert_data = True
dt.data_types_verts = {"VGROUP_WEIGHTS"}
dt.vert_mapping = "POLYINTERP_NEAREST"
dt.layers_vgroup_select_src = "ALL"
dt.layers_vgroup_select_dst = "NAME"
with bpy.context.temp_override(object=form, active_object=form, selected_objects=[form]):
    bpy.ops.object.datalayout_transfer(modifier=dt.name)
apply_mod(form, dt)
log("form", len(form.data.polygons), "faces")
for o in (src, kept, form):
    o.data.update()
body.hide_render = True
os.makedirs(WORK, exist_ok=True)
write_json(os.path.join(WORK, "prep.json"), {"body_matrix_world": [list(r) for r in body.matrix_world], "arms": report})
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "prep.blend"))
log("wrote", os.path.join(WORK, "prep.blend"))

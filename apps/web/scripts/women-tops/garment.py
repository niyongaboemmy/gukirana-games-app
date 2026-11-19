"""Step 2: one feminine top, cut from the form, draped with Blender cloth in the relaxed (arms down) pose.

    blender -b apps/web/scripts/women-tops/work/prep.blend -P apps/web/scripts/women-tops/garment.py -- --kind tee

Per kind (KINDS below: neckline, sleeve end, hem, ease, fabric):
  1. the panel: cut out of an evenly re-meshed copy of the form (--voxel metres) by the cut rules, its borders relaxed
     into smooth curves;
  2. the hang: the torso part is pushed out to the surface a real top hangs on: from the bust (and the shoulder
     blades) the fabric falls with a limited inward slope instead of following the under-bust and the waist, and it
     spans the valley between the breasts; then the ease (fit) on top;
  3. skin weights from the form (= the body's); cloth after the armature, soft goals (firm at the neckline and the
     shoulders, free at the hem);
  4. drape: the body goes from its A-pose into a relaxed pose (upper arms down, elbows a little bent) over 30 frames
     and holds 40: gravity, collisions with the form and the fabric's own stiffness make the folds (under the bust,
     at the waist and hips, the armpits, the elbows of long sleeves);
  5. the settled shape is un-skinned (inverse of each vertex's blend of bone matrices) back into the rest pose: on
     the phone, skinning in the same relaxed pose gives the simulated shape back;
  6. a light Taubin smoothing, then anything closer than 2 mm to the body pushed out;
  7. the same once more on a 4x denser copy (one subdivision, no self collision): its finer folds are baked into
     the low garment's normal map (bake.py);
  8. hems after simulation: every border turned in (2.5 mm lip towards the body, then a 1 cm facing on the inside),
     so every edge shows a thickness.
  The skin of the bare arms (and of a neckline lower than the body's own neck / chest skin) is cut from the form too:
  the part of the body the blazer covered that this top leaves bare.
Writes work/<kind>.blend with objects <kind>_lo, <kind>_hi, <kind>_skin.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from common import SKIN, WORK, Vector, apply_mod, args, bone_heads, bvh_of, components, copy_object, deform_matrices, edge_pairs, fail, log, rotate_bone_world, skin_matrix, taubin, vertex_groups_of, write_json  # noqa: E402

# neck: shape, front depth (m below the neck base), half width (m) | sleeve: end along the arm (0 shoulder joint,
# 1 elbow, 2 wrist) | hem: below the hip joints (m) | ease (m) | cloth: mass, tension, bending | slope: how steeply
# the fabric may fall inwards below the bust (m per m) | goal_hem: soft pin at the hem
KINDS = {
    "tee": dict(neck="crew", depth=0.035, width=0.072, sleeve=0.42, hem=0.15, ease=0.006, mass=0.1, tension=80.0, bending=2.0, slope=0.16, goal_hem=0.35),
    "jersey": dict(neck="vee", depth=0.085, width=0.052, sleeve=0.5, hem=0.155, ease=0.011, mass=0.13, tension=80.0, bending=1.6, slope=0.22, goal_hem=0.12),
    "hoodie": dict(neck="crew", depth=0.025, width=0.07, sleeve=2.03, hem=0.16, ease=0.016, mass=0.3, tension=100.0, bending=3.5, slope=0.18, goal_hem=0.2, band=True),
    "track": dict(neck="mock", depth=0.0, width=0.062, sleeve=2.03, hem=0.15, ease=0.009, mass=0.18, tension=90.0, bending=3.5, slope=0.24, goal_hem=0.18, band=True),
    "shirt": dict(neck="vee", depth=0.075, width=0.052, sleeve=1.0, hem=0.155, ease=0.01, mass=0.16, tension=110.0, bending=4.0, slope=0.25, goal_hem=0.15),
    "sash": dict(neck="scoop", depth=0.045, width=0.08, sleeve=0.98, hem=0.15, ease=0.008, mass=0.16, tension=100.0, bending=3.0, slope=0.26, goal_hem=0.15),
}
A = args({"kind": "tee", "voxel": 0.024, "ramp": 30, "hold": 40, "quality": 10, "arm_down": 0.62, "elbow": 0.2, "hi": True, "out": "", "calm": 1})
K = KINDS.get(A["kind"]) or fail(f"unknown kind {A['kind']}")
scene = bpy.context.scene
rig = bpy.data.objects["Bip01"]
form = bpy.data.objects["form"]
kept = bpy.data.objects["kept"]
src = bpy.data.objects["src"]
J = bone_heads(rig)
neck = J["Bip01 Neck"]
pelvis = J["Bip01 Pelvis"]
hip_z = (J["Bip01 L Thigh"].z + J["Bip01 R Thigh"].z) / 2
# neck base: the centre of the neck where it meets the shoulders (between the clavicles, a little in front of the neck
# bone)
NB = Vector((neck.x - 0.005, 0.0, (J["Bip01 L Clavicle"].z + neck.z) / 2 - 0.012))
FWD = Vector((-1, 0, 0))
log(f"{A['kind']}: neck base {tuple(round(x, 3) for x in NB)}, hip z {hip_z:.3f}")


def rest_pose():
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()


def relaxed_pose():
    """upper arms turned down from the A-pose (about 12 degrees off the body), elbows a little bent"""
    rest_pose()
    for side, sgn in (("L", 1), ("R", -1)):
        up = f"Bip01 {side} UpperArm"
        if J[up].y > 0:
            sgn = -1
        else:
            sgn = 1
        rotate_bone_world(rig, up, Vector((1, 0, 0)), sgn * A["arm_down"])
        fa = rig.pose.bones[f"Bip01 {side} Forearm"]
        hd = rig.pose.bones[f"Bip01 {side} Hand"]
        mw = rig.matrix_world
        e = mw @ fa.head
        h = mw @ hd.head
        d = (h - e).normalized()
        axis = d.cross(FWD).normalized()
        rotate_bone_world(rig, f"Bip01 {side} Forearm", axis, A["elbow"])


rest_pose()
# ---- cut source: the form re-meshed evenly at --voxel (it is closed), weights from the form
cut = copy_object(form, "_cut")
rm = cut.modifiers.new("remesh", "REMESH")
rm.mode = "VOXEL"
rm.voxel_size = A["voxel"]
rm.adaptivity = 0
apply_mod(cut, rm)
for vg in list(cut.vertex_groups):
    cut.vertex_groups.remove(vg)


def transfer_weights(dst, srco):
    for vg in list(dst.vertex_groups):
        dst.vertex_groups.remove(vg)
    dt = dst.modifiers.new("weights", "DATA_TRANSFER")
    dt.object = srco
    dt.use_vert_data = True
    dt.data_types_verts = {"VGROUP_WEIGHTS"}
    dt.vert_mapping = "POLYINTERP_NEAREST"
    dt.layers_vgroup_select_src = "ALL"
    dt.layers_vgroup_select_dst = "NAME"
    with bpy.context.temp_override(object=dst, active_object=dst, selected_objects=[dst]):
        bpy.ops.object.datalayout_transfer(modifier=dt.name)
    apply_mod(dst, dt)


# where each cut vertex lies: arm parameter t (0 shoulder joint, 1 elbow, 2 wrist) or torso; near what body region
form_bvh = bvh_of(form)
kept_bvh = bvh_of(kept)
src_bvh = bvh_of(src)
src_region = [src.data.attributes["region"].data[p.index].value for p in src.data.polygons]
gn = {g.index: g.name for g in src.vertex_groups}
dom = [gn[max(v.groups, key=lambda g: g.weight).group] if len(v.groups) else "" for v in src.data.vertices]
ARMK = ("UpperArm", "Forearm", "Hand", "Finger")


def where(p):
    """(arm side +-1 or 0, t along the arm, nearest body region)"""
    loc, nrm, idx, d = src_bvh.find_nearest(p)
    names = [dom[k] for k in src.data.polygons[idx].vertices]
    side = 0
    if sum(1 for x in names if any(a in x for a in ARMK)) * 2 > len(names):
        side = 1 if p.y > 0 else -1
    t = 0.0
    if side:
        s = "R" if (J["Bip01 R UpperArm"].y > 0) == (side > 0) else "L"
        S, E, Hd = J[f"Bip01 {s} UpperArm"], J[f"Bip01 {s} Forearm"], J[f"Bip01 {s} Hand"]
        best = None
        for a, b, t0 in ((S, E, 0.0), (E, Hd, 1.0)):
            ab = b - a
            tt = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
            dd = (p - (a + ab * tt)).length
            if best is None or dd < best[0]:
                best = (dd, t0 + tt)
        t = best[1]
        # the shoulder cap belongs to the torso
        if t < 0.02:
            side = 0
    return side, t, src_region[idx]


def neck_drop(p):
    """how far below the neck base the neckline runs at the point's direction round the neck (m, + = lower)"""
    r = p - NB
    hz = Vector((r.x, r.y, 0))
    h = hz.length
    front = max(0.0, min(1.0, 0.5 + 0.5 * (hz.dot(FWD) / max(h, 1e-6))))
    x = abs(r.y)
    shape, depth, w = K["neck"], K["depth"], K["width"]
    if shape == "mock":
        return -0.03  # a stand collar: up the neck
    if shape == "vee":
        return 0.004 + depth * front ** 2 * max(0.0, 1 - x / w)
    rr = min(1.0, x / w)
    return (0.004 if shape == "scoop" else 0.0) + depth * front ** 1.5 * (1 - rr * rr) ** 0.5


def in_neck(p):
    """inside the neckline opening (not part of the top)"""
    r = p - NB
    hz = Vector((r.x, r.y, 0))
    h = hz.length
    front = 0.5 + 0.5 * (hz.dot(FWD) / max(h, 1e-6))
    # the opening's radius round the neck: the cut's half width at the sides, a little less at the back (the back
    # neckline sits close to the neck), wider at the front for a scoop
    w = K["width"] * (0.9 + 0.1 * front) if K["neck"] != "scoop" else K["width"] * (0.85 + 0.25 * front)
    if front > 0.75 and K["neck"] in ("vee", "scoop"):
        w = max(w, h + 0.001) if r.z > -neck_drop(p) else w
    if h > w:
        return False
    return r.z > -neck_drop(p)


hem_z = hip_z - K["hem"]
# the trousers' top under the top (above its hem + 1.5 cm) is not drawn: under the jacket it bulges into the jacket's
# flared skirt. Same rule as the runtime (women-tops.ts coveredByTop, the hem height comes with the asset)
COVER = 0.015
kept_k = copy_object(kept, "_kept_k")
bm = bmesh.new()
bm.from_mesh(kept_k.data)
rl = bm.faces.layers.int["region"]
gone = [f for f in bm.faces if f[rl] == 3 and all(v.co.z > hem_z + COVER for v in f.verts)]
bmesh.ops.delete(bm, geom=gone, context="FACES")
bm.to_mesh(kept_k.data)
bm.free()
kept_bvh = bvh_of(kept_k)
log(f"trousers under the top: {len(gone)} faces not drawn")


def keep_top(p, info):
    side, t, reg = info
    if p.z < hem_z:
        return False
    if side:
        return t <= K["sleeve"]
    if in_neck(p):
        return False
    # the head itself (the form goes on up the neck: a mock collar stops 5 cm up)
    if p.z > NB.z + (0.05 if K["neck"] == "mock" else 0.0) + 0.03:
        return False
    return reg != SKIN


def cut_panel(name, keep, all_parts=False):
    me = cut.data.copy()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    bm = bmesh.new()
    bm.from_mesh(me)
    info = {v.index: where(v.co) for v in bm.verts}
    keepv = {v.index for v in bm.verts if keep(v.co, info[v.index])}
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not all(v.index in keepv for v in f.verts)], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    comps = components(bm)
    big = set(v for c in comps if all_parts and len(c) > 30 or c is comps[0] for v in c)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v not in big], context="VERTS")
    # faces hanging on by one vertex / spikes on the border: drop border vertices with a single face, twice
    for _ in range(2):
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.is_boundary and len(v.link_faces) < 2], context="VERTS")
    # relax the border into a smooth curve (along the border only)
    for _ in range(40):
        new = {}
        for v in bm.verts:
            if not v.is_boundary:
                continue
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) == 2:
                new[v] = v.co * 0.5 + (nb[0].co + nb[1].co) * 0.25
        for v, c in new.items():
            v.co = c
    bm.to_mesh(me)
    bm.free()
    me.materials.clear()
    for p in me.polygons:
        p.use_smooth = True
    return ob


t0 = time.time()
top = cut_panel(f"{A['kind']}_lo", keep_top)
transfer_weights(top, form)
log(f"panel: {len(top.data.vertices)} vertices, {len(top.data.polygons)} faces ({time.time() - t0:.1f} s)")


# ---- the hang + ease
def hang(ob):
    """torso vertices out to the surface fabric hangs on (cylindrical coordinates round the trunk axis)"""
    me = ob.data
    co = np.array([v.co[:] for v in me.vertices])
    info = [where(Vector(c)) for c in co]
    torso = np.array([i[0] == 0 for i in info])
    cx, cy = (NB.x + pelvis.x) / 2 + 0.005, 0.0
    ang = np.arctan2(co[:, 1] - cy, -(co[:, 0] - cx))  # 0 = front
    r = np.hypot(co[:, 0] - cx, co[:, 1] - cy)
    nA, dz = 72, 0.01
    z0, z1 = hem_z - 0.02, NB.z + 0.02
    nZ = int((z1 - z0) / dz) + 2
    R = np.zeros((nA, nZ))
    ai = ((ang + np.pi) / (2 * np.pi) * nA).astype(int) % nA
    zi = np.clip(((co[:, 2] - z0) / dz).astype(int), 0, nZ - 1)
    for k in np.nonzero(torso)[0]:
        R[ai[k], zi[k]] = max(R[ai[k], zi[k]], r[k])
    # empty cells: from the neighbours round the trunk
    for _ in range(8):
        Rn = R.copy()
        for a in range(nA):
            for z in range(nZ):
                if R[a, z] == 0:
                    nb = [R[(a + d) % nA, z] for d in (-1, 1) if R[(a + d) % nA, z] > 0]
                    if nb:
                        Rn[a, z] = sum(nb) / len(nb)
        R = Rn
    # fall from above with a limited inward slope (front and back: the sides follow the waist more, real tops do)
    H = R.copy()
    for a in range(nA):
        th = (a + 0.5) / nA * 2 * np.pi - np.pi
        fb = abs(np.cos(th))  # 1 front / back, 0 sides
        slope = K["slope"] / max(0.35, fb)
        for z in range(nZ - 2, -1, -1):
            H[a, z] = max(H[a, z], H[a, z + 1] - slope * dz)
    # span hollows round the trunk (between the breasts, the spine): per row, the convex hull in the plane
    for z in range(nZ):
        pts = np.stack([np.cos((np.arange(nA) + 0.5) / nA * 2 * np.pi - np.pi) * H[:, z], np.sin((np.arange(nA) + 0.5) / nA * 2 * np.pi - np.pi) * H[:, z]], 1)
        if (H[:, z] <= 0).any():
            continue
        # radial convex envelope: a point inside the hull of its neighbours +-6 bins is lifted onto it
        for a in range(nA):
            best = H[a, z]
            for d in range(2, 7):
                p1, p2 = pts[(a - d) % nA], pts[(a + d) % nA]
                th = (a + 0.5) / nA * 2 * np.pi - np.pi
                u = np.array([np.cos(th), np.sin(th)])
                # intersection of the ray u with the chord p1 p2
                m = np.array([u, p1 - p2]).T
                if abs(np.linalg.det(m)) < 1e-9:
                    continue
                s, _ = np.linalg.solve(m, p1)
                best = max(best, s)
            H[a, z] = best
    # smooth the envelope a little (no facets)
    for _ in range(3):
        H = (np.roll(H, 1, 0) + np.roll(H, -1, 0) + 2 * H) / 4
        H[:, 1:-1] = (H[:, :-2] + H[:, 2:] + 2 * H[:, 1:-1]) / 4
    moved = 0
    for k in np.nonzero(torso)[0]:
        # bilinear sample of H
        fa = (ang[k] + np.pi) / (2 * np.pi) * nA - 0.5
        fz = (co[k, 2] - z0) / dz
        a0 = int(np.floor(fa)) % nA
        a1 = (a0 + 1) % nA
        z0i = int(np.clip(np.floor(fz), 0, nZ - 2))
        wa = fa - np.floor(fa)
        wz = np.clip(fz - z0i, 0, 1)
        h = (H[a0, z0i] * (1 - wa) + H[a1, z0i] * wa) * (1 - wz) + (H[a0, z0i + 1] * (1 - wa) + H[a1, z0i + 1] * wa) * wz
        # near the neckline and the armholes the fabric lies on the body (fade the hang in below the shoulders)
        fade = np.clip((NB.z - 0.06 - co[k, 2]) / 0.08, 0, 1)
        if h > r[k]:
            s = r[k] + (h - r[k]) * fade
            co[k, 0] = cx - np.cos(ang[k]) * s
            co[k, 1] = cy + np.sin(ang[k]) * s
            moved += 1
    for i, v in enumerate(me.vertices):
        v.co = co[i]
    log(f"hang: {moved} torso vertices moved out")


def ease(ob, e):
    sw = ob.modifiers.new("ease", "SHRINKWRAP")
    sw.target = form
    sw.wrap_method = "NEAREST_SURFACEPOINT"
    sw.wrap_mode = "OUTSIDE_SURFACE"
    sw.offset = e
    apply_mod(ob, sw)


ease(top, K["ease"])
hang(top)
# smooth what the hang left (a few Taubin passes, borders along themselves)
bm = bmesh.new()
bm.from_mesh(top.data)
s_, d_, deg_ = edge_pairs(np, bm)
bm.free()
co = taubin(np, np.array([v.co[:] for v in top.data.vertices]), s_, d_, deg_, 6)
for i, v in enumerate(top.data.vertices):
    v.co = co[i]
ease(top, K["ease"])  # (outside the form again after smoothing)


# ---- pins, armature, cloth
def rig_up(ob):
    pin = ob.vertex_groups.new(name="pin")
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    border = {v.index for v in bm.verts if v.is_boundary}
    ring = border | {e.other_vert(bm.verts[i]).index for i in border for e in bm.verts[i].link_edges}
    bm.free()
    for v in ob.data.vertices:
        p = v.co
        side, t, _ = where(p)
        dn = NB.z - p.z  # below the neck base
        if side:
            # sleeves: firm at the shoulder, softer towards the cuff (the sleeve hangs and bunches)
            w = 0.55 - 0.25 * min(1.0, t / 1.5)
            if K["sleeve"] >= 1.9:
                # long sleeves follow the arm closely (free, the upper sleeve was caught as the arm came down and
                # folded out into a wing); they still bunch a little towards the cuff
                w = max(w, 0.85 if t < 1.6 else 0.65)
            if 0.7 < K["sleeve"] < 1.9 and t > K["sleeve"] - 0.2:
                # an elbow-length sleeve's open end: the forearm sweeping down caught it and turned it out into a wing
                w = max(w, 0.75)
        else:
            k = max(0.0, min(1.0, (dn - 0.05) / max(0.05, NB.z - hem_z - 0.05)))
            w = 0.9 - (0.9 - K["goal_hem"]) * k ** 0.6
        if dn < 0.05 and not side:
            w = 1.0
        if v.index in ring:
            w = max(w, 0.35 if (side == 0 and p.z < hem_z + 0.03) else 0.6)
        if K.get("band") and (p.z < hem_z + 0.05 and not side or side and t > K["sleeve"] - 0.12):
            w = max(w, 0.85)  # ribbed bands grip
        # the armpit: squeezed between arm and ribs when the arm comes down, free cloth is pushed out sideways into a
        # wing (long sleeves). It follows the skin there (folds from the skinning's own compression)
        for s in ("L", "R"):
            ap = J[f"Bip01 {s} UpperArm"] + Vector((0, 0, -0.07)) - Vector((0, J[f"Bip01 {s} UpperArm"].y * 0.25, 0))
            dd = (p - ap).length
            if dd < 0.11 and K["sleeve"] > 0.7:
                w = max(w, 0.95 - 0.4 * max(0.0, (dd - 0.05) / 0.06))
        pin.add([v.index], w, "REPLACE")
    arm = ob.modifiers.new("skin", "ARMATURE")
    arm.object = rig


def add_cloth(ob, frames, self_collision=True, dense=False):
    c = ob.modifiers.new("cloth", "CLOTH")
    s = c.settings
    s.quality = A["quality"]
    s.mass = K["mass"]
    s.tension_stiffness = K["tension"]
    s.compression_stiffness = K["tension"]
    s.shear_stiffness = K["tension"] * 0.3
    # (the dense copy has 4x the vertices: the same bending value folds it into crumples, it gets 3x)
    s.bending_stiffness = K["bending"] * (3.0 if dense else 1.0)
    s.air_damping = 1.0
    s.vertex_group_mass = "pin"
    s.pin_stiffness = 0.6
    cs = c.collision_settings
    cs.distance_min = 0.003
    cs.use_self_collision = self_collision
    cs.self_distance_min = 0.002
    c.point_cache.frame_start = 1
    c.point_cache.frame_end = frames
    return c


# collider: the form, skinned
collider = copy_object(form, "_collider")
am = collider.modifiers.new("skin", "ARMATURE")
am.object = rig
collider.modifiers.new("collision", "COLLISION")
collider.collision.thickness_outer = 0.003
collider.collision.cloth_friction = 3.0
collider.hide_render = True

# the pose ramp: rest at frame 1, relaxed at 1 + ramp, held
frames = 1 + A["ramp"] + A["hold"]
rest_pose()
rig.animation_data_create()
act = bpy.data.actions.new("_ramp")
rig.animation_data.action = act
for pb in rig.pose.bones:
    pb.keyframe_insert("rotation_quaternion", frame=1)
relaxed_pose()
for pb in rig.pose.bones:
    pb.keyframe_insert("rotation_quaternion", frame=1 + A["ramp"])
    pb.keyframe_insert("rotation_quaternion", frame=frames)


def simulate(ob, what, self_collision=True, dense=False):
    t0 = time.time()
    scene.frame_set(1)
    cl = add_cloth(ob, frames, self_collision, dense)
    for f in range(1, frames + 1):
        scene.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    posed = [v.co.copy() for v in me.vertices]
    ev.to_mesh_clear()
    log(f"simulated {what}: {len(posed)} vertices, {frames} frames, {time.time() - t0:.1f} s")
    D = deform_matrices(rig)
    groups = vertex_groups_of(ob)
    rest = [skin_matrix(groups[i], D).inverted() @ posed[i] for i in range(len(posed))]
    ob.modifiers.remove(cl)
    return rest, posed


def calm_weights(bm, co):
    """P2-AVA-18: where the simulation leaves crumples a viewer reads as defects, 0..1 per vertex: the underarm (torso
    side and the sleeve's underside round the upper arm, below the shoulder line), a band along every border (the
    neckline, sleeve and hem edges came out wavy / beaded), and the front above the hem (creases where the trousers'
    waist pushed into the fabric)"""
    n = len(co)
    w = np.zeros(n)
    # rings from the border (0 = on it)
    ring = np.full(n, 99)
    front = [v.index for v in bm.verts if v.is_boundary]
    for i in front:
        ring[i] = 0
    for r in range(1, 5):
        nxt = []
        for i in front:
            for e in bm.verts[i].link_edges:
                j = e.other_vert(bm.verts[i]).index
                if ring[j] > r:
                    ring[j] = r
                    nxt.append(j)
        front = nxt
    w = np.maximum(w, np.clip(1.0 - ring / 4.5, 0.0, 1.0))
    for s_ in ("L", "R"):
        S, E = J[f"Bip01 {s_} UpperArm"], J[f"Bip01 {s_} Forearm"]
        a = np.array(S[:])
        ab = np.array((E - S)[:])
        t = np.clip(((co - a) @ ab) / (ab @ ab), 0.0, 1.0)
        d = np.linalg.norm(co - (a + t[:, None] * ab), axis=1)
        below = np.clip((S.z - 0.01 - co[:, 2]) / 0.03, 0.0, 1.0)
        near = np.clip(1.0 - (d - 0.06) / 0.05, 0.0, 1.0) * (t < 0.55)
        w = np.maximum(w, near * below)
        # the torso's side under the arm (where the arm coming down pressed the cloth together)
        sy = 1.0 if S.y > 0 else -1.0
        side = np.clip((co[:, 1] * sy - (abs(S.y) - 0.1)) / 0.03, 0.0, 1.0)
        band = np.clip((S.z - co[:, 2]) / 0.03, 0.0, 1.0) * np.clip((co[:, 2] - (hem_z + 0.03)) / 0.04, 0.0, 1.0)
        w = np.maximum(w, side * band)
    above_hem = np.clip(1.0 - (co[:, 2] - hem_z - 0.12) / 0.12, 0.0, 1.0) * (co[:, 0] < pelvis.x + 0.02)
    w = np.maximum(w, 0.8 * above_hem)
    return w


def calm(ob, co, passes=60):
    """P2-AVA-18: take the small-scale crumples out where calm_weights says (Taubin steps weighted per vertex: the broad
    folds and the volume stay), the borders along themselves only (a hem stays where it was cut)"""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    w = calm_weights(bm, co)
    s_, d_, deg_ = edge_pairs(np, bm)
    bm.free()
    out = taubin(np, co, s_, d_, deg_, passes, fixed=1.0 - w)
    log(f"calm {ob.name}: {int((w > 0.5).sum())} of {len(co)} vertices, {passes} passes")
    return out


def smooth_weights(ob, co, passes=12):
    """P2-AVA-18: in the calm zones the skin weights are smoothed too. The torso's side under the arm carried patches
    of upper-arm weight from the body: skinned into a pose other than the simulated one they pulled single points out
    as lumps."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    zone = calm_weights(bm, co)
    nbr = [[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]
    bm.free()
    groups = [g.index for g in ob.vertex_groups if g.name != "pin"]
    n = len(ob.data.vertices)
    W = np.zeros((n, max(groups) + 1 if groups else 1))
    for v in ob.data.vertices:
        for g in v.groups:
            if g.group in groups:
                W[v.index, g.group] = g.weight
    # the torso below the armpit follows the spine only: no upper-arm / forearm weight (the arm coming down pulled the
    # cloth over the ribs out into a lump); the sleeves (near the arm bone) keep theirs
    arm_g = [g.index for g in ob.vertex_groups if any(a in g.name for a in ("UpperArm", "Forearm", "Hand"))]
    for s_ in ("L", "R"):
        S, E = J[f"Bip01 {s_} UpperArm"], J[f"Bip01 {s_} Forearm"]
        a = np.array(S[:])
        ab = np.array((E - S)[:])
        t = np.clip(((co - a) @ ab) / (ab @ ab), 0.0, 1.0)
        d = np.linalg.norm(co - (a + t[:, None] * ab), axis=1)
        torso = (d > 0.075) & (co[:, 2] < S.z - 0.05) & ((co[:, 1] > 0) == (S.y > 0))
        for gi in arm_g:
            W[torso, gi] = 0.0
    for _ in range(passes):
        avg = np.array([W[nb].mean(axis=0) if nb else W[i] for i, nb in enumerate(nbr)])
        k = np.clip(zone, 0.0, 1.0)[:, None] * 0.8
        W = W * (1 - k) + avg * k
    tot = W.sum(axis=1, keepdims=True)
    W = np.where(tot > 1e-6, W / np.maximum(tot, 1e-6), W)
    for gi in groups:
        vg = ob.vertex_groups[gi]
        for i in np.nonzero(zone > 0.01)[0]:
            w = float(W[i, gi])
            if w > 1e-4:
                vg.add([int(i)], w, "REPLACE")
            else:
                vg.remove([int(i)])
    log(f"weights smoothed {ob.name}: {int((zone > 0.01).sum())} vertices")


def finish(ob, rest, gap=0.002, passes=6):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    s_, d_, deg_ = edge_pairs(np, bm)
    bm.free()
    co = taubin(np, np.array([c[:] for c in rest]), s_, d_, deg_, passes)
    # the simulation leaves the free edges a little jagged: relax every border along itself (a hem is a smooth line)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    bnb = {v.index: [e.other_vert(v).index for e in v.link_edges if e.is_boundary] for v in bm.verts if v.is_boundary}
    bm.free()
    for _ in range(10):
        nxt = co.copy()
        for i, nb in bnb.items():
            if len(nb) == 2:
                nxt[i] = co[i] * 0.5 + (co[nb[0]] + co[nb[1]]) * 0.25
        co = nxt
    def push(co, gap):
        n_ = 0
        for i in range(len(co)):
            p = Vector(co[i])
            for bvh, g in ((form_bvh, gap), (kept_bvh, gap + 0.001)):
                loc, n, idx, d = bvh.find_nearest(p)
                if loc is not None and d < 0.025 and (p - loc).dot(n) < g:
                    p = loc + n * g
                    n_ += 1
            co[i] = p[:]
        return n_

    pushed = push(co, gap)
    if A["calm"]:
        # P2-AVA-18: calm after the push (pushed single points in the A-pose's armpit crease became lumps once skinned
        # into the arms-down pose), then push only what is still clearly inside (> 3 mm)
        co = calm(ob, co)
        pushed += push(co, -0.003)
        smooth_weights(ob, co)
    for i, v in enumerate(ob.data.vertices):
        v.co = co[i]
    ob.data.update()
    return pushed


hi = None
if A["hi"]:
    hi = copy_object(top, f"{A['kind']}_hi")
    sub = hi.modifiers.new("dense", "SUBSURF")
    sub.levels = 1
    sub.subdivision_type = "SIMPLE"
    apply_mod(hi, sub)
    # (subdivided after weights: the new vertices interpolate them)
rig_up(top)
rest, posed = simulate(top, "low")
rest_pose()
scene.frame_set(1)
pushed = finish(top, rest)
log(f"low: {pushed} points pushed out of the body")
if hi is not None:
    rig_up(hi)
    rest_h, _ = simulate(hi, "dense", self_collision=False, dense=True)
    rest_pose()
    scene.frame_set(1)
    finish(hi, rest_h, gap=0.0015, passes=2)
    for m in list(hi.modifiers):
        hi.modifiers.remove(m)


# ---- hems: lip + inner facing on every border (low garment)
def outside(p, gap=0.0006):
    """a hem point kept just outside the body (a neckline lies 2 mm off the neck: its 2.5 mm lip went through the skin
    and showed as a beaded line)"""
    for bvh in (form_bvh, kept_bvh):
        loc, n, idx, d = bvh.find_nearest(p)
        if loc is not None and d < 0.02 and (p - loc).dot(n) < gap:
            p = loc + n * gap
    return p


def hem(ob, depth=0.0025, facing=0.01):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    cl = bm.faces.layers.int.get("cloth") or bm.faces.layers.int.new("cloth")
    hl = bm.faces.layers.int.get("hem") or bm.faces.layers.int.new("hem")
    for f in bm.faces:
        f[cl] = 1
    bm.normal_update()
    border_edges = [e for e in bm.edges if e.is_boundary]
    border = {v for e in border_edges for v in e.verts}
    nrm = {v: v.normal.copy() for v in border}
    # the direction into the fabric along the surface (from the border towards the inside), for the facing
    inward = {}
    for v in border:
        inner = [e.other_vert(v) for e in v.link_edges if not e.is_boundary]
        if inner:
            c = sum((x.co for x in inner), Vector()) / len(inner)
            d = c - v.co
            d -= nrm[v] * d.dot(nrm[v])
            inward[v] = d.normalized() if d.length > 1e-6 else Vector()
        else:
            inward[v] = Vector()
    bm.faces.ensure_lookup_table()
    ref = bm.faces[0]
    ref_n = ref.normal.copy()
    orig = set(bm.faces)
    r1 = bmesh.ops.extrude_edge_only(bm, edges=border_edges)
    lip = [g for g in r1["geom"] if isinstance(g, bmesh.types.BMVert)]
    srcmap = {}
    for v in lip:
        for e in v.link_edges:
            o = e.other_vert(v)
            if o in border:
                srcmap[v] = o
                break
    for v in lip:
        o = srcmap.get(v)
        if o is not None:
            v.co = outside(o.co - nrm[o] * depth)
    lip_edges = [e for e in r1["geom"] if isinstance(e, bmesh.types.BMEdge) and all(v in srcmap for v in e.verts)]
    r2 = bmesh.ops.extrude_edge_only(bm, edges=lip_edges)
    fac = [g for g in r2["geom"] if isinstance(g, bmesh.types.BMVert)]
    for v in fac:
        for e in v.link_edges:
            o = e.other_vert(v)
            if o in srcmap:
                b = srcmap[o]
                v.co = outside(b.co - nrm[b] * depth + inward[b] * facing)
                break
    # the new faces wound like the cloth they continue (the shell stays outside-out as simulated)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    if ref.normal.dot(ref_n) < 0:
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
    # (P2-AVA-18: extruded faces inherit the layers of the face they grow from, so "cloth" alone marked no hem at all)
    for f in bm.faces:
        f[hl] = 0 if f in orig else 1
        f[cl] = 1 - f[hl]
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    for p in ob.data.polygons:
        p.use_smooth = True


nb_before = len(top.data.vertices)
hem(top)
log(f"hem: {nb_before} -> {len(top.data.vertices)} vertices")
for m in list(top.modifiers):
    top.modifiers.remove(m)
if "pin" in top.vertex_groups:
    top.vertex_groups.remove(top.vertex_groups["pin"])
if hi is not None and "pin" in hi.vertex_groups:
    hi.vertex_groups.remove(hi.vertex_groups["pin"])


# ---- the bare skin this top leaves: the form's arms below the sleeve, and blazer chest above a low neckline that the
# body's own skin does not cover
def keep_skin(p, info):
    """bare / hidden skin: the arms from inside the sleeve to 1.5 cm into the hand (long sleeves: only near the cuff,
    so the view into a cuff meets an arm), and the upper chest / back / shoulders under the top near the neckline (the
    view into the neckline gap meets skin, not the hollow inside of the top)"""
    side, t, reg = info
    if side:
        if t > 1.85:
            # past the old cuff: only 2 cm into the hand (hidden under it: the hand mesh started under the cuff)
            s = "R" if (J["Bip01 R UpperArm"].y > 0) == (side > 0) else "L"
            E, Hd = J[f"Bip01 {s} Forearm"], J[f"Bip01 {s} Hand"]
            ax = (Hd - E).normalized()
            past = (p - Hd).dot(ax)
            if reg == SKIN:
                return past < 0.085
            return past < 0.085
        return t >= (0.03 if K["sleeve"] < 1.9 else 1.55)
    if reg == SKIN or p.z < NB.z - 0.2:
        return False
    loc, n, idx, d = kept_bvh.find_nearest(p)
    return d is None or d > 0.003


def keep_under(p, info):
    """the trousers' waist under the hem (seen when looking up under the top): a band from the hem 12 cm up"""
    side, t, reg = info
    return side == 0 and reg != SKIN and hem_z - 0.01 < p.z < hem_z + 0.12


def inset(ob, depth):
    for v in ob.data.vertices:
        loc, n, idx, d = form_bvh.find_nearest(v.co)
        if loc is not None:
            v.co = loc - n * depth


skin = cut_panel(f"{A['kind']}_skin", keep_skin, all_parts=True)
transfer_weights(skin, form)
# 1.5 mm under the form: where the hand / the neck skin overlaps, the body wins
inset(skin, 0.0015)
# inside the hand the arm narrows (it must stay under the hand mesh when the wrist bends)
for v in skin.data.vertices:
    side, t, reg = where(v.co)
    if side and t > 1.9:
        s = "R" if (J["Bip01 R UpperArm"].y > 0) == (side > 0) else "L"
        E, Hd = J[f"Bip01 {s} Forearm"], J[f"Bip01 {s} Hand"]
        ax = (Hd - E).normalized()
        past = (v.co - Hd).dot(ax)
        if past > -0.02:
            c = Hd + ax * past
            k = 1.0 - 0.32 * min(1.0, (past + 0.02) / 0.07)
            v.co = c + (v.co - c) * k
under = cut_panel(f"{A['kind']}_under", keep_under)
transfer_weights(under, form)
inset(under, 0.003)
log(f"skin: {len(skin.data.polygons)} faces, under: {len(under.data.polygons)} faces")
for o in (collider, cut):
    bpy.data.objects.remove(o, do_unlink=True)
rig.animation_data.action = None
bpy.data.actions.remove(act)
rest_pose()
report = {"kind": A["kind"], "lo_faces": len(top.data.polygons), "hi_faces": len(hi.data.polygons) if hi else 0, "skin_faces": len(skin.data.polygons), "under_faces": len(under.data.polygons), "pushed": pushed, "cut": K}
write_json(os.path.join(WORK, f"{A['kind']}.json"), report)
bpy.ops.wm.save_as_mainfile(filepath=A["out"] or os.path.join(WORK, f"{A['kind']}.blend"))
log("wrote", A["kind"], report)

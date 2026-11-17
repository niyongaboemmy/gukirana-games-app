"""Step 5: singlet and trunks, simulated with Blender cloth on the rigged body, baked to per-pose corrective shape keys.

Verified on Blender 5.2.4 (P3-FGT-22, test body, 5 CMU poses: about 70 s for both garments). The slowest step.

    blender -b work/out/m/04-clips.blend -P apps/web/scripts/boxer-v9/05_cloth.py -- \
        --poses apps/web/scripts/boxer-v9/cloth-poses.json --out work/out/m/05-cloth.blend \
        --report work/out/m/correctives.json [--garments singlet,trunks] [--target 3500] [--source-singlet x.glb]

Why: the v8 kit was built in code and looked faceted with torn edges. Here the garment is a real cloth simulation
on the real body, in each key pose, and what the phone plays back is only skinning plus a blend of baked shapes.

Per garment:
  1. the panel: by default cut out of the body surface by skin weights (singlet = chest / back / clavicles above the
     waist, deep armholes and a scoop neck; trunks = pelvis and upper 55 % of the thighs, waistband at the navel),
     its border relaxed into a smooth curve, pushed out to the fitting ease and resized to --target triangles.
     --source-<garment> replaces this with your own mesh (e.g. a pattern-made garment from Blender or a CC0 model),
     which must already fit the body in its rest pose;
  2. a folded hem: the border is extruded 2.5 mm inwards, so every edge shows a thickness, never a paper cut;
  3. skin weights copied from the body; cloth modifier after the armature, waistband / strap tops pinned;
  4. drape: one simulation in the rest pose (gravity, no motion) becomes the garment's base shape;
  5. for every pose in --poses ({ "name", "clip", "t" }): the body is animated from rest into the pose over 24 frames
     and held 20 more, the cloth is simulated, and the settled shape is un-skinned back to rest space
     (inverse linear-blend skinning per vertex) and stored as the shape key corr_<name>;
  6. for the "guard" pose also a 4x denser copy (one subdivision) is simulated and kept as <garment>_hi_guard next to a posed low copy
     <garment>_lo_guard: step 7 bakes the wrinkles of the dense one into the low garment's normal map.
--report writes the pose list the runtime blends the shape keys by (as boxer/corrective.ts does for v8).
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
from common import apply_modifier, args, ctx, fail, import_any, log, meshes, read_json, save, select_only, skin_matrix, tris, write_json  # noqa: E402

A = args({"poses": None, "out": None, "report": "", "garments": ["singlet", "trunks"], "target": 3500, "source_singlet": "", "source_trunks": "", "ramp": 24, "hold": 20, "strict": False, "quality": 8, "goal_top": 0.6, "goal_hem": 0.25, "pin_stiffness": 1.0, "keep_sim": False, "armhole": 0.11, "via_guard": True, "guard_t": 0.0, "collide_arms": True, "max_arm_inside": 0, "max_stretch": 1.6, "goal_edge": 0.85})
scene = bpy.context.scene
body, rig = bpy.data.objects.get("body"), bpy.data.objects.get("boxer")
if body is None or rig is None:
    fail("needs 'body' and 'boxer' (steps 3-4)")
J = {b.name: b.head_local.copy() for b in rig.data.bones}
EASE = {"singlet": 0.006, "trunks": 0.014}
FABRIC = {  # polyester / satin-like boxing kit: light, soft in bending, little stretch
    # (P3-FGT-22: bending raised from 0.3 / 0.6, which crumpled the coarse game mesh into a bumpy, wet-paper look)
    "singlet": dict(mass=0.12, tension=12.0, compression=12.0, shear=4.0, bending=2.0),
    "trunks": dict(mass=0.18, tension=15.0, compression=15.0, shear=5.0, bending=4.0),
}


def dominant(v):
    best, w = None, 0.0
    for g in v.groups:
        if g.weight > w:
            best, w = body.vertex_groups[g.group].name, g.weight
    return best or ""


def keep_singlet(v):
    d, z = dominant(v), v.co.z
    if any(k in d for k in ("UpperArm", "ShoulderHelper", "Neck", "Head", "Forearm", "Hand", "Thigh")):
        return False
    if (v.co - J["Bip01_Neck"]).length < 0.085:  # scoop neck
        return False
    for S in ("L", "R"):  # deep athletic armhole
        if (v.co - J[f"Bip01_{S}_UpperArm"]).length < A["armhole"]:
            return False
    return z > J["Bip01"].z + 0.03


def keep_trunks(v):
    d, z = dominant(v), v.co.z
    knee = (J["Bip01_L_Calf"].z + J["Bip01_R_Calf"].z) / 2
    hem = knee + 0.45 * (J["Bip01_L_Thigh"].z - knee)
    if not any(k in d for k in ("Pelvis", "Spine", "Thigh")) or d.endswith("Spine1") or d.endswith("Spine2"):
        return False
    return hem < z < J["Bip01"].z + 0.11


def cut_panel(name, keep):
    me = body.data.copy()
    me.name = name
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    for k in list(ob.data.shape_keys.key_blocks) if ob.data.shape_keys else []:
        ob.shape_key_remove(k)
    bm = bmesh.new()
    bm.from_mesh(me)
    keepv = set()
    for v in bm.verts:
        mv = body.data.vertices[v.index]
        if keep(mv):
            keepv.add(v.index)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not all(v.index in keepv for v in f.verts)], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    # keep only the largest connected piece (drops islands left by the weight test)
    bm.verts.ensure_lookup_table()
    seen, best = set(), []
    for v in bm.verts:
        if v in seen:
            continue
        comp, stack = [], [v]
        seen.add(v)
        while stack:
            x = stack.pop()
            comp.append(x)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y not in seen:
                    seen.add(y)
                    stack.append(y)
        if len(comp) > len(best):
            best = comp
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v not in set(best)], context="VERTS")
    # relax the border into a smooth curve (the cut follows body triangles: jagged otherwise)
    for _ in range(30):
        border = [v for v in bm.verts if v.is_boundary]
        new = {}
        for v in border:
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) == 2:
                new[v] = v.co * 0.5 + (nb[0].co + nb[1].co) * 0.25
        for v, c in new.items():
            v.co = c
    bm.to_mesh(me)
    bm.free()
    me.materials.clear()  # the copy came with the skin material: the fabric gets its own
    me.materials.append(bpy.data.materials.get(name) or bpy.data.materials.new(name))
    for p in me.polygons:
        p.material_index = 0
    return ob


def fit(ob, ease):
    sw = ob.modifiers.new("ease", "SHRINKWRAP")
    sw.target = body
    sw.wrap_method = "NEAREST_SURFACEPOINT"
    sw.wrap_mode = "OUTSIDE_SURFACE"
    sw.offset = ease
    apply_modifier(ob, sw)
    n = tris(ob)
    if n > A["target"] * 1.05:
        dec = ob.modifiers.new("budget", "DECIMATE")
        dec.ratio = A["target"] / n
        apply_modifier(ob, dec)
    elif n < A["target"] * 0.5:
        # too coarse to fold: one simple subdivision (x4), then back down to the budget if that overshoots
        sub = ob.modifiers.new("dense", "SUBSURF")
        sub.subdivision_type = "SIMPLE"
        sub.levels = 1
        apply_modifier(ob, sub)
        if tris(ob) > A["target"]:
            dec = ob.modifiers.new("budget", "DECIMATE")
            dec.ratio = A["target"] / tris(ob)
            apply_modifier(ob, dec)
    log(f"{ob.name}: {n} -> {tris(ob)} triangles")


def hem(ob, depth=0.0025):
    """The folded hem: every border edge extruded 2.5 mm towards the body, so the edge shows a thickness.
    (P3-FGT-22) Made AFTER the simulation and on every shape key at once: a 2.5 mm lip inside the cloth simulation sat
    within the collision distance of the body, was thrown about and came out as jagged shards along the armholes and
    the waistband. The lip of each corrective is its border vertex moved along the rest normal (the correctives are in
    rest space and differ from the base by centimetres, so the rest normal is right for all of them)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    border = {v for e in bm.edges if e.is_boundary for v in e.verts}
    normal = {v: v.normal.copy() for v in border}
    uv = bm.loops.layers.uv.active
    edges = [e for e in bm.edges if e.is_boundary]
    ret = bmesh.ops.extrude_edge_only(bm, edges=edges)
    new_verts = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)]
    src = {}
    for v in new_verts:
        for e in v.link_edges:
            o = e.other_vert(v)
            if o in border:
                src[v] = o
                break
    layers = list(bm.verts.layers.shape.values())
    for v in new_verts:
        o = src.get(v)
        if o is None:
            continue
        d = normal[o] * depth
        v.co = o.co - d
        for lay in layers:
            v[lay] = o[lay] - d
    if uv is not None:  # the lip takes the UVs of its border (it reads as the same fabric)
        for f in {f for v in new_verts for f in v.link_faces}:
            for loop in f.loops:
                o = src.get(loop.vert, loop.vert)
                for lo in o.link_loops:
                    if lo.face is not f and lo.face not in {ff for v in new_verts for ff in v.link_faces}:
                        loop[uv].uv = lo[uv].uv
                        break
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def fold_groups(ob, keys, side_of):
    """move the weight of every group whose name contains one of keys onto Bip01_<side>_Clavicle"""
    vgs = {g.index: g for g in ob.vertex_groups}
    moved = {}
    for v in ob.data.vertices:
        for g in list(v.groups):
            name = vgs[g.group].name
            if g.weight > 0 and any(k in name for k in keys):
                moved.setdefault(f"Bip01_{side_of(name)}_Clavicle", []).append((v.index, g.weight))
                vgs[g.group].remove([v.index])
    for tgt, rows in moved.items():
        dst = ob.vertex_groups.get(tgt) or ob.vertex_groups.new(name=tgt)
        for i, w in rows:
            try:
                w0 = dst.weight(i)
            except RuntimeError:
                w0 = 0.0
            dst.add([i], w0 + w, "REPLACE")


def rig_garment(ob, kind):
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
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
    if kind == "singlet":
        # (P3-FGT-22) the singlet hangs from the shoulders, it does not ride the arm: the arm weights the transfer
        # copied near the armhole go to the clavicle. Otherwise the armhole edge followed the upper arm in a hook,
        # was squeezed between arm and torso and bunched up; now the arm passes outside the armhole and the body
        # collider pushes the side panel only where they really meet
        fold_groups(ob, ("UpperArm", "ShoulderHelper", "Forearm", "Hand", "Finger"), lambda n: n.split("_")[1])
    # pins (P3-FGT-22): the waistband / strap tops hard (1.0); everything else a SOFT goal towards the skinned shape,
    # strongest at the top and weakest at the hem. Without the soft goal a fast punch pose (the body turned up to
    # 90 degrees in 24 frames) threw the free cloth off the body and the corrective came back torn and flying; with
    # it the cloth still sags, folds and slides over the body collider, but stays a garment.
    pin = ob.vertex_groups.new(name="pin")
    zs = [v.co.z for v in ob.data.vertices]
    top, bottom = max(zs), min(zs)
    band = 0.03 if kind == "trunks" else 0.05  # elastic waistband / strap tops over the trapezius
    tuck = J["Bip01"].z + 0.11 + 0.01  # the trunks' waistband (keep_trunks) and 1 cm more
    # (P3-FGT-22) the border and its first ring follow the skin more firmly (a hem is double fabric, stiffer): a free
    # armhole edge on the back flipped over the shoulder blade in the lead hook, and the leg openings frayed
    bmx = bmesh.new()
    bmx.from_mesh(ob.data)
    edge_ring = {v.index for e in bmx.edges if e.is_boundary for v in e.verts}
    bmx.verts.ensure_lookup_table()
    edge_ring |= {o.index for i in list(edge_ring) for e in bmx.verts[i].link_edges for o in e.verts}
    bmx.free()
    for v in ob.data.vertices:
        if v.co.z > top - band:
            w = 1.0
        elif kind == "singlet" and "trunks" in A["garments"] and v.co.z < tuck:
            w = 1.0  # (P3-FGT-22) tucked into the trunks: it follows the skin and stays under the waistband
        else:
            h = (top - band - v.co.z) / max(1e-6, top - band - bottom)
            w = A["goal_top"] + (A["goal_hem"] - A["goal_top"]) * h
            if v.index in edge_ring:
                w = max(w, A["goal_edge"])
        pin.add([v.index], w, "REPLACE")
    arm = ob.modifiers.new("skin", "ARMATURE")
    arm.object = rig
    ob.parent = rig
    for p in ob.data.polygons:
        p.use_smooth = True


def add_cloth(ob, kind, frames, self_collision=True):
    c = ob.modifiers.new("cloth", "CLOTH")
    s = c.settings
    f = FABRIC[kind]
    s.quality = A["quality"]
    s.mass = f["mass"]
    s.tension_stiffness = f["tension"]
    s.compression_stiffness = f["compression"]
    s.shear_stiffness = f["shear"]
    s.bending_stiffness = f["bending"]
    s.air_damping = 1.0
    s.vertex_group_mass = "pin"
    s.pin_stiffness = A["pin_stiffness"]
    cs = c.collision_settings
    cs.distance_min = 0.003
    cs.use_self_collision = self_collision
    cs.self_distance_min = 0.002
    c.point_cache.frame_start = 1
    c.point_cache.frame_end = frames
    return c


def clip_pose(clip, t):
    """the pose bones' (quaternion, location) of a clip at time t"""
    act = bpy.data.actions.get(clip)
    if act is None:
        fail(f"no action '{clip}' (step 4 did not import it)")
    rig.animation_data_create()
    rig.animation_data.action = act
    scene.frame_set(int(round(t * 30)) + 1)
    return {pb.name: (pb.rotation_quaternion.copy(), pb.location.copy()) for pb in rig.pose.bones}


def pose_keys(clip, t):
    """Temporary action: rest at frame 1, then (P3-FGT-22) through the guard for every other pose, as a real punch
    starts from the guard, then the clip's pose at time t, held. Returns (action, last frame).
    Ramping straight from the A-pose rest swept the arms through the armholes and across the singlet (a rear hook
    crossing the chest dragged the front panel round the body)."""
    chain = [((1, 0, 0, 0), (0, 0, 0))]
    if clip != "guard" and "guard" in bpy.data.actions and A["via_guard"]:
        chain_poses = [clip_pose("guard", A["guard_t"]), clip_pose(clip, t)]
    else:
        chain_poses = [clip_pose(clip, t)]
    tmp = bpy.data.actions.new("_cloth_ramp")
    rig.animation_data.action = tmp
    last = 1
    for pb in rig.pose.bones:
        keys = [(1, chain[0])]
        prev = chain[0][0]
        for i, cp in enumerate(chain_poses):
            q, loc = cp[pb.name]
            q = q.copy()
            # (the keys are interpolated per channel: a quaternion on the other side of the 4D sphere is the same turn
            # the long way round, a near full spin of the bone in 24 frames that wrapped the singlet round the body)
            if q.dot(q.__class__(prev)) < 0:
                q.negate()
            prev = tuple(q)
            keys.append((1 + A["ramp"] * (i + 1), (q, loc)))
        keys.append((keys[-1][0] + A["hold"], keys[-1][1]))
        for frame, (q, loc) in keys:
            pb.rotation_quaternion = q
            pb.location = loc
            pb.keyframe_insert("rotation_quaternion", frame=frame)
            pb.keyframe_insert("location", frame=frame)
        last = keys[-1][0]
    return tmp, last


def simulate(ob, frames, what=""):
    t0 = time.time()
    # (P3-FGT-22) a fresh collision modifier at frame 1: the collider remembers its previous position, and jumping
    # back from the last pose's held frame read as the body sweeping from that pose to rest through the cloth in one
    # step. The garments crumpled more with every pose simulated before (jab, cross, then the rear hook was a rag)
    collider.modifiers.remove(collider.modifiers["collision"])
    scene.frame_set(1)
    collider.modifiers.new("collision", "COLLISION")
    scene.frame_set(1)
    for f in range(1, frames + 1):
        scene.frame_set(f)
    log(f"  simulated {ob.name} {what}: {frames} frames, {len(ob.data.vertices)} vertices, {time.time() - t0:.1f} s")
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    co = [v.co.copy() for v in me.vertices]
    ev.to_mesh_clear()
    return co


def arm_radius():
    """per side: the upper arm's skin radius around the shoulder-elbow segment (median, rest pose)"""
    out = {}
    for S in ("L", "R"):
        a, b = J[f"Bip01_{S}_UpperArm"], J[f"Bip01_{S}_Forearm"]
        gi = body.vertex_groups.get(f"Bip01_{S}_UpperArm")
        ds = []
        for v in body.data.vertices:
            if gi is None or not any(g.group == gi.index and g.weight > 0.8 for g in v.groups):
                continue
            t = max(0.0, min(1.0, (v.co - a).dot(b - a) / (b - a).length_squared))
            ds.append((v.co - (a + (b - a) * t)).length)
        ds.sort()
        out[S] = ds[len(ds) // 2] if ds else 0.045
    return out


ARM_R = None


def checks(ob, posed):
    """(P3-FGT-22) the acceptance numbers of one simulated pose:
    arm: garment vertices inside an upper arm (closer to the shoulder-elbow segment than 85 % of the arm's radius,
         between 15 % and 90 % of its length): fabric through the arm, or the arm hidden in the fabric;
    stretch: the largest edge length of the posed garment over its rest length (a tear reads as > 1.6);
    floor: the lowest garment point (m)."""
    global ARM_R
    ARM_R = ARM_R or arm_radius()
    inside = 0
    for S in ("L", "R"):
        pa = rig.pose.bones[f"Bip01_{S}_UpperArm"].head.copy()
        pb = rig.pose.bones[f"Bip01_{S}_Forearm"].head.copy()
        ab = pb - pa
        for c in posed:
            t = (c - pa).dot(ab) / ab.length_squared
            if 0.15 < t < 0.9 and (c - (pa + ab * t)).length < 0.85 * ARM_R[S]:
                inside += 1
    # stretch against the plain skinned garment in the same pose (what the simulation added: skinning's own stretch
    # at the hips is not the cloth's fault); edges under 4 mm (the folded hem's depth) are left out
    skinned = [skin_matrix(rig, ob, v) @ v.co for v in ob.data.vertices]
    ratios = []
    for e in ob.data.edges:
        i, j = e.vertices
        r = (skinned[i] - skinned[j]).length
        if r > 0.004:
            ratios.append((posed[i] - posed[j]).length / r)
    ratios.sort()
    p99 = ratios[int(len(ratios) * 0.99)] if ratios else 1.0
    return {"arm_inside": inside, "max_stretch": round(ratios[-1] if ratios else 1.0, 3), "p99_stretch": round(p99, 3), "lowest_z": round(min(c.z for c in posed), 4)}


def unskin(ob, posed):
    """posed (mesh space, after armature + cloth) -> rest space, by inverting each vertex's skinning matrix"""
    return [skin_matrix(rig, ob, v).inverted() @ posed[v.index] for v in ob.data.vertices]


def rest_pose():
    rig.animation_data_create()
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)


poses = read_json(A["poses"])
# a pose whose clip was not retargeted (CMU has no knockdown, corner sit ...) is skipped, unless --strict
skipped = [p for p in poses if p["clip"] not in bpy.data.actions]
if skipped and A["strict"]:
    fail("no action for the cloth poses " + ", ".join(f"{p['name']} ({p['clip']})" for p in skipped))
for p in skipped:
    log(f"SKIP pose {p['name']}: no clip '{p['clip']}' in this file")
poses = [p for p in poses if p not in skipped]
if not poses:
    fail("none of the cloth poses has its clip (step 4)")
# the collider: a skinned copy of the body WITHOUT forearms, hands and fingers (P3-FGT-22). With the whole body, a
# hook's forearm sweeping across the chest (mocap on another build passes a few mm through it) caught the singlet and
# dragged it round the torso. The upper arms stay: they are what keeps the armholes open and the arms outside.
collider = body.copy()
collider.data = body.data.copy()
collider.name = "_cloth_collider"
bpy.context.collection.objects.link(collider)
for k in list(collider.data.shape_keys.key_blocks)[::-1] if collider.data.shape_keys else []:
    collider.shape_key_remove(k)
cbm = bmesh.new()
cbm.from_mesh(collider.data)
cbm.verts.ensure_lookup_table()
drop = {i for i, g in enumerate(collider.vertex_groups) if any(k in g.name for k in (("Forearm", "Hand", "Finger") if A["collide_arms"] else ("UpperArm", "ShoulderHelper", "Forearm", "Hand", "Finger")))}
dl = cbm.verts.layers.deform.active
bmesh.ops.delete(cbm, geom=[f for f in cbm.faces if all(sum(w for gi, w in v[dl].items() if gi in drop) > 0.5 for v in f.verts)], context="FACES")
cbm.to_mesh(collider.data)
cbm.free()
for m in list(collider.modifiers):
    if m.type != "ARMATURE":
        collider.modifiers.remove(m)
collider.hide_render = True
coll = collider.modifiers.new("collision", "COLLISION")
collider.collision.thickness_outer = 0.004
collider.collision.cloth_friction = 5.0
frames = 1 + A["ramp"] + A["hold"]
report = {"poses": poses, "skipped": [p["name"] for p in skipped], "garments": {}}
quality = {}

for kind in A["garments"]:
    src = A.get("source_" + kind) or ""
    if src:
        ob = meshes(import_any(os.path.abspath(src)))[0]
        ob.name = kind
    else:
        ob = cut_panel(kind, keep_singlet if kind == "singlet" else keep_trunks)
        fit(ob, EASE[kind])
    select_only([ob])
    with ctx(ob):
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.01)
        bpy.ops.object.mode_set(mode="OBJECT")
    rig_garment(ob, kind)

    # 4. drape in the rest pose -> base shape
    rest_pose()
    cl = add_cloth(ob, kind, frames)
    drape = simulate(ob, frames, "drape")
    ob.modifiers.remove(cl)
    for v in ob.data.vertices:
        v.co = drape[v.index]
    ob.shape_key_add(name="Basis", from_mix=False)

    # 5. one corrective per pose
    names = []
    corr = {}
    for p in poses:
        tmp, nf = pose_keys(p["clip"], p["t"])
        cl = add_cloth(ob, kind, nf)
        posed = simulate(ob, nf, p["name"])
        if A["keep_sim"]:  # debugging: the raw simulated shape of each pose as a static, hidden object
            dbg = bpy.data.objects.new(f"{kind}_sim_{p['name']}", bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get())))
            bpy.context.collection.objects.link(dbg)
            dbg.hide_render = True
        rest = unskin(ob, posed)
        q = checks(ob, posed)
        quality.setdefault(kind, {})[p["name"]] = q
        log(f"  check {kind} {p['name']}: {q['arm_inside']} vertices inside an upper arm, stretch max {q['max_stretch']} / p99 {q['p99_stretch']}")
        ob.modifiers.remove(cl)
        # (P3-FGT-22) the corrective is kept aside and only becomes a shape key after the last pose: with the keys
        # already on the mesh, every later simulation started more crumpled (measured: the rear hook alone was clean,
        # after jab and cross it was a rag)
        corr[p["name"]] = rest
        log(f"{kind}: corr_{p['name']} from {p['clip']} @ {p['t']} s")

        # 6. dense guard copy for the wrinkle normal bake (the scene is still at the held guard frame)
        if p["name"] == "guard":
            hi = ob.copy()
            hi.data = ob.data.copy()
            bpy.context.collection.objects.link(hi)
            for k in list(hi.data.shape_keys.key_blocks)[::-1]:
                hi.shape_key_remove(k)
            sub = hi.modifiers.new("dense", "SUBSURF")
            # (P3-FGT-22: level 1 and no self-collision; level 2 with self-collision took over 10 minutes per garment on
            # an M2 Pro for the same wrinkles at a 1k / 2k bake)
            sub.levels = 1
            with ctx(hi):
                bpy.ops.object.modifier_move_to_index(modifier=sub.name, index=0)
            add_cloth(hi, kind, nf, self_collision=False)
            simulate(hi, nf, "dense guard")
            dg = bpy.context.evaluated_depsgraph_get()
            hi_static = bpy.data.objects.new(f"{kind}_hi_guard", bpy.data.meshes.new_from_object(hi.evaluated_get(dg)))
            sk = ob.shape_key_add(name="_guard_tmp", from_mix=False)  # the low garment wearing its guard corrective, posed
            for i, c in enumerate(rest):
                sk.data[i].co = c
            sk.value = 1.0
            dg = bpy.context.evaluated_depsgraph_get()
            lo = bpy.data.objects.new(f"{kind}_lo_guard", bpy.data.meshes.new_from_object(ob.evaluated_get(dg)))
            ob.shape_key_remove(sk)
            ob.active_shape_key_index = 0
            bpy.data.objects.remove(hi, do_unlink=True)
            for o in (lo, hi_static):
                bpy.context.collection.objects.link(o)
                o.hide_render = True
                o.hide_set(True)
        rig.animation_data.action = None
        bpy.data.actions.remove(tmp)
    rest_pose()
    for name, rest in corr.items():
        sk = ob.shape_key_add(name="corr_" + name, from_mix=False)
        for i, c in enumerate(rest):
            sk.data[i].co = c
        names.append(sk.name)
    ob.active_shape_key_index = 0
    hem(ob)
    report["garments"][kind] = {"triangles": tris(ob), "shape_keys": names}

bpy.data.objects.remove(collider, do_unlink=True)
report["checks"] = quality
bad = [f"{k} {n}" for k, ps in quality.items() for n, q in ps.items() if q["arm_inside"] > A["max_arm_inside"] or q["max_stretch"] > A["max_stretch"]]
report["failed"] = bad
if bad:
    log("CHECK FAILED (arm through the fabric or a tear-like stretch): " + ", ".join(bad))
save(A["out"])
if A["report"]:
    write_json(A["report"], report)

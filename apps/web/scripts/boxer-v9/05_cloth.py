"""Step 5: singlet and trunks, simulated with Blender cloth on the rigged body, baked to per-pose corrective shape keys.

UNTESTED: needs Blender (4.2+). The slowest step (minutes per pose on a laptop CPU).

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
  6. for the "guard" pose also a 4x denser copy is simulated and kept as <garment>_hi_guard next to a posed low copy
     <garment>_lo_guard: step 7 bakes the wrinkles of the dense one into the low garment's normal map.
--report writes the pose list the runtime blends the shape keys by (as boxer/corrective.ts does for v8).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
from common import apply_modifier, args, ctx, fail, import_any, log, meshes, read_json, save, select_only, skin_matrix, tris, write_json  # noqa: E402

A = args({"poses": None, "out": None, "report": "", "garments": ["singlet", "trunks"], "target": 3500, "source_singlet": "", "source_trunks": "", "ramp": 24, "hold": 20})
scene = bpy.context.scene
body, rig = bpy.data.objects.get("body"), bpy.data.objects.get("boxer")
if body is None or rig is None:
    fail("needs 'body' and 'boxer' (steps 3-4)")
J = {b.name: b.head_local.copy() for b in rig.data.bones}
EASE = {"singlet": 0.006, "trunks": 0.014}
FABRIC = {  # polyester / satin-like boxing kit: light, soft in bending, little stretch
    "singlet": dict(mass=0.12, tension=12.0, compression=12.0, shear=4.0, bending=0.3),
    "trunks": dict(mass=0.18, tension=15.0, compression=15.0, shear=5.0, bending=0.6),
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
        if (v.co - J[f"Bip01_{S}_UpperArm"]).length < 0.10:
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
    for _ in range(12):
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
        sub = ob.modifiers.new("dense", "SUBSURF")
        sub.subdivision_type = "SIMPLE"
        sub.levels = 1
        apply_modifier(ob, sub)
    log(f"{ob.name}: {n} -> {tris(ob)} triangles")


def hem(ob, depth=0.0025):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    edges = [e for e in bm.edges if e.is_boundary]
    ret = bmesh.ops.extrude_edge_only(bm, edges=edges)
    for v in [g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)]:
        v.co -= v.normal * depth
    bm.to_mesh(ob.data)
    bm.free()


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
    pin = ob.vertex_groups.new(name="pin")
    zs = [v.co.z for v in ob.data.vertices]
    top = max(zs)
    for v in ob.data.vertices:
        w = 0.0
        if kind == "trunks" and v.co.z > top - 0.03:
            w = 1.0  # elastic waistband
        if kind == "singlet" and v.co.z > top - 0.05:
            w = 1.0  # strap tops over the trapezius
        if w:
            pin.add([v.index], w, "REPLACE")
    arm = ob.modifiers.new("skin", "ARMATURE")
    arm.object = rig
    ob.parent = rig
    for p in ob.data.polygons:
        p.use_smooth = True


def add_cloth(ob, kind, frames):
    c = ob.modifiers.new("cloth", "CLOTH")
    s = c.settings
    f = FABRIC[kind]
    s.quality = 10
    s.mass = f["mass"]
    s.tension_stiffness = f["tension"]
    s.compression_stiffness = f["compression"]
    s.shear_stiffness = f["shear"]
    s.bending_stiffness = f["bending"]
    s.air_damping = 1.0
    s.vertex_group_mass = "pin"
    s.pin_stiffness = 1.0
    cs = c.collision_settings
    cs.distance_min = 0.003
    cs.use_self_collision = True
    cs.self_distance_min = 0.002
    c.point_cache.frame_start = 1
    c.point_cache.frame_end = frames
    return c


def pose_keys(clip, t):
    """Temporary action: rest at frame 1, the clip's pose at time t from frame 1+ramp, held."""
    act = bpy.data.actions.get(clip)
    if act is None:
        fail(f"no action '{clip}' (step 4 did not import it)")
    rig.animation_data_create()
    rig.animation_data.action = act
    scene.frame_set(int(round(t * 30)) + 1)
    target = {pb.name: (pb.rotation_quaternion.copy(), pb.location.copy()) for pb in rig.pose.bones}
    tmp = bpy.data.actions.new("_cloth_ramp")
    rig.animation_data.action = tmp
    for pb in rig.pose.bones:
        for frame, (q, loc) in ((1, ((1, 0, 0, 0), (0, 0, 0))), (1 + A["ramp"], target[pb.name]), (1 + A["ramp"] + A["hold"], target[pb.name])):
            pb.rotation_quaternion = q
            pb.location = loc
            pb.keyframe_insert("rotation_quaternion", frame=frame)
            pb.keyframe_insert("location", frame=frame)
    return tmp


def simulate(ob, frames):
    for f in range(1, frames + 1):
        scene.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    co = [v.co.copy() for v in me.vertices]
    ev.to_mesh_clear()
    return co


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
coll = body.modifiers.get("collision") or body.modifiers.new("collision", "COLLISION")
body.collision.thickness_outer = 0.004
body.collision.cloth_friction = 5.0
frames = 1 + A["ramp"] + A["hold"]
report = {"poses": poses, "garments": {}}

for kind in A["garments"]:
    src = A.get("source_" + kind) or ""
    if src:
        ob = meshes(import_any(os.path.abspath(src)))[0]
        ob.name = kind
    else:
        ob = cut_panel(kind, keep_singlet if kind == "singlet" else keep_trunks)
        fit(ob, EASE[kind])
    hem(ob)
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
    drape = simulate(ob, frames)
    ob.modifiers.remove(cl)
    for v in ob.data.vertices:
        v.co = drape[v.index]
    ob.shape_key_add(name="Basis", from_mix=False)

    # 5. one corrective per pose
    names = []
    for p in poses:
        tmp = pose_keys(p["clip"], p["t"])
        cl = add_cloth(ob, kind, frames)
        posed = simulate(ob, frames)
        rest = unskin(ob, posed)
        ob.modifiers.remove(cl)
        sk = ob.shape_key_add(name="corr_" + p["name"], from_mix=False)
        for i, c in enumerate(rest):
            sk.data[i].co = c
        names.append(sk.name)
        log(f"{kind}: corr_{p['name']} from {p['clip']} @ {p['t']} s")

        # 6. dense guard copy for the wrinkle normal bake (the scene is still at the held guard frame)
        if p["name"] == "guard":
            hi = ob.copy()
            hi.data = ob.data.copy()
            bpy.context.collection.objects.link(hi)
            for k in list(hi.data.shape_keys.key_blocks)[::-1]:
                hi.shape_key_remove(k)
            sub = hi.modifiers.new("dense", "SUBSURF")
            sub.levels = 2
            with ctx(hi):
                bpy.ops.object.modifier_move_to_index(modifier=sub.name, index=0)
            add_cloth(hi, kind, frames)
            simulate(hi, frames)
            dg = bpy.context.evaluated_depsgraph_get()
            hi_static = bpy.data.objects.new(f"{kind}_hi_guard", bpy.data.meshes.new_from_object(hi.evaluated_get(dg)))
            sk.value = 1.0  # the low garment wearing its own guard corrective, posed
            dg = bpy.context.evaluated_depsgraph_get()
            lo = bpy.data.objects.new(f"{kind}_lo_guard", bpy.data.meshes.new_from_object(ob.evaluated_get(dg)))
            sk.value = 0.0
            bpy.data.objects.remove(hi, do_unlink=True)
            for o in (lo, hi_static):
                bpy.context.collection.objects.link(o)
                o.hide_render = True
                o.hide_set(True)
        rig.animation_data.action = None
        bpy.data.actions.remove(tmp)
    rest_pose()
    report["garments"][kind] = {"triangles": tris(ob), "shape_keys": names}

body.modifiers.remove(coll)
save(A["out"])
if A["report"]:
    write_json(A["report"], report)

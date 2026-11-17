"""Step 0 (scans only, P3-FGT-23): turn a raw photogrammetry / structured-light body scan into an A-pose body that the
pipeline can use, and rig it OFFLINE onto our Bip01 joints (no Mixamo upload, no login).

    blender -b -P apps/web/scripts/boxer-v9/00_scan_prep.py -- --input work/in/scan/m/body.obj \
        --out work/out/m/scan-apose.glb --rig-out work/out/m/scan-rig.glb [--joints work/in/scan/m/joints.json] \
        [--views work/out/m/scan-views] [--height 0] [--arm-down 48] [--elbow 12] [--proxy-tris 60000]

What it does:
  1. imports the scan (OBJ / FBX / GLB / PLY), joins it, converts millimetres or centimetres to metres (a scan taller
     than 3 "metres" is taken as mm / cm), puts the feet on z = 0, centres it on the pelvis and checks it faces -Y
     (the nose must be the most forward point of the head; --turn 180 turns it);
  2. --views: renders front and side orthographic views with a 5 cm grid and stops. Use them to read the joint
     positions of an unusual pose into --joints (the Artec flex pose needed this); an A- or T-pose scan does not;
  3. joints: our Bip01 joints in the SCAN's pose. From --joints (metres, after step 1: {"Bip01_L_UpperArm": [x, y, z],
     ...}; any joint left out comes from the template), else the v8 skeleton scaled to the scan's height and then
     snapped to the centre of the scan's flesh around each joint (good for an A-pose; check the printed table);
  4. weights: bone heat ("automatic weights") on a decimated proxy (--proxy-tris), copied onto the full scan;
  5. re-pose: the arms are turned into our A-pose (upper arm --arm-down degrees below horizontal, a slight forward
     swing, the elbow bent --elbow degrees) and the full scan is frozen in that pose (the scan's own shape and texture
     move with it). Legs, spine and head stay as scanned;
  6. writes --out (the re-posed, unrigged full-resolution scan with its texture, for step 1) and --rig-out (the
     re-posed proxy WITH the Bip01 skeleton and its weights, the rig source for step 3 with --map bip01).

The fists of a flex pose stay fists: the gloves cover them (step 6 --hide-hands).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Quaternion  # noqa: E402
from common import BONE_MAP, Vector, apply_modifier, apply_transforms, args, ctx, fail, import_any, log, meshes, read_json, reset_scene, select_only, tris, write_json  # noqa: E402

A = args(
    {
        "input": None,
        "out": "",
        "rig_out": "",
        "joints": "",
        "views": "",
        "slices": False,
        "height": 0.0,
        "turn": 0.0,
        "arm_down": 48.0,
        "arm_forward": 8.0,
        "elbow": 12.0,
        "proxy_tris": 60000,
        "template": "../../public/assets/characters/v8/boxer-m.glb",
        "report": "",
    }
)
reset_scene()
if not os.path.exists(A["input"]):
    fail(f"scan not found: {A['input']} (docs/design/boxer-v9/SCAN-GUIDE.md says where it goes)")
ext = os.path.splitext(A["input"])[1].lower()
if ext == ".ply":
    bpy.ops.wm.ply_import(filepath=os.path.abspath(A["input"]))
    objs = list(bpy.data.objects)
else:
    objs = import_any(os.path.abspath(A["input"]))
for o in [o for o in objs if o.type != "MESH"]:
    bpy.data.objects.remove(o, do_unlink=True)
ms = meshes(list(bpy.data.objects))
if not ms:
    fail("no mesh in the scan")
for m in ms:
    m.parent = None
    for mod in list(m.modifiers):
        m.modifiers.remove(mod)
    if m.data.shape_keys:
        m.shape_key_clear()
    for vg in list(m.vertex_groups):
        m.vertex_groups.remove(vg)
apply_transforms(ms)
select_only(ms, ms[0])
if len(ms) > 1:
    with ctx(ms[0], ms):
        bpy.ops.object.join()
scan = bpy.context.view_layer.objects.active
scan.name = scan.data.name = "body"


# ---- 1. units, floor, centre, facing
def bounds(o):
    ps = [v.co for v in o.data.vertices]
    return Vector([min(p[i] for p in ps) for i in range(3)]), Vector([max(p[i] for p in ps) for i in range(3)])


lo, hi = bounds(scan)
# (P3-FGT-23) up axis: scanners disagree (the Artec OBJ is Z-up, which the OBJ importer takes as Y-up and lays the
# body down). The longest extent is the height; the feet end is the flat one: the soles put far more surface within
# 1 cm of the extreme than a round crown (or the fists of a flex pose) does
ext3 = hi - lo
ax = max(range(3), key=lambda i: ext3[i])
if ax != 2:
    rot = Matrix.Rotation(math.radians(-90), 4, "X") if ax == 1 else Matrix.Rotation(math.radians(90), 4, "Y")
    scan.data.transform(rot)
    scan.data.update()
    log(f"turned the body upright (its height was along {'XYZ'[ax]})")
    lo, hi = bounds(scan)


def flat(z0, z1):
    return sum(1 for v in scan.data.vertices if z0 <= v.co.z <= z1)


cm = 0.01 * (hi.z - lo.z) / 1.8  # 1 cm in the file's units, assuming an adult
if flat(hi.z - cm, hi.z) > flat(lo.z, lo.z + cm):
    scan.data.transform(Matrix.Rotation(math.pi, 4, "Y"))
    scan.data.update()
    log("turned the body feet down")
    lo, hi = bounds(scan)
h = hi.z - lo.z
unit = 0.001 if h > 300 else (0.01 if h > 3 else 1.0)
s = unit * (A["height"] / (h * unit) if A["height"] > 0 else 1.0)
if abs(s - 1) > 1e-6:
    scan.scale = (s, s, s)
    apply_transforms([scan])
    log(f"scale x{s:g} ({'mm' if unit == 0.001 else 'cm' if unit == 0.01 else 'm'} -> m{', height forced' if A['height'] > 0 else ''})")
if A["turn"]:
    scan.rotation_euler = (0, 0, math.radians(A["turn"]))
    apply_transforms([scan])
lo, hi = bounds(scan)
H = hi.z - lo.z
mid_x = (lo.x + hi.x) / 2
band = [v.co for v in scan.data.vertices if lo.z + 0.50 * H < v.co.z < lo.z + 0.54 * H and abs(v.co.x - mid_x) < 0.12]
cx = (min(p.x for p in band) + max(p.x for p in band)) / 2 if band else mid_x
cy = (min(p.y for p in band) + max(p.y for p in band)) / 2 if band else (lo.y + hi.y) / 2
scan.data.transform(Matrix.Translation((-cx, -cy, -lo.z)))
scan.data.update()
lo, hi = bounds(scan)
head = [v.co for v in scan.data.vertices if v.co.z > 0.9 * H and abs(v.co.x) < 0.12]
nose_y = min(p.y for p in head)
back_y = max(p.y for p in head)
if abs(nose_y) < abs(back_y):  # the nose sticks out further than the back of the head
    fail("the scan faces +Y: run again with --turn 180")
log(f"scan: {tris(scan)} triangles, height {H:.3f} m, facing -Y")

if A["slices"]:
    # (P3-FGT-23) numbers to read joints from: per horizontal slice (every 2 cm) the x intervals of the flesh, with
    # each interval's mean y; and per vertical column (every 2 cm in x, |x| > 0.15) the z intervals
    pts = [v.co.copy() for v in scan.data.vertices][:: max(1, len(scan.data.vertices) // 120000)]

    def runs(vals, gap=0.012):
        vals = sorted(vals)
        out, start, prev = [], None, None
        for x in vals:
            if start is None:
                start = prev = x
            elif x - prev > gap:
                out.append((start, prev))
                start = x
            prev = x
        if start is not None:
            out.append((start, prev))
        return out

    for zi in range(int(H / 0.02), -1, -1):
        z = zi * 0.02
        sl = [p for p in pts if abs(p.z - z) < 0.006]
        rs = runs([p.x for p in sl])
        def yr(a, b):
            ys = [p.y for p in sl if a <= p.x <= b] or [0.0]
            return f"y{min(ys):+.3f}..{max(ys):+.3f}"

        log(f"z {z:.2f}: " + "  ".join(f"[{a:+.3f}..{b:+.3f} {yr(a, b)}]" for a, b in rs))
    for xi in list(range(-30, -7)) + list(range(8, 31)):
        x = xi * 0.02
        sl = [p for p in pts if abs(p.x - x) < 0.006]
        rs = runs([p.z for p in sl])
        log(f"x {x:+.2f}: " + "  ".join(f"[{a:.3f}..{b:.3f}]" for a, b in rs))
    sys.exit(0)

if A["views"]:
    # ---- 2. landmark views: front (looking along +Y) and side (looking along -X), orthographic, 5 cm grid
    os.makedirs(A["views"], exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "FLAT"
    sc.display.shading.color_type = "TEXTURE"
    sc.render.resolution_x, sc.render.resolution_y = 1400, 1400
    grid_mat = bpy.data.materials.new("grid")
    grid_mat.diffuse_color = (1, 0, 0, 1)
    for axis in ("x", "y"):
        bm = bmesh.new()
        for i in range(-24, 25):  # verticals every 5 cm (10 cm thicker)
            w = 0.0012 if i % 2 else 0.0025
            a = i * 0.05
            v = [(a - w, 0, 0), (a + w, 0, 0), (a + w, 0, 2.1), (a - w, 0, 2.1)] if axis == "x" else [(0, a - w, 0), (0, a + w, 0), (0, a + w, 2.1), (0, a - w, 2.1)]
            bm.faces.new([bm.verts.new(c) for c in v])
        for j in range(0, 43):
            w = 0.0012 if j % 2 else 0.0025
            z = j * 0.05
            v = [(-1.2, 0, z - w), (1.2, 0, z - w), (1.2, 0, z + w), (-1.2, 0, z + w)] if axis == "x" else [(0, -1.2, z - w), (0, 1.2, z - w), (0, 1.2, z + w), (0, -1.2, z + w)]
            bm.faces.new([bm.verts.new(c) for c in v])
        me = bpy.data.meshes.new("grid_" + axis)
        bm.to_mesh(me)
        g = bpy.data.objects.new("grid_" + axis, me)
        g.data.materials.append(grid_mat)
        g.location = (0, 0.4, 0) if axis == "x" else (-0.6, 0, 0)
        sc.collection.objects.link(g)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 2.1
    sc.collection.objects.link(cam)
    sc.camera = cam
    for name, loc, rot, hide in (("front", (0, -5, 1.0), (math.pi / 2, 0, 0), "grid_y"), ("side", (5, 0, 1.0), (math.pi / 2, 0, math.pi / 2), "grid_x")):
        cam.location, cam.rotation_euler = loc, rot
        for g in ("grid_x", "grid_y"):
            bpy.data.objects[g].hide_render = g == hide
        sc.render.filepath = os.path.join(os.path.abspath(A["views"]), f"{name}.png")
        bpy.ops.render.render(write_still=True)
        log("view", sc.render.filepath, "(grid: 5 cm, thick every 10 cm; x = 0 / y = 0 at the image centre, z = 0 at the bottom edge + 0.05 m)")
    sys.exit(0)

# ---- 3. joints in the scan's pose
parent = BONE_MAP["bip01_parent"]
CORE = [b for b in parent if "Finger" not in b and not b.endswith(("ShoulderHelper", "ForearmTwist", "Pelvis"))]
tmpl_objs = import_any(os.path.abspath(A["template"]))
tarm = next(o for o in tmpl_objs if o.type == "ARMATURE")
tj = {b.name: tarm.matrix_world @ b.head_local for b in tarm.data.bones}
tz = [p.z for p in tj.values()]
tH = max(tz) / 0.94 if tz else 1.8  # (the head joint sits at about 94 % of the height; only a scale)
for o in tmpl_objs:
    bpy.data.objects.remove(o, do_unlink=True)
k = H / tH
joint = {b: tj[b] * k for b in CORE if b in tj}
given = read_json(A["joints"]) if A["joints"] and os.path.exists(A["joints"]) else {}
for b, p in given.items():
    if not b.startswith("_"):
        joint[b] = Vector(p)
# snap the template joints we were not given onto the scan (A- / T-pose scans):
#  - trunk and legs: the horizontal slice through the joint, the piece of flesh nearest the template joint, its
#    middle in x and y (the spine joints sit 25 % of the depth towards the back);
#  - arms: the mean of the skin within 5 cm (the arm is thin, so that is its axis)
vco = [v.co.copy() for v in scan.data.vertices]
log(f"template: Bip01_L_UpperArm at x {joint['Bip01_L_UpperArm'].x:+.3f} (the fighter's left is +X)")
ARMS = ("Clavicle", "UpperArm", "Forearm", "Hand")
for b in CORE:
    if b in given or b not in joint:
        continue
    c = joint[b]
    if any(x in b for x in ARMS):
        for _ in range(3):
            near = [p for p in vco if (p - c).length < 0.05]
            if len(near) < 20:
                break
            c = sum(near, Vector()) / len(near)
    else:
        sl = sorted((p for p in vco if abs(p.z - c.z) < 0.006), key=lambda p: p.x)
        pieces, cur = [], []
        for p in sl:
            if cur and p.x - cur[-1].x > 0.012:
                pieces.append(cur)
                cur = []
            cur.append(p)
        if cur:
            pieces.append(cur)
        if pieces:
            pc = min(pieces, key=lambda q: 0 if q[0].x <= c.x <= q[-1].x else min(abs(q[0].x - c.x), abs(q[-1].x - c.x)))
            ys = [p.y for p in pc]
            back = 0.25 if b.startswith("Bip01_Spine") or b in ("Bip01", "Bip01_Neck") else 0.0
            ymid = (min(ys) + max(ys)) / 2 + back * (max(ys) - min(ys)) / 2
            xmid = (pc[0].x + pc[-1].x) / 2
            if b.startswith("Bip01_") and ("_L_" in b or "_R_" in b) and len(pieces) == 1 and any(x in b for x in ("Thigh",)):
                xmid = c.x  # (hips: one piece of pelvis, keep the template's spacing)
            c = Vector((xmid, ymid, c.z))
    joint[b] = c
joint.setdefault("Bip01", (joint["Bip01_L_Thigh"] + joint["Bip01_R_Thigh"]) / 2)
missing = [b for b in CORE if b not in joint]
if missing:
    fail("joints missing: " + ", ".join(missing))
for b in CORE:
    log(f"  joint {b:20s} {joint[b].x:+.3f} {joint[b].y:+.3f} {joint[b].z:+.3f}{'  (given)' if b in given else ''}")
# the pelvis bone carries the hips (Bip01, the moving root, carries no skin; 03_rig folds Bip01_Pelvis back into it)
joint["Bip01_Pelvis"] = joint["Bip01"].copy()
RIG = ["Bip01", "Bip01_Pelvis"] + [b for b in CORE if b != "Bip01"]

# ---- 4. a temporary armature at those joints, bone heat on a decimated proxy
children = {}
for b, p in parent.items():
    if p and b in joint:
        children.setdefault(p, []).append(b)
arm_data = bpy.data.armatures.new("scanrig")
rig = bpy.data.objects.new("scanrig", arm_data)
bpy.context.collection.objects.link(rig)
TIP = {"Bip01_Head": Vector((0, 0, 0.16)), "Bip01_L_Toe0": Vector((0, -0.05, 0)), "Bip01_R_Toe0": Vector((0, -0.05, 0))}
select_only([rig])
with ctx(rig):
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones
    for b in RIG:
        e = eb.new(b)
        e.head = joint[b]
        kids = [c for c in children.get(b, []) if c in RIG]
        if b == "Bip01_Pelvis":
            kids = ["Bip01_Spine"]
        if b == "Bip01_Spine2":
            kids = ["Bip01_Neck"]  # (not the clavicles: the chest bone runs up the spine)
        if b in ("Bip01_L_Hand", "Bip01_R_Hand"):
            fa = joint[b.replace("Hand", "Forearm")]
            e.tail = joint[b] + (joint[b] - fa).normalized() * 0.08
        elif b in TIP:
            e.tail = joint[b] + TIP[b]
        elif b == "Bip01":
            e.tail = joint[b] + Vector((0, 0, 0.05))
        elif kids:
            e.tail = sum((joint[c] for c in kids), Vector()) / len(kids)
        else:
            e.tail = joint[b] + Vector((0, 0, 0.05))
        if (e.tail - e.head).length < 0.01:
            e.tail = e.head + Vector((0, 0, 0.03))
    for b in RIG:
        p = parent[b]
        while p and p not in eb:
            p = parent.get(p)
        if p:
            eb[b].parent = eb[p]
    bpy.ops.object.mode_set(mode="OBJECT")
arm_data.bones["Bip01"].use_deform = False  # the root carries no skin (as in v8)

proxy = scan.copy()
proxy.data = scan.data.copy()
proxy.name = proxy.data.name = "proxy"
bpy.context.collection.objects.link(proxy)
if tris(proxy) > A["proxy_tris"]:
    dec = proxy.modifiers.new("dec", "DECIMATE")
    dec.ratio = A["proxy_tris"] / tris(proxy)
    apply_modifier(proxy, dec)
log(f"proxy: {tris(proxy)} triangles")
select_only([proxy, rig], rig)
with ctx(rig, [proxy, rig]):
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
bare = [v.index for v in proxy.data.vertices if sum(g.weight for g in v.groups) < 1e-4]
if len(bare) > 0.02 * len(proxy.data.vertices):
    log(f"bone heat left {len(bare)} vertices unweighted: falling back to envelope-style nearest-bone weights there")
if bare:
    # nearest bone segment for every vertex the heat solver missed
    segs = [(b.name, rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local) for b in arm_data.bones if b.use_deform]
    for i in bare:
        p = proxy.data.vertices[i].co

        def dist(s):
            a, c = s[1], s[2]
            t = max(0.0, min(1.0, (p - a).dot(c - a) / max(1e-9, (c - a).length_squared)))
            return (p - (a + (c - a) * t)).length

        name = min(segs, key=dist)[0]
        g = proxy.vertex_groups.get(name) or proxy.vertex_groups.new(name=name)
        g.add([i], 1.0, "REPLACE")
log(f"weights: {len(proxy.vertex_groups)} groups on the proxy, {len(bare)} vertices filled by nearest bone")

# the full scan takes the proxy's weights (same surface)
dt = scan.modifiers.new("w", "DATA_TRANSFER")
dt.object = proxy
dt.use_vert_data = True
dt.data_types_verts = {"VGROUP_WEIGHTS"}
dt.vert_mapping = "POLYINTERP_NEAREST"
dt.layers_vgroup_select_src = "ALL"
dt.layers_vgroup_select_dst = "NAME"
with ctx(scan):
    bpy.ops.object.datalayout_transfer(modifier=dt.name)
apply_modifier(scan, dt)


# ---- 5. re-pose the arms into our A-pose and freeze it
def aim(pb, direction):
    """turn pose bone pb (world space, rest = its edit direction) so its head->tail points along direction"""
    bpy.context.view_layer.update()
    cur = (pb.tail - pb.head).normalized()
    q = cur.rotation_difference(direction.normalized())
    m = rig.matrix_world.inverted() @ (Matrix.Translation(pb.head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-pb.head)) @ rig.matrix_world @ pb.matrix
    pb.matrix = m
    bpy.context.view_layer.update()


for pb in rig.pose.bones:
    pb.rotation_mode = "QUATERNION"
down, fwd, el = math.radians(A["arm_down"]), math.radians(A["arm_forward"]), math.radians(A["elbow"])
for S in ("L", "R"):
    side = 1.0 if joint[f"Bip01_{S}_UpperArm"].x > 0 else -1.0
    up = Vector((side * math.cos(down) * math.cos(fwd), -math.cos(down) * math.sin(fwd), -math.sin(down)))
    aim(rig.pose.bones[f"Bip01_{S}_UpperArm"], up)
    # the forearm bends forward (towards -Y) by the elbow angle: a turn of the upper arm's direction towards -Y
    n = up.cross(Vector((0, -1, 0))).normalized()
    fore = Quaternion(n, el) @ up
    aim(rig.pose.bones[f"Bip01_{S}_Forearm"], fore)
    aim(rig.pose.bones[f"Bip01_{S}_Hand"], fore)
for o in (scan, proxy):
    mod = o.modifiers.get("Armature") or next((m for m in o.modifiers if m.type == "ARMATURE"), None)
    if mod is None:
        mod = o.modifiers.new("Armature", "ARMATURE")
        mod.object = rig
    o.parent = None
    apply_modifier(o, mod)
select_only([rig])
with ctx(rig):
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")
posed = {b.name: (rig.matrix_world @ b.head_local) for b in arm_data.bones}
for S in ("L", "R"):
    a, b = posed[f"Bip01_{S}_UpperArm"], posed[f"Bip01_{S}_Forearm"]
    d = (b - a).normalized()
    log(f"  {S} upper arm now {math.degrees(math.asin(max(-1, min(1, -d.z)))):.0f} degrees below horizontal")
lo2, hi2 = bounds(scan)
if lo2.z < -0.002:
    log(f"WARNING: the re-posed scan reaches {lo2.z:.3f} m below the floor")

# ---- 6. outputs
if A["out"]:
    os.makedirs(os.path.dirname(os.path.abspath(A["out"])), exist_ok=True)
    for vg in list(scan.vertex_groups):
        scan.vertex_groups.remove(vg)
    select_only([scan])
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(A["out"]), use_selection=True, export_format="GLB", export_yup=True, export_apply=True, export_skins=False, export_animations=False)
    log("wrote", A["out"], f"({tris(scan)} triangles, A-pose, with the scan texture)")
if A["rig_out"]:
    mod = proxy.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    proxy.parent = rig
    proxy.name = proxy.data.name = "body"
    scan.name = "scan_full"
    select_only([proxy, rig], rig)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(A["rig_out"]), use_selection=True, export_format="GLB", export_yup=True, export_skins=True, export_animations=False, export_materials="NONE")
    log("wrote", A["rig_out"], "(the rig source for step 3: --map bip01 --source-mesh body)")
if A["report"]:
    write_json(A["report"], {"height": H, "joints_scan_pose": {b: list(joint[b]) for b in CORE}, "joints_a_pose": {b: list(p) for b, p in posed.items()}})

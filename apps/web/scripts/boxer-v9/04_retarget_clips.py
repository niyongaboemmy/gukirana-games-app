"""Step 4: retarget the clips (Mixamo FBX or CMU BVH) onto our Bip01 skeleton, one Blender action per fight clip.

Verified on Blender 5.2.4 (P3-FGT-22) with --map cmu (CMU BVH takes on the v8 test body). The Mixamo route is the same
code with --map mixamo; it is not run yet (needs the user's Mixamo downloads).

    blender -b work/out/m/03-rigged.blend -P apps/web/scripts/boxer-v9/04_retarget_clips.py -- \
        --clips apps/web/scripts/boxer-v9/mixamo-clips.json --dir work/in/mixamo/m \
        --out work/out/m/04-clips.blend --report work/out/m/clips-report.json [--only jab,cross] [--map mixamo|cmu]

--clips lists { "clip": our name (world/human/boxing/clips.ts), "file": the downloaded FBX / BVH, "mirror": bool,
"strip_root": bool, "loop": bool, "hand": "L" | "R" | null } and, for long takes (CMU), "start" / "end" in seconds
of the take, "face": "hips" | "chest" | "punch" (turn the take to face our -Y, plus "yaw" degrees; see below). Download every
Mixamo clip "Without Skin, FBX Binary, 30 fps, no keyframe reduction" while YOUR uploaded character is selected in
Mixamo (then the clip is already on your proportions).

Method (no constraints, no bake operator): for every frame, each target bone gets the source bone's world rotation
relative to the source rest pose, applied to the target rest pose:

    R_target(f) = R_source(f) * R_source_rest^-1 * A * R_target_rest

A turns the target's rest bone direction (joint to child joint) onto the source's (P3-FGT-22): it is the identity
when both rests are the same pose (Mixamo auto-rig on our own body), and is what makes a T-pose source (CMU) land
right on an A-pose target (the v8 test body). Only the root (Bip01) also gets the source hip translation, scaled by
the leg-length ratio, with the lowest ankle of the clip put at our standing ankle height. Children keep their own
bone lengths, so a clip made on another skeleton lands without stretching. A floor guard then lifts the root on any
frame where an ankle or toe joint would sink below its standing height (no foot through the floor). Mirroring is
exact and cheap because every bone of our skeleton has the same rest orientation: swap L and R, then
(w, x, y, z) -> (w, x, -y, -z) and location x -> -x.

--report writes, per clip: frames, seconds, the root travel over the clip in three.js axes (x, z forward, yaw) for
clips.ts `travel`, and the frame of the largest wrist speed for punches (a first guess at `impact`, check by eye).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from mathutils import Quaternion  # noqa: E402
from common import BONE_MAP, Matrix, Vector, args, armature, fail, import_any, log, mixamo_name, read_json, save, source_map, write_json  # noqa: E402

A = args({"clips": None, "dir": None, "out": None, "report": "", "only": [], "root": "Bip01", "map": "mixamo"})
rig = bpy.data.objects.get("boxer")
if rig is None:
    fail("no 'boxer' armature (run step 3 first)")
if not os.path.isdir(A["dir"]):
    fail(f"clip folder not found: {A['dir']}")
scene = bpy.context.scene
FPS = 30
scene.render.fps = FPS

parent = BONE_MAP["bip01_parent"]
MAP = source_map(A["map"])
to_src = {bip: m for m, bip in MAP.items()}
order = []  # bones parents-first


def visit(b):
    if b in rig.data.bones and b not in order:
        order.append(b)
        for c, p in parent.items():
            if p == b:
                visit(c)


visit(A["root"])
rest = {b: rig.data.bones[b].matrix_local.copy() for b in order}
for pb in rig.pose.bones:
    pb.rotation_mode = "QUATERNION"

# the child joint that gives each bone its direction (for the rest alignment A)
PRIMARY = {"Bip01_Pelvis": "Bip01_Spine", "Bip01_Neck": "Bip01_Head", "Bip01_Spine2": "Bip01_Neck", "Bip01_L_Hand": "Bip01_L_Finger2", "Bip01_R_Hand": "Bip01_R_Finger2"}


def primary_child(b):
    if b in PRIMARY:
        return PRIMARY[b]
    kids = [c for c, p in parent.items() if p == b and c in rest and not c.endswith(("ShoulderHelper", "ForearmTwist"))]
    return kids[0] if len(kids) == 1 else None


def rq(m):
    """rotation of a matrix that may carry the FBX import's object scale (Mixamo: 0.01)"""
    return m.to_3x3().normalized().to_quaternion()


def flip(name):
    return name.replace("_L_", "_#_").replace("_R_", "_L_").replace("_#_", "_R_")


def yaw_between(a, b):
    """the turn about +Z taking the horizontal part of a onto that of b"""
    return math.atan2(b.y, b.x) - math.atan2(a.y, a.x)


def lateral(pos):
    """left thigh -> right thigh, horizontal (the hips' side axis)"""
    v = pos["Bip01_R_Thigh"] - pos["Bip01_L_Thigh"]
    v.z = 0
    return v.normalized()


T_ANKLE = (rest["Bip01_L_Foot"].translation.z + rest["Bip01_R_Foot"].translation.z) / 2
T_TOE = (rest["Bip01_L_Toe0"].translation.z + rest["Bip01_R_Toe0"].translation.z) / 2
T_LEG = rest[A["root"]].translation.z - T_ANKLE
T_LAT = lateral({b: rest[b].translation for b in ("Bip01_L_Thigh", "Bip01_R_Thigh")})

report = {}
for spec in read_json(A["clips"]):
    clip = spec["clip"]
    if A["only"] and clip not in A["only"]:
        continue
    path = os.path.join(A["dir"], spec["file"])
    if not os.path.exists(path):
        log(f"SKIP {clip}: {path} not downloaded yet")
        continue
    new = import_any(path)
    src = armature(new)
    if src is None or src.animation_data is None or src.animation_data.action is None:
        fail(f"{path}: no animated skeleton")
    for o in new:
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    sbones = {mixamo_name(pb.name): pb for pb in src.pose.bones}
    lacking = [b for b in ("Bip01", "Bip01_L_Thigh", "Bip01_R_Thigh", "Bip01_L_Foot", "Bip01_R_Foot") if to_src.get(b) not in sbones]
    if lacking:
        fail(f"{path}: the source skeleton has no {', '.join(to_src.get(b, b) for b in lacking)} (wrong --map {A['map']}?)")
    a0, a1 = (int(round(x)) for x in src.animation_data.action.frame_range)
    f0 = a0 + int(round(spec.get("start", 0) * FPS)) if "start" in spec else a0
    f1 = min(a1, a0 + int(round(spec["end"] * FPS))) if "end" in spec else a1
    mapped = [b for b in order if b in to_src and to_src[b] in sbones]

    # source rest (world), turned so that its hips face the way ours do (G)
    s_rest_raw = {b: src.matrix_world @ sbones[to_src[b]].bone.matrix_local for b in mapped}
    G = Matrix.Rotation(yaw_between(lateral({b: s_rest_raw[b].translation for b in ("Bip01_L_Thigh", "Bip01_R_Thigh")}), T_LAT), 4, "Z")
    s_rest = {b: G @ m for b, m in s_rest_raw.items()}
    # the rest alignment A per bone (falls back to the parent's: hands without finger data, head, toes)
    align = {}
    for b in order:
        c = primary_child(b)
        if b != A["root"] and b in s_rest and c in s_rest and c in rest:
            td = rest[c].translation - rest[b].translation
            sd = s_rest[c].translation - s_rest[b].translation
            align[b] = td.rotation_difference(sd) if td.length > 1e-4 and sd.length > 1e-4 else Quaternion()
        else:
            align[b] = align.get(parent.get(b), Quaternion()) if b != A["root"] else Quaternion()
    s_leg = s_rest[A["root"]].translation.z - (s_rest["Bip01_L_Foot"].translation.z + s_rest["Bip01_R_Foot"].translation.z) / 2
    ratio = T_LEG / max(1e-6, s_leg)

    # pass 1: sample the source (world, G applied), find the clip's lowest ankle and its start facing
    frames = []
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        frames.append({b: G @ src.matrix_world @ sbones[to_src[b]].matrix for b in mapped})
    s_ankle = min(min(fr["Bip01_L_Foot"].translation.z, fr["Bip01_R_Foot"].translation.z) for fr in frames)
    c0 = frames[0][A["root"]].translation.copy()
    Y = Matrix.Identity(4)
    face = spec.get("face")
    if face:
        # turn the take so it faces our -Y (a long take is recorded facing anywhere in the room):
        #   "hips"  the hips' side axis at the first frame, square to ours;
        #   "chest" the chest's forward (up x shoulder line) averaged over the clip;
        #   "punch" the punching arm (shoulder -> wrist of "hand") at its longest reach points straight ahead;
        # then "yaw" degrees more (positive turns left, seen from above)
        fwd_ref = Vector((0, -1, 0))
        if face == "hips":
            turn = yaw_between(lateral({b: frames[0][b].translation for b in ("Bip01_L_Thigh", "Bip01_R_Thigh")}), T_LAT)
        elif face == "chest":
            acc = Vector((0, 0, 0))
            for fr in frames:
                acc += Vector((0, 0, 1)).cross(fr["Bip01_R_UpperArm"].translation - fr["Bip01_L_UpperArm"].translation).normalized()
            turn = yaw_between(acc, fwd_ref)
        elif face == "punch" and spec.get("hand") in ("L", "R"):
            S = spec["hand"]
            reach = max(frames, key=lambda fr: (fr[f"Bip01_{S}_Hand"].translation - fr[f"Bip01_{S}_UpperArm"].translation).length)
            turn = yaw_between(reach[f"Bip01_{S}_Hand"].translation - reach[f"Bip01_{S}_UpperArm"].translation, fwd_ref)
        else:
            fail(f"{clip}: face is hips, chest or punch (punch needs hand L or R)")
        turn += math.radians(spec.get("yaw", 0))
        Y = Matrix.Translation((c0.x, c0.y, 0)) @ Matrix.Rotation(turn, 4, "Z") @ Matrix.Translation((-c0.x, -c0.y, 0))

    keys = {b: [] for b in order}  # per bone: (frame, quaternion, location)
    wrist = {"L": [], "R": []}
    root0 = root1 = None
    lifted = 0
    for i, fr in enumerate(frames):
        pose = {}
        for b in order:
            p = parent.get(b)
            local_rest = (rest[p].inverted() @ rest[b]) if p in rest else rest[b]
            follow = (pose[p] @ local_rest) if p in pose else rest[b]
            if b in fr:
                sw = Y @ fr[b]
                rot = (rq(sw) @ rq(s_rest[b]).inverted() @ align[b] @ rq(rest[b])).normalized()
                loc = follow.translation
                if b == A["root"]:
                    d = sw.translation - Vector((c0.x, c0.y, s_ankle))
                    loc = Vector((rest[b].translation.x, rest[b].translation.y, T_ANKLE)) + d * ratio
                want = Matrix.Translation(loc) @ rot.to_matrix().to_4x4()
            else:  # helpers, Bip01_Pelvis, fingers: follow the parent (helpers.ts poses the helpers at runtime)
                want = follow
            pose[b] = want
        # floor guard: no ankle / toe joint below its standing height
        sink = max(0.0, max(T_ANKLE - pose[f"Bip01_{S}_Foot"].translation.z for S in "LR"), max(T_TOE - pose[f"Bip01_{S}_Toe0"].translation.z for S in "LR"))
        if sink > 0.002:
            lifted += 1
            up = Matrix.Translation((0, 0, sink))
            pose = {b: up @ m for b, m in pose.items()}
        for b in order:
            p = parent.get(b)
            basis = (pose[p] @ (rest[p].inverted() @ rest[b])).inverted() @ pose[b] if p in pose else rest[b].inverted() @ pose[b]
            q = rq(basis)
            prev = keys[b][-1][1] if keys[b] else None
            if prev is not None and prev.dot(q) < 0:
                q.negate()
            keys[b].append((i + 1, q, basis.translation.copy()))
        for S in ("L", "R"):
            wrist[S].append(pose[f"Bip01_{S}_Hand"].translation.copy())
        if root0 is None:
            root0 = pose[A["root"]].copy()
        root1 = pose[A["root"]].copy()

    # root travel over the clip (Blender -Y forward = three.js +Z) and optional in-place
    d = root1.translation - root0.translation
    yaw = (rq(root1) @ rq(root0).inverted()).to_euler("XYZ").z
    travel = [round(d.x, 4), round(-d.y, 4), round(yaw, 4)]
    if spec.get("strip_root"):
        r = keys[A["root"]]
        x0, z0 = r[0][2].x, r[0][2].z
        keys[A["root"]] = [(f, q, loc.__class__((x0, loc.y, z0))) for f, q, loc in r]

    if spec.get("mirror"):
        flipped = {}
        for b, ks in keys.items():
            flipped[flip(b)] = [(f, q.__class__((q.w, q.x, -q.y, -q.z)), loc.__class__((-loc.x, loc.y, loc.z))) for f, q, loc in ks]
        keys = flipped
        travel = [-travel[0], travel[1], -travel[2]]

    act = bpy.data.actions.new(clip)
    act.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = act
    for b, ks in keys.items():
        pb = rig.pose.bones[b]
        for f, q, loc in ks:
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=f, group=b)
            if b == A["root"]:
                pb.location = loc
                pb.keyframe_insert("location", frame=f, group=b)
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)

    # first guess at the impact frame: the punching wrist's peak speed
    speed = {S: [(w[i + 1] - w[i]).length for i in range(len(w) - 1)] for S, w in wrist.items()}
    hand = spec.get("hand")
    imp = None
    if hand in ("L", "R") and speed[hand]:
        imp = max(range(len(speed[hand])), key=lambda i: speed[hand][i])
    n = f1 - f0 + 1
    report[clip] = {
        "source": spec["file"],
        "window_s": [round((f0 - a0) / FPS, 3), round((f1 - a0) / FPS, 3)],
        "frames": n,
        "seconds": round((n - 1) / FPS, 3),
        "loop": bool(spec.get("loop")),
        "travel_xz_yaw": travel,
        "impact_guess_s": round(imp / FPS, 3) if imp is not None else None,
        "mirrored": bool(spec.get("mirror")),
        "scale": round(ratio, 5),
        "floor_lifted_frames": lifted,
    }
    log(f"{clip}: {n} frames, travel {travel}, scale {ratio:.4f}, floor guard lifted {lifted} frames")
    src_action = src.animation_data.action
    bpy.data.objects.remove(src, do_unlink=True)
    if src_action.users == 0:
        bpy.data.actions.remove(src_action)

if not report:
    fail(f"no clip retargeted: none of the files in {A['clips']} is in {A['dir']}")
save(A["out"])
if A["report"]:
    write_json(A["report"], report)

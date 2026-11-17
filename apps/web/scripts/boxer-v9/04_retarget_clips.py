"""Step 4: retarget the Mixamo clips onto our Bip01 skeleton, one Blender action per fight clip.

UNTESTED: needs Blender (4.2+).

    blender -b work/out/m/03-rigged.blend -P apps/web/scripts/boxer-v9/04_retarget_clips.py -- \
        --clips apps/web/scripts/boxer-v9/mixamo-clips.json --dir work/in/mixamo/m \
        --out work/out/m/04-clips.blend --report work/out/m/clips-report.json [--only jab,cross]

--clips lists { "clip": our name (world/human/boxing/clips.ts), "file": the downloaded FBX, "mirror": bool,
"strip_root": bool, "loop": bool }. Download every clip "Without Skin, FBX Binary, 30 fps, no keyframe reduction"
while YOUR uploaded character is selected in Mixamo (then the clip is already on your proportions).

Method (no constraints, no bake operator): for every frame, each target bone gets the source bone's world rotation
relative to the source rest pose, applied to the target rest pose:

    R_target(f) = R_source(f) * R_source_rest^-1 * R_target_rest

and only the root (Bip01) also gets the source hip translation (scaled by the hip-height ratio, 1 when the clip was
downloaded for this very body). Children keep their own bone lengths, so a clip made on another Mixamo character
still lands without stretching. Mirroring is exact and cheap because every bone of our skeleton has the same rest
orientation: swap L and R, then (w, x, y, z) -> (w, x, -y, -z) and location x -> -x.

--report writes, per clip: frames, seconds, the root travel over the clip in three.js axes (x, z forward, yaw) for
clips.ts `travel`, and the frame of the largest wrist speed for punches (a first guess at `impact`, check by eye).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from common import BONE_MAP, Matrix, args, armature, fail, import_any, log, mixamo_name, read_json, save, write_json  # noqa: E402

A = args({"clips": None, "dir": None, "out": None, "report": "", "only": [], "root": "Bip01"})
rig = bpy.data.objects.get("boxer")
if rig is None:
    fail("no 'boxer' armature (run step 3 first)")
scene = bpy.context.scene
scene.render.fps = 30

parent = BONE_MAP["bip01_parent"]
to_src = {bip: m for m, bip in BONE_MAP["mixamo_to_bip01"].items()}
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


def rq(m):
    """rotation of a matrix that may carry the FBX import's object scale (Mixamo: 0.01)"""
    return m.to_3x3().normalized().to_quaternion()


def flip(name):
    return name.replace("_L_", "_#_").replace("_R_", "_L_").replace("_#_", "_R_")


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
    f0, f1 = (int(round(x)) for x in src.animation_data.action.frame_range)
    s_rest = {b: src.matrix_world @ sbones[to_src[b]].bone.matrix_local for b in order if b in to_src and to_src[b] in sbones}
    ratio = rest[A["root"]].translation.z / max(1e-6, s_rest[A["root"]].translation.z)

    keys = {b: [] for b in order}  # per bone: (frame, quaternion, location)
    wrist = {"L": [], "R": []}
    root0 = None
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        pose = {}
        for b in order:
            p = parent.get(b)
            # the target rest world rotation of this bone, and its world matrix if it only followed its parent
            local_rest = (rest[p].inverted() @ rest[b]) if p in rest else rest[b]
            follow = (pose[p] @ local_rest) if p in pose else rest[b]
            if b in s_rest:
                sw = src.matrix_world @ sbones[to_src[b]].matrix
                rot = (rq(sw) @ rq(s_rest[b]).inverted() @ rq(rest[b])).normalized()
                loc = follow.translation
                if b == A["root"]:
                    loc = rest[b].translation + (sw.translation - s_rest[b].translation) * ratio
                want = Matrix.Translation(loc) @ rot.to_matrix().to_4x4()
            else:  # helpers, Bip01_Pelvis: follow the parent (helpers.ts poses them at runtime)
                want = follow
            pose[b] = want
            basis = follow.inverted() @ want if p in pose else rest[b].inverted() @ want
            q = rq(basis)
            prev = keys[b][-1][1] if keys[b] else None
            if prev is not None and prev.dot(q) < 0:
                q.negate()
            keys[b].append((f - f0 + 1, q, basis.translation.copy()))
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
    report[clip] = {
        "source": spec["file"],
        "frames": f1 - f0 + 1,
        "seconds": round((f1 - f0) / 30.0, 3),
        "loop": bool(spec.get("loop")),
        "travel_xz_yaw": travel,
        "impact_guess_s": round(imp / 30.0, 3) if imp is not None else None,
        "mirrored": bool(spec.get("mirror")),
    }
    log(f"{clip}: {f1 - f0 + 1} frames, travel {travel}")
    src_action = src.animation_data.action
    bpy.data.objects.remove(src, do_unlink=True)
    if src_action.users == 0:
        bpy.data.actions.remove(src_action)

save(A["out"])
if A["report"]:
    write_json(A["report"], report)

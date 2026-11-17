"""Step 4a: find the time windows of the everyday clips inside the long CMU takes, and write the clip list that the
boxer retarget step (boxer-v9/04_retarget_clips.py, reused read-only) takes.

    blender -b -P apps/web/scripts/human-v9/04a_clip_windows.py -- --spec apps/web/scripts/human-v9/human-clips.json \
        --dir work/in/cmu --out work/out/clips/resolved-clips.json

Each entry of --spec has "clip", "file" and a "find" rule:
  - "gait": one whole gait cycle (left heel strike to the next) nearest the middle of the take, so the loop has no
    start-up or slow-down in it and its two ends match;
  - "loop": the window of "min".."max" seconds inside "from".."to" whose first and last poses match best (joint
    positions relative to the hips plus the hip height), so an idle / talk loop has no visible seam;
  - "sit_down" / "sit" / "stand_up": the take's hip-height profile is cut where the hips leave the standing height,
    where they settle on the seat, and where they come back up (the seated part is then a "loop");
  - "fixed": "start" / "end" in seconds as given.
The output entries are the spec entries with "start" / "end" filled in (seconds into the take), plus "found": what
was measured, for the report.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from hcommon import args, fail, import_any, log, read_json, write_json  # noqa: E402

A = args({"spec": None, "dir": None, "out": None})
FPS = 30
JOINTS = ["Hips", "LeftFoot", "RightFoot", "LeftHand", "RightHand", "Head", "LeftForeArm", "RightForeArm", "LeftLeg", "RightLeg", "Spine1"]


def sample(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    objs = import_any(path)
    arm = next(o for o in objs if o.type == "ARMATURE")
    a0, a1 = (int(round(x)) for x in arm.animation_data.action.frame_range)
    out = []
    for f in range(a0, a1 + 1):
        bpy.context.scene.frame_set(f)
        out.append({j: (arm.matrix_world @ arm.pose.bones[j].head).copy() for j in JOINTS if j in arm.pose.bones})
    # the take's leg length, to make the thresholds scale-free (BVH units vary)
    leg = (out[0]["Hips"] - out[0]["LeftFoot"]).length
    return out, leg, a0


def smooth(xs, k=3):
    return [sum(xs[max(0, i - k) : i + k + 1]) / len(xs[max(0, i - k) : i + k + 1]) for i in range(len(xs))]


def pose_dist(a, b, leg):
    d = 0.0
    for j in JOINTS:
        if j in a and j != "Hips":
            d += ((a[j] - a["Hips"]) - (b[j] - b["Hips"])).length
    d += 2 * abs(a["Hips"].z - b["Hips"].z)
    return d / leg


def seated_run(hz, low, leg):
    """the longest run of frames with the hips near their lowest (a take may sit down more than once)"""
    runs, cur = [], []
    for i, h in enumerate(hz):
        if h < low + 0.06 * leg:
            cur.append(i)
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    return max(runs, key=len)


def best_loop(fr, leg, i0, i1, nmin, nmax):
    best = None
    for s in range(i0, max(i0 + 1, i1 - nmin), 2):
        for n in range(nmin, nmax + 1, 2):
            e = s + n
            if e >= i1:
                break
            d = pose_dist(fr[s], fr[e], leg)
            if best is None or d < best[0]:
                best = (d, s, e)
    return best


out = []
cache = {}
for spec in read_json(A["spec"]):
    path = os.path.join(A["dir"], spec["file"])
    if not os.path.exists(path):
        log(f"SKIP {spec['clip']}: {path} missing")
        continue
    if path not in cache:
        cache[path] = sample(path)
    fr, leg, a0 = cache[path]
    n = len(fr)
    rule = spec.get("find", "fixed")
    e = dict(spec)
    found = {}
    if rule == "gait":
        lz = smooth([f["LeftFoot"].z for f in fr])
        mins = [i for i in range(3, n - 3) if lz[i] <= min(lz[i - 3 : i + 4]) and lz[i] < min(lz) + 0.08 * leg]
        mins = [m for k, m in enumerate(mins) if k == 0 or m - mins[k - 1] > 10]
        if len(mins) < 2:
            fail(f"{spec['clip']}: no two left-foot plants in {spec['file']}")
        mid = n / 2
        pairs = [(mins[k], mins[k + 1]) for k in range(len(mins) - 1)]
        s, t = min(pairs, key=lambda p: abs((p[0] + p[1]) / 2 - mid))
        found = {"cycle_s": round((t - s) / FPS, 3), "plants": len(mins)}
        e["start"], e["end"] = s / FPS, t / FPS
    elif rule in ("loop", "sit"):
        i0 = int(spec.get("from", 0) * FPS)
        i1 = min(n - 1, int(spec.get("to", n / FPS) * FPS))
        if rule == "sit":
            hz = smooth([f["Hips"].z for f in fr], 5)
            low = min(hz)
            seated = seated_run(hz, low, leg)
            i0, i1 = seated[0] + 8, seated[-1] - 8
        # a short take: the window may shrink to 85 % of what is there
        nmin = min(int(spec.get("min", 2) * FPS), int((i1 - i0) * 0.85))
        nmax = max(nmin + 2, min(int(spec.get("max", 6) * FPS), i1 - i0 - 1))
        b = best_loop(fr, leg, i0, i1, nmin, nmax)
        if b is None:
            fail(f"{spec['clip']}: no loop window in {spec['file']} ({i0}..{i1})")
        found = {"seam": round(b[0], 4)}
        e["start"], e["end"] = b[1] / FPS, b[2] / FPS
    elif rule in ("sit_down", "stand_up"):
        hz = smooth([f["Hips"].z for f in fr], 5)
        stand = max(hz[: max(5, n // 6)]) if rule == "sit_down" else max(hz[-max(5, n // 6) :])
        low = min(hz)
        drop = stand - low
        seated = seated_run(hz, low, leg)
        if rule == "sit_down":
            end = seated[0] + 6
            start = max(i for i in range(end) if hz[i] > stand - 0.05 * drop)
            start = max(0, start - 9)
        else:
            start = seated[-1] - 6
            end = min(i for i in range(start, n) if hz[i] > stand - 0.05 * drop)
            end = min(n - 1, end + 9)
        found = {"hip_drop_legs": round(drop / leg, 3)}
        e["start"], e["end"] = start / FPS, end / FPS
    else:
        if "start" not in spec or "end" not in spec:
            fail(f"{spec['clip']}: fixed windows need start and end")
    e["start"], e["end"] = round(e["start"], 3), round(e["end"], 3)
    e["found"] = found
    log(f"{spec['clip']}: {spec['file']} {e['start']}..{e['end']} s ({rule}) {found}")
    out.append(e)
if not out:
    fail("no clip resolved: download the CMU takes first (run.mjs prints the commands)")
write_json(A["out"], out)

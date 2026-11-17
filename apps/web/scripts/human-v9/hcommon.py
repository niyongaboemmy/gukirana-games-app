"""Shared helpers for the human v9 Blender scripts (P2-AVA-13, docs/design/human-v9/PIPELINE.md).

Reuses the boxer v9 helpers READ-ONLY: `apps/web/scripts/boxer-v9/common.py` (argument parsing, scene reset, the
importers, the Bip01 bone map, context overrides) is imported from its own folder and never edited. The two
pipelines are to be unified later; until then anything human-specific lives here.

Conventions (same as the boxer pipeline): metres, Blender +Z up, the person faces -Y (glTF / three.js +Z forward),
the person's left is +X. The armature object is called "boxer" because the reused boxer steps (04_retarget_clips.py,
07_bake.py) look it up by that name; the runtime finds bones by their Bip01 names only.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BOXER = os.path.normpath(os.path.join(HERE, "..", "boxer-v9"))
if BOXER not in sys.path:
    sys.path.insert(0, BOXER)

import bpy  # noqa: E402
import common as _boxer  # noqa: E402  (boxer-v9/common.py, read-only reuse)
from mathutils import Matrix, Vector  # noqa: E402

args = _boxer.args
read_json = _boxer.read_json
reset_scene = _boxer.reset_scene
import_any = _boxer.import_any
ctx = _boxer.ctx
select_only = _boxer.select_only
apply_transforms = _boxer.apply_transforms
tris = _boxer.tris
meshes = _boxer.meshes
armature = _boxer.armature
apply_modifier = _boxer.apply_modifier
BONE_MAP = _boxer.BONE_MAP
RIG = "boxer"


def log(*a):
    print("[human-v9]", *a, flush=True)


def fail(msg):
    print("[human-v9] ERROR:", msg, file=sys.stderr, flush=True)
    sys.exit(1)


def write_json(path, data):
    import json

    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf8") as f:
        json.dump(data, f, indent=2)
    log("wrote", path)


def save(path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(path))
    log("saved", path)


def world_verts(obj):
    mw = obj.matrix_world
    return [mw @ v.co for v in obj.data.vertices]


def bounds(pts):
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def band(pts, z0, z1):
    return [p for p in pts if z0 <= p.z < z1]


def centroid(pts):
    if not pts:
        return None
    s = Vector((0, 0, 0))
    for p in pts:
        s += p
    return s / len(pts)


def edit_mesh(obj, fn):
    """Run fn() in edit mode on obj (background-safe)."""
    select_only([obj])
    with ctx(obj):
        bpy.ops.object.mode_set(mode="EDIT")
        try:
            fn()
        finally:
            bpy.ops.object.mode_set(mode="OBJECT")

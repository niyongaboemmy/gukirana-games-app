"""Shared helpers for the boxer v9 Blender scripts (P3-FGT-21, docs/design/boxer-v9/BLENDER-PIPELINE.md).

UNTESTED: needs Blender. Written for Blender 4.2 LTS or newer (4.5 LTS / 5.x expected); nothing here was run yet.

Every step script is run headless by run.mjs:

    blender -b [input.blend] -P apps/web/scripts/boxer-v9/<step>.py -- --key value ...

Arguments after the lone `--` belong to the script (Blender ignores them). All lengths are metres, Blender's +Z is
up and the fighter faces -Y (Blender's "front"), which the glTF exporter turns into three.js +Y up, +Z forward.
"""
import json
import math
import os
import re
import sys

import bpy  # noqa: F401  (only available inside Blender)
from mathutils import Matrix, Vector

# ---------------------------------------------------------------------------------------------------------- args


def args(spec):
    """Parse `-- --key value` pairs. spec = {key: default}; a default of None makes the key required.
    Booleans are flags (`--mirror`), lists are comma separated."""
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    out = dict(spec)
    i = 0
    while i < len(argv):
        k = argv[i].lstrip("-").replace("-", "_")
        if k not in spec:
            fail(f"unknown argument --{k} (known: {', '.join(spec)})")
        d = spec[k]
        if isinstance(d, bool):
            out[k] = True
            i += 1
            continue
        v = argv[i + 1]
        if isinstance(d, float):
            v = float(v)
        elif isinstance(d, int):
            v = int(v)
        elif isinstance(d, list):
            v = [s for s in v.split(",") if s]
        out[k] = v
        i += 2
    missing = [k for k, v in out.items() if v is None]
    if missing:
        fail("missing argument(s): " + ", ".join("--" + m for m in missing))
    return out


def log(*a):
    print("[boxer-v9]", *a, flush=True)


def fail(msg):
    print("[boxer-v9] ERROR:", msg, file=sys.stderr, flush=True)
    sys.exit(1)


def write_json(path, data):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf8") as f:
        json.dump(data, f, indent=2)
    log("wrote", path)


def read_json(path):
    with open(path, encoding="utf8") as f:
        return json.load(f)


HERE = os.path.dirname(os.path.abspath(__file__))
BONE_MAP = read_json(os.path.join(HERE, "bone-map.json"))

# ---------------------------------------------------------------------------------------------------------- scene


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.unit_settings.system = "METRIC"
    s.unit_settings.scale_length = 1.0
    s.render.fps = 30
    s.render.fps_base = 1.0


def save(path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(path))
    log("saved", path)


def import_any(path):
    """Import FBX / glTF / GLB / OBJ; returns the new objects."""
    before = set(bpy.data.objects)
    ext = os.path.splitext(path)[1].lower()
    if ext == ".fbx":
        # Mixamo and Unreal FBX: keep the file's bone orientation, drop the _end leaf bones
        bpy.ops.import_scene.fbx(filepath=path, ignore_leaf_bones=True, automatic_bone_orientation=False)
    elif ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif ext == ".bvh":
        # CMU backups (BVH conversions keep Mixamo-like names: Hips, Spine, Spine1, LeftArm ...); 120 fps -> scene fps
        bpy.ops.import_anim.bvh(filepath=path, use_fps_scale=True, update_scene_fps=False, update_scene_duration=False)
    else:
        fail(f"unsupported file type {ext}: {path}")
    new = [o for o in bpy.data.objects if o not in before]
    log(f"imported {os.path.basename(path)}: {len(new)} objects")
    return new


def ctx(obj, selected=None):
    """A context override for operators that act on the active / selected objects (background mode has no UI)."""
    sel = selected if selected is not None else [obj]
    return bpy.context.temp_override(object=obj, active_object=obj, selected_objects=sel, selected_editable_objects=sel)


def select_only(objs, active=None):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)


def apply_transforms(objs):
    select_only(objs)
    with ctx(objs[0], objs):
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def tris(obj):
    """Triangle count of a mesh object (n-gons counted as fans)."""
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def meshes(objs=None):
    return [o for o in (objs if objs is not None else bpy.data.objects) if o.type == "MESH"]


def armature(objs=None):
    arms = [o for o in (objs if objs is not None else bpy.data.objects) if o.type == "ARMATURE"]
    return arms[0] if arms else None


def apply_modifier(obj, mod):
    with ctx(obj):
        bpy.ops.object.modifier_apply(modifier=mod.name)


# ---------------------------------------------------------------------------------------------------------- bones

_PREFIX = re.compile(r"^mixamorig\d*:")


def mixamo_name(name):
    """'mixamorig:LeftArm' / 'mixamorig1:LeftArm' -> 'LeftArm'."""
    return _PREFIX.sub("", name)


def bip_of(source_name):
    """Our Bip01 name for a Mixamo (or other mapped) bone, or None."""
    return BONE_MAP["mixamo_to_bip01"].get(mixamo_name(source_name))


def world_head(arm_obj, bone_name):
    b = arm_obj.data.bones[bone_name]
    return arm_obj.matrix_world @ b.head_local


def skin_matrix(arm_obj, mesh_obj, vertex):
    """Linear-blend skinning matrix of one vertex in the CURRENT pose (mesh space -> mesh space), from its vertex
    groups. Assumes mesh and armature have identity object transforms (01_import / 03_rig apply them)."""
    m = Matrix(((0, 0, 0, 0), (0, 0, 0, 0), (0, 0, 0, 0), (0, 0, 0, 0)))
    total = 0.0
    for g in vertex.groups:
        name = mesh_obj.vertex_groups[g.group].name
        pb = arm_obj.pose.bones.get(name)
        if pb is None or g.weight <= 0:
            continue
        m = m + (pb.matrix @ pb.bone.matrix_local.inverted()) * g.weight
        total += g.weight
    if total < 1e-6:
        return Matrix.Identity(4)
    return m * (1.0 / total)


def hip_height(arm_obj, root_name):
    return world_head(arm_obj, root_name).z


def deg(v):
    return [math.radians(x) for x in v]


__all__ = [
    "Matrix",
    "Vector",
    "args",
    "log",
    "fail",
    "write_json",
    "read_json",
    "reset_scene",
    "save",
    "import_any",
    "ctx",
    "select_only",
    "apply_transforms",
    "tris",
    "meshes",
    "armature",
    "apply_modifier",
    "mixamo_name",
    "bip_of",
    "world_head",
    "skin_matrix",
    "hip_height",
    "deg",
    "BONE_MAP",
    "HERE",
]

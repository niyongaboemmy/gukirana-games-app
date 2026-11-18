"""Shared helpers for the women's tops pipeline (P2-AVA-17). Run inside Blender 5.2 (headless).

Frames: everything is built in the feminine body's REST world frame as Blender imports feminine.glb (every pose bone
reset to identity): +Z up, the person faces -X, her left side is -Y. The runtime wants the body geometry's own bind
space (three.js): to_three() converts a rest-world point back into it.
"""
import json
import math
import os
import sys

import bmesh  # noqa: F401
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
GLB = os.path.join(REPO, "apps/web/public/assets/characters/feminine.glb")
WORK = os.path.join(HERE, "work")

# region ids per body face (from the recolour mask, see prep.py)
HEAD, TOP, SKIN, BOTTOM, SHOE, POCKET = 0, 1, 2, 3, 4, 6


def args(spec):
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    out = dict(spec)
    i = 0
    while i < len(argv):
        k = argv[i].lstrip("-").replace("-", "_")
        if k not in spec:
            fail(f"unknown argument --{k}")
        d = spec[k]
        if isinstance(d, bool):
            out[k] = True
            i += 1
            continue
        v = argv[i + 1]
        out[k] = float(v) if isinstance(d, float) else int(v) if isinstance(d, int) else [s for s in v.split(",") if s] if isinstance(d, list) else v
        i += 2
    return out


def log(*a):
    print("[women-tops]", *a, flush=True)


def fail(msg):
    print("[women-tops] ERROR:", msg, file=sys.stderr, flush=True)
    sys.exit(1)


def write_json(path, data):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf8") as f:
        json.dump(data, f, indent=1)


def read_json(path):
    with open(path, encoding="utf8") as f:
        return json.load(f)


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def apply_mod(ob, mod):
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def copy_object(src, name, keep_mods=False):
    ob = src.copy()
    ob.data = src.data.copy()
    ob.name = name
    ob.data.name = name
    link(ob)
    if not keep_mods:
        for m in list(ob.modifiers):
            ob.modifiers.remove(m)
    return ob


def bvh_of(ob, world=True):
    me = ob.data
    mw = ob.matrix_world if world else Matrix.Identity(4)
    return BVHTree.FromPolygons([mw @ v.co for v in me.vertices], [tuple(p.vertices) for p in me.polygons])


def components(bm):
    """connected vertex sets of a bmesh, largest first"""
    bm.verts.ensure_lookup_table()
    seen, out = set(), []
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
        out.append(comp)
    out.sort(key=len, reverse=True)
    return out


def taubin(np, co, src, dst, deg, passes, fixed=None, lam=0.5, mu=-0.53):
    for _ in range(passes):
        for step in (lam, mu):
            acc = np.zeros_like(co)
            np.add.at(acc, src, co[dst])
            d = acc / deg[:, None] - co
            if fixed is not None:
                d *= (1.0 - fixed)[:, None]
            co = co + step * d
    return co


def edge_pairs(np, bm, border_rule=True):
    """(src, dst, deg) arrays for Laplacian smoothing; border vertices only listen to their border neighbours"""
    n = len(bm.verts)
    border = [v.is_boundary for v in bm.verts]
    pairs = []
    for e in bm.edges:
        i, j = e.verts[0].index, e.verts[1].index
        if border_rule and border[i] and border[j] and not e.is_boundary:
            continue
        if border_rule and border[i] != border[j]:
            a, b = (j, i) if border[i] else (i, j)
            pairs.append((a, b))
            continue
        pairs.append((i, j))
        pairs.append((j, i))
    src = np.array([p[0] for p in pairs], dtype=np.int64)
    dst = np.array([p[1] for p in pairs], dtype=np.int64)
    deg = np.bincount(src, minlength=n).astype(np.float64)
    deg[deg == 0] = 1.0
    return src, dst, deg


def bone_heads(rig):
    return {b.name: rig.matrix_world @ b.head_local for b in rig.data.bones}


def deform_matrices(rig):
    """per bone: rest world -> posed world matrix of the current pose"""
    mw = rig.matrix_world
    mwi = mw.inverted()
    return {pb.name: mw @ pb.matrix @ pb.bone.matrix_local.inverted() @ mwi for pb in rig.pose.bones}


def skin_matrix(groups, D):
    """linear-blend skinning matrix (rest world -> posed world) of a vertex from [(bone, weight)]"""
    m = Matrix(((0, 0, 0, 0), (0, 0, 0, 0), (0, 0, 0, 0), (0, 0, 0, 0)))
    tot = 0.0
    for name, w in groups:
        if w <= 0 or name not in D:
            continue
        m = m + D[name] * w
        tot += w
    if tot < 1e-6:
        return Matrix.Identity(4)
    return m * (1.0 / tot)


def vertex_groups_of(ob):
    names = {g.index: g.name for g in ob.vertex_groups}
    return [[(names[g.group], g.weight) for g in v.groups if g.weight > 0] for v in ob.data.vertices]


def rotate_bone_world(rig, name, axis, angle, pivot=None):
    """turn a pose bone by `angle` round a world axis through its head (or `pivot`)"""
    pb = rig.pose.bones[name]
    mw = rig.matrix_world
    world = mw @ pb.matrix
    p = pivot if pivot is not None else world.to_translation()
    R = Matrix.Translation(p) @ Matrix.Rotation(angle, 4, axis) @ Matrix.Translation(-p)
    pb.matrix = mw.inverted() @ R @ world
    bpy.context.view_layer.update()


def to_three(body_matrix_world_inv, p):
    """rest world point -> the body geometry's bind space in three.js (glTF: Y up)"""
    q = body_matrix_world_inv @ p
    return (q.x, q.z, -q.y)

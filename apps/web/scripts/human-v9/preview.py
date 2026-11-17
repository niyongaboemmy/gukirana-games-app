"""QA helper: render a quick front / side / back sheet of the current .blend (or of an imported GLB) to a PNG.

    blender -b work/out/<id>/03-rigged.blend -P apps/web/scripts/human-v9/preview.py -- --out sheet.png [--action walk --frame 10]
    blender -b -P apps/web/scripts/human-v9/preview.py -- --glb person.glb --out sheet.png

Workbench with the texture colours and a studio light: it is for checking the clean-up (base, holes, facing, scale)
and the rig / clips (broken limbs, floating feet), not for judging the final look (that is the browser render).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from hcommon import RIG, Vector, args, import_any, log, meshes  # noqa: E402

A = args({"out": None, "glb": "", "action": "", "frame": 1, "size": 512, "views": "0,90,180", "engine": "workbench", "joints": False})
if A["glb"]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    import_any(os.path.abspath(A["glb"]))
scene = bpy.context.scene
rig = bpy.data.objects.get(RIG)
if rig is not None and A["action"]:
    act = bpy.data.actions.get(A["action"])
    if act:
        rig.animation_data_create()
        rig.animation_data.action = act
        # Blender 4.4+ slotted actions: bind the first slot
        if hasattr(rig.animation_data, "action_slot") and act.slots:
            rig.animation_data.action_slot = act.slots[0]
        scene.frame_set(int(A["frame"]))
vis = [o for o in meshes() if not o.hide_render and not o.name.endswith("_hi")]
for o in meshes():
    if o.name.endswith("_hi"):
        o.hide_render = True
pts = []
dg = bpy.context.evaluated_depsgraph_get()
for o in vis:
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    pts += [o.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
if not pts:
    raise SystemExit("nothing to render")
zmax = max(p.z for p in pts)
zmin = min(p.z for p in pts)
cx = sum(p.x for p in pts) / len(pts)
cy = sum(p.y for p in pts) / len(pts)
h = max(0.5, zmax - min(0.0, zmin))
scene.render.engine = "BLENDER_WORKBENCH" if A["engine"] == "workbench" else "BLENDER_EEVEE"
if A["engine"] == "workbench":
    sh = scene.display.shading
    sh.light = "STUDIO"
    sh.color_type = "TEXTURE"
    sh.show_shadows = False
    sh.show_cavity = False
scene.render.resolution_x = A["size"]
scene.render.resolution_y = int(A["size"] * 1.6)
scene.render.film_transparent = False
world = bpy.data.worlds.new("w") if scene.world is None else scene.world
scene.world = world
if A["joints"] and rig is not None:
    # the joints as red balls (rest pose), the body see-through
    jm = bpy.data.materials.new("joint")
    jm.diffuse_color = (1, 0.1, 0.05, 1)
    for b in rig.data.bones:
        bpy.ops.mesh.primitive_ico_sphere_add(radius=0.014, location=rig.matrix_world @ b.head_local)
        bpy.context.active_object.data.materials.append(jm)
    if A["engine"] == "workbench":
        scene.display.shading.show_xray = True
        scene.display.shading.xray_alpha = 0.55
        scene.display.shading.color_type = "MATERIAL"
# a floor line so floating / sinking feet show
bpy.ops.mesh.primitive_plane_add(size=6, location=(cx, cy, 0))
floor = bpy.context.active_object
fm = bpy.data.materials.new("floor")
fm.diffuse_color = (0.35, 0.33, 0.3, 1)
floor.data.materials.append(fm)
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = h * 1.12
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
frames = []
base = os.path.splitext(os.path.abspath(A["out"]))[0]
for i, az in enumerate(float(v) for v in A["views"].split(",")):
    a = math.radians(az)
    # az 0 = in front of the person (who faces -Y)
    d = Vector((math.sin(a), -math.cos(a), 0)) * 6
    cam.location = Vector((cx, cy, h * 0.5)) + d + Vector((0, 0, 0.15))
    cam.rotation_euler = (Vector((cx, cy, h * 0.5)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    p = f"{base}-{i}.png"
    scene.render.filepath = p
    bpy.ops.render.render(write_still=True)
    frames.append(p)
log("rendered", ", ".join(frames))

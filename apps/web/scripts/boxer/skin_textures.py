#!/usr/bin/env python3
"""Skin and detail textures for the realistic humans (P3-FGT-15, docs/HUMAN-REALISM.md).

  python3 apps/web/scripts/boxer/skin_textures.py <MH_DIR> <SKIN_DIR> <EYE_DIR>

Inputs (all CC0 1.0, see docs/ASSET-LICENSES.md):
  - MH_DIR/3dobjs/base.obj: the MakeHuman base mesh (its UV layout: where the body is in the texture);
  - SKIN_DIR/young_darkskinned_{male,female}_diffuse.png: MakeHuman 1.2 system skins (data/skins/textures of the
    MakeHuman Community 1.2.0 release, CC0), 2048 px, photo-sourced: pores, lighter palms and soles, a close-cropped
    natural hairline on the scalp;
  - EYE_DIR/brown_eye.png: MakeHuman system eye texture (CC0), 1024 px.
The groin is always under clothing; it is filled with the surrounding skin all the same (no anatomical detail in
the shipped texture, whatever is worn).

Outputs (apps/web/public/assets/characters/):
  - skin-{m,f}.webp (2048) and skin-{m,f}-1k.webp: RGB = the skin's variation RELATIVE to its mean colour (x 0.5:
    128 = the mean), so any skin tone of the avatar editor is applied in the shader (tone x 2 x texel) and keeps the
    photo's pores, freckles, redness of lips / cheeks / knuckles, darker creases; A = fine height (pores, wrinkles,
    0.5 = flat) for bump mapping;
  - human-detail.webp (512, tiling): RG = a pore / micro-wrinkle normal (skin up close), BA = a knit normal (jersey
    vest, polo, shirt), generated here (no third-party content);
  - eye-iris.webp (512): RGB = the eye texture with the iris turned to its luminance (the shader tints it with the
    player's eye colour), A = iris mask.
Deterministic (seeded numpy generator).
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

MH, SKIN, EYE = sys.argv[1], sys.argv[2], sys.argv[3]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../public/assets/characters")


def read_uv_body(path):
    vt, faces, g = [], [], None
    for line in open(path):
        if line.startswith("vt "):
            p = line.split()
            vt.append((float(p[1]), float(p[2])))
        elif line.startswith("g "):
            g = line[2:].strip()
        elif line.startswith("f ") and g == "body":
            faces.append([int(c.split("/")[1]) - 1 for c in line.split()[1:]])
    return vt, faces


def body_mask(size):
    vt, faces = read_uv_body(os.path.join(MH, "3dobjs/base.obj"))
    im = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(im)
    for f in faces:
        d.polygon([(vt[k][0] * size, (1 - vt[k][1]) * size) for k in f], fill=255)
    return np.asarray(im) > 0


def groin_mask(size):
    """the texels of the body faces round the groin (base mesh positions, dm: |x| < 1.1, 8.6 > y > 7.0 ... relative to
    the hip line found from the mesh), dilated a little"""
    v, vt, faces, g = [], [], [], None
    for line in open(os.path.join(MH, "3dobjs/base.obj")):
        if line.startswith("v "):
            p = line.split()
            v.append((float(p[1]), float(p[2]), float(p[3])))
        elif line.startswith("vt "):
            p = line.split()
            vt.append((float(p[1]), float(p[2])))
        elif line.startswith("g "):
            g = line[2:].strip()
        elif line.startswith("f ") and g == "body":
            faces.append([tuple(int(x) - 1 for x in c.split("/")[:2]) for c in line.split()[1:]])
    ys = sorted(p[1] for p in v)
    lo, hi = ys[0], ys[-1]
    # (the crotch sits at ~47-53 % of the body height on the base mesh)
    y0, y1 = lo + (hi - lo) * 0.44, lo + (hi - lo) * 0.545
    im = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(im)
    for f in faces:
        ps = [v[c[0]] for c in f]
        if all(abs(p[0]) < 1.25 and y0 < p[1] < y1 for p in ps):
            d.polygon([(vt[c[1]][0] * size, (1 - vt[c[1]][1]) * size) for c in f], fill=255)
    return np.asarray(im.filter(ImageFilter.MaxFilter(9))) > 0


def fill_from_surroundings(rgb, hole):
    """replace the hole with its surroundings (repeated blur pulls: a smooth skin patch, no edge)"""
    n = rgb.shape[0]
    small = np.ascontiguousarray(rgb[::4, ::4])
    filled = dilate(small, ~hole[::4, ::4], 200)
    up = np.asarray(Image.fromarray((np.clip(filled, 0, 1) * 255).astype(np.uint8)).resize((n, n), Image.BILINEAR)).astype(np.float32) / 255
    up = blur(up, 6)
    out = rgb.copy()
    out[hole] = up[hole]
    return out


def dilate(rgb, mask, iters):
    """grow the islands into the empty texels (no dark seams in the mip chain)"""
    out = rgb.copy()
    m = mask.copy()
    for _ in range(iters):
        acc = np.zeros_like(out)
        cnt = np.zeros(m.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sm = np.roll(m, (dy, dx), (0, 1))
            acc += np.roll(out, (dy, dx), (0, 1)) * sm[..., None]
            cnt += sm
        grow = (~m) & (cnt > 0)
        out[grow] = acc[grow] / cnt[grow][:, None]
        m = m | grow
        if m.all():
            break
    return out


def blur(a, r):
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(r))).astype(np.float32) / 255


def save_rgba(rgba, name, size, quality):
    """RGB and alpha resized apart (Pillow resizes RGBA premultiplied: colour under alpha 0 would be lost), and the
    colour kept exact under any alpha (the alpha channel is data here, not coverage)"""
    u8 = (np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8)
    rgb = Image.fromarray(np.ascontiguousarray(u8[..., :3]))
    a = Image.fromarray(np.ascontiguousarray(u8[..., 3]))
    if rgb.size[0] != size:
        rgb = rgb.resize((size, size), Image.LANCZOS)
        a = a.resize((size, size), Image.LANCZOS)
    img = rgb.copy()
    img.putalpha(a)
    img.save(os.path.join(OUT, name), "WEBP", quality=quality, method=6, exact=True)


def skin(gender):
    src = Image.open(os.path.join(SKIN, f"young_darkskinned_{'male' if gender == 'm' else 'female'}_diffuse.png")).convert("RGB")
    a = np.asarray(src).astype(np.float32) / 255
    n = a.shape[0]
    mask = body_mask(n)
    a = fill_from_surroundings(a, groin_mask(n) & mask)
    # the mean skin colour: the torso / thighs (the large islands), lips and nipples are outliers -> median
    mean = np.median(a[mask], axis=0)
    ratio = a / np.maximum(mean, 1e-3)
    # (an even, pale photo light: the ratio's low frequencies carry the light of the photo session too; flatten the
    # largest scale a little so arms / legs do not look lit from one side)
    low = blur(np.clip(ratio * 0.5, 0, 1), 64) * 2
    ratio = ratio / np.maximum(low, 1e-3) ** 0.5
    rgb = np.clip(ratio * 0.5, 0, 1)
    rgb = dilate(rgb, mask, 24)
    # fine height: high-pass of the luminance (dark = lower: pores, creases), 0.5 = flat
    lum = rgb @ np.array([0.3, 0.55, 0.15], np.float32)
    hp = lum - blur(np.repeat(lum[..., None], 3, 2), 2.5)[..., 0]
    h = np.clip(0.5 + hp * 3.0, 0, 1)
    rgba = np.dstack([rgb, h])
    save_rgba(rgba, f"skin-{gender}.webp", 2048, 82)
    save_rgba(rgba, f"skin-{gender}-1k.webp", 1024, 82)
    print(f"skin-{gender}: mean {np.round(mean * 255).astype(int).tolist()}")


def tile_noise(rng, n, cells):
    """tiling value noise (wraps at n)"""
    g = rng.random((cells, cells)).astype(np.float32)
    x = np.arange(n) * cells / n
    i0 = np.floor(x).astype(int)
    f = x - i0
    f = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % cells
    a = g[i0][:, i0] * (1 - f)[None, :] + g[i0][:, i1] * f[None, :]
    b = g[i1][:, i0] * (1 - f)[None, :] + g[i1][:, i1] * f[None, :]
    return a * (1 - f)[:, None] + b * f[:, None]


def normal_from_height(h, k):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * k
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * k
    nz = 1 / np.sqrt(1 + dx * dx + dy * dy)
    return -dx * nz, -dy * nz


def detail():
    rng = np.random.default_rng(15)
    n = 512
    # pores: a jittered grid of small pits (Worley distance), on a field of fine value noise; micro-wrinkles: two
    # crossing sets of faint grooves (the skin's diamond micro-relief)
    cells = 48
    cs = n / cells
    jit = rng.random((cells, cells, 2)).astype(np.float32)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    ci, cj = (yy // cs).astype(int), (xx // cs).astype(int)
    dmin = np.full((n, n), 1e9, np.float32)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            a, b = (ci + oy) % cells, (cj + ox) % cells
            py = (ci + oy + jit[a, b, 0]) * cs
            px = (cj + ox + jit[a, b, 1]) * cs
            np.minimum(dmin, (xx - px) ** 2 + (yy - py) ** 2, out=dmin)
    size = 1.4 + 1.2 * tile_noise(rng, n, 16)
    pore = np.exp(-dmin / (size ** 2))
    fine = tile_noise(rng, n, 128) * 0.5 + tile_noise(rng, n, 64) * 0.5
    wr = 0.5 + 0.25 * np.sin((xx + yy) * 2 * np.pi * 24 / n + tile_noise(rng, n, 8) * 6) + 0.25 * np.sin((xx - yy) * 2 * np.pi * 24 / n + tile_noise(rng, n, 8) * 6)
    h = fine * 0.35 + wr * 0.12 - pore * 0.9
    sx, sy = normal_from_height(h, 2.2)
    # knit: interlocking loops (a jersey's wales), slightly irregular
    u = xx * 2 * np.pi * 32 / n
    v = yy * 2 * np.pi * 48 / n
    kn = (np.abs(np.sin(u + 0.6 * np.sin(v))) ** 0.7) * (0.6 + 0.4 * np.abs(np.sin(v * 0.5))) + tile_noise(rng, n, 64) * 0.25
    kx, ky = normal_from_height(kn, 1.6)
    img = np.dstack([sx * 0.5 + 0.5, sy * 0.5 + 0.5, kx * 0.5 + 0.5, ky * 0.5 + 0.5])
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(OUT, "human-detail.webp"), "WEBP", quality=92, method=6, exact=True)
    print("human-detail: 512 px")


def iris():
    a = np.asarray(Image.open(os.path.join(EYE, "brown_eye.png")).convert("RGB")).astype(np.float32) / 255
    # the iris (and pupil): the saturated brown disc and the dark pupil inside it (the sclera is pale and grey)
    sat = a.max(2) - a.min(2)
    m = np.clip((sat - 0.12) / 0.1, 0, 1)
    m = np.maximum(m, np.clip((0.2 - a.mean(2)) / 0.1, 0, 1))
    mask = blur(np.repeat(m[..., None], 3, 2), 2)[..., 0]
    lum = a @ np.array([0.3, 0.55, 0.15], np.float32)
    rgb = a * (1 - mask[..., None]) + np.repeat(lum[..., None], 3, 2) * mask[..., None] * 1.6
    img = np.dstack([np.clip(rgb, 0, 1), mask])
    save_rgba(img, "eye-iris.webp", 512, 90)
    print(f"eye-iris: iris share {mask.mean():.3f}")


skin("m")
skin("f")
detail()
iris()

"""P2-AVA-17: before | after pairs from women-tops.mjs PNGs -> JPGs of at most 120 KB (docs/QA/women-tops/).

    python3 qa/e2e/human-assess/women-tops-combine.py <png dir> <out dir> [item ...]
"""
import io
import os
import sys

from PIL import Image, ImageDraw

src, out = sys.argv[1], sys.argv[2]
only = set(sys.argv[3:])
os.makedirs(out, exist_ok=True)
names = sorted(f for f in os.listdir(src) if f.endswith("_none.png"))
for f in names:
    base = f[: -len("_none.png")]
    item = base.split("_")[0]
    if only and item not in only:
        continue
    after = os.path.join(src, base + "_all.png")
    if not os.path.exists(after):
        continue
    a, b = Image.open(os.path.join(src, f)).convert("RGB"), Image.open(after).convert("RGB")
    w, h = a.size
    im = Image.new("RGB", (w * 2 + 4, h), (20, 20, 20))
    im.paste(a, (0, 0))
    im.paste(b, (w + 4, 0))
    d = ImageDraw.Draw(im)
    for x, label in ((8, "before (baked blazer)"), (w + 12, "after (simulated garment)")):
        d.rectangle((x - 4, 6, x + 7 * len(label), 22), fill=(0, 0, 0))
        d.text((x, 8), label, fill=(255, 255, 255))
    scale = min(1.0, 1100 / im.size[0])
    if scale < 1:
        im = im.resize((int(im.size[0] * scale), int(im.size[1] * scale)), Image.LANCZOS)
    q = 88
    while True:
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=q, optimize=True)
        if buf.tell() <= 120 * 1024 or q <= 40:
            break
        q -= 6
    with open(os.path.join(out, base + ".jpg"), "wb") as fh:
        fh.write(buf.getvalue())
    print(base, q, buf.tell() // 1024, "KB")

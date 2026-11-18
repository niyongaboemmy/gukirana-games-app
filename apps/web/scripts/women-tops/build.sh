#!/bin/sh
# P2-AVA-17: rebuild the women's tops from the feminine body (Blender 5.2, headless). See README.md.
#   sh apps/web/scripts/women-tops/build.sh [kind ...]    (default: every kind; --no-prep skips step 1)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
PUB="$HERE/../../public/assets/characters/women-tops"
BLENDER="${BLENDER:-blender}"
KINDS=""
PREP=1
for a in "$@"; do
  if [ "$a" = "--no-prep" ]; then PREP=0; else KINDS="$KINDS $a"; fi
done
[ -n "$KINDS" ] || KINDS="tee jersey hoodie track shirt sash"
mkdir -p "$HERE/work/out" "$PUB"
if [ "$PREP" = 1 ]; then
  "$BLENDER" -b -P "$HERE/prep.py" > "$HERE/work/prep.log" 2>&1 || { tail -20 "$HERE/work/prep.log"; exit 1; }
  grep "\[women-tops\]" "$HERE/work/prep.log" | tail -3
fi
for k in $KINDS; do
  "$BLENDER" -b "$HERE/work/prep.blend" -P "$HERE/garment.py" -- --kind "$k" > "$HERE/work/$k.log" 2>&1 || { tail -20 "$HERE/work/$k.log"; exit 1; }
  if [ "$k" = "sash" ]; then
    "$BLENDER" -b "$HERE/work/$k.blend" -P "$HERE/sash.py" >> "$HERE/work/$k.log" 2>&1 || { tail -20 "$HERE/work/$k.log"; exit 1; }
  fi
  "$BLENDER" -b "$HERE/work/$k.blend" -P "$HERE/bake.py" -- --kind "$k" >> "$HERE/work/$k.log" 2>&1 || { tail -20 "$HERE/work/$k.log"; exit 1; }
  grep "exported" "$HERE/work/$k.log" | tail -1
  cp "$HERE/work/out/wt-$k.bin" "$HERE/work/out/wt-$k.webp" "$PUB/"
done

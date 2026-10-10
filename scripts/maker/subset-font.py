"""Cuts the Chinese pixel font down to the characters the Maker game uses.

    python scripts/maker/subset-font.py <MagicGame-Maker dir>

Characters come from the Lua scripts, the dialogue script, story data and maps,
plus ASCII and common punctuation (so small text edits rarely need a re-run).
Run by export.mjs; needs `pip install fonttools brotli`.
"""
import glob, json, os, sys
from fontTools import subset
from fontTools.ttLib import TTFont

root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
maker = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "..", "MagicGame-Maker"))
src = os.path.join(root, "src", "assets", "fonts", "fusion-pixel-12px-zh_hans.woff2")
out = os.path.join(maker, "assets", "Fonts", "fusion-pixel-12px.ttf")

text = ""
for p in glob.glob(os.path.join(maker, "scripts", "**", "*.lua"), recursive=True):
    text += open(p, encoding="utf-8").read()
data = os.path.join(maker, "assets", "Data")
for p in glob.glob(os.path.join(data, "**", "*.json"), recursive=True):
    text += open(p, encoding="utf-8").read()
# Unicode escapes inside JSON (\\uXXXX) are decoded by reading the JSON properly.
for p in glob.glob(os.path.join(data, "**", "*.json"), recursive=True):
    try:
        text += json.dumps(json.load(open(p, encoding="utf-8")), ensure_ascii=False)
    except Exception:
        pass
extra = "".join(chr(c) for c in range(0x20, 0x7F)) + "，。！？、；：“”‘’（）《》【】…—～·★☆◆◇♥▼▶◀↑↓←→0123456789"
chars = sorted(set(text + extra))

font = TTFont(src)
font.flavor = None
opts = subset.Options()
opts.layout_features = ["*"]
opts.name_IDs = ["*"]
opts.notdef_outline = True
sub = subset.Subsetter(opts)
sub.populate(unicodes=[ord(c) for c in chars])
sub.subset(font)
os.makedirs(os.path.dirname(out), exist_ok=True)
font.save(out)
print("font: %d characters, %d KB" % (len(chars), os.path.getsize(out) // 1024))

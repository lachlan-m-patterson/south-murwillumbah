"""Download NSW Imagery for the extent at IMAGE_RES and cut it into texture tiles.

Requests 4x4 blocks (service limit 4096 px), stitches them, then writes
TILES_X x TILES_Y JPEG tiles (row 0 = north) to public/imagery/.
"""
import io, os, sys, time, urllib.parse, urllib.request
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from config import *

SERVICE = "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/export"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "imagery")
RAW = os.path.join(os.path.dirname(__file__), "raw")
os.makedirs(RAW, exist_ok=True)
W = round((EAST - WEST) / IMAGE_RES); H = round((NORTH - SOUTH) / IMAGE_RES)
BX, BY = 4, 4
bw, bh = W // BX, H // BY
full = Image.new("RGB", (W, H))
for j in range(BY):
    for i in range(BX):
        path = os.path.join(RAW, f"img_{j}_{i}.png")
        if not os.path.exists(path):
            x0 = WEST + i * bw * IMAGE_RES; x1 = x0 + bw * IMAGE_RES
            y1 = NORTH - j * bh * IMAGE_RES; y0 = y1 - bh * IMAGE_RES
            q = urllib.parse.urlencode(dict(bbox=f"{x0},{y0},{x1},{y1}", bboxSR=7856, imageSR=7856,
                                            size=f"{bw},{bh}", format="png24", f="image"))
            for attempt in range(5):
                try:
                    data = urllib.request.urlopen(f"{SERVICE}?{q}", timeout=180).read()
                    Image.open(io.BytesIO(data)).verify(); break
                except Exception as e:
                    print("retry", j, i, e); time.sleep(5 * (attempt + 1))
            open(path, "wb").write(data)
            print("block", j, i, len(data))
        full.paste(Image.open(path).convert("RGB"), (i * bw, j * bh))
tw, th = W // TILES_X, H // TILES_Y
for j in range(TILES_Y):
    for i in range(TILES_X):
        full.crop((i * tw, j * th, (i + 1) * tw, (j + 1) * th)).save(
            os.path.join(OUT, f"aerial_{j}_{i}.jpg"), quality=86, optimize=True, progressive=True)
full.resize((W // 8, H // 8), Image.LANCZOS).save(os.path.join(OUT, "aerial_preview.jpg"), quality=80)
print("done", W, H)

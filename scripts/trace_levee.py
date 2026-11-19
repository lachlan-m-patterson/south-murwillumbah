"""Trace the South Murwillumbah riverbank levee crest from the 1 m DEM.

A hand-placed guide line (pixel = metre offsets from the NW corner) is
resampled every 4 m. Each sample snaps to the highest DEM cell within
+/-14 m (north) or +/-8 m (south) across the guide, then the crest is smoothed (median of 9 drops building spikes). Output: raw/levee.json
with [easting, northing, crest elevation] vertices.
"""
import json, os, sys, numpy as np
from scipy.ndimage import uniform_filter1d, median_filter
sys.path.insert(0, os.path.dirname(__file__))
from config import *
dtm = np.load(os.path.join(os.path.dirname(__file__), "raw", "dtm.npy"))
GUIDE = [(552, 383), (520, 400), (480, 425), (440, 480), (405, 560), (378, 650), (358, 740),
         (346, 800), (350, 900), (360, 1000), (385, 1100), (405, 1200), (425, 1300), (448, 1390)]
def sample(px, py):
    i, j = int(round(py)), int(round(px))
    if 0 <= i < dtm.shape[0] and 0 <= j < dtm.shape[1]: return dtm[i, j]
    return -99
g = np.array(GUIDE, float)
seg = np.hypot(*np.diff(g, axis=0).T); s = np.concatenate([[0], np.cumsum(seg)])
ts = np.arange(0, s[-1], 4.0)
pts = np.stack([np.interp(ts, s, g[:, 0]), np.interp(ts, s, g[:, 1])], 1)
tang = np.gradient(pts, axis=0); tang /= np.linalg.norm(tang, axis=1)[:, None]
norm = np.stack([-tang[:, 1], tang[:, 0]], 1)
out = []
for p, n in zip(pts, norm):
    best = max(((sample(*(p + n * o)), o) for o in np.arange(-(14 if p[1] < 760 else 8), (14 if p[1] < 760 else 8) + 0.5, 0.5)), key=lambda t: t[0])
    out.append(p + n * best[1])
out = np.array(out)
out[:, 0] = uniform_filter1d(out[:, 0], 5, mode="nearest"); out[:, 1] = uniform_filter1d(out[:, 1], 5, mode="nearest")
z = np.array([max(sample(px + dx, py + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)) for px, py in out])
z = median_filter(z, 9, mode='nearest')
verts = [[round(WEST + px, 2), round(NORTH - py, 2), round(float(h), 2)] for (px, py), h in zip(out, z)]
json.dump({"crs": "EPSG:7856", "method": __doc__.strip(), "vertices": verts},
          open(os.path.join(os.path.dirname(__file__), "raw", "levee.json"), "w"))
print(len(verts), "crest min/median/max", z.min().round(2), np.median(z).round(2), z.max().round(2))

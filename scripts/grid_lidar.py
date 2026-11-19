"""Grid the LiDAR point cloud to 1 m cells over the extent.

Writes raw/lidar_grid.npz with:
  dsm     max elevation of non-noise returns (NaN where no returns)
  ground  mean class-2 elevation (NaN where none)
  bldg    count of class-6 (building) returns
  veg     count of class 3-5 (vegetation) returns
Needs laspy + lazrs.
"""
import os, sys, numpy as np, laspy
sys.path.insert(0, os.path.dirname(__file__))
from config import *
nx = round((EAST - WEST) / CELL); ny = round((NORTH - SOUTH) / CELL)
dsm = np.full(nx * ny, -np.inf, np.float32)
gsum = np.zeros(nx * ny, np.float64); gcnt = np.zeros(nx * ny, np.int32)
bldg = np.zeros(nx * ny, np.int32); veg = np.zeros(nx * ny, np.int32)
with laspy.open(LIDAR) as f:
    print(f.header.point_count)
    for k, pts in enumerate(f.chunk_iterator(4_000_000)):
        x = np.asarray(pts.x); y = np.asarray(pts.y); z = np.asarray(pts.z, np.float32)
        c = np.asarray(pts.classification)
        m = (x >= WEST) & (x < EAST) & (y > SOUTH) & (y <= NORTH) & (c != 7) & (c != 18)
        x, y, z, c = x[m], y[m], z[m], c[m]
        col = ((x - WEST) / CELL).astype(np.int64); row = ((NORTH - y) / CELL).astype(np.int64)
        col = np.clip(col, 0, nx - 1); row = np.clip(row, 0, ny - 1)
        idx = row * nx + col
        np.maximum.at(dsm, idx, z)
        g = c == 2
        np.add.at(gsum, idx[g], z[g]); np.add.at(gcnt, idx[g], 1)
        np.add.at(bldg, idx[c == 6], 1)
        v = (c >= 3) & (c <= 5); np.add.at(veg, idx[v], 1)
        print("chunk", k, m.sum(), flush=True)
dsm[~np.isfinite(dsm)] = np.nan
ground = np.where(gcnt > 0, gsum / np.maximum(gcnt, 1), np.nan).astype(np.float32)
np.savez_compressed(os.path.join(os.path.dirname(__file__), "raw", "lidar_grid.npz"),
                    dsm=dsm.reshape(ny, nx), ground=ground.reshape(ny, nx),
                    bldg=bldg.reshape(ny, nx), veg=veg.reshape(ny, nx))
print("done")

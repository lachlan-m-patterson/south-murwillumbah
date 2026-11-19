"""Crop the 1 m bare-earth + bathymetry DEM to the extent (cell centres). Needs rasterio."""
import os, sys, numpy as np, rasterio
from rasterio.windows import from_bounds
sys.path.insert(0, os.path.dirname(__file__))
from config import *
with rasterio.open(DEM) as src:
    win = from_bounds(WEST, SOUTH, EAST, NORTH, src.transform).round_offsets().round_lengths()
    a = src.read(1, window=win).astype(np.float32)
    nod = src.nodata
a[a == nod] = np.nan
print(a.shape, np.nanmin(a), np.nanmax(a), np.isnan(a).sum())
os.makedirs(os.path.join(os.path.dirname(__file__), "raw"), exist_ok=True)
np.save(os.path.join(os.path.dirname(__file__), "raw", "dtm.npy"), a)

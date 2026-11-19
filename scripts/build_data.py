"""Build runtime data for the South Murwillumbah viewer.

Inputs (scripts/raw/): dtm.npy (crop_dem.py), lidar_grid.npz (grid_lidar.py),
levee.json (trace_levee.py), osm.json, zoning.json, lots_school.json, addr.json,
and the lidarboxes building table.

Outputs (public/data/):
  surface.bin.gz  LiDAR surface model (roofs, canopy, bridge deck), uint16
  ground.bin.gz   bare-earth DEM with bathymetry, uint16
                  both: row-major, row 0 = north, value = (z + 20) * 100 (cm)
  features.json   zoning, roads, rail, levee, school, parks, buildings (MGA56)
"""
import csv, gzip, json, os, sys
import numpy as np
from scipy.ndimage import distance_transform_edt, gaussian_filter, grey_opening, maximum_filter, median_filter
from shapely.geometry import LinearRing, LineString, Point, Polygon, box, mapping, shape
from shapely.ops import unary_union, linemerge
from pyproj import Transformer

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)
from config import *

RAW = os.path.join(HERE, "raw")
OUT = os.path.join(HERE, "..", "public", "data")
os.makedirs(OUT, exist_ok=True)
BUILDINGS_CSV = r"C:/Users/lachlan/Desktop/low_poly_buildings/outputs/buildings.csv.gz"
EXTENT = box(WEST, SOUTH, EAST, NORTH)
to_mga = Transformer.from_crs(4326, 7856, always_xy=True)

# ---------------------------------------------------------------- terrain
dtm = np.load(os.path.join(RAW, "dtm.npy"))
L = np.load(os.path.join(RAW, "lidar_grid.npz"))
dsm = L["dsm"].copy()

has = ~np.isnan(dsm)
# fill small gaps (dark roofs, wet surfaces) from the nearest return up to 2.5 m away
dist, (ii, jj) = distance_transform_edt(~has, return_indices=True)
fill = dsm[ii, jj]
dsm = np.where(has, dsm, np.where(dist <= 2.5, fill, dtm))
dsm = np.clip(dsm, dtm, dtm + 40.0)
# isolated spikes (birds, wires): pull back to the 3x3 median
med = median_filter(dsm, 3)
spike = (dsm - med) > 3.0
dsm[spike] = med[spike]
print("surface spikes removed", int(spike.sum()))
# remove features under ~3 m wide (poles, wires, single branches); buildings survive
dsm = np.maximum(grey_opening(dsm, size=(3, 3)), dtm)
# soften tree canopy (vegetation cells away from building returns) so it drapes less harshly
bldg_zone = maximum_filter(L["bldg"] > 0, size=5)
veg_zone = (L["veg"] > 0) & ~bldg_zone
soft = gaussian_filter(dsm, 1.3)
dsm = np.where(veg_zone, np.maximum(soft, dtm), dsm)
# ease building walls by one cell so imagery stretches less on vertical faces
dsm = np.where(bldg_zone, np.maximum(gaussian_filter(dsm, 0.6), dtm), dsm)


def encode(a, name):
    q = np.clip(np.round((a + 20.0) * 100.0), 0, 65535).astype("<u2")
    with gzip.open(os.path.join(OUT, name), "wb", compresslevel=9) as f:
        f.write(q.tobytes())
    print(name, a.shape, os.path.getsize(os.path.join(OUT, name)))


encode(dsm.astype(np.float32), "surface.bin.gz")
encode(dtm.astype(np.float32), "ground.bin.gz")


def h_at(arr, e, n):
    c = int(np.clip(round(e - WEST - 0.5), 0, arr.shape[1] - 1))
    r = int(np.clip(round(NORTH - n - 0.5), 0, arr.shape[0] - 1))
    return float(arr[r, c])


# ---------------------------------------------------------------- helpers
def rnd(coords):
    return [[round(x, 2), round(y, 2)] for x, y in coords]


def geom_out(g):
    if g.is_empty:
        return None
    if g.geom_type == "Polygon":
        return {"type": "Polygon", "coordinates": [rnd(g.exterior.coords)] + [rnd(i.coords) for i in g.interiors]}
    if g.geom_type == "MultiPolygon":
        return {"type": "MultiPolygon", "coordinates": [[rnd(p.exterior.coords)] + [rnd(i.coords) for i in p.interiors] for p in g.geoms]}
    if g.geom_type == "LineString":
        return {"type": "LineString", "coordinates": rnd(g.coords)}
    if g.geom_type == "MultiLineString":
        return {"type": "MultiLineString", "coordinates": [rnd(l.coords) for l in g.geoms]}
    if g.geom_type == "Point":
        return {"type": "Point", "coordinates": [round(g.x, 2), round(g.y, 2)]}
    if g.geom_type == "GeometryCollection":
        polys = [p for p in g.geoms if p.geom_type in ("Polygon", "MultiPolygon")]
        return geom_out(unary_union(polys)) if polys else None
    raise ValueError(g.geom_type)


def feat(g, **props):
    out = geom_out(g)
    return {"type": "Feature", "properties": props, "geometry": out} if out else None


osm = json.load(open(os.path.join(RAW, "osm.json"), encoding="utf-8"))["elements"]


def osm_line(e):
    return LineString([to_mga.transform(p["lon"], p["lat"]) for p in e["geometry"]])


def osm_poly(e):
    pts = [to_mga.transform(p["lon"], p["lat"]) for p in e["geometry"]]
    return Polygon(pts).buffer(0) if len(pts) >= 4 else None


def merged(lines):
    u = unary_union(lines)
    m = linemerge(u) if u.geom_type == "MultiLineString" else u
    return m.intersection(EXTENT)


features = {}

# ---------------------------------------------------------------- zoning
ZONE_CLASS = {}
zones = []
for f in json.load(open(os.path.join(RAW, "zoning.json")))["features"]:
    a = f["attributes"]
    rings = f["geometry"]["rings"]
    # ArcGIS rings: clockwise = outer, counter-clockwise = hole
    outers, holes = [], []
    for r in rings:
        p = Polygon(r)
        (holes if LinearRing(r).is_ccw else outers).append(p)
    g = unary_union([o.buffer(0) for o in outers])
    if holes:
        g = g.difference(unary_union([h.buffer(0) for h in holes]))
    g = g.intersection(EXTENT).simplify(0.3)
    if g.is_empty or g.area < 20:
        continue
    ZONE_CLASS[a["SYM_CODE"]] = a["LAY_CLASS"]
    zones.append(feat(g, code=a["SYM_CODE"], name=a["LAY_CLASS"], area=round(g.area)))
features["zoning"] = {"type": "FeatureCollection", "source": "NSW Planning Portal, EPI Primary Planning Layers: Land Zoning (Tweed LEP 2014)",
                      "features": [z for z in zones if z]}
print("zones", len(features["zoning"]["features"]), sorted(ZONE_CLASS))


def zone_at(e, n):
    p = Point(e, n)
    for z in features["zoning"]["features"]:
        if shape(z["geometry"]).contains(p):
            return z["properties"]["code"]
    return None


# ---------------------------------------------------------------- roads
ROAD_KEEP = {"primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "secondary_link", "service"}
by_name = {}
for e in osm:
    t = e.get("tags", {})
    if e["type"] == "way" and t.get("highway") in ROAD_KEEP and "geometry" in e and t.get("name"):
        by_name.setdefault(t["name"], []).append(osm_line(e))
roads = []
for name, ls in by_name.items():
    g = merged(ls)
    if not g.is_empty and g.length > 30:
        roads.append(feat(g, name=name))
features["roads"] = {"type": "FeatureCollection", "source": "OpenStreetMap contributors (ODbL)", "features": [r for r in roads if r]}

# Prospero Street: OSM ways named Prospero plus the bridge-approach stretch
prospero = merged(by_name["Prospero Street"])
river_st = merged(by_name["River Street"])
tvw = merged(by_name["Tweed Valley Way"])
features["prospero"] = feat(prospero, name="Prospero Street")
features["riverStreet"] = feat(river_st, name="River Street")

# ---------------------------------------------------------------- bridge
bridge = None
for e in osm:
    if e.get("id") == 34848712:
        bridge = osm_line(e)
deck = [h_at(dsm, *bridge.interpolate(t, normalized=True).coords[0]) for t in np.linspace(0.15, 0.85, 15)]
features["bridge"] = feat(bridge, name="Alma Street Bridge", deckHeight=round(float(np.median(deck)), 2), length=round(bridge.length, 1))
print("bridge deck", features["bridge"]["properties"])

# ---------------------------------------------------------------- rail
rail = []
for e in osm:
    t = e.get("tags", {})
    if e["type"] == "way" and "geometry" in e and t.get("railway") in ("disused", "abandoned", "platform", "turntable"):
        g = (osm_poly(e) if t["railway"] in ("platform", "turntable") and e["geometry"][0] == e["geometry"][-1] else osm_line(e))
        if g is None:
            continue
        g = g.intersection(EXTENT)
        if not g.is_empty:
            kind = t["railway"]
            if t.get("highway") == "cycleway":
                kind = "railtrail"
            rail.append(feat(g, kind=kind, name=t.get("name", "")))
features["rail"] = {"type": "FeatureCollection", "source": "OpenStreetMap contributors (ODbL)", "features": [r for r in rail if r]}
platform = [shape(f["geometry"]) for f in features["rail"]["features"] if f["properties"]["kind"] == "platform"]
station_pt = unary_union(platform).centroid
features["station"] = feat(station_pt, name="Murwillumbah railway station (former)")

# ---------------------------------------------------------------- levee
lev = json.load(open(os.path.join(RAW, "levee.json")))["vertices"]
lev_line = LineString([(e, n) for e, n, _ in lev])
crest = np.array([z for _, _, z in lev])
features["levee"] = {"type": "Feature", "properties": {
    "name": "South Murwillumbah riverbank levee", "length": round(lev_line.length),
    "crestMin": round(float(crest.min()), 2), "crestMedian": round(float(np.median(crest)), 2), "crestMax": round(float(crest.max()), 2),
    "crest": [round(float(z), 2) for z in crest], "method": "Crest traced from the 1 m DEM (scripts/trace_levee.py)"},
    "geometry": {"type": "LineString", "coordinates": rnd(lev_line.coords)}}

# ---------------------------------------------------------------- school + playground
school = None
for f in json.load(open(os.path.join(RAW, "lots_school.json")))["features"]:
    if f["attributes"]["planlabel"] == "DP877617":
        school = Polygon(f["geometry"]["rings"][0])
features["school"] = feat(school, name="St Joseph's Primary School", address="3 Greville Street", lot="Lot 1 DP877617", area=round(school.area))
play = None
parks = []
for e in osm:
    t = e.get("tags", {})
    if e["type"] == "way" and t.get("leisure") == "park" and "geometry" in e:
        g = osm_poly(e)
        if g is None:
            continue
        g = g.intersection(EXTENT)
        if g.is_empty:
            continue
        if e["id"] == 783491484:
            play = g
        elif t.get("name"):
            parks.append(feat(g, name=t["name"]))
features["playground"] = feat(play, name="Playground and open space beside St Joseph's", area=round(play.area))
features["playEquipment"] = feat(Point(539255.0, 6865977.5), name="Play equipment")
features["parks"] = {"type": "FeatureCollection", "features": [p for p in parks if p]}

# ---------------------------------------------------------------- buildings (LiDAR boxes)
blds = []
with gzip.open(BUILDINGS_CSV, "rt") as f:
    for r in csv.DictReader(f):
        e, n = float(r["centre_easting"]), float(r["centre_northing"])
        if not (WEST + 2 < e < EAST - 2 and SOUTH + 2 < n < NORTH - 2):
            continue
        g = h_at(dtm, e, n)
        blds.append([round(e - WEST, 2), round(n - SOUTH, 2), round(float(r["length_m"]), 2), round(float(r["width_m"]), 2),
                     round(float(r["height_m"]), 2), round(float(r["rotation_deg"]), 1), round(g, 2), zone_at(e, n) or ""])
features["buildings"] = {"columns": ["x", "y", "length", "width", "height", "rotationDeg", "ground", "zone"],
                         "origin": [WEST, SOUTH], "rows": blds,
                         "source": "LiDAR-derived building boxes (lidarboxes); ground from 1 m DEM"}
print("buildings", len(blds))

# ---------------------------------------------------------------- address counts (context for info cards)
addr = json.load(open(os.path.join(RAW, "addr.json")))["features"]
counts = {}
for a in addr:
    s = a["attributes"]["address"]
    for key in ("RIVER STREET SOUTH", "PROSPERO STREET", "TWEED VALLEY WAY SOUTH", "GREVILLE STREET", "RAILWAY STREET"):
        if key in s:
            counts[key] = counts.get(key, 0) + 1
features["addressCounts"] = counts

meta = {
    "crs": "EPSG:7856 GDA2020 / MGA zone 56", "extent": [WEST, SOUTH, EAST, NORTH], "cell": CELL,
    "grid": [int(dtm.shape[1]), int(dtm.shape[0])], "heightEncoding": "uint16 (z + 20) * 100, row 0 north",
    "imageTiles": [TILES_X, TILES_Y], "imageRes": IMAGE_RES, "waterLevel": 0.35,
    "zoneClasses": ZONE_CLASS,
}
features["meta"] = meta
with open(os.path.join(OUT, "features.json"), "w") as f:
    json.dump(features, f, separators=(",", ":"))
print("features.json", os.path.getsize(os.path.join(OUT, "features.json")))

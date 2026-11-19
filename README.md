# South Murwillumbah 3D

An interactive Three.js map and flyover of South Murwillumbah, NSW. It covers the town's layout: zoning, the Alma Street bridge, Prospero Street, the old railway station and tracks, River Street, St Joseph's Primary School and playground, and the riverbank levee.

Live site: https://lachlan-m-patterson.github.io/south-murwillumbah/

## What's in the viewer

- **LiDAR 3D surface** (roofs, trees, bridge deck) or **bare earth + buildings** (matte limestone-coloured LiDAR building boxes), draped with 0.25 m aerial imagery.
- **Zoning overlay** (Tweed LEP 2014) with opacity control, a legend with areas, click-to-isolate, and a zone identify on click.
- **Key features** list. Each one flies the camera to the feature and opens a card with figures; the levee card includes a crest profile.
- **Guided flyover** begins at the Alma Street bridge. Readers can advance stop by stop, with instant camera changes when reduced motion is enabled. The map follows the [Tweed Valley atlas style guide](tweed-valley-style-guide.md).
- Hover readout with zone, ground height, MGA56 and lat/long; vertical exaggeration; compass; scale bar.

Controls: left-drag pans, right-drag (or two fingers) rotates, the wheel zooms. Press H for the overview, Esc to stop a tour, Space to pause.

## Run locally

Use Node.js 24 or later.

```sh
npm ci
npm run dev      # local preview
npm test         # geometry + data checks
npm run build    # static site in dist/
```

Pushes to `main` test, build and deploy through `.github/workflows/pages.yml` (Pages source: GitHub Actions).

## Data

Extent: 538700–540000 E, 6865000–6866700 N, GDA2020 / MGA zone 56 (EPSG:7856). The site is about 14 MB.

| Layer | Source | Notes |
| --- | --- | --- |
| Surface model | Supplied LiDAR (`lidar.laz`) | 1 m maximum of non-noise returns. Small gaps are filled; poles and wires are removed with a 3 m opening; canopy is lightly smoothed. |
| Bare earth | Supplied `dem_seamless.tif` (1 m, with bathymetry) | LiDAR ground returns agree with it to within about ±5 cm. |
| Imagery | NSW Spatial Services, NSW_Imagery map service | 0.25 m, as four 2600 × 3400 JPEG tiles. Capture date unverified. |
| Zoning | NSW Planning Portal, EPI Primary Planning Layers (Land Zoning) | Tweed LEP 2014, clipped to the extent. |
| Roads, rail, parks | OpenStreetMap contributors (ODbL) | OSM labels the north–south road "Tweed Valley Way"; Prospero Street is the strip from the bridge to the junction (matches NSW address points 1–56). |
| School lot | NSW Cadastre | Lot 1 DP877617, matched to the 3 Greville Street address point. |
| Playground | OSM park polygon beside the school | RE1 public recreation reserve with play equipment. |
| Buildings | LiDAR building boxes (`low_poly_buildings`) | Shown in bare-earth mode. |
| Levee | Traced from the 1 m DEM crest (`scripts/trace_levee.py`) | Indicative alignment, not a surveyed asset record. |

Heights are in metres, with the vertical datum assumed to be AHD.

## Rebuilding the data

Python 3.12 with numpy, scipy, shapely, pyproj, Pillow, rasterio and laspy (+lazrs). Paths to the source DEM and LiDAR are set in `scripts/config.py`. Large intermediates in `scripts/raw/` (`*.npy`, `*.npz`, imagery blocks) are git-ignored; the small JSON inputs are committed.

```sh
python scripts/fetch_imagery.py   # NSW imagery -> public/imagery/
python scripts/crop_dem.py        # 1 m DEM crop (rasterio)
python scripts/grid_lidar.py      # LiDAR -> 1 m grids (laspy)
python scripts/trace_levee.py     # levee crest line
python scripts/build_data.py      # public/data/{surface,ground}.bin.gz + features.json
```

The committed inputs `scripts/raw/osm.json`, `zoning.json`, `lots_school.json` and `addr.json` came from the Overpass API and the public NSW ArcGIS REST services (Planning EPI layer 2; NSW_Cadastre layer 9; NSW_Geocoded_Addressing_Theme layer 1), queried for the extent in EPSG:7856.

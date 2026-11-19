// Pure geometry helpers shared by the viewer and tests. Coordinates are
// GDA2020 / MGA zone 56 metres unless stated.

export const ZONE_STYLE = {
  R2: { color: '#f0a49b', label: 'Low Density Residential' },
  R3: { color: '#df7468', label: 'Medium Density Residential' },
  MU1: { color: '#c58ad8', label: 'Mixed Use' },
  E2: { color: '#4f86d6', label: 'Commercial Centre' },
  E3: { color: '#8dbfeb', label: 'Productivity Support' },
  E4: { color: '#a495de', label: 'General Industrial' },
  RE1: { color: '#6fbf73', label: 'Public Recreation' },
  RE2: { color: '#b6d996', label: 'Private Recreation' },
  RU1: { color: '#e8d98c', label: 'Primary Production' },
  RU2: { color: '#cdb672', label: 'Rural Landscape' },
  W1: { color: '#86d3e6', label: 'Natural Waterways' },
  W2: { color: '#5eb4d3', label: 'Recreational Waterways' }
};

/** Decode uint16 heights stored as (z + 20) * 100 into metres. */
export function decodeHeights(u16) {
  const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) out[i] = u16[i] / 100 - 20;
  return out;
}

/** Bilinear height lookup on a north-up grid of cell centres. */
export function sampleGrid(grid, meta, e, n) {
  const [west, , , north] = meta.extent;
  const [w, h] = meta.grid;
  const fx = Math.min(Math.max(e - west - 0.5, 0), w - 1.001);
  const fy = Math.min(Math.max(north - n - 0.5, 0), h - 1.001);
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const i = y0 * w + x0;
  const a = grid[i], b = grid[i + 1], c = grid[i + w], d = grid[i + w + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

export function lineLength(coords) {
  let s = 0;
  for (let i = 1; i < coords.length; i++) s += Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
  return s;
}

/** Split a GeoJSON line geometry into an array of coordinate arrays. */
export function lineParts(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  if (geometry.type === 'Polygon') return [geometry.coordinates[0]];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map(p => p[0]);
  return [];
}

/** Resample a polyline every `step` metres, keeping the end point. */
export function resample(coords, step) {
  const out = [coords[0].slice(0, 2)];
  let carry = 0;
  for (let i = 1; i < coords.length; i++) {
    const [x0, y0] = coords[i - 1], [x1, y1] = coords[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    let d = step - carry;
    while (d < len) {
      const t = d / len;
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      d += step;
    }
    carry = len - (d - step);
  }
  const last = coords[coords.length - 1];
  const prev = out[out.length - 1];
  if (Math.hypot(last[0] - prev[0], last[1] - prev[1]) > step * 0.25) out.push(last.slice(0, 2));
  return out;
}

function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonContains(geometry, x, y) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polys.some(rings => ringContains(rings[0], x, y) && !rings.slice(1).some(h => ringContains(h, x, y)));
}

export function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
}

export function polygonArea(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polys.reduce((s, rings) => s + ringArea(rings[0]) - rings.slice(1).reduce((h, r) => h + ringArea(r), 0), 0);
}

export function zoneAt(zoning, x, y) {
  return zoning.features.find(f => polygonContains(f.geometry, x, y)) || null;
}

/** Sum zone areas (m²) by code. */
export function zoneAreas(zoning) {
  const out = {};
  for (const f of zoning.features) out[f.properties.code] = (out[f.properties.code] || 0) + polygonArea(f.geometry);
  return out;
}

/** Transverse Mercator inverse for MGA zone 56 (GRS80) → [lon, lat] degrees. */
export function mgaToLonLat(e, n, zone = 56) {
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996;
  const b = a * (1 - f), e2 = 1 - (b * b) / (a * a), ep2 = e2 / (1 - e2);
  const x = e - 500000, y = n - 10000000;
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const C1 = ep2 * Math.cos(phi1) ** 2, T1 = Math.tan(phi1) ** 2;
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const R1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = x / (N1 * k0);
  const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(phi1);
  return [((zone - 1) * 6 - 180 + 3) + (lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

export const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Shortest signed angular difference b - a in degrees, in (-180, 180]. */
export function angleDelta(a, b) {
  let d = ((b - a) % 360 + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}

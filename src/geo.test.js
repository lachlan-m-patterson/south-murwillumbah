import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { angleDelta, decodeHeights, lineLength, mgaToLonLat, polygonArea, polygonContains, resample, sampleGrid, zoneAt } from './geo.js';

const features = JSON.parse(readFileSync(new URL('../public/data/features.json', import.meta.url)));
const meta = features.meta;

test('MGA inverse matches the pyproj reference point', () => {
  // pyproj: 539000 E, 6866000 N (EPSG:7856) -> 153.3978766, -28.3315950
  const [lon, lat] = mgaToLonLat(539000, 6866000);
  assert.ok(Math.abs(lon - 153.3978766) < 1e-6, lon);
  assert.ok(Math.abs(lat + 28.331595) < 1e-6, lat);
});

test('resample keeps ends and spacing', () => {
  const pts = resample([[0, 0], [10, 0], [10, 10]], 2);
  assert.deepEqual(pts[0], [0, 0]);
  assert.deepEqual(pts.at(-1), [10, 10]);
  assert.ok(Math.abs(lineLength(pts) - 20) < 1e-9);
  for (let i = 1; i < pts.length; i++) assert.ok(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) <= 2 + 1e-9);
});

test('polygon helpers handle holes', () => {
  const g = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
  assert.equal(polygonArea(g), 96);
  assert.equal(polygonContains(g, 1, 1), true);
  assert.equal(polygonContains(g, 5, 5), false);
});

test('angleDelta takes the short way round', () => {
  assert.equal(angleDelta(350, 10), 20);
  assert.equal(angleDelta(10, 350), -20);
});

test('key features sit in the expected zones', () => {
  const school = features.school.geometry.coordinates[0][0];
  assert.equal(zoneAt(features.zoning, 539216, 6866001)?.properties.code, 'R2', 'St Joseph’s lot');
  assert.equal(zoneAt(features.zoning, 539330, 6866225)?.properties.code, 'E3', 'Prospero Street strip');
  assert.equal(zoneAt(features.zoning, 539074, 6866481)?.properties.code, 'E2', 'town centre across the bridge');
  assert.ok(school.length === 2);
});

test('height grids decode to plausible terrain and line up with the levee', () => {
  const ground = decodeHeights(new Uint16Array(gunzipSync(readFileSync(new URL('../public/data/ground.bin.gz', import.meta.url))).buffer.slice(0)));
  assert.equal(ground.length, meta.grid[0] * meta.grid[1]);
  const crest = features.levee.properties.crest;
  const coords = features.levee.geometry.coordinates;
  let diffs = coords.map(([e, n], i) => Math.abs(sampleGrid(ground, meta, e, n) - crest[i]));
  diffs.sort((a, b) => a - b);
  assert.ok(diffs[Math.floor(diffs.length / 2)] < 0.6, `median crest mismatch ${diffs[Math.floor(diffs.length / 2)]}`);
  const surface = decodeHeights(new Uint16Array(gunzipSync(readFileSync(new URL('../public/data/surface.bin.gz', import.meta.url))).buffer.slice(0)));
  const deck = sampleGrid(surface, meta, 539187, 6866360);
  assert.ok(deck > 6 && deck < 11, `bridge deck ${deck}`);
});

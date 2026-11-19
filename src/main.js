import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  ZONE_STYLE, angleDelta, decodeHeights, easeInOut, lineLength, lineParts, mgaToLonLat, polygonArea,
  polygonContains, resample, sampleGrid, zoneAreas, zoneAt
} from './geo.js';
import { FEATURES, GUIDED, OVERVIEW, TOURS } from './content.js';
import './style.css';

// Colours are authored as display values; keep them unconverted end to end.
THREE.ColorManagement.enabled = false;

const BASE = import.meta.env.BASE_URL;
const $ = id => document.getElementById(id);
const fmt = (v, d = 0) => v.toLocaleString('en-AU', { maximumFractionDigits: d, minimumFractionDigits: d });

// ------------------------------------------------------------------ state
let meta, F, surface, ground, CX, CY, WEST, SOUTH, EAST, NORTH;
let heights;                       // grid currently rendered
let mode = 'lidar';
let exag = 1;
let zoneFocus = null;
let selected = null;               // feature id
const tiles = [];
const featureGroups = {};          // id -> { group, mats: [] }
const labels = { poi: [], street: [], place: [], zone: [] };
let flight = null;                 // camera animation
let tour = null;                   // active tour state
let water, skirts, buildings, bridgeDeck, zoneTexture, zoneCanvas, terrainMat;

// ------------------------------------------------------------------ renderer + scene
const viewport = $('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setClearColor(0x000000, 0);
viewport.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.inset = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
viewport.appendChild(labelRenderer.domElement);

document.body.style.background = 'linear-gradient(#a9c2d0 0%, #d7e2e2 45%, #e3e8dc 100%)';
const scene = new THREE.Scene();
const FOG = new THREE.Color('#dde5df');
const camera = new THREE.PerspectiveCamera(45, 1, 2, 20000);
const world = new THREE.Group();     // y scaled by vertical exaggeration
scene.add(world);
scene.add(new THREE.HemisphereLight(0xf4f7ff, 0x5d6650, 1.25));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-0.45, 0.8, 0.35);
scene.add(sun);

const controls = new MapControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.screenSpacePanning = false;
controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
controls.minDistance = 25;
controls.maxDistance = 3200;
controls.zoomToCursor = true;

function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ coordinate helpers
const wx = e => e - CX;
const wz = n => -(n - CY);
const toE = x => x + CX;
const toN = z => CY - z;
const gAt = (e, n) => sampleGrid(ground, meta, e, n);
const hAt = (e, n) => sampleGrid(heights, meta, e, n);

// ------------------------------------------------------------------ loading
const loadSteps = { done: 0, total: 7 };
function stepDone(text) {
  loadSteps.done++;
  $('load-fill').style.width = `${(100 * loadSteps.done) / loadSteps.total}%`;
  if (text) $('loading-text').textContent = text;
}

async function loadBinary(name) {
  const res = await fetch(`${BASE}data/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Some hosts already strip gzip; only decompress when the magic number is present.
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b
    ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : buf;
  stepDone();
  return decodeHeights(new Uint16Array(raw));
}

function loadTexture(url) {
  return new Promise((resolve, reject) => new THREE.TextureLoader().load(url, t => { stepDone(); resolve(t); }, undefined, reject));
}

// ------------------------------------------------------------------ terrain
const terrainVertex = /* glsl */`
  uniform vec4 zoneXf;      // x0, y0, width, height (local metres -> zone uv)
  uniform float exag;
  varying vec2 vUv; varying vec2 vZuv; varying vec3 vNormal; varying float vDist;
  void main() {
    vUv = uv;
    vZuv = vec2((position.x - zoneXf.x) / zoneXf.z, (-position.z - zoneXf.y) / zoneXf.w);
    vNormal = normalize(vec3(normal.x, normal.y / exag, normal.z));
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vDist = distance(cameraPosition, wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const terrainFragment = /* glsl */`
  uniform sampler2D map; uniform sampler2D zoneMap; uniform float zoneOpacity;
  uniform vec3 lightDir; uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;
  varying vec2 vUv; varying vec2 vZuv; varying vec3 vNormal; varying float vDist;
  void main() {
    vec3 base = texture2D(map, vUv).rgb;
    vec4 zc = texture2D(zoneMap, vZuv);
    base = mix(base, zc.rgb, zc.a * zoneOpacity);
    vec3 n = normalize(vNormal);
    float d = max(dot(n, normalize(lightDir)), 0.0);
    // steep faces (walls, canopy edges) carry stretched imagery: shade them down
    float steep = smoothstep(0.75, 0.2, n.y);
    vec3 col = base * (0.74 + 0.36 * d) * (1.0 - 0.32 * steep);
    col = mix(col, fogColor, smoothstep(fogNear, fogFar, vDist) * 0.85);
    gl_FragColor = vec4(col, 1.0);
  }`;

function buildTerrain(textures) {
  const [W, H] = meta.grid;
  const [TX, TY] = meta.imageTiles;
  const tw = W / TX, th = H / TY;
  zoneCanvas = document.createElement('canvas');
  zoneCanvas.width = 2600; zoneCanvas.height = 3400;
  zoneTexture = new THREE.CanvasTexture(zoneCanvas);
  zoneTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  terrainMat = [];
  for (let j = 0; j < TY; j++) {
    for (let i = 0; i < TX; i++) {
      const c0 = i * tw, r0 = j * th;
      const c1 = Math.min(c0 + tw, W - 1), r1 = Math.min(r0 + th, H - 1);
      const nx = c1 - c0 + 1, ny = r1 - r0 + 1;
      const pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2);
      const tileW = WEST + c0, tileS = NORTH - r0 - th;
      for (let r = 0; r < ny; r++) {
        for (let c = 0; c < nx; c++) {
          const k = r * nx + c, e = WEST + 0.5 + c0 + c, n = NORTH - 0.5 - (r0 + r);
          pos[k * 3] = wx(e); pos[k * 3 + 2] = wz(n);
          uv[k * 2] = (e - tileW) / tw; uv[k * 2 + 1] = (n - tileS) / th;
        }
      }
      const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
      let q = 0;
      for (let r = 0; r < ny - 1; r++) {
        for (let c = 0; c < nx - 1; c++) {
          const a = r * nx + c, b = a + 1, d = a + nx, e2 = d + 1;
          idx[q++] = a; idx[q++] = d; idx[q++] = b; idx[q++] = b; idx[q++] = d; idx[q++] = e2;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      const tex = textures[j * TX + i];
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      const mat = new THREE.ShaderMaterial({
        vertexShader: terrainVertex, fragmentShader: terrainFragment,
        uniforms: {
          map: { value: tex }, zoneMap: { value: zoneTexture }, zoneOpacity: { value: 0 },
          zoneXf: { value: new THREE.Vector4(WEST - CX, SOUTH - CY, EAST - WEST, NORTH - SOUTH) },
          exag: { value: 1 }, lightDir: { value: sun.position.clone() },
          fogColor: { value: FOG }, fogNear: { value: 2200 }, fogFar: { value: 6000 }
        }
      });
      terrainMat.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData = { c0, r0, nx, ny };
      mesh.frustumCulled = false;
      world.add(mesh);
      tiles.push(mesh);
    }
  }
  applyHeights();
}

function applyHeights() {
  const [W] = meta.grid;
  for (const mesh of tiles) {
    const { c0, r0, nx, ny } = mesh.userData;
    const pos = mesh.geometry.attributes.position.array;
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) pos[(r * nx + c) * 3 + 1] = heights[(r0 + r) * W + c0 + c];
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
  }
  buildSkirts();
}

// Earth-coloured sides so the model reads as a block
function buildSkirts() {
  if (skirts) { world.remove(skirts); skirts.geometry.dispose(); }
  const [W, H] = meta.grid;
  const edge = [];
  for (let c = 0; c < W; c++) edge.push([c, 0]);
  for (let r = 0; r < H; r++) edge.push([W - 1, r]);
  for (let c = W - 1; c >= 0; c--) edge.push([c, H - 1]);
  for (let r = H - 1; r >= 0; r--) edge.push([0, r]);
  const pos = [], col = [], idx = [];
  const bottom = -22;
  edge.forEach(([c, r], k) => {
    const x = wx(WEST + 0.5 + c), z = wz(NORTH - 0.5 - r), y = heights[r * W + c];
    pos.push(x, y, z, x, bottom, z);
    col.push(0.55, 0.48, 0.38, 0.29, 0.24, 0.19);
    if (k > 0) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  skirts = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  world.add(skirts);
}

// ------------------------------------------------------------------ zoning overlay (canvas texture)
function drawZones() {
  const ctx = zoneCanvas.getContext('2d');
  const sx = zoneCanvas.width / (EAST - WEST), sy = zoneCanvas.height / (NORTH - SOUTH);
  ctx.clearRect(0, 0, zoneCanvas.width, zoneCanvas.height);
  const path = geom => {
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    ctx.beginPath();
    for (const rings of polys) for (const ring of rings) {
      ring.forEach(([e, n], i) => ctx[i ? 'lineTo' : 'moveTo']((e - WEST) * sx, (NORTH - n) * sy));
      ctx.closePath();
    }
  };
  for (const f of F.zoning.features) {
    const code = f.properties.code;
    const style = ZONE_STYLE[code] || { color: '#999' };
    const dim = zoneFocus && zoneFocus !== code;
    path(f.geometry);
    ctx.globalAlpha = dim ? 0.12 : 1;
    ctx.fillStyle = style.color;
    ctx.fill('evenodd');
    ctx.globalAlpha = dim ? 0.2 : 1;
    ctx.lineWidth = zoneFocus === code ? 7 : 3.5;
    ctx.strokeStyle = zoneFocus === code ? '#ffffff' : 'rgba(30,40,35,0.9)';
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  zoneTexture.needsUpdate = true;
}

function setZoning(on) {
  $('lyr-zoning').checked = on;
  const op = on ? Number($('zoning-opacity').value) : 0;
  terrainMat.forEach(m => (m.uniforms.zoneOpacity.value = op));
  labels.zone.forEach(l => (l.visible = on));
}

// ------------------------------------------------------------------ water
function buildWater() {
  const g = new THREE.PlaneGeometry(EAST - WEST, NORTH - SOUTH, 1, 1);
  g.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 }, fogColor: { value: FOG } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `
      uniform float time; uniform vec3 fogColor; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+1.),f.x), f.y); }
      void main(){
        vec3 v = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(v.y, 0.0), 3.0);
        float r = n(vW.xz*0.18 + vec2(time*0.25, time*0.1)) * 0.6 + n(vW.xz*0.6 - vec2(time*0.4, 0.)) * 0.4;
        vec3 deep = vec3(0.17, 0.29, 0.30), sky = vec3(0.70, 0.79, 0.84);
        vec3 col = mix(deep, sky, 0.18 + fres * 0.6) + (r - 0.5) * 0.05;
        col = mix(col, fogColor, smoothstep(2200., 6000., distance(cameraPosition, vW)) * 0.85);
        gl_FragColor = vec4(col, 0.80 + fres * 0.15);
      }`
  });
  water = new THREE.Mesh(g, mat);
  water.position.set(wx((WEST + EAST) / 2), meta.waterLevel, wz((SOUTH + NORTH) / 2));
  water.renderOrder = 1;
  world.add(water);
}

// ------------------------------------------------------------------ highlighted features
const ribbonVertex = /* glsl */`
  attribute float along; attribute float side;
  varying float vAlong; varying float vSide;
  void main(){ vAlong = along; vSide = side; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ribbonFragment = /* glsl */`
  uniform vec3 color; uniform float opacity; uniform float time; uniform float dash; uniform float emph;
  varying float vAlong; varying float vSide;
  void main(){
    float edge = smoothstep(1.0, 0.55, abs(vSide));
    float core = smoothstep(0.55, 0.15, abs(vSide));
    float stripe = dash * step(0.55, fract((vAlong - time * 9.0) / 16.0));
    vec3 col = mix(color, vec3(1.0), 0.18 * core + 0.4 * stripe + 0.25 * emph * core);
    gl_FragColor = vec4(col, edge * opacity);
  }`;

function ribbonMaterial(color, { dash = 0, xray = false } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: ribbonVertex, fragmentShader: ribbonFragment, transparent: true, depthWrite: false,
    depthTest: !xray, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: xray ? 0.22 : 0.9 }, time: { value: 0 }, dash: { value: dash }, emph: { value: 0 } }
  });
}

/** Flat ribbon draped along a polyline. heightFn(e, n) gives the base elevation. */
function ribbonGeometry(coords, width, heightFn, lift, step = 2) {
  const pts = resample(coords, step);
  const pos = [], along = [], side = [], idx = [];
  let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    if (i > 0) dist += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const y = heightFn(p[0], p[1]) + lift;
    for (const s of [-1, 1]) {
      const e = p[0] + dy * s * width / 2, n = p[1] - dx * s * width / 2;
      pos.push(wx(e), y, wz(n)); along.push(dist); side.push(s);
    }
    if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
  g.setAttribute('side', new THREE.Float32BufferAttribute(side, 1));
  g.setIndex(idx);
  return g;
}

const curtainMat = color => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: 0.55 }, emph: { value: 0 }, time: { value: 0 } },
  vertexShader: `attribute float hgt; varying float vH; void main(){ vH = hgt; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform vec3 color; uniform float opacity; uniform float emph; varying float vH;
    void main(){ float a = (1.0 - vH) * (1.0 - vH); gl_FragColor = vec4(mix(color, vec3(1.), 0.15 + 0.2*emph), a * opacity); }`
});

/** Vertical translucent wall along a polyline, fading upward. */
function curtainGeometry(coords, height, heightFn, step = 2) {
  const pts = resample(coords, step);
  const pos = [], hgt = [], idx = [];
  pts.forEach(([e, n], i) => {
    const y = heightFn(e, n);
    pos.push(wx(e), y, wz(n), wx(e), y + height, wz(n));
    hgt.push(0, 1);
    if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('hgt', new THREE.Float32BufferAttribute(hgt, 1));
  g.setIndex(idx);
  return g;
}

function addRibbon(id, coords, color, width, heightFn, lift, opts = {}) {
  const fg = featureGroups[id];
  const geo = ribbonGeometry(coords, width, heightFn, lift);
  const main = new THREE.Mesh(geo, ribbonMaterial(color, opts));
  const xray = new THREE.Mesh(geo, ribbonMaterial(color, { ...opts, xray: true }));
  main.renderOrder = 4; xray.renderOrder = 3;
  fg.group.add(xray, main);
  fg.mats.push(main.material);
  fg.xray.push(xray.material);
}

function addCurtain(id, coords, color, height, heightFn) {
  const fg = featureGroups[id];
  const m = new THREE.Mesh(curtainGeometry(coords, height, heightFn), curtainMat(color));
  m.renderOrder = 5;
  fg.group.add(m);
  fg.mats.push(m.material);
}

function buildHighlights() {
  for (const f of FEATURES) {
    featureGroups[f.id] = { group: new THREE.Group(), mats: [], xray: [] };
    world.add(featureGroups[f.id].group);
  }
  const col = id => FEATURES.find(f => f.id === id).color;
  const deck = F.bridge.properties.deckHeight;

  // Bridge: ribbon over the LiDAR deck
  addRibbon('bridge', F.bridge.geometry.coordinates, col('bridge'), 12, () => deck, 0.9, { dash: 1 });

  // Prospero Street and River Street
  for (const part of lineParts(F.prospero.geometry)) addRibbon('prospero', part, col('prospero'), 13, gAt, 0.9, { dash: 1 });
  for (const part of lineParts(F.riverStreet.geometry)) addRibbon('river', part, col('river'), 9, gAt, 0.9, { dash: 1 });

  // Rail: tracks, rail trail, platform and turntable
  for (const r of F.rail.features) {
    const k = r.properties.kind;
    for (const part of lineParts(r.geometry)) {
      if (k === 'platform' || k === 'turntable') {
        addRibbon('station', part, '#f2d2a8', 2.2, gAt, 0.7);
        addCurtain('station', part, col('station'), 5, gAt);
      } else {
        addRibbon('station', part, k === 'railtrail' ? '#e0a160' : col('station'), k === 'railtrail' ? 5 : 3.2, gAt, 0.7, { dash: k === 'railtrail' ? 1 : 0 });
      }
    }
  }

  // School lot + playground reserve
  const ring = F.school.geometry.coordinates[0];
  addRibbon('school', ring, col('school'), 2.4, gAt, 0.8);
  addCurtain('school', ring, col('school'), 14, gAt);
  for (const part of lineParts(F.playground.geometry)) {
    addRibbon('school', part, '#9be27a', 2.2, gAt, 0.7);
    addCurtain('school', part, '#9be27a', 8, gAt);
  }

  // Levee: crest line plus a low wall
  const lev = F.levee.geometry.coordinates;
  addRibbon('levee', lev, col('levee'), 6, gAt, 0.6, { dash: 1 });
  addCurtain('levee', lev, col('levee'), 5, gAt);

  // Bridge deck box, shown only over the bare-earth surface
  const [a, b] = F.bridge.geometry.coordinates;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  bridgeDeck = new THREE.Mesh(new THREE.BoxGeometry(len, 1.4, 10), new THREE.MeshLambertMaterial({ color: 0xb9b6ad }));
  bridgeDeck.position.set(wx((a[0] + b[0]) / 2), deck - 0.7, wz((a[1] + b[1]) / 2));
  bridgeDeck.rotation.y = Math.atan2(b[1] - a[1], b[0] - a[0]);
  bridgeDeck.visible = false;
  world.add(bridgeDeck);
}

function updateEmphasis() {
  const show = $('lyr-highlights').checked;
  for (const [id, fg] of Object.entries(featureGroups)) {
    const on = selected === id;
    const dim = selected && !on && selected !== 'zoning';
    fg.group.visible = show || on;
    for (const m of fg.mats) {
      m.uniforms.emph.value = on ? 1 : 0;
      m.uniforms.opacity.value = m.uniforms.hgt ? 0.55 : dim ? 0.45 : on ? 1 : 0.88;
    }
    for (const m of fg.xray) m.uniforms.opacity.value = dim ? 0.08 : on ? 0.4 : 0.2;
  }
  labels.poi.forEach(l => l.element.classList.toggle('active', l.userData.id === selected));
  document.querySelectorAll('#feature-list button').forEach(b => b.classList.toggle('active', b.dataset.id === selected));
}

// ------------------------------------------------------------------ buildings (bare earth mode)
function buildBuildings() {
  const rows = F.buildings.rows;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  buildings = new THREE.InstancedMesh(geo, mat, rows.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const c = new THREE.Color(), white = new THREE.Color('#f4f1ea');
  const [ox, oy] = F.buildings.origin;
  rows.forEach(([x, y, len, wid, hgt, rot, gnd, zone], i) => {
    p.set(wx(ox + x), gnd - 0.3, wz(oy + y));
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(rot));
    s.set(len, hgt + 0.3, wid);
    m.compose(p, q, s);
    buildings.setMatrixAt(i, m);
    c.set(ZONE_STYLE[zone]?.color || '#dddddd').lerp(white, 0.35);
    buildings.setColorAt(i, c);
  });
  buildings.visible = false;
  world.add(buildings);
}

// ------------------------------------------------------------------ labels
function makeLabel(kind, html, e, n, y, data = {}) {
  const el = document.createElement('div');
  el.className = `lbl lbl-${kind}`;
  el.innerHTML = html;
  const obj = new CSS2DObject(el);
  obj.position.set(wx(e), y, wz(n));
  obj.userData = { ...data, e, n, baseY: y };
  world.add(obj);
  labels[kind].push(obj);
  return obj;
}

function midpoint(coords) {
  const pts = resample(coords, 1);
  return pts[Math.floor(pts.length / 2)];
}

function polyCentroid(ring) {
  let a = 0, x = 0, y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f; x += (ring[j][0] + ring[i][0]) * f; y += (ring[j][1] + ring[i][1]) * f;
  }
  return [x / (3 * a), y / (3 * a)];
}

function buildLabels() {
  const anchors = {
    bridge: [539187, 6866360, F.bridge.properties.deckHeight + 7],
    prospero: [...midpoint(lineParts(F.prospero.geometry)[0]), null],
    station: [...F.station.geometry.coordinates, null],
    river: [539112, 6865900, null],
    school: [...polyCentroid(F.school.geometry.coordinates[0]), null],
    levee: [539062, 6865760, null]
  };
  for (const f of FEATURES) {
    const a = anchors[f.id];
    if (!a) continue;
    const y = a[2] ?? gAt(a[0], a[1]) + 16;
    const l = makeLabel('poi', `<i style="background:${f.color}"></i>${f.title.replace(' and playground', '').replace('Railway station and tracks', 'Railway station')}`, a[0], a[1], y, { id: f.id });
    l.element.addEventListener('click', ev => { ev.stopPropagation(); stopTour(); selectFeature(f.id, true); });
  }
  // Place names
  makeLabel('place', 'Murwillumbah', 539000, 6866560, 30);
  makeLabel('place', 'Tweed River', 538985, 6865480, 8);
  makeLabel('place', 'South Murwillumbah', 539300, 6865560, 30);
  makeLabel('place', 'Cane fields', 539760, 6865520, 14);

  // Street and park names
  const skip = new Set(['Prospero Street', 'River Street']);
  for (const r of F.roads.features) {
    const name = r.properties.name;
    if (skip.has(name)) continue;
    const parts = lineParts(r.geometry).sort((a, b) => lineLength(b) - lineLength(a));
    if (!parts.length || lineLength(parts[0]) < 110) continue;
    const [e, n] = midpoint(parts[0]);
    makeLabel('street', name, e, n, gAt(e, n) + 5);
  }
  for (const p of F.parks.features) {
    const ring = lineParts(p.geometry)[0];
    const [e, n] = polyCentroid(ring);
    makeLabel('street', `${p.properties.name}`, e, n, gAt(e, n) + 4).element.style.fontStyle = 'normal';
  }
  const pe = F.playEquipment.geometry.coordinates;
  makeLabel('street', 'Playground', pe[0], pe[1], gAt(pe[0], pe[1]) + 6).element.style.color = '#e9ffd8';

  // Zone codes at polygon centroids (only when the zoning layer is on)
  for (const z of F.zoning.features) {
    if (z.properties.area < 6000) continue;
    const ring = lineParts(z.geometry).sort((a, b) => polygonArea({ type: 'Polygon', coordinates: [b] }) - polygonArea({ type: 'Polygon', coordinates: [a] }))[0];
    const [e, n] = polyCentroid(ring);
    if (!polygonContains(z.geometry, e, n) || e < WEST + 30 || e > EAST - 30 || n < SOUTH + 30 || n > NORTH - 30) continue;
    const l = makeLabel('zone', z.properties.code, e, n, gAt(e, n) + 3);
    l.visible = false;
  }
}

function updateLabelVisibility() {
  const camPos = camera.position;
  const v = new THREE.Vector3();
  for (const l of labels.street) {
    l.getWorldPosition(v);
    const d = v.distanceTo(camPos);
    l.element.style.opacity = d > 950 ? 0 : d > 650 ? (950 - d) / 300 : 1;
  }
  for (const l of labels.place) {
    l.getWorldPosition(v);
    l.element.style.opacity = v.distanceTo(camPos) < 160 ? 0 : 1;
  }
}

// ------------------------------------------------------------------ info card
function showCard({ kicker, title, text, stats = [], color, extra = '' }) {
  $('info-kicker').textContent = kicker;
  $('info-title').textContent = title;
  $('info-text').textContent = text;
  $('info-stats').innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('info-extra').innerHTML = extra;
  $('info-card').style.setProperty('--card-color', color || '#2f5a48');
  $('info-card').hidden = false;
}

function hideCard() {
  $('info-card').hidden = true;
  selected = null;
  updateEmphasis();
}

function leveeProfileSvg() {
  const crest = F.levee.properties.crest;
  const W = 320, H = 92, pad = 22;
  const lo = Math.floor(Math.min(...crest)), hi = Math.ceil(Math.max(...crest));
  const step = (F.levee.properties.length) / (crest.length - 1);
  const x = i => pad + (i / (crest.length - 1)) * (W - pad - 6);
  const y = v => 6 + (1 - (v - lo) / (hi - lo)) * (H - 24);
  const d = crest.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const ticks = [];
  for (let v = lo; v <= hi; v++) ticks.push(`<text x="${pad - 4}" y="${y(v) + 3}" text-anchor="end">${v}</text><line x1="${pad}" x2="${W - 6}" y1="${y(v)}" y2="${y(v)}" stroke="#d9e0d2"/>`);
  return `<p class="profile-label">Crest elevation (m) along the levee, from the bridge (left) heading south, ${fmt(step * (crest.length - 1))} m</p>
    <svg viewBox="0 0 ${W} ${H}" font-size="9" fill="#6e7d6c">${ticks.join('')}
      <path d="${d}L${x(crest.length - 1)},${H - 18}L${x(0)},${H - 18}Z" fill="#b98cf033"/>
      <path d="${d}" fill="none" stroke="#8c5fd0" stroke-width="1.6"/>
      <text x="${pad}" y="${H - 4}">Bridge</text><text x="${W - 6}" y="${H - 4}" text-anchor="end">South end of River St</text></svg>`;
}

function featureStats(id) {
  const ac = F.addressCounts;
  switch (id) {
    case 'zoning': {
      const areas = zoneAreas(F.zoning);
      const ha = c => `${fmt((areas[c] || 0) / 10000, 1)} ha`;
      return [['R2 residential', ha('R2')], ['E3 productivity', ha('E3')], ['RE1 recreation', ha('RE1')], ['RU1 rural', ha('RU1')]];
    }
    case 'bridge': return [['Length (mapped)', `${fmt(F.bridge.properties.length)} m`], ['Deck height', `${fmt(F.bridge.properties.deckHeight, 1)} m`], ['Links', 'E2 ↔ E3']];
    case 'prospero': return [['Length', `${fmt(lineParts(F.prospero.geometry).reduce((s, p) => s + lineLength(p), 0))} m`], ['Address points', ac['PROSPERO STREET'] ?? '–'], ['Zone', 'E3']];
    case 'station': {
      const trail = F.rail.features.filter(r => r.properties.kind === 'railtrail').reduce((s, r) => s + lineParts(r.geometry).reduce((t, p) => t + lineLength(p), 0), 0);
      return [['Line closed', '2004'], ['Rail trail in view', `${fmt(trail / 1000, 2)} km`], ['Zone', 'E3']];
    }
    case 'river': return [['Length', `${fmt(lineParts(F.riverStreet.geometry).reduce((s, p) => s + lineLength(p), 0) / 1000, 2)} km`], ['Address points', ac['RIVER STREET SOUTH'] ?? '–'], ['Zone', 'R2']];
    case 'school': return [['School lot', `${fmt(F.school.properties.area)} m²`], ['Playground reserve', `${fmt(F.playground.properties.area)} m²`], ['Title', F.school.properties.lot]];
    case 'levee': {
      const p = F.levee.properties;
      return [['Length', `${fmt(p.length / 1000, 2)} km`], ['Typical crest', `${fmt(p.crestMedian, 1)} m`], ['Crest range', `${fmt(p.crestMin, 1)}–${fmt(p.crestMax, 1)} m`]];
    }
    default: return [];
  }
}

function selectFeature(id, fly = true) {
  const f = FEATURES.find(x => x.id === id);
  selected = id;
  if (f.zoning) setZoning(true);
  updateEmphasis();
  showCard({ kicker: f.kicker, title: f.title, text: f.text, stats: featureStats(id), color: f.color, extra: id === 'levee' ? leveeProfileSvg() : '' });
  if (fly) flyTo(f.view);
}

function showZoneCard(zone, e, n) {
  const code = zone.properties.code;
  const style = ZONE_STYLE[code] || { color: '#999', label: zone.properties.name };
  const areas = zoneAreas(F.zoning);
  const nb = F.buildings.rows.filter(r => r[7] === code).length;
  selected = null;
  updateEmphasis();
  showCard({
    kicker: 'Land zoning · Tweed LEP 2014', title: `${code} ${zone.properties.name}`, color: style.color,
    text: 'Zone under the point you clicked. The figures below cover this zone across the whole map extent.',
    stats: [['This polygon', `${fmt(zone.properties.area / 10000, 2)} ha`], ['Zone total', `${fmt(areas[code] / 10000, 1)} ha`], ['LiDAR buildings', fmt(nb)]],
    extra: `<p class="profile-label">${fmt(e, 0)} E · ${fmt(n, 0)} N (MGA56) · ground ${fmt(gAt(e, n), 1)} m</p>`
  });
}

// ------------------------------------------------------------------ camera: fly-to
function currentView() {
  const t = controls.target, o = camera.position.clone().sub(t);
  const dist = o.length();
  return {
    target: [toE(t.x), toN(t.z)], ty: t.y, dist,
    az: (THREE.MathUtils.radToDeg(Math.atan2(o.x, -o.z)) + 360) % 360,
    tilt: THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(o.y / dist, -1, 1)))
  };
}

function placeCamera(e, n, ty, dist, az, tilt, target = controls.target) {
  const a = THREE.MathUtils.degToRad(az), t = THREE.MathUtils.degToRad(tilt);
  target.set(wx(e), ty, wz(n));
  camera.position.set(target.x + dist * Math.sin(t) * Math.sin(a), target.y + dist * Math.cos(t), target.z - dist * Math.sin(t) * Math.cos(a));
  camera.lookAt(target);
}

function flyTo(view, duration) {
  const from = currentView();
  const to = { ...view, ty: Math.max(hAt(...view.target), meta.waterLevel) * exag };
  const move = Math.hypot(to.target[0] - from.target[0], to.target[1] - from.target[1]) + Math.abs(to.dist - from.dist);
  flight = { from, to, t: 0, duration: duration ?? THREE.MathUtils.clamp(1.1 + move / 900, 1.4, 3.6), dAz: angleDelta(from.az, to.az) };
  controls.enabled = false;
  return new Promise(resolve => (flight.resolve = resolve));
}

function stepFlight(dt) {
  if (!flight) return;
  flight.t = Math.min(1, flight.t + dt / flight.duration);
  const k = easeInOut(flight.t), { from, to } = flight;
  const lerp = (a, b) => a + (b - a) * k;
  // pull back a little mid-flight for long moves
  const hop = Math.sin(Math.PI * k) * Math.min(400, Math.hypot(to.target[0] - from.target[0], to.target[1] - from.target[1]) * 0.35);
  placeCamera(lerp(from.target[0], to.target[0]), lerp(from.target[1], to.target[1]), lerp(from.ty, to.ty),
    lerp(from.dist, to.dist) + hop, from.az + flight.dAz * k, lerp(from.tilt, to.tilt));
  if (flight.t >= 1) {
    const done = flight.resolve;
    flight = null;
    if (!tour || tour.kind === 'guided') controls.enabled = true;
    controls.update();
    done?.();
  }
}

// ------------------------------------------------------------------ tours
function startTour(kind) {
  stopTour();
  hideCard();
  closePanelMobile();
  document.querySelectorAll('.tour-btn').forEach(b => b.classList.toggle('active', b.dataset.tour === kind));
  $('tour-bar').hidden = false;
  if (kind === 'guided') {
    tour = { kind, step: -1, playing: true, timer: 0, hold: 9 };
    $('tour-name').textContent = 'Guided tour';
    guidedGo(0);
  } else {
    const def = TOURS[kind];
    const curve = new THREE.CatmullRomCurve3(def.path.map(([e, n]) => new THREE.Vector3(wx(e), 0, wz(n))), false, 'centripetal');
    const length = curve.getLength();
    tour = { kind, def, curve, length, s: 0, playing: true, chapter: -1, look: new THREE.Vector3(), started: false };
    $('tour-name').textContent = def.title;
    controls.enabled = false;
    // fly to the start, then roll
    const p0 = pathPose(tour, 0);
    flight = null;
    const view = { target: [toE(p0.look.x), toN(p0.look.z)], dist: p0.pos.distanceTo(p0.look), az: 0, tilt: 0 };
    const o = p0.pos.clone().sub(p0.look);
    view.az = (THREE.MathUtils.radToDeg(Math.atan2(o.x, -o.z)) + 360) % 360;
    view.tilt = THREE.MathUtils.radToDeg(Math.acos(o.y / o.length()));
    tour.playing = false;
    const me = tour;
    flyTo(view, 2.2).then(() => {
      if (tour !== me) return;
      tour.look.copy(p0.look);
      tour.started = true; tour.playing = true;
      controls.enabled = false;
      updateTourButtons();
    });
  }
  updateTourButtons();
}

function stopTour() {
  if (!tour) return;
  tour = null;
  flight = null;
  $('tour-bar').hidden = true;
  document.querySelectorAll('.tour-btn').forEach(b => b.classList.remove('active'));
  controls.enabled = true;
  controls.update();
}

function updateTourButtons() {
  $('tour-pause').textContent = tour?.playing ? '❚❚' : '▶';
  $('tour-pause').setAttribute('aria-label', tour?.playing ? 'Pause' : 'Play');
}

function guidedGo(i) {
  const n = GUIDED.length;
  if (i < 0) i = 0;
  if (i >= n) { finishGuided(); return; }
  tour.step = i; tour.timer = 0;
  const f = FEATURES.find(x => x.id === GUIDED[i]);
  $('tour-chapter').textContent = `${i + 1} / ${n} · ${f.title}`;
  $('tour-text').textContent = '';
  setZoning(!!f.zoning);
  selectFeature(f.id, false);
  $('info-card').hidden = true;
  tour.arrived = false;
  const me = tour;
  flyTo(f.view).then(() => {
    if (tour !== me) return;
    me.arrived = true;
    $('info-card').hidden = false;
  });
}

function finishGuided() {
  stopTour();
  hideCard();
  flyTo(OVERVIEW);
}

/** Camera and look-at pose at arc length s along a path tour. */
function pathPose(t, s) {
  const { curve, length, def } = t;
  const at = d => {
    const u = THREE.MathUtils.clamp(d / length, 0, 1);
    const p = curve.getPointAt(u);
    const extra = d < 0 ? d : d > length ? d - length : 0;
    if (extra) p.add(curve.getTangentAt(u).multiplyScalar(extra));
    return p;
  };
  const p = at(s - def.back), look = at(s + def.lead);
  const tan = curve.getTangentAt(THREE.MathUtils.clamp(s / length, 0, 1));
  const right = new THREE.Vector3(-tan.z, 0, tan.x);  // to the right of travel in x/z
  p.addScaledVector(right, def.side);
  const pe = toE(p.x), pn = toN(p.z);
  p.y = (Math.max(hAt(pe, pn), 2) + def.altitude) * exag;
  look.y = Math.max(gAt(toE(look.x), toN(look.z)), meta.waterLevel) * exag + 4;
  return { pos: p, look };
}

function stepTour(dt) {
  if (!tour) return;
  if (tour.kind === 'guided') {
    if (tour.playing && tour.arrived) {
      tour.timer += dt;
      if (tour.timer >= tour.hold) guidedGo(tour.step + 1);
    }
    const frac = (tour.step + (tour.arrived ? Math.min(tour.timer / tour.hold, 1) : 0)) / GUIDED.length;
    $('tour-fill').style.width = `${frac * 100}%`;
    return;
  }
  if (!tour.started) return;
  if (tour.playing) {
    tour.s = Math.min(tour.length, tour.s + tour.def.speed * dt);
    const pose = pathPose(tour, tour.s);
    const k = 1 - Math.exp(-dt * 2.2);
    camera.position.lerp(pose.pos, k);
    tour.look.lerp(pose.look, k);
    camera.lookAt(tour.look);
    controls.target.copy(tour.look);
    if (tour.s >= tour.length && camera.position.distanceTo(pose.pos) < 3) {
      tour.playing = false;
      controls.enabled = true;
      $('tour-chapter').textContent = 'End of flyover';
      $('tour-text').textContent = 'Explore freely from here. Pick another flyover or a feature, or press ⌂ for the overview.';
      updateTourButtons();
    }
  }
  const u = tour.s / tour.length;
  $('tour-fill').style.width = `${u * 100}%`;
  const chapters = tour.def.chapters;
  let ci = 0;
  for (let i = 0; i < chapters.length; i++) if (u >= chapters[i].at) ci = i;
  if (ci !== tour.chapter && tour.s < tour.length) {
    tour.chapter = ci;
    const c = chapters[ci];
    $('tour-chapter').textContent = c.title;
    $('tour-text').textContent = c.text;
    selected = c.feature || (tour.kind === 'residential' ? 'river' : u > 0.3 && u < 0.62 ? 'prospero' : null);
    updateEmphasis();
  }
}

function tourSkip(dir) {
  if (!tour) return;
  if (tour.kind === 'guided') { guidedGo(tour.step + dir); return; }
  const ch = tour.def.chapters;
  const u = tour.s / tour.length;
  let i = ch.findIndex(c => c.at > u + 0.001);
  if (i === -1) i = ch.length;
  const target = dir > 0 ? i : Math.max(0, i - 2);
  if (target >= ch.length) { tour.s = tour.length; return; }
  tour.s = ch[target].at * tour.length;
  tour.chapter = -1;
  tour.playing = true;
  controls.enabled = false;
  updateTourButtons();
}

function tourPauseToggle() {
  if (!tour) return;
  if (tour.kind !== 'guided' && tour.s >= tour.length) { tour.s = 0; tour.chapter = -1; }
  tour.playing = !tour.playing;
  if (tour.kind !== 'guided') controls.enabled = !tour.playing;
  updateTourButtons();
}

// ------------------------------------------------------------------ picking (height-field ray march)
const raycaster = new THREE.Raycaster();
function pick(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const o = raycaster.ray.origin, d = raycaster.ray.direction;
  let prev = null;
  for (let t = 0; t < 7000; t += t < 400 ? 1 : 2.5) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    const e = toE(x), n = toN(z);
    if (e < WEST || e > EAST || n < SOUTH || n > NORTH) { prev = null; if (y < -30) break; continue; }
    const h = Math.max(hAt(e, n), meta.waterLevel) * exag;
    if (y <= h) {
      if (prev === null) return { e, n };
      let a = prev, b = t;
      for (let i = 0; i < 8; i++) {
        const m = (a + b) / 2, mx = o.x + d.x * m, my = o.y + d.y * m, mz = o.z + d.z * m;
        if (my <= Math.max(hAt(toE(mx), toN(mz)), meta.waterLevel) * exag) b = m; else a = m;
      }
      return { e: toE(o.x + d.x * b), n: toN(o.z + d.z * b) };
    }
    prev = t;
  }
  return null;
}

function nearLine(geometry, e, n, tol) {
  for (const part of lineParts(geometry)) {
    for (let i = 1; i < part.length; i++) {
      const [x0, y0] = part[i - 1], [x1, y1] = part[i];
      const dx = x1 - x0, dy = y1 - y0, L = dx * dx + dy * dy || 1;
      const t = THREE.MathUtils.clamp(((e - x0) * dx + (n - y0) * dy) / L, 0, 1);
      if (Math.hypot(e - (x0 + t * dx), n - (y0 + t * dy)) < tol) return true;
    }
  }
  return false;
}

function featureAt(e, n) {
  if (polygonContains(F.school.geometry, e, n) || polygonContains(F.playground.geometry, e, n)) return 'school';
  if (nearLine(F.bridge.geometry, e, n, 9)) return 'bridge';
  if (nearLine(F.prospero.geometry, e, n, 9)) return 'prospero';
  if (nearLine(F.levee.geometry, e, n, 6)) return 'levee';
  if (nearLine(F.riverStreet.geometry, e, n, 6)) return 'river';
  if (F.rail.features.some(r => nearLine(r.geometry, e, n, 5))) return 'station';
  return null;
}

let hoverPending = null;
function onHover(ev) {
  if (ev.buttons) { $('readout').hidden = true; return; }
  if (hoverPending) return;
  hoverPending = requestAnimationFrame(() => {
    hoverPending = null;
    const hit = pick(ev.clientX, ev.clientY);
    const box = $('readout');
    if (!hit) { box.hidden = true; return; }
    const z = zoneAt(F.zoning, hit.e, hit.n);
    const g = gAt(hit.e, hit.n), s = sampleGrid(surface, meta, hit.e, hit.n);
    const [lon, lat] = mgaToLonLat(hit.e, hit.n);
    const fid = $('lyr-highlights').checked ? featureAt(hit.e, hit.n) : null;
    const f = fid && FEATURES.find(x => x.id === fid);
    const zs = z && ZONE_STYLE[z.properties.code];
    box.innerHTML = `${f ? `<b>${f.title}</b><br>` : ''}${z ? `<i class="z" style="background:${zs?.color}"></i><b>${z.properties.code}</b> ${z.properties.name}<br>` : ''}`
      + `<span>Ground</span> ${g.toFixed(1)} m${s - g > 2 ? ` · <span>roof/canopy</span> +${(s - g).toFixed(0)} m` : ''}<br>`
      + `<span>${hit.e.toFixed(0)} E ${hit.n.toFixed(0)} N · ${lat.toFixed(5)}, ${lon.toFixed(5)}</span>`;
    const rect = viewport.getBoundingClientRect();
    box.style.left = `${ev.clientX - rect.left}px`;
    box.style.top = `${ev.clientY - rect.top}px`;
    box.hidden = false;
  });
}

let downAt = null;
renderer.domElement.addEventListener('pointerdown', ev => {
  downAt = [ev.clientX, ev.clientY];
  flight && !tour && (flight = null, controls.enabled = true);
  if (tour && tour.kind !== 'guided' && tour.playing && tour.started) { tour.playing = false; controls.enabled = true; updateTourButtons(); }
  if (tour && tour.kind === 'guided' && tour.playing) { tour.playing = false; updateTourButtons(); }
});
renderer.domElement.addEventListener('pointerup', ev => {
  if (!downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 5) return;
  const hit = pick(ev.clientX, ev.clientY);
  if (!hit) return;
  const fid = $('lyr-highlights').checked ? featureAt(hit.e, hit.n) : null;
  if (fid) { selectFeature(fid, false); return; }
  const z = zoneAt(F.zoning, hit.e, hit.n);
  if (z) showZoneCard(z, hit.e, hit.n);
});
renderer.domElement.addEventListener('pointermove', onHover);
renderer.domElement.addEventListener('pointerleave', () => ($('readout').hidden = true));

// ------------------------------------------------------------------ compass + scale
function updateHud() {
  const v = currentView();
  $('compass-needle').style.transform = `rotate(${-(v.az + 180)}deg)`;
  const h = renderer.domElement.clientHeight;
  const mpp = (2 * camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / h;
  const nice = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
  const len = nice.find(m => m / mpp >= 70) || 2000;
  $('scale-bar').style.width = `${Math.round(len / mpp)}px`;
  $('scale-label').textContent = len >= 1000 ? `${len / 1000} km` : `${len} m`;
}

// ------------------------------------------------------------------ UI wiring
function buildUi() {
  const list = $('feature-list');
  for (const f of FEATURES) {
    const li = document.createElement('li');
    li.innerHTML = `<button data-id="${f.id}"><i style="background:${f.color}"></i>${f.title}<small>${f.kicker}</small></button>`;
    li.firstChild.addEventListener('click', () => { stopTour(); closePanelMobile(); selectFeature(f.id); });
    list.appendChild(li);
  }
  const areas = zoneAreas(F.zoning);
  const legend = $('legend');
  Object.keys(areas).sort((a, b) => areas[b] - areas[a]).forEach(code => {
    const s = ZONE_STYLE[code] || { color: '#999', label: meta.zoneClasses[code] };
    const li = document.createElement('li');
    li.innerHTML = `<button data-code="${code}"><i style="background:${s.color}"></i><b>${code}</b><span>${meta.zoneClasses[code] || s.label}</span><small>${fmt(areas[code] / 10000, 1)} ha</small></button>`;
    li.firstChild.addEventListener('click', () => {
      zoneFocus = zoneFocus === code ? null : code;
      legend.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', b.dataset.code === zoneFocus);
        b.classList.toggle('dim', !!zoneFocus && b.dataset.code !== zoneFocus);
      });
      drawZones();
      setZoning(true);
    });
    legend.appendChild(li);
  });

  $('lyr-zoning').addEventListener('change', e => setZoning(e.target.checked));
  $('zoning-opacity').addEventListener('input', () => setZoning(true));
  $('lyr-highlights').addEventListener('change', updateEmphasis);
  $('lyr-labels').addEventListener('change', e => viewport.classList.toggle('labels-off', !e.target.checked));
  $('lyr-streets').addEventListener('change', e => viewport.classList.toggle('streets-off', !e.target.checked));
  $('surf-lidar').addEventListener('click', () => setMode('lidar'));
  $('surf-ground').addEventListener('click', () => setMode('ground'));
  $('exag').addEventListener('input', e => setExag(Number(e.target.value)));
  $('btn-home').addEventListener('click', () => { stopTour(); hideCard(); flyTo(OVERVIEW); });
  $('compass').addEventListener('click', () => { const v = currentView(); flyTo({ target: v.target, dist: v.dist, az: 180, tilt: v.tilt }, 1.2); });
  $('info-close').addEventListener('click', hideCard);
  $('tour-exit').addEventListener('click', () => { stopTour(); selected = null; updateEmphasis(); });
  $('tour-pause').addEventListener('click', tourPauseToggle);
  $('tour-next').addEventListener('click', () => tourSkip(1));
  $('tour-prev').addEventListener('click', () => tourSkip(-1));
  document.querySelectorAll('.tour-btn').forEach(b => b.addEventListener('click', () => startTour(b.dataset.tour)));
  $('btn-panel').addEventListener('click', () => {
    const open = $('panel').classList.toggle('open');
    $('btn-panel').setAttribute('aria-expanded', String(open));
  });
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') { stopTour(); hideCard(); }
    if (e.key === 'h' || e.key === 'H') { stopTour(); hideCard(); flyTo(OVERVIEW); }
    if (e.key === ' ' && tour) { e.preventDefault(); tourPauseToggle(); }
  });
}

function closePanelMobile() {
  $('panel').classList.remove('open');
  $('btn-panel').setAttribute('aria-expanded', 'false');
}

function setMode(m) {
  mode = m;
  heights = m === 'lidar' ? surface : ground;
  $('surf-lidar').setAttribute('aria-pressed', String(m === 'lidar'));
  $('surf-ground').setAttribute('aria-pressed', String(m === 'ground'));
  applyHeights();
  buildings.visible = m === 'ground';
  bridgeDeck.visible = m === 'ground';
}

function setExag(v) {
  const ratio = v / exag;
  exag = v;
  $('exag-out').textContent = `${v.toFixed(v % 1 ? 2 : 1).replace(/0$/, '')}×`;
  world.scale.y = v;
  terrainMat.forEach(m => (m.uniforms.exag.value = v));
  const offset = camera.position.y - controls.target.y;
  controls.target.y *= ratio;
  camera.position.y = controls.target.y + offset;
  controls.update();
}

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  stepFlight(dt);
  stepTour(dt);
  if (!flight && controls.enabled) {
    controls.update();
    // keep the focus inside the map
    const tx = THREE.MathUtils.clamp(controls.target.x, wx(WEST), wx(EAST)), tz = THREE.MathUtils.clamp(controls.target.z, wz(NORTH), wz(SOUTH));
    if (tx !== controls.target.x || tz !== controls.target.z) {
      const dx = tx - controls.target.x, dz = tz - controls.target.z;
      controls.target.x = tx; controls.target.z = tz; camera.position.x += dx; camera.position.z += dz;
    }
  }
  // stop the camera dipping under the terrain
  const ce = toE(camera.position.x), cn = toN(camera.position.z);
  if (ce > WEST && ce < EAST && cn > SOUTH && cn < NORTH) {
    const floor = (Math.max(hAt(ce, cn), meta.waterLevel) + 6) * exag;
    if (camera.position.y < floor) camera.position.y = floor;
  }
  if (water) water.material.uniforms.time.value = t;
  for (const fg of Object.values(featureGroups)) for (const m of fg.mats.concat(fg.xray)) m.uniforms.time.value = t;
  updateLabelVisibility();
  updateHud();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ boot
async function boot() {
  try {
    const fRes = await fetch(`${BASE}data/features.json`);
    F = await fRes.json();
    stepDone('Loading terrain…');
    meta = F.meta;
    [WEST, SOUTH, EAST, NORTH] = meta.extent;
    CX = (WEST + EAST) / 2; CY = (SOUTH + NORTH) / 2;
    const [TX, TY] = meta.imageTiles;
    const texUrls = [];
    for (let j = 0; j < TY; j++) for (let i = 0; i < TX; i++) texUrls.push(`${BASE}imagery/aerial_${j}_${i}.jpg`);
    const [s, g, ...textures] = await Promise.all([loadBinary('surface.bin.gz'), loadBinary('ground.bin.gz'), ...texUrls.map(loadTexture)]);
    surface = s; ground = g; heights = surface;
    $('loading-text').textContent = 'Building the 3D model…';
    await new Promise(r => setTimeout(r, 30));
    buildTerrain(textures);
    drawZones();
    setZoning(false);
    buildWater();
    buildHighlights();
    buildBuildings();
    buildLabels();
    buildUi();
    updateEmphasis();
    placeCamera(OVERVIEW.target[0], OVERVIEW.target[1], 0, 3200, 200, 62);
    controls.update();
    requestAnimationFrame(frame);
    $('loading').classList.add('done');
    setTimeout(() => ($('loading').hidden = true), 700);
    flyTo(OVERVIEW, 3.2);
    if (import.meta.env.DEV) window.__sm = { camera, controls, currentView, flyTo, selectFeature, startTour, setMode, setExag, get tour() { return tour; }, get flight() { return flight; } };
  } catch (err) {
    console.error(err);
    $('loading-text').textContent = `Could not load the map data (${err.message}). Please refresh.`;
  }
}
boot();

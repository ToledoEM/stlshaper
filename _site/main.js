// --- STLLoader and STLExporter (local fallbacks) ---

class LocalSTLLoader {
  load(url, onLoad, onProgress, onError) {
    const loader = new THREE.FileLoader();
    loader.setResponseType("arraybuffer");
    loader.load(
      url,
      (buffer) => onLoad(this.parse(buffer)),
      onProgress,
      onError,
    );
  }
  parse(data) {
    function isBinary(data) {
      // A binary STL is an 80-byte header, a uint32 face count, then 50 bytes
      // per face. Anything shorter than that header cannot be binary, and
      // reading the count would throw RangeError — which a small ASCII file
      // would otherwise hit before reaching the ASCII parser.
      if (data.byteLength < 84) return false;
      const reader = new DataView(data);
      const numFaces = reader.getUint32(80, true);
      const expectedSize = 84 + numFaces * 50;
      return data.byteLength === expectedSize;
    }
    return isBinary(data)
      ? this.parseBinary(data)
      : this.parseASCII(this.ensureString(data));
  }
  parseBinary(data) {
    const reader = new DataView(data);
    const faces = reader.getUint32(80, true);
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const normals = [];
    for (let face = 0; face < faces; face++) {
      const start = 84 + face * 50;
      const nx = reader.getFloat32(start, true);
      const ny = reader.getFloat32(start + 4, true);
      const nz = reader.getFloat32(start + 8, true);
      for (let i = 0; i < 3; i++) {
        const vStart = start + 12 + i * 12;
        vertices.push(
          reader.getFloat32(vStart, true),
          reader.getFloat32(vStart + 4, true),
          reader.getFloat32(vStart + 8, true),
        );
        // One normal per vertex. Pushing the triple twice here produced two
        // normals per vertex, leaving the attribute double-length and the
        // mesh mis-shaded.
        normals.push(nx, ny, nz);
      }
    }
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(normals, 3),
    );
    return geometry;
  }
  parseASCII(data) {
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const normals = [];
    const facetPattern =
      /facet\s+normal\s+([+\-\deE\.]+)\s+([+\-\deE\.]+)\s+([+\-\deE\.]+)\s+outer loop([\s\S]*?)endloop\s+endfacet/g;
    const vertexPattern =
      /vertex\s+([+\-\deE\.]+)\s+([+\-\deE\.]+)\s+([+\-\deE\.]+)/g;
    let facetMatch;
    while ((facetMatch = facetPattern.exec(data)) !== null) {
      const nx = parseFloat(facetMatch[1]);
      const ny = parseFloat(facetMatch[2]);
      const nz = parseFloat(facetMatch[3]);
      const loopBlock = facetMatch[4];
      let vMatch;
      let localVerts = [];
      while ((vMatch = vertexPattern.exec(loopBlock)) !== null) {
        localVerts.push(
          parseFloat(vMatch[1]),
          parseFloat(vMatch[2]),
          parseFloat(vMatch[3]),
        );
      }
      if (localVerts.length === 9) {
        vertices.push(...localVerts);
        normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
      }
    }
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(normals, 3),
    );
    return geometry;
  }
  ensureString(buffer) {
    if (typeof buffer === "string") return buffer;
    return new TextDecoder().decode(buffer);
  }
}

class LocalSTLExporter {
  parse(scene, options = {}) {
    const binary = options.binary !== undefined ? options.binary : false;
    const objects = [];
    scene.traverse((obj) => {
      if (obj.isMesh) objects.push(obj);
    });
    if (binary) {
      return this.parseBinary(objects);
    } else {
      return this.parseASCII(objects);
    }
  }
  parseASCII(objects) {
    let output = "solid exported\n";
    const v0 = new THREE.Vector3(),
      v1 = new THREE.Vector3(),
      v2 = new THREE.Vector3();
    const e1 = new THREE.Vector3(),
      e2 = new THREE.Vector3(),
      n = new THREE.Vector3();
    objects.forEach((obj) => {
      const geometry = obj.geometry;
      const matrixWorld = obj.matrixWorld;
      if (!geometry.isBufferGeometry) return;
      const pos = geometry.getAttribute("position");
      for (let i = 0; i < pos.count; i += 3) {
        v0.fromBufferAttribute(pos, i).applyMatrix4(matrixWorld);
        v1.fromBufferAttribute(pos, i + 1).applyMatrix4(matrixWorld);
        v2.fromBufferAttribute(pos, i + 2).applyMatrix4(matrixWorld);
        e1.subVectors(v1, v0);
        e2.subVectors(v2, v0);
        n.crossVectors(e1, e2).normalize();
        output += `  facet normal ${n.x} ${n.y} ${n.z}\n`;
        output += "    outer loop\n";
        output += `      vertex ${v0.x} ${v0.y} ${v0.z}\n`;
        output += `      vertex ${v1.x} ${v1.y} ${v1.z}\n`;
        output += `      vertex ${v2.x} ${v2.y} ${v2.z}\n`;
        output += "    endloop\n";
        output += "  endfacet\n";
      }
    });
    output += "endsolid exported\n";
    return output;
  }
  parseBinary(objects) {
    let triangles = 0;
    objects.forEach((obj) => {
      const geometry = obj.geometry;
      if (geometry.isBufferGeometry) {
        triangles += geometry.getAttribute("position").count / 3;
      }
    });
    const offset = 80;
    const bufferLength = triangles * 50 + offset + 4;
    const arrayBuffer = new ArrayBuffer(bufferLength);
    const output = new DataView(arrayBuffer);
    output.setUint32(offset, triangles, true);
    let index = offset + 4;
    objects.forEach((obj) => {
      const geometry = obj.geometry;
      const matrixWorld = obj.matrixWorld;
      if (geometry.isBufferGeometry) {
        const positions = geometry.getAttribute("position");
        const normals = geometry.getAttribute("normal");
        for (let i = 0; i < positions.count; i += 3) {
          const n = new THREE.Vector3();
          if (normals) {
            n.fromBufferAttribute(normals, i);
          } else {
            n.set(0, 0, 1);
          }
          n.applyMatrix3(
            new THREE.Matrix3().getNormalMatrix(matrixWorld),
          ).normalize();
          output.setFloat32(index, n.x, true);
          index += 4;
          output.setFloat32(index, n.y, true);
          index += 4;
          output.setFloat32(index, n.z, true);
          index += 4;
          for (let j = 0; j < 3; j++) {
            const v = new THREE.Vector3();
            v.fromBufferAttribute(positions, i + j);
            v.applyMatrix4(matrixWorld);
            output.setFloat32(index, v.x, true);
            index += 4;
            output.setFloat32(index, v.y, true);
            index += 4;
            output.setFloat32(index, v.z, true);
            index += 4;
          }
          output.setUint16(index, 0, true);
          index += 2;
        }
      }
    });
    return arrayBuffer;
  }
}

function createSTLLoader() {
  if (window.STLLoader) {
    return new window.STLLoader();
  }
  return new LocalSTLLoader();
}

function createSTLExporter() {
  if (window.STLExporter) {
    return new window.STLExporter();
  }
  return new LocalSTLExporter();
}

// --- Placeholder Noise Function (Required for "noiseShape" deformation) ---
// Twin: simpleHash / noise in worker.js — keep both copies identical.
// NOTE: this hash has no spatial coherence; it produces white noise, not a
// Perlin/Simplex field. See perlinFractal below for the coherent alternative.
let noiseSeed = 0;
function simpleHash(x, y, z) {
  let h = 17 + 31 * noiseSeed;
  h = (31 * h + x * 12345) % 100000;
  h = (31 * h + y * 67890) % 100000;
  h = (31 * h + z * 123) % 100000;
  let s = Math.sin((h / 100000) * Math.PI * 2);
  return s * 0.5 + 0.5; // Scale to 0-1
}
function noise(x, y, z) {
  return simpleHash(Math.floor(x * 10), Math.floor(y * 10), Math.floor(z * 10));
}

// --- Coherent Value Noise ---
// Twin: perlin* helpers in worker.js — keep both copies identical.
// Gradient-free value noise: hash the eight corners of the containing lattice
// cell and blend them with a quintic fade. Unlike simpleHash above, nearby
// points return nearby values, which is what makes the displacement read as
// lumps rather than static. Returns 0-1.
function perlinFade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function perlinLatticeValue(ix, iy, iz) {
  // Use Math.imul and unsigned shifts throughout: plain `*` overflows past 2^53
  // and a signed `>>` biases the result low (it capped the output at 0.5).
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^
          Math.imul(iz, 1274126177) ^ Math.imul(noiseSeed, 971);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function perlinNoise(x, y, z) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = perlinFade(x - x0);
  const fy = perlinFade(y - y0);
  const fz = perlinFade(z - z0);

  const lerp = (a, b, t) => a + (b - a) * t;

  const c000 = perlinLatticeValue(x0, y0, z0);
  const c100 = perlinLatticeValue(x0 + 1, y0, z0);
  const c010 = perlinLatticeValue(x0, y0 + 1, z0);
  const c110 = perlinLatticeValue(x0 + 1, y0 + 1, z0);
  const c001 = perlinLatticeValue(x0, y0, z0 + 1);
  const c101 = perlinLatticeValue(x0 + 1, y0, z0 + 1);
  const c011 = perlinLatticeValue(x0, y0 + 1, z0 + 1);
  const c111 = perlinLatticeValue(x0 + 1, y0 + 1, z0 + 1);

  const x00 = lerp(c000, c100, fx);
  const x10 = lerp(c010, c110, fx);
  const x01 = lerp(c001, c101, fx);
  const x11 = lerp(c011, c111, fx);

  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
}

// A single octave of value noise spans only part of 0-1, so it would feel far
// weaker than white noise at the same intensity. Summing octaves and stretching
// the result about its midpoint fixes that, keeping the intensity slider
// meaningful in either mode.
const PERLIN_OCTAVES = 4;
const PERLIN_LACUNARITY = 2.0;
const PERLIN_GAIN = 0.5;
// The scale slider already sets feature size; this only lifts its 0.005-0.5
// range into one where a unit lattice gives visible lumps rather than a single
// flat cell. Keep it low, or neighbouring vertices land in different cells and
// the result degenerates back into static.
const PERLIN_FREQUENCY = 1.0;
const PERLIN_CONTRAST = 2.77; // measured: lifts 4-octave sd 0.127 to ~0.35

function perlinFractal(x, y, z) {
  let amplitude = 1;
  let frequency = PERLIN_FREQUENCY;
  let sum = 0;
  let totalAmplitude = 0;
  for (let i = 0; i < PERLIN_OCTAVES; i++) {
    sum += perlinNoise(x * frequency, y * frequency, z * frequency) * amplitude;
    totalAmplitude += amplitude;
    amplitude *= PERLIN_GAIN;
    frequency *= PERLIN_LACUNARITY;
  }
  const normalized = sum / totalAmplitude; // 0-1, centred near 0.5
  return Math.max(0, Math.min(1, (normalized - 0.5) * PERLIN_CONTRAST + 0.5));
}

// Dispatches on the noise type chosen in the UI. `type` is absent in settings
// files saved before the option existed, so it must default to white.
function sampleNoise(type, x, y, z) {
  return type === "perlin" ? perlinFractal(x, y, z) : noise(x, y, z);
}

// --- THREE.js Core Variables ---
let scene, camera, renderer, controls;
let axisScene, axisCamera, axisHelper, axisLabels;
const AXIS_VIEWPORT_SIZE = 160;
const AXIS_MARGIN = 16;
const AXIS_CAMERA_DISTANCE = 3.2;
// Bounding-sphere radius above which a model is assumed to be in real-world mm
// rather than scene units, triggering the rescale prompt.
const REAL_WORLD_SCALE_RADIUS = 500;
let container = document.getElementById("container");

// Core model storage
let originalGeometry;
// deformedGeometries holds the *result* of the deformation process
let deformedGeometries = {};
let currentModelKey = "noise";
let originalFileName = null; // Track original file name for settings export

// The output of the most recent chain run. A chain's result belongs to no
// single deformation key, so it lives beside deformedGeometries rather than in
// it, and takes precedence while it exists.
let chainResult = null;

// The geometry the viewer, exporter and button-enabling logic should treat as
// "the deformed model": the chain's output when a chain has been run, otherwise
// the single-deformation result for the selected type.
function activeDeformedGeometry() {
  return chainResult ?? deformedGeometries[currentModelKey];
}

// UI elements and parameters
let processBtn, statusElement, exportBtn, toggleView, renderMode, clearBtn, statsElement;
let meshGroup; // Group to hold the visible THREE.js meshes
let solidMesh = null;
let wireMesh = null;
let lastGeometryForView = null;

let workerPool; // Worker pool for parallel processing
let perspCanvasRedraw = null; // Redraws the vanishing-point widget; set in setupParameterControls

let deformParams = {
  noise: { intensity: 1.5, scale: 0.02, axis: "all", type: "white", seed: 0 },
  sine: { amplitude: 15, frequency: 0.05, driverAxis: "x", dispAxis: "x" },
  pixel: { size: 5, axis: "all" },
  idw: {
    numPoints: 8,
    seed: 0,
    weight: 2.0,
    power: 2.0,
    scale: 2.0,
    rays: 6,
    manualPoints: false,
    pointsText: ""
  },
  inflate: { amount: 0.6 },
  twist: { angle: 180, axis: "y" },
  bend: { strength: 0.8, axis: "y" },
  ripple: { amplitude: 4, frequency: 0.3, axis: "y" },
  warp: { strength: 1.0, scale: 0.2 },
  hyper: { amount: 0.6, axis: "y" },
  tessellate: { steps: 1 },
  boundary: { threshold: 0.08, jitter: 2.0 },
  menger: { iterations: 1, keepRatio: 0.7 },
  spherize: { factor: 0.5, radius: 0 },
  persp: { strength: 0.5, mode: "linear", plane: "XY", vpMode: 1,
           vp1: { x: 0, y: 0 }, vp2: { x: 0, y: 0 } }
};

const preprocessSettings = {
  decimate: 100,
  mergeEpsilon: 0
};

// --- Deformation chain ---
//
// Up to three deformations composed in order, each stage fed the previous
// stage's output. An all-empty chain is inert: Generate Deformation behaves
// exactly as it did before chaining existed.

const CHAIN_SLOTS = 3;

// Refuse to run a chain projected to exceed this. Three tessellate slots at the
// slider's maximum multiply the triangle count by 262,144, which against the
// shipped 15,580-triangle default model is billions of triangles — enough to
// kill the tab from a single mistyped step count. ~5M triangles is roughly
// 180 MB of float32 positions.
const MAX_CHAIN_TRIANGLES = 5_000_000;

let deformationChain = new Array(CHAIN_SLOTS).fill(null); // null = empty slot
let activeChainSlot = 0;

// Deep-enough copy of a deformation's parameters. persp nests vp1/vp2, and
// aliasing them would let a later edit mutate a stage that was already
// configured; idw's controlPoints array has the same problem.
function cloneDeformParams(params) {
  const copy = { ...params };
  if (copy.vp1) copy.vp1 = { ...copy.vp1 };
  if (copy.vp2) copy.vp2 = { ...copy.vp2 };
  if (Array.isArray(copy.controlPoints)) {
    copy.controlPoints = copy.controlPoints.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  }
  return copy;
}

// How much a single stage multiplies the triangle count.
//
// Only the topology-changing deformations grow the mesh; every worker-backed
// one is vertex-for-vertex. Menger subdivides before it carves, and carving
// only removes faces, so treating it as pure growth is a safe over-estimate.
function stageGrowthFactor(stage) {
  if (!stage) return 1;
  if (stage.key === "tessellate") {
    return 4 ** Math.max(0, Math.floor(stage.params?.steps ?? 1));
  }
  if (stage.key === "menger") {
    // mengerCarveGeometry clamps its subdivision to Math.min(2, iterations),
    // so the iterations slider's max of 3 never reaches the geometry and the
    // real bound is 4**2. If that clamp is ever loosened, this must follow it
    // or the projection will silently under-report.
    return 4 ** 2;
  }
  return 1;
}

// Projects the triangle count a chain would produce, without running it.
// Returns the running total after each filled stage so a refusal can name the
// slot that broke the budget.
function projectChainTriangles(chain, startTriangles) {
  const steps = [];
  let triangles = startTriangles;
  for (let i = 0; i < chain.length; i++) {
    const stage = chain[i];
    if (!stage) continue;
    triangles *= stageGrowthFactor(stage);
    steps.push({ slot: i, key: stage.key, triangles });
  }
  return steps;
}

// The first stage whose projected output exceeds the cap, or null if the whole
// chain fits.
function findChainOverflow(chain, startTriangles) {
  const steps = projectChainTriangles(chain, startTriangles);
  return steps.find((step) => step.triangles > MAX_CHAIN_TRIANGLES) ?? null;
}

function filledChainStages(chain = deformationChain) {
  return chain.filter((stage) => stage !== null);
}

// Sets a slot from a deformation key, snapshotting the parameters as they stand
// now. Passing null empties the slot.
function setChainSlot(index, key, params = deformParams[key]) {
  if (index < 0 || index >= CHAIN_SLOTS) return;
  deformationChain[index] = key ? { key, params: cloneDeformParams(params) } : null;
  // Any change to the recipe invalidates the result it produced.
  chainResult = null;
}

function clearChain() {
  deformationChain = new Array(CHAIN_SLOTS).fill(null);
  activeChainSlot = 0;
  chainResult = null;
}

// A chain's identity for filenames and status text: "noise_twist_bend".
function chainDescription(chain = deformationChain) {
  return filledChainStages(chain).map((stage) => stage.key).join("_");
}

function deformationLabel(key) {
  return deformationRegistry.find((entry) => entry.key === key)?.label ?? key;
}

// Redraws the slot buttons from chain state. Called after any change to a slot
// or to the active selection.
function renderChainBar() {
  for (let i = 0; i < CHAIN_SLOTS; i++) {
    const button = document.getElementById(`chainSlot${i}`);
    if (!button) continue;
    const stage = deformationChain[i];
    button.textContent = stage
      ? `${i + 1}: ${deformationLabel(stage.key)}`
      : `${i + 1}: empty`;
    button.classList.toggle("active", i === activeChainSlot);
    button.classList.toggle("filled", Boolean(stage));
  }

  const calcBtn = document.getElementById("chainCalcBtn");
  if (calcBtn) {
    calcBtn.disabled = !(originalGeometry && filledChainStages().length > 0);
  }
}

// Points the left-hand panel at a slot. The panel machinery is reused wholesale:
// setupControlPanels shows the right panel, syncSettingsUI fills in the values.
function selectChainSlot(index) {
  if (index < 0 || index >= CHAIN_SLOTS) return;

  // No implicit write-back on the way out. deformParams is a single buffer
  // shared by every slot using the same deformation, so "snapshot the panel
  // into the outgoing slot" cannot tell an edit meant for the slot being left
  // from one meant for the slot being entered — with two twist slots it would
  // stamp the incoming values onto the outgoing stage. Set Slot is the explicit
  // commit; selecting a slot only ever reads.
  activeChainSlot = index;

  // A filled slot restores its own deformation and parameters into the panel.
  const stage = deformationChain[index];
  if (stage) {
    currentModelKey = stage.key;
    deformParams[stage.key] = cloneDeformParams(stage.params);
    const typeRadio = document.querySelector(
      `input[name="type"][value="${stage.key}"]`
    );
    if (typeRadio) typeRadio.checked = true;
    setupControlPanels();
    syncSettingsUI(stage.key);
  }

  renderChainBar();
}

// Puts the deformation currently selected in the panel into the active slot.
function setActiveChainSlotFromPanel() {
  setChainSlot(activeChainSlot, currentModelKey);
  renderChainBar();
  statusDisplay.update(
    `Slot ${activeChainSlot + 1} set to ${deformationLabel(currentModelKey)}.`,
    false
  );
}

const deformationRegistry = [
  { key: "noise", label: "Noise", controlsId: "noiseControls", usesWorker: true },
  { key: "sine", label: "Sine Wave", controlsId: "sineControls", usesWorker: true },
  { key: "pixel", label: "Pixelate", controlsId: "pixelControls", usesWorker: true },
  { key: "idw", label: "IDW Shepard", controlsId: "idwControls", usesWorker: true },
  { key: "inflate", label: "Inflate", controlsId: "inflateControls", usesWorker: true },
  { key: "twist", label: "Twist", controlsId: "twistControls", usesWorker: true },
  { key: "bend", label: "Bend", controlsId: "bendControls", usesWorker: true },
  { key: "ripple", label: "Ripple", controlsId: "rippleControls", usesWorker: true },
  { key: "warp", label: "Warp", controlsId: "warpControls", usesWorker: true },
  { key: "hyper", label: "Hyperbolic Stretch", controlsId: "hyperControls", usesWorker: true },
  { key: "tessellate", label: "Tessellate", controlsId: "tessellateControls", usesWorker: false },
  { key: "boundary", label: "Boundary Disruption", controlsId: "boundaryControls", usesWorker: true },
  { key: "menger", label: "Menger Sponge", controlsId: "mengerControls", usesWorker: false },
  { key: "spherize", label: "Spherize", controlsId: "spherizeControls", usesWorker: true },
  { key: "persp", label: "Perspective Distortion", controlsId: "perspControls", usesWorker: true }
];

function normalizeGeometry(geometry) {
  if (!geometry) return geometry;

  if (!geometry.isBufferGeometry) {
    if (geometry.isGeometry && typeof THREE.BufferGeometry.prototype.fromGeometry === "function") {
      geometry = new THREE.BufferGeometry().fromGeometry(geometry);
    } else {
      console.warn("normalizeGeometry: Non-buffer geometry cannot be normalized.");
      return geometry;
    }
  }

  const position = geometry.getAttribute("position");
  if (position && !position.isBufferAttribute && !position.isInterleavedBufferAttribute) {
    const arr = position.array || position;
    const safeArray = arr || new Float32Array(0);
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(safeArray, 3));
  } else if (!position) {
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(0), 3));
  }

  const index = geometry.index;
  if (index && !index.isBufferAttribute && !index.isInterleavedBufferAttribute) {
    geometry.setIndex(index.array || index || []);
  }

  return geometry;
}

function ensureGeometryNormals(geometry) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return;
  const position = geometry.attributes.position;
  const normal = geometry.getAttribute("normal");

  let needsNormals = !normal || normal.count !== position.count;
  if (!needsNormals && normal && normal.array) {
    const arr = normal.array;
    let sum = 0;
    const checkLen = Math.min(arr.length, 300);
    for (let i = 0; i < checkLen; i++) {
      const v = arr[i];
      if (!Number.isFinite(v)) {
        needsNormals = true;
        break;
      }
      sum += Math.abs(v);
    }
    if (sum < 1e-6) needsNormals = true;
  }

  if (needsNormals) {
    // computeVertexNormals reuses an existing normal attribute in place and
    // does not resize it, so a stale one with the wrong length would survive
    // and leave the mesh mis-shaded. Drop it first and let THREE allocate.
    if (normal && normal.count !== position.count) {
      geometry.deleteAttribute("normal");
    }
    geometry.computeVertexNormals();
  }
}

function getAxisList(axisParam) {
  const axis = axisParam || "y";
  if (axis === "all") return ["x", "y", "z"];
  const axes = [];
  if (axis.includes("x")) axes.push("x");
  if (axis.includes("y")) axes.push("y");
  if (axis.includes("z")) axes.push("z");
  return axes.length ? axes : ["y"];
}

function resetDeformedGeometries() {
  deformedGeometries = {};
  for (const def of deformationRegistry) {
    deformedGeometries[def.key] = null;
  }
}

resetDeformedGeometries();

// --- Poisson Disk Sampling for IDW Control Points ---
class PoissonSampler {
  constructor(seed = 0) {
    this.seed = seed;
    this.random = this.seededRandom(seed);
    this.raycaster = new THREE.Raycaster();
    this.directions = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(1, 1, 1).normalize(),
      new THREE.Vector3(-1, 1, 1).normalize(),
      new THREE.Vector3(1, -1, 1).normalize(),
      new THREE.Vector3(1, 1, -1).normalize()
    ];
  }

  seededRandom(seed) {
    return function() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }

  // Generate Poisson disk samples within a bounding box
  generateSamples(minDistance, maxSamples, bbox) {
    const samples = [];
    const activeList = [];

    // Calculate grid cell size
    const cellSize = minDistance / Math.sqrt(2);
    const gridWidth = Math.ceil((bbox.max.x - bbox.min.x) / cellSize);
    const gridHeight = Math.ceil((bbox.max.y - bbox.min.y) / cellSize);
    const gridDepth = Math.ceil((bbox.max.z - bbox.min.z) / cellSize);

    // Create 3D grid
    const grid = new Array(gridWidth * gridHeight * gridDepth).fill(null);

    // Helper functions
    const gridIndex = (x, y, z) => {
      const gx = Math.floor((x - bbox.min.x) / cellSize);
      const gy = Math.floor((y - bbox.min.y) / cellSize);
      const gz = Math.floor((z - bbox.min.z) / cellSize);
      if (gx < 0 || gx >= gridWidth || gy < 0 || gy >= gridHeight || gz < 0 || gz >= gridDepth) {
        return -1;
      }
      return gx + gy * gridWidth + gz * gridWidth * gridHeight;
    };

    const distance = (a, b) => {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };

    // Generate first sample randomly within bounds
    const firstSample = {
      x: bbox.min.x + this.random() * (bbox.max.x - bbox.min.x),
      y: bbox.min.y + this.random() * (bbox.max.y - bbox.min.y),
      z: bbox.min.z + this.random() * (bbox.max.z - bbox.min.z)
    };

    samples.push(firstSample);
    activeList.push(firstSample);
    const firstIndex = gridIndex(firstSample.x, firstSample.y, firstSample.z);
    if (firstIndex >= 0) {
      grid[firstIndex] = firstSample;
    }

    // Generate additional samples
    while (activeList.length > 0 && samples.length < maxSamples) {
      const randomIndex = Math.floor(this.random() * activeList.length);
      const activeSample = activeList[randomIndex];

      let found = false;
      // Try up to 30 candidate points around the active sample
      for (let attempt = 0; attempt < 30; attempt++) {
        // Generate candidate point in annulus around active sample
        const angle1 = this.random() * Math.PI * 2;
        const angle2 = this.random() * Math.PI * 2;
        const radius = minDistance * (1 + this.random());

        const candidate = {
          x: activeSample.x + radius * Math.sin(angle1) * Math.cos(angle2),
          y: activeSample.y + radius * Math.sin(angle1) * Math.sin(angle2),
          z: activeSample.z + radius * Math.cos(angle1)
        };

        // Check bounds
        if (candidate.x < bbox.min.x || candidate.x > bbox.max.x ||
            candidate.y < bbox.min.y || candidate.y > bbox.max.y ||
            candidate.z < bbox.min.z || candidate.z > bbox.max.z) {
          continue;
        }

        // Check distance to nearby samples
        const candidateGridIndex = gridIndex(candidate.x, candidate.y, candidate.z);
        if (candidateGridIndex < 0) continue;

        let tooClose = false;
        // Check neighboring grid cells
        for (let dx = -1; dx <= 1 && !tooClose; dx++) {
          for (let dy = -1; dy <= 1 && !tooClose; dy++) {
            for (let dz = -1; dz <= 1 && !tooClose; dz++) {
              const neighborIndex = candidateGridIndex + dx + dy * gridWidth + dz * gridWidth * gridHeight;
              if (neighborIndex >= 0 && neighborIndex < grid.length && grid[neighborIndex]) {
                if (distance(candidate, grid[neighborIndex]) < minDistance) {
                  tooClose = true;
                }
              }
            }
          }
        }

        if (!tooClose) {
          samples.push(candidate);
          activeList.push(candidate);
          grid[candidateGridIndex] = candidate;
          found = true;
          break;
        }
      }

      if (!found) {
        // Remove from active list
        activeList.splice(randomIndex, 1);
      }
    }

    return samples;
  }

  // Filter samples to only include those inside the mesh volume
  filterInsideVolume(samples, geometry, maxDirections = null) {
    const insideSamples = [];

    // Create a temporary mesh for ray casting. The material must be
    // double-sided: rays cast from a point inside the mesh leave through
    // back-faces, which a front-side material culls, so every interior point
    // would register zero crossings and be rejected as outside.
    const tempMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    );

    for (const sample of samples) {
      if (this.isPointInsideMesh(sample, tempMesh, maxDirections)) {
        insideSamples.push(sample);
      }
    }

    return insideSamples;
  }

  // Use ray casting to determine if a point is inside the mesh
  isPointInsideMesh(point, mesh, maxDirections = null) {
    const directions = maxDirections
      ? this.directions.slice(0, Math.max(2, Math.min(maxDirections, this.directions.length)))
      : this.directions;

    let insideCount = 0;
    const totalDirections = directions.length;

    for (const direction of directions) {
      this.raycaster.set(new THREE.Vector3(point.x, point.y, point.z), direction);
      const intersects = this.raycaster.intersectObject(mesh);

      // Count intersections in positive direction
      let count = 0;
      for (const intersect of intersects) {
        if (intersect.distance > 0.001) { // Small epsilon to avoid self-intersection
          count++;
        }
      }

      if (count % 2 === 1) {
        insideCount++;
      }
    }

    // Point is inside if majority of rays indicate it's inside
    return insideCount >= Math.ceil(totalDirections * 0.6); // 60% threshold for robustness
  }
}

// --- Worker Pool for Parallel Processing ---
class WorkerPool {
  constructor() {
    this.workers = [];
    this.availableWorkers = [];
    this.pendingTasks = [];
    this.isProcessing = false;
    this.onProgress = null;
    this.onComplete = null;
    this.chunkSize = 10000; // Process 10K vertices per chunk

    // Per-run state, reset at the start of every deformVertices call.
    this.results = {};
    this.chunkSources = {};
    this.completedChunks = 0;
    this.totalChunks = 0;
    this.originalVertexCount = 0;
    this.indexArray = null;
    this.indexType = null;
    this.failedChunks = 0;

    this.initializeWorkers();
  }

  initializeWorkers() {
    // Create workers based on CPU cores (max 8 to avoid overwhelming)
    const workerCount = Math.min(navigator.hardwareConcurrency || 4, 8);

    for (let i = 0; i < workerCount; i++) {
      try {
        // worker.js carries `export` statements for the test suite, so it must
        // be instantiated as a module worker.
        const worker = new Worker('worker.js', { type: 'module' });
        worker.workerId = i;
        worker.isBusy = false;

        worker.onmessage = (e) => this.handleWorkerMessage(e, worker);
        worker.onerror = (e) => this.handleWorkerError(e, worker);

        this.workers.push(worker);
        this.availableWorkers.push(worker);
      } catch (error) {
        console.warn('Failed to create worker:', error);
      }
    }

    console.log(`Initialized ${this.workers.length} workers`);
  }

  handleWorkerMessage(e, worker) {
    const { type, vertices, chunkId, workerId, success, error } = e.data;

    if (type === 'result' && success) {
      // Store result for this chunk
      this.results[chunkId] = vertices;

      // Mark worker as available
      worker.isBusy = false;
      this.availableWorkers.push(worker);

      // Update progress
      this.completedChunks++;
      if (this.onProgress) {
        this.onProgress(this.completedChunks, this.totalChunks);
      }

      // Check if all chunks are complete
      if (this.completedChunks === this.totalChunks) {
        this.finalizeDeformation();
      } else {
        // Process next pending task
        this.processNextTask();
      }
    } else if (type === 'error') {
      console.error(`Worker ${workerId} error:`, error);
      worker.isBusy = false;
      this.availableWorkers.push(worker);
      this.failChunk(chunkId);
    }
  }

  handleWorkerError(e, worker) {
    console.error('Worker error:', e);
    worker.isBusy = false;
    this.availableWorkers.push(worker);
    // A worker-level error carries no chunkId, so we cannot tell which chunk
    // died. Fail the lowest-numbered chunk still outstanding.
    this.failChunk(this.findOutstandingChunk());
  }

  findOutstandingChunk() {
    for (let i = 0; i < this.totalChunks; i++) {
      if (!this.results[i]) return i;
    }
    return -1;
  }

  // Count a chunk as done even though it failed, substituting its undeformed
  // source vertices. Without this the completed count never reaches the total,
  // finalizeDeformation never fires, and the awaiting promise hangs forever.
  failChunk(chunkId) {
    if (!this.isProcessing) return;

    if (chunkId >= 0 && !this.results[chunkId]) {
      const source = this.chunkSources[chunkId];
      if (source) {
        this.results[chunkId] = source;
      } else {
        console.warn(`No source data retained for chunk ${chunkId}.`);
        this.results[chunkId] = null;
      }
      this.failedChunks++;
      this.completedChunks++;
      if (this.onProgress) {
        this.onProgress(this.completedChunks, this.totalChunks);
      }
    }

    if (this.completedChunks >= this.totalChunks) {
      this.finalizeDeformation();
    } else {
      this.processNextTask();
    }
  }

  async deformVertices(deformationType, params, geometry) {
    return new Promise((resolve, reject) => {
      if (!this.workers.length) {
        // Fallback to single-threaded processing
        console.warn('No workers available, falling back to single-threaded processing');
        resolve(this.fallbackDeformation(deformationType, params, geometry));
        return;
      }

      this.onComplete = resolve;
      this.onError = reject;
      this.isProcessing = true;
      this.results = {};
      this.chunkSources = {};
      this.completedChunks = 0;
      this.failedChunks = 0;

      // Get vertices from geometry
      const positionAttribute = geometry.getAttribute('position');
      const vertices = positionAttribute.array.slice(); // Copy array
      const bbox = geometry.boundingBox;
      // Derived here rather than assigned by the caller, so finalizeDeformation
      // can never size its output buffer from a stale or missing value.
      this.originalVertexCount = positionAttribute.count * 3;
      this.indexArray = geometry.index ? geometry.index.array.slice() : null;
      this.indexType = geometry.index ? geometry.index.array.constructor : null;

      // Split vertices into chunks
      const chunks = this.chunkVertices(vertices, this.chunkSize);
      this.totalChunks = chunks.length;

      // Create tasks for each chunk. Each chunk's buffer is transferred to the
      // worker, so keep an untransferred copy to fall back on if it errors.
      this.pendingTasks = chunks.map((chunk, index) => {
        this.chunkSources[index] = chunk.vertices.slice();
        return {
          chunkId: index,
          vertices: chunk.vertices,
          deformationType,
          params,
          bbox
        };
      });

      // Start processing
      for (let i = 0; i < Math.min(this.availableWorkers.length, this.pendingTasks.length); i++) {
        this.processNextTask();
      }
    });
  }

  chunkVertices(vertices, chunkSize) {
    const chunks = [];
    for (let i = 0; i < vertices.length; i += chunkSize * 3) { // *3 for x,y,z components
      const endIndex = Math.min(i + chunkSize * 3, vertices.length);
      const chunkVertices = vertices.slice(i, endIndex);
      chunks.push({ vertices: chunkVertices });
    }
    return chunks;
  }

  processNextTask() {
    if (!this.pendingTasks.length || !this.availableWorkers.length) return;

    const worker = this.availableWorkers.shift();
    const task = this.pendingTasks.shift();

    worker.isBusy = true;

    worker.postMessage({
      type: 'deform',
      deformationType: task.deformationType,
      params: task.params,
      vertices: task.vertices,
      bbox: task.bbox,
      chunkId: task.chunkId,
      workerId: worker.workerId
    }, [task.vertices.buffer]); // Transfer buffer for performance
  }

  finalizeDeformation() {
    // Reassemble vertices from all chunks
    const finalVertices = new Float32Array(this.originalVertexCount);

    for (let chunkId = 0; chunkId < this.totalChunks; chunkId++) {
      // A failed chunk falls back to its undeformed source rather than zeros,
      // so the mesh stays intact where the deformation could not be applied.
      const chunkVertices = this.results[chunkId] || this.chunkSources[chunkId];
      if (!chunkVertices) {
        console.warn(`Missing chunk ${chunkId} during deformation; leaving zeros.`);
        continue;
      }
      const startIndex = chunkId * this.chunkSize * 3;
      finalVertices.set(chunkVertices, startIndex);
    }

    if (this.failedChunks > 0) {
      console.warn(
        `${this.failedChunks} of ${this.totalChunks} chunks failed; those regions are undeformed.`
      );
    }

    // Update geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(finalVertices, 3));
    if (this.indexArray && this.indexType) {
      if (this.indexType === Array) {
        geometry.setIndex(this.indexArray);
      } else {
        // setIndex stores a bare typed array as-is rather than wrapping it, so
        // the resulting index has no `count` and the geometry draws nothing.
        // Wrap it explicitly to keep the compact typed representation.
        geometry.setIndex(
          new THREE.BufferAttribute(new this.indexType(this.indexArray), 1)
        );
      }
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    this.isProcessing = false;
    // Release the retained per-chunk copies; on a large mesh these double the
    // vertex memory held by the pool.
    this.chunkSources = {};
    this.results = {};

    if (this.onComplete) {
      this.onComplete(geometry);
    }
  }

  // Single-threaded path, used when Worker construction fails — notably under
  // file:// in Chrome. Functions taking only `geom` read deformParams directly;
  // that asymmetry is intentional, see CLAUDE.md.
  // Keep these cases in sync with the switch in worker.js onmessage.
  fallbackDeformation(deformationType, params, geometry) {
    const geom = geometry.clone();

    switch (deformationType) {
      case "noise":
        return noiseShape(geom);
      case "sine":
        return sineDeformShape(geom);
      case "pixel":
        return pixelateShape(geom);
      case "idw":
        return idwShape(geom, params);
      case "inflate":
        return inflateShape(geom, params);
      case "twist":
        return twistShape(geom, params);
      case "bend":
        return bendShape(geom, params);
      case "ripple":
        return rippleShape(geom, params);
      case "warp":
        return warpShape(geom, params);
      case "hyper":
        return hyperShape(geom, params);
      case "boundary":
        return boundaryDisruptShape(geom, params);
      case "spherize":
        return spherizeShape(geom);
      case "persp":
        return perspShape(geom);
      default:
        console.warn(
          `fallbackDeformation: no handler for "${deformationType}"; returning geometry unchanged.`
        );
        return geom;
    }
  }

  setProgressCallback(callback) {
    this.onProgress = (completed, total) => {
      // Update progress bar
      const progressContainer = document.getElementById('progressContainer');
      const progressFill = document.getElementById('progressFill');

      if (progressContainer && progressFill) {
        const percentage = (completed / total) * 100;
        progressFill.style.width = `${percentage}%`;
        progressContainer.style.display = completed < total ? 'block' : 'none';
      }

      // Call user callback if provided
      if (callback) {
        callback(completed, total);
      }
    };
  }

  terminate() {
    this.workers.forEach(worker => worker.terminate());
    this.workers = [];
    this.availableWorkers = [];
  }
}

// --- UI Logic and Handlers ---

const statusDisplay = {
  update: (message, buttonState = true) => {
    // buttonState: true disables the process button, false enables it
    if (statusElement) {
      statusElement.textContent = message;
    }
    // Process button is enabled ONLY if a file is loaded AND the function is not currently running
    if (processBtn) processBtn.disabled = !(originalGeometry && !buttonState);

    // Export button is enabled ONLY if a file is loaded AND a deformed geometry exists
    if (exportBtn)
      exportBtn.disabled = !(
        originalGeometry && activeDeformedGeometry()
      );

    // Export Settings button has the same conditions as Export button
    const exportSettingsBtn = document.getElementById("exportSettingsBtn");
    if (exportSettingsBtn)
      exportSettingsBtn.disabled = !(
        originalGeometry && activeDeformedGeometry()
      );

    if (message.includes("successfully")) {
      setTimeout(() => {
        if (
          originalGeometry &&
          originalGeometry.attributes &&
          originalGeometry.attributes.position
        ) {
          if (statusElement)
            statusElement.textContent = `Ready: ${originalGeometry.attributes.position.count} vertices loaded. Click 'Generate Deformation'.`;
        } else {
          if (statusElement) statusElement.textContent = "Ready to load STL.";
        }
      }, 3000);
    }
  },
  error: (message) => {
    if (statusElement) statusElement.textContent = `Error: ${message}`;
    if (processBtn) processBtn.disabled = true;
    if (exportBtn) exportBtn.disabled = true;
  },
};

function getGeometryStats(geometry) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) {
    return { vertices: 0, triangles: 0 };
  }
  const vertexCount = geometry.attributes.position.count || 0;
  const indexCount = geometry.index ? geometry.index.count : 0;
  const triangles = indexCount ? Math.floor(indexCount / 3) : Math.floor(vertexCount / 3);
  return { vertices: vertexCount, triangles };
}

function updateStats(original, deformed, timeMs = null) {
  if (!statsElement) return;
  const origStats = getGeometryStats(original);
  const defStats = getGeometryStats(deformed);
  const timeText = timeMs != null ? `${timeMs.toFixed(0)} ms` : "N/A";
  statsElement.textContent =
    `Stats: Orig ${origStats.vertices} verts / ${origStats.triangles} tris | ` +
    `Deformed ${defStats.vertices} verts / ${defStats.triangles} tris | ` +
    `Time ${timeText}`;
}

function init() {
  container = document.getElementById("container");
  const width = window.innerWidth;
  const height = window.innerHeight;

  // --- CRITICAL FIX: Get UI elements first before any potential error calls ---
  processBtn = document.getElementById("processBtn");
  statusElement = document.getElementById("status");
  statsElement = document.getElementById("stats");
  exportBtn = document.getElementById("exportBtn");
  toggleView = document.getElementById("toggleView");
  renderMode = document.getElementById("renderMode");
  clearBtn = document.getElementById("clearBtn");
  // --- END CRITICAL FIX ---

  // SCENE
  scene = new THREE.Scene();
  window.scene = scene;
  const theme = localStorage.getItem('stlshaper_theme') || 'dark';
  const bgColor = theme === 'light' ? 0xd0d0d0 : 0x333333;
  scene.background = new THREE.Color(bgColor);

  // CAMERA
  camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
  camera.position.set(0, 0, 200);
  window.camera = camera;

  // RENDERER
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.autoClear = false;
  container.appendChild(renderer.domElement);
  window.renderer = renderer;

  // CONTROLS FIX: Check for global OrbitControls or THREE.OrbitControls
  const OrbitControlsClass = window.OrbitControls || THREE.OrbitControls;
  if (!OrbitControlsClass) {
    console.error(
      "OrbitControls class not found. It is imported from the jsDelivr CDN in index.html and assigned to window.OrbitControls; check that import and your network connection.",
    );
    statusDisplay.error("3D Controls Error. Check console/file path.");
    controls = null;
  } else {
    controls = new OrbitControlsClass(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;
    controls.screenSpacePanning = false;
    controls.minDistance = 10;
    controls.maxDistance = 500;
  }

  // LIGHTING
  const ambientLight = new THREE.AmbientLight(0x404040, 2);
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(200, 200, 200);
  scene.add(directionalLight);
  const pointLight = new THREE.PointLight(0xffffff, 1);
  pointLight.position.set(-100, 100, 100);
  scene.add(pointLight);

  // MESH GROUP
  meshGroup = new THREE.Group();
  scene.add(meshGroup);

  // Axis gizmo (bottom-left)
  setupAxisGizmo();

  // Initialize worker pool for parallel processing
  workerPool = new WorkerPool();

  setupListeners();
  setupControlPanels(); // This is correctly called here
  setupParameterControls();

  window.addEventListener("resize", onWindowResize, false);

  // Try to auto-load a default STL if available
  loadDefaultSTL();

  animate();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  // Removed continuous rotation for sine wave here
  if (controls) {
    controls.update();
  }
  renderer.clear();
  renderer.render(scene, camera);
  renderAxisGizmo();
}

function setupAxisGizmo() {
  axisScene = new THREE.Scene();
  axisCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 10);
  axisCamera.position.set(0, 0, AXIS_CAMERA_DISTANCE);

  axisHelper = new THREE.AxesHelper(0.5);
  axisScene.add(axisHelper);

  axisLabels = new THREE.Group();
  axisLabels.add(createAxisLabelSprite("X", 0xff5555, new THREE.Vector3(0.675, 0, 0)));
  axisLabels.add(createAxisLabelSprite("Y", 0x55ff55, new THREE.Vector3(0, 0.675, 0)));
  axisLabels.add(createAxisLabelSprite("Z", 0x5555ff, new THREE.Vector3(0, 0, 0.675)));
  axisScene.add(axisLabels);
}

function createAxisLabelSprite(text, color, position) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.font = "bold 51px Arial";
  ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.55, 0.55, 0.55);
  sprite.position.copy(position);
  return sprite;
}

function renderAxisGizmo() {
  if (!axisScene || !axisCamera) return;

  const target = controls ? controls.target : new THREE.Vector3(0, 0, 0);
  const dir = new THREE.Vector3().subVectors(camera.position, target).normalize();
  axisCamera.position.copy(dir).multiplyScalar(AXIS_CAMERA_DISTANCE);
  axisCamera.up.copy(camera.up);
  axisCamera.lookAt(axisScene.position);
  axisCamera.updateProjectionMatrix();

  const pixelRatio = renderer.getPixelRatio();
  const size = AXIS_VIEWPORT_SIZE * pixelRatio;
  const margin = AXIS_MARGIN * pixelRatio;
  const width = renderer.domElement.width;
  const x = Math.max(margin, width - size - margin);
  const y = margin;

  renderer.clearDepth();
  renderer.setScissorTest(true);
  renderer.setViewport(x, y, size, size);
  renderer.setScissor(x, y, size, size);
  renderer.render(axisScene, axisCamera);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
}

function setupListeners() {
  // File Input
  document.getElementById("fileInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) {
      statusDisplay.update("Ready to load STL.");
      return;
    }
    originalFileName = file.name; // Store original file name
    statusDisplay.update(`Loading file: ${file.name}...`, true);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        parseSTL(reader.result);
        // FIX: Only render the original model. Wait for button click for deformation.
        updateSceneMeshes();
        statusDisplay.update(
          `Model loaded successfully. Click 'Generate Deformation'.`,
          false,
        );
        // Export button remains disabled until deformation is performed
        exportBtn.disabled = true;
      } catch (error) {
        console.error("Error:", error);
        statusDisplay.error(`File/Parse Error. Check console.`);
      }
    };
    reader.onerror = (e) => {
      console.error("FileReader error:", e);
      statusDisplay.error(`Could not read file.`);
    };
    reader.readAsArrayBuffer(file);
  });

  // Deformation Type Radio
  document.querySelectorAll('input[name="type"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      currentModelKey = e.target.value;
      setupControlPanels(); // Correct function call for updating UI panel visibility
      renderChainBar();
      // FIX: If a deformed model already exists for this type, update the scene to show it.
      if (originalGeometry) {
        updateSceneMeshes();
      }
    });
  });

  // Process Button - PRIMARY TRIGGER FOR DEFORMATION
  processBtn.onclick = async () => {
    if (!originalGeometry) {
      statusDisplay.error("Please load an STL first.");
      return;
    }
    try {
      await generateCurrent();
      updateSceneMeshes();
    } catch (e) {
      console.error("Error:", e);
      statusDisplay.error("Error generating deformation.");
    }
  };

  // Chain Bar
  for (let i = 0; i < CHAIN_SLOTS; i++) {
    const slotBtn = document.getElementById(`chainSlot${i}`);
    if (slotBtn) slotBtn.onclick = () => selectChainSlot(i);
  }
  const chainSetBtn = document.getElementById("chainSetBtn");
  if (chainSetBtn) chainSetBtn.onclick = setActiveChainSlotFromPanel;

  const chainClearSlotBtn = document.getElementById("chainClearSlotBtn");
  if (chainClearSlotBtn) {
    chainClearSlotBtn.onclick = () => {
      setChainSlot(activeChainSlot, null);
      renderChainBar();
      updateSceneMeshes();
    };
  }

  const chainCalcBtn = document.getElementById("chainCalcBtn");
  if (chainCalcBtn) {
    chainCalcBtn.onclick = async () => {
      if (!originalGeometry) {
        statusDisplay.error("Please load an STL first.");
        return;
      }
      // The panel is the live editing buffer, so fold pending slider edits into
      // the active slot before running — but only while the panel is still
      // showing that slot's own deformation, or this would overwrite the stage
      // with an unrelated deformation's parameters.
      const active = deformationChain[activeChainSlot];
      if (active && active.key === currentModelKey) {
        active.params = cloneDeformParams(deformParams[active.key]);
      }
      await runChain();
      updateSceneMeshes();
      renderChainBar();
    };
  }

  const chainClearBtn = document.getElementById("chainClearBtn");
  if (chainClearBtn) {
    chainClearBtn.onclick = () => {
      clearChain();
      renderChainBar();
      updateSceneMeshes();
      statusDisplay.update("Chain cleared.", false);
    };
  }

  renderChainBar();

  // Export Button
  exportBtn.onclick = exportSTL;

  // Export Settings Button
  document.getElementById("exportSettingsBtn").onclick = exportSettings;

  // Import Settings Button
  const importSettingsBtn = document.getElementById("importSettingsBtn");
  const importSettingsInput = document.getElementById("importSettingsInput");
  if (importSettingsBtn && importSettingsInput) {
    importSettingsBtn.onclick = () => importSettingsInput.click();
    importSettingsInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      importSettingsFromFile(file);
      e.target.value = "";
    });
  }

  // Clear Button
  if (clearBtn) {
    clearBtn.onclick = () => {
      clearModelAndUI();
    };
  }

  // View Controls
  toggleView.addEventListener("change", updateSceneMeshes);
  renderMode.addEventListener("change", updateSceneMeshes);
  const resetViewBtn = document.getElementById("resetViewBtn");
  if (resetViewBtn) {
    resetViewBtn.onclick = () => resetViewToCurrentGeometry();
  }
}

function clearModelAndUI() {
  // Reset geometries
  originalGeometry = null;
  resetDeformedGeometries();
  chainResult = null;
  originalFileName = null; // Reset original file name

  // Clear meshes from scene
  if (meshGroup) {
    const controlPointSet = new Set(controlPointMeshes);
    while (meshGroup.children.length > 0) {
      const child = meshGroup.children[0];
      if (child && child.isMesh && !controlPointSet.has(child)) {
        disposeMeshMaterial(child);
      }
      meshGroup.remove(child);
    }
  }
  solidMesh = null;
  wireMesh = null;
  lastGeometryForView = null;

  // Remove control point visualization
  if (controlPointMeshes.length > 0) {
    for (const controlPointMesh of controlPointMeshes) {
      if (controlPointMesh.parent) meshGroup.remove(controlPointMesh);
      controlPointMesh.geometry.dispose();
      controlPointMesh.material.dispose();
    }
    controlPointMeshes = []; // Clear the array
  }

  // Reset UI state
  if (processBtn) processBtn.disabled = true;
  if (exportBtn) exportBtn.disabled = true;
  const exportSettingsBtn = document.getElementById("exportSettingsBtn");
  if (exportSettingsBtn) exportSettingsBtn.disabled = true;
  const fileInput = document.getElementById("fileInput");
  if (fileInput) fileInput.value = "";
  renderChainBar();
  if (statusElement) statusElement.textContent = "Cleared. Ready to load STL.";
  if (statsElement) statsElement.textContent = "Stats: N/A";
}

function loadDefaultSTL() {
  const defaultPath = "JustBones617_0_resaved_1_NIH3D.stl";
  const loader = createSTLLoader();
  // Provide immediate feedback
  statusDisplay.update(`Loading default model: ${defaultPath} ...`, true);
  loader.load(
    defaultPath,
    (geometry) => {
      try {
        // Set as current original geometry
        originalGeometry = geometry.clone();
        originalGeometry.computeBoundingBox();
        originalGeometry.center();
        // Recompute bounds after centering
        originalGeometry.computeBoundingBox();
        originalGeometry.computeBoundingSphere();
        ensureGeometryNormals(originalGeometry);
        // Reset any previous deformations
        resetDeformedGeometries();
        originalFileName = defaultPath; // Set default file name

        // Update adaptive parameter ranges based on model size
        updateAdaptiveParameterRanges();
        updateStats(originalGeometry, null, null);

        // Show the original mesh immediately
        updateSceneMeshes();
        // Enable processing now that a model is present
        if (processBtn) processBtn.disabled = false;
        if (exportBtn) exportBtn.disabled = true;
        const exportSettingsBtn = document.getElementById("exportSettingsBtn");
        if (exportSettingsBtn) exportSettingsBtn.disabled = true;
      } catch (err) {
        console.error("Default STL post-load error:", err);
        statusDisplay.error("Default model error. Check console.");
      }
    },
    undefined,
    (err) => {
      console.warn("Default STL not found or failed to load:", err);
      statusDisplay.update("Ready to load STL.", true);
      // Keep buttons disabled until user loads a file
      if (processBtn) processBtn.disabled = true;
      if (exportBtn) exportBtn.disabled = true;
    },
  );
}

function setupControlPanels() {
  for (const def of deformationRegistry) {
    const panel = document.getElementById(def.controlsId);
    if (panel) {
      panel.style.display = currentModelKey === def.key ? "block" : "none";
    }
  }

  // Update control point visualization
  updateControlPointVisualization();
}

function setupPerspCanvas(updateHandler) {
  const canvas = document.getElementById("perspCanvas");
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  const R = 52, cx = 60, cy = 60;
  let dragging = null;

  function dotScreen(vp) {
    return { x: cx + vp.x * R, y: cy - vp.y * R };
  }

  function draw() {
    ctx.clearRect(0, 0, 120, 120);
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "#3a3a3a";
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();

    const p1 = dotScreen(deformParams.persp.vp1);
    ctx.fillStyle = "#6cf";
    ctx.beginPath(); ctx.arc(p1.x, p1.y, 7, 0, Math.PI * 2); ctx.fill();

    if (deformParams.persp.vpMode === 2) {
      const p2 = dotScreen(deformParams.persp.vp2);
      ctx.fillStyle = "#fa6";
      ctx.beginPath(); ctx.arc(p2.x, p2.y, 7, 0, Math.PI * 2); ctx.fill();
    }
  }

  function toUnit(sx, sy) {
    let dx = (sx - cx) / R, dy = -(sy - cy) / R;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 1) { dx /= len; dy /= len; }
    return { x: dx, y: dy };
  }

  function hit(sx, sy, vp) {
    const p = dotScreen(vp);
    return Math.sqrt((sx - p.x) ** 2 + (sy - p.y) ** 2) < 12;
  }

  function getXY(e) {
    const rect = canvas.getBoundingClientRect();
    if (e.touches) return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onDown(e) {
    e.preventDefault();
    const { x, y } = getXY(e);
    if (hit(x, y, deformParams.persp.vp1)) { dragging = 1; return; }
    if (deformParams.persp.vpMode === 2 && hit(x, y, deformParams.persp.vp2)) { dragging = 2; return; }
    dragging = 1;
    deformParams.persp.vp1 = toUnit(x, y);
    draw(); updateHandler("persp");
  }

  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const { x, y } = getXY(e);
    const v = toUnit(x, y);
    if (dragging === 1) deformParams.persp.vp1 = v;
    else deformParams.persp.vp2 = v;
    draw(); updateHandler("persp");
  }

  function onUp() { dragging = null; }

  canvas.addEventListener("mousedown", onDown);
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseup", onUp);
  canvas.addEventListener("mouseleave", onUp);
  canvas.addEventListener("touchstart", onDown, { passive: false });
  canvas.addEventListener("touchmove", onMove, { passive: false });
  canvas.addEventListener("touchend", onUp);

  draw();
  return draw;
}

function setupParameterControls() {
  const updateHandler = (key) => {
    if (originalGeometry && currentModelKey === key) {
      statusDisplay.update(
        `Parameters updated. Click 'Generate Deformation' to apply.`,
        false,
      );
    }
  };

  const bindRange = (key, param, inputId, valueId, parser = parseFloat) => {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener("input", (e) => {
      deformParams[key][param] = parser(e.target.value);
      const valueEl = document.getElementById(valueId);
      if (valueEl) valueEl.textContent = e.target.value;
      updateHandler(key);
    });
  };

  const bindSelect = (key, param, inputId) => {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener("change", (e) => {
      deformParams[key][param] = e.target.value;
      updateHandler(key);
    });
  };

  const bindNumber = (key, param, inputId, valueId, clampFn) => {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener("input", (e) => {
      const parsed = parseInt(e.target.value) || 0;
      deformParams[key][param] = clampFn ? clampFn(parsed) : parsed;
      if (valueId) {
        const valueEl = document.getElementById(valueId);
        if (valueEl) valueEl.textContent = deformParams[key][param];
      }
      e.target.value = deformParams[key][param];
      updateHandler(key);
    });
  };

  const bindCheckbox = (key, param, inputId) => {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener("change", (e) => {
      deformParams[key][param] = !!e.target.checked;
      updateHandler(key);
    });
  };

  const bindTextarea = (key, param, inputId) => {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener("input", (e) => {
      deformParams[key][param] = e.target.value;
      updateHandler(key);
    });
  };

  // Noise
  bindRange("noise", "intensity", "noiseIntensity", "noiseIntensityVal");
  bindRange("noise", "scale", "noiseScale", "noiseScaleVal");
  bindSelect("noise", "axis", "noiseAxis");
  bindSelect("noise", "type", "noiseType");
  bindNumber("noise", "seed", "noiseSeed", "noiseSeedVal", (value) =>
    Math.max(0, Math.min(10000, value))
  );

  // Sine
  bindRange("sine", "amplitude", "sineAmp", "sineAmpVal");
  bindRange("sine", "frequency", "sineFreq", "sineFreqVal");
  bindSelect("sine", "driverAxis", "sineDriverAxis");
  bindSelect("sine", "dispAxis", "sineDispAxis");

  // Pixel
  bindRange("pixel", "size", "pixelSize", "pixelSizeVal");
  bindSelect("pixel", "axis", "pixelAxis");

  // IDW
  bindRange("idw", "numPoints", "idwNumPoints", "idwNumPointsVal", parseInt);
  bindNumber("idw", "seed", "idwSeed", "idwSeedVal", (value) =>
    Math.max(0, Math.min(10000, value))
  );
  bindRange("idw", "weight", "idwWeight", "idwWeightVal");
  bindRange("idw", "power", "idwPower", "idwPowerVal");
  bindRange("idw", "scale", "idwScale", "idwScaleVal");
  bindRange("idw", "rays", "idwRays", "idwRaysVal", parseInt);
  bindCheckbox("idw", "manualPoints", "idwManualPoints");
  bindTextarea("idw", "pointsText", "idwPointsInput");

  // Inflate
  bindRange("inflate", "amount", "inflateAmount", "inflateAmountVal");

  // Twist
  bindRange("twist", "angle", "twistAngle", "twistAngleVal");
  bindSelect("twist", "axis", "twistAxis");

  // Bend
  bindRange("bend", "strength", "bendStrength", "bendStrengthVal");
  bindSelect("bend", "axis", "bendAxis");

  // Ripple
  bindRange("ripple", "amplitude", "rippleAmp", "rippleAmpVal");
  bindRange("ripple", "frequency", "rippleFreq", "rippleFreqVal");
  bindSelect("ripple", "axis", "rippleAxis");

  // Warp
  bindRange("warp", "strength", "warpStrength", "warpStrengthVal");
  bindRange("warp", "scale", "warpScale", "warpScaleVal");

  // Hyperbolic
  bindRange("hyper", "amount", "hyperAmount", "hyperAmountVal");
  bindSelect("hyper", "axis", "hyperAxis");

  // Tessellate
  bindRange("tessellate", "steps", "tessellateSteps", "tessellateStepsVal", parseInt);

  // Boundary
  bindRange("boundary", "threshold", "boundaryThreshold", "boundaryThresholdVal");
  bindRange("boundary", "jitter", "boundaryJitter", "boundaryJitterVal");

  // Menger
  bindRange("menger", "iterations", "mengerIterations", "mengerIterationsVal", parseInt);
  bindRange("menger", "keepRatio", "mengerKeep", "mengerKeepVal");

  // Spherize
  bindRange("spherize", "factor", "spherizeFactor", "spherizeFactorVal");
  bindRange("spherize", "radius", "spherizeRadius", "spherizeRadiusVal");

  // Perspective Distortion
  bindRange("persp", "strength", "perspStrength", "perspStrengthVal");
  bindSelect("persp", "mode", "perspMode");
  bindSelect("persp", "plane", "perspPlane");

  perspCanvasRedraw = setupPerspCanvas(updateHandler);

  document.querySelectorAll('input[name="vpMode"]').forEach(r => {
    r.addEventListener("change", e => {
      deformParams.persp.vpMode = parseInt(e.target.value);
      if (perspCanvasRedraw) perspCanvasRedraw();
      updateHandler("persp");
    });
  });

  // Preprocess controls
  const decimate = document.getElementById("decimate");
  if (decimate) {
    decimate.addEventListener("input", (e) => {
      preprocessSettings.decimate = parseInt(e.target.value);
      const val = document.getElementById("decimateVal");
      if (val) val.textContent = e.target.value;
    });
  }
  const merge = document.getElementById("mergeEpsilon");
  if (merge) {
    merge.addEventListener("input", (e) => {
      preprocessSettings.mergeEpsilon = parseFloat(e.target.value);
      const val = document.getElementById("mergeVal");
      if (val) val.textContent = e.target.value;
    });
  }
}

// Update parameter ranges based on model size to prevent exponential effects
function updateAdaptiveParameterRanges() {
  if (!originalGeometry || !originalGeometry.boundingBox) return;

  const bbox = originalGeometry.boundingBox;
  const sizeX = bbox.max.x - bbox.min.x;
  const sizeY = bbox.max.y - bbox.min.y;
  const sizeZ = bbox.max.z - bbox.min.z;
  const maxDimension = Math.max(sizeX, sizeY, sizeZ);

  // Adaptive ranges based on model size
  // Smaller models need smaller ranges to avoid exponential effects
  // Larger models need larger ranges to have visible effects

  // Scale factor: normalize to a "medium" model size of ~100 units
  const scaleFactor = Math.max(0.1, maxDimension / 100);

  // Update IDW parameter ranges - make them more aggressive
  const idwWeightInput = document.getElementById("idwWeight");
  const idwScaleInput = document.getElementById("idwScale");

  if (idwWeightInput) {
    const weightRange = 10 * scaleFactor; // Increased from 5
    idwWeightInput.min = (-weightRange).toFixed(1);
    idwWeightInput.max = weightRange.toFixed(1);
    // Keep current value within new range
    const currentWeight = deformParams.idw.weight;
    deformParams.idw.weight = Math.max(parseFloat(idwWeightInput.min),
                                       Math.min(parseFloat(idwWeightInput.max), currentWeight));
    idwWeightInput.value = deformParams.idw.weight;
    const idwWeightVal = document.getElementById("idwWeightVal");
    if (idwWeightVal) idwWeightVal.textContent = deformParams.idw.weight;
  }

  if (idwScaleInput) {
    const scaleRange = 15 * scaleFactor; // Increased from 5
    idwScaleInput.min = (0.5 * scaleFactor).toFixed(1); // Increased minimum
    idwScaleInput.max = scaleRange.toFixed(1);
    // Keep current value within new range
    const currentScale = deformParams.idw.scale;
    deformParams.idw.scale = Math.max(parseFloat(idwScaleInput.min),
                                      Math.min(parseFloat(idwScaleInput.max), currentScale));
    idwScaleInput.value = deformParams.idw.scale;
    const idwScaleVal = document.getElementById("idwScaleVal");
    if (idwScaleVal) idwScaleVal.textContent = deformParams.idw.scale;
  }

  console.log(`Updated IDW parameter ranges for model size ${maxDimension.toFixed(2)}: weight ±${idwWeightInput?.max || 'N/A'}, scale ${idwScaleInput?.min || 'N/A'} - ${idwScaleInput?.max || 'N/A'}`);
}

function parseSTL(arrayBuffer) {
  const loader = createSTLLoader();
  originalGeometry = loader.parse(arrayBuffer);

  originalGeometry.computeBoundingBox();
  // FIX: Center the geometry so it sits at the world origin (0,0,0)
  originalGeometry.center();

  // Recompute bounds after centering
  originalGeometry.computeBoundingBox();
  originalGeometry.computeBoundingSphere();
  ensureGeometryNormals(originalGeometry);
  // Clear any old deformed models when a new file is loaded. The chain's own
  // result belongs to the previous model, so it goes too — the slot recipe is
  // kept, so the chain can simply be re-run against the new mesh.
  resetDeformedGeometries();
  chainResult = null;

  // Update adaptive parameter ranges based on model size
  updateAdaptiveParameterRanges();
  updateStats(originalGeometry, null, null);
  renderChainBar();

  console.log(
    "STL Loaded. Vertices:",
    originalGeometry.attributes.position.count,
  );

  checkModelScale();
}

function checkModelScale() {
  if (!originalGeometry) return;
  originalGeometry.computeBoundingSphere();
  const radius = originalGeometry.boundingSphere?.radius || 0;
  const prompt = document.getElementById("scale-prompt");
  if (!prompt) return;
  // Camera sits at radius * 2.5; beyond this the model is likely real-world mm
  if (radius > REAL_WORLD_SCALE_RADIUS) {
    prompt.style.display = "block";
  } else {
    prompt.style.display = "none";
  }
}

function applyModelScale(factor) {
  if (!originalGeometry) return;
  const prompt = document.getElementById("scale-prompt");
  if (prompt) prompt.style.display = "none";

  originalGeometry.computeBoundingSphere();
  const radius = originalGeometry.boundingSphere?.radius || 1;

  // Auto: scale so radius fits ~80% of a 100-unit camera distance
  const scale = factor !== null ? factor : (80 / radius);

  const pos = originalGeometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, pos.getX(i) * scale);
    pos.setY(i, pos.getY(i) * scale);
    pos.setZ(i, pos.getZ(i) * scale);
  }
  pos.needsUpdate = true;
  originalGeometry.computeBoundingBox();
  originalGeometry.computeBoundingSphere();
  originalGeometry.computeVertexNormals();
  resetDeformedGeometries();
  updateAdaptiveParameterRanges();
  updateStats(originalGeometry, null, null);
  updateSceneMeshes();
  updateCameraForGeometry(originalGeometry, true);
}
window.applyModelScale = applyModelScale;

function applyPreprocess(sourceGeometry) {
  if (!sourceGeometry) return sourceGeometry;
  const needsDecimate = preprocessSettings.decimate < 100;
  const needsMerge = preprocessSettings.mergeEpsilon > 0;

  if (!needsDecimate && !needsMerge) {
    return normalizeGeometry(sourceGeometry);
  }

  let geometry = sourceGeometry.clone();
  if (geometry.index) {
    geometry = geometry.toNonIndexed();
  }

  if (needsDecimate) {
    geometry = decimateGeometry(geometry, preprocessSettings.decimate);
  }

  if (needsMerge) {
    geometry = mergeVerticesGeometry(geometry, preprocessSettings.mergeEpsilon);
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return normalizeGeometry(geometry);
}

function decimateGeometry(geometry, keepPercent) {
  const position = geometry.getAttribute("position");
  if (!position || position.count < 3) return geometry;

  const keepRatio = Math.max(0.1, Math.min(1, keepPercent / 100));
  if (keepRatio >= 0.999) return geometry;

  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox;
  if (!bbox) return geometry;

  const size = new THREE.Vector3();
  bbox.getSize(size);
  const volume = Math.max(1e-9, size.x * size.y * size.z);

  const targetVertices = Math.max(4, Math.floor(position.count * keepRatio));
  let voxelSize = Math.cbrt(volume / targetVertices);

  // Clamp voxel size to avoid extreme collapse on thin meshes
  const diag = Math.hypot(size.x, size.y, size.z) || 1;
  const minVoxel = diag * 1e-4;
  const maxVoxel = diag * 0.25;
  voxelSize = Math.max(minVoxel, Math.min(maxVoxel, voxelSize));

  const positions = position.array;
  const map = new Map();
  const sums = [];
  const counts = [];
  const vertexToCluster = new Array(position.count);

  const min = bbox.min;
  const inv = 1 / voxelSize;

  for (let i = 0; i < position.count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const ix = Math.floor((x - min.x) * inv);
    const iy = Math.floor((y - min.y) * inv);
    const iz = Math.floor((z - min.z) * inv);
    const key = `${ix},${iy},${iz}`;
    let clusterIndex = map.get(key);
    if (clusterIndex === undefined) {
      clusterIndex = sums.length / 3;
      map.set(key, clusterIndex);
      sums.push(x, y, z);
      counts.push(1);
    } else {
      const base = clusterIndex * 3;
      sums[base] += x;
      sums[base + 1] += y;
      sums[base + 2] += z;
      counts[clusterIndex] += 1;
    }
    vertexToCluster[i] = clusterIndex;
  }

  const clustered = new Float32Array(sums.length);
  for (let i = 0; i < counts.length; i++) {
    const base = i * 3;
    const c = counts[i];
    clustered[base] = sums[base] / c;
    clustered[base + 1] = sums[base + 1] / c;
    clustered[base + 2] = sums[base + 2] / c;
  }

  const indices = [];
  const epsSq = 1e-12;
  for (let i = 0; i < position.count; i += 3) {
    const a = vertexToCluster[i];
    const b = vertexToCluster[i + 1];
    const c = vertexToCluster[i + 2];
    if (a === b || b === c || c === a) continue;

    const ax = clustered[a * 3], ay = clustered[a * 3 + 1], az = clustered[a * 3 + 2];
    const bx = clustered[b * 3], by = clustered[b * 3 + 1], bz = clustered[b * 3 + 2];
    const cx = clustered[c * 3], cy = clustered[c * 3 + 1], cz = clustered[c * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const area2 = nx * nx + ny * ny + nz * nz;
    if (area2 <= epsSq) continue;

    indices.push(a, b, c);
  }

  if (indices.length === 0) {
    console.warn("Decimation removed all faces; returning original geometry.");
    return geometry;
  }

  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute("position", new THREE.Float32BufferAttribute(clustered, 3));
  newGeom.setIndex(indices);
  newGeom.computeVertexNormals();
  newGeom.computeBoundingBox();
  newGeom.computeBoundingSphere();
  return newGeom;
}

function mergeVerticesGeometry(geometry, epsilon) {
  const position = geometry.getAttribute("position");
  if (!position || position.count === 0) return geometry;
  // Guard: epsilon 0 makes `1 / epsilon` Infinity, collapsing every vertex into
  // one bucket. Callers already check this, but the check lives 130 lines away.
  if (!(epsilon > 0)) {
    console.warn("Vertex merge skipped: epsilon must be greater than 0.");
    return geometry;
  }
  const positions = position.array;
  const map = new Map();
  const unique = [];
  const indices = [];

  const inv = 1 / epsilon;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = unique.length / 3;
      unique.push(x, y, z);
      map.set(key, idx);
    }
    indices.push(idx);
  }

  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute("position", new THREE.Float32BufferAttribute(unique, 3));
  newGeom.setIndex(indices);
  newGeom.computeVertexNormals();
  return newGeom;
}

function applyTopologyDeformation(type, params, geometry) {
  switch (type) {
    case "tessellate":
      return tessellateGeometry(geometry, params.steps || 1);
    case "menger":
      return mengerCarveGeometry(geometry, params.iterations || 1, params.keepRatio || 0.7);
    default:
      return geometry.clone();
  }
}

function tessellateGeometry(geometry, steps = 1) {
  let geom = geometry.toNonIndexed();
  for (let step = 0; step < steps; step++) {
    const position = geom.getAttribute("position");
    if (!position || position.count < 3) break;
    const arr = position.array;
    const out = [];
    for (let i = 0; i < arr.length; i += 9) {
      const ax = arr[i], ay = arr[i + 1], az = arr[i + 2];
      const bx = arr[i + 3], by = arr[i + 4], bz = arr[i + 5];
      const cx = arr[i + 6], cy = arr[i + 7], cz = arr[i + 8];

      const abx = (ax + bx) * 0.5, aby = (ay + by) * 0.5, abz = (az + bz) * 0.5;
      const bcx = (bx + cx) * 0.5, bcy = (by + cy) * 0.5, bcz = (bz + cz) * 0.5;
      const cax = (cx + ax) * 0.5, cay = (cy + ay) * 0.5, caz = (cz + az) * 0.5;

      // Four new triangles
      out.push(
        ax, ay, az, abx, aby, abz, cax, cay, caz,
        abx, aby, abz, bx, by, bz, bcx, bcy, bcz,
        cax, cay, caz, bcx, bcy, bcz, cx, cy, cz,
        abx, aby, abz, bcx, bcy, bcz, cax, cay, caz
      );
    }
    geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  }
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

function mengerCarveGeometry(geometry, iterations = 1, keepRatio = 0.7) {
  let geom = geometry.toNonIndexed();

  const subdivSteps = Math.max(1, Math.min(2, iterations));
  if (subdivSteps > 0) {
    geom = tessellateGeometry(geom, subdivSteps);
  }

  geom.computeBoundingBox();
  const bbox = geom.boundingBox;
  if (!bbox) return geom;
  const size = new THREE.Vector3();
  bbox.getSize(size);
  size.x = size.x || 1;
  size.y = size.y || 1;
  size.z = size.z || 1;

  const position = geom.getAttribute("position");
  const arr = position.array;
  const kept = [];

  const edgeMargin = 0.02;
  const edgeX = size.x * edgeMargin;
  const edgeY = size.y * edgeMargin;
  const edgeZ = size.z * edgeMargin;

  const clamp01 = (v) => Math.min(0.999999, Math.max(0, v));
  const hash = (x, y, z) =>
    Math.abs(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453) % 1;

  const isInMenger = (x, y, z, iters) => {
    let px = x, py = y, pz = z;
    for (let i = 0; i < iters; i++) {
      const xi = Math.floor(px * 3);
      const yi = Math.floor(py * 3);
      const zi = Math.floor(pz * 3);
      if (
        (xi === 1 && yi === 1) ||
        (xi === 1 && zi === 1) ||
        (yi === 1 && zi === 1)
      ) {
        return false;
      }
      px = (px * 3) % 1;
      py = (py * 3) % 1;
      pz = (pz * 3) % 1;
    }
    return true;
  };

  const nearOuterEdge = (x, y, z) =>
    x - bbox.min.x < edgeX ||
    bbox.max.x - x < edgeX ||
    y - bbox.min.y < edgeY ||
    bbox.max.y - y < edgeY ||
    z - bbox.min.z < edgeZ ||
    bbox.max.z - z < edgeZ;

  const ratio = Math.min(1, Math.max(0, keepRatio));

  for (let i = 0; i < arr.length; i += 9) {
    const ax = arr[i], ay = arr[i + 1], az = arr[i + 2];
    const bx = arr[i + 3], by = arr[i + 4], bz = arr[i + 5];
    const cx = arr[i + 6], cy = arr[i + 7], cz = arr[i + 8];

    if (nearOuterEdge(ax, ay, az) || nearOuterEdge(bx, by, bz) || nearOuterEdge(cx, cy, cz)) {
      kept.push(ax, ay, az, bx, by, bz, cx, cy, cz);
      continue;
    }

    const nax = clamp01((ax - bbox.min.x) / size.x);
    const nay = clamp01((ay - bbox.min.y) / size.y);
    const naz = clamp01((az - bbox.min.z) / size.z);
    const nbx = clamp01((bx - bbox.min.x) / size.x);
    const nby = clamp01((by - bbox.min.y) / size.y);
    const nbz = clamp01((bz - bbox.min.z) / size.z);
    const ncx = clamp01((cx - bbox.min.x) / size.x);
    const ncy = clamp01((cy - bbox.min.y) / size.y);
    const ncz = clamp01((cz - bbox.min.z) / size.z);

    const keepA = isInMenger(nax, nay, naz, iterations);
    const keepB = isInMenger(nbx, nby, nbz, iterations);
    const keepC = isInMenger(ncx, ncy, ncz, iterations);

    if (keepA || keepB || keepC) {
      kept.push(ax, ay, az, bx, by, bz, cx, cy, cz);
      continue;
    }

    if (ratio > 0) {
      const cxm = (ax + bx + cx) / 3;
      const cym = (ay + by + cy) / 3;
      const czm = (az + bz + cz) / 3;
      if (hash(cxm, cym, czm) < ratio) {
        kept.push(ax, ay, az, bx, by, bz, cx, cy, cz);
      }
    }
  }

  if (kept.length === 0) {
    console.warn("Menger carving removed all faces; returning original geometry.");
    return geom;
  }

  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute("position", new THREE.Float32BufferAttribute(kept, 3));
  newGeom.computeVertexNormals();
  newGeom.computeBoundingBox();
  newGeom.computeBoundingSphere();
  return newGeom;
}

// Runs a single deformation against the geometry it is handed, and returns the
// result rather than storing it. Everything geometry-dependent lives here — the
// IDW control points and the perspective normalisation both have to be derived
// from the mesh actually being deformed, which for a chained stage is the
// previous stage's output rather than the original model.
//
// `params` is taken as an argument instead of read from `deformParams` so a
// chain stage can supply the snapshot it was configured with.
async function runDeformation(geometry, key, params) {
  const defEntry = deformationRegistry.find((entry) => entry.key === key);
  if (!defEntry) {
    throw new Error(`Unknown deformation type: ${key}`);
  }

  let workingGeometry = geometry;

  // Special handling for IDW: generate control points
  if (key === 'idw') {
    let controlPoints = [];
    if (params.manualPoints) {
      controlPoints = parseManualControlPoints(params.pointsText);
      if (controlPoints.length === 0) {
        console.warn("Manual control points empty; falling back to auto-generated points.");
      }
    }
    if (controlPoints.length === 0) {
      controlPoints = generateIDWControlPoints(workingGeometry);
    }
    idwControlPoints = controlPoints;
    params.controlPoints = controlPoints;
    console.log(`Using ${controlPoints.length} control points for IDW deformation`);
  }

  // Perspective normalizes against the largest projection across the whole
  // mesh. Workers only ever see a 10K-vertex chunk, so compute it here and
  // pass it down, or each chunk would scale against its own local maximum.
  //
  // This must be recomputed per stage: projMax cancels algebraically in linear
  // mode but NOT in exponential mode, so a stale value from an earlier stage is
  // silently wrong rather than obviously broken.
  if (key === 'persp') {
    workingGeometry.computeBoundingBox();
    const pbox = workingGeometry.boundingBox;
    const pcx = (pbox.min.x + pbox.max.x) * 0.5;
    const pcy = (pbox.min.y + pbox.max.y) * 0.5;
    const pcz = (pbox.min.z + pbox.max.z) * 0.5;
    const parr = workingGeometry.getAttribute('position').array;
    params.projMax1 = perspComputeProjMax(
      parr, pcx, pcy, pcz, perspVpTo3D(params.vp1, params.plane)
    );
    if (params.vpMode === 2) {
      params.projMax2 = perspComputeProjMax(
        parr, pcx, pcy, pcz, perspVpTo3D(params.vp2, params.plane)
      );
    }
  }

  // Topology-changing methods are handled on main thread
  if (!defEntry.usesWorker) {
    const topologyGeometry = applyTopologyDeformation(key, params, workingGeometry);
    ensureGeometryNormals(topologyGeometry);
    return topologyGeometry;
  }

  // Set up progress callback
  workerPool.setProgressCallback((completed, total) => {
    const progress = Math.round((completed / total) * 100);
    statusDisplay.update(`Processing ${key} deformation... ${progress}%`, true);
  });

  try {
    // Use worker pool for parallel processing
    const deformedGeometry = await workerPool.deformVertices(
      key,
      params,
      workingGeometry
    );

    ensureGeometryNormals(deformedGeometry);
    return normalizeGeometry(deformedGeometry);
  } finally {
    // Drop the callback once this run is done. A chunk completing late would
    // otherwise keep writing "Processing..." over whatever the user did next —
    // a Set Slot confirmation, say — making the later action look ignored.
    workerPool.setProgressCallback(null);
  }
}

// Runs the filled chain slots in order, each stage fed the previous stage's
// output. Preprocessing happens once, before the loop: decimating between
// stages would compound vertex loss.
async function runChain() {
  if (!originalGeometry) return;

  const stages = filledChainStages();
  if (stages.length === 0) {
    statusDisplay.error("Chain is empty. Add a deformation to a slot first.");
    return;
  }

  try {
    const workingGeometry = applyPreprocess(originalGeometry);

    // Check the projection before touching anything. On refusal the current
    // model is left exactly as it was.
    const startTriangles = getGeometryStats(workingGeometry).triangles;
    const overflow = findChainOverflow(deformationChain, startTriangles);
    if (overflow) {
      statusDisplay.error(
        `Chain refused: slot ${overflow.slot + 1} (${overflow.key}) would reach ` +
        `${overflow.triangles.toLocaleString()} triangles, over the ` +
        `${MAX_CHAIN_TRIANGLES.toLocaleString()} limit. Reduce its steps.`
      );
      return;
    }

    const startTime = performance.now();
    let geometry = workingGeometry;
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      statusDisplay.update(
        `Stage ${i + 1}/${stages.length}: ${stage.key} deformation...`,
        true
      );
      geometry = await runDeformation(geometry, stage.key, cloneDeformParams(stage.params));
    }

    chainResult = normalizeGeometry(geometry);
    const elapsed = performance.now() - startTime;
    updateStats(originalGeometry, chainResult, elapsed);
    statusDisplay.update(`Generated ${chainDescription()} chain successfully.`, false);

  } catch (error) {
    console.error('Chain error:', error);
    hideProgressBar();
    statusDisplay.error('Error generating chain.');
  }
}

async function generateCurrent() {
  if (!originalGeometry) return;

  try {
    statusDisplay.update(`Processing ${currentModelKey} deformation...`, true);

    const defEntry = deformationRegistry.find((entry) => entry.key === currentModelKey);
    if (!defEntry) {
      statusDisplay.error("Unknown deformation type.");
      return;
    }

    // A single deformation supersedes any chain output: leaving it set would
    // make activeDeformedGeometry keep returning the chain's result, and this
    // deformation would look like it did nothing.
    chainResult = null;

    // Preprocess geometry if requested
    const workingGeometry = applyPreprocess(originalGeometry);
    const params = { ...deformParams[currentModelKey] };

    const startTime = performance.now();
    const result = await runDeformation(workingGeometry, currentModelKey, params);
    deformedGeometries[currentModelKey] = result;
    const elapsed = performance.now() - startTime;
    updateStats(originalGeometry, result, elapsed);

    statusDisplay.update(`Generated ${currentModelKey} deformation successfully.`, false);

  } catch (error) {
    console.error('Deformation error:', error);
    // The progress bar only self-hides on reaching 100%, so a failure would
    // otherwise leave it stranded mid-fill.
    hideProgressBar();
    statusDisplay.error('Error generating deformation.');
  }
}

function hideProgressBar() {
  const progressContainer = document.getElementById('progressContainer');
  const progressFill = document.getElementById('progressFill');
  if (progressContainer) progressContainer.style.display = 'none';
  if (progressFill) progressFill.style.width = '0%';
}

// --- THREE.js Rendering Logic ---
function disposeMeshMaterial(mesh) {
  const material = mesh?.material;
  if (!material) return;
  if (Array.isArray(material)) {
    for (const mat of material) {
      if (mat && typeof mat.dispose === "function") mat.dispose();
    }
    return;
  }
  if (typeof material.dispose === "function") material.dispose();
}

// Release a geometry the viewer is dropping, unless it is still referenced as
// the original or as one of the cached deformation results.
function disposeUnreferencedGeometry(geometry) {
  if (!geometry || typeof geometry.dispose !== "function") return;
  if (geometry === originalGeometry) return;
  // The chain's output is held outside deformedGeometries, so it needs its own
  // check here or the viewer would dispose it on the next mesh swap.
  if (geometry === chainResult) return;
  for (const key in deformedGeometries) {
    if (deformedGeometries[key] === geometry) return;
  }
  geometry.dispose();
}

// Swap a mesh's geometry, disposing the outgoing one if nothing else holds it.
function setMeshGeometry(mesh, geometry) {
  const previous = mesh.geometry;
  if (previous === geometry) return;
  mesh.geometry = geometry;
  disposeUnreferencedGeometry(previous);
}

function updateCameraForGeometry(geometry, forceReset = false) {
  if (!geometry) return;
  geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere?.radius || 1;
  const safeRadius = Math.max(radius, 0.001);

  if (controls) {
    controls.minDistance = safeRadius * 0.3;
    controls.maxDistance = safeRadius * 10;
  }

  if (forceReset) {
    camera.position.set(0, 0, safeRadius * 2.5);
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }
}

function resetViewToCurrentGeometry() {
  const showDeformed = toggleView && toggleView.checked;
  const deformedExists = activeDeformedGeometry();
  const geometryToDraw = showDeformed && deformedExists ? deformedExists : originalGeometry;
  if (!geometryToDraw) return;
  updateCameraForGeometry(geometryToDraw, true);
}

function updateSceneMeshes() {
  // Determine which geometry to show
  const showDeformed = toggleView.checked;
  const deformedExists = activeDeformedGeometry();

  // Show original if no deformed model exists or if toggle is off
  let geometryToDraw = originalGeometry;
  if (showDeformed && deformedExists) {
    geometryToDraw = deformedExists;
  }

  if (!geometryToDraw) {
    if (solidMesh) solidMesh.visible = false;
    if (wireMesh) wireMesh.visible = false;
    return;
  }

  const mode = renderMode.value;
  const isDeformed = geometryToDraw === deformedExists;

  const solidColor = isDeformed ? 0xcc5050 : 0x5078c8;
  const wireColor = isDeformed ? 0xff6464 : 0x6496ff;

  // Update camera limits only when geometry changes (do not reset view)
  const geometryChanged = geometryToDraw !== lastGeometryForView;
  if (geometryChanged) {
    ensureGeometryNormals(geometryToDraw);
    updateCameraForGeometry(geometryToDraw, false);
    lastGeometryForView = geometryToDraw;
  }

  // SOLID MESH
  if (mode === "solid" || mode === "both") {
    if (!solidMesh) {
      const material = new THREE.MeshPhongMaterial({
        color: solidColor,
        shininess: 30,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      });
      solidMesh = new THREE.Mesh(geometryToDraw, material);
      meshGroup.add(solidMesh);
    } else {
      setMeshGeometry(solidMesh, geometryToDraw);
      solidMesh.material.color.setHex(solidColor);
      solidMesh.material.opacity = 0.9;
      solidMesh.material.side = THREE.DoubleSide;
    }
    solidMesh.visible = true;
  } else if (solidMesh) {
    solidMesh.visible = false;
  }

  // WIREFRAME MESH (Draws on top for 'both' mode)
  if (mode === "wireframe" || mode === "both") {
    const wireOpacity = mode === "both" ? 0.8 : 1.0;
    if (!wireMesh) {
      const material = new THREE.MeshBasicMaterial({
        color: wireColor,
        wireframe: true,
        transparent: true,
        opacity: wireOpacity,
      });
      wireMesh = new THREE.Mesh(geometryToDraw, material);
      meshGroup.add(wireMesh);
    } else {
      setMeshGeometry(wireMesh, geometryToDraw);
      wireMesh.material.color.setHex(wireColor);
      wireMesh.material.opacity = wireOpacity;
      wireMesh.material.wireframe = true;
    }
    wireMesh.visible = true;
  } else if (wireMesh) {
    wireMesh.visible = false;
  }

  // Update control point visualization after mesh update
  updateControlPointVisualization();
}

// Control point visualization
let controlPointMeshes = []; // Array to hold multiple control point visualizations

function updateControlPointVisualization() {
  // Remove existing control points
  for (const controlPointMesh of controlPointMeshes) {
    if (controlPointMesh.parent) {
      meshGroup.remove(controlPointMesh);
    }
    controlPointMesh.geometry.dispose();
    controlPointMesh.material.dispose();
  }
  controlPointMeshes = [];

  // Only show control points for IDW deformation
  if (currentModelKey !== 'idw' || idwControlPoints.length === 0) return;

  // The scene group only exists after init(); importing IDW settings before
  // then would otherwise throw while adding the marker spheres.
  if (!meshGroup) return;

  // Calculate sphere size based on model dimensions (5% of longest axis)
  let sphereRadius = 0.3; // Default fallback
  if (originalGeometry && originalGeometry.boundingBox) {
    const bbox = originalGeometry.boundingBox;
    const sizeX = bbox.max.x - bbox.min.x;
    const sizeY = bbox.max.y - bbox.min.y;
    const sizeZ = bbox.max.z - bbox.min.z;
    const maxDimension = Math.max(sizeX, sizeY, sizeZ);
    sphereRadius = maxDimension * 0.05; // 5% of longest axis
  }

  // Create control point spheres for each control point
  for (let i = 0; i < idwControlPoints.length; i++) {
    const controlPoint = idwControlPoints[i];

    const geometry = new THREE.SphereGeometry(sphereRadius, 8, 8);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff4444,
      transparent: true,
      opacity: 0.6,
      wireframe: true
    });

    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.set(controlPoint.x, controlPoint.y, controlPoint.z);

    meshGroup.add(sphere);
    controlPointMeshes.push(sphere);
  }
}

function exportSTL() {
  const activeModel = activeDeformedGeometry();
  if (!activeModel) {
    statusDisplay.error("No deformed model generated to export.");
    return;
  }
  // A chain result is named for the whole recipe, not the selected radio.
  const exportName = chainResult ? chainDescription() : currentModelKey;
  statusDisplay.update(`Exporting ${exportName} model...`, true);
  try {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(activeModel);
    scene.add(mesh);
    const exporter = createSTLExporter();
    const stlData = exporter.parse(scene, { binary: true });

    const blob = new Blob([stlData], { type: "application/octet-stream" });
    saveAs(blob, `${exportName}_deformed.stl`);

    statusDisplay.update(
      `Export successful! ${exportName}_deformed.stl`,
      false,
    );
  } catch (e) {
    console.error("STL Export Error:", e);
    statusDisplay.error("Export failed. Check console.");
  }
}

function exportSettings() {
  const activeModel = activeDeformedGeometry();
  if (!activeModel) {
    statusDisplay.error("No deformed model generated to export settings.");
    return;
  }

  const settingsName = chainResult ? chainDescription() : currentModelKey;
  statusDisplay.update(`Exporting ${settingsName} settings...`, true);

  try {
    const settingsData = {
      originalFileName: originalFileName,
      deformationType: currentModelKey,
      settings: deformParams[currentModelKey],
      preprocess: { ...preprocessSettings },
      exportDateTime: new Date().toISOString()
    };

    // A chain is recorded alongside the single-deformation fields rather than
    // instead of them, so a chain recipe still opens in an older build as the
    // deformation that happened to be selected.
    const stages = filledChainStages();
    if (stages.length > 0) {
      settingsData.chain = stages.map((stage) => ({
        deformationType: stage.key,
        settings: cloneDeformParams(stage.params)
      }));
    }

    // IDW control points are resolved at generate time by raycasting against the
    // loaded mesh, so the same seed on a different model yields different points.
    // Record what was actually used so the recipe is reproducible.
    if (currentModelKey === "idw" && idwControlPoints.length > 0) {
      settingsData.resolvedControlPoints = idwControlPoints.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z
      }));
    }

    const jsonString = JSON.stringify(settingsData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    saveAs(blob, `${settingsName}_settings.json`);

    statusDisplay.update(
      `Settings exported! ${settingsName}_settings.json`,
      false,
    );
  } catch (e) {
    console.error("Settings Export Error:", e);
    statusDisplay.error("Settings export failed. Check console.");
  }
}

function importSettingsFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      applyImportedSettings(data);
    } catch (e) {
      console.error("Settings Import Error:", e);
      statusDisplay.error("Invalid settings file.");
    }
  };
  reader.onerror = () => {
    statusDisplay.error("Failed to read settings file.");
  };
  reader.readAsText(file);
}

function applyImportedSettings(data) {
  if (!data || typeof data !== "object") {
    statusDisplay.error("Invalid settings format.");
    return;
  }

  // A chain file is handled before the single-deformation guard below, since it
  // need not carry a top-level deformationType. Files without a `chain` key —
  // every recipe written before chaining existed — fall through unchanged.
  if (Array.isArray(data.chain) && data.chain.length > 0) {
    applyImportedChain(data);
    return;
  }

  const type = data.deformationType;
  const settings = data.settings;
  if (!type || !deformParams[type] || !settings) {
    statusDisplay.error("Settings missing deformation type or values.");
    return;
  }

  deformParams[type] = { ...deformParams[type], ...settings };

  if (data.preprocess && typeof data.preprocess === "object") {
    if (typeof data.preprocess.decimate === "number") {
      preprocessSettings.decimate = data.preprocess.decimate;
    }
    if (typeof data.preprocess.mergeEpsilon === "number") {
      preprocessSettings.mergeEpsilon = data.preprocess.mergeEpsilon;
    }
  }

  // Restore the exact control points the recipe was built with, rather than
  // regenerating them against whatever mesh is currently loaded.
  let restoredPoints = 0;
  if (type === "idw" && Array.isArray(data.resolvedControlPoints)) {
    const points = data.resolvedControlPoints.filter(
      (p) =>
        p &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        Number.isFinite(p.z)
    );
    if (points.length > 0) {
      deformParams.idw.manualPoints = true;
      deformParams.idw.pointsText = points
        .map((p) => `${p.x}, ${p.y}, ${p.z}`)
        .join("\n");
      idwControlPoints = points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
      restoredPoints = points.length;
    }
  }

  // A single-deformation recipe replaces whatever chain was loaded, so the
  // imported settings are not masked by a stale chain result.
  clearChain();

  const typeRadio = document.querySelector(`input[name="type"][value="${type}"]`);
  if (typeRadio) typeRadio.checked = true;
  currentModelKey = type;
  setupControlPanels();
  syncSettingsUI(type);
  renderChainBar();

  const pointNote = restoredPoints
    ? ` Restored ${restoredPoints} control points.`
    : "";
  statusDisplay.update(`Imported settings for ${type}.${pointNote} Click 'Generate Deformation' to apply.`, false);
}

// Loads a chain recipe into the slots. Stages beyond the slot count, and any
// naming a deformation this build does not have, are dropped with a warning
// rather than failing the whole import.
function applyImportedChain(data) {
  const stages = data.chain
    .filter((stage) => stage && deformParams[stage.deformationType])
    .slice(0, CHAIN_SLOTS);

  if (stages.length === 0) {
    statusDisplay.error("Chain settings contain no known deformations.");
    return;
  }
  if (stages.length < data.chain.length) {
    console.warn(
      `Chain import: kept ${stages.length} of ${data.chain.length} stages ` +
      `(unknown deformations or more than ${CHAIN_SLOTS} slots).`
    );
  }

  if (data.preprocess && typeof data.preprocess === "object") {
    if (typeof data.preprocess.decimate === "number") {
      preprocessSettings.decimate = data.preprocess.decimate;
    }
    if (typeof data.preprocess.mergeEpsilon === "number") {
      preprocessSettings.mergeEpsilon = data.preprocess.mergeEpsilon;
    }
  }

  clearChain();
  stages.forEach((stage, i) => {
    const key = stage.deformationType;
    setChainSlot(i, key, { ...deformParams[key], ...(stage.settings || {}) });
  });

  // Point the panel at the first stage so the imported recipe is immediately
  // editable, reusing the same path the slot buttons take.
  selectChainSlot(0);

  statusDisplay.update(
    `Imported ${stages.length}-stage chain: ${chainDescription()}. ` +
    `Click 'Calculate Output' to apply.`,
    false
  );
}

function syncSettingsUI(type) {
  const params = deformParams[type] || {};
  const setRange = (inputId, valueId, value) => {
    if (value === undefined || value === null) return;
    const input = document.getElementById(inputId);
    if (!input) return;
    input.value = value;
    if (valueId) {
      const valueEl = document.getElementById(valueId);
      if (valueEl) valueEl.textContent = value;
    }
  };
  const setSelect = (inputId, value) => {
    if (value === undefined || value === null) return;
    const input = document.getElementById(inputId);
    if (!input) return;
    const option = Array.from(input.options || []).find((opt) => opt.value === value);
    if (option) input.value = value;
  };
  const setCheckbox = (inputId, value) => {
    if (value === undefined || value === null) return;
    const input = document.getElementById(inputId);
    if (input) input.checked = !!value;
  };
  const setTextarea = (inputId, value) => {
    if (value === undefined || value === null) return;
    const input = document.getElementById(inputId);
    if (input) input.value = value;
  };
  const setNumber = (inputId, valueId, value) => {
    if (value === undefined || value === null) return;
    const input = document.getElementById(inputId);
    if (!input) return;
    input.value = value;
    if (valueId) {
      const valueEl = document.getElementById(valueId);
      if (valueEl) valueEl.textContent = value;
    }
  };

  if (type === "noise") {
    setRange("noiseIntensity", "noiseIntensityVal", params.intensity);
    setRange("noiseScale", "noiseScaleVal", params.scale);
    setSelect("noiseAxis", params.axis);
    // Settings saved before the Perlin option existed carry no `type`; those
    // recipes must keep rendering as white noise.
    setSelect("noiseType", params.type ?? "white");
    setNumber("noiseSeed", "noiseSeedVal", params.seed ?? 0);
  } else if (type === "sine") {
    setRange("sineAmp", "sineAmpVal", params.amplitude);
    setRange("sineFreq", "sineFreqVal", params.frequency);
    setSelect("sineDriverAxis", params.driverAxis);
    setSelect("sineDispAxis", params.dispAxis);
  } else if (type === "pixel") {
    setRange("pixelSize", "pixelSizeVal", params.size);
    setSelect("pixelAxis", params.axis);
  } else if (type === "idw") {
    setRange("idwNumPoints", "idwNumPointsVal", params.numPoints);
    setNumber("idwSeed", "idwSeedVal", params.seed);
    setRange("idwWeight", "idwWeightVal", params.weight);
    setRange("idwPower", "idwPowerVal", params.power);
    setRange("idwScale", "idwScaleVal", params.scale);
    setRange("idwRays", "idwRaysVal", params.rays);
    setCheckbox("idwManualPoints", params.manualPoints);
    setTextarea("idwPointsInput", params.pointsText);
  } else if (type === "inflate") {
    setRange("inflateAmount", "inflateAmountVal", params.amount);
  } else if (type === "twist") {
    setRange("twistAngle", "twistAngleVal", params.angle);
    setSelect("twistAxis", params.axis);
  } else if (type === "bend") {
    setRange("bendStrength", "bendStrengthVal", params.strength);
    setSelect("bendAxis", params.axis);
  } else if (type === "ripple") {
    setRange("rippleAmp", "rippleAmpVal", params.amplitude);
    setRange("rippleFreq", "rippleFreqVal", params.frequency);
    setSelect("rippleAxis", params.axis);
  } else if (type === "warp") {
    setRange("warpStrength", "warpStrengthVal", params.strength);
    setRange("warpScale", "warpScaleVal", params.scale);
  } else if (type === "hyper") {
    setRange("hyperAmount", "hyperAmountVal", params.amount);
    setSelect("hyperAxis", params.axis);
  } else if (type === "tessellate") {
    setRange("tessellateSteps", "tessellateStepsVal", params.steps);
  } else if (type === "boundary") {
    setRange("boundaryThreshold", "boundaryThresholdVal", params.threshold);
    setRange("boundaryJitter", "boundaryJitterVal", params.jitter);
  } else if (type === "menger") {
    setRange("mengerIterations", "mengerIterationsVal", params.iterations);
    setRange("mengerKeep", "mengerKeepVal", params.keepRatio);
  } else if (type === "spherize") {
    setRange("spherizeFactor", "spherizeFactorVal", params.factor);
    setRange("spherizeRadius", "spherizeRadiusVal", params.radius);
  } else if (type === "persp") {
    setRange("perspStrength", "perspStrengthVal", params.strength);
    setSelect("perspMode", params.mode);
    setSelect("perspPlane", params.plane);
    if (params.vpMode !== undefined && params.vpMode !== null) {
      const vpRadio = document.querySelector(
        `input[name="vpMode"][value="${params.vpMode}"]`
      );
      if (vpRadio) vpRadio.checked = true;
    }
    // vp1/vp2 are plain {x,y} objects with no slider; the canvas widget is the
    // only view of them, so redraw it to reflect the imported coordinates.
    if (perspCanvasRedraw) perspCanvasRedraw();
  }

  const decimate = document.getElementById("decimate");
  if (decimate) {
    decimate.value = preprocessSettings.decimate;
    const val = document.getElementById("decimateVal");
    if (val) val.textContent = preprocessSettings.decimate;
  }
  const merge = document.getElementById("mergeEpsilon");
  if (merge) {
    merge.value = preprocessSettings.mergeEpsilon;
    const val = document.getElementById("mergeVal");
    if (val) val.textContent = preprocessSettings.mergeEpsilon;
  }
}

// --- Deformation Logic (Relies on pure THREE.js BufferGeometry functions) ---

function noiseShape(geom) {
  geom.computeBoundingBox();
  const bbox = geom.boundingBox;
  const center = new THREE.Vector3();
  // We use the center of the geometry's bounding box to calculate normalized displacement vectors
  // This helps ensure the deformation is relative to the object's shape, not world coordinates.
  bbox.getCenter(center);
  const intensity = deformParams.noise.intensity;
  const scale = deformParams.noise.scale;
  const axisMode = deformParams.noise.axis;
  const noiseType = deformParams.noise.type;
  noiseSeed = deformParams.noise.seed ?? 0;
  const positionAttribute = geom.getAttribute("position");
  for (let i = 0; i < positionAttribute.count; i++) {
    const x = positionAttribute.getX(i);
    const y = positionAttribute.getY(i);
    const z = positionAttribute.getZ(i);

    // Calculate vector from the model's center to the vertex
    const cx = x - center.x;
    const cy = y - center.y;
    const cz = z - center.z;

    const len = Math.hypot(cx, cy, cz) || 1;
    const rx = cx / len;
    const ry = cy / len;
    const rz = cz / len;

    // Noise value is calculated based on scaled coordinates relative to the object's center
    const noiseValue = sampleNoise(noiseType, cx * scale, cy * scale, cz * scale);
    const offset = (noiseValue - 0.5) * 2 * intensity; // Scale noise to (-intensity, +intensity)

    let ox = rx * offset;
    let oy = ry * offset;
    let oz = rz * offset;

    const allowX = axisMode.includes("x") || axisMode === "all";
    const allowY = axisMode.includes("y") || axisMode === "all";
    const allowZ = axisMode.includes("z") || axisMode === "all";
    if (!allowX) ox = 0;
    if (!allowY) oy = 0;
    if (!allowZ) oz = 0;

    positionAttribute.setXYZ(i, x + ox, y + oy, z + oz);
  }
  positionAttribute.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

function sineDeformShape(geom) {
  const A = deformParams.sine.amplitude;
  const f = deformParams.sine.frequency;
  const driverAxis = deformParams.sine.driverAxis;
  const dispAxis = deformParams.sine.dispAxis;
  const posAttr = geom.getAttribute("position");
  const arr = posAttr.array;
  const driverIndex = driverAxis === "x" ? 0 : driverAxis === "y" ? 1 : 2;
  const allowX = dispAxis.includes("x") || dispAxis === "all";
  const allowY = dispAxis.includes("y") || dispAxis === "all";
  const allowZ = dispAxis.includes("z") || dispAxis === "all";
  for (let i = 0; i < arr.length; i += 3) {
    const driverValue = arr[i + driverIndex];
    const displacement = Math.sin(driverValue * f) * A;
    if (allowX) arr[i] += displacement;
    if (allowY) arr[i + 1] += displacement;
    if (allowZ) arr[i + 2] += displacement;
  }
  posAttr.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

function pixelateShape(geom) {
  const pixelSize = deformParams.pixel.size;
  if (!geom || !geom.attributes || !geom.attributes.position || pixelSize <= 0) {
    console.warn("Pixelation skipped: invalid geometry or pixel size.");
    return geom;
  }
  const axisMode = deformParams.pixel.axis;
  const positionAttribute = geom.getAttribute("position");
  const arr = positionAttribute.array;
  if (!arr || arr.length === 0) {
    console.warn("Pixelation skipped: empty geometry.");
    return geom;
  }
  const allowX = axisMode.includes("x") || axisMode === "all";
  const allowY = axisMode.includes("y") || axisMode === "all";
  const allowZ = axisMode.includes("z") || axisMode === "all";
  for (let i = 0; i < arr.length; i += 3) {
    let x = arr[i];
    let y = arr[i + 1];
    let z = arr[i + 2];
    if (allowX) arr[i] = Math.round(x / pixelSize) * pixelSize;
    if (allowY) arr[i + 1] = Math.round(y / pixelSize) * pixelSize;
    if (allowZ) arr[i + 2] = Math.round(z / pixelSize) * pixelSize;
  }
  const cleanedPositions = [];
  const epsSq = 1e-10;
  for (let i = 0; i < arr.length; i += 9) {
    const v0x = arr[i],
      v0y = arr[i + 1],
      v0z = arr[i + 2];
    const v1x = arr[i + 3],
      v1y = arr[i + 4],
      v1z = arr[i + 5];
    const v2x = arr[i + 6],
      v2y = arr[i + 7],
      v2z = arr[i + 8];
    const isDegenerate =
      (v0x === v1x && v0y === v1y && v0z === v1z) ||
      (v1x === v2x && v1y === v2y && v1z === v2z) ||
      (v2x === v0x && v2y === v0y && v2z === v0z);
    if (isDegenerate) continue;
    const e1x = v1x - v0x,
      e1y = v1y - v0y,
      e1z = v1z - v0z;
    const e2x = v2x - v0x,
      e2y = v2y - v0y,
      e2z = v2z - v0z;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const area2 = nx * nx + ny * ny + nz * nz;
    if (area2 > epsSq) {
      cleanedPositions.push(v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z);
    }
  }
  if (cleanedPositions.length && cleanedPositions.length !== arr.length) {
    geom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(cleanedPositions, 3),
    );
    geom.deleteAttribute("normal");
  } else if (cleanedPositions.length === 0) {
    console.warn("Pixelation caused complete mesh collapse.");
    geom.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
    geom.deleteAttribute("normal");
  }
  const finalAttr = geom.getAttribute('position');
  finalAttr.needsUpdate = true;
  geom.computeVertexNormals();
  if (finalAttr.count > 0) {
    geom.computeBoundingBox();
    geom.computeBoundingSphere();
  }
  return geom;
}

function idwShape(geom, params = null) {
  const positionAttribute = geom.getAttribute("position");
  const arr = positionAttribute.array;
  const count = positionAttribute.count;

  const mergedParams = params || deformParams.idw;
  const controlPoints = mergedParams.controlPoints || [];
  const weight = mergedParams.weight ?? deformParams.idw.weight;
  const power = mergedParams.power ?? deformParams.idw.power;
  const scale = mergedParams.scale ?? deformParams.idw.scale;

  if (controlPoints.length === 0) {
    console.warn("No control points provided for IDW deformation");
    return geom;
  }

  // IDW deformation logic aligned with worker implementation
  for (let i = 0; i < count; i++) {
    const vx = arr[i * 3];
    const vy = arr[i * 3 + 1];
    const vz = arr[i * 3 + 2];

    let totalDisplacementX = 0;
    let totalDisplacementY = 0;
    let totalDisplacementZ = 0;

    for (const controlPoint of controlPoints) {
      const dx = controlPoint.x - vx;
      const dy = controlPoint.y - vy;
      const dz = controlPoint.z - vz;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const safeDistance = Math.max(distance, 0.001);

      const idwWeight = Math.abs(weight) / Math.pow(safeDistance, power);
      const nx = dx / safeDistance;
      const ny = dy / safeDistance;
      const nz = dz / safeDistance;

      const displacementScale = idwWeight * scale * Math.sign(weight);
      totalDisplacementX += nx * displacementScale;
      totalDisplacementY += ny * displacementScale;
      totalDisplacementZ += nz * displacementScale;
    }

    arr[i * 3] += totalDisplacementX;
    arr[i * 3 + 1] += totalDisplacementY;
    arr[i * 3 + 2] += totalDisplacementZ;
  }

  positionAttribute.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

function inflateShape(geom, params) {
  const amount = params.amount ?? 0.5;
  geom.computeBoundingBox();
  const bbox = geom.boundingBox;
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const maxRadius = Math.max(size.x, size.y, size.z) * 0.5 || 1;

  const pos = geom.getAttribute("position");
  const arr = pos.array;
  for (let i = 0; i < arr.length; i += 3) {
    const dx = arr[i] - center.x;
    const dy = arr[i + 1] - center.y;
    const dz = arr[i + 2] - center.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const scale = 1 + (amount * (dist / maxRadius));
    arr[i] = center.x + dx * scale;
    arr[i + 1] = center.y + dy * scale;
    arr[i + 2] = center.z + dz * scale;
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

function twistShape(geom, params) {
  const axes = getAxisList(params.axis);
  const angleDeg = params.angle ?? 180;
  const angle = angleDeg * (Math.PI / 180);
  const pos = geom.getAttribute("position");
  const arr = pos.array;

  for (const axis of axes) {
    geom.computeBoundingBox();
    const bbox = geom.boundingBox;
    const min = bbox.min[axis];
    const max = bbox.max[axis];
    const range = max - min || 1;

    for (let i = 0; i < arr.length; i += 3) {
      const x = arr[i], y = arr[i + 1], z = arr[i + 2];
      const t = ((axis === "x" ? x : axis === "y" ? y : z) - min) / range - 0.5;
      const theta = t * angle;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);

      if (axis === "x") {
        arr[i + 1] = y * cos - z * sin;
        arr[i + 2] = y * sin + z * cos;
      } else if (axis === "y") {
        arr[i] = x * cos - z * sin;
        arr[i + 2] = x * sin + z * cos;
      } else {
        arr[i] = x * cos - y * sin;
        arr[i + 1] = x * sin + y * cos;
      }
    }
  }

  pos.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

function bendShape(geom, params) {
  const axes = getAxisList(params.axis);
  const strength = params.strength ?? 0.8;
  const angleScale = strength * Math.PI;
  const pos = geom.getAttribute("position");
  const arr = pos.array;

  for (const axis of axes) {
    geom.computeBoundingBox();
    const bbox = geom.boundingBox;
    const min = bbox.min[axis];
    const max = bbox.max[axis];
    const range = max - min || 1;

    for (let i = 0; i < arr.length; i += 3) {
      let x = arr[i], y = arr[i + 1], z = arr[i + 2];
      const t = ((axis === "x" ? x : axis === "y" ? y : z) - min) / range - 0.5;
      const theta = t * angleScale;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);

      if (axis === "x") {
        const nx = x * cos - y * sin;
        const ny = x * sin + y * cos;
        x = nx; y = ny;
      } else if (axis === "y") {
        const ny = y * cos - z * sin;
        const nz = y * sin + z * cos;
        y = ny; z = nz;
      } else {
        const nx = x * cos - z * sin;
        const nz = x * sin + z * cos;
        x = nx; z = nz;
      }

      arr[i] = x;
      arr[i + 1] = y;
      arr[i + 2] = z;
    }
  }

  pos.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

function rippleShape(geom, params) {
  const axes = getAxisList(params.axis);
  const amplitude = params.amplitude ?? 4;
  const frequency = params.frequency ?? 0.3;
  const pos = geom.getAttribute("position");
  const arr = pos.array;

  for (const axis of axes) {
    geom.computeBoundingBox();
    const bbox = geom.boundingBox;
    const center = new THREE.Vector3();
    bbox.getCenter(center);

    for (let i = 0; i < arr.length; i += 3) {
      const x = arr[i], y = arr[i + 1], z = arr[i + 2];
      let r = 0;
      if (axis === "x") {
        r = Math.sqrt((y - center.y) ** 2 + (z - center.z) ** 2);
        arr[i] = x + Math.sin(r * frequency) * amplitude;
      } else if (axis === "y") {
        r = Math.sqrt((x - center.x) ** 2 + (z - center.z) ** 2);
        arr[i + 1] = y + Math.sin(r * frequency) * amplitude;
      } else {
        r = Math.sqrt((x - center.x) ** 2 + (y - center.y) ** 2);
        arr[i + 2] = z + Math.sin(r * frequency) * amplitude;
      }
    }
  }

  pos.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

function warpShape(geom, params) {
  const strength = params.strength ?? 1.0;
  const scale = params.scale ?? 0.2;
  const pos = geom.getAttribute("position");
  const arr = pos.array;
  for (let i = 0; i < arr.length; i += 3) {
    const x = arr[i], y = arr[i + 1], z = arr[i + 2];
    arr[i] = x + Math.sin(y * scale) * strength;
    arr[i + 1] = y + Math.sin(z * scale) * strength;
    arr[i + 2] = z + Math.sin(x * scale) * strength;
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

function hyperShape(geom, params) {
  const axes = getAxisList(params.axis);
  const amount = params.amount ?? 0.6;
  const pos = geom.getAttribute("position");
  const arr = pos.array;

  for (const axis of axes) {
    geom.computeBoundingBox();
    const bbox = geom.boundingBox;
    const min = bbox.min[axis];
    const max = bbox.max[axis];
    const range = max - min || 1;
    const center = (min + max) * 0.5;
    const denom = Math.sinh(amount) || 1;

    for (let i = 0; i < arr.length; i += 3) {
      let v = axis === "x" ? arr[i] : axis === "y" ? arr[i + 1] : arr[i + 2];
      const t = (v - center) / range;
      const stretched = Math.sinh(t * amount) / denom;
      v = center + stretched * range;
      if (axis === "x") arr[i] = v;
      else if (axis === "y") arr[i + 1] = v;
      else arr[i + 2] = v;
    }
  }

  pos.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

function boundaryDisruptShape(geom, params) {
  const threshold = params.threshold ?? 0.08;
  const jitter = params.jitter ?? 2.0;
  geom.computeBoundingBox();
  const bbox = geom.boundingBox;
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const epsX = size.x * threshold;
  const epsY = size.y * threshold;
  const epsZ = size.z * threshold;
  const pos = geom.getAttribute("position");
  const arr = pos.array;
  const hash = (x, y, z) =>
    Math.abs(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453) % 1;

  for (let i = 0; i < arr.length; i += 3) {
    const x = arr[i], y = arr[i + 1], z = arr[i + 2];
    const near =
      Math.abs(x - bbox.min.x) < epsX || Math.abs(x - bbox.max.x) < epsX ||
      Math.abs(y - bbox.min.y) < epsY || Math.abs(y - bbox.max.y) < epsY ||
      Math.abs(z - bbox.min.z) < epsZ || Math.abs(z - bbox.max.z) < epsZ;
    if (!near) continue;
    const rx = (hash(x, y, z) - 0.5) * 2;
    const ry = (hash(y, z, x) - 0.5) * 2;
    const rz = (hash(z, x, y) - 0.5) * 2;
    arr[i] = x + rx * jitter;
    arr[i + 1] = y + ry * jitter;
    arr[i + 2] = z + rz * jitter;
  }

  pos.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

function spherizeShape(geom) {
  const factor = deformParams.spherize.factor ?? 0.5;
  let radius = deformParams.spherize.radius ?? 0;
  const pos = geom.getAttribute("position");
  const arr = pos.array;

  geom.computeBoundingBox();
  const bbox = geom.boundingBox;
  const cx = (bbox.min.x + bbox.max.x) * 0.5;
  const cy = (bbox.min.y + bbox.max.y) * 0.5;
  const cz = (bbox.min.z + bbox.max.z) * 0.5;

  if (radius <= 0) {
    const sx = bbox.max.x - bbox.min.x;
    const sy = bbox.max.y - bbox.min.y;
    const sz = bbox.max.z - bbox.min.z;
    radius = Math.max(sx, sy, sz) * 0.5;
  }

  for (let i = 0; i < arr.length; i += 3) {
    const dx = arr[i] - cx;
    const dy = arr[i + 1] - cy;
    const dz = arr[i + 2] - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-8;
    const target = dist + (radius - dist) * factor;
    const scale = target / dist;
    arr[i]     = cx + dx * scale;
    arr[i + 1] = cy + dy * scale;
    arr[i + 2] = cz + dz * scale;
  }

  pos.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

function perspVpTo3D(vp, plane) {
  if (plane === "XZ") return { x: vp.x, y: 0, z: vp.y };
  if (plane === "YZ") return { x: 0, y: vp.x, z: vp.y };
  return { x: vp.x, y: vp.y, z: 0 }; // XY default
}

// Largest absolute projection of any vertex onto `dir`, measured from the
// centre. This is the normalization basis for the perspective distortion and
// must always be computed over the entire mesh — see perspApplyVP in worker.js.
function perspComputeProjMax(arr, cx, cy, cz, dir) {
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
  if (len < 1e-6) return 0;
  const nx = dir.x / len, ny = dir.y / len, nz = dir.z / len;

  let projMax = 0;
  for (let i = 0; i < arr.length; i += 3) {
    const p = (arr[i] - cx) * nx + (arr[i + 1] - cy) * ny + (arr[i + 2] - cz) * nz;
    if (Math.abs(p) > projMax) projMax = Math.abs(p);
  }
  return projMax;
}

// Worker twin: perspApplyVP in worker.js. Unlike the worker version this one
// always sees the whole mesh, so projMax is optional and derived when absent.
function perspApplyVP(arr, cx, cy, cz, dir, strength, mode, projMax) {
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
  if (len < 1e-6) return;
  const nx = dir.x / len, ny = dir.y / len, nz = dir.z / len;

  if (projMax === undefined) {
    projMax = perspComputeProjMax(arr, cx, cy, cz, dir);
  }
  if (!projMax) return;

  for (let i = 0; i < arr.length; i += 3) {
    const proj = (arr[i] - cx) * nx + (arr[i + 1] - cy) * ny + (arr[i + 2] - cz) * nz;
    const t = proj / projMax;
    const scale = mode === "exponential" ? strength * t * t : strength * t;
    arr[i]     += nx * scale * projMax;
    arr[i + 1] += ny * scale * projMax;
    arr[i + 2] += nz * scale * projMax;
  }
}

function perspShape(geom) {
  const { strength, mode, plane, vpMode, vp1, vp2 } = deformParams.persp;

  geom.computeBoundingBox();
  const center = new THREE.Vector3();
  geom.boundingBox.getCenter(center);

  const pos = geom.getAttribute("position");
  const arr = pos.array;

  const dir1 = perspVpTo3D(vp1, plane);
  perspApplyVP(arr, center.x, center.y, center.z, dir1, strength ?? 0.5, mode ?? "linear");

  if ((vpMode ?? 1) === 2) {
    const dir2 = perspVpTo3D(vp2, plane);
    perspApplyVP(arr, center.x, center.y, center.z, dir2, strength ?? 0.5, mode ?? "linear");
  }

  pos.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

// Global storage for IDW control points
let idwControlPoints = [];

function parseManualControlPoints(text) {
  if (!text || !text.trim()) return [];
  const lines = text.split(/\n|;/);
  const points = [];
  for (const line of lines) {
    const cleaned = line.trim();
    if (!cleaned) continue;
    const parts = cleaned.split(/[, ]+/).map((v) => parseFloat(v)).filter((v) => !Number.isNaN(v));
    if (parts.length >= 3) {
      points.push({ x: parts[0], y: parts[1], z: parts[2] });
    }
  }
  return points;
}

// Generate IDW control points using Poisson disk sampling
// Places control points inside a mesh's volume by raycasting against it.
//
// `sourceGeometry` defaults to the loaded model, which is what the
// single-deformation path wants. A chained stage passes the geometry produced by
// the stage before it, so the points land inside the mesh actually being
// deformed rather than inside the original.
function generateIDWControlPoints(sourceGeometry = originalGeometry) {
  if (!sourceGeometry) {
    console.warn('No geometry available for control point generation');
    return [];
  }
  // An intermediate chain geometry may not have had its bounds computed yet.
  if (!sourceGeometry.boundingBox) {
    if (typeof sourceGeometry.computeBoundingBox === "function") {
      sourceGeometry.computeBoundingBox();
    }
    if (!sourceGeometry.boundingBox) {
      console.warn('No geometry available for control point generation');
      return [];
    }
  }

  const bbox = sourceGeometry.boundingBox;
  const sizeX = bbox.max.x - bbox.min.x;
  const sizeY = bbox.max.y - bbox.min.y;
  const sizeZ = bbox.max.z - bbox.min.z;
  const maxDimension = Math.max(sizeX, sizeY, sizeZ);

  // Minimum distance between points (adaptive to model size, smaller for more points)
  const minDistance = maxDimension * 0.08; // 8% of largest dimension for denser packing
  const maxSamples = deformParams.idw.numPoints;

  // Create sampler with current seed
  const sampler = new PoissonSampler(deformParams.idw.seed);

  // Generate MANY more candidates to ensure we find enough inside points
  let samples = sampler.generateSamples(minDistance, maxSamples * 10, bbox); // Generate 10x more candidates

  // Filter to only include points inside the mesh volume
  const insideSamples = sampler.filterInsideVolume(
    samples,
    sourceGeometry,
    deformParams.idw.rays
  );

  console.log(`Generated ${samples.length} candidates, found ${insideSamples.length} inside mesh volume`);

  // If we still don't have enough inside samples, try with smaller minimum distance
  let controlPoints = [...insideSamples];
  if (controlPoints.length < maxSamples) {
    console.warn(`Only found ${controlPoints.length} points inside mesh volume, trying with smaller spacing...`);
    const smallerMinDistance = minDistance * 0.5;
    const additionalSamples = sampler.generateSamples(smallerMinDistance, maxSamples * 5, bbox);
    const additionalInside = sampler.filterInsideVolume(
      additionalSamples,
      sourceGeometry,
      deformParams.idw.rays
    );
    controlPoints = [...new Set([...controlPoints, ...additionalInside])]; // Remove duplicates
  }

  // Take up to the requested number of points
  controlPoints = controlPoints.slice(0, maxSamples);

  // If still not enough, add fallback points distributed throughout the volume
  while (controlPoints.length < maxSamples) {
    // Create points at different depths within the mesh
    const depth = (controlPoints.length / maxSamples) * 0.8 + 0.1; // 0.1 to 0.9 depth
    const centerX = (bbox.min.x + bbox.max.x) * 0.5;
    const centerY = (bbox.min.y + bbox.max.y) * 0.5;
    const centerZ = (bbox.min.z + bbox.max.z) * 0.5;

    // Add random offset scaled by depth
    const offsetScale = maxDimension * depth * 0.3;
    const random1 = Math.sin(deformParams.idw.seed + controlPoints.length * 123.45) * 0.5 + 0.5;
    const random2 = Math.sin(deformParams.idw.seed + controlPoints.length * 678.90) * 0.5 + 0.5;
    const random3 = Math.sin(deformParams.idw.seed + controlPoints.length * 111.11) * 0.5 + 0.5;
    const fallbackPoint = {
      x: centerX + (random1 - 0.5) * offsetScale,
      y: centerY + (random2 - 0.5) * offsetScale,
      z: centerZ + (random3 - 0.5) * offsetScale
    };

    controlPoints.push(fallbackPoint);
    if (controlPoints.length >= maxSamples) break;
  }

  idwControlPoints = controlPoints;
  console.log(`Final: ${controlPoints.length} IDW control points for deformation`);
  return controlPoints;
}

// Start the application. Guarded so that importing this module for tests does
// not boot the app: there is no document under Node, and the test harness sets
// __STLSHAPER_TEST__ before importing when a DOM is present via jsdom.
if (typeof document !== "undefined" && !globalThis.__STLSHAPER_TEST__) {
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}

export {
  // Bootstrap
  init,
  // STL I/O
  LocalSTLLoader,
  LocalSTLExporter,
  createSTLLoader,
  createSTLExporter,
  parseSTL,
  exportSTL,
  // Noise
  simpleHash,
  noise,
  perlinFade,
  perlinLatticeValue,
  perlinNoise,
  perlinFractal,
  sampleNoise,
  // Geometry helpers
  normalizeGeometry,
  ensureGeometryNormals,
  getAxisList,
  getGeometryStats,
  resetDeformedGeometries,
  // Preprocessing and topology
  applyPreprocess,
  decimateGeometry,
  mergeVerticesGeometry,
  applyTopologyDeformation,
  tessellateGeometry,
  mengerCarveGeometry,
  // Deformations (main-thread twins)
  noiseShape,
  sineDeformShape,
  pixelateShape,
  idwShape,
  inflateShape,
  twistShape,
  bendShape,
  rippleShape,
  warpShape,
  hyperShape,
  boundaryDisruptShape,
  spherizeShape,
  perspVpTo3D,
  perspComputeProjMax,
  perspApplyVP,
  perspShape,
  // Scene and disposal
  disposeMeshMaterial,
  disposeUnreferencedGeometry,
  setMeshGeometry,
  updateCameraForGeometry,
  resetViewToCurrentGeometry,
  updateSceneMeshes,
  updateControlPointVisualization,
  hideProgressBar,
  // Model scale
  checkModelScale,
  applyModelScale,
  updateAdaptiveParameterRanges,
  // Settings
  exportSettings,
  importSettingsFromFile,
  applyImportedSettings,
  applyImportedChain,
  syncSettingsUI,
  // Deformation chain
  runDeformation,
  runChain,
  activeDeformedGeometry,
  projectChainTriangles,
  findChainOverflow,
  stageGrowthFactor,
  cloneDeformParams,
  setChainSlot,
  clearChain,
  chainDescription,
  filledChainStages,
  selectChainSlot,
  renderChainBar,
  deformationChain,
  CHAIN_SLOTS,
  MAX_CHAIN_TRIANGLES,
  // IDW
  parseManualControlPoints,
  generateIDWControlPoints,
  PoissonSampler,
  // UI wiring
  setupControlPanels,
  setupParameterControls,
  setupPerspCanvas,
  setupListeners,
  clearModelAndUI,
  loadDefaultSTL,
  updateStats,
  // Worker pool
  WorkerPool,
  // State accessors — the module's mutable globals are not directly importable
  // as live bindings in a useful way, so expose them through functions.
  deformParams,
  deformationRegistry,
  preprocessSettings,
};

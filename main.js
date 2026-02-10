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
        normals.push(nx, ny, nz, nx, ny, nz);
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
// NOTE: For true Perlin/Simplex noise quality, you should use a library like 'simplex-noise.js'
// or another THREE.js compatible noise implementation instead of this basic placeholder.
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

// --- THREE.js Core Variables ---
let scene, camera, renderer, controls;
let axisScene, axisCamera, axisHelper, axisLabels;
const AXIS_VIEWPORT_SIZE = 160;
const AXIS_MARGIN = 16;
const AXIS_CAMERA_DISTANCE = 3.2;
let container = document.getElementById("container");

// Core model storage
let originalGeometry;
// deformedGeometries holds the *result* of the deformation process
let deformedGeometries = {};
let currentModelKey = "noise";
let originalFileName = null; // Track original file name for settings export

// UI elements and parameters
let processBtn, statusElement, exportBtn, toggleView, renderMode, clearBtn, statsElement;
let meshGroup; // Group to hold the visible THREE.js meshes
let solidMesh = null;
let wireMesh = null;
let lastGeometryForView = null;

let workerPool; // Worker pool for parallel processing

let deformParams = {
  noise: { intensity: 1.5, scale: 0.02, axis: "all" },
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
  menger: { iterations: 1, keepRatio: 0.7 }
};

const preprocessSettings = {
  decimate: 100,
  mergeEpsilon: 0
};

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
  { key: "menger", label: "Menger Sponge", controlsId: "mengerControls", usesWorker: false }
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

    // Create a temporary mesh for ray casting
    const tempMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());

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
    this.initializeWorkers();
  }

  initializeWorkers() {
    // Create workers based on CPU cores (max 8 to avoid overwhelming)
    const workerCount = Math.min(navigator.hardwareConcurrency || 4, 8);

    for (let i = 0; i < workerCount; i++) {
      try {
        const worker = new Worker('worker.js');
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
      // Continue with other workers
      worker.isBusy = false;
      this.availableWorkers.push(worker);
      this.processNextTask();
    }
  }

  handleWorkerError(e, worker) {
    console.error('Worker error:', e);
    worker.isBusy = false;
    this.availableWorkers.push(worker);
    this.processNextTask();
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
      this.isProcessing = true;
      this.results = {};
      this.completedChunks = 0;

      // Get vertices from geometry
      const positionAttribute = geometry.getAttribute('position');
      const vertices = positionAttribute.array.slice(); // Copy array
      const bbox = geometry.boundingBox;
      this.indexArray = geometry.index ? geometry.index.array.slice() : null;
      this.indexType = geometry.index ? geometry.index.array.constructor : null;

      // Split vertices into chunks
      const chunks = this.chunkVertices(vertices, this.chunkSize);
      this.totalChunks = chunks.length;

      // Create tasks for each chunk
      this.pendingTasks = chunks.map((chunk, index) => ({
        chunkId: index,
        vertices: chunk.vertices,
        startIndex: chunk.startIndex,
        deformationType,
        params,
        bbox
      }));

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
      chunks.push({
        vertices: chunkVertices,
        startIndex: i / 3 // Convert back to vertex index
      });
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
      const chunkVertices = this.results[chunkId];
      if (!chunkVertices) {
        console.warn(`Missing chunk ${chunkId} during deformation; leaving zeros.`);
        continue;
      }
      const startIndex = chunkId * this.chunkSize * 3;
      finalVertices.set(chunkVertices, startIndex);
    }

    // Update geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(finalVertices, 3));
    if (this.indexArray && this.indexType) {
      if (this.indexType === Array) {
        geometry.setIndex(this.indexArray);
      } else {
        geometry.setIndex(new this.indexType(this.indexArray));
      }
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    this.isProcessing = false;
    if (this.onComplete) {
      this.onComplete(geometry);
    }
  }

  fallbackDeformation(deformationType, params, geometry) {
    // Single-threaded fallback using original functions
    const geom = geometry.clone();

    if (deformationType === "noise") {
      return noiseShape(geom);
    } else if (deformationType === "sine") {
      return sineDeformShape(geom);
    } else if (deformationType === "pixel") {
      return pixelateShape(geom);
    } else if (deformationType === "idw") {
      return idwShape(geom, params);
    } else if (deformationType === "inflate") {
      return inflateShape(geom, params);
    } else if (deformationType === "twist") {
      return twistShape(geom, params);
    } else if (deformationType === "bend") {
      return bendShape(geom, params);
    } else if (deformationType === "ripple") {
      return rippleShape(geom, params);
    } else if (deformationType === "warp") {
      return warpShape(geom, params);
    } else if (deformationType === "hyper") {
      return hyperShape(geom, params);
    } else if (deformationType === "boundary") {
      return boundaryDisruptShape(geom, params);
    }

    return geom;
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
        originalGeometry && deformedGeometries[currentModelKey]
      );

    // Export Settings button has the same conditions as Export button
    const exportSettingsBtn = document.getElementById("exportSettingsBtn");
    if (exportSettingsBtn)
      exportSettingsBtn.disabled = !(
        originalGeometry && deformedGeometries[currentModelKey]
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
  scene.background = new THREE.Color(0x1a1a1a);

  // CAMERA
  camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
  camera.position.set(0, 0, 200);

  // RENDERER
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.autoClear = false;
  container.appendChild(renderer.domElement);

  // CONTROLS FIX: Check for global OrbitControls or THREE.OrbitControls
  const OrbitControlsClass = window.OrbitControls || THREE.OrbitControls;
  if (!OrbitControlsClass) {
    console.error(
      "OrbitControls class not found. Ensure 'libraries/OrbitControls.js' is loaded correctly and is not an ES Module version.",
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
    document.getElementById("idwWeightVal").textContent = deformParams.idw.weight;
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
    document.getElementById("idwScaleVal").textContent = deformParams.idw.scale;
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
  // Clear any old deformed models when a new file is loaded
  resetDeformedGeometries();

  // Update adaptive parameter ranges based on model size
  updateAdaptiveParameterRanges();
  updateStats(originalGeometry, null, null);

  console.log(
    "STL Loaded. Vertices:",
    originalGeometry.attributes.position.count,
  );
}

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

async function generateCurrent() {
  if (!originalGeometry) return;

  try {
    statusDisplay.update(`Processing ${currentModelKey} deformation...`, true);

    const defEntry = deformationRegistry.find((entry) => entry.key === currentModelKey);
    if (!defEntry) {
      statusDisplay.error("Unknown deformation type.");
      return;
    }

    // Preprocess geometry if requested
    let workingGeometry = applyPreprocess(originalGeometry);

    // Special handling for IDW: generate control points
    let params = { ...deformParams[currentModelKey] };
    if (currentModelKey === 'idw') {
      let controlPoints = [];
      if (deformParams.idw.manualPoints) {
        controlPoints = parseManualControlPoints(deformParams.idw.pointsText);
        if (controlPoints.length === 0) {
          console.warn("Manual control points empty; falling back to auto-generated points.");
        }
      }
      if (controlPoints.length === 0) {
        controlPoints = generateIDWControlPoints();
      }
      idwControlPoints = controlPoints;
      params.controlPoints = controlPoints;
      console.log(`Using ${controlPoints.length} control points for IDW deformation`);
    }

    const startTime = performance.now();

    // Topology-changing methods are handled on main thread
    if (!defEntry.usesWorker) {
      const topologyGeometry = applyTopologyDeformation(currentModelKey, params, workingGeometry);
      ensureGeometryNormals(topologyGeometry);
      deformedGeometries[currentModelKey] = topologyGeometry;
      const elapsed = performance.now() - startTime;
      updateStats(originalGeometry, topologyGeometry, elapsed);
      statusDisplay.update(`Generated ${currentModelKey} deformation successfully.`, false);
      return;
    }

    // Set up progress callback
    workerPool.setProgressCallback((completed, total) => {
      const progress = Math.round((completed / total) * 100);
      statusDisplay.update(`Processing ${currentModelKey} deformation... ${progress}%`, true);
    });

    // Store original vertex count for worker pool
    workerPool.originalVertexCount = workingGeometry.attributes.position.count * 3;

    // Use worker pool for parallel processing
    const deformedGeometry = await workerPool.deformVertices(
      currentModelKey,
      params,
      workingGeometry
    );

    // Store the result
    ensureGeometryNormals(deformedGeometry);
    deformedGeometries[currentModelKey] = normalizeGeometry(deformedGeometry);
    const elapsed = performance.now() - startTime;
    updateStats(originalGeometry, deformedGeometry, elapsed);

    statusDisplay.update(`Generated ${currentModelKey} deformation successfully.`, false);

  } catch (error) {
    console.error('Deformation error:', error);
    statusDisplay.error('Error generating deformation.');
  }
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
  const deformedExists = deformedGeometries[currentModelKey];
  const geometryToDraw = showDeformed && deformedExists ? deformedExists : originalGeometry;
  if (!geometryToDraw) return;
  updateCameraForGeometry(geometryToDraw, true);
}

function updateSceneMeshes() {
  // Determine which geometry to show
  const showDeformed = toggleView.checked;
  const deformedExists = deformedGeometries[currentModelKey];

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
      solidMesh.geometry = geometryToDraw;
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
      wireMesh.geometry = geometryToDraw;
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
  const activeModel = deformedGeometries[currentModelKey];
  if (!activeModel) {
    statusDisplay.error("No deformed model generated to export.");
    return;
  }
  statusDisplay.update(`Exporting ${currentModelKey} model...`, true);
  try {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(activeModel);
    scene.add(mesh);
    const exporter = createSTLExporter();
    const stlString = exporter.parse(scene, { binary: false });

    const blob = new Blob([stlString], { type: "text/plain" });
    saveAs(blob, `${currentModelKey}_deformed.stl`);

    statusDisplay.update(
      `Export successful! ${currentModelKey}_deformed.stl`,
      false,
    );
  } catch (e) {
    console.error("STL Export Error:", e);
    statusDisplay.error("Export failed. Check console.");
  }
}

function exportSettings() {
  const activeModel = deformedGeometries[currentModelKey];
  if (!activeModel) {
    statusDisplay.error("No deformed model generated to export settings.");
    return;
  }

  statusDisplay.update(`Exporting ${currentModelKey} settings...`, true);

  try {
    const settingsData = {
      originalFileName: originalFileName,
      deformationType: currentModelKey,
      settings: deformParams[currentModelKey],
      preprocess: { ...preprocessSettings },
      exportDateTime: new Date().toISOString()
    };

    const jsonString = JSON.stringify(settingsData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    saveAs(blob, `${currentModelKey}_settings.json`);

    statusDisplay.update(
      `Settings exported! ${currentModelKey}_settings.json`,
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

  const typeRadio = document.querySelector(`input[name="type"][value="${type}"]`);
  if (typeRadio) typeRadio.checked = true;
  currentModelKey = type;
  setupControlPanels();
  syncSettingsUI(type);

  statusDisplay.update(`Imported settings for ${type}. Click 'Generate Deformation' to apply.`, false);
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
    const noiseValue = noise(cx * scale, cy * scale, cz * scale);
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
  const initialLength = arr.length;
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
  for (let i = 0; i < initialLength; i += 9) {
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
  if (cleanedPositions.length && cleanedPositions.length !== initialLength) {
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
  positionAttribute.needsUpdate = true;
  geom.computeVertexNormals();
  if (positionAttribute.count > 0) {
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
    const r = (hash(x, y, z) - 0.5) * 2;
    arr[i] = x + r * jitter;
    arr[i + 1] = y + r * jitter;
    arr[i + 2] = z + r * jitter;
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
function generateIDWControlPoints() {
  if (!originalGeometry || !originalGeometry.boundingBox) {
    console.warn('No geometry available for control point generation');
    return [];
  }

  const bbox = originalGeometry.boundingBox;
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
    originalGeometry,
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
      originalGeometry,
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

// Start the application
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// --- STLLoader and STLExporter from THREE.js Examples (Preserved) ---

THREE.STLLoader = class STLLoader {
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
};

THREE.STLExporter = class STLExporter {
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
};

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
let container = document.getElementById("container");

// Core model storage
let originalGeometry;
// deformedGeometries holds the *result* of the deformation process
let deformedGeometries = { noise: null, sine: null, pixel: null, idw: null };
let currentModelKey = "noise";
let originalFileName = null; // Track original file name for settings export

// UI elements and parameters
let processBtn, statusElement, exportBtn, toggleView, renderMode, clearBtn;
let meshGroup; // Group to hold the visible THREE.js meshes

let workerPool; // Worker pool for parallel processing

let deformParams = {
  noise: { intensity: 1.5, scale: 0.02, axis: "all" },
  sine: { amplitude: 15, frequency: 0.05, driverAxis: "x", dispAxis: "x" },
  pixel: { size: 5, axis: "all" },
  idw: { numPoints: 8, seed: 0, weight: 2.0, power: 2.0, scale: 2.0 }
};

// --- Poisson Disk Sampling for IDW Control Points ---
class PoissonSampler {
  constructor(seed = 0) {
    this.seed = seed;
    this.random = this.seededRandom(seed);
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
  filterInsideVolume(samples, geometry) {
    const insideSamples = [];

    // Create a temporary mesh for ray casting
    const tempMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());

    for (const sample of samples) {
      if (this.isPointInsideMesh(sample, tempMesh)) {
        insideSamples.push(sample);
      }
    }

    return insideSamples;
  }

  // Use ray casting to determine if a point is inside the mesh
  isPointInsideMesh(point, mesh) {
    const raycaster = new THREE.Raycaster();
    const directions = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
      // Additional diagonal rays for better accuracy
      new THREE.Vector3(1, 1, 1).normalize(),
      new THREE.Vector3(-1, 1, 1).normalize(),
      new THREE.Vector3(1, -1, 1).normalize(),
      new THREE.Vector3(1, 1, -1).normalize()
    ];

    let insideCount = 0;
    const totalDirections = directions.length;

    for (const direction of directions) {
      raycaster.set(new THREE.Vector3(point.x, point.y, point.z), direction);
      const intersects = raycaster.intersectObject(mesh);

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
      const startIndex = chunkId * this.chunkSize * 3;
      finalVertices.set(chunkVertices, startIndex);
    }

    // Update geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(finalVertices, 3));
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

function init() {
  container = document.getElementById("container");
  const width = window.innerWidth;
  const height = window.innerHeight;

  // --- CRITICAL FIX: Get UI elements first before any potential error calls ---
  processBtn = document.getElementById("processBtn");
  statusElement = document.getElementById("status");
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
  renderer.render(scene, camera);
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

  // Clear Button
  if (clearBtn) {
    clearBtn.onclick = () => {
      clearModelAndUI();
    };
  }

  // View Controls
  toggleView.addEventListener("change", updateSceneMeshes);
  renderMode.addEventListener("change", updateSceneMeshes);
}

function clearModelAndUI() {
  // Reset geometries
  originalGeometry = null;
  deformedGeometries = { noise: null, sine: null, pixel: null, idw: null };
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
}

function loadDefaultSTL() {
  const defaultPath = "JustBones617_0_resaved_1_NIH3D.stl";
  const loader = new THREE.STLLoader();
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
        originalGeometry.computeBoundingSphere();
        // Reset any previous deformations
        deformedGeometries = { noise: null, sine: null, pixel: null, idw: null };
        originalFileName = defaultPath; // Set default file name

        // Update adaptive parameter ranges based on model size
        updateAdaptiveParameterRanges();

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
  document.getElementById("noiseControls").style.display =
    currentModelKey === "noise" ? "block" : "none";
  document.getElementById("sineControls").style.display =
    currentModelKey === "sine" ? "block" : "none";
  document.getElementById("pixelControls").style.display =
    currentModelKey === "pixel" ? "block" : "none";
  document.getElementById("idwControls").style.display =
    currentModelKey === "idw" ? "block" : "none";

  // Update control point visualization
  updateControlPointVisualization();
}

function setupParameterControls() {
  // Parameter controls ONLY change the parameter value and label.
  // They do NOT automatically trigger a re-generation.
  const updateHandler = (key) => {
    if (originalGeometry && currentModelKey === key) {
      // Update UI/Status to tell the user to click the button
      statusDisplay.update(
        `Parameters updated. Click 'Generate Deformation' to apply.`,
        false,
      );
    }
  };

  // NOISE CONTROLS
  document.getElementById("noiseIntensity").addEventListener("input", (e) => {
    deformParams.noise.intensity = parseFloat(e.target.value);
    document.getElementById("noiseIntensityVal").textContent = e.target.value;
    updateHandler("noise");
  });
  document.getElementById("noiseScale").addEventListener("input", (e) => {
    deformParams.noise.scale = parseFloat(e.target.value);
    document.getElementById("noiseScaleVal").textContent = e.target.value;
    updateHandler("noise");
  });
  document.getElementById("noiseAxis").addEventListener("change", (e) => {
    deformParams.noise.axis = e.target.value;
    updateHandler("noise");
  });

  // SINE CONTROLS
  document.getElementById("sineAmp").addEventListener("input", (e) => {
    deformParams.sine.amplitude = parseFloat(e.target.value);
    document.getElementById("sineAmpVal").textContent = e.target.value;
    updateHandler("sine");
  });
  document.getElementById("sineFreq").addEventListener("input", (e) => {
    deformParams.sine.frequency = parseFloat(e.target.value);
    document.getElementById("sineFreqVal").textContent = e.target.value;
    updateHandler("sine");
  });
  document.getElementById("sineDriverAxis").addEventListener("change", (e) => {
    deformParams.sine.driverAxis = e.target.value;
    updateHandler("sine");
  });
  document.getElementById("sineDispAxis").addEventListener("change", (e) => {
    deformParams.sine.dispAxis = e.target.value;
    updateHandler("sine");
  });

  // PIXEL CONTROLS
  document.getElementById("pixelSize").addEventListener("input", (e) => {
    deformParams.pixel.size = parseFloat(e.target.value);
    document.getElementById("pixelSizeVal").textContent = e.target.value;
    updateHandler("pixel");
  });
  document.getElementById("pixelAxis").addEventListener("change", (e) => {
    deformParams.pixel.axis = e.target.value;
    updateHandler("pixel");
  });

  // IDW CONTROLS
  document.getElementById("idwNumPoints").addEventListener("input", (e) => {
    deformParams.idw.numPoints = parseInt(e.target.value);
    document.getElementById("idwNumPointsVal").textContent = e.target.value;
    updateHandler("idw");
  });
  document.getElementById("idwSeed").addEventListener("input", (e) => {
    const seedValue = parseInt(e.target.value) || 0;
    deformParams.idw.seed = Math.max(0, Math.min(10000, seedValue)); // Clamp to valid range
    e.target.value = deformParams.idw.seed; // Update input value
    document.getElementById("idwSeedVal").textContent = deformParams.idw.seed;
    updateHandler("idw");
  });
  document.getElementById("idwWeight").addEventListener("input", (e) => {
    deformParams.idw.weight = parseFloat(e.target.value);
    document.getElementById("idwWeightVal").textContent = e.target.value;
    updateHandler("idw");
  });
  document.getElementById("idwPower").addEventListener("input", (e) => {
    deformParams.idw.power = parseFloat(e.target.value);
    document.getElementById("idwPowerVal").textContent = e.target.value;
    updateHandler("idw");
  });
  document.getElementById("idwScale").addEventListener("input", (e) => {
    deformParams.idw.scale = parseFloat(e.target.value);
    document.getElementById("idwScaleVal").textContent = e.target.value;
    updateHandler("idw");
  });
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
  const loader = new THREE.STLLoader();
  originalGeometry = loader.parse(arrayBuffer);

  originalGeometry.computeBoundingBox();
  // FIX: Center the geometry so it sits at the world origin (0,0,0)
  originalGeometry.center();

  originalGeometry.computeBoundingSphere();
  // Clear any old deformed models when a new file is loaded
  deformedGeometries = { noise: null, sine: null, pixel: null, idw: null };

  // Update adaptive parameter ranges based on model size
  updateAdaptiveParameterRanges();

  console.log(
    "STL Loaded. Vertices:",
    originalGeometry.attributes.position.count,
  );
}

async function generateCurrent() {
  if (!originalGeometry) return;

  try {
    statusDisplay.update(`Processing ${currentModelKey} deformation...`, true);

    // Special handling for IDW: generate control points
    let params = { ...deformParams[currentModelKey] };
    if (currentModelKey === 'idw') {
      const controlPoints = generateIDWControlPoints();
      params.controlPoints = controlPoints;
      console.log(`Using ${controlPoints.length} control points for IDW deformation`);
    }

    // Set up progress callback
    workerPool.setProgressCallback((completed, total) => {
      const progress = Math.round((completed / total) * 100);
      statusDisplay.update(`Processing ${currentModelKey} deformation... ${progress}%`, true);
    });

    // Store original vertex count for worker pool
    workerPool.originalVertexCount = originalGeometry.attributes.position.count * 3;

    // Use worker pool for parallel processing
    const deformedGeometry = await workerPool.deformVertices(
      currentModelKey,
      params,
      originalGeometry
    );

    // Store the result
    deformedGeometries[currentModelKey] = deformedGeometry;

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

function updateSceneMeshes() {
  // Clears the mesh group using compatibility loop
  const controlPointSet = new Set(controlPointMeshes);
  while (meshGroup.children.length > 0) {
    const child = meshGroup.children[0];
    if (child && child.isMesh && !controlPointSet.has(child)) {
      disposeMeshMaterial(child);
    }
    meshGroup.remove(child);
  }

  // Determine which geometry to show
  const showDeformed = toggleView.checked;
  const deformedExists = deformedGeometries[currentModelKey];

  // Show original if no deformed model exists or if toggle is off
  let geometryToDraw = originalGeometry;
  if (showDeformed && deformedExists) {
    geometryToDraw = deformedExists;
  }

  if (!geometryToDraw) return;

  const mode = renderMode.value;
  const isDeformed = geometryToDraw === deformedExists;

  const solidColor = isDeformed ? 0xcc5050 : 0x5078c8;
  const wireColor = isDeformed ? 0xff6464 : 0x6496ff;

  // Auto-fit to view
  geometryToDraw.computeBoundingSphere();
  const radius = geometryToDraw.boundingSphere.radius;
  camera.position.set(0, 0, radius * 2.5);
  if (controls) {
    controls.target.set(0, 0, 0);
    controls.update();
  }

  // SOLID MESH
  if (mode === "solid" || mode === "both") {
    const material = new THREE.MeshPhongMaterial({
      color: solidColor,
      shininess: 30,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometryToDraw, material);
    meshGroup.add(mesh);
  }

  // WIREFRAME MESH (Draws on top for 'both' mode)
  if (mode === "wireframe" || mode === "both") {
    const material = new THREE.MeshBasicMaterial({
      color: wireColor,
      wireframe: true,
      transparent: true,
      opacity: mode === "both" ? 0.8 : 1.0,
    });
    const mesh = new THREE.Mesh(geometryToDraw, material);
    meshGroup.add(mesh);
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
    const exporter = new THREE.STLExporter();
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
  const axisMode = deformParams.pixel.axis;
  const positionAttribute = geom.getAttribute("position");
  const arr = positionAttribute.array;
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
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

function idwShape(geom) {
  const positionAttribute = geom.getAttribute("position");
  const arr = positionAttribute.array;
  const count = positionAttribute.count;

  const { numPoints, seed, weight, power, scale } = deformParams.idw;

  // IDW deformation logic
  for (let i = 0; i < count; i++) {
    const dx = arr[i * 3] - pointX;
    const dy = arr[i * 3 + 1] - pointY;
    const dz = arr[i * 3 + 2] - pointZ;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Avoid division by zero
    if (distance === 0) continue;

    // Inverse distance weighting
    const idw = weight / Math.pow(distance, power);

    // Apply deformation
    arr[i * 3] += dx * idw * scale;
    arr[i * 3 + 1] += dy * idw * scale;
    arr[i * 3 + 2] += dz * idw * scale;
  }

  positionAttribute.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

// Global storage for IDW control points
let idwControlPoints = [];

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
  const insideSamples = sampler.filterInsideVolume(samples, originalGeometry);

  console.log(`Generated ${samples.length} candidates, found ${insideSamples.length} inside mesh volume`);

  // If we still don't have enough inside samples, try with smaller minimum distance
  let controlPoints = [...insideSamples];
  if (controlPoints.length < maxSamples) {
    console.warn(`Only found ${controlPoints.length} points inside mesh volume, trying with smaller spacing...`);
    const smallerMinDistance = minDistance * 0.5;
    const additionalSamples = sampler.generateSamples(smallerMinDistance, maxSamples * 5, bbox);
    const additionalInside = sampler.filterInsideVolume(additionalSamples, originalGeometry);
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
window.onload = init;

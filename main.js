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
let deformedGeometries = { noise: null, sine: null, pixel: null };
let currentModelKey = "noise";
let originalFileName = null; // Track original file name for settings export

// UI elements and parameters
let processBtn, statusElement, exportBtn, toggleView, renderMode, clearBtn;
let meshGroup; // Group to hold the visible THREE.js meshes

let deformParams = {
  noise: { intensity: 1.5, scale: 0.02, axis: "all" },
  sine: { amplitude: 15, frequency: 0.05, driverAxis: "x", dispAxis: "x" },
  pixel: { size: 5, axis: "all" },
};

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
  processBtn.onclick = () => {
    if (!originalGeometry) {
      statusDisplay.error("Please load an STL first.");
      return;
    }
    try {
      statusDisplay.update(`Generating ${currentModelKey} shape...`, true);
      generateCurrent();
      updateSceneMeshes();
      statusDisplay.update(
        `Generated ${currentModelKey} shape successfully.`,
        false,
      );
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
  deformedGeometries = { noise: null, sine: null, pixel: null };
  originalFileName = null; // Reset original file name

  // Clear meshes from scene
  if (meshGroup) {
    while (meshGroup.children.length > 0) {
      meshGroup.remove(meshGroup.children[0]);
    }
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
        deformedGeometries = { noise: null, sine: null, pixel: null };
        originalFileName = defaultPath; // Set default file name
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
}

function parseSTL(arrayBuffer) {
  const loader = new THREE.STLLoader();
  originalGeometry = loader.parse(arrayBuffer);

  originalGeometry.computeBoundingBox();
  // FIX: Center the geometry so it sits at the world origin (0,0,0)
  originalGeometry.center();

  originalGeometry.computeBoundingSphere();
  // Clear any old deformed models when a new file is loaded
  deformedGeometries = { noise: null, sine: null, pixel: null };
  console.log(
    "STL Loaded. Vertices:",
    originalGeometry.attributes.position.count,
  );
}

function generateCurrent() {
  if (!originalGeometry) return;
  // Clone the original geometry for modification.
  // It is essential to use a clone of the centered geometry.
  const original = originalGeometry.clone();

  if (currentModelKey === "noise") {
    deformedGeometries.noise = noiseShape(original);
  } else if (currentModelKey === "sine") {
    deformedGeometries.sine = sineDeformShape(original);
  } else if (currentModelKey === "pixel") {
    deformedGeometries.pixel = pixelateShape(original);
  }
}

// --- THREE.js Rendering Logic ---
function updateSceneMeshes() {
  // Clears the mesh group using compatibility loop
  while (meshGroup.children.length > 0) {
    meshGroup.remove(meshGroup.children[0]);
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

// Start the application
window.onload = init;

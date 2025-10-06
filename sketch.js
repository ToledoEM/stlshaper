// STLLoader implementation
THREE.STLLoader = class STLLoader {
  load(url, onLoad, onProgress, onError) {
    const loader = new THREE.FileLoader();
    loader.setResponseType('arraybuffer');
    loader.load(url, buffer => onLoad(this.parse(buffer)), onProgress, onError);
  }

  parse(data) {
    function isBinary(data) {
      const reader = new DataView(data);
      const numFaces = reader.getUint32(80, true);
      const expectedSize = 84 + numFaces * 50;
      return data.byteLength === expectedSize;
    }
    return isBinary(data) ? this.parseBinary(data) : this.parseASCII(this.ensureString(data));
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
          reader.getFloat32(vStart + 8, true)
        );
        normals.push(nx, ny, nz);
      }
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return geometry;
  }

  parseASCII(data) {
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const normals = [];
    const facetPattern = /facet\s+normal\s+([+\-\deE\.]+)\s+([+\-\deE\.]+)\s+([+\-\deE\.]+)\s+outer loop([\s\S]*?)endloop\s+endfacet/g;
    const vertexPattern = /vertex\s+([+\-\deE\.]+)\s+([+\-\deE\.]+)\s+([+\-\deE\.]+)/g;
    let facetMatch;
    while ((facetMatch = facetPattern.exec(data)) !== null) {
      const nx = parseFloat(facetMatch[1]);
      const ny = parseFloat(facetMatch[2]);
      const nz = parseFloat(facetMatch[3]);
      const loopBlock = facetMatch[4];
      let vMatch;
      let localVerts = [];
      while ((vMatch = vertexPattern.exec(loopBlock)) !== null) {
        localVerts.push(parseFloat(vMatch[1]), parseFloat(vMatch[2]), parseFloat(vMatch[3]));
      }
      if (localVerts.length === 9) {
        vertices.push(...localVerts);
        normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
      }
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return geometry;
  }

  ensureString(buffer) {
    if (typeof buffer === 'string') return buffer;
    return new TextDecoder().decode(buffer);
  }
};

// STLExporter implementation
THREE.STLExporter = class STLExporter {
  parse(scene, options = {}) {
    const binary = options.binary !== undefined ? options.binary : false;
    const objects = [];
    scene.traverse(obj => {
      if (obj.isMesh) objects.push(obj);
    });
    if (binary) {
      return this.parseBinary(objects);
    } else {
      return this.parseASCII(objects);
    }
  }

  parseASCII(objects) {
    let output = 'solid exported\n';
    const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
    objects.forEach(obj => {
      const geometry = obj.geometry;
      const matrixWorld = obj.matrixWorld;
      if (!geometry.isBufferGeometry) return;
      const pos = geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i += 3) {
        v0.fromBufferAttribute(pos, i).applyMatrix4(matrixWorld);
        v1.fromBufferAttribute(pos, i + 1).applyMatrix4(matrixWorld);
        v2.fromBufferAttribute(pos, i + 2).applyMatrix4(matrixWorld);
        e1.subVectors(v1, v0);
        e2.subVectors(v2, v0);
        n.crossVectors(e1, e2).normalize();
        output += `  facet normal ${n.x} ${n.y} ${n.z}\n`;
        output += '    outer loop\n';
        output += `      vertex ${v0.x} ${v0.y} ${v0.z}\n`;
        output += `      vertex ${v1.x} ${v1.y} ${v1.z}\n`;
        output += `      vertex ${v2.x} ${v2.y} ${v2.z}\n`;
        output += '    endloop\n';
        output += '  endfacet\n';
      }
    });
    output += 'endsolid exported\n';
    return output;
  }

  parseBinary(objects) {
    let triangles = 0;
    objects.forEach(obj => {
      const geometry = obj.geometry;
      if (geometry.isBufferGeometry) {
        triangles += geometry.getAttribute('position').count / 3;
      }
    });
    const offset = 80;
    const bufferLength = triangles * 50 + offset + 4;
    const arrayBuffer = new ArrayBuffer(bufferLength);
    const output = new DataView(arrayBuffer);
    output.setUint32(offset, triangles, true);
    let index = offset + 4;
    objects.forEach(obj => {
      const geometry = obj.geometry;
      const matrixWorld = obj.matrixWorld;
      if (geometry.isBufferGeometry) {
        const positions = geometry.getAttribute('position');
        const normals = geometry.getAttribute('normal');
        for (let i = 0; i < positions.count; i += 3) {
          const n = new THREE.Vector3();
          if (normals) {
            n.fromBufferAttribute(normals, i);
          } else {
            n.set(0, 0, 1);
          }
          n.applyMatrix3(new THREE.Matrix3().getNormalMatrix(matrixWorld)).normalize();
          output.setFloat32(index, n.x, true); index += 4;
          output.setFloat32(index, n.y, true); index += 4;
          output.setFloat32(index, n.z, true); index += 4;
          for (let j = 0; j < 3; j++) {
            const v = new THREE.Vector3();
            v.fromBufferAttribute(positions, i + j);
            v.applyMatrix4(matrixWorld);
            output.setFloat32(index, v.x, true); index += 4;
            output.setFloat32(index, v.y, true); index += 4;
            output.setFloat32(index, v.z, true); index += 4;
          }
          output.setUint16(index, 0, true); index += 2;
        }
      }
    });
    return arrayBuffer;
  }
};

let model;
let cam;
let models = {noise: null, sine: null, pixel: null};
let currentModelKey = 'noise';
let processBtn, statusElement, exportBtn, toggleView, renderMode;
let deformParams = {
  noise: {intensity: 15, scale: 0.02, axis: 'all'},
  sine: {amplitude: 15, frequency: 0.05, driverAxis: 'x', dispAxis: 'x'},
  pixel: {size: 15, axis: 'all'}
};

const statusDisplay = {
  update: (message, buttonState = true) => {
    statusElement.textContent = message;
    processBtn.disabled = buttonState;
    exportBtn.disabled = !(model && models[currentModelKey]); 
    if (message.includes("successfully")) {
      setTimeout(() => {
        if (model && model.attributes && model.attributes.position) {
          statusElement.textContent = `Ready: ${model.attributes.position.count} vertices loaded. Press 'Generate Deformation'.`;
          processBtn.disabled = false;
        } else {
          statusElement.textContent = "Ready to load STL.";
        }
      }, 3000);
    }
  },
  error: (message) => {
    statusElement.textContent = `Error: ${message}`;
    processBtn.disabled = false;
    exportBtn.disabled = true;
  }
};
function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  
  cam = createCamera(); 
  cam.setPosition(0, 0, 400); 

  const fileInput = document.getElementById('fileInput');
  processBtn = document.getElementById('processBtn');
  statusElement = document.getElementById('status');
  exportBtn = document.getElementById('exportBtn');
  toggleView = document.getElementById('toggleView');
  renderMode = document.getElementById('renderMode');

  setupControlPanels();
  setupParameterControls();

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) {
      statusDisplay.update('Ready to load STL.');
      return;
    }
    statusDisplay.update(`Loading file: ${file.name}...`, true);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        parseSTL(reader.result);
        statusDisplay.update(`Model loaded: ${model.attributes.position.count} vertices. Press 'Generate Deformation'.`, false);
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

  document.querySelectorAll('input[name="type"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      currentModelKey = e.target.value;
      updateControlPanels();
      if (model) {
        statusDisplay.update(`Configuration changed to ${currentModelKey}. Press 'Generate Deformation' to process.`, false);
      }
    });
  });

  processBtn.onclick = () => {
    if (!model) {
      statusDisplay.error('Please load an STL first.');
      return;
    }
    try {
      statusDisplay.update(`Reprocessing ${currentModelKey} shape...`, true);
      generateCurrent();
      statusDisplay.update(`Reprocessed ${currentModelKey} shape successfully.`, false);
    } catch(e) {
      console.error("Error:", e);
      statusDisplay.error("Error reprocessing model.");
    }
  };
  exportBtn.onclick = exportSTL;
}

function setupControlPanels() {
  updateControlPanels();
}

function updateControlPanels() {
  document.getElementById('noiseControls').style.display = currentModelKey === 'noise' ? 'block' : 'none';
  document.getElementById('sineControls').style.display = currentModelKey === 'sine' ? 'block' : 'none';
  document.getElementById('pixelControls').style.display = currentModelKey === 'pixel' ? 'block' : 'none';
}

function setupParameterControls() {
  const noiseIntensity = document.getElementById('noiseIntensity');
  const noiseIntensityVal = document.getElementById('noiseIntensityVal');
  const noiseScale = document.getElementById('noiseScale');
  const noiseScaleVal = document.getElementById('noiseScaleVal');
  
  noiseIntensity.addEventListener('input', (e) => {
    deformParams.noise.intensity = parseFloat(e.target.value);
    noiseIntensityVal.textContent = e.target.value;
    if (model) statusDisplay.update(`Parameters changed. Press 'Generate' to process.`, false); 
  });
  
  noiseScale.addEventListener('input', (e) => {
    deformParams.noise.scale = parseFloat(e.target.value);
    noiseScaleVal.textContent = e.target.value;
    if (model) statusDisplay.update(`Parameters changed. Press 'Generate' to process.`, false); 
  });
  
  const noiseAxis = document.getElementById('noiseAxis');
  if (noiseAxis) {
    noiseAxis.addEventListener('change', (e) => {
      deformParams.noise.axis = e.target.value;
      if (model) statusDisplay.update(`Parameters changed. Press 'Generate' to process.`, false); 
    });
  }
  
  const sineAmp = document.getElementById('sineAmp');
  const sineAmpVal = document.getElementById('sineAmpVal');
  const sineFreq = document.getElementById('sineFreq');
  const sineFreqVal = document.getElementById('sineFreqVal');
  const sineDriverAxis = document.getElementById('sineDriverAxis');
  const sineDispAxis = document.getElementById('sineDispAxis');
  
  sineAmp.addEventListener('input', (e) => {
    deformParams.sine.amplitude = parseFloat(e.target.value);
    sineAmpVal.textContent = e.target.value;
    if (model) statusDisplay.update(`Parameters changed. Press 'Generate' to process.`, false); 
  });
  
  sineFreq.addEventListener('input', (e) => {
    deformParams.sine.frequency = parseFloat(e.target.value);
    sineFreqVal.textContent = e.target.value;
    if (model) statusDisplay.update(`Parameters changed. Press 'Generate' to process.`, false); 
  });
  
  sineDriverAxis.addEventListener('change', (e) => {
    deformParams.sine.driverAxis = e.target.value;
    if (model) statusDisplay.update(`Parameters changed. Press 'Generate' to process.`, false); 
  });
  
  sineDispAxis.addEventListener('change', (e) => {
    deformParams.sine.dispAxis = e.target.value;
    if (model) statusDisplay.update(`Parameters changed. Press 'Generate' to process.`, false); 
  });
  
  const pixelSize = document.getElementById('pixelSize');
  const pixelSizeVal = document.getElementById('pixelSizeVal');
  const pixelAxis = document.getElementById('pixelAxis');
  
  pixelSize.addEventListener('input', (e) => {
    deformParams.pixel.size = parseFloat(e.target.value);
    pixelSizeVal.textContent = e.target.value;
    if (model) statusDisplay.update(`Parameters changed. Press 'Generate' to process.`, false); 
  });
  
  pixelAxis.addEventListener('change', (e) => {
    deformParams.pixel.axis = e.target.value;
    if (model) statusDisplay.update(`Parameters changed. Press 'Generate' to process.`, false); 
  });
}

function draw() {
  background(20);
  
  // Mouse-over check restored as requested
  if (!isMouseOverUI()) orbitControl(); 
  
  ambientLight(100);
  pointLight(255, 255, 255, 200, 200, 200);
  
  drawModels();
  
  if (currentModelKey === 'sine') rotateY(frameCount * 0.005);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function isMouseOverUI() {
  const ui = document.getElementById('ui');
  const rect = ui.getBoundingClientRect();
  return mouseX >= rect.left && mouseX <= rect.right && mouseY >= rect.top && mouseY <= rect.bottom;
}

function parseSTL(arrayBuffer) {
  const loader = new THREE.STLLoader();
  const geometry = loader.parse(arrayBuffer);
  model = geometry.clone();
  model.computeBoundingBox();
  model.computeBoundingSphere();
  models = { noise: null, sine: null, pixel: null }; 
  console.log("STL Loaded. Vertices:", model.attributes.position.count);
}

function generateCurrent() {
  if (!model) return;
  if (currentModelKey === 'noise') {
    models.noise = noiseShape(model.clone());
  } else if (currentModelKey === 'sine') {
    models.sine = sineDeformShape(model.clone());
  } else if (currentModelKey === 'pixel') {
    models.pixel = pixelateShape(model.clone());
  }
}

function drawModels() {
  const showDeformed = toggleView.checked;
  const originalModel = model;
  const activeModel = models[currentModelKey];
  const mode = renderMode.value;
  let modelToDraw = showDeformed && activeModel ? activeModel : originalModel;
  
  if (modelToDraw) {
    const positions = modelToDraw.attributes.position.array;
    const vertexCount = modelToDraw.attributes.position.count;
    let wireColor = modelToDraw === activeModel ? [255, 100, 100] : [100, 150, 255];
    let fillColor = modelToDraw === activeModel ? [200, 80, 80] : [80, 120, 200];
    
    if (mode === 'solid' || mode === 'both') {
      fill(fillColor[0], fillColor[1], fillColor[2], 180);
      stroke(fillColor[0] * 0.6, fillColor[1] * 0.6, fillColor[2] * 0.6);
      strokeWeight(0.5);
      beginShape(TRIANGLES);
      for (let i = 0; i < vertexCount / 3; i++) { 
        let idx = i * 9;
        let v0x = positions[idx], v0y = positions[idx + 1], v0z = positions[idx + 2];
        let v1x = positions[idx + 3], v1y = positions[idx + 4], v1z = positions[idx + 5];
        let v2x = positions[idx + 6], v2y = positions[idx + 7], v2z = positions[idx + 8];
        vertex(v0x, v0y, v0z);
        vertex(v1x, v1y, v1z);
        vertex(v2x, v2y, v2z);
      }
      endShape();
    }
    
    if (mode === 'wireframe' || mode === 'both') {
      stroke(wireColor[0], wireColor[1], wireColor[2]);
      strokeWeight(mode === 'both' ? 0.8 : 1.5);
      noFill();
      for (let i = 0; i < vertexCount / 3; i++) { 
        let idx = i * 9;
        let v0x = positions[idx], v0y = positions[idx + 1], v0z = positions[idx + 2];
        let v1x = positions[idx + 3], v1y = positions[idx + 4], v1z = positions[idx + 5];
        let v2x = positions[idx + 6], v2y = positions[idx + 7], v2z = positions[idx + 8];
        beginShape(LINES);
        vertex(v0x, v0y, v0z); vertex(v1x, v1y, v1z);
        vertex(v1x, v1y, v1z); vertex(v2x, v2y, v2z);
        vertex(v2x, v2y, v2z); vertex(v0x, v0y, v0z);
        endShape();
      }
    }
  }
}

function exportSTL() {
  const activeModel = models[currentModelKey];
  if (!activeModel) {
    statusDisplay.error("No deformed model generated to export. Press 'Generate Deformation' first.");
    return;
  }
  statusDisplay.update(`Exporting ${currentModelKey} model...`, true);
  try {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(activeModel); 
    scene.add(mesh);
    const exporter = new THREE.STLExporter();
    const stlString = exporter.parse(scene, { binary: false });
    const blob = new Blob([stlString], { type: 'text/plain' });
    saveAs(blob, `${currentModelKey}_deformed.stl`);
    statusDisplay.update(`Export successful! ${currentModelKey}_deformed.stl`, false);
  } catch (e) {
    console.error("STL Export Error:", e);
    statusDisplay.error("Export failed. Check console.");
  }
}

function noiseShape(geom) {
  console.log("Generating Noise deformation...");
  geom.computeBoundingBox();
  const bbox = geom.boundingBox;
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  const intensity = deformParams.noise.intensity;
  const scale = deformParams.noise.scale;
  const axisMode = deformParams.noise.axis;
  const positionAttribute = geom.getAttribute('position');
  for (let i = 0; i < positionAttribute.count; i++) {
    const x = positionAttribute.getX(i);
    const y = positionAttribute.getY(i);
    const z = positionAttribute.getZ(i);
    const cx = x - center.x;
    const cy = y - center.y;
    const cz = z - center.z;
    const len = Math.hypot(cx, cy, cz) || 1;
    const rx = cx / len;
    const ry = cy / len;
    const rz = cz / len;
    const noiseValue = noise(cx * scale, cy * scale, cz * scale);
    const offset = (noiseValue - 0.5) * 2 * intensity; 
    let ox = rx * offset;
    let oy = ry * offset;
    let oz = rz * offset;
    const allowX = axisMode.includes('x') || axisMode === 'all';
    const allowY = axisMode.includes('y') || axisMode === 'all';
    const allowZ = axisMode.includes('z') || axisMode === 'all';
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
  console.log("Generating Sine Deformation...");
  const A = deformParams.sine.amplitude;
  const f = deformParams.sine.frequency;
  const driverAxis = deformParams.sine.driverAxis;
  const dispAxis = deformParams.sine.dispAxis;
  const posAttr = geom.getAttribute('position');
  const arr = posAttr.array;
  const driverIndex = driverAxis === 'x' ? 0 : driverAxis === 'y' ? 1 : 2;
  const allowX = dispAxis.includes('x') || dispAxis === 'all';
  const allowY = dispAxis.includes('y') || dispAxis === 'all';
  const allowZ = dispAxis.includes('z') || dispAxis === 'all';
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
  console.log("Generating Pixelate Shape...");
  const pixelSize = deformParams.pixel.size;
  const axisMode = deformParams.pixel.axis;
  const positionAttribute = geom.getAttribute('position');
  const arr = positionAttribute.array;
  const initialLength = arr.length;
  const allowX = axisMode.includes('x') || axisMode === 'all';
  const allowY = axisMode.includes('y') || axisMode === 'all';
  const allowZ = axisMode.includes('z') || axisMode === 'all';
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
    const v0x = arr[i], v0y = arr[i + 1], v0z = arr[i + 2];
    const v1x = arr[i + 3], v1y = arr[i + 4], v1z = arr[i + 5];
    const v2x = arr[i + 6], v2y = arr[i + 7], v2z = arr[i + 8];
    const isDegenerate = (
      (v0x === v1x && v0y === v1y && v0z === v1z) ||
      (v1x === v2x && v1y === v2y && v1z === v2z) ||
      (v2x === v0x && v2y === v0y && v2z === v0z)
    );
    if (isDegenerate) continue;
    const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
    const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const area2 = nx*nx + ny*ny + nz*nz;
    if (area2 > epsSq) {
      cleanedPositions.push(v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z);
    }
  }
  if (cleanedPositions.length && cleanedPositions.length !== initialLength) {
    geom.setAttribute('position', new THREE.Float32BufferAttribute(cleanedPositions, 3));
    geom.deleteAttribute('normal');
  } else if (cleanedPositions.length === 0) {
    console.warn("Pixelation caused complete mesh collapse.");
    geom.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    geom.deleteAttribute('normal');
  }
  positionAttribute.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}
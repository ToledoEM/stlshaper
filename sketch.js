// Custom perspective camera implementation
// Derived from https://github.com/osresearch/papercraft/blob/master/camera.c

function m44_mult(a,b)
{
	let c = [
		[0,0,0,0],
		[0,0,0,0],
		[0,0,0,0],
		[0,0,0,0],
	];
	for(let i = 0 ; i < 4 ; i++)
		for(let j = 0 ; j < 4 ; j++)
			for(let k = 0 ; k < 4 ; k++)
				c[i][j] += a[i][k] * b[k][j];

	return c;
}

function Camera(eye,lookat,up,fov)
{
	this.eye = eye;
	this.lookat = lookat;
	this.up = up;
	this.fov = fov;
	this.generation = 0;
	this.width = width;
	this.height = height;

	// project a point from model space to camera space
	this.project = function(v_in,v_out=null)
	{
		let v = [v_in.x, v_in.y, v_in.z, 1];
		let p = [0,0,0,0];

		for(let i = 0 ; i < 4 ; i++)
			for(let j = 0 ; j < 4 ; j++)
				p[i] += this.matrix[i][j] * v[j];

		// if the projected point has negative z, this means
		// it is behind us and can be discarded
		if (p[2] <= 0)
			return;

		let x = p[0] / p[3];
		let y = p[1] / p[3];
		let z = p[2] / p[3];

		if (!v_out)
			return createVector(x,y,z);

		// update in place to avoid an allocation
		v_out.x = x;
		v_out.y = y;
		v_out.z = z;
		return v_out;
	}

	// Update the camera projection matrix with eye/lookat/fov
	this.update_matrix = function()
	{
		// compute the three basis vectors for the camera

		// w is the Z axis from the eye to the destination point
		let w = p5.Vector.sub(this.eye, this.lookat).normalize();

		// u is the X axis to the right side of the camera
		let u = this.up.cross(w).normalize();

		// v is the Y axis aligned with the UP axis
		let v = w.cross(u).normalize();

		let cam = [
			[ u.x, u.y, u.z, -u.dot(this.eye) ],
			[ v.x, v.y, v.z, -v.dot(this.eye) ],
			[ w.x, w.y, w.z, -w.dot(this.eye) ],
			[ 0,   0,   0,   1 ],
		];

		let scale = 1000.0 / tan(this.fov * PI / 180 / 2);
		let near = 1;
		let far = 10000;
		let f1 = - far / (far - near);
		let f2 = - far * near / (far - near);

		let perspective = [
			[ scale, 0, 0, 0 ],
			[ 0, scale, 0, 0 ],
			[ 0, 0, f2, -1 ],
			[ 0, 0, f1,  0 ],
		];

		this.matrix = m44_mult(perspective, cam);
		this.u = u;
		this.v = v;
		this.w = w;

		this.generation++;
	}

	this.update_matrix();
}

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
    const patternNormal = /normal\s+([\d\.\+\-eE]+)\s+([\d\.\+\-eE]+)\s+([\d\.\+\-eE]+)/g;
    const patternVertex = /vertex\s+([\d\.\+\-eE]+)\s+([\d\.\+\-eE]+)\s+([\d\.\+\-eE]+)/g;
    
    let normalMatch, vertexMatch;
    let currentNormal = [0, 0, 0];

    while ((normalMatch = patternNormal.exec(data)) !== null) {
      currentNormal = [parseFloat(normalMatch[1]), parseFloat(normalMatch[2]), parseFloat(normalMatch[3])];
    }

    patternNormal.lastIndex = 0;

    while ((vertexMatch = patternVertex.exec(data)) !== null) {
      vertices.push(parseFloat(vertexMatch[1]), parseFloat(vertexMatch[2]), parseFloat(vertexMatch[3]));
      normals.push(currentNormal[0], currentNormal[1], currentNormal[2]);
      
      if (vertices.length % 9 === 0) {
        const nextNormal = patternNormal.exec(data);
        if (nextNormal) {
          currentNormal = [parseFloat(nextNormal[1]), parseFloat(nextNormal[2]), parseFloat(nextNormal[3])];
        }
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
          
          output += `  facet normal ${n.x} ${n.y} ${n.z}\n`;
          output += '    outer loop\n';
          
          for (let j = 0; j < 3; j++) {
            const v = new THREE.Vector3();
            v.fromBufferAttribute(positions, i + j);
            v.applyMatrix4(matrixWorld);
            output += `      vertex ${v.x} ${v.y} ${v.z}\n`;
          }
          
          output += '    endloop\n';
          output += '  endfacet\n';
        }
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

// Main application code
let model;
let cam;
let customCamera; // Custom camera for projection
let models = {
  voronoi: null,
  sine: null,
  pixel: null
};

let currentModelKey = 'voronoi';
let processBtn;
let statusElement;
let exportBtn;
let toggleView;

// Deformation parameters
let deformParams = {
  noise: {
    intensity: 15,
    scale: 0.02
  },
  sine: {
    amplitude: 15,
    frequency: 0.05,
    axis: 'x',
    dualAxis: true
  },
  pixel: {
    size: 15,
    axis: 'all'
  }
};

const statusDisplay = {
  update: (message, buttonState = true) => {
    statusElement.textContent = message;
    processBtn.disabled = buttonState;
    exportBtn.disabled = !(model && !buttonState && models[currentModelKey]);
    
    if (message.includes("successfully")) {
      setTimeout(() => {
        if (model && model.attributes && model.attributes.position) {
          statusElement.textContent = `Ready: ${model.attributes.position.count} vertices loaded.`;
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
  
  // Initialize custom camera
  customCamera = new Camera(
    createVector(0, 0, 400),  // eye
    createVector(0, 0, 0),    // lookat
    createVector(0, 1, 0),    // up
    60                         // fov
  );
  
  const fileInput = document.getElementById('fileInput');
  processBtn = document.getElementById('processBtn');
  statusElement = document.getElementById('status');
  exportBtn = document.getElementById('exportBtn');
  toggleView = document.getElementById('toggleView');

  // Setup control panels visibility
  setupControlPanels();
  
  // Setup parameter change listeners
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
        statusDisplay.update('File parsed. Starting deformation...', true);
        generateAll();
        statusDisplay.update(`Model loaded and generated successfully.`, false);
        exportBtn.disabled = false;
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
        try {
          statusDisplay.update(`Generating ${currentModelKey} shape...`, true);
          generateAll();
          statusDisplay.update(`Generated ${currentModelKey} shape successfully.`, false);
        } catch(e) {
          console.error("Error:", e);
          statusDisplay.error("Error applying deformation.");
        }
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
      generateAll();
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
  document.getElementById('noiseControls').style.display = 
    currentModelKey === 'voronoi' ? 'block' : 'none';
  document.getElementById('sineControls').style.display = 
    currentModelKey === 'sine' ? 'block' : 'none';
  document.getElementById('pixelControls').style.display = 
    currentModelKey === 'pixel' ? 'block' : 'none';
}

function setupParameterControls() {
  // Noise controls
  const noiseIntensity = document.getElementById('noiseIntensity');
  const noiseIntensityVal = document.getElementById('noiseIntensityVal');
  const noiseScale = document.getElementById('noiseScale');
  const noiseScaleVal = document.getElementById('noiseScaleVal');
  
  noiseIntensity.addEventListener('input', (e) => {
    deformParams.noise.intensity = parseFloat(e.target.value);
    noiseIntensityVal.textContent = e.target.value;
    if (model && currentModelKey === 'voronoi') {
      generateAll();
    }
  });
  
  noiseScale.addEventListener('input', (e) => {
    deformParams.noise.scale = parseFloat(e.target.value);
    noiseScaleVal.textContent = e.target.value;
    if (model && currentModelKey === 'voronoi') {
      generateAll();
    }
  });
  
  // Sine wave controls
  const sineAmp = document.getElementById('sineAmp');
  const sineAmpVal = document.getElementById('sineAmpVal');
  const sineFreq = document.getElementById('sineFreq');
  const sineFreqVal = document.getElementById('sineFreqVal');
  const sineAxis = document.getElementById('sineAxis');
  const sineDualAxis = document.getElementById('sineDualAxis');
  
  sineAmp.addEventListener('input', (e) => {
    deformParams.sine.amplitude = parseFloat(e.target.value);
    sineAmpVal.textContent = e.target.value;
    if (model && currentModelKey === 'sine') {
      generateAll();
    }
  });
  
  sineFreq.addEventListener('input', (e) => {
    deformParams.sine.frequency = parseFloat(e.target.value);
    sineFreqVal.textContent = e.target.value;
    if (model && currentModelKey === 'sine') {
      generateAll();
    }
  });
  
  sineAxis.addEventListener('change', (e) => {
    deformParams.sine.axis = e.target.value;
    if (model && currentModelKey === 'sine') {
      generateAll();
    }
  });
  
  sineDualAxis.addEventListener('change', (e) => {
    deformParams.sine.dualAxis = e.target.checked;
    if (model && currentModelKey === 'sine') {
      generateAll();
    }
  });
  
  // Pixelate controls
  const pixelSize = document.getElementById('pixelSize');
  const pixelSizeVal = document.getElementById('pixelSizeVal');
  const pixelAxis = document.getElementById('pixelAxis');
  
  pixelSize.addEventListener('input', (e) => {
    deformParams.pixel.size = parseFloat(e.target.value);
    pixelSizeVal.textContent = e.target.value;
    if (model && currentModelKey === 'pixel') {
      generateAll();
    }
  });
  
  pixelAxis.addEventListener('change', (e) => {
    deformParams.pixel.axis = e.target.value;
    if (model && currentModelKey === 'pixel') {
      generateAll();
    }
  });
}

function draw() {
  background(20);
  
  // Update custom camera eye position based on p5 camera
  let eye = createVector(cam.eyeX, cam.eyeY, cam.eyeZ);
  let lookat = createVector(cam.centerX, cam.centerY, cam.centerZ);
  
  customCamera.eye = eye;
  customCamera.lookat = lookat;
  customCamera.update_matrix();
  
  orbitControl();
  ambientLight(100);
  pointLight(255, 255, 255, 200, 200, 200);
  
  drawModels();
  
  if (currentModelKey === 'sine') {
    rotateY(frameCount * 0.005);
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function parseSTL(arrayBuffer) {
  const loader = new THREE.STLLoader();
  const geometry = loader.parse(arrayBuffer);
  model = geometry.clone();
  model.computeBoundingBox();
  model.computeBoundingSphere();
  models = { voronoi: null, sine: null, pixel: null };
  console.log("STL Loaded. Vertices:", model.attributes.position.count);
}

function generateAll() {
  if (currentModelKey === 'voronoi') {
    models.voronoi = voronoiShape(model.clone());
  } else if (currentModelKey === 'sine') {
    models.sine = sineWireShape(model.clone());
  } else if (currentModelKey === 'pixel') {
    models.pixel = pixelateShape(model.clone());
  }
}

function drawModels() {
  const showDeformed = toggleView.checked;
  const originalModel = model;
  const activeModel = models[currentModelKey];
  
  let modelToDraw = showDeformed && activeModel ? activeModel : originalModel;
  
  if (modelToDraw) {
    const positions = modelToDraw.attributes.position.array;
    const vertexCount = modelToDraw.attributes.position.count;
    const normals = modelToDraw.attributes.normal ? modelToDraw.attributes.normal.array : null;
    
    // Set colors based on which model is being viewed
    if (modelToDraw === activeModel) {
      stroke(255, 100, 100);
      strokeWeight(1.5);
    } else {
      stroke(100, 150, 255);
      strokeWeight(1);
    }
    
    noFill();
    
    // Draw wireframe using custom camera projection
    for (let i = 0; i < vertexCount; i += 3) {
      // Get the three vertices of the triangle
      let v0 = createVector(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      let v1 = createVector(positions[(i + 1) * 3], positions[(i + 1) * 3 + 1], positions[(i + 1) * 3 + 2]);
      let v2 = createVector(positions[(i + 2) * 3], positions[(i + 2) * 3 + 1], positions[(i + 2) * 3 + 2]);
      
      // Backface culling using custom camera
      if (normals) {
        let nx = normals[i * 3];
        let ny = normals[i * 3 + 1];
        let nz = normals[i * 3 + 2];
        
        // Calculate view direction using camera w vector (eye direction)
        let viewDir = customCamera.w.copy().mult(-1);
        let normal = createVector(nx, ny, nz);
        
        // Skip back-facing triangles
        if (viewDir.dot(normal) < 0) continue;
      }
      
      // Project vertices using custom camera
      let p0 = customCamera.project(v0);
      let p1 = customCamera.project(v1);
      let p2 = customCamera.project(v2);
      
      // Skip triangles behind camera
      if (!p0 || !p1 || !p2) continue;
      
      // Draw the three edges of the triangle
      beginShape(LINES);
      vertex(v0.x, v0.y, v0.z);
      vertex(v1.x, v1.y, v1.z);
      endShape();
      
      beginShape(LINES);
      vertex(v1.x, v1.y, v1.z);
      vertex(v2.x, v2.y, v2.z);
      endShape();
      
      beginShape(LINES);
      vertex(v2.x, v2.y, v2.z);
      vertex(v0.x, v0.y, v0.z);
      endShape();
    }
  }
}

function exportSTL() {
  const activeModel = models[currentModelKey];
  
  if (!activeModel) {
    statusDisplay.error("No deformed model generated to export.");
    return;
  }
  
  statusDisplay.update(`Exporting ${currentModelKey} model...`, true);
  
  try {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(activeModel, new THREE.MeshNormalMaterial());
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

function voronoiShape(geom) {
  console.log("Generating Noise deformation...");
  
  const intensity = deformParams.noise.intensity;
  const scale = deformParams.noise.scale;
  
  // Use the actual loaded geometry
  const positionAttribute = geom.getAttribute('position');
  const posArray = positionAttribute.array;
  
  // Apply noise-based deformation to each vertex
  for (let i = 0; i < positionAttribute.count; i++) {
    const x = positionAttribute.getX(i);
    const y = positionAttribute.getY(i);
    const z = positionAttribute.getZ(i);
    
    // Apply 3D Perlin noise offset
    let noiseValue = noise(x * scale, y * scale, z * scale);
    let offset = noiseValue * intensity;
    
    // Calculate the direction from center
    let len = Math.sqrt(x*x + y*y + z*z);
    if (len > 0) {
      let nx = x / len;
      let ny = y / len;
      let nz = z / len;
      
      // Push vertices along their normal direction
      positionAttribute.setXYZ(i, x + nx * offset, y + ny * offset, z + nz * offset);
    }
  }
  
  positionAttribute.needsUpdate = true;
  geom.computeVertexNormals();
  return geom;
}

function sineWireShape(geom) {
  console.log("Generating Sine Wave Shape...");
  const positions = geom.attributes.position.array;
  
  for (let i = 0; i < positions.length; i += 3) {
    let x = positions[i];
    let z = positions[i + 2];
    let distortion = sin(x * 0.1 + frameCount * 0.1) * 20;
    positions[i + 2] = z + distortion;
  }
  
  geom.attributes.position.needsUpdate = true;
  geom.computeVertexNormals();
  return geom;
}

function pixelateShape(geom) {
  console.log("Generating Pixelate Shape...");
  
  const pixelSize = deformParams.pixel.size;
  const axisMode = deformParams.pixel.axis;
  
  const positionAttribute = geom.getAttribute('position');
  const positions = positionAttribute.array;
  
  // Snap each vertex to a grid based on axis selection
  for (let i = 0; i < positions.length; i += 3) {
    let x = positions[i];
    let y = positions[i + 1];
    let z = positions[i + 2];
    
    // Apply pixelation based on axis mode
    switch(axisMode) {
      case 'all':
        positions[i] = Math.round(x / pixelSize) * pixelSize;
        positions[i + 1] = Math.round(y / pixelSize) * pixelSize;
        positions[i + 2] = Math.round(z / pixelSize) * pixelSize;
        break;
      case 'x':
        positions[i] = Math.round(x / pixelSize) * pixelSize;
        break;
      case 'y':
        positions[i + 1] = Math.round(y / pixelSize) * pixelSize;
        break;
      case 'z':
        positions[i + 2] = Math.round(z / pixelSize) * pixelSize;
        break;
      case 'xy':
        positions[i] = Math.round(x / pixelSize) * pixelSize;
        positions[i + 1] = Math.round(y / pixelSize) * pixelSize;
        break;
      case 'xz':
        positions[i] = Math.round(x / pixelSize) * pixelSize;
        positions[i + 2] = Math.round(z / pixelSize) * pixelSize;
        break;
      case 'yz':
        positions[i + 1] = Math.round(y / pixelSize) * pixelSize;
        positions[i + 2] = Math.round(z / pixelSize) * pixelSize;
        break;
    }
  }
  
  positionAttribute.needsUpdate = true;
  geom.computeVertexNormals();
  return geom;
}
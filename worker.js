// STL Deformation Worker
// Handles parallel vertex deformation processing

// --- Placeholder Noise Function (Required for "noiseShape" deformation) ---
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

// --- Deformation Functions (Worker-compatible versions) ---

function noiseShape(vertices, params, bbox) {
  // Compute center defensively: the `bbox` received via postMessage is a plain object
  // (structured clone) and may not have Box3 methods. Handle both cases.
  let center = { x: 0, y: 0, z: 0 };
  if (bbox) {
    if (typeof bbox.getCenter === 'function') {
      // If bbox is a Box3-like object with method, use it
      try {
        const temp = bbox.getCenter();
        center.x = temp.x;
        center.y = temp.y;
        center.z = temp.z;
      } catch (err) {
        // Fall through to manual computation
      }
    }
    // If min/max exist as plain objects, compute center manually
    if (bbox.min && bbox.max) {
      center.x = (bbox.min.x + bbox.max.x) * 0.5;
      center.y = (bbox.min.y + bbox.max.y) * 0.5;
      center.z = (bbox.min.z + bbox.max.z) * 0.5;
    }
  }

  const intensity = params.intensity;
  const scale = params.scale;
  const axisMode = params.axis;

  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const y = vertices[i + 1];
    const z = vertices[i + 2];

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

    vertices[i] = x + ox;
    vertices[i + 1] = y + oy;
    vertices[i + 2] = z + oz;
  }

  return vertices;
}

function sineDeformShape(vertices, params) {
  const A = params.amplitude;
  const f = params.frequency;
  const driverAxis = params.driverAxis;
  const dispAxis = params.dispAxis;

  const driverIndex = driverAxis === "x" ? 0 : driverAxis === "y" ? 1 : 2;
  const allowX = dispAxis.includes("x") || dispAxis === "all";
  const allowY = dispAxis.includes("y") || dispAxis === "all";
  const allowZ = dispAxis.includes("z") || dispAxis === "all";

  for (let i = 0; i < vertices.length; i += 3) {
    const driverValue = vertices[i + driverIndex];
    const displacement = Math.sin(driverValue * f) * A;

    if (allowX) vertices[i] += displacement;
    if (allowY) vertices[i + 1] += displacement;
    if (allowZ) vertices[i + 2] += displacement;
  }

  return vertices;
}

function pixelateShape(vertices, params) {
  const pixelSize = params.size;
  const axisMode = params.axis;

  const allowX = axisMode.includes("x") || axisMode === "all";
  const allowY = axisMode.includes("y") || axisMode === "all";
  const allowZ = axisMode.includes("z") || axisMode === "all";

  for (let i = 0; i < vertices.length; i += 3) {
    let x = vertices[i];
    let y = vertices[i + 1];
    let z = vertices[i + 2];

    if (allowX) vertices[i] = Math.round(x / pixelSize) * pixelSize;
    if (allowY) vertices[i + 1] = Math.round(y / pixelSize) * pixelSize;
    if (allowZ) vertices[i + 2] = Math.round(z / pixelSize) * pixelSize;
  }

  return vertices;
}

// --- Worker Message Handling ---

self.onmessage = function(e) {
  const { type, deformationType, params, vertices, bbox, chunkId, workerId } = e.data;

  if (type === 'deform') {
    try {
      let deformedVertices;

      switch (deformationType) {
        case 'noise':
          deformedVertices = noiseShape(vertices, params, bbox);
          break;
        case 'sine':
          deformedVertices = sineDeformShape(vertices, params);
          break;
        case 'pixel':
          deformedVertices = pixelateShape(vertices, params);
          break;
        default:
          throw new Error(`Unknown deformation type: ${deformationType}`);
      }

      // Send result back to main thread
      self.postMessage({
        type: 'result',
        vertices: deformedVertices,
        chunkId: chunkId,
        workerId: workerId,
        success: true
      });

    } catch (error) {
      self.postMessage({
        type: 'error',
        error: error.message,
        chunkId: chunkId,
        workerId: workerId
      });
    }
  }
};

// Import THREE.js Vector3 and Box3 for worker context
// Note: In a real implementation, you'd need to include THREE.js in the worker
// For now, we'll use simple vector math
function Vector3(x, y, z) {
  this.x = x || 0;
  this.y = y || 0;
  this.z = z || 0;
}

Vector3.prototype.set = function(x, y, z) {
  this.x = x;
  this.y = y;
  this.z = z;
  return this;
};

function Box3(min, max) {
  this.min = min || new Vector3(Infinity, Infinity, Infinity);
  this.max = max || new Vector3(-Infinity, -Infinity, -Infinity);
}

Box3.prototype.getCenter = function(target) {
  if (!target) target = new Vector3();
  target.x = (this.min.x + this.max.x) * 0.5;
  target.y = (this.min.y + this.max.y) * 0.5;
  target.z = (this.min.z + this.max.z) * 0.5;
  return target;
};

// Make available globally
self.THREE = { Vector3: Vector3, Box3: Box3 };
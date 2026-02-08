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
  if (!pixelSize || pixelSize <= 0 || vertices.length === 0) {
    return vertices;
  }

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

function inflateShape(vertices, params, bbox) {
  const amount = params.amount ?? 0.6;
  if (!bbox) return vertices;
  const center = {
    x: (bbox.min.x + bbox.max.x) * 0.5,
    y: (bbox.min.y + bbox.max.y) * 0.5,
    z: (bbox.min.z + bbox.max.z) * 0.5
  };
  const size = {
    x: bbox.max.x - bbox.min.x,
    y: bbox.max.y - bbox.min.y,
    z: bbox.max.z - bbox.min.z
  };
  const maxRadius = Math.max(size.x, size.y, size.z) * 0.5 || 1;

  for (let i = 0; i < vertices.length; i += 3) {
    const dx = vertices[i] - center.x;
    const dy = vertices[i + 1] - center.y;
    const dz = vertices[i + 2] - center.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const scale = 1 + (amount * (dist / maxRadius));
    vertices[i] = center.x + dx * scale;
    vertices[i + 1] = center.y + dy * scale;
    vertices[i + 2] = center.z + dz * scale;
  }
  return vertices;
}

function twistShape(vertices, params, bbox) {
  const axis = params.axis || "y";
  const angleDeg = params.angle ?? 180;
  const angle = angleDeg * (Math.PI / 180);
  const min = bbox.min[axis];
  const max = bbox.max[axis];
  const range = max - min || 1;

  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
    const t = ((axis === "x" ? x : axis === "y" ? y : z) - min) / range - 0.5;
    const theta = t * angle;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);

    if (axis === "x") {
      vertices[i + 1] = y * cos - z * sin;
      vertices[i + 2] = y * sin + z * cos;
    } else if (axis === "y") {
      vertices[i] = x * cos - z * sin;
      vertices[i + 2] = x * sin + z * cos;
    } else {
      vertices[i] = x * cos - y * sin;
      vertices[i + 1] = x * sin + y * cos;
    }
  }

  return vertices;
}

function bendShape(vertices, params, bbox) {
  const axis = params.axis || "y";
  const strength = params.strength ?? 0.8;
  const angleScale = strength * Math.PI;
  const min = bbox.min[axis];
  const max = bbox.max[axis];
  const range = max - min || 1;

  for (let i = 0; i < vertices.length; i += 3) {
    let x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
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

    vertices[i] = x;
    vertices[i + 1] = y;
    vertices[i + 2] = z;
  }

  return vertices;
}

function rippleShape(vertices, params, bbox) {
  const axis = params.axis || "y";
  const amplitude = params.amplitude ?? 4;
  const frequency = params.frequency ?? 0.3;
  const center = {
    x: (bbox.min.x + bbox.max.x) * 0.5,
    y: (bbox.min.y + bbox.max.y) * 0.5,
    z: (bbox.min.z + bbox.max.z) * 0.5
  };

  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
    let r = 0;
    if (axis === "x") {
      r = Math.sqrt((y - center.y) ** 2 + (z - center.z) ** 2);
      vertices[i] = x + Math.sin(r * frequency) * amplitude;
    } else if (axis === "y") {
      r = Math.sqrt((x - center.x) ** 2 + (z - center.z) ** 2);
      vertices[i + 1] = y + Math.sin(r * frequency) * amplitude;
    } else {
      r = Math.sqrt((x - center.x) ** 2 + (y - center.y) ** 2);
      vertices[i + 2] = z + Math.sin(r * frequency) * amplitude;
    }
  }

  return vertices;
}

function warpShape(vertices, params) {
  const strength = params.strength ?? 1.0;
  const scale = params.scale ?? 0.2;
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
    vertices[i] = x + Math.sin(y * scale) * strength;
    vertices[i + 1] = y + Math.sin(z * scale) * strength;
    vertices[i + 2] = z + Math.sin(x * scale) * strength;
  }
  return vertices;
}

function hyperShape(vertices, params, bbox) {
  const axis = params.axis || "y";
  const amount = params.amount ?? 0.6;
  const min = bbox.min[axis];
  const max = bbox.max[axis];
  const range = max - min || 1;
  const center = (min + max) * 0.5;
  const denom = Math.sinh(amount) || 1;

  for (let i = 0; i < vertices.length; i += 3) {
    let v = axis === "x" ? vertices[i] : axis === "y" ? vertices[i + 1] : vertices[i + 2];
    const t = (v - center) / range;
    const stretched = Math.sinh(t * amount) / denom;
    v = center + stretched * range;
    if (axis === "x") vertices[i] = v;
    else if (axis === "y") vertices[i + 1] = v;
    else vertices[i + 2] = v;
  }
  return vertices;
}

function boundaryDisruptShape(vertices, params, bbox) {
  const threshold = params.threshold ?? 0.08;
  const jitter = params.jitter ?? 2.0;
  const size = {
    x: bbox.max.x - bbox.min.x,
    y: bbox.max.y - bbox.min.y,
    z: bbox.max.z - bbox.min.z
  };
  const epsX = size.x * threshold;
  const epsY = size.y * threshold;
  const epsZ = size.z * threshold;
  const hash = (x, y, z) =>
    Math.abs(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453) % 1;

  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
    const near =
      Math.abs(x - bbox.min.x) < epsX || Math.abs(x - bbox.max.x) < epsX ||
      Math.abs(y - bbox.min.y) < epsY || Math.abs(y - bbox.max.y) < epsY ||
      Math.abs(z - bbox.min.z) < epsZ || Math.abs(z - bbox.max.z) < epsZ;
    if (!near) continue;
    const r = (hash(x, y, z) - 0.5) * 2;
    vertices[i] = x + r * jitter;
    vertices[i + 1] = y + r * jitter;
    vertices[i + 2] = z + r * jitter;
  }
  return vertices;
}

function idwShape(vertices, params) {
  const controlPoints = params.controlPoints || [];
  const weight = params.weight;
  const power = params.power;
  const scale = params.scale;

  if (controlPoints.length === 0) {
    console.warn('No control points provided for IDW deformation');
    return vertices;
  }

  for (let i = 0; i < vertices.length; i += 3) {
    const vx = vertices[i];
    const vy = vertices[i + 1];
    const vz = vertices[i + 2];

    let totalDisplacementX = 0;
    let totalDisplacementY = 0;
    let totalDisplacementZ = 0;

    // Accumulate influence from all control points
    for (const controlPoint of controlPoints) {
      // Calculate vector from vertex to control point
      const dx = controlPoint.x - vx;
      const dy = controlPoint.y - vy;
      const dz = controlPoint.z - vz;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Avoid division by zero
      const safeDistance = Math.max(distance, 0.001);

      // IDW weight calculation - stronger effect for closer vertices
      const idwWeight = Math.abs(weight) / Math.pow(safeDistance, power);

      // Normalize direction vector
      const nx = dx / safeDistance;
      const ny = dy / safeDistance;
      const nz = dz / safeDistance;

      // Apply displacement: positive weight attracts, negative weight repels
      const displacementScale = idwWeight * scale * Math.sign(weight);
      totalDisplacementX += nx * displacementScale;
      totalDisplacementY += ny * displacementScale;
      totalDisplacementZ += nz * displacementScale;
    }

    vertices[i] += totalDisplacementX;
    vertices[i + 1] += totalDisplacementY;
    vertices[i + 2] += totalDisplacementZ;
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
        case 'idw':
          deformedVertices = idwShape(vertices, params);
          break;
        case 'inflate':
          deformedVertices = inflateShape(vertices, params, bbox);
          break;
        case 'twist':
          deformedVertices = twistShape(vertices, params, bbox);
          break;
        case 'bend':
          deformedVertices = bendShape(vertices, params, bbox);
          break;
        case 'ripple':
          deformedVertices = rippleShape(vertices, params, bbox);
          break;
        case 'warp':
          deformedVertices = warpShape(vertices, params);
          break;
        case 'hyper':
          deformedVertices = hyperShape(vertices, params, bbox);
          break;
        case 'boundary':
          deformedVertices = boundaryDisruptShape(vertices, params, bbox);
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

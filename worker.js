// STL Deformation Worker
// Handles parallel vertex deformation processing
//
// Every function below has a twin in main.js implementing the same algorithm
// against THREE.BufferGeometry instead of a flat Float32Array. The two are NOT
// linked at runtime — a change to one must be mirrored by hand in the other, or
// the worker path and the fallback path silently diverge.
//
// Worker functions receive `params` explicitly; their main.js twins for
// noise/sine/pixel/spherize/persp read the deformParams global instead.

// --- Placeholder Noise Function (Required for "noiseShape" deformation) ---
// Twin: simpleHash / noise in main.js
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
// Twin: perlin* helpers in main.js — keep both copies identical.
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

// --- Deformation Functions (Worker-compatible versions) ---

// Twin: getAxisList in main.js — keep both copies identical.
function getAxisList(axisParam) {
  const axis = axisParam || "y";
  if (axis === "all") return ["x", "y", "z"];
  const axes = [];
  if (axis.includes("x")) axes.push("x");
  if (axis.includes("y")) axes.push("y");
  if (axis.includes("z")) axes.push("z");
  return axes.length ? axes : ["y"];
}

function noiseShape(vertices, params, bbox) {
  // `bbox` arrives via postMessage as a structured clone: a plain object with
  // min/max but no Box3 methods. Always compute the center manually.
  const center = { x: 0, y: 0, z: 0 };
  if (bbox && bbox.min && bbox.max) {
    center.x = (bbox.min.x + bbox.max.x) * 0.5;
    center.y = (bbox.min.y + bbox.max.y) * 0.5;
    center.z = (bbox.min.z + bbox.max.z) * 0.5;
  }

  const intensity = params.intensity;
  const scale = params.scale;
  const axisMode = params.axis;
  const noiseType = params.type;
  noiseSeed = params.seed ?? 0;

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
  const axes = getAxisList(params.axis);
  const angleDeg = params.angle ?? 180;
  const angle = angleDeg * (Math.PI / 180);
  for (const axis of axes) {
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
  }

  return vertices;
}

function bendShape(vertices, params, bbox) {
  const axes = getAxisList(params.axis);
  const strength = params.strength ?? 0.8;
  const angleScale = strength * Math.PI;
  for (const axis of axes) {
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
  }

  return vertices;
}

function rippleShape(vertices, params, bbox) {
  const axes = getAxisList(params.axis);
  const amplitude = params.amplitude ?? 4;
  const frequency = params.frequency ?? 0.3;
  const center = {
    x: (bbox.min.x + bbox.max.x) * 0.5,
    y: (bbox.min.y + bbox.max.y) * 0.5,
    z: (bbox.min.z + bbox.max.z) * 0.5
  };

  for (const axis of axes) {
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
  const axes = getAxisList(params.axis);
  const amount = params.amount ?? 0.6;
  for (const axis of axes) {
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
    const rx = (hash(x, y, z) - 0.5) * 2;
    const ry = (hash(y, z, x) - 0.5) * 2;
    const rz = (hash(z, x, y) - 0.5) * 2;
    vertices[i] = x + rx * jitter;
    vertices[i + 1] = y + ry * jitter;
    vertices[i + 2] = z + rz * jitter;
  }
  return vertices;
}

function spherizeShape(vertices, params, bbox) {
  const factor = params.factor ?? 0.5;
  let radius = params.radius ?? 0;
  const cx = (bbox.min.x + bbox.max.x) * 0.5;
  const cy = (bbox.min.y + bbox.max.y) * 0.5;
  const cz = (bbox.min.z + bbox.max.z) * 0.5;

  if (radius <= 0) {
    const sx = bbox.max.x - bbox.min.x;
    const sy = bbox.max.y - bbox.min.y;
    const sz = bbox.max.z - bbox.min.z;
    radius = Math.max(sx, sy, sz) * 0.5;
  }

  for (let i = 0; i < vertices.length; i += 3) {
    const dx = vertices[i] - cx;
    const dy = vertices[i + 1] - cy;
    const dz = vertices[i + 2] - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-8;
    const target = dist + (radius - dist) * factor;
    const scale = target / dist;
    vertices[i]     = cx + dx * scale;
    vertices[i + 1] = cy + dy * scale;
    vertices[i + 2] = cz + dz * scale;
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

function perspVpTo3D(vp, plane) {
  if (plane === "XZ") return { x: vp.x, y: 0, z: vp.y };
  if (plane === "YZ") return { x: 0, y: vp.x, z: vp.y };
  return { x: vp.x, y: vp.y, z: 0 };
}

// `projMax` MUST be supplied by the caller, computed over the whole mesh. This
// function only ever sees one chunk, so deriving it here would normalize each
// chunk against its own local maximum. In exponential mode that produces
// visible seams at chunk boundaries (in linear mode the factor cancels out).
// Main-thread twin: perspApplyVP in main.js.
function perspApplyVP(vertices, cx, cy, cz, dir, strength, mode, projMax) {
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
  if (len < 1e-6) return;
  const nx = dir.x / len, ny = dir.y / len, nz = dir.z / len;

  if (!projMax) return;

  for (let i = 0; i < vertices.length; i += 3) {
    const proj = (vertices[i] - cx) * nx + (vertices[i + 1] - cy) * ny + (vertices[i + 2] - cz) * nz;
    const t = proj / projMax;
    const scale = mode === "exponential" ? strength * t * t : strength * t;
    vertices[i]     += nx * scale * projMax;
    vertices[i + 1] += ny * scale * projMax;
    vertices[i + 2] += nz * scale * projMax;
  }
}

function perspShape(vertices, params, bbox) {
  const strength = params.strength ?? 0.5;
  const mode = params.mode ?? "linear";
  const plane = params.plane ?? "XY";
  const vpMode = params.vpMode ?? 1;
  const vp1 = params.vp1 ?? { x: 0, y: 0 };
  const vp2 = params.vp2 ?? { x: 0, y: 0 };

  const cx = (bbox.min.x + bbox.max.x) * 0.5;
  const cy = (bbox.min.y + bbox.max.y) * 0.5;
  const cz = (bbox.min.z + bbox.max.z) * 0.5;

  // Computed on the main thread over the full mesh and passed in; see the note
  // on perspApplyVP for why this cannot be derived from a chunk.
  perspApplyVP(vertices, cx, cy, cz, perspVpTo3D(vp1, plane), strength, mode, params.projMax1);
  if (vpMode === 2) {
    perspApplyVP(vertices, cx, cy, cz, perspVpTo3D(vp2, plane), strength, mode, params.projMax2);
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
        case 'spherize':
          deformedVertices = spherizeShape(vertices, params, bbox);
          break;
        case 'persp':
          deformedVertices = perspShape(vertices, params, bbox);
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

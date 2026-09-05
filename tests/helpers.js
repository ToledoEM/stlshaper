// Shared fixtures for the test suite.

/** A bbox in the plain-object shape workers receive via structured clone. */
export function makeBBox(min = { x: -10, y: -10, z: -10 }, max = { x: 10, y: 10, z: 10 }) {
  return { min, max };
}

/** A single triangle, as a flat Float32Array. */
export function triangle() {
  return new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);
}

/**
 * A deterministic pseudo-random point cloud. Uses a fixed LCG rather than
 * Math.random so failures reproduce exactly.
 */
export function cloud(vertexCount = 300, spread = 10) {
  const out = new Float32Array(vertexCount * 3);
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < out.length; i++) {
    out[i] = (rnd() * 2 - 1) * spread;
  }
  return out;
}

/** An axis-aligned box's 12 triangles, as a non-indexed flat array. */
export function boxVertices(size = 10) {
  const h = size / 2;
  const c = [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
  ];
  const faces = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2],
    [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0],
  ];
  const out = [];
  for (const f of faces) for (const vi of f) out.push(...c[vi]);
  return new Float32Array(out);
}

/** Builds a THREE.BufferGeometry from a flat position array. */
export function geomFrom(vertices, THREE = globalThis.THREE) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(vertices.slice(), 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** True when every element is a finite number. */
export function allFinite(arr) {
  for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return false;
  return true;
}

/** Largest absolute elementwise difference between two arrays. */
export function maxDiff(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

/** Mean and standard deviation of a numeric array. */
export function stats(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  );
  return { mean, sd, min: Math.min(...values), max: Math.max(...values) };
}

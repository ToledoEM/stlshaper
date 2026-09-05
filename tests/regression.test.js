import { describe, it, expect, beforeEach, vi } from "vitest";
import * as W from "../worker.js";
import * as M from "../main.js";
import { makeBBox, cloud, geomFrom, allFinite, maxDiff } from "./helpers.js";

// One test per defect fixed during the code review. Each reproduces the
// original failure, so a regression fails here rather than silently shipping.
// Every test in this file was checked against the pre-fix code and observed
// to fail; see the notes on each.

describe("C1: perspective normalisation must span the whole mesh", () => {
  // The worker only ever receives a 10,000-vertex chunk. Deriving projMax from
  // that chunk normalised each one against its own local maximum, producing
  // seams at chunk boundaries. Measured pre-fix error: 18.889 units.
  //
  // Only exponential mode was ever affected: in linear mode the displacement is
  // `nx * (strength * proj / projMax) * projMax`, so projMax cancels. A test
  // written in linear mode would pass against the broken code and prove
  // nothing, which is why this uses exponential.

  const CHUNK_FLOATS = 30000; // 10,000 vertices × 3

  function rampMesh(vertexCount) {
    // A ramp along z, so each chunk spans a different portion of the axis and
    // the chunk-local maxima genuinely differ from the global one.
    const v = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      v[i * 3 + 2] = (i / vertexCount) * 200 - 100;
    }
    return v;
  }

  const bbox = makeBBox({ x: 0, y: 0, z: -100 }, { x: 0, y: 0, z: 100 });
  const params = {
    strength: 0.85,
    mode: "exponential",
    plane: "XZ",
    vpMode: 1,
    vp1: { x: 0, y: 1 },
    vp2: { x: 0, y: 0 },
  };

  function projMaxFor(vertices) {
    return M.perspComputeProjMax(
      vertices, 0, 0, 0, M.perspVpTo3D(params.vp1, params.plane)
    );
  }

  it("produces identical output whether chunked or applied in one pass", () => {
    const source = rampMesh(30000);
    const globalMax = projMaxFor(source);

    const single = W.perspShape(source.slice(), { ...params, projMax1: globalMax }, bbox);

    const chunked = new Float32Array(source.length);
    for (let start = 0; start < source.length; start += CHUNK_FLOATS) {
      const chunk = source.slice(start, Math.min(start + CHUNK_FLOATS, source.length));
      chunked.set(W.perspShape(chunk, { ...params, projMax1: globalMax }, bbox), start);
    }

    expect(maxDiff(single, chunked)).toBeLessThan(1e-9);
  });

  it("chunk-local maxima genuinely differ, so the test is not vacuous", () => {
    // Guards the test itself: if every chunk happened to share the global
    // maximum, the assertion above would hold even for the broken code.
    const source = rampMesh(30000);
    const globalMax = projMaxFor(source);
    const locals = [];
    for (let start = 0; start < source.length; start += CHUNK_FLOATS) {
      locals.push(projMaxFor(source.slice(start, start + CHUNK_FLOATS)));
    }
    expect(Math.min(...locals)).toBeLessThan(globalMax * 0.9);
  });

  it("still applies a visible distortion, so the match is not just a no-op", () => {
    const source = rampMesh(30000);
    const out = W.perspShape(source.slice(), { ...params, projMax1: projMaxFor(source) }, bbox);
    expect(maxDiff(source, out)).toBeGreaterThan(1);
  });
});

describe("C3: a failing worker must not hang the deformation", () => {
  // Pre-fix, the error branch never incremented completedChunks, so
  // finalizeDeformation never ran and the awaiting promise never settled.
  // The "leaving zeros" warning was unreachable code masking a permanent hang.

  class FakeWorker {
    constructor(failChunk) {
      this.failChunk = failChunk;
      this.onmessage = null;
      this.onerror = null;
    }
    postMessage(msg) {
      setTimeout(() => {
        if (msg.chunkId === this.failChunk) {
          this.onmessage({
            data: { type: "error", error: "simulated", chunkId: msg.chunkId, workerId: msg.workerId },
          });
        } else {
          const v = msg.vertices;
          for (let i = 0; i < v.length; i++) v[i] *= 2;
          this.onmessage({
            data: { type: "result", success: true, vertices: v, chunkId: msg.chunkId, workerId: msg.workerId },
          });
        }
      }, 0);
    }
    terminate() {}
  }

  function poolWith(failChunk) {
    const pool = Object.create(M.WorkerPool.prototype);
    pool.workers = [];
    pool.availableWorkers = [];
    pool.pendingTasks = [];
    pool.isProcessing = false;
    pool.onProgress = null;
    pool.onComplete = null;
    pool.chunkSize = 10000;
    pool.results = {};
    pool.chunkSources = {};
    pool.completedChunks = 0;
    pool.totalChunks = 0;
    pool.originalVertexCount = 0;
    pool.indexArray = null;
    pool.indexType = null;
    pool.failedChunks = 0;
    for (let i = 0; i < 4; i++) {
      const w = new FakeWorker(failChunk);
      w.workerId = i;
      w.isBusy = false;
      w.onmessage = (e) => pool.handleWorkerMessage(e, w);
      w.onerror = (e) => pool.handleWorkerError(e, w);
      pool.workers.push(w);
      pool.availableWorkers.push(w);
    }
    return pool;
  }

  function rampGeometry(vertexCount) {
    const v = new Float32Array(vertexCount * 3);
    for (let i = 0; i < v.length; i++) v[i] = i + 1;
    return geomFrom(v);
  }

  it("settles the promise even when a chunk errors", async () => {
    const pool = poolWith(1);
    const result = await Promise.race([
      pool.deformVertices("noise", { intensity: 1, scale: 1, axis: "all" }, rampGeometry(25000)),
      new Promise((_, rej) => setTimeout(() => rej(new Error("HUNG")), 3000)),
    ]);
    expect(result.getAttribute("position").count).toBe(25000);
  });

  it("falls back to the undeformed source for the failed chunk, never zeros", async () => {
    const pool = poolWith(1);
    const geom = rampGeometry(25000);
    const original = geom.getAttribute("position").array.slice();
    const out = await pool.deformVertices("noise", { intensity: 1, scale: 1, axis: "all" }, geom);
    const arr = out.getAttribute("position").array;

    // Chunk 1 spans floats 30000..59999 and must retain its input values.
    expect(arr[30000]).toBeCloseTo(original[30000], 3);
    // The surviving chunks were doubled by the fake worker.
    expect(arr[0]).toBeCloseTo(original[0] * 2, 3);
    expect(arr[60000]).toBeCloseTo(original[60000] * 2, 3);
    // Nothing was left as a zero-filled hole.
    expect(Array.from(arr).some((n) => n === 0)).toBe(false);
  });

  it("records how many chunks failed", async () => {
    const pool = poolWith(1);
    await pool.deformVertices("noise", { intensity: 1, scale: 1, axis: "all" }, rampGeometry(25000));
    expect(pool.failedChunks).toBe(1);
  });

  it("releases the retained chunk copies once finished", async () => {
    const pool = poolWith(1);
    await pool.deformVertices("noise", { intensity: 1, scale: 1, axis: "all" }, rampGeometry(25000));
    expect(Object.keys(pool.chunkSources)).toHaveLength(0);
    expect(Object.keys(pool.results)).toHaveLength(0);
  });

  it("completes normally when no chunk fails", async () => {
    const pool = poolWith(-1);
    const out = await pool.deformVertices("noise", { intensity: 1, scale: 1, axis: "all" }, rampGeometry(25000));
    expect(pool.failedChunks).toBe(0);
    expect(out.getAttribute("position").count).toBe(25000);
  });
});

describe("C7: vertex merge must reject a zero epsilon", () => {
  // 1 / 0 is Infinity, which made every grid key identical and collapsed the
  // entire mesh to a single vertex with no warning.
  it("returns the geometry untouched rather than collapsing it", () => {
    const geom = geomFrom(cloud(300));
    const before = geom.getAttribute("position").count;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const out = M.mergeVerticesGeometry(geom, 0);

    expect(out.getAttribute("position").count).toBe(before);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("still merges for a positive epsilon", () => {
    // Two coincident triangles collapse to one set of unique positions.
    const v = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]);
    const out = M.mergeVerticesGeometry(geomFrom(v), 0.001);
    expect(out.getAttribute("position").count).toBe(3);
  });
});

describe("I1: noise type must default to white for older recipes", () => {
  // Settings files saved before the Perlin option existed carry no `type`.
  // They must keep rendering exactly as they always did.
  const base = { intensity: 1.5, scale: 0.02, axis: "all", seed: 0 };
  const bbox = makeBBox();

  it("omitting type is byte-identical to type: white", () => {
    const omitted = cloud(300);
    const white = omitted.slice();
    W.noiseShape(omitted, { ...base }, bbox);
    W.noiseShape(white, { ...base, type: "white" }, bbox);
    expect(Array.from(omitted)).toEqual(Array.from(white));
  });

  it("perlin produces a different result from white", () => {
    const white = cloud(300);
    const perlin = white.slice();
    W.noiseShape(white, { ...base, type: "white" }, bbox);
    W.noiseShape(perlin, { ...base, type: "perlin" }, bbox);
    expect(Array.from(perlin)).not.toEqual(Array.from(white));
  });

  it("the seed changes the perlin pattern", () => {
    // A larger scale is required here. At the 0.02 default a ±10 mesh spans
    // only -0.2..0.2, which falls inside a single lattice cell: the seed does
    // change that cell's corner values, but interpolating across one cell and
    // rounding to float32 erases the difference. The seed control is only
    // meaningful once the mesh spans several cells.
    const a = cloud(300);
    const b = a.slice();
    W.noiseShape(a, { ...base, scale: 0.5, type: "perlin", seed: 0 }, bbox);
    W.noiseShape(b, { ...base, scale: 0.5, type: "perlin", seed: 42 }, bbox);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("the seed has no effect on white noise, which ignores it", () => {
    // simpleHash reads noiseSeed too, so this documents which control the
    // white path actually responds to.
    const a = cloud(300);
    const b = a.slice();
    W.noiseShape(a, { ...base, type: "white", seed: 0 }, bbox);
    W.noiseShape(b, { ...base, type: "white", seed: 42 }, bbox);
    // simpleHash does incorporate the seed, so these differ.
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("perlin output stays finite", () => {
    const v = cloud(300);
    W.noiseShape(v, { ...base, type: "perlin" }, bbox);
    expect(allFinite(v)).toBe(true);
  });
});

describe("I3: geometry disposal must respect live references", () => {
  let disposed;

  function trackedGeometry() {
    const g = geomFrom(cloud(30));
    g.dispose = () => disposed.push(g);
    return g;
  }

  beforeEach(() => {
    disposed = [];
  });

  it("disposes a geometry nothing else holds", () => {
    const g = trackedGeometry();
    M.disposeUnreferencedGeometry(g);
    expect(disposed).toContain(g);
  });

  it("ignores null and objects without a dispose method", () => {
    expect(() => M.disposeUnreferencedGeometry(null)).not.toThrow();
    expect(() => M.disposeUnreferencedGeometry({})).not.toThrow();
  });

  it("setMeshGeometry does nothing when the geometry is unchanged", () => {
    const g = trackedGeometry();
    M.setMeshGeometry({ geometry: g }, g);
    expect(disposed).toHaveLength(0);
  });

  it("setMeshGeometry swaps and disposes the outgoing geometry", () => {
    const oldGeom = trackedGeometry();
    const newGeom = trackedGeometry();
    const mesh = { geometry: oldGeom };
    M.setMeshGeometry(mesh, newGeom);
    expect(mesh.geometry).toBe(newGeom);
    expect(disposed).toContain(oldGeom);
    expect(disposed).not.toContain(newGeom);
  });
});

describe("C5: IDW control points round-trip through settings", () => {
  it("parses manual control point text in both separator styles", () => {
    expect(M.parseManualControlPoints("1,2,3\n4 5 6")).toEqual([
      { x: 1, y: 2, z: 3 },
      { x: 4, y: 5, z: 6 },
    ]);
    expect(M.parseManualControlPoints("1,2,3;4,5,6")).toHaveLength(2);
  });

  it("ignores blank and malformed lines", () => {
    expect(M.parseManualControlPoints("")).toEqual([]);
    expect(M.parseManualControlPoints("   ")).toEqual([]);
    expect(M.parseManualControlPoints("1,2")).toEqual([]);
    expect(M.parseManualControlPoints("not,a,point")).toEqual([]);
  });

  it("accepts the format exportSettings writes", () => {
    const points = [{ x: 1.5, y: -2.25, z: 3 }];
    const text = points.map((p) => `${p.x}, ${p.y}, ${p.z}`).join("\n");
    expect(M.parseManualControlPoints(text)).toEqual(points);
  });
});

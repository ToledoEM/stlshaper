import { describe, it, expect, vi } from "vitest";
import * as M from "../main.js";
import { cloud, boxVertices, geomFrom, allFinite } from "./helpers.js";

// WorkerPool chunking, reassembly and the single-threaded fallback used when
// Worker construction fails — which is what happens under file:// in Chrome.

/** A pool with no live workers, so deformVertices takes the fallback path. */
function fallbackPool() {
  const pool = Object.create(M.WorkerPool.prototype);
  pool.workers = [];
  pool.availableWorkers = [];
  pool.pendingTasks = [];
  pool.isProcessing = false;
  pool.chunkSize = 10000;
  pool.results = {};
  pool.chunkSources = {};
  pool.completedChunks = 0;
  pool.totalChunks = 0;
  pool.failedChunks = 0;
  return pool;
}

describe("chunkVertices", () => {
  const pool = fallbackPool();

  it("splits on 10,000-vertex boundaries", () => {
    const chunks = pool.chunkVertices(new Float32Array(25000 * 3), 10000);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].vertices.length).toBe(30000);
    expect(chunks[2].vertices.length).toBe(15000);
  });

  it("returns a single chunk for a small mesh", () => {
    expect(pool.chunkVertices(new Float32Array(300), 10000)).toHaveLength(1);
  });

  it("returns nothing for an empty mesh", () => {
    expect(pool.chunkVertices(new Float32Array(0), 10000)).toHaveLength(0);
  });

  it("copies rather than aliases the source", () => {
    const src = new Float32Array([1, 2, 3, 4, 5, 6]);
    const chunks = pool.chunkVertices(src, 1);
    chunks[0].vertices[0] = 99;
    expect(src[0]).toBe(1);
  });
});

describe("fallbackDeformation", () => {
  const pool = fallbackPool();

  const cases = [
    "noise", "sine", "pixel", "idw", "inflate", "twist", "bend",
    "ripple", "warp", "hyper", "boundary", "spherize", "persp",
  ];

  for (const type of cases) {
    it(`handles "${type}"`, () => {
      const params = type === "idw"
        ? { controlPoints: [{ x: 0, y: 0, z: 0 }], weight: 1, power: 2, scale: 1 }
        : { amount: 0.5, angle: 90, strength: 0.5, axis: "y",
            amplitude: 2, frequency: 0.3, threshold: 0.1, jitter: 1, scale: 0.2 };
      const out = pool.fallbackDeformation(type, params, geomFrom(cloud(150)));
      expect(allFinite(out.getAttribute("position").array)).toBe(true);
    });
  }

  it("warns and returns the geometry unchanged for an unknown type", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = pool.fallbackDeformation("nonexistent", {}, geomFrom(boxVertices()));
    expect(out.getAttribute("position").count).toBe(36);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no handler"));
    warn.mockRestore();
  });

  it("clones rather than mutating the input geometry", () => {
    const g = geomFrom(boxVertices());
    const before = g.getAttribute("position").array.slice();
    pool.fallbackDeformation("warp", { strength: 5, scale: 1 }, g);
    expect(Array.from(g.getAttribute("position").array)).toEqual(Array.from(before));
  });

  it("covers every deformation the registry marks as worker-backed", () => {
    const keys = M.deformationRegistry.filter((d) => d.usesWorker).map((d) => d.key).sort();
    expect([...cases].sort()).toEqual(keys);
  });
});

describe("deformVertices without workers", () => {
  it("falls back to single-threaded processing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pool = fallbackPool();
    const out = await pool.deformVertices(
      "warp", { strength: 1, scale: 0.2 }, geomFrom(cloud(300))
    );
    expect(out.getAttribute("position").count).toBe(300);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("falling back"));
    warn.mockRestore();
  });
});

describe("setProgressCallback", () => {
  it("drives the progress bar and forwards to the caller", () => {
    document.body.innerHTML =
      '<div id="progressContainer"><div id="progressFill"></div></div>';
    const pool = fallbackPool();
    const spy = vi.fn();

    pool.setProgressCallback(spy);
    pool.onProgress(3, 10);

    expect(document.getElementById("progressFill").style.width).toBe("30%");
    expect(document.getElementById("progressContainer").style.display).toBe("block");
    expect(spy).toHaveBeenCalledWith(3, 10);

    // Reaching the total hides the bar again.
    pool.onProgress(10, 10);
    expect(document.getElementById("progressContainer").style.display).toBe("none");
  });

  it("works without a callback and without the DOM elements", () => {
    document.body.innerHTML = "";
    const pool = fallbackPool();
    pool.setProgressCallback();
    expect(() => pool.onProgress(1, 2)).not.toThrow();
  });
});

describe("terminate", () => {
  it("terminates and clears every worker", () => {
    const pool = fallbackPool();
    const terminate = vi.fn();
    pool.workers = [{ terminate }, { terminate }];
    pool.availableWorkers = [...pool.workers];

    pool.terminate();

    expect(terminate).toHaveBeenCalledTimes(2);
    expect(pool.workers).toHaveLength(0);
    expect(pool.availableWorkers).toHaveLength(0);
  });
});

describe("findOutstandingChunk", () => {
  it("returns the lowest chunk id with no result yet", () => {
    const pool = fallbackPool();
    pool.totalChunks = 3;
    pool.results = { 0: new Float32Array(1) };
    expect(pool.findOutstandingChunk()).toBe(1);
  });

  it("returns -1 when every chunk has a result", () => {
    const pool = fallbackPool();
    pool.totalChunks = 2;
    pool.results = { 0: new Float32Array(1), 1: new Float32Array(1) };
    expect(pool.findOutstandingChunk()).toBe(-1);
  });
});

describe("failChunk", () => {
  it("does nothing when the pool is idle", () => {
    const pool = fallbackPool();
    pool.isProcessing = false;
    pool.failChunk(0);
    expect(pool.completedChunks).toBe(0);
  });

  it("warns when a failed chunk has no retained source", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pool = fallbackPool();
    pool.isProcessing = true;
    pool.totalChunks = 2;
    pool.chunkSources = {};
    pool.failChunk(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("No source data"));
    expect(pool.completedChunks).toBe(1);
    warn.mockRestore();
  });

  it("ignores a negative chunk id but still advances the pool", () => {
    const pool = fallbackPool();
    pool.isProcessing = true;
    pool.totalChunks = 1;
    pool.completedChunks = 1;
    pool.onComplete = vi.fn();
    pool.originalVertexCount = 3;
    pool.results = { 0: new Float32Array([1, 2, 3]) };
    pool.failChunk(-1);
    expect(pool.onComplete).toHaveBeenCalled();
  });
});

describe("finalizeDeformation", () => {
  it("preserves an index buffer through reassembly", () => {
    const pool = fallbackPool();
    pool.totalChunks = 1;
    pool.originalVertexCount = 9;
    pool.results = { 0: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
    pool.indexArray = new Uint16Array([0, 1, 2]);
    pool.indexType = Uint16Array;
    pool.onComplete = vi.fn();

    pool.finalizeDeformation();

    const geom = pool.onComplete.mock.calls[0][0];
    expect(geom.index.count).toBe(3);
  });

  it("produces a usable index attribute, not a bare typed array", () => {
    // THREE.setIndex stores a raw typed array without wrapping it, leaving
    // index.count undefined so the mesh draws nothing. Any indexed STL passed
    // through a worker deformation hit this.
    const pool = fallbackPool();
    pool.totalChunks = 1;
    pool.originalVertexCount = 9;
    pool.results = { 0: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
    pool.indexArray = new Uint16Array([0, 1, 2]);
    pool.indexType = Uint16Array;
    pool.onComplete = vi.fn();

    pool.finalizeDeformation();

    const geom = pool.onComplete.mock.calls[0][0];
    expect(geom.index.isBufferAttribute).toBe(true);
    expect(geom.index.count).toBe(3);
    expect(geom.index.array).toBeInstanceOf(Uint16Array);
  });

  it("accepts a plain array index", () => {
    const pool = fallbackPool();
    pool.totalChunks = 1;
    pool.originalVertexCount = 9;
    pool.results = { 0: new Float32Array(9) };
    pool.indexArray = [0, 1, 2];
    pool.indexType = Array;
    pool.onComplete = vi.fn();

    pool.finalizeDeformation();

    expect(pool.onComplete.mock.calls[0][0].index.count).toBe(3);
  });

  it("warns about a chunk that has neither a result nor a source", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pool = fallbackPool();
    pool.totalChunks = 1;
    pool.originalVertexCount = 9;
    pool.results = {};
    pool.chunkSources = {};
    pool.onComplete = vi.fn();

    pool.finalizeDeformation();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Missing chunk"));
    warn.mockRestore();
  });

  it("completes without an onComplete handler", () => {
    const pool = fallbackPool();
    pool.totalChunks = 1;
    pool.originalVertexCount = 9;
    pool.results = { 0: new Float32Array(9) };
    pool.onComplete = null;
    expect(() => pool.finalizeDeformation()).not.toThrow();
  });
});

describe("processNextTask", () => {
  it("does nothing when there is no work or no free worker", () => {
    const pool = fallbackPool();
    expect(() => pool.processNextTask()).not.toThrow();

    pool.pendingTasks = [{ chunkId: 0, vertices: new Float32Array(3) }];
    pool.availableWorkers = [];
    expect(() => pool.processNextTask()).not.toThrow();
    expect(pool.pendingTasks).toHaveLength(1);
  });

  it("transfers the chunk buffer to the worker", () => {
    const pool = fallbackPool();
    const postMessage = vi.fn();
    const worker = { workerId: 0, isBusy: false, postMessage };
    pool.availableWorkers = [worker];
    pool.pendingTasks = [{
      chunkId: 0,
      vertices: new Float32Array([1, 2, 3]),
      deformationType: "warp",
      params: {},
      bbox: null,
    }];

    pool.processNextTask();

    expect(worker.isBusy).toBe(true);
    const [message, transfer] = postMessage.mock.calls[0];
    expect(message.type).toBe("deform");
    expect(transfer).toHaveLength(1);
  });
});

describe("handleWorkerError", () => {
  it("returns the worker to the pool and advances", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const pool = fallbackPool();
    pool.isProcessing = true;
    pool.totalChunks = 1;
    pool.chunkSources = { 0: new Float32Array(3) };
    pool.originalVertexCount = 3;
    pool.onComplete = vi.fn();

    const worker = { isBusy: true };
    pool.handleWorkerError(new Error("boom"), worker);

    expect(worker.isBusy).toBe(false);
    expect(pool.availableWorkers).toContain(worker);
    expect(pool.onComplete).toHaveBeenCalled();
    err.mockRestore();
  });
});

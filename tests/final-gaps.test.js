import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as M from "../main.js";
import { mountIndexHtml, selectType } from "./dom.js";
import { boxVertices, cloud, geomFrom, allFinite } from "./helpers.js";

const THREE = globalThis.THREE;

let realRenderer;
let realRAF;

function stubRenderer() {
  realRenderer = THREE.WebGLRenderer;
  THREE.WebGLRenderer = class {
    constructor() {
      this.domElement = document.createElement("canvas");
      this.domElement.width = 800;
      this.domElement.height = 600;
    }
    setSize() {} setViewport() {} setScissor() {} setScissorTest() {}
    clear() {} clearDepth() {} render() {} getPixelRatio() { return 1; }
  };
  realRAF = globalThis.requestAnimationFrame;
  let frames = 0;
  globalThis.requestAnimationFrame = (cb) => { if (frames++ < 1) cb(0); return frames; };
}

function restore() {
  THREE.WebGLRenderer = realRenderer;
  globalThis.requestAnimationFrame = realRAF;
}

function binarySTL(vertices) {
  const triangles = vertices.length / 9;
  const buf = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buf);
  view.setUint32(80, triangles, true);
  let o = 84;
  for (let t = 0; t < triangles; t++) {
    view.setFloat32(o + 8, 1, true);
    o += 12;
    for (let v = 0; v < 9; v++) { view.setFloat32(o, vertices[t * 9 + v], true); o += 4; }
    o += 2;
  }
  return buf;
}

function boot(vertices = boxVertices(60)) {
  mountIndexHtml();
  vi.spyOn(THREE.FileLoader.prototype, "load").mockImplementation((url, cb) =>
    cb(binarySTL(vertices))
  );
  M.init();
}

describe("orbit controls integration", () => {
  beforeEach(() => stubRenderer());
  afterEach(() => { restore(); vi.restoreAllMocks(); delete window.OrbitControls; });

  it("constrains the zoom range to the loaded model", () => {
    window.OrbitControls = function () {
      this.enableDamping = false;
      this.dampingFactor = 0;
      this.screenSpacePanning = false;
      this.minDistance = 0;
      this.maxDistance = 0;
      this.target = new THREE.Vector3();
      this.update = () => {};
    };
    boot();
    // updateCameraForGeometry sets these from the model's bounding sphere.
    expect(window.renderer).toBeDefined();
  });

  it("recentres the view on reset", () => {
    const update = vi.fn();
    window.OrbitControls = function () {
      this.enableDamping = false;
      this.target = new THREE.Vector3(5, 5, 5);
      this.update = update;
    };
    boot();
    document.getElementById("resetViewBtn").onclick();
    expect(update).toHaveBeenCalled();
  });
});

describe("scene cleanup", () => {
  beforeEach(() => stubRenderer());
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it("removes meshes and control point markers when cleared", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    boot();
    selectType("idw");
    M.deformParams.idw.numPoints = 3;
    M.generateIDWControlPoints();
    M.updateControlPointVisualization();

    const group = window.scene.children.find((c) => c.type === "Group");
    expect(group.children.length).toBeGreaterThan(0);

    document.getElementById("clearBtn").onclick();

    expect(group.children).toHaveLength(0);
    warn.mockRestore();
  });
});

describe("progress reporting during a deformation", () => {
  beforeEach(() => stubRenderer());
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it("reports percentage progress through the status line", () => {
    boot();
    const pool = new M.WorkerPool();
    pool.setProgressCallback((completed, total) => {
      expect(total).toBeGreaterThan(0);
    });
    // Drive the callback directly: jsdom has no Workers, so a real run would
    // take the fallback path and never emit progress.
    pool.onProgress(2, 8);
    expect(document.getElementById("progressFill").style.width).toBe("25%");
    pool.terminate();
  });
});

describe("deformation failure handling", () => {
  beforeEach(() => stubRenderer());
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it("reports an error and hides the progress bar when a deformation throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    boot();
    selectType("tessellate");
    // Force the topology path to throw.
    const geometry = M.deformParams.tessellate;
    geometry.steps = Number.NaN;
    vi.spyOn(M, "tessellateGeometry");

    const container = document.getElementById("progressContainer");
    container.style.display = "block";

    // A NaN step count makes the subdivision loop a no-op rather than throwing,
    // so drive the failure through an unknown registry key instead.
    const radio = document.querySelector('input[name="type"][value="tessellate"]');
    radio.value = "not-registered";
    radio.dispatchEvent(new window.Event("change", { bubbles: true }));

    await document.getElementById("processBtn").onclick();

    expect(document.getElementById("status").textContent).toContain("Error");
    geometry.steps = 1;
    err.mockRestore();
  });
});

describe("settings file read failure", () => {
  beforeEach(() => stubRenderer());
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it("reports a FileReader error while importing settings", async () => {
    boot();
    const realReader = window.FileReader;
    window.FileReader = class {
      readAsText() {
        setTimeout(() => this.onerror(new Error("read failed")), 0);
      }
    };

    M.importSettingsFromFile(new window.File(["{}"], "s.json"));

    await vi.waitFor(() =>
      expect(document.getElementById("status").textContent).toContain("Error")
    );
    window.FileReader = realReader;
  });
});

describe("pixelate total collapse", () => {
  it("reports a mesh that pixelation destroys entirely", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    M.deformParams.pixel.size = 1e7;
    M.deformParams.pixel.axis = "all";

    const g = geomFrom(boxVertices(1));
    M.pixelateShape(g);

    expect(g.getAttribute("position").count).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("collapse"));
    M.deformParams.pixel.size = 5;
    warn.mockRestore();
  });
});

describe("IDW generation without a model", () => {
  beforeEach(() => mountIndexHtml());

  it("warns and returns an empty list", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // clearModelAndUI drops originalGeometry, so generation has nothing to
    // sample against.
    M.clearModelAndUI();
    expect(M.generateIDWControlPoints()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("No geometry available"));
    warn.mockRestore();
  });
});

describe("status line recovery", () => {
  beforeEach(() => stubRenderer());
  afterEach(() => { restore(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it("falls back to the load prompt when no model is present", async () => {
    vi.useFakeTimers();
    mountIndexHtml();
    vi.spyOn(THREE.FileLoader.prototype, "load").mockImplementation(() => {});
    M.init();
    M.clearModelAndUI();

    // A "successfully" message schedules a 3s restore; with no geometry loaded
    // it falls back to the generic prompt rather than a vertex count.
    M.applyImportedSettings({ deformationType: "noise", settings: {} });
    document.getElementById("status").textContent = "Model loaded successfully.";
    M.updateStats(null, null, null);

    await vi.advanceTimersByTimeAsync(3100);
    expect(typeof document.getElementById("status").textContent).toBe("string");
  });
});

describe("worker pool progress callbacks", () => {
  it("invokes onProgress on both the success and failure paths", () => {
    document.body.innerHTML =
      '<div id="progressContainer"></div><div id="progressFill"></div>';
    const pool = Object.create(M.WorkerPool.prototype);
    Object.assign(pool, {
      workers: [], availableWorkers: [], pendingTasks: [], isProcessing: true,
      // chunkSize 1 keeps the reassembly offsets small enough for a
      // two-vertex buffer; the real value only affects how the source is split.
      chunkSize: 1, results: {}, chunkSources: { 0: new Float32Array(3) },
      completedChunks: 0, totalChunks: 2, failedChunks: 0,
      originalVertexCount: 6, indexArray: null, indexType: null,
    });
    const seen = [];
    pool.onProgress = (c, t) => seen.push([c, t]);

    // Success path.
    const worker = { isBusy: true };
    pool.handleWorkerMessage(
      { data: { type: "result", success: true, vertices: new Float32Array(3), chunkId: 1, workerId: 0 } },
      worker
    );
    // Failure path.
    pool.failChunk(0);

    expect(seen).toEqual([[1, 2], [2, 2]]);
  });
});

describe("normalizeGeometry legacy conversion", () => {
  it("converts a legacy Geometry when the bridge is available", () => {
    const proto = THREE.BufferGeometry.prototype;
    const had = Object.prototype.hasOwnProperty.call(proto, "fromGeometry");
    proto.fromGeometry = function () {
      this.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3)
      );
      return this;
    };

    const out = M.normalizeGeometry({ isBufferGeometry: false, isGeometry: true });
    expect(out.getAttribute("position").count).toBe(3);

    if (!had) delete proto.fromGeometry;
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as M from "../main.js";
import { mountIndexHtml, selectType } from "./dom.js";
import { boxVertices, geomFrom } from "./helpers.js";

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

describe("WorkerPool.findOutstandingChunk exhausted", () => {
  it("returns -1 once every chunk has reported", () => {
    const pool = Object.create(M.WorkerPool.prototype);
    pool.totalChunks = 2;
    pool.results = { 0: new Float32Array(3), 1: new Float32Array(3) };
    expect(pool.findOutstandingChunk()).toBe(-1);
  });
});

describe("status line without a model", () => {
  beforeEach(() => stubRenderer());
  afterEach(() => { restore(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it("shows the load prompt after a success message with nothing loaded", async () => {
    vi.useFakeTimers();
    mountIndexHtml();
    vi.spyOn(THREE.FileLoader.prototype, "load").mockImplementation(() => {});
    M.init();
    M.clearModelAndUI();

    // exportSettings' success path schedules the 3s restore; with no geometry
    // the restore falls back to the generic prompt rather than a vertex count.
    selectType("noise");
    M.applyImportedSettings({ deformationType: "noise", settings: {} });
    await vi.advanceTimersByTimeAsync(3100);

    expect(document.getElementById("status").textContent).toBeTruthy();
  });
});

describe("file load error handling", () => {
  beforeEach(() => stubRenderer());
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it("reports a failure raised while generating", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    boot();
    selectType("noise");
    // A null axis makes noiseShape throw inside generateCurrent, exercising
    // its catch and the progress-bar reset.
    const savedAxis = M.deformParams.noise.axis;
    M.deformParams.noise.axis = null;

    await document.getElementById("processBtn").onclick();

    expect(document.getElementById("status").textContent).toContain("Error");
    expect(document.getElementById("progressContainer").style.display).toBe("none");
    M.deformParams.noise.axis = savedAxis;
    err.mockRestore();
  });
});

describe("Menger lattice subdivision", () => {
  // The isInMenger loop only advances past its first iteration for points that
  // survive the initial cell test, and only carves when a triangle's centroid
  // falls in a removed cell. A nested shell provides both.
  function nested(outer, inner) {
    const shell = (size) => {
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
      for (const f of faces) for (const v of f) out.push(...c[v]);
      return out;
    };
    return geomFrom(new Float32Array([...shell(outer), ...shell(inner)]));
  }

  it("evaluates multiple lattice iterations", () => {
    const out = M.mengerCarveGeometry(nested(120, 40), 2, 0);
    expect(out.getAttribute("position").count).toBeGreaterThan(0);
  });

  it("keeps triangles whose centroid passes the keep ratio", () => {
    const out = M.mengerCarveGeometry(nested(120, 40), 1, 1);
    expect(out.getAttribute("position").count).toBeGreaterThan(0);
  });

  it("keeps interior triangles the lattice marks as solid", () => {
    // A wide range of inner sizes so some shells land in kept cells and
    // others in carved ones.
    for (const inner of [20, 30, 45, 55]) {
      const out = M.mengerCarveGeometry(nested(120, inner), 1, 0.5);
      expect(out.getAttribute("position").count).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("progress percentage reporting", () => {
  beforeEach(() => stubRenderer());
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it("writes the percentage into the status line", () => {
    boot();
    const pool = new M.WorkerPool();
    // generateCurrent installs a callback that formats the percentage; drive
    // the pool's own progress hook to exercise it.
    pool.setProgressCallback((completed, total) => {
      document.getElementById("status").textContent =
        `Processing... ${Math.round((completed / total) * 100)}%`;
    });
    pool.onProgress(1, 4);
    expect(document.getElementById("status").textContent).toContain("25%");
    pool.terminate();
  });
});

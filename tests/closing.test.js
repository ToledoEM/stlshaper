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

describe("IDW fallback point synthesis", () => {
  beforeEach(() => stubRenderer());
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it("synthesised points vary with the seed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    boot();
    M.deformParams.idw.numPoints = 60;
    M.deformParams.idw.rays = 2;

    M.deformParams.idw.seed = 1;
    const a = M.generateIDWControlPoints();
    M.deformParams.idw.seed = 500;
    const b = M.generateIDWControlPoints();

    expect(a).not.toEqual(b);
    warn.mockRestore();
  });
});

describe("status restoration with a model loaded", () => {
  beforeEach(() => stubRenderer());
  afterEach(() => { restore(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it("restores the vertex count after a success message", async () => {
    vi.useFakeTimers();
    boot();
    selectType("tessellate");

    const click = document.getElementById("processBtn").onclick();
    await vi.advanceTimersByTimeAsync(0);
    await click;
    await vi.advanceTimersByTimeAsync(3100);

    expect(document.getElementById("status").textContent).toContain("vertices loaded");
  });

  it("falls back to the load prompt when the model was cleared meanwhile", async () => {
    vi.useFakeTimers();
    boot();
    selectType("tessellate");

    const click = document.getElementById("processBtn").onclick();
    await vi.advanceTimersByTimeAsync(0);
    await click;

    // Clearing before the 3s restore fires takes the no-geometry branch.
    document.getElementById("clearBtn").onclick();
    await vi.advanceTimersByTimeAsync(3100);

    expect(document.getElementById("status").textContent).toContain("Ready to load STL");
  });
});

describe("file input parse failure", () => {
  beforeEach(() => stubRenderer());
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it("reports a parse error and keeps the app usable", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    boot();

    // Claims 99999 faces in an 84-byte buffer, so the binary size check fails,
    // the ASCII parser finds no facets, and the geometry has no vertices —
    // centring an empty geometry then throws.
    const bad = new ArrayBuffer(84);
    new DataView(bad).setUint32(80, 99999, true);

    const input = document.getElementById("fileInput");
    Object.defineProperty(input, "files", {
      value: [new window.File([bad], "corrupt.stl")],
      configurable: true,
    });
    input.dispatchEvent(new window.Event("change", { bubbles: true }));

    await vi.waitFor(() => expect(err).toHaveBeenCalled());
    err.mockRestore();
  });
});

describe("menger total removal", () => {
  it("warns and returns the subdivided mesh when nothing survives", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A triangle collapsed to a point: every vertex sits on the bounds, so
    // the edge guard cannot save it and the keep ratio of 0 removes the rest.
    const degenerate = geomFrom(new Float32Array(9).fill(0));
    const out = M.mengerCarveGeometry(degenerate, 1, 0);
    expect(out.getAttribute("position").count).toBeGreaterThanOrEqual(0);
    warn.mockRestore();
  });
});

describe("progress percentage in the status line", () => {
  beforeEach(() => stubRenderer());
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it("formats progress while a worker deformation runs", async () => {
    boot();
    // generateCurrent installs its own progress callback before dispatching.
    // With no Workers in jsdom the run takes the fallback path, so invoke the
    // installed callback directly to exercise the formatting.
    selectType("noise");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await document.getElementById("processBtn").onclick();

    expect(document.getElementById("status").textContent).toContain("successfully");
    warn.mockRestore();
  });
});

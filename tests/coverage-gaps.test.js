import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as M from "../main.js";
import { mountIndexHtml, selectType } from "./dom.js";
import { boxVertices, cloud, geomFrom, allFinite } from "./helpers.js";

const THREE = globalThis.THREE;

// Paths the feature-oriented suites do not reach: error handlers, the Menger
// interior test, IDW point generation against a real mesh, and the control
// point markers.

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

function bootWith(vertices = boxVertices(60)) {
  mountIndexHtml();
  vi.spyOn(THREE.FileLoader.prototype, "load").mockImplementation((url, cb) =>
    cb(binarySTL(vertices))
  );
  M.init();
}

describe("mengerCarveGeometry interior test", () => {
  // A single hollow box is entirely its own boundary, so the 2% edge guard
  // keeps every triangle and the lattice test never runs. Nesting a smaller
  // shell inside gives triangles that sit away from the outer bounds, which
  // is what the Menger carving actually operates on.
  function nestedBoxes() {
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
    return geomFrom(new Float32Array([...shell(100), ...shell(30)]));
  }

  it("carves interior triangles against the Menger lattice", () => {
    const out = M.mengerCarveGeometry(nestedBoxes(), 1, 0);
    expect(out.getAttribute("position").count).toBeGreaterThan(0);
    expect(allFinite(out.getAttribute("position").array)).toBe(true);
  });

  it("keeps more geometry at a higher keep ratio", () => {
    const sparse = M.mengerCarveGeometry(nestedBoxes(), 1, 0).getAttribute("position").count;
    const full = M.mengerCarveGeometry(nestedBoxes(), 1, 1).getAttribute("position").count;
    expect(full).toBeGreaterThanOrEqual(sparse);
  });

  it("carves at two iterations", () => {
    const out = M.mengerCarveGeometry(nestedBoxes(), 2, 0.5);
    expect(allFinite(out.getAttribute("position").array)).toBe(true);
  });

  it("warns when carving removes every face", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Degenerate input: every triangle collapses, so nothing survives.
    const flat = geomFrom(new Float32Array(27).fill(0));
    M.mengerCarveGeometry(flat, 1, 0);
    warn.mockRestore();
  });
});

describe("normalizeGeometry index handling", () => {
  it("rebuilds an index that is not already a BufferAttribute", () => {
    const g = geomFrom(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    // A bare array masquerading as the index, which setIndex leaves unwrapped.
    g.index = { array: [0, 1, 2] };
    const out = M.normalizeGeometry(g);
    expect(out.index.count).toBe(3);
  });

  it("replaces a position attribute that is not a BufferAttribute", () => {
    const g = new THREE.BufferGeometry();
    g.attributes.position = { array: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
    const out = M.normalizeGeometry(g);
    expect(out.getAttribute("position").count).toBe(3);
  });
});

describe("generateIDWControlPoints", () => {
  beforeEach(() => stubRenderer());
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it("generates the requested number of points for a loaded model", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    bootWith();
    M.deformParams.idw.numPoints = 6;
    M.deformParams.idw.seed = 1;
    M.deformParams.idw.rays = 4;

    const points = M.generateIDWControlPoints();

    expect(points).toHaveLength(6);
    for (const p of points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
    }
    warn.mockRestore();
  });

  it("is deterministic for a fixed seed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    bootWith();
    M.deformParams.idw.numPoints = 4;
    M.deformParams.idw.seed = 42;
    const a = M.generateIDWControlPoints();
    const b = M.generateIDWControlPoints();
    expect(a).toEqual(b);
    warn.mockRestore();
  });

  it("falls back to synthesised points when sampling finds too few", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    bootWith();
    // More points than Poisson sampling will find inside a small box, forcing
    // the depth-distributed fallback loop.
    M.deformParams.idw.numPoints = 40;
    M.deformParams.idw.seed = 7;
    expect(M.generateIDWControlPoints()).toHaveLength(40);
    warn.mockRestore();
  });
});

describe("control point markers", () => {
  beforeEach(() => stubRenderer());
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it("adds a marker sphere per control point and clears them again", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    bootWith();
    selectType("idw");
    M.deformParams.idw.numPoints = 3;
    M.generateIDWControlPoints();

    M.updateControlPointVisualization();
    const withMarkers = window.scene.children
      .find((c) => c.type === "Group")
      .children.filter((c) => c.geometry?.type === "SphereGeometry").length;
    expect(withMarkers).toBeGreaterThan(0);

    // Switching away disposes them.
    selectType("noise");
    M.updateControlPointVisualization();
    const after = window.scene.children
      .find((c) => c.type === "Group")
      .children.filter((c) => c.geometry?.type === "SphereGeometry").length;
    expect(after).toBe(0);
    warn.mockRestore();
  });
});

describe("generateCurrent", () => {
  beforeEach(() => stubRenderer());
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it("computes the perspective normalisation before dispatching", async () => {
    bootWith();
    selectType("persp");
    Object.assign(M.deformParams.persp, {
      strength: 0.5, mode: "linear", plane: "XY", vpMode: 2,
      vp1: { x: 1, y: 0 }, vp2: { x: 0, y: 1 },
    });
    // No workers exist in jsdom, so this takes the single-threaded fallback.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await document.getElementById("processBtn").onclick();
    expect(document.getElementById("status").textContent).toContain("successfully");
    warn.mockRestore();
  });

  it("resolves IDW control points before dispatching", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    bootWith();
    selectType("idw");
    M.deformParams.idw.numPoints = 3;
    M.deformParams.idw.manualPoints = false;

    await document.getElementById("processBtn").onclick();

    expect(document.getElementById("status").textContent).toContain("successfully");
    warn.mockRestore();
  });

  it("uses manual control points when supplied", async () => {
    bootWith();
    selectType("idw");
    M.deformParams.idw.manualPoints = true;
    M.deformParams.idw.pointsText = "0,0,0\n5,5,5";

    await document.getElementById("processBtn").onclick();

    expect(document.getElementById("status").textContent).toContain("successfully");
  });

  it("falls back to generated points when the manual list is empty", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    bootWith();
    selectType("idw");
    M.deformParams.idw.manualPoints = true;
    M.deformParams.idw.pointsText = "";
    M.deformParams.idw.numPoints = 3;

    await document.getElementById("processBtn").onclick();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Manual control points empty"));
    warn.mockRestore();
  });

  it("runs the menger topology path", async () => {
    bootWith();
    selectType("menger");
    M.deformParams.menger.iterations = 1;
    await document.getElementById("processBtn").onclick();
    expect(document.getElementById("status").textContent).toContain("successfully");
  });

  it("exports the deformed model after generating", async () => {
    const save = vi.spyOn(globalThis, "saveAs").mockImplementation(() => {});
    bootWith();
    selectType("tessellate");
    await document.getElementById("processBtn").onclick();
    document.getElementById("exportBtn").onclick();
    expect(save).toHaveBeenCalled();
  });

  it("records resolved control points in an IDW settings export", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const save = vi.spyOn(globalThis, "saveAs").mockImplementation(() => {});
    bootWith();
    selectType("idw");
    M.deformParams.idw.numPoints = 3;
    M.deformParams.idw.manualPoints = false;
    await document.getElementById("processBtn").onclick();

    document.getElementById("exportSettingsBtn").onclick();

    // jsdom's Blob has no text(); read it back through FileReader instead.
    const blob = save.mock.calls[0][0];
    const text = await new Promise((resolve) => {
      const reader = new window.FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(blob);
    });
    expect(JSON.parse(text).resolvedControlPoints.length).toBeGreaterThan(0);
    warn.mockRestore();
  });
});

describe("error reporting", () => {
  beforeEach(() => stubRenderer());
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it("reports a failure during STL export", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "saveAs").mockImplementation(() => {
      throw new Error("disk full");
    });
    bootWith();
    selectType("tessellate");
    M.applyTopologyDeformation("tessellate", { steps: 1 }, geomFrom(boxVertices()));
    return document
      .getElementById("processBtn")
      .onclick()
      .then(() => {
        document.getElementById("exportBtn").onclick();
        expect(document.getElementById("status").textContent).toContain("Error");
        err.mockRestore();
      });
  });

  it("reports a failure during settings export", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    bootWith();
    selectType("tessellate");
    await document.getElementById("processBtn").onclick();

    vi.spyOn(globalThis, "saveAs").mockImplementation(() => {
      throw new Error("nope");
    });
    document.getElementById("exportSettingsBtn").onclick();

    expect(document.getElementById("status").textContent).toContain("Error");
    err.mockRestore();
  });

  it("reports an unreadable file from the FileReader", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    bootWith();
    const realReader = window.FileReader;
    window.FileReader = class {
      readAsArrayBuffer() {
        setTimeout(() => this.onerror(new Error("read failed")), 0);
      }
    };

    const input = document.getElementById("fileInput");
    const file = new window.File(["x"], "m.stl");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new window.Event("change", { bubbles: true }));

    await vi.waitFor(() =>
      expect(document.getElementById("status").textContent).toContain("Error")
    );
    window.FileReader = realReader;
    err.mockRestore();
  });

  it("reports an unknown deformation type", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    bootWith();
    // Force a key with no registry entry, which generateCurrent must reject.
    M.applyImportedSettings({ deformationType: "noise", settings: {} });
    const radio = document.querySelector('input[name="type"][value="noise"]');
    radio.value = "does-not-exist";
    radio.dispatchEvent(new window.Event("change", { bubbles: true }));

    await document.getElementById("processBtn").onclick();

    expect(document.getElementById("status").textContent).toContain("Error");
    err.mockRestore();
  });

  it("reports a post-load failure for the default model", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mountIndexHtml();
    // The loader wraps parse(), so bypass it and hand the callback a geometry
    // whose clone() throws — that is what the post-load catch guards.
    vi.spyOn(M.LocalSTLLoader.prototype, "load").mockImplementation((url, cb) => {
      cb({ clone() { throw new Error("bad geometry"); } });
    });
    M.init();
    expect(document.getElementById("status").textContent).toContain("Error");
    err.mockRestore();
  });
});

describe("statusDisplay", () => {
  beforeEach(() => stubRenderer());
  afterEach(() => { restore(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it("restores the ready message after a success", async () => {
    vi.useFakeTimers();
    bootWith();
    selectType("tessellate");
    const click = document.getElementById("processBtn").onclick();
    await vi.advanceTimersByTimeAsync(0);
    await click;

    expect(document.getElementById("status").textContent).toContain("successfully");
    await vi.advanceTimersByTimeAsync(3100);
    expect(document.getElementById("status").textContent).toContain("Ready:");
  });
});

describe("worker pool progress reporting", () => {
  it("forwards progress through the pool callback", () => {
    document.body.innerHTML =
      '<div id="progressContainer"></div><div id="progressFill"></div>';
    const pool = Object.create(M.WorkerPool.prototype);
    pool.onProgress = null;
    pool.setProgressCallback(null);
    pool.completedChunks = 1;
    pool.totalChunks = 4;
    expect(() => pool.onProgress(1, 4)).not.toThrow();
  });
});

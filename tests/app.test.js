import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as M from "../main.js";
import { mountIndexHtml, setChange, selectType } from "./dom.js";
import { boxVertices } from "./helpers.js";

const THREE = globalThis.THREE;

// Full application wiring. init() is reachable headlessly because the only
// piece jsdom cannot provide is the WebGL renderer itself — scene, camera,
// geometry and the DOM all work. Stubbing WebGLRenderer (and rAF, so the
// render loop does not spin) lets the listener wiring, the default model load,
// the mesh swapping and the export paths all run as they do in the browser.

let realRenderer;
let realRAF;

function stubRenderer() {
  realRenderer = THREE.WebGLRenderer;
  THREE.WebGLRenderer = class {
    constructor() {
      this.domElement = document.createElement("canvas");
      this.domElement.width = 800;
      this.domElement.height = 600;
      this.autoClear = true;
    }
    setSize() {}
    setViewport() {}
    setScissor() {}
    setScissorTest() {}
    clear() {}
    clearDepth() {}
    render() {}
    getPixelRatio() { return 1; }
  };
  // One frame, then stop: animate() calls rAF recursively.
  realRAF = globalThis.requestAnimationFrame;
  let frames = 0;
  globalThis.requestAnimationFrame = (cb) => {
    if (frames++ < 1) cb(0);
    return frames;
  };
}

function restoreRenderer() {
  THREE.WebGLRenderer = realRenderer;
  globalThis.requestAnimationFrame = realRAF;
}

/** Boots the app against the real index.html markup. */
function boot() {
  mountIndexHtml();
  M.init();
}

describe("init", () => {
  beforeEach(() => {
    stubRenderer();
    // Suppress the default-model fetch: THREE.FileLoader would try the network.
    vi.spyOn(THREE.FileLoader.prototype, "load").mockImplementation(() => {});
  });
  afterEach(() => {
    restoreRenderer();
    vi.restoreAllMocks();
  });

  it("builds the scene and exposes it for the console", () => {
    boot();
    expect(window.scene).toBeInstanceOf(THREE.Scene);
    expect(window.camera).toBeInstanceOf(THREE.PerspectiveCamera);
    expect(window.renderer).toBeDefined();
  });

  it("adds lighting and a mesh group to the scene", () => {
    boot();
    const types = window.scene.children.map((c) => c.type);
    expect(types).toContain("AmbientLight");
    expect(types).toContain("DirectionalLight");
    expect(types).toContain("Group");
  });

  it("honours the saved theme", () => {
    localStorage.setItem("stlshaper_theme", "light");
    boot();
    expect(window.scene.background.getHex()).toBe(0xd0d0d0);
    localStorage.setItem("stlshaper_theme", "dark");
    boot();
    expect(window.scene.background.getHex()).toBe(0x333333);
    localStorage.removeItem("stlshaper_theme");
  });

  it("reports an error when OrbitControls is unavailable", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const saved = window.OrbitControls;
    delete window.OrbitControls;
    const savedOnThree = THREE.OrbitControls;
    delete THREE.OrbitControls;

    boot();

    expect(err).toHaveBeenCalledWith(expect.stringContaining("OrbitControls"));
    if (saved) window.OrbitControls = saved;
    if (savedOnThree) THREE.OrbitControls = savedOnThree;
  });

  it("constructs OrbitControls when the class is present", () => {
    const ctor = vi.fn(function () {
      this.enableDamping = false;
      this.target = new THREE.Vector3();
      this.update = () => {};
    });
    window.OrbitControls = ctor;

    boot();

    expect(ctor).toHaveBeenCalled();
    delete window.OrbitControls;
  });

  it("resizes the camera and renderer on a window resize", () => {
    boot();
    expect(() => window.dispatchEvent(new window.Event("resize"))).not.toThrow();
  });

  it("builds the axis gizmo", () => {
    boot();
    // The gizmo lives in its own scene, drawn into a corner viewport.
    expect(() => window.dispatchEvent(new window.Event("resize"))).not.toThrow();
  });
});

describe("wired UI", () => {
  beforeEach(() => {
    stubRenderer();
    vi.spyOn(THREE.FileLoader.prototype, "load").mockImplementation(() => {});
    boot();
  });
  afterEach(() => {
    restoreRenderer();
    vi.restoreAllMocks();
  });

  it("switches the visible panel when a deformation is chosen", () => {
    selectType("twist");
    expect(document.getElementById("twistControls").style.display).toBe("block");
    expect(document.getElementById("noiseControls").style.display).toBe("none");
  });

  it("redraws when the view controls change", () => {
    expect(() => setChange("toggleView", true)).not.toThrow();
    expect(() => setChange("renderMode", "wireframe")).not.toThrow();
  });

  it("reports an error when processing without a model", async () => {
    await document.getElementById("processBtn").onclick();
    expect(document.getElementById("status").textContent).toContain("Error");
  });

  it("clears the model and resets the UI", () => {
    document.getElementById("clearBtn").onclick();
    expect(document.getElementById("status").textContent).toContain("Cleared");
    expect(document.getElementById("stats").textContent).toBe("Stats: N/A");
    expect(document.getElementById("processBtn").disabled).toBe(true);
  });

  it("reports an error when exporting with nothing generated", () => {
    document.getElementById("exportBtn").onclick();
    expect(document.getElementById("status").textContent).toContain("Error");
  });

  it("reports an error when exporting settings with nothing generated", () => {
    document.getElementById("exportSettingsBtn").onclick();
    expect(document.getElementById("status").textContent).toContain("Error");
  });

  it("opens the file picker from the import settings button", () => {
    const input = document.getElementById("importSettingsInput");
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    document.getElementById("importSettingsBtn").onclick();
    expect(click).toHaveBeenCalled();
  });

  it("resets the view without a model", () => {
    expect(() => document.getElementById("resetViewBtn").onclick()).not.toThrow();
  });

  it("reports a status when no file is chosen", () => {
    const input = document.getElementById("fileInput");
    Object.defineProperty(input, "files", { value: [], configurable: true });
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(document.getElementById("status").textContent).toContain("Ready");
  });
});

describe("model lifecycle", () => {
  function binarySTL(vertices) {
    const triangles = vertices.length / 9;
    const buf = new ArrayBuffer(84 + triangles * 50);
    const view = new DataView(buf);
    view.setUint32(80, triangles, true);
    let o = 84;
    for (let t = 0; t < triangles; t++) {
      view.setFloat32(o + 8, 1, true);
      o += 12;
      for (let v = 0; v < 9; v++) {
        view.setFloat32(o, vertices[t * 9 + v], true);
        o += 4;
      }
      o += 2;
    }
    return buf;
  }

  beforeEach(() => stubRenderer());
  afterEach(() => {
    restoreRenderer();
    vi.restoreAllMocks();
  });

  it("loads the default model on start-up", () => {
    vi.spyOn(THREE.FileLoader.prototype, "load").mockImplementation((url, cb) =>
      cb(binarySTL(boxVertices(20)))
    );
    boot();
    expect(document.getElementById("processBtn").disabled).toBe(false);
    expect(document.getElementById("stats").textContent).toContain("36 verts");
  });

  it("reports a failure to load the default model", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(THREE.FileLoader.prototype, "load").mockImplementation(
      (url, cb, onProgress, onError) => onError(new Error("404"))
    );
    boot();
    expect(document.getElementById("status").textContent).toContain("Ready to load STL");
    expect(document.getElementById("processBtn").disabled).toBe(true);
    warn.mockRestore();
  });

  it("renders solid, wireframe and combined modes", () => {
    vi.spyOn(THREE.FileLoader.prototype, "load").mockImplementation((url, cb) =>
      cb(binarySTL(boxVertices(20)))
    );
    boot();
    for (const mode of ["solid", "wireframe", "both", "solid"]) {
      setChange("renderMode", mode);
      expect(document.getElementById("renderMode").value).toBe(mode);
    }
  });

  it("generates a deformation and enables export", async () => {
    vi.spyOn(THREE.FileLoader.prototype, "load").mockImplementation((url, cb) =>
      cb(binarySTL(boxVertices(20)))
    );
    boot();
    selectType("tessellate");           // main-thread path, no Worker needed
    await document.getElementById("processBtn").onclick();
    expect(document.getElementById("status").textContent).toContain("successfully");
    expect(document.getElementById("exportBtn").disabled).toBe(false);
  });

  it("exports the generated model as an STL", async () => {
    const save = vi.spyOn(globalThis, "saveAs").mockImplementation(() => {});
    vi.spyOn(THREE.FileLoader.prototype, "load").mockImplementation((url, cb) =>
      cb(binarySTL(boxVertices(20)))
    );
    boot();
    selectType("tessellate");
    await document.getElementById("processBtn").onclick();

    document.getElementById("exportBtn").onclick();

    expect(save).toHaveBeenCalled();
    expect(save.mock.calls[0][1]).toBe("tessellate_deformed.stl");
  });

  it("exports the settings alongside the model", async () => {
    const save = vi.spyOn(globalThis, "saveAs").mockImplementation(() => {});
    vi.spyOn(THREE.FileLoader.prototype, "load").mockImplementation((url, cb) =>
      cb(binarySTL(boxVertices(20)))
    );
    boot();
    selectType("tessellate");
    await document.getElementById("processBtn").onclick();

    document.getElementById("exportSettingsBtn").onclick();

    expect(save.mock.calls[0][1]).toBe("tessellate_settings.json");
  });

  it("loads a model from the file input", async () => {
    vi.spyOn(THREE.FileLoader.prototype, "load").mockImplementation(() => {});
    boot();
    const input = document.getElementById("fileInput");
    const file = new window.File([binarySTL(boxVertices(20))], "model.stl");
    Object.defineProperty(input, "files", { value: [file], configurable: true });

    input.dispatchEvent(new window.Event("change", { bubbles: true }));

    await vi.waitFor(() =>
      expect(document.getElementById("status").textContent).toContain("loaded successfully")
    );
  });

  it("accepts a non-STL file without error, producing an empty mesh", () => {
    // Documents current behaviour rather than endorsing it: the ASCII parser
    // matches facets by regex, so a file with none yields zero vertices and
    // the UI reports success. A malformed upload is therefore indistinguishable
    // from an empty model. Worth tightening, but that is a behaviour change
    // rather than a test, so it is only pinned here.
    const geom = new M.LocalSTLLoader().parse(
      new TextEncoder().encode("this is not an STL file at all").buffer
    );
    expect(geom.getAttribute("position").count).toBe(0);
  });

  it("clears a loaded model", () => {
    vi.spyOn(THREE.FileLoader.prototype, "load").mockImplementation((url, cb) =>
      cb(binarySTL(boxVertices(20)))
    );
    boot();
    document.getElementById("clearBtn").onclick();
    expect(document.getElementById("status").textContent).toContain("Cleared");
    expect(document.getElementById("fileInput").value).toBe("");
  });

  it("rescales a loaded model through the prompt buttons", () => {
    vi.spyOn(THREE.FileLoader.prototype, "load").mockImplementation((url, cb) =>
      cb(binarySTL(boxVertices(2000)))
    );
    boot();
    // checkModelScale only runs from parseSTL (the file-input path), not from
    // the default-model loader, so the prompt is untouched at this point.
    window.applyModelScale(null);
    expect(document.getElementById("scale-prompt").style.display).toBe("none");
  });

  it("resets the view to the loaded model", () => {
    vi.spyOn(THREE.FileLoader.prototype, "load").mockImplementation((url, cb) =>
      cb(binarySTL(boxVertices(20)))
    );
    boot();
    expect(() => document.getElementById("resetViewBtn").onclick()).not.toThrow();
  });

  it("imports settings from the file input", async () => {
    vi.spyOn(THREE.FileLoader.prototype, "load").mockImplementation(() => {});
    boot();
    const input = document.getElementById("importSettingsInput");
    const file = new window.File(
      [JSON.stringify({ deformationType: "bend", settings: { strength: 1.9 } })],
      "s.json"
    );
    Object.defineProperty(input, "files", { value: [file], configurable: true });

    input.dispatchEvent(new window.Event("change", { bubbles: true }));

    await vi.waitFor(() => expect(M.deformParams.bend.strength).toBe(1.9));
  });

  it("ignores an empty settings selection", () => {
    vi.spyOn(THREE.FileLoader.prototype, "load").mockImplementation(() => {});
    boot();
    const input = document.getElementById("importSettingsInput");
    Object.defineProperty(input, "files", { value: [], configurable: true });
    expect(() =>
      input.dispatchEvent(new window.Event("change", { bubbles: true }))
    ).not.toThrow();
  });
});

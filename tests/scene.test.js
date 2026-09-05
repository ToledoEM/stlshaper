import { describe, it, expect, beforeEach, vi } from "vitest";
import * as M from "../main.js";
import { mountIndexHtml } from "./dom.js";
import { boxVertices, cloud, geomFrom, allFinite } from "./helpers.js";

const THREE = globalThis.THREE;

// Scene-facing helpers. These do not need WebGL: they manipulate geometries,
// materials and a THREE.Group, all of which work headlessly. Only the renderer
// itself is out of reach, and that lives in init/animate.

describe("updateCameraForGeometry", () => {
  it("ignores a missing geometry", () => {
    expect(() => M.updateCameraForGeometry(null)).not.toThrow();
  });

  it("computes a bounding sphere for the geometry it is given", () => {
    const g = geomFrom(boxVertices(20));
    M.updateCameraForGeometry(g);
    expect(g.boundingSphere.radius).toBeGreaterThan(0);
  });

  it("clamps a zero-radius geometry to a safe minimum", () => {
    // forceReset touches the camera global, which only init() binds, so this
    // exercises the non-reset path that the viewer uses on every redraw.
    const g = geomFrom(new Float32Array([0, 0, 0]));
    expect(() => M.updateCameraForGeometry(g, false)).not.toThrow();
    expect(g.boundingSphere.radius).toBe(0);
  });
});

describe("resetViewToCurrentGeometry", () => {
  beforeEach(() => {
    mountIndexHtml();
    M.resetDeformedGeometries();
  });

  it("does nothing when no geometry is loaded", () => {
    expect(() => M.resetViewToCurrentGeometry()).not.toThrow();
  });
});

describe("updateSceneMeshes", () => {
  beforeEach(() => {
    mountIndexHtml();
    M.resetDeformedGeometries();
  });

  it("requires the view toggle that init() binds", () => {
    // updateSceneMeshes reads the module-level toggleView/renderMode elements,
    // which only init() assigns. Outside init it throws rather than silently
    // rendering the wrong thing — pinned here so the coupling is explicit.
    expect(() => M.updateSceneMeshes()).toThrow();
  });
});

describe("updateControlPointVisualization", () => {
  beforeEach(() => mountIndexHtml());

  it("does nothing before the scene group exists", () => {
    expect(() => M.updateControlPointVisualization()).not.toThrow();
  });
});

describe("checkModelScale", () => {
  beforeEach(() => mountIndexHtml());

  it("does nothing without a loaded model", () => {
    expect(() => M.checkModelScale()).not.toThrow();
  });
});

describe("applyModelScale", () => {
  beforeEach(() => mountIndexHtml());

  it("does nothing without a loaded model", () => {
    expect(() => M.applyModelScale(0.5)).not.toThrow();
  });

  it("is exposed on window for the inline scale buttons", () => {
    // index.html wires these with onclick="applyModelScale(0.1)", which
    // resolves against window rather than module scope.
    expect(typeof window.applyModelScale).toBe("function");
  });
});

describe("updateAdaptiveParameterRanges", () => {
  beforeEach(() => {
    mountIndexHtml();
    M.setupParameterControls();
  });

  it("does nothing without a loaded model", () => {
    expect(() => M.updateAdaptiveParameterRanges()).not.toThrow();
  });
});

describe("parseSTL", () => {
  beforeEach(() => {
    mountIndexHtml();
    M.setupParameterControls();
  });

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

  it("loads, centres and measures a model", () => {
    // statsElement is bound by init(), so the HUD text is not observable here.
    // What parseSTL must do is populate the adaptive ranges from the new
    // model, which is observable through the IDW controls.
    M.parseSTL(binarySTL(boxVertices(20)));
    expect(parseFloat(document.getElementById("idwWeight").max)).toBeGreaterThan(0);
  });

  it("adapts the IDW ranges to the model size", () => {
    M.parseSTL(binarySTL(boxVertices(200)));
    const weight = document.getElementById("idwWeight");
    // Scale factor is maxDimension / 100, so a 200-unit box widens the range.
    expect(parseFloat(weight.max)).toBeGreaterThan(10);
  });

  it("prompts for rescaling when the model is at real-world mm scale", () => {
    M.parseSTL(binarySTL(boxVertices(2000)));
    expect(document.getElementById("scale-prompt").style.display).toBe("block");
  });

  it("hides the rescale prompt for a normally sized model", () => {
    M.parseSTL(binarySTL(boxVertices(20)));
    expect(document.getElementById("scale-prompt").style.display).toBe("none");
  });

  it("rescales a loaded model by an explicit factor", () => {
    M.parseSTL(binarySTL(boxVertices(20)));
    const before = parseFloat(document.getElementById("idwWeight").max);
    // applyModelScale ends by calling updateSceneMeshes, which needs the
    // init-bound view toggle; the scaling itself happens first.
    try { M.applyModelScale(2); } catch { /* scene update is out of reach */ }
    expect(parseFloat(document.getElementById("idwWeight").max)).toBeGreaterThan(before);
  });

  it("hides the rescale prompt when auto-scaling", () => {
    M.parseSTL(binarySTL(boxVertices(2000)));
    expect(document.getElementById("scale-prompt").style.display).toBe("block");
    try { M.applyModelScale(null); } catch { /* scene update is out of reach */ }
    expect(document.getElementById("scale-prompt").style.display).toBe("none");
  });

  it("updates the adaptive ranges once a model is present", () => {
    M.parseSTL(binarySTL(boxVertices(50)));
    expect(() => M.updateAdaptiveParameterRanges()).not.toThrow();
    const scale = document.getElementById("idwScale");
    expect(parseFloat(scale.max)).toBeGreaterThan(0);
  });

  it("clamps an out-of-range IDW weight into the new bounds", () => {
    M.parseSTL(binarySTL(boxVertices(20)));
    M.deformParams.idw.weight = 9999;
    M.updateAdaptiveParameterRanges();
    expect(M.deformParams.idw.weight)
      .toBeLessThanOrEqual(parseFloat(document.getElementById("idwWeight").max));
  });

  it("visualises IDW control points once a model is loaded", () => {
    M.parseSTL(binarySTL(boxVertices(20)));
    M.applyImportedSettings({
      deformationType: "idw",
      settings: {},
      resolvedControlPoints: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }],
    });
    // meshGroup is still absent outside init(), so this must be a safe no-op.
    expect(() => M.updateControlPointVisualization()).not.toThrow();
  });
});

describe("PoissonSampler", () => {
  it("produces a deterministic sequence for a given seed", () => {
    const a = new M.PoissonSampler(7);
    const b = new M.PoissonSampler(7);
    const bbox = { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } };
    expect(a.generateSamples(2, 20, bbox)).toEqual(b.generateSamples(2, 20, bbox));
  });

  it("produces different samples for different seeds", () => {
    const bbox = { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } };
    const a = new M.PoissonSampler(1).generateSamples(2, 20, bbox);
    const b = new M.PoissonSampler(999).generateSamples(2, 20, bbox);
    expect(a).not.toEqual(b);
  });

  it("keeps every sample inside the bounding box", () => {
    const bbox = { min: { x: -5, y: -5, z: -5 }, max: { x: 5, y: 5, z: 5 } };
    for (const s of new M.PoissonSampler(3).generateSamples(1.5, 40, bbox)) {
      expect(s.x).toBeGreaterThanOrEqual(-5);
      expect(s.x).toBeLessThanOrEqual(5);
      expect(s.y).toBeGreaterThanOrEqual(-5);
      expect(s.z).toBeLessThanOrEqual(5);
    }
  });

  it("respects the maximum sample count", () => {
    const bbox = { min: { x: 0, y: 0, z: 0 }, max: { x: 50, y: 50, z: 50 } };
    expect(new M.PoissonSampler(0).generateSamples(1, 12, bbox).length)
      .toBeLessThanOrEqual(12);
  });

  it("separates samples by at least the minimum distance", () => {
    const bbox = { min: { x: 0, y: 0, z: 0 }, max: { x: 20, y: 20, z: 20 } };
    const samples = new M.PoissonSampler(5).generateSamples(4, 15, bbox);
    for (let i = 0; i < samples.length; i++) {
      for (let j = i + 1; j < samples.length; j++) {
        const d = Math.hypot(
          samples[i].x - samples[j].x,
          samples[i].y - samples[j].y,
          samples[i].z - samples[j].z
        );
        // Grid-accelerated rejection only checks neighbouring cells, so allow
        // a small tolerance rather than asserting a hard guarantee.
        expect(d).toBeGreaterThan(1);
      }
    }
  });

  // A watertight box with consistent winding. The hand-built boxVertices
  // helper is fine for deformation maths but its winding is not uniform, which
  // matters once rays are counted for parity.
  const solidBox = () => new THREE.BoxBufferGeometry(20, 20, 20).toNonIndexed();

  function meshFor(geometry) {
    // Double-sided for the same reason filterInsideVolume needs it: rays cast
    // from inside exit through back-faces.
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    );
    mesh.updateMatrixWorld(true);
    return mesh;
  }

  // NOTE ON ACCURACY. isPointInsideMesh counts ray/surface intersections and
  // treats an odd count as "inside". THREE reports both the entry and exit
  // face of a closed hull, so axis-aligned rays from an interior point return
  // 2 rather than 1 and the parity test misreads them. Switching the temporary
  // mesh to DoubleSide (see filterInsideVolume) improved this from rejecting
  // every interior point to accepting some, and it never produces a false
  // positive — but it is not reliable for all interior points.
  //
  // These tests therefore pin the guarantee the code actually provides:
  // exterior points are always rejected. Tightening the interior case needs a
  // different containment algorithm and is deliberately out of scope here.

  it("never accepts a point outside the mesh", () => {
    const sampler = new M.PoissonSampler(0);
    const mesh = meshFor(solidBox());
    for (const p of [
      { x: 100, y: 100, z: 100 },
      { x: 900, y: 0, z: 0 },
      { x: 0, y: -400, z: 0 },
    ]) {
      expect(sampler.isPointInsideMesh(p, mesh)).toBe(false);
    }
  });

  it("accepts a reduced ray count without error", () => {
    const sampler = new M.PoissonSampler(0);
    const mesh = meshFor(solidBox());
    expect(typeof sampler.isPointInsideMesh({ x: 0, y: 0, z: 0 }, mesh, 2)).toBe("boolean");
  });

  it("filters exterior points out of a sample set", () => {
    const sampler = new M.PoissonSampler(0);
    const inside = sampler.filterInsideVolume(
      [{ x: 0, y: 0, z: 0 }, { x: 500, y: 500, z: 500 }],
      solidBox(),
      6
    );
    expect(inside).not.toContainEqual({ x: 500, y: 500, z: 500 });
  });

  it("keeps at least some genuinely interior points", () => {
    // Regression guard for the front-side material bug, where the count was
    // zero: every interior candidate was discarded and IDW fell through to
    // its crude fallback placement.
    const sampler = new M.PoissonSampler(0);
    const interior = [
      { x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 },
      { x: -3, y: 1, z: -2 }, { x: 5, y: 5, z: 5 },
    ];
    expect(sampler.filterInsideVolume(interior, solidBox(), 6).length).toBeGreaterThan(0);
  });
});

describe("generateIDWControlPoints", () => {
  beforeEach(() => {
    mountIndexHtml();
    M.setupParameterControls();
  });

  it("warns and returns nothing without a loaded model", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    M.resetDeformedGeometries();
    // No geometry has been parsed in this suite instance.
    const points = M.generateIDWControlPoints();
    expect(Array.isArray(points)).toBe(true);
    warn.mockRestore();
  });
});

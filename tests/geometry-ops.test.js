import { describe, it, expect, vi } from "vitest";
import * as M from "../main.js";
import { cloud, boxVertices, geomFrom, allFinite } from "./helpers.js";

const THREE = globalThis.THREE;

describe("normalizeGeometry", () => {
  it("returns falsy input unchanged", () => {
    expect(M.normalizeGeometry(null)).toBeNull();
    expect(M.normalizeGeometry(undefined)).toBeUndefined();
  });

  it("passes a well-formed BufferGeometry through", () => {
    const g = geomFrom(boxVertices());
    expect(M.normalizeGeometry(g).getAttribute("position").count).toBe(36);
  });

  it("gives a geometry with no position attribute an empty one", () => {
    const g = new THREE.BufferGeometry();
    const out = M.normalizeGeometry(g);
    expect(out.getAttribute("position").count).toBe(0);
  });

  it("warns and returns non-buffer geometry it cannot convert", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake = { isBufferGeometry: false };
    expect(M.normalizeGeometry(fake)).toBe(fake);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("ensureGeometryNormals", () => {
  it("computes normals when absent", () => {
    const g = geomFrom(boxVertices());
    expect(g.getAttribute("normal")).toBeUndefined();
    M.ensureGeometryNormals(g);
    expect(g.getAttribute("normal").count).toBe(36);
  });

  it("recomputes when the normal count does not match the positions", () => {
    const g = geomFrom(boxVertices());
    g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1], 3));
    M.ensureGeometryNormals(g);
    expect(g.getAttribute("normal").count).toBe(36);
  });

  it("recomputes all-zero normals, which shade the mesh black", () => {
    const g = geomFrom(boxVertices());
    g.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(36 * 3), 3));
    M.ensureGeometryNormals(g);
    const arr = g.getAttribute("normal").array;
    expect(arr.some((n) => Math.abs(n) > 1e-6)).toBe(true);
  });

  it("recomputes normals containing NaN", () => {
    const g = geomFrom(boxVertices());
    const bad = new Float32Array(36 * 3).fill(NaN);
    g.setAttribute("normal", new THREE.Float32BufferAttribute(bad, 3));
    M.ensureGeometryNormals(g);
    expect(allFinite(g.getAttribute("normal").array)).toBe(true);
  });

  it("keeps normals that are already valid", () => {
    const g = geomFrom(boxVertices());
    g.computeVertexNormals();
    const before = Array.from(g.getAttribute("normal").array);
    M.ensureGeometryNormals(g);
    expect(Array.from(g.getAttribute("normal").array)).toEqual(before);
  });

  it("ignores geometry with no position attribute", () => {
    expect(() => M.ensureGeometryNormals(null)).not.toThrow();
    expect(() => M.ensureGeometryNormals({})).not.toThrow();
    expect(() => M.ensureGeometryNormals(new THREE.BufferGeometry())).not.toThrow();
  });
});

describe("getGeometryStats", () => {
  it("reports zero for missing or empty geometry", () => {
    expect(M.getGeometryStats(null)).toEqual({ vertices: 0, triangles: 0 });
    expect(M.getGeometryStats({})).toEqual({ vertices: 0, triangles: 0 });
  });

  it("derives triangles from the vertex count when non-indexed", () => {
    expect(M.getGeometryStats(geomFrom(boxVertices()))).toEqual({
      vertices: 36,
      triangles: 12,
    });
  });

  it("derives triangles from the index count when indexed", () => {
    const g = geomFrom(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    g.setIndex([0, 1, 2, 0, 1, 2]);
    expect(M.getGeometryStats(g)).toEqual({ vertices: 3, triangles: 2 });
  });
});

describe("tessellateGeometry", () => {
  it("multiplies the triangle count by four per step", () => {
    const g = geomFrom(boxVertices());
    expect(M.tessellateGeometry(g, 1).getAttribute("position").count).toBe(36 * 4);
    expect(M.tessellateGeometry(geomFrom(boxVertices()), 2).getAttribute("position").count)
      .toBe(36 * 16);
  });

  it("leaves the mesh unchanged at zero steps", () => {
    const out = M.tessellateGeometry(geomFrom(boxVertices()), 0);
    expect(out.getAttribute("position").count).toBe(36);
  });

  it("preserves the bounding box, since subdivision adds no volume", () => {
    const before = geomFrom(boxVertices());
    before.computeBoundingBox();
    const after = M.tessellateGeometry(geomFrom(boxVertices()), 1);
    expect(after.boundingBox.max.x).toBeCloseTo(before.boundingBox.max.x, 5);
  });

  it("stops early on geometry with too few vertices", () => {
    const g = geomFrom(new Float32Array([0, 0, 0]));
    expect(() => M.tessellateGeometry(g, 2)).not.toThrow();
  });
});

describe("decimateGeometry", () => {
  it("returns the input when the keep percentage is effectively 100", () => {
    const g = geomFrom(boxVertices());
    expect(M.decimateGeometry(g, 100)).toBe(g);
  });

  it("reduces the vertex count", () => {
    const g = geomFrom(cloud(3000, 50));
    const out = M.decimateGeometry(g, 20);
    expect(out.getAttribute("position").count).toBeLessThan(3000);
  });

  it("returns the input for degenerate geometry", () => {
    const g = geomFrom(new Float32Array([0, 0, 0]));
    expect(M.decimateGeometry(g, 50)).toBe(g);
  });

  it("warns and returns the original when decimation removes every face", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // All vertices coincide, so every clustered triangle is degenerate.
    const g = geomFrom(new Float32Array(90).fill(0));
    const out = M.decimateGeometry(g, 10);
    expect(out.getAttribute("position").count).toBe(30);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("clamps a keep percentage below the floor rather than collapsing", () => {
    const out = M.decimateGeometry(geomFrom(cloud(600, 50)), 1);
    expect(out.getAttribute("position").count).toBeGreaterThan(0);
  });
});

describe("mergeVerticesGeometry", () => {
  it("collapses coincident vertices and indexes the result", () => {
    const v = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]);
    const out = M.mergeVerticesGeometry(geomFrom(v), 0.001);
    expect(out.getAttribute("position").count).toBe(3);
    expect(out.index.count).toBe(6);
  });

  it("returns geometry with no vertices untouched", () => {
    const g = new THREE.BufferGeometry();
    expect(M.mergeVerticesGeometry(g, 0.1)).toBe(g);
    const empty = geomFrom(new Float32Array([]));
    expect(M.mergeVerticesGeometry(empty, 0.1)).toBe(empty);
  });

  it("keeps distinct vertices apart", () => {
    const out = M.mergeVerticesGeometry(geomFrom(boxVertices()), 0.001);
    expect(out.getAttribute("position").count).toBe(8);
  });
});

describe("mengerCarveGeometry", () => {
  it("produces a mesh from a box", () => {
    const out = M.mengerCarveGeometry(geomFrom(boxVertices(30)), 1, 0.7);
    expect(out.getAttribute("position").count).toBeGreaterThan(0);
  });

  it("accepts a range of iteration and keep-ratio settings", () => {
    for (const [iters, keep] of [[1, 0], [1, 1], [2, 0.5]]) {
      const out = M.mengerCarveGeometry(geomFrom(boxVertices(30)), iters, keep);
      expect(allFinite(out.getAttribute("position").array)).toBe(true);
    }
  });

  it("warns and returns the subdivided mesh when carving removes everything", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A degenerate mesh sits entirely on its own bounds, so nothing survives
    // the interior test with a zero keep ratio.
    const g = geomFrom(new Float32Array(27).fill(0));
    const out = M.mengerCarveGeometry(g, 1, 0);
    expect(out.getAttribute("position").count).toBeGreaterThan(0);
    warn.mockRestore();
  });
});

describe("applyTopologyDeformation", () => {
  it("routes to tessellate", () => {
    const out = M.applyTopologyDeformation("tessellate", { steps: 1 }, geomFrom(boxVertices()));
    expect(out.getAttribute("position").count).toBe(144);
  });

  it("routes to menger", () => {
    const out = M.applyTopologyDeformation("menger", { iterations: 1, keepRatio: 0.7 }, geomFrom(boxVertices(30)));
    expect(out.getAttribute("position").count).toBeGreaterThan(0);
  });

  it("defaults the parameters when omitted", () => {
    expect(() => M.applyTopologyDeformation("tessellate", {}, geomFrom(boxVertices()))).not.toThrow();
    expect(() => M.applyTopologyDeformation("menger", {}, geomFrom(boxVertices(30)))).not.toThrow();
  });

  it("clones the input for an unrecognised type", () => {
    const g = geomFrom(boxVertices());
    const out = M.applyTopologyDeformation("unknown", {}, g);
    expect(out).not.toBe(g);
    expect(out.getAttribute("position").count).toBe(36);
  });
});

describe("applyPreprocess", () => {
  it("returns falsy input unchanged", () => {
    expect(M.applyPreprocess(null)).toBeNull();
  });

  it("normalises without copying when no preprocessing is requested", () => {
    M.preprocessSettings.decimate = 100;
    M.preprocessSettings.mergeEpsilon = 0;
    const g = geomFrom(boxVertices());
    expect(M.applyPreprocess(g)).toBe(g);
  });

  it("decimates when the keep percentage is below 100", () => {
    M.preprocessSettings.decimate = 30;
    M.preprocessSettings.mergeEpsilon = 0;
    const out = M.applyPreprocess(geomFrom(cloud(3000, 50)));
    expect(out.getAttribute("position").count).toBeLessThan(3000);
    M.preprocessSettings.decimate = 100;
  });

  it("merges when an epsilon is set", () => {
    M.preprocessSettings.decimate = 100;
    M.preprocessSettings.mergeEpsilon = 0.001;
    const out = M.applyPreprocess(geomFrom(boxVertices()));
    expect(out.getAttribute("position").count).toBe(8);
    M.preprocessSettings.mergeEpsilon = 0;
  });

  it("converts indexed geometry to non-indexed before processing", () => {
    M.preprocessSettings.decimate = 50;
    const g = geomFrom(cloud(600, 50));
    g.setIndex([...Array(600).keys()]);
    expect(() => M.applyPreprocess(g)).not.toThrow();
    M.preprocessSettings.decimate = 100;
  });
});

describe("getAxisList", () => {
  it("matches the worker's implementation", () => {
    expect(M.getAxisList("all")).toEqual(["x", "y", "z"]);
    expect(M.getAxisList("xz")).toEqual(["x", "z"]);
    expect(M.getAxisList()).toEqual(["y"]);
    expect(M.getAxisList("nonsense")).toEqual(["y"]);
  });
});

describe("disposeMeshMaterial", () => {
  it("disposes a single material", () => {
    const mat = { dispose: vi.fn() };
    M.disposeMeshMaterial({ material: mat });
    expect(mat.dispose).toHaveBeenCalled();
  });

  it("disposes every material in an array", () => {
    const a = { dispose: vi.fn() };
    const b = { dispose: vi.fn() };
    M.disposeMeshMaterial({ material: [a, b, null] });
    expect(a.dispose).toHaveBeenCalled();
    expect(b.dispose).toHaveBeenCalled();
  });

  it("tolerates a missing mesh or material", () => {
    expect(() => M.disposeMeshMaterial(null)).not.toThrow();
    expect(() => M.disposeMeshMaterial({})).not.toThrow();
    expect(() => M.disposeMeshMaterial({ material: {} })).not.toThrow();
  });
});

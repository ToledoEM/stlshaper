import { describe, it, expect, vi } from "vitest";
import * as M from "../main.js";
import { boxVertices, geomFrom, allFinite } from "./helpers.js";

const THREE = globalThis.THREE;

/** Builds a binary STL buffer from a flat triangle array. */
function binarySTL(vertices) {
  const triangles = vertices.length / 9;
  const buf = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buf);
  view.setUint32(80, triangles, true);
  let o = 84;
  for (let t = 0; t < triangles; t++) {
    // Face normal, left as zero; the loader stores whatever is present.
    view.setFloat32(o, 0, true);
    view.setFloat32(o + 4, 0, true);
    view.setFloat32(o + 8, 1, true);
    o += 12;
    for (let v = 0; v < 9; v++) {
      view.setFloat32(o, vertices[t * 9 + v], true);
      o += 4;
    }
    view.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

/** Builds an ASCII STL string from a flat triangle array. */
function asciiSTL(vertices) {
  let out = "solid test\n";
  for (let t = 0; t < vertices.length; t += 9) {
    out += "  facet normal 0 0 1\n    outer loop\n";
    for (let v = 0; v < 3; v++) {
      const b = t + v * 3;
      out += `      vertex ${vertices[b]} ${vertices[b + 1]} ${vertices[b + 2]}\n`;
    }
    out += "    endloop\n  endfacet\n";
  }
  return out + "endsolid test\n";
}

const TRI = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);

describe("LocalSTLLoader", () => {
  const loader = new M.LocalSTLLoader();

  it("parses a binary STL", () => {
    const g = loader.parse(binarySTL(TRI));
    expect(g.getAttribute("position").count).toBe(3);
    expect(g.getAttribute("position").array[3]).toBeCloseTo(10, 5);
  });

  it("parses an ASCII STL", () => {
    const bytes = new TextEncoder().encode(asciiSTL(TRI));
    const g = loader.parse(bytes.buffer);
    expect(g.getAttribute("position").count).toBe(3);
  });

  it("parses a multi-triangle binary STL", () => {
    const g = loader.parse(binarySTL(boxVertices()));
    expect(g.getAttribute("position").count).toBe(36);
  });

  it("stores a normal for every vertex", () => {
    const g = loader.parse(binarySTL(TRI));
    expect(g.getAttribute("normal").count).toBe(3);
  });

  it("handles scientific notation in ASCII input", () => {
    const src = `solid s
  facet normal 0 0 1
    outer loop
      vertex 1.5e2 0 0
      vertex 0 1.5e-2 0
      vertex 0 0 1
    endloop
  endfacet
endsolid s`;
    const g = loader.parse(new TextEncoder().encode(src).buffer);
    expect(g.getAttribute("position").array[0]).toBeCloseTo(150, 3);
  });

  it("skips malformed facets that do not carry three vertices", () => {
    const src = `solid s
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 1 0 0
    endloop
  endfacet
endsolid s`;
    const g = loader.parse(new TextEncoder().encode(src).buffer);
    expect(g.getAttribute("position").count).toBe(0);
  });

  it("returns empty geometry for an ASCII solid with no facets", () => {
    // Padded with a comment so the byte length cannot coincidentally satisfy
    // the binary size formula (84 + faces * 50), which the isBinary heuristic
    // uses to choose a parser.
    const src = "solid empty_model_with_no_facets_at_all\nendsolid empty_model\n";
    const g = loader.parse(new TextEncoder().encode(src).buffer);
    expect(g.getAttribute("position").count).toBe(0);
  });

  it("passes a string through ensureString unchanged", () => {
    expect(loader.ensureString("already text")).toBe("already text");
  });

  it("does not throw on a file shorter than a binary header", () => {
    // isBinary reads a uint32 at offset 80. Without a length check that is a
    // RangeError for any file under 84 bytes, including small valid ASCII.
    const tiny = new TextEncoder().encode("solid s\nendsolid s").buffer;
    expect(tiny.byteLength).toBeLessThan(84);
    expect(() => loader.parse(tiny)).not.toThrow();
  });

  it("does not throw on an empty buffer", () => {
    expect(() => loader.parse(new ArrayBuffer(0))).not.toThrow();
  });

  it("loads through THREE.FileLoader", () => {
    const geometry = geomFrom(TRI);
    const onLoad = vi.fn();
    const spy = vi
      .spyOn(THREE.FileLoader.prototype, "load")
      .mockImplementation((url, cb) => cb(binarySTL(TRI)));

    loader.load("model.stl", onLoad);

    expect(spy).toHaveBeenCalled();
    expect(onLoad).toHaveBeenCalledOnce();
    expect(onLoad.mock.calls[0][0].getAttribute("position").count).toBe(3);
    spy.mockRestore();
  });
});

describe("LocalSTLExporter", () => {
  const exporter = new M.LocalSTLExporter();

  function sceneWith(vertices) {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(geomFrom(vertices), new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    scene.add(mesh);
    return scene;
  }

  it("writes ASCII by default", () => {
    const out = exporter.parse(sceneWith(TRI));
    expect(typeof out).toBe("string");
    expect(out).toContain("solid exported");
    expect(out).toContain("facet normal");
    expect(out).toContain("endsolid exported");
  });

  it("writes binary on request", () => {
    const out = exporter.parse(sceneWith(TRI), { binary: true });
    expect(out).toBeInstanceOf(ArrayBuffer);
    expect(new DataView(out).getUint32(80, true)).toBe(1);
  });

  it("computes a face normal in ASCII output", () => {
    const out = exporter.parse(sceneWith(TRI));
    // The triangle lies in the XY plane, so its normal is ±Z.
    expect(out).toMatch(/facet normal -?0? ?-?0? ?-?1/);
  });

  it("uses the geometry's normals in binary output when present", () => {
    const scene = new THREE.Scene();
    const g = geomFrom(TRI);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    scene.add(mesh);
    const out = exporter.parse(scene, { binary: true });
    expect(new DataView(out).getUint32(80, true)).toBe(1);
  });

  it("falls back to a default normal when the geometry has none", () => {
    const out = exporter.parse(sceneWith(TRI), { binary: true });
    const view = new DataView(out);
    // Only the count matters here; the normal slot must still be written.
    expect(view.getUint32(80, true)).toBe(1);
    expect(Number.isFinite(view.getFloat32(84, true))).toBe(true);
  });

  it("skips objects that are not buffer geometries", () => {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(geomFrom(TRI), new THREE.MeshBasicMaterial());
    mesh.geometry.isBufferGeometry = false;
    mesh.updateMatrixWorld(true);
    scene.add(mesh);
    expect(exporter.parse(scene)).toBe("solid exported\nendsolid exported\n");
  });

  it("exports an empty scene without error", () => {
    expect(exporter.parse(new THREE.Scene())).toContain("solid exported");
  });

  it("round-trips through binary export and re-import", () => {
    const out = exporter.parse(sceneWith(boxVertices()), { binary: true });
    const back = new M.LocalSTLLoader().parse(out);
    expect(back.getAttribute("position").count).toBe(36);
    expect(allFinite(back.getAttribute("position").array)).toBe(true);
  });

  it("round-trips through ASCII export and re-import", () => {
    const text = exporter.parse(sceneWith(boxVertices()));
    const back = new M.LocalSTLLoader().parse(new TextEncoder().encode(text).buffer);
    expect(back.getAttribute("position").count).toBe(36);
  });
});

describe("loader and exporter factories", () => {
  it("prefer the CDN implementations when present on window", () => {
    class FakeLoader {}
    class FakeExporter {}
    window.STLLoader = FakeLoader;
    window.STLExporter = FakeExporter;
    expect(M.createSTLLoader()).toBeInstanceOf(FakeLoader);
    expect(M.createSTLExporter()).toBeInstanceOf(FakeExporter);
    delete window.STLLoader;
    delete window.STLExporter;
  });

  it("fall back to the local implementations", () => {
    expect(M.createSTLLoader()).toBeInstanceOf(M.LocalSTLLoader);
    expect(M.createSTLExporter()).toBeInstanceOf(M.LocalSTLExporter);
  });
});

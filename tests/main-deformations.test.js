import { describe, it, expect } from "vitest";
import * as M from "../main.js";
import { cloud, boxVertices, geomFrom, allFinite } from "./helpers.js";

// The main-thread deformations are the fallback used when Worker construction
// fails, notably under file:// in Chrome. Several read the deformParams global
// rather than taking arguments — that asymmetry is deliberate (see CLAUDE.md),
// so these tests set the global before calling.

function reset(key, values) {
  Object.assign(M.deformParams[key], values);
}

describe("noiseShape (main thread)", () => {
  it("reads its settings from the deformParams global", () => {
    reset("noise", { intensity: 2, scale: 0.02, axis: "all", type: "white", seed: 0 });
    const g = geomFrom(cloud(120));
    const before = g.getAttribute("position").array.slice();
    M.noiseShape(g);
    expect(Array.from(g.getAttribute("position").array)).not.toEqual(Array.from(before));
  });

  it("respects the axis restriction", () => {
    reset("noise", { intensity: 2, scale: 0.02, axis: "x", type: "white", seed: 0 });
    const g = geomFrom(cloud(60));
    const before = g.getAttribute("position").array.slice();
    M.noiseShape(g);
    const after = g.getAttribute("position").array;
    for (let i = 0; i < after.length; i += 3) {
      expect(after[i + 1]).toBeCloseTo(before[i + 1], 5);
    }
  });

  it("supports the perlin type", () => {
    reset("noise", { intensity: 2, scale: 0.5, axis: "all", type: "perlin", seed: 3 });
    const g = geomFrom(cloud(60));
    M.noiseShape(g);
    expect(allFinite(g.getAttribute("position").array)).toBe(true);
  });

  it("recomputes normals and bounds", () => {
    reset("noise", { intensity: 1, scale: 0.02, axis: "all", type: "white", seed: 0 });
    const g = geomFrom(boxVertices());
    M.noiseShape(g);
    expect(g.getAttribute("normal")).toBeDefined();
    expect(g.boundingBox).toBeDefined();
  });
});

describe("sineDeformShape (main thread)", () => {
  it("displaces by a sine of the driver axis", () => {
    reset("sine", { amplitude: 5, frequency: 1, driverAxis: "x", dispAxis: "y" });
    const g = geomFrom(new Float32Array([2, 0, 0]));
    M.sineDeformShape(g);
    expect(g.getAttribute("position").array[1]).toBeCloseTo(Math.sin(2) * 5, 4);
  });
});

describe("pixelateShape (main thread)", () => {
  it("snaps vertices to the grid", () => {
    reset("pixel", { size: 5, axis: "all" });
    const g = geomFrom(cloud(90, 20));
    M.pixelateShape(g);
    for (const v of g.getAttribute("position").array) {
      expect(Math.abs(v % 5)).toBeLessThan(1e-3);
    }
  });

  it("drops triangles that collapse to a degenerate sliver", () => {
    // Two of these three vertices snap onto the same grid point.
    reset("pixel", { size: 100, axis: "all" });
    const g = geomFrom(boxVertices(10));
    M.pixelateShape(g);
    expect(g.getAttribute("position").count).toBeLessThan(36);
  });

  it("warns and returns early for an invalid pixel size", () => {
    reset("pixel", { size: 0, axis: "all" });
    const g = geomFrom(boxVertices());
    expect(M.pixelateShape(g).getAttribute("position").count).toBe(36);
  });

  it("returns early for geometry without positions", () => {
    reset("pixel", { size: 5, axis: "all" });
    expect(() => M.pixelateShape({})).not.toThrow();
    expect(() => M.pixelateShape(null)).not.toThrow();
  });

  it("handles a mesh that collapses entirely", () => {
    reset("pixel", { size: 1e6, axis: "all" });
    const g = geomFrom(boxVertices(1));
    M.pixelateShape(g);
    expect(g.getAttribute("position").count).toBe(0);
  });

  it("returns early on empty geometry", () => {
    reset("pixel", { size: 5, axis: "all" });
    const g = geomFrom(new Float32Array([]));
    expect(() => M.pixelateShape(g)).not.toThrow();
  });
});

describe("idwShape (main thread)", () => {
  it("uses the params argument when supplied", () => {
    const g = geomFrom(new Float32Array([10, 0, 0]));
    M.idwShape(g, {
      controlPoints: [{ x: 0, y: 0, z: 0 }],
      weight: 2, power: 2, scale: 1,
    });
    expect(g.getAttribute("position").array[0]).toBeLessThan(10);
  });

  it("falls back to the deformParams global when params is null", () => {
    reset("idw", { weight: 2, power: 2, scale: 1 });
    const g = geomFrom(new Float32Array([10, 0, 0]));
    // No control points anywhere, so it warns and returns unchanged.
    expect(M.idwShape(g, null).getAttribute("position").array[0]).toBe(10);
  });

  it("inherits individual values from the global when absent from params", () => {
    reset("idw", { weight: 3, power: 2, scale: 1 });
    const g = geomFrom(new Float32Array([10, 0, 0]));
    M.idwShape(g, { controlPoints: [{ x: 0, y: 0, z: 0 }] });
    expect(g.getAttribute("position").array[0]).toBeLessThan(10);
  });
});

describe("parameterised deformations (main thread)", () => {
  const cases = [
    ["inflateShape", (g) => M.inflateShape(g, { amount: 0.5 })],
    ["twistShape", (g) => M.twistShape(g, { axis: "y", angle: 90 })],
    ["bendShape", (g) => M.bendShape(g, { axis: "y", strength: 0.5 })],
    ["rippleShape", (g) => M.rippleShape(g, { axis: "y", amplitude: 2, frequency: 0.3 })],
    ["warpShape", (g) => M.warpShape(g, { strength: 1, scale: 0.2 })],
    ["hyperShape", (g) => M.hyperShape(g, { axis: "y", amount: 0.5 })],
    ["boundaryDisruptShape", (g) => M.boundaryDisruptShape(g, { threshold: 0.1, jitter: 1 })],
  ];

  for (const [name, run] of cases) {
    it(`${name} deforms and keeps the mesh finite`, () => {
      const g = geomFrom(cloud(150));
      const before = g.getAttribute("position").array.slice();
      run(g);
      const after = g.getAttribute("position").array;
      expect(Array.from(after)).not.toEqual(Array.from(before));
      expect(allFinite(after)).toBe(true);
    });

    it(`${name} recomputes normals and bounds`, () => {
      const g = geomFrom(boxVertices());
      run(g);
      expect(g.getAttribute("normal")).toBeDefined();
      expect(g.boundingSphere).toBeDefined();
    });

    it(`${name} applies defaults for omitted parameters`, () => {
      const g = geomFrom(cloud(60));
      expect(() => run(g, {})).not.toThrow();
    });
  }

  it("axis-based deformations accept every axis selection", () => {
    for (const axis of ["x", "y", "z", "all"]) {
      for (const run of [
        (g) => M.twistShape(g, { axis, angle: 90 }),
        (g) => M.bendShape(g, { axis, strength: 0.5 }),
        (g) => M.rippleShape(g, { axis, amplitude: 2, frequency: 0.3 }),
        (g) => M.hyperShape(g, { axis, amount: 0.5 }),
      ]) {
        const g = geomFrom(cloud(30));
        run(g);
        expect(allFinite(g.getAttribute("position").array)).toBe(true);
      }
    }
  });

  it("defaults are used when the params object is empty", () => {
    for (const run of [
      (g) => M.inflateShape(g, {}),
      (g) => M.twistShape(g, {}),
      (g) => M.bendShape(g, {}),
      (g) => M.rippleShape(g, {}),
      (g) => M.warpShape(g, {}),
      (g) => M.hyperShape(g, {}),
      (g) => M.boundaryDisruptShape(g, {}),
    ]) {
      const g = geomFrom(cloud(30));
      run(g);
      expect(allFinite(g.getAttribute("position").array)).toBe(true);
    }
  });
});

describe("spherizeShape (main thread)", () => {
  it("pulls vertices toward an explicit radius", () => {
    reset("spherize", { factor: 1, radius: 20 });
    // Spread across three vertices so the bbox has a real extent: a single
    // vertex would put the centre on top of it, leaving no radius to scale.
    const g = geomFrom(new Float32Array([5, 0, 0, -5, 0, 0, 0, 5, 0]));
    g.computeBoundingBox();
    const cx = (g.boundingBox.min.x + g.boundingBox.max.x) / 2;
    const cy = (g.boundingBox.min.y + g.boundingBox.max.y) / 2;
    const cz = (g.boundingBox.min.z + g.boundingBox.max.z) / 2;

    M.spherizeShape(g);

    // At factor 1 every vertex lands exactly on the target radius, measured
    // from the bounding-box centre rather than the world origin.
    const arr = g.getAttribute("position").array;
    for (let i = 0; i < arr.length; i += 3) {
      expect(Math.hypot(arr[i] - cx, arr[i + 1] - cy, arr[i + 2] - cz)).toBeCloseTo(20, 3);
    }
  });

  it("derives the radius from the bounding box when set to auto", () => {
    reset("spherize", { factor: 0.5, radius: 0 });
    const g = geomFrom(boxVertices(20));
    M.spherizeShape(g);
    expect(allFinite(g.getAttribute("position").array)).toBe(true);
  });
});

describe("perspShape (main thread)", () => {
  it("applies a single vanishing point from the global settings", () => {
    reset("persp", {
      strength: 0.5, mode: "linear", plane: "XY", vpMode: 1,
      vp1: { x: 1, y: 0 }, vp2: { x: 0, y: 0 },
    });
    const g = geomFrom(boxVertices(20));
    const before = g.getAttribute("position").array.slice();
    M.perspShape(g);
    expect(Array.from(g.getAttribute("position").array)).not.toEqual(Array.from(before));
  });

  it("applies both vanishing points in 2-point mode", () => {
    const base = {
      strength: 0.5, mode: "linear", plane: "XY",
      vp1: { x: 1, y: 0 }, vp2: { x: 0, y: 1 },
    };
    reset("persp", { ...base, vpMode: 1 });
    const one = geomFrom(boxVertices(20));
    M.perspShape(one);

    reset("persp", { ...base, vpMode: 2 });
    const two = geomFrom(boxVertices(20));
    M.perspShape(two);

    expect(Array.from(one.getAttribute("position").array))
      .not.toEqual(Array.from(two.getAttribute("position").array));
  });

  it("supports exponential falloff", () => {
    reset("persp", {
      strength: 0.5, mode: "exponential", plane: "XZ", vpMode: 1,
      vp1: { x: 0, y: 1 }, vp2: { x: 0, y: 0 },
    });
    const g = geomFrom(boxVertices(20));
    M.perspShape(g);
    expect(allFinite(g.getAttribute("position").array)).toBe(true);
  });
});

describe("perspComputeProjMax", () => {
  it("returns zero for a degenerate direction", () => {
    const arr = new Float32Array([1, 2, 3]);
    expect(M.perspComputeProjMax(arr, 0, 0, 0, { x: 0, y: 0, z: 0 })).toBe(0);
  });

  it("measures the furthest projection from the centre", () => {
    const arr = new Float32Array([10, 0, 0, -3, 0, 0]);
    expect(M.perspComputeProjMax(arr, 0, 0, 0, { x: 1, y: 0, z: 0 })).toBeCloseTo(10, 5);
  });
});

describe("perspApplyVP (main thread)", () => {
  it("derives projMax itself when not supplied", () => {
    const arr = new Float32Array([5, 0, 0]);
    M.perspApplyVP(arr, 0, 0, 0, { x: 1, y: 0, z: 0 }, 0.5, "linear");
    expect(arr[0]).not.toBe(5);
  });

  it("does nothing for a degenerate direction", () => {
    const arr = new Float32Array([5, 0, 0]);
    M.perspApplyVP(arr, 0, 0, 0, { x: 0, y: 0, z: 0 }, 0.5, "linear");
    expect(arr[0]).toBe(5);
  });

  it("does nothing when every vertex sits at the centre", () => {
    const arr = new Float32Array([0, 0, 0]);
    M.perspApplyVP(arr, 0, 0, 0, { x: 1, y: 0, z: 0 }, 0.5, "linear");
    expect(arr[0]).toBe(0);
  });
});

describe("perspVpTo3D (main thread)", () => {
  it("matches the worker's plane mapping", () => {
    expect(M.perspVpTo3D({ x: 1, y: 2 }, "XY")).toEqual({ x: 1, y: 2, z: 0 });
    expect(M.perspVpTo3D({ x: 1, y: 2 }, "XZ")).toEqual({ x: 1, y: 0, z: 2 });
    expect(M.perspVpTo3D({ x: 1, y: 2 }, "YZ")).toEqual({ x: 0, y: 1, z: 2 });
  });
});

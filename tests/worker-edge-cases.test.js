import { describe, it, expect } from "vitest";
import * as W from "../worker.js";
import { makeBBox, cloud, allFinite } from "./helpers.js";

// Degenerate geometry: a flat or point-like mesh makes several `|| 1` guards
// load-bearing. Without them the range is zero and the maths divides by it,
// filling the mesh with NaN. A user hits this with a planar STL.

const FLAT = makeBBox({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });

describe("degenerate bounding boxes", () => {
  it("inflate survives a zero-size bbox", () => {
    const v = new Float32Array([1, 2, 3]);
    W.inflateShape(v, { amount: 0.5 }, FLAT);
    expect(allFinite(v)).toBe(true);
  });

  it("twist survives a zero-extent axis", () => {
    const v = cloud(30);
    W.twistShape(v, { axis: "y", angle: 90 }, FLAT);
    expect(allFinite(v)).toBe(true);
  });

  it("bend survives a zero-extent axis", () => {
    const v = cloud(30);
    W.bendShape(v, { axis: "y", strength: 0.8 }, FLAT);
    expect(allFinite(v)).toBe(true);
  });

  it("hyper survives a zero-extent axis", () => {
    const v = cloud(30);
    W.hyperShape(v, { axis: "y", amount: 0.6 }, FLAT);
    expect(allFinite(v)).toBe(true);
  });

  it("spherize survives a zero-size bbox with auto radius", () => {
    const v = new Float32Array([1, 2, 3]);
    W.spherizeShape(v, { factor: 0.5, radius: 0 }, FLAT);
    expect(allFinite(v)).toBe(true);
  });

  it("boundary disruption survives a zero-size bbox", () => {
    const v = new Float32Array([0, 0, 0]);
    W.boundaryDisruptShape(v, { threshold: 0.1, jitter: 1 }, FLAT);
    expect(allFinite(v)).toBe(true);
  });

  it("ripple survives a zero-size bbox", () => {
    const v = cloud(30);
    W.rippleShape(v, { axis: "y", amplitude: 2, frequency: 0.3 }, FLAT);
    expect(allFinite(v)).toBe(true);
  });
});

describe("axis suppression", () => {
  // Each axis flag has both an allowed and a suppressed path.
  for (const axis of ["x", "y", "z", "xy", "xz", "yz", "all"]) {
    it(`noise honours axis "${axis}"`, () => {
      const v = cloud(30);
      const before = v.slice();
      W.noiseShape(v, { intensity: 1, scale: 0.02, axis }, makeBBox());

      const moved = { x: false, y: false, z: false };
      for (let i = 0; i < v.length; i += 3) {
        if (v[i] !== before[i]) moved.x = true;
        if (v[i + 1] !== before[i + 1]) moved.y = true;
        if (v[i + 2] !== before[i + 2]) moved.z = true;
      }
      for (const key of ["x", "y", "z"]) {
        if (axis === "all" || axis.includes(key)) continue;
        expect(moved[key], `${key} must not move for axis "${axis}"`).toBe(false);
      }
    });

    it(`pixelate honours axis "${axis}"`, () => {
      const v = new Float32Array([1.4, 2.6, 3.2]);
      W.pixelateShape(v, { size: 1, axis });
      const expected = [1.4, 2.6, 3.2].map((n, idx) => {
        const key = ["x", "y", "z"][idx];
        return axis === "all" || axis.includes(key) ? Math.round(n) : n;
      });
      for (let i = 0; i < 3; i++) expect(v[i]).toBeCloseTo(expected[i], 5);
    });

    it(`sine honours displacement axis "${axis}"`, () => {
      const v = new Float32Array([1, 1, 1]);
      W.sineDeformShape(v, {
        amplitude: 2, frequency: 1, driverAxis: "x", dispAxis: axis,
      });
      for (let i = 0; i < 3; i++) {
        const key = ["x", "y", "z"][i];
        if (axis === "all" || axis.includes(key)) expect(v[i]).not.toBe(1);
        else expect(v[i]).toBe(1);
      }
    });
  }
});

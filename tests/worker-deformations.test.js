import { describe, it, expect } from "vitest";
import * as W from "../worker.js";
import { makeBBox, triangle, cloud, boxVertices, allFinite } from "./helpers.js";

// Every worker deformation operates on a flat Float32Array in place and
// returns it. These cover the contract each one shares, plus behaviour
// specific to the individual transform.

describe("getAxisList", () => {
  it("expands 'all' to every axis", () => {
    expect(W.getAxisList("all")).toEqual(["x", "y", "z"]);
  });

  it("parses combined axis strings", () => {
    expect(W.getAxisList("xz")).toEqual(["x", "z"]);
  });

  it("defaults to y when the axis is absent or unrecognised", () => {
    expect(W.getAxisList()).toEqual(["y"]);
    expect(W.getAxisList("")).toEqual(["y"]);
    expect(W.getAxisList("q")).toEqual(["y"]);
  });
});

describe("noiseShape", () => {
  const base = { intensity: 1.5, scale: 0.02, axis: "all", seed: 0 };

  it("displaces vertices away from the bbox centre", () => {
    const v = cloud(120);
    const before = v.slice();
    W.noiseShape(v, base, makeBBox());
    expect(v).not.toEqual(before);
    expect(allFinite(v)).toBe(true);
  });

  it("only moves the permitted axes", () => {
    const v = cloud(60);
    const before = v.slice();
    W.noiseShape(v, { ...base, axis: "x" }, makeBBox());
    for (let i = 0; i < v.length; i += 3) {
      expect(v[i + 1]).toBe(before[i + 1]);
      expect(v[i + 2]).toBe(before[i + 2]);
    }
  });

  it("tolerates a missing bbox by centring on the origin", () => {
    const v = cloud(30);
    expect(() => W.noiseShape(v, base, null)).not.toThrow();
    expect(allFinite(v)).toBe(true);
  });

  it("leaves a vertex exactly at the centre finite", () => {
    // The centre-to-vertex vector is zero here, which would divide by zero
    // without the `|| 1` guard on the length.
    const v = new Float32Array([0, 0, 0]);
    W.noiseShape(v, base, makeBBox());
    expect(allFinite(v)).toBe(true);
  });
});

describe("sineDeformShape", () => {
  it("displaces by sin(driver * frequency) * amplitude", () => {
    const v = new Float32Array([2, 0, 0]);
    W.sineDeformShape(v, {
      amplitude: 5,
      frequency: 1,
      driverAxis: "x",
      dispAxis: "y",
    });
    expect(v[1]).toBeCloseTo(Math.sin(2) * 5, 5);
    expect(v[0]).toBe(2);
  });

  it("applies to every axis named in dispAxis", () => {
    const v = new Float32Array([1, 1, 1]);
    W.sineDeformShape(v, {
      amplitude: 2,
      frequency: 1,
      driverAxis: "z",
      dispAxis: "all",
    });
    const d = Math.sin(1) * 2;
    expect(v[0]).toBeCloseTo(1 + d, 5);
    expect(v[1]).toBeCloseTo(1 + d, 5);
    expect(v[2]).toBeCloseTo(1 + d, 5);
  });

  it("uses y and z as the driver when selected", () => {
    const vy = new Float32Array([0, 3, 0]);
    W.sineDeformShape(vy, { amplitude: 1, frequency: 1, driverAxis: "y", dispAxis: "x" });
    expect(vy[0]).toBeCloseTo(Math.sin(3), 5);

    const vz = new Float32Array([0, 0, 3]);
    W.sineDeformShape(vz, { amplitude: 1, frequency: 1, driverAxis: "z", dispAxis: "x" });
    expect(vz[0]).toBeCloseTo(Math.sin(3), 5);
  });
});

describe("pixelateShape", () => {
  it("snaps coordinates to the grid", () => {
    const v = new Float32Array([1.4, 2.6, -3.2]);
    W.pixelateShape(v, { size: 1, axis: "all" });
    expect(Array.from(v)).toEqual([1, 3, -3]);
  });

  it("returns the input untouched for a non-positive or missing size", () => {
    for (const size of [0, -1, undefined]) {
      const v = new Float32Array([1.4, 2.6, 3.2]);
      const before = Array.from(v);
      W.pixelateShape(v, { size, axis: "all" });
      expect(Array.from(v)).toEqual(before);
    }
  });

  it("returns empty input unchanged", () => {
    const v = new Float32Array([]);
    expect(W.pixelateShape(v, { size: 5, axis: "all" }).length).toBe(0);
  });

  it("snaps only the selected axes", () => {
    const v = new Float32Array([1.4, 2.6, 3.2]);
    W.pixelateShape(v, { size: 1, axis: "y" });
    expect(v[0]).toBeCloseTo(1.4, 5);
    expect(v[1]).toBe(3);
    expect(v[2]).toBeCloseTo(3.2, 5);
  });
});

describe("inflateShape", () => {
  it("pushes vertices outward proportionally to their distance", () => {
    const v = new Float32Array([10, 0, 0]);
    W.inflateShape(v, { amount: 1 }, makeBBox());
    // dist 10, maxRadius 10, so scale = 1 + 1 * 1 = 2.
    expect(v[0]).toBeCloseTo(20, 6);
  });

  it("returns the input unchanged without a bbox", () => {
    const v = new Float32Array([5, 5, 5]);
    W.inflateShape(v, { amount: 1 }, null);
    expect(Array.from(v)).toEqual([5, 5, 5]);
  });

  it("defaults the amount when omitted", () => {
    const v = new Float32Array([10, 0, 0]);
    W.inflateShape(v, {}, makeBBox());
    expect(v[0]).toBeCloseTo(16, 6); // 1 + 0.6
  });

  it("keeps a centre vertex finite", () => {
    const v = new Float32Array([0, 0, 0]);
    W.inflateShape(v, { amount: 1 }, makeBBox());
    expect(allFinite(v)).toBe(true);
  });
});

describe("twistShape", () => {
  it("rotates about the chosen axis by an amount that varies along it", () => {
    const v = new Float32Array([10, 10, 0]);
    const before = v.slice();
    W.twistShape(v, { axis: "y", angle: 180 }, makeBBox());
    expect(v).not.toEqual(before);
    expect(allFinite(v)).toBe(true);
  });

  it("leaves the mesh untouched at zero angle", () => {
    const v = cloud(60);
    const before = v.slice();
    W.twistShape(v, { axis: "y", angle: 0 }, makeBBox());
    for (let i = 0; i < v.length; i++) expect(v[i]).toBeCloseTo(before[i], 5);
  });

  it("supports every axis and the 'all' combination", () => {
    for (const axis of ["x", "y", "z", "all"]) {
      const v = cloud(30);
      W.twistShape(v, { axis, angle: 90 }, makeBBox());
      expect(allFinite(v)).toBe(true);
    }
  });

  it("defaults the angle when omitted", () => {
    const v = new Float32Array([10, 10, 0]);
    expect(() => W.twistShape(v, { axis: "y" }, makeBBox())).not.toThrow();
  });

  it("survives a degenerate bbox with zero extent", () => {
    const v = new Float32Array([0, 0, 0]);
    const flat = makeBBox({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    W.twistShape(v, { axis: "y", angle: 90 }, flat);
    expect(allFinite(v)).toBe(true);
  });
});

describe("bendShape", () => {
  it("bends the mesh and stays finite", () => {
    const v = cloud(90);
    const before = v.slice();
    W.bendShape(v, { axis: "y", strength: 0.8 }, makeBBox());
    expect(v).not.toEqual(before);
    expect(allFinite(v)).toBe(true);
  });

  it("supports every axis", () => {
    for (const axis of ["x", "y", "z", "all"]) {
      const v = cloud(30);
      W.bendShape(v, { axis, strength: 0.5 }, makeBBox());
      expect(allFinite(v)).toBe(true);
    }
  });

  it("defaults the strength when omitted", () => {
    const v = cloud(30);
    expect(() => W.bendShape(v, { axis: "y" }, makeBBox())).not.toThrow();
  });
});

describe("rippleShape", () => {
  it("displaces along the chosen axis by a radial sine", () => {
    const v = new Float32Array([5, 0, 0]);
    W.rippleShape(v, { axis: "y", amplitude: 4, frequency: 0.3 }, makeBBox());
    expect(v[1]).toBeCloseTo(Math.sin(5 * 0.3) * 4, 5);
  });

  it("supports every axis", () => {
    for (const axis of ["x", "y", "z", "all"]) {
      const v = cloud(30);
      W.rippleShape(v, { axis, amplitude: 2, frequency: 0.2 }, makeBBox());
      expect(allFinite(v)).toBe(true);
    }
  });

  it("defaults amplitude and frequency when omitted", () => {
    const v = cloud(30);
    expect(() => W.rippleShape(v, { axis: "y" }, makeBBox())).not.toThrow();
  });
});

describe("warpShape", () => {
  it("offsets each axis by a sine of the next", () => {
    const v = new Float32Array([1, 2, 3]);
    W.warpShape(v, { strength: 1, scale: 1 });
    expect(v[0]).toBeCloseTo(1 + Math.sin(2), 5);
    expect(v[1]).toBeCloseTo(2 + Math.sin(3), 5);
    expect(v[2]).toBeCloseTo(3 + Math.sin(1), 5);
  });

  it("defaults strength and scale when omitted", () => {
    const v = new Float32Array([1, 2, 3]);
    expect(() => W.warpShape(v, {})).not.toThrow();
  });
});

describe("hyperShape", () => {
  it("stretches along the chosen axis", () => {
    const v = cloud(60);
    const before = v.slice();
    W.hyperShape(v, { axis: "y", amount: 0.6 }, makeBBox());
    expect(v).not.toEqual(before);
    expect(allFinite(v)).toBe(true);
  });

  it("supports every axis", () => {
    for (const axis of ["x", "y", "z", "all"]) {
      const v = cloud(30);
      W.hyperShape(v, { axis, amount: 0.5 }, makeBBox());
      expect(allFinite(v)).toBe(true);
    }
  });

  it("stays finite when the amount is zero, where sinh(0) would divide by zero", () => {
    const v = cloud(30);
    W.hyperShape(v, { axis: "y", amount: 0 }, makeBBox());
    expect(allFinite(v)).toBe(true);
  });

  it("defaults the amount when omitted", () => {
    const v = cloud(30);
    expect(() => W.hyperShape(v, { axis: "y" }, makeBBox())).not.toThrow();
  });
});

describe("boundaryDisruptShape", () => {
  it("jitters vertices near the bounds but leaves interior ones alone", () => {
    // x=10 sits on the boundary; the origin is far from every face.
    const v = new Float32Array([10, 0, 0, 0, 0, 0]);
    W.boundaryDisruptShape(v, { threshold: 0.08, jitter: 2 }, makeBBox());
    expect(v[0]).not.toBe(10);
    expect(Array.from(v.slice(3))).toEqual([0, 0, 0]);
  });

  it("is deterministic for the same input", () => {
    const a = cloud(60);
    const b = a.slice();
    const p = { threshold: 0.2, jitter: 1.5 };
    W.boundaryDisruptShape(a, p, makeBBox());
    W.boundaryDisruptShape(b, p, makeBBox());
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("defaults threshold and jitter when omitted", () => {
    const v = cloud(30);
    expect(() => W.boundaryDisruptShape(v, {}, makeBBox())).not.toThrow();
  });
});

describe("spherizeShape", () => {
  it("pulls vertices toward the target radius by the given factor", () => {
    // Distance 10, auto radius 10, so a full-factor pull is a no-op here.
    const v = new Float32Array([10, 0, 0]);
    W.spherizeShape(v, { factor: 1, radius: 0 }, makeBBox());
    expect(v[0]).toBeCloseTo(10, 6);
  });

  it("moves a vertex onto an explicit radius at factor 1", () => {
    const v = new Float32Array([5, 0, 0]);
    W.spherizeShape(v, { factor: 1, radius: 20 }, makeBBox());
    expect(v[0]).toBeCloseTo(20, 6);
  });

  it("keeps a centre vertex finite despite a zero radius vector", () => {
    const v = new Float32Array([0, 0, 0]);
    W.spherizeShape(v, { factor: 0.5, radius: 10 }, makeBBox());
    expect(allFinite(v)).toBe(true);
  });

  it("defaults factor and radius when omitted", () => {
    const v = cloud(30);
    expect(() => W.spherizeShape(v, {}, makeBBox())).not.toThrow();
  });
});

describe("idwShape", () => {
  it("pulls vertices toward a control point for a positive weight", () => {
    const v = new Float32Array([10, 0, 0]);
    W.idwShape(v, {
      controlPoints: [{ x: 0, y: 0, z: 0 }],
      weight: 2,
      power: 2,
      scale: 1,
    });
    expect(v[0]).toBeLessThan(10);
  });

  it("pushes vertices away for a negative weight", () => {
    const v = new Float32Array([10, 0, 0]);
    W.idwShape(v, {
      controlPoints: [{ x: 0, y: 0, z: 0 }],
      weight: -2,
      power: 2,
      scale: 1,
    });
    expect(v[0]).toBeGreaterThan(10);
  });

  it("returns the input unchanged when no control points are supplied", () => {
    const v = new Float32Array([1, 2, 3]);
    W.idwShape(v, { weight: 1, power: 2, scale: 1 });
    expect(Array.from(v)).toEqual([1, 2, 3]);
    W.idwShape(v, { controlPoints: [], weight: 1, power: 2, scale: 1 });
    expect(Array.from(v)).toEqual([1, 2, 3]);
  });

  it("stays finite when a vertex coincides with a control point", () => {
    const v = new Float32Array([0, 0, 0]);
    W.idwShape(v, {
      controlPoints: [{ x: 0, y: 0, z: 0 }],
      weight: 5,
      power: 2,
      scale: 1,
    });
    expect(allFinite(v)).toBe(true);
  });

  it("accumulates influence from several control points", () => {
    const one = new Float32Array([10, 0, 0]);
    const two = new Float32Array([10, 0, 0]);
    const p = { weight: 2, power: 2, scale: 1 };
    W.idwShape(one, { ...p, controlPoints: [{ x: 0, y: 0, z: 0 }] });
    W.idwShape(two, {
      ...p,
      controlPoints: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }],
    });
    expect(Math.abs(10 - two[0])).toBeGreaterThan(Math.abs(10 - one[0]));
  });
});

describe("perspVpTo3D", () => {
  it("maps the widget's 2D vanishing point onto the selected plane", () => {
    expect(W.perspVpTo3D({ x: 1, y: 2 }, "XY")).toEqual({ x: 1, y: 2, z: 0 });
    expect(W.perspVpTo3D({ x: 1, y: 2 }, "XZ")).toEqual({ x: 1, y: 0, z: 2 });
    expect(W.perspVpTo3D({ x: 1, y: 2 }, "YZ")).toEqual({ x: 0, y: 1, z: 2 });
  });

  it("defaults to the XY plane", () => {
    expect(W.perspVpTo3D({ x: 3, y: 4 }, undefined)).toEqual({ x: 3, y: 4, z: 0 });
  });
});

describe("perspApplyVP", () => {
  it("does nothing for a degenerate direction vector", () => {
    const v = new Float32Array([1, 2, 3]);
    W.perspApplyVP(v, 0, 0, 0, { x: 0, y: 0, z: 0 }, 0.5, "linear", 10);
    expect(Array.from(v)).toEqual([1, 2, 3]);
  });

  it("does nothing when projMax is zero or absent", () => {
    const v = new Float32Array([1, 2, 3]);
    W.perspApplyVP(v, 0, 0, 0, { x: 1, y: 0, z: 0 }, 0.5, "linear", 0);
    expect(Array.from(v)).toEqual([1, 2, 3]);
    W.perspApplyVP(v, 0, 0, 0, { x: 1, y: 0, z: 0 }, 0.5, "linear", undefined);
    expect(Array.from(v)).toEqual([1, 2, 3]);
  });

  it("scales differently in exponential mode", () => {
    const lin = new Float32Array([5, 0, 0]);
    const exp = new Float32Array([5, 0, 0]);
    const dir = { x: 1, y: 0, z: 0 };
    W.perspApplyVP(lin, 0, 0, 0, dir, 0.5, "linear", 10);
    W.perspApplyVP(exp, 0, 0, 0, dir, 0.5, "exponential", 10);
    expect(lin[0]).not.toBeCloseTo(exp[0], 6);
  });
});

describe("perspShape", () => {
  it("applies a single vanishing point", () => {
    const v = boxVertices();
    const before = v.slice();
    W.perspShape(
      v,
      { strength: 0.5, mode: "linear", plane: "XY", vpMode: 1,
        vp1: { x: 1, y: 0 }, projMax1: 5 },
      makeBBox()
    );
    expect(v).not.toEqual(before);
  });

  it("applies both vanishing points in 2-point mode", () => {
    const one = boxVertices();
    const two = boxVertices();
    const base = { strength: 0.5, mode: "linear", plane: "XY",
                   vp1: { x: 1, y: 0 }, vp2: { x: 0, y: 1 },
                   projMax1: 5, projMax2: 5 };
    W.perspShape(one, { ...base, vpMode: 1 }, makeBBox());
    W.perspShape(two, { ...base, vpMode: 2 }, makeBBox());
    expect(Array.from(one)).not.toEqual(Array.from(two));
  });

  it("falls back to defaults for missing parameters", () => {
    const v = boxVertices();
    expect(() => W.perspShape(v, { projMax1: 5 }, makeBBox())).not.toThrow();
  });
});

describe("shared contract", () => {
  const bbox = makeBBox();
  const cases = [
    ["noise", (v) => W.noiseShape(v, { intensity: 1, scale: 0.02, axis: "all" }, bbox)],
    ["sine", (v) => W.sineDeformShape(v, { amplitude: 1, frequency: 0.1, driverAxis: "x", dispAxis: "all" })],
    ["pixel", (v) => W.pixelateShape(v, { size: 2, axis: "all" })],
    ["inflate", (v) => W.inflateShape(v, { amount: 0.5 }, bbox)],
    ["twist", (v) => W.twistShape(v, { axis: "y", angle: 90 }, bbox)],
    ["bend", (v) => W.bendShape(v, { axis: "y", strength: 0.5 }, bbox)],
    ["ripple", (v) => W.rippleShape(v, { axis: "y", amplitude: 2, frequency: 0.3 }, bbox)],
    ["warp", (v) => W.warpShape(v, { strength: 1, scale: 0.2 })],
    ["hyper", (v) => W.hyperShape(v, { axis: "y", amount: 0.5 }, bbox)],
    ["boundary", (v) => W.boundaryDisruptShape(v, { threshold: 0.1, jitter: 1 }, bbox)],
    ["spherize", (v) => W.spherizeShape(v, { factor: 0.5, radius: 0 }, bbox)],
    ["idw", (v) => W.idwShape(v, { controlPoints: [{ x: 0, y: 0, z: 0 }], weight: 1, power: 2, scale: 1 })],
    ["persp", (v) => W.perspShape(v, { strength: 0.3, mode: "linear", plane: "XY", vpMode: 1, vp1: { x: 1, y: 0 }, projMax1: 5 }, bbox)],
  ];

  for (const [name, run] of cases) {
    it(`${name}: returns the same array it was given, with finite values`, () => {
      const v = cloud(150);
      const returned = run(v);
      expect(returned).toBe(v);
      expect(allFinite(v)).toBe(true);
    });

    it(`${name}: handles a single triangle`, () => {
      const v = triangle();
      run(v);
      expect(allFinite(v)).toBe(true);
      expect(v.length).toBe(9);
    });
  }
});

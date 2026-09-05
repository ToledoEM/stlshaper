import { describe, it, expect, beforeEach, vi } from "vitest";
import * as M from "../main.js";
import { mountIndexHtml, setInput, setChange, selectType } from "./dom.js";
import { boxVertices, geomFrom } from "./helpers.js";

// The control bindings: every slider, select, checkbox and textarea must write
// through to deformParams. A binding that silently points at a missing element
// is the failure class scripts/check-control-ids.mjs guards structurally; these
// tests confirm the values actually propagate.

describe("setupParameterControls", () => {
  beforeEach(() => {
    mountIndexHtml();
    M.setupParameterControls();
  });

  const ranges = [
    ["noiseIntensity", "noise", "intensity", "2.5", 2.5],
    ["noiseScale", "noise", "scale", "0.3", 0.3],
    ["sineAmp", "sine", "amplitude", "50", 50],
    ["sineFreq", "sine", "frequency", "0.15", 0.15],
    ["pixelSize", "pixel", "size", "12", 12],
    ["idwNumPoints", "idw", "numPoints", "15", 15],
    ["idwWeight", "idw", "weight", "3.5", 3.5],
    ["idwPower", "idw", "power", "1.5", 1.5],
    ["idwScale", "idw", "scale", "6", 6],
    ["idwRays", "idw", "rays", "8", 8],
    ["inflateAmount", "inflate", "amount", "0.9", 0.9],
    ["twistAngle", "twist", "angle", "270", 270],
    ["bendStrength", "bend", "strength", "1.2", 1.2],
    ["rippleAmp", "ripple", "amplitude", "7", 7],
    ["rippleFreq", "ripple", "frequency", "0.4", 0.4],
    ["warpStrength", "warp", "strength", "2", 2],
    ["warpScale", "warp", "scale", "0.4", 0.4],
    ["hyperAmount", "hyper", "amount", "1.2", 1.2],
    ["tessellateSteps", "tessellate", "steps", "2", 2],
    ["boundaryThreshold", "boundary", "threshold", "0.15", 0.15],
    ["boundaryJitter", "boundary", "jitter", "3", 3],
    ["mengerIterations", "menger", "iterations", "2", 2],
    ["mengerKeep", "menger", "keepRatio", "0.5", 0.5],
    ["spherizeFactor", "spherize", "factor", "0.7", 0.7],
    ["spherizeRadius", "spherize", "radius", "25", 25],
    ["perspStrength", "persp", "strength", "0.9", 0.9],
  ];

  for (const [id, key, param, input, expected] of ranges) {
    it(`#${id} updates deformParams.${key}.${param}`, () => {
      setInput(id, input);
      expect(M.deformParams[key][param]).toBe(expected);
    });

    it(`#${id} updates its value label`, () => {
      setInput(id, input);
      const label = document.getElementById(`${id}Val`);
      if (label) expect(label.textContent).toBe(input);
    });
  }

  const selects = [
    ["noiseAxis", "noise", "axis", "xz"],
    ["noiseType", "noise", "type", "perlin"],
    ["sineDriverAxis", "sine", "driverAxis", "z"],
    ["sineDispAxis", "sine", "dispAxis", "xy"],
    ["pixelAxis", "pixel", "axis", "yz"],
    ["twistAxis", "twist", "axis", "x"],
    ["bendAxis", "bend", "axis", "z"],
    ["rippleAxis", "ripple", "axis", "x"],
    ["hyperAxis", "hyper", "axis", "z"],
    ["perspMode", "persp", "mode", "exponential"],
    ["perspPlane", "persp", "plane", "YZ"],
  ];

  for (const [id, key, param, value] of selects) {
    it(`#${id} updates deformParams.${key}.${param}`, () => {
      setChange(id, value);
      expect(M.deformParams[key][param]).toBe(value);
    });
  }

  it("#idwSeed clamps to its permitted range", () => {
    setInput("idwSeed", "500");
    expect(M.deformParams.idw.seed).toBe(500);
    setInput("idwSeed", "99999");
    expect(M.deformParams.idw.seed).toBe(10000);
    setInput("idwSeed", "-5");
    expect(M.deformParams.idw.seed).toBe(0);
  });

  it("#noiseSeed clamps to its permitted range", () => {
    setInput("noiseSeed", "42");
    expect(M.deformParams.noise.seed).toBe(42);
    setInput("noiseSeed", "99999");
    expect(M.deformParams.noise.seed).toBe(10000);
  });

  it("a non-numeric seed falls back to zero", () => {
    setInput("idwSeed", "abc");
    expect(M.deformParams.idw.seed).toBe(0);
  });

  it("#idwManualPoints toggles the checkbox binding", () => {
    setChange("idwManualPoints", true);
    expect(M.deformParams.idw.manualPoints).toBe(true);
    setChange("idwManualPoints", false);
    expect(M.deformParams.idw.manualPoints).toBe(false);
  });

  it("#idwPointsInput updates the textarea binding", () => {
    setInput("idwPointsInput", "1,2,3\n4,5,6");
    expect(M.deformParams.idw.pointsText).toBe("1,2,3\n4,5,6");
  });

  it("the vanishing-point mode radios update vpMode", () => {
    const two = document.querySelector('input[name="vpMode"][value="2"]');
    two.checked = true;
    two.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(M.deformParams.persp.vpMode).toBe(2);
  });

  it("the preprocess controls update their settings", () => {
    setInput("decimate", "60");
    expect(M.preprocessSettings.decimate).toBe(60);
    expect(document.getElementById("decimateVal").textContent).toBe("60");

    setInput("mergeEpsilon", "0.05");
    expect(M.preprocessSettings.mergeEpsilon).toBe(0.05);
    expect(document.getElementById("mergeVal").textContent).toBe("0.05");
  });

  it("binds without error when the document has no controls", () => {
    document.body.innerHTML = "";
    expect(() => M.setupParameterControls()).not.toThrow();
  });
});

describe("setupControlPanels", () => {
  beforeEach(() => {
    mountIndexHtml();
    M.setupParameterControls();
  });

  it("shows only the panel for the selected deformation", () => {
    // currentModelKey is module-private and normally set by the radio listener
    // in setupListeners, which cannot run here because it needs DOM globals
    // that only init() binds. applyImportedSettings sets the same variable and
    // calls setupControlPanels itself, which is the reachable path.
    for (const { key } of M.deformationRegistry) {
      M.applyImportedSettings({ deformationType: key, settings: {} });
      for (const other of M.deformationRegistry) {
        const panel = document.getElementById(other.controlsId);
        const expected = other.key === key ? "block" : "none";
        expect(panel.style.display, `${other.controlsId} while ${key} selected`).toBe(expected);
      }
    }
  });

  it("tolerates a missing panel element", () => {
    document.body.innerHTML = "";
    expect(() => M.setupControlPanels()).not.toThrow();
  });
});

describe("setupPerspCanvas", () => {
  let redraw;

  beforeEach(() => {
    mountIndexHtml();
    redraw = M.setupPerspCanvas(() => {});
    Object.assign(M.deformParams.persp, {
      vpMode: 1, vp1: { x: 0, y: 0 }, vp2: { x: 0, y: 0 },
    });
  });

  it("returns a redraw function", () => {
    expect(typeof redraw).toBe("function");
    expect(() => redraw()).not.toThrow();
  });

  it("returns null when the canvas is absent", () => {
    document.body.innerHTML = "";
    expect(M.setupPerspCanvas(() => {})).toBeNull();
  });

  function pointer(type, x, y) {
    const canvas = document.getElementById("perspCanvas");
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 120, height: 120 });
    const ev = new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
    canvas.dispatchEvent(ev);
  }

  it("clicking sets the first vanishing point", () => {
    pointer("mousedown", 90, 60);
    expect(M.deformParams.persp.vp1.x).toBeGreaterThan(0);
    pointer("mouseup", 90, 60);
  });

  it("dragging moves the active point", () => {
    pointer("mousedown", 90, 60);
    pointer("mousemove", 30, 60);
    expect(M.deformParams.persp.vp1.x).toBeLessThan(0);
    pointer("mouseup", 30, 60);
  });

  it("ignores movement when nothing is being dragged", () => {
    const before = { ...M.deformParams.persp.vp1 };
    pointer("mousemove", 10, 10);
    expect(M.deformParams.persp.vp1).toEqual(before);
  });

  it("clamps a point dragged beyond the circle to its edge", () => {
    pointer("mousedown", 500, 500);
    const { x, y } = M.deformParams.persp.vp1;
    expect(Math.hypot(x, y)).toBeLessThanOrEqual(1.0001);
    pointer("mouseup", 500, 500);
  });

  it("grabs the second point in 2-point mode", () => {
    M.deformParams.persp.vpMode = 2;
    M.deformParams.persp.vp2 = { x: 0.5, y: 0 };
    redraw();
    // Screen position of vp2: cx + 0.5 * R = 60 + 26 = 86.
    pointer("mousedown", 86, 60);
    pointer("mousemove", 60, 30);
    expect(M.deformParams.persp.vp2.y).toBeGreaterThan(0);
    pointer("mouseup", 60, 30);
  });

  it("handles touch events", () => {
    const canvas = document.getElementById("perspCanvas");
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 120, height: 120 });
    const touch = (type, x, y) => {
      const ev = new window.Event(type, { bubbles: true, cancelable: true });
      ev.touches = [{ clientX: x, clientY: y }];
      canvas.dispatchEvent(ev);
    };
    touch("touchstart", 90, 60);
    touch("touchmove", 40, 60);
    expect(M.deformParams.persp.vp1.x).toBeLessThan(0);
    canvas.dispatchEvent(new window.Event("touchend", { bubbles: true }));
  });

  it("stops dragging when the pointer leaves the canvas", () => {
    pointer("mousedown", 90, 60);
    document.getElementById("perspCanvas")
      .dispatchEvent(new window.MouseEvent("mouseleave", { bubbles: true }));
    const before = { ...M.deformParams.persp.vp1 };
    pointer("mousemove", 10, 10);
    expect(M.deformParams.persp.vp1).toEqual(before);
  });
});

describe("updateStats", () => {
  beforeEach(() => mountIndexHtml());

  it("does nothing when the stats element is unbound", () => {
    // statsElement is assigned by init(), which tests do not run.
    expect(() => M.updateStats(geomFrom(boxVertices()), null, null)).not.toThrow();
  });
});

describe("hideProgressBar", () => {
  beforeEach(() => mountIndexHtml());

  it("hides the bar and resets its fill", () => {
    const container = document.getElementById("progressContainer");
    const fill = document.getElementById("progressFill");
    container.style.display = "block";
    fill.style.width = "50%";

    M.hideProgressBar();

    expect(container.style.display).toBe("none");
    expect(fill.style.width).toBe("0%");
  });

  it("tolerates the elements being absent", () => {
    document.body.innerHTML = "";
    expect(() => M.hideProgressBar()).not.toThrow();
  });
});

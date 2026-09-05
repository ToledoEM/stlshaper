import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import * as M from "../main.js";
import { mountIndexHtml, setInput, setChange } from "./dom.js";

// Settings import/export and the UI synchronisation that follows it. The C4
// defect lived here: spherize and persp had no syncSettingsUI branch, so
// importing either updated the values but left every control showing the old
// state.

const EXAMPLES = path.join(process.cwd(), "stl/settings_examples");

function loadExample(name) {
  return JSON.parse(fs.readFileSync(path.join(EXAMPLES, name), "utf8"));
}

describe("syncSettingsUI", () => {
  beforeEach(() => {
    mountIndexHtml();
    M.setupParameterControls();
  });

  it("restores every noise control, defaulting type and seed for old files", () => {
    Object.assign(M.deformParams.noise, {
      intensity: 3.2, scale: 0.15, axis: "xz", type: "perlin", seed: 77,
    });
    M.syncSettingsUI("noise");
    expect(document.getElementById("noiseIntensity").value).toBe("3.2");
    expect(document.getElementById("noiseScale").value).toBe("0.15");
    expect(document.getElementById("noiseAxis").value).toBe("xz");
    expect(document.getElementById("noiseType").value).toBe("perlin");
    expect(document.getElementById("noiseSeed").value).toBe("77");
  });

  it("falls back to white noise when a recipe carries no type", () => {
    delete M.deformParams.noise.type;
    delete M.deformParams.noise.seed;
    M.syncSettingsUI("noise");
    expect(document.getElementById("noiseType").value).toBe("white");
    expect(document.getElementById("noiseSeed").value).toBe("0");
    M.deformParams.noise.type = "white";
    M.deformParams.noise.seed = 0;
  });

  const simple = [
    ["sine", { amplitude: 42, frequency: 0.11, driverAxis: "z", dispAxis: "xy" },
      { sineAmp: "42", sineFreq: "0.11", sineDriverAxis: "z", sineDispAxis: "xy" }],
    ["pixel", { size: 7, axis: "yz" }, { pixelSize: "7", pixelAxis: "yz" }],
    ["inflate", { amount: 0.9 }, { inflateAmount: "0.9" }],
    ["twist", { angle: 270, axis: "x" }, { twistAngle: "270", twistAxis: "x" }],
    ["bend", { strength: 1.4, axis: "z" }, { bendStrength: "1.4", bendAxis: "z" }],
    ["ripple", { amplitude: 8, frequency: 0.5, axis: "x" },
      { rippleAmp: "8", rippleFreq: "0.5", rippleAxis: "x" }],
    ["warp", { strength: 2.5, scale: 0.35 }, { warpStrength: "2.5", warpScale: "0.35" }],
    ["hyper", { amount: 1.1, axis: "z" }, { hyperAmount: "1.1", hyperAxis: "z" }],
    ["tessellate", { steps: 2 }, { tessellateSteps: "2" }],
    ["boundary", { threshold: 0.2, jitter: 3.5 },
      { boundaryThreshold: "0.2", boundaryJitter: "3.5" }],
    ["menger", { iterations: 2, keepRatio: 0.4 },
      { mengerIterations: "2", mengerKeep: "0.4" }],
    ["spherize", { factor: 0.4, radius: 12 },
      { spherizeFactor: "0.4", spherizeRadius: "12" }],
  ];

  for (const [type, values, expected] of simple) {
    it(`restores every ${type} control`, () => {
      Object.assign(M.deformParams[type], values);
      M.syncSettingsUI(type);
      for (const [id, want] of Object.entries(expected)) {
        expect(document.getElementById(id).value, `#${id}`).toBe(want);
      }
    });
  }

  it("restores every IDW control", () => {
    Object.assign(M.deformParams.idw, {
      numPoints: 12, seed: 5, weight: 3, power: 1.5, scale: 4,
      rays: 8, manualPoints: true, pointsText: "1,2,3",
    });
    M.syncSettingsUI("idw");
    expect(document.getElementById("idwNumPoints").value).toBe("12");
    expect(document.getElementById("idwSeed").value).toBe("5");
    expect(document.getElementById("idwManualPoints").checked).toBe(true);
    expect(document.getElementById("idwPointsInput").value).toBe("1,2,3");
  });

  it("restores the perspective controls, including the vanishing-point mode", () => {
    Object.assign(M.deformParams.persp, {
      strength: 0.85, mode: "exponential", plane: "YZ", vpMode: 2,
      vp1: { x: -0.45, y: 0.47 }, vp2: { x: 0.87, y: -0.26 },
    });
    M.syncSettingsUI("persp");
    expect(document.getElementById("perspStrength").value).toBe("0.85");
    expect(document.getElementById("perspMode").value).toBe("exponential");
    expect(document.getElementById("perspPlane").value).toBe("YZ");
    expect(document.querySelector('input[name="vpMode"][value="2"]').checked).toBe(true);
  });

  it("ignores values that are absent from the settings", () => {
    expect(() => M.syncSettingsUI("noise")).not.toThrow();
    expect(() => M.syncSettingsUI("unknown-type")).not.toThrow();
  });

  it("ignores a select value with no matching option", () => {
    M.deformParams.noise.axis = "not-an-option";
    M.syncSettingsUI("noise");
    expect(document.getElementById("noiseAxis").value).not.toBe("not-an-option");
    M.deformParams.noise.axis = "all";
  });

  it("restores the preprocess controls", () => {
    M.preprocessSettings.decimate = 45;
    M.preprocessSettings.mergeEpsilon = 0.02;
    M.syncSettingsUI("noise");
    expect(document.getElementById("decimate").value).toBe("45");
    expect(document.getElementById("mergeEpsilon").value).toBe("0.02");
    M.preprocessSettings.decimate = 100;
    M.preprocessSettings.mergeEpsilon = 0;
  });
});

describe("applyImportedSettings", () => {
  beforeEach(() => {
    mountIndexHtml();
    M.setupParameterControls();
  });

  it("rejects input that is not an object", () => {
    for (const bad of [null, undefined, "text", 42]) {
      expect(() => M.applyImportedSettings(bad)).not.toThrow();
    }
  });

  it("rejects settings with no deformation type or values", () => {
    expect(() => M.applyImportedSettings({})).not.toThrow();
    expect(() => M.applyImportedSettings({ deformationType: "noise" })).not.toThrow();
    expect(() => M.applyImportedSettings({ settings: {} })).not.toThrow();
    expect(() => M.applyImportedSettings({ deformationType: "nope", settings: {} })).not.toThrow();
  });

  it("applies the shipped spherize example to the controls", () => {
    // The C4 regression: these values used to import without moving anything.
    M.applyImportedSettings(loadExample("spherize_settings.json"));
    expect(M.deformParams.spherize.factor).toBe(0.4);
    expect(document.getElementById("spherizeFactor").value).toBe("0.4");
    expect(document.querySelector('input[name="type"][value="spherize"]').checked).toBe(true);
  });

  it("applies the shipped perspective example to the controls", () => {
    M.applyImportedSettings(loadExample("persp_settings.json"));
    expect(M.deformParams.persp.strength).toBe(0.85);
    expect(M.deformParams.persp.plane).toBe("YZ");
    expect(document.getElementById("perspStrength").value).toBe("0.85");
    expect(document.getElementById("perspPlane").value).toBe("YZ");
    expect(document.querySelector('input[name="vpMode"][value="2"]').checked).toBe(true);
  });

  it("applies every other shipped example without error", () => {
    for (const file of fs.readdirSync(EXAMPLES).filter((f) => f.endsWith(".json"))) {
      expect(() => M.applyImportedSettings(loadExample(file)), file).not.toThrow();
    }
  });

  it("applies the preprocess block when present", () => {
    M.applyImportedSettings({
      deformationType: "noise",
      settings: { intensity: 2 },
      preprocess: { decimate: 55, mergeEpsilon: 0.03 },
    });
    expect(M.preprocessSettings.decimate).toBe(55);
    expect(M.preprocessSettings.mergeEpsilon).toBe(0.03);
    M.preprocessSettings.decimate = 100;
    M.preprocessSettings.mergeEpsilon = 0;
  });

  it("ignores a preprocess block with non-numeric values", () => {
    M.preprocessSettings.decimate = 100;
    M.applyImportedSettings({
      deformationType: "noise",
      settings: { intensity: 2 },
      preprocess: { decimate: "half", mergeEpsilon: null },
    });
    expect(M.preprocessSettings.decimate).toBe(100);
  });

  it("restores resolved IDW control points as manual points", () => {
    M.applyImportedSettings({
      deformationType: "idw",
      settings: { numPoints: 3 },
      resolvedControlPoints: [
        { x: 1, y: 2, z: 3 },
        { x: 4, y: 5, z: 6 },
      ],
    });
    expect(M.deformParams.idw.manualPoints).toBe(true);
    expect(M.parseManualControlPoints(M.deformParams.idw.pointsText)).toEqual([
      { x: 1, y: 2, z: 3 },
      { x: 4, y: 5, z: 6 },
    ]);
  });

  it("skips malformed control points", () => {
    M.deformParams.idw.manualPoints = false;
    M.applyImportedSettings({
      deformationType: "idw",
      settings: {},
      resolvedControlPoints: [{ x: NaN, y: 1, z: 2 }, { x: "a", y: 1, z: 2 }],
    });
    expect(M.deformParams.idw.manualPoints).toBe(false);
  });

  it("ignores resolvedControlPoints that are not an array", () => {
    expect(() =>
      M.applyImportedSettings({
        deformationType: "idw",
        settings: {},
        resolvedControlPoints: "nope",
      })
    ).not.toThrow();
  });
});

describe("importSettingsFromFile", () => {
  beforeEach(() => mountIndexHtml());

  it("parses a settings file and applies it", async () => {
    const file = new window.File(
      [JSON.stringify({ deformationType: "noise", settings: { intensity: 4.5 } })],
      "settings.json",
      { type: "application/json" }
    );
    M.importSettingsFromFile(file);
    await vi.waitFor(() => expect(M.deformParams.noise.intensity).toBe(4.5));
  });

  it("reports invalid JSON rather than throwing", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    M.importSettingsFromFile(new window.File(["{not json"], "bad.json"));
    await vi.waitFor(() => expect(err).toHaveBeenCalled());
    err.mockRestore();
  });
});

describe("exportSettings", () => {
  beforeEach(() => {
    mountIndexHtml();
    M.resetDeformedGeometries();
  });

  it("returns without writing a file when there is nothing to export", () => {
    // statusElement is only bound by init(), which tests do not run, so the
    // status text is not observable here. What matters is that the guard
    // short-circuits before reaching saveAs.
    const save = vi.spyOn(globalThis, "saveAs").mockImplementation(() => {});
    M.exportSettings();
    expect(save).not.toHaveBeenCalled();
    save.mockRestore();
  });
});

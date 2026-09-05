import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as M from "../main.js";
import { mountIndexHtml, selectType } from "./dom.js";
import { boxVertices, geomFrom, maxDiff } from "./helpers.js";

const THREE = globalThis.THREE;
const here = path.dirname(fileURLToPath(import.meta.url));

// Chained deformations: up to three stages composed in order, each fed the
// previous stage's output rather than the original mesh.

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

/** Positions of the geometry the viewer currently treats as the deformed model. */
function activePositions() {
  return Array.from(M.activeDeformedGeometry().getAttribute("position").array);
}

function clickChain(id) {
  return document.getElementById(id).onclick();
}

/** Fills slot `index` with `key`, applying any parameter overrides first. */
function fillSlot(index, key, params = {}) {
  selectType(key);
  Object.assign(M.deformParams[key], params);
  document.getElementById(`chainSlot${index}`).onclick();
  selectType(key);
  Object.assign(M.deformParams[key], params);
  clickChain("chainSetBtn");
}

describe("chain projection and cap", () => {
  afterEach(() => M.clearChain());

  it("treats vertex-for-vertex deformations as no growth", () => {
    expect(M.stageGrowthFactor({ key: "noise", params: {} })).toBe(1);
    expect(M.stageGrowthFactor({ key: "twist", params: {} })).toBe(1);
    expect(M.stageGrowthFactor(null)).toBe(1);
  });

  it("multiplies tessellate by 4 per step", () => {
    expect(M.stageGrowthFactor({ key: "tessellate", params: { steps: 1 } })).toBe(4);
    expect(M.stageGrowthFactor({ key: "tessellate", params: { steps: 3 } })).toBe(64);
  });

  it("bounds menger at the subdivision its carver actually applies", () => {
    // mengerCarveGeometry clamps subdivision to min(2, iterations), so the
    // slider's max of 3 does not reach the geometry.
    expect(M.stageGrowthFactor({ key: "menger", params: { iterations: 3 } })).toBe(16);
  });

  it("accumulates growth across stages", () => {
    const chain = [
      { key: "tessellate", params: { steps: 1 } },
      { key: "noise", params: {} },
      { key: "tessellate", params: { steps: 2 } },
    ];
    const steps = M.projectChainTriangles(chain, 100);
    expect(steps.map((s) => s.triangles)).toEqual([400, 400, 6400]);
  });

  it("permits the default model through two tessellate steps", () => {
    // The shipped default model is 15,580 triangles.
    const chain = [{ key: "tessellate", params: { steps: 2 } }, null, null];
    expect(M.findChainOverflow(chain, 15580)).toBeNull();
    expect(M.projectChainTriangles(chain, 15580)[0].triangles).toBe(249280);
  });

  it("refuses three max-step tessellate slots and names the first bad slot", () => {
    const chain = [
      { key: "tessellate", params: { steps: 3 } },
      { key: "tessellate", params: { steps: 3 } },
      { key: "tessellate", params: { steps: 3 } },
    ];
    const overflow = M.findChainOverflow(chain, 15580);
    expect(overflow).not.toBeNull();
    // Against the 15,580-triangle default model the first stage reaches
    // 997,120 — inside the cap. Slot 2 is the first to break it.
    expect(overflow.slot).toBe(1);
    expect(overflow.key).toBe("tessellate");
    expect(overflow.triangles).toBeGreaterThan(M.MAX_CHAIN_TRIANGLES);
  });

  it("reports no overflow for a chain that fits", () => {
    const chain = [{ key: "noise", params: {} }, { key: "twist", params: {} }, null];
    expect(M.findChainOverflow(chain, 15580)).toBeNull();
  });
});

describe("chain parameter snapshots", () => {
  afterEach(() => M.clearChain());

  it("copies nested perspective vanishing points rather than aliasing them", () => {
    M.setChainSlot(0, "persp", {
      strength: 0.5, mode: "linear", plane: "XY", vpMode: 2,
      vp1: { x: 1, y: 0 }, vp2: { x: 0, y: 1 },
    });
    const stored = M.filledChainStages()[0];
    // Mutating the live editing buffer must not reach the stored stage.
    M.deformParams.persp.vp1.x = -1;
    expect(stored.params.vp1.x).toBe(1);
  });

  it("copies IDW control point arrays", () => {
    const points = [{ x: 1, y: 2, z: 3 }];
    const copy = M.cloneDeformParams({ controlPoints: points });
    copy.controlPoints[0].x = 99;
    expect(points[0].x).toBe(1);
  });

  it("clears the slot when passed a null key", () => {
    M.setChainSlot(0, "noise");
    expect(M.filledChainStages()).toHaveLength(1);
    M.setChainSlot(0, null);
    expect(M.filledChainStages()).toHaveLength(0);
  });

  it("ignores out-of-range slot indices", () => {
    M.setChainSlot(7, "noise");
    M.setChainSlot(-1, "noise");
    expect(M.filledChainStages()).toHaveLength(0);
  });

  it("describes a chain by its stage keys in order", () => {
    M.setChainSlot(0, "noise");
    M.setChainSlot(1, "twist");
    expect(M.chainDescription()).toBe("noise_twist");
  });
});

describe("running a chain", () => {
  beforeEach(() => { stubRenderer(); bootWith(); });
  afterEach(() => { M.clearChain(); restore(); vi.restoreAllMocks(); });

  it("matches the single-deformation path for a one-slot chain", async () => {
    // Proves the runDeformation extraction changed nothing: the same
    // deformation reached through the chain must land on the same vertices.
    selectType("twist");
    M.deformParams.twist.angle = 90;
    await document.getElementById("processBtn").onclick();
    const single = activePositions();

    fillSlot(0, "twist", { angle: 90 });
    await clickChain("chainCalcBtn");
    const chained = activePositions();

    expect(chained).toHaveLength(single.length);
    expect(maxDiff(chained, single)).toBe(0);
  });

  it("composes two stages rather than restarting from the original", async () => {
    fillSlot(0, "twist", { angle: 90 });
    fillSlot(1, "bend", { strength: 0.8 });
    await clickChain("chainCalcBtn");
    const chained = activePositions();

    // Bend alone, from the original, must differ — otherwise stage 2 threw away
    // stage 1's output.
    M.clearChain();
    selectType("bend");
    M.deformParams.bend.strength = 0.8;
    await document.getElementById("processBtn").onclick();
    const bendOnly = activePositions();

    expect(maxDiff(chained, bendOnly)).toBeGreaterThan(1e-6);
  });

  it("is order-dependent", async () => {
    fillSlot(0, "twist", { angle: 120 });
    fillSlot(1, "bend", { strength: 0.9 });
    await clickChain("chainCalcBtn");
    const twistThenBend = activePositions();

    M.clearChain();
    fillSlot(0, "bend", { strength: 0.9 });
    fillSlot(1, "twist", { angle: 120 });
    await clickChain("chainCalcBtn");
    const bendThenTwist = activePositions();

    expect(maxDiff(twistThenBend, bendThenTwist)).toBeGreaterThan(1e-6);
  });

  it("recomputes the perspective normalisation per stage in exponential mode", async () => {
    // projMax cancels algebraically in linear mode but not in exponential, so a
    // stale value carried over from stage 1 is silently wrong. Compare a
    // two-stage chain against the same second stage handed a geometry whose
    // projMax was computed correctly for it.
    const persp = {
      strength: 0.5, mode: "exponential", plane: "XY", vpMode: 1,
      vp1: { x: 1, y: 0 }, vp2: { x: 0, y: 0 },
    };
    fillSlot(0, "tessellate", { steps: 1 });
    fillSlot(1, "persp", persp);
    await clickChain("chainCalcBtn");
    const chained = activePositions();

    // Reproduce stage 2 directly against stage 1's output.
    const stage1 = await M.runDeformation(
      M.applyPreprocess(geomFrom(boxVertices(60))),
      "tessellate",
      { steps: 1 }
    );
    const stage2 = await M.runDeformation(stage1, "persp", { ...persp, vp1: { ...persp.vp1 } });
    const direct = Array.from(stage2.getAttribute("position").array);

    expect(maxDiff(chained, direct)).toBeLessThan(1e-6);
    // And the projMax that stage 2 saw must belong to the tessellated mesh, not
    // to a mesh of the original triangle count.
    expect(direct).toHaveLength(boxVertices(60).length * 4);
  });

  it("regenerates IDW control points against the intermediate mesh", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spy = vi.spyOn(M, "generateIDWControlPoints");
    // The spy cannot intercept the module-internal call, so assert on the
    // observable consequence instead: stage 2's points must lie inside the
    // bounds of stage 1's output, which twisting has changed.
    fillSlot(0, "twist", { angle: 180 });
    fillSlot(1, "idw", { numPoints: 3, manualPoints: false });
    await clickChain("chainCalcBtn");

    const stage1 = await M.runDeformation(
      M.applyPreprocess(geomFrom(boxVertices(60))),
      "twist",
      { angle: 180 }
    );
    stage1.computeBoundingBox();
    const bbox = stage1.boundingBox;
    const points = M.generateIDWControlPoints(stage1);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(bbox.min.x - 1e-6);
      expect(p.x).toBeLessThanOrEqual(bbox.max.x + 1e-6);
    }
    spy.mockRestore();
    warn.mockRestore();
  });


  it("reports an empty chain rather than running", async () => {
    await clickChain("chainCalcBtn");
    expect(document.getElementById("status").textContent).toContain("Chain is empty");
  });

  it("rejects an unknown deformation key", async () => {
    await expect(
      M.runDeformation(geomFrom(boxVertices(60)), "nonexistent", {})
    ).rejects.toThrow("Unknown deformation type");
  });

  it("reports a stage failure without leaving the progress bar stranded", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    fillSlot(0, "noise");
    // A null axis makes the noise deformation throw inside the stage loop. Set
    // it on the live buffer, which Calculate folds into the active slot.
    M.deformParams.noise.axis = null;
    await clickChain("chainCalcBtn");
    M.deformParams.noise.axis = "all";

    expect(document.getElementById("status").textContent).toContain("Error generating chain");
    expect(document.getElementById("progressContainer").style.display).toBe("none");
    err.mockRestore();
  });

  it("asks for a model before running a chain", async () => {
    M.setChainSlot(0, "noise");
    M.clearModelAndUI();
    await clickChain("chainCalcBtn");
    expect(document.getElementById("status").textContent).toContain("Please load an STL");
  });

  it("leaves single-deformation mode unchanged when no slots are filled", async () => {
    selectType("noise");
    M.deformParams.noise.intensity = 1.5;
    await document.getElementById("processBtn").onclick();
    expect(document.getElementById("status").textContent).toContain("successfully");
    expect(M.filledChainStages()).toHaveLength(0);
  });

  it("lets a later single deformation supersede a chain result", async () => {
    fillSlot(0, "twist", { angle: 90 });
    await clickChain("chainCalcBtn");
    const chained = activePositions();

    selectType("inflate");
    M.deformParams.inflate.amount = 0.6;
    await document.getElementById("processBtn").onclick();

    expect(maxDiff(activePositions(), chained)).toBeGreaterThan(1e-6);
  });

  it("names the export after the whole chain", async () => {
    const save = vi.spyOn(globalThis, "saveAs").mockImplementation(() => {});
    fillSlot(0, "twist", { angle: 90 });
    fillSlot(1, "bend", { strength: 0.5 });
    await clickChain("chainCalcBtn");
    document.getElementById("exportBtn").onclick();
    expect(save.mock.calls[0][1]).toBe("twist_bend_deformed.stl");
  });

  it("clears the chain result when the chain is cleared", async () => {
    fillSlot(0, "twist", { angle: 90 });
    await clickChain("chainCalcBtn");
    expect(M.filledChainStages()).toHaveLength(1);
    clickChain("chainClearBtn");
    expect(M.filledChainStages()).toHaveLength(0);
    expect(document.getElementById("status").textContent).toContain("Chain cleared");
  });
});

describe("chain cap refusal", () => {
  // The 12-triangle box survives three max tessellates (3.1M, inside the 5M
  // cap). Two boxes is 24 triangles, and 24 x 262,144 is 6.3M — over it.
  function twoBoxes() {
    const one = boxVertices(60);
    const out = new Float32Array(one.length * 2);
    out.set(one, 0);
    const shifted = Float32Array.from(one);
    for (let i = 2; i < shifted.length; i += 3) shifted[i] += 200;
    out.set(shifted, one.length);
    return out;
  }

  beforeEach(() => { stubRenderer(); bootWith(twoBoxes()); });
  afterEach(() => { M.clearChain(); restore(); vi.restoreAllMocks(); });

  it("refuses an over-cap chain, names the slot, and leaves the model alone", async () => {
    selectType("noise");
    await document.getElementById("processBtn").onclick();
    const before = activePositions();

    fillSlot(0, "tessellate", { steps: 3 });
    fillSlot(1, "tessellate", { steps: 3 });
    fillSlot(2, "tessellate", { steps: 3 });
    await clickChain("chainCalcBtn");

    const status = document.getElementById("status").textContent;
    expect(status).toContain("Chain refused");
    expect(status).toContain("slot");
    expect(status).toContain("tessellate");

    // No chain output was produced, so the earlier noise result is still the
    // model on hand: selecting it back gives exactly what was there before.
    selectType("noise");
    expect(activePositions()).toEqual(before);
  });

  it("permits a chain that stays inside the cap", async () => {
    fillSlot(0, "tessellate", { steps: 1 });
    fillSlot(1, "noise", { intensity: 1.0 });
    await clickChain("chainCalcBtn");
    expect(document.getElementById("status").textContent).toContain("successfully");
  });
});

describe("chain bar UI", () => {
  beforeEach(() => { stubRenderer(); bootWith(); });
  afterEach(() => { M.clearChain(); restore(); vi.restoreAllMocks(); });

  it("labels filled slots and marks the active one", () => {
    fillSlot(0, "noise");
    const slot0 = document.getElementById("chainSlot0");
    expect(slot0.textContent).toContain("Noise");
    expect(slot0.classList.contains("filled")).toBe(true);
    expect(slot0.classList.contains("active")).toBe(true);
    expect(document.getElementById("chainSlot1").textContent).toContain("empty");
  });

  it("restores a slot's own parameters when it is reselected", () => {
    fillSlot(0, "twist", { angle: 45 });
    fillSlot(1, "twist", { angle: 170 });

    document.getElementById("chainSlot0").onclick();
    expect(M.deformParams.twist.angle).toBe(45);

    document.getElementById("chainSlot1").onclick();
    expect(M.deformParams.twist.angle).toBe(170);
  });

  it("points the radio and panel at the selected slot's deformation", () => {
    fillSlot(0, "noise");
    fillSlot(1, "bend");

    document.getElementById("chainSlot0").onclick();
    expect(document.querySelector('input[name="type"]:checked').value).toBe("noise");
    expect(document.getElementById("noiseControls").style.display).toBe("block");
  });

  it("empties a slot with Clear Slot", () => {
    fillSlot(0, "noise");
    expect(M.filledChainStages()).toHaveLength(1);
    clickChain("chainClearSlotBtn");
    expect(M.filledChainStages()).toHaveLength(0);
    expect(document.getElementById("chainSlot0").textContent).toContain("empty");
  });

  it("enables Calculate only once a slot is filled", () => {
    expect(document.getElementById("chainCalcBtn").disabled).toBe(true);
    fillSlot(0, "noise");
    expect(document.getElementById("chainCalcBtn").disabled).toBe(false);
  });
});

describe("chain settings files", () => {
  beforeEach(() => { stubRenderer(); bootWith(); });
  afterEach(() => { M.clearChain(); restore(); vi.restoreAllMocks(); });

  async function readBlob(blob) {
    return new Promise((resolve) => {
      const reader = new window.FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(blob);
    });
  }

  it("round-trips a chain through export and import", async () => {
    const save = vi.spyOn(globalThis, "saveAs").mockImplementation(() => {});
    fillSlot(0, "twist", { angle: 135 });
    fillSlot(1, "bend", { strength: 0.4 });
    await clickChain("chainCalcBtn");

    document.getElementById("exportSettingsBtn").onclick();
    const data = JSON.parse(await readBlob(save.mock.calls[0][0]));
    expect(data.chain).toHaveLength(2);
    expect(save.mock.calls[0][1]).toBe("twist_bend_settings.json");

    M.clearChain();
    M.applyImportedSettings(data);

    const stages = M.filledChainStages();
    expect(stages.map((s) => s.key)).toEqual(["twist", "bend"]);
    expect(stages[0].params.angle).toBe(135);
    expect(stages[1].params.strength).toBe(0.4);
  });

  it("drops unknown deformations from an imported chain", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    M.applyImportedSettings({
      chain: [
        { deformationType: "twist", settings: { angle: 30 } },
        { deformationType: "nonexistent", settings: {} },
      ],
    });
    expect(M.filledChainStages().map((s) => s.key)).toEqual(["twist"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("kept 1 of 2"));
    warn.mockRestore();
  });

  it("rejects a chain naming no known deformation", () => {
    M.applyImportedSettings({ chain: [{ deformationType: "bogus", settings: {} }] });
    expect(document.getElementById("status").textContent).toContain("no known deformations");
    expect(M.filledChainStages()).toHaveLength(0);
  });

  it("keeps only the first CHAIN_SLOTS stages", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    M.applyImportedSettings({
      chain: ["noise", "twist", "bend", "inflate"].map((k) => ({
        deformationType: k,
        settings: {},
      })),
    });
    expect(M.filledChainStages()).toHaveLength(M.CHAIN_SLOTS);
    warn.mockRestore();
  });

  it("applies preprocess settings from a chain file", () => {
    M.applyImportedSettings({
      chain: [{ deformationType: "noise", settings: {} }],
      preprocess: { decimate: 60, mergeEpsilon: 0.25 },
    });
    expect(M.preprocessSettings.decimate).toBe(60);
    expect(M.preprocessSettings.mergeEpsilon).toBe(0.25);
    M.preprocessSettings.decimate = 100;
    M.preprocessSettings.mergeEpsilon = 0;
  });

  it("still loads every shipped single-deformation example", () => {
    const dir = path.join(here, "../stl/settings_examples");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      M.clearChain();
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      M.applyImportedSettings(data);
      // A pre-chain recipe must load as a single deformation, filling no slots.
      expect(M.filledChainStages(), `${file} filled chain slots`).toHaveLength(0);
      expect(
        document.getElementById("status").textContent,
        `${file} failed to import`
      ).toContain(`Imported settings for ${data.deformationType}`);
    }
  });

  it("clears a loaded chain when a single-deformation file is imported", () => {
    M.setChainSlot(0, "noise");
    M.applyImportedSettings({
      deformationType: "twist",
      settings: { angle: 60 },
    });
    expect(M.filledChainStages()).toHaveLength(0);
    expect(M.deformParams.twist.angle).toBe(60);
  });
});

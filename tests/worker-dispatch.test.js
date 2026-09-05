import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleMessage } from "../worker.js";
import { makeBBox, cloud } from "./helpers.js";

// The onmessage dispatch: routes a deformation type to its function and posts
// either a result or an error back. handleMessage is exported separately from
// the `self.onmessage` binding precisely so it can be driven without a Worker.

describe("handleMessage", () => {
  let posted;

  beforeEach(() => {
    posted = [];
    globalThis.self = { postMessage: (m) => posted.push(m) };
  });

  function send(overrides = {}) {
    handleMessage({
      data: {
        type: "deform",
        deformationType: "noise",
        params: { intensity: 1, scale: 0.02, axis: "all" },
        vertices: cloud(30),
        bbox: makeBBox(),
        chunkId: 7,
        workerId: 3,
        ...overrides,
      },
    });
    return posted;
  }

  it("posts a successful result with the chunk and worker ids echoed back", () => {
    const [msg] = send();
    expect(msg.type).toBe("result");
    expect(msg.success).toBe(true);
    expect(msg.chunkId).toBe(7);
    expect(msg.workerId).toBe(3);
    expect(msg.vertices).toBeInstanceOf(Float32Array);
  });

  it("ignores messages that are not deformation requests", () => {
    handleMessage({ data: { type: "something-else" } });
    expect(posted).toHaveLength(0);
  });

  it("reports an error for an unknown deformation type", () => {
    const [msg] = send({ deformationType: "nonexistent" });
    expect(msg.type).toBe("error");
    expect(msg.error).toContain("Unknown deformation type");
    expect(msg.chunkId).toBe(7);
  });

  it("reports an error rather than throwing when a deformation fails", () => {
    // `axis` is read with .includes(), so null makes noiseShape throw. The
    // dispatch must convert that into an error message, since an exception
    // escaping the worker would leave the pool waiting forever.
    const [msg] = send({ params: { intensity: 1, scale: 1, axis: null } });
    expect(msg.type).toBe("error");
    expect(typeof msg.error).toBe("string");
  });

  // Every registered worker deformation must be reachable through the switch.
  const types = [
    ["noise", { intensity: 1, scale: 0.02, axis: "all" }],
    ["sine", { amplitude: 1, frequency: 0.1, driverAxis: "x", dispAxis: "all" }],
    ["pixel", { size: 2, axis: "all" }],
    ["idw", { controlPoints: [{ x: 0, y: 0, z: 0 }], weight: 1, power: 2, scale: 1 }],
    ["inflate", { amount: 0.5 }],
    ["twist", { axis: "y", angle: 90 }],
    ["bend", { axis: "y", strength: 0.5 }],
    ["ripple", { axis: "y", amplitude: 2, frequency: 0.3 }],
    ["warp", { strength: 1, scale: 0.2 }],
    ["hyper", { axis: "y", amount: 0.5 }],
    ["boundary", { threshold: 0.1, jitter: 1 }],
    ["spherize", { factor: 0.5, radius: 0 }],
    ["persp", { strength: 0.3, mode: "linear", plane: "XY", vpMode: 1, vp1: { x: 1, y: 0 }, projMax1: 5 }],
  ];

  for (const [deformationType, params] of types) {
    it(`dispatches "${deformationType}"`, () => {
      const [msg] = send({ deformationType, params });
      expect(msg.type).toBe("result");
      expect(msg.success).toBe(true);
    });
  }

  it("covers every usesWorker deformation in the registry", async () => {
    // Guards against a deformation being registered without a dispatch case.
    const { deformationRegistry } = await import("../main.js");
    const workerKeys = deformationRegistry
      .filter((d) => d.usesWorker)
      .map((d) => d.key)
      .sort();
    expect(types.map(([t]) => t).sort()).toEqual(workerKeys);
  });
});

// Global test setup, run before every suite.
//
// main.js expects a browser: a global THREE, a DOM, and it boots itself on
// load. This file supplies the first two and disarms the third, so importing
// the module under test is inert.

import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

// Tell main.js not to auto-run init() on import. Must be set before any import
// of main.js is evaluated — setupFiles run first, so this is safe.
globalThis.__STLSHAPER_TEST__ = true;

// Load the vendored Three.js build the deployed app pins (r121), so tests run
// against the same revision rather than a differing npm copy.
//
// It cannot simply be require()d: the UMD header takes its CommonJS branch and
// then marks the namespace `__esModule`, which makes the interop layer rewrap
// it and hand back an empty object. Evaluating it in a bare vm context leaves
// only the global branch available, which populates THREE correctly.
const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "../libraries/three.min.js"), "utf8");
const sandbox = { console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const THREE = sandbox.THREE;

if (!THREE || typeof THREE.BufferGeometry !== "function") {
  throw new Error("Failed to load libraries/three.min.js for tests");
}

globalThis.THREE = THREE;
if (typeof window !== "undefined") {
  window.THREE = THREE;
}

// This jsdom build exposes no localStorage (Node 26 shadows it with an
// experimental implementation that is disabled without --localstorage-file),
// but main.js reads it for the theme. A plain in-memory Storage is enough and
// keeps each run isolated.
if (!globalThis.localStorage) {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => store.set(String(k), String(v)),
    removeItem: (k) => store.delete(String(k)),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

// FileSaver's saveAs is a global in the browser; export paths call it.
globalThis.saveAs = () => {};
if (typeof window !== "undefined") {
  window.saveAs = globalThis.saveAs;
}

// jsdom has no canvas implementation, so getContext returns null and the
// vanishing-point widget's drawing calls would throw. This stub records no
// pixels — it exists so the widget's geometry and hit-testing logic can run.
// Nothing here is asserted on; the tests check the parameter values the widget
// produces, not what it paints.
if (typeof window !== "undefined" && window.HTMLCanvasElement) {
  const noop = () => {};
  window.HTMLCanvasElement.prototype.getContext = function getContext(kind) {
    if (kind !== "2d") return null;
    return {
      canvas: this,
      clearRect: noop,
      beginPath: noop,
      arc: noop,
      moveTo: noop,
      lineTo: noop,
      stroke: noop,
      fill: noop,
      fillRect: noop,
      fillText: noop,
      save: noop,
      restore: noop,
      translate: noop,
      scale: noop,
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 1,
      font: "",
      textAlign: "",
      textBaseline: "",
    };
  };
}

export { THREE };

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as M from "../main.js";
import { mountIndexHtml, selectType } from "./dom.js";
import { boxVertices } from "./helpers.js";

const THREE = globalThis.THREE;
const I18N = globalThis.STLI18N;
const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, "../index.html"), "utf8");

afterEach(() => {
  I18N.setLanguage("en");
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("dictionary", () => {
  const enKeys = Object.keys(I18N.DICT.en).sort();

  it("offers English plus the six requested languages", () => {
    expect(I18N.LANGS).toEqual(["en", "es", "zh", "de", "fr", "ja", "ko"]);
  });

  for (const lang of ["es", "zh", "de", "fr", "ja", "ko"]) {
    it(`${lang} has exactly the English key set`, () => {
      expect(Object.keys(I18N.DICT[lang]).sort()).toEqual(enKeys);
    });

    it(`${lang} keeps every {placeholder} of the English text`, () => {
      for (const key of enKeys) {
        const vars = (s) => (s.match(/\{\w+\}/g) || []).sort();
        expect(vars(I18N.DICT[lang][key]), `${lang} ${key}`).toEqual(vars(I18N.DICT.en[key]));
      }
    });
  }

  it("every key referenced by index.html exists in English", () => {
    const keys = [...html.matchAll(/data-i18n(?:-title)?="([^"]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(100);
    for (const key of keys) expect(I18N.DICT.en, key).toHaveProperty([key]);
  });

  it("English deformation names match the registry labels", () => {
    for (const entry of M.deformationRegistry) {
      expect(I18N.DICT.en[`deform.${entry.key}`]).toBe(entry.label);
    }
  });

  it("English markup text matches the dictionary, so the page reads the same before JS runs", () => {
    mountIndexHtml();
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const vars = el.dataset.i18nVars ? JSON.parse(el.dataset.i18nVars) : undefined;
      expect(norm(el.textContent)).toBe(norm(I18N.t(el.dataset.i18n, vars)));
    });
  });

  it("never parses a translation as HTML", () => {
    expect(html).not.toContain("data-i18n-html");
    for (const [lang, dict] of Object.entries(I18N.DICT)) {
      for (const [key, text] of Object.entries(dict)) {
        expect(text, `${lang} ${key}`).not.toMatch(/<[a-z/]/i);
      }
    }
  });
});

describe("t()", () => {
  it("fills placeholders and leaves unknown ones alone", () => {
    expect(I18N.t("chain.empty", { n: 2 })).toBe("2: empty");
    expect(I18N.t("chain.empty", {})).toBe("{n}: empty");
    expect(I18N.t("chain.label")).toBe("Chain:");
  });

  it("falls back to the key when no language has it", () => {
    expect(I18N.t("no.such.key")).toBe("no.such.key");
  });

  it("falls back to English when the current language lacks a key", () => {
    I18N.setLanguage("es");
    I18N.DICT.en["test.onlyEnglish"] = "only english";
    try {
      expect(I18N.t("test.onlyEnglish")).toBe("only english");
    } finally {
      delete I18N.DICT.en["test.onlyEnglish"];
    }
  });
});

describe("setLanguage", () => {
  beforeEach(() => mountIndexHtml());

  it("translates text, titles and markup, and records the choice", () => {
    expect(I18N.setLanguage("es")).toBe("es");
    const load = document.querySelector('#loadFileBtn [data-i18n="topbar.load"]');
    expect(load.textContent).toBe(I18N.DICT.es["topbar.load"]);
    expect(document.getElementById("githubLink").title).toBe(I18N.DICT.es["topbar.github"]);
    const title = document.querySelector('[data-i18n="welcome.new1Title"]');
    expect(title.tagName).toBe("STRONG");
    expect(title.textContent).toBe(I18N.DICT.es["welcome.new1Title"]);
    expect(title.parentElement.textContent).toBe(
      I18N.DICT.es["welcome.new1Title"] + I18N.DICT.es["welcome.new1Body"]
    );
    expect(document.getElementById("chainSlot2").textContent).toBe(I18N.t("chain.empty", { n: 3 }));
    expect(document.documentElement.lang).toBe("es");
    expect(document.getElementById("langSelect").value).toBe("es");
    expect(localStorage.getItem("stlshaper_lang")).toBe("es");
    expect(I18N.getLanguage()).toBe("es");
  });

  it("keeps the input inside a translated label", () => {
    I18N.setLanguage("ja");
    expect(document.getElementById("noiseIntensity")).not.toBeNull();
    expect(document.getElementById("noiseIntensityVal").textContent).toBe("1.5");
  });

  it("falls back to English for an unknown code", () => {
    expect(I18N.setLanguage("xx")).toBe("en");
  });

  it("announces the change", () => {
    const seen = vi.fn();
    window.addEventListener("stlshaper:lang", seen);
    I18N.setLanguage("fr");
    window.removeEventListener("stlshaper:lang", seen);
    expect(seen).toHaveBeenCalledOnce();
    expect(seen.mock.calls[0][0].detail).toBe("fr");
  });

  it("survives storage that throws", () => {
    const original = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(I18N.setLanguage("de")).toBe("de");
      expect(I18N.getLanguage()).toBe("de");
    } finally {
      localStorage.setItem = original;
    }
  });
});

describe("mount", () => {
  it("wires the dropdown", () => {
    mountIndexHtml();
    I18N.mount();
    const select = document.getElementById("langSelect");
    expect(select.value).toBe("en");
    select.value = "ko";
    select.dispatchEvent(new window.Event("change"));
    expect(I18N.getLanguage()).toBe("ko");
    expect(document.querySelector('[data-i18n="btn.generate"]').textContent).toBe(I18N.DICT.ko["btn.generate"]);
  });

  it("translates on load when a language was saved", () => {
    mountIndexHtml();
    I18N.setLanguage("zh");
    mountIndexHtml(); // fresh English markup, as on a page reload
    I18N.mount();
    expect(document.querySelector('[data-i18n="btn.clear"]').textContent).toBe(I18N.DICT.zh["btn.clear"]);
  });
});

// --- main.js runtime text ---

let realRenderer;
let realRAF;

function stubRenderer() {
  realRenderer = THREE.WebGLRenderer;
  THREE.WebGLRenderer = class {
    constructor() {
      this.domElement = document.createElement("canvas");
    }
    setSize() {}
    setViewport() {}
    setScissor() {}
    setScissorTest() {}
    clear() {}
    clearDepth() {}
    render() {}
    getPixelRatio() { return 1; }
  };
  realRAF = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;
}

function binarySTL(vertices) {
  const triangles = vertices.length / 9;
  const buf = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buf);
  view.setUint32(80, triangles, true);
  let o = 84;
  for (let t = 0; t < triangles; t++) {
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

describe("main.js runtime text", () => {
  beforeEach(() => stubRenderer());
  afterEach(() => {
    THREE.WebGLRenderer = realRenderer;
    globalThis.requestAnimationFrame = realRAF;
  });

  const status = () => document.getElementById("status").textContent;

  it("success resets to Ready in any language", async () => {
    vi.useFakeTimers();
    bootWith();
    I18N.setLanguage("ja");
    selectType("tessellate");
    const click = document.getElementById("processBtn").onclick();
    await vi.advanceTimersByTimeAsync(0);
    await click;
    expect(status()).toBe(I18N.t("status.generated", { key: "tessellate" }));
    await vi.advanceTimersByTimeAsync(3100);
    expect(status()).toContain(I18N.DICT.ja["status.readyVerts"].split("{n}")[0]);
  });

  it("re-renders status, stats and chain bar on a language switch", () => {
    bootWith();
    M.updateStats(null, null, 12);
    M.setChainSlot(0, "twist");
    M.renderChainBar();
    document.getElementById("processBtn").disabled = false;
    document.getElementById("chainCalcBtn").onclick?.();

    I18N.setLanguage("de");
    expect(document.getElementById("stats").textContent).toContain(I18N.DICT.de["stats.full"].split("{")[0]);
    expect(document.getElementById("chainSlot0").textContent).toBe(`1: ${I18N.DICT.de["deform.twist"]}`);
    expect(document.getElementById("chainSlot1").textContent).toBe(I18N.t("chain.empty", { n: 2 }));
    M.clearChain();
  });

  it("re-renders an error with the translated prefix", () => {
    bootWith();
    M.applyImportedSettings(null);
    I18N.setLanguage("es");
    expect(status()).toBe(I18N.t("status.errorPrefix", { msg: I18N.t("status.invalidSettings") }));
  });

  it("translates a deformation name nested inside a message", () => {
    bootWith();
    selectType("noise");
    document.getElementById("chainSetBtn").onclick();
    I18N.setLanguage("fr");
    expect(status()).toBe(
      I18N.t("status.slotSet", { n: 1, name: I18N.DICT.fr["deform.noise"] })
    );
    M.clearChain();
  });

  it("shows N/A stats after a clear and on a switch with no stats", () => {
    bootWith();
    M.clearModelAndUI();
    I18N.setLanguage("ko");
    expect(document.getElementById("stats").textContent).toBe(I18N.DICT.ko["stats.na"]);
    expect(status()).toBe(I18N.DICT.ko["status.cleared"]);
  });

  it("deformationLabel falls back to the registry label, then the key", () => {
    expect(M.deformationLabel("nope")).toBe("nope");
    const saved = I18N.DICT.en["deform.bend"];
    delete I18N.DICT.en["deform.bend"];
    try {
      expect(M.deformationLabel("bend")).toBe("Bend");
    } finally {
      I18N.DICT.en["deform.bend"] = saved;
    }
  });

  it("degrades to keys, without throwing, when i18n.js is absent", () => {
    const saved = globalThis.t;
    delete globalThis.t;
    try {
      bootWith();
      M.refreshLanguage();
      expect(document.getElementById("stats").textContent).toBe("stats.full");
      M.clearModelAndUI();
      expect(document.getElementById("stats").textContent).toBe("stats.na");
      expect(document.getElementById("status").textContent).toBe("status.cleared");
    } finally {
      globalThis.t = saved;
    }
  });
});

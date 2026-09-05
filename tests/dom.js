// Loads the real index.html body into jsdom, so DOM-facing tests run against
// the actual markup rather than a hand-written fixture that could drift.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, "../index.html"), "utf8");

// Strip <script> blocks: the page's own bootstrap imports Three from a CDN and
// would try to boot the app a second time.
const body = html
  .replace(/<script[\s\S]*?<\/script>/g, "")
  .match(/<body[^>]*>([\s\S]*)<\/body>/i);

export function mountIndexHtml() {
  document.body.innerHTML = body ? body[1] : "";
  return document.body;
}

/** Fires an input event, the event the range/number bindings listen for. */
export function setInput(id, value) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`No element #${id}`);
  el.value = String(value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
  return el;
}

/** Fires a change event, used by selects, checkboxes and radios. */
export function setChange(id, value) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`No element #${id}`);
  if (el.type === "checkbox") el.checked = Boolean(value);
  else el.value = String(value);
  el.dispatchEvent(new window.Event("change", { bubbles: true }));
  return el;
}

/** Selects a deformation type radio and fires its change event. */
export function selectType(value) {
  const el = document.querySelector(`input[name="type"][value="${value}"]`);
  if (!el) throw new Error(`No type radio for "${value}"`);
  el.checked = true;
  el.dispatchEvent(new window.Event("change", { bubbles: true }));
  return el;
}

#!/usr/bin/env node
// Cross-checks the control wiring between main.js and index.html.
//
// This app has no tests and no build step, so nothing otherwise catches a
// renamed slider or a deformation added to the registry without its panel.
// Those failures are silent at runtime: the control simply does nothing, or the
// panel never appears. Adding a deformation touches eight places (see
// CLAUDE.md); this verifies the ones that can be checked statically.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const worker = fs.readFileSync(path.join(root, "worker.js"), "utf8");

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const problems = [];

// Every deformation's control panel must exist.
for (const m of main.matchAll(/controlsId:\s*"([^"]+)"/g)) {
  if (!htmlIds.has(m[1])) {
    problems.push(`deformationRegistry references missing panel #${m[1]}`);
  }
}

// Every bound input, and the span showing its value, must exist.
const bindPattern =
  /bind(?:Range|Select|Number|Checkbox|Textarea)\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"(?:\s*,\s*"([^"]+)")?/g;
for (const m of main.matchAll(bindPattern)) {
  const [, key, param, inputId, valueId] = m;
  if (!htmlIds.has(inputId)) {
    problems.push(`${key}.${param} binds missing input #${inputId}`);
  }
  if (valueId && !htmlIds.has(valueId)) {
    problems.push(`${key}.${param} binds missing value span #${valueId}`);
  }
}

// Registry keys and radio buttons must correspond exactly.
const keys = new Set([...main.matchAll(/\{ key: "([^"]+)"/g)].map((m) => m[1]));
const radios = new Set(
  [...html.matchAll(/name="type" value="([^"]+)"/g)].map((m) => m[1])
);
for (const key of keys) {
  if (!radios.has(key)) problems.push(`registry key "${key}" has no radio button`);
}
for (const radio of radios) {
  if (!keys.has(radio)) problems.push(`radio "${radio}" is not in deformationRegistry`);
}

// Worker-backed deformations need a case in the worker's dispatch switch.
const workerSwitch = new Set(
  [...worker.matchAll(/case\s+'([^']+)':/g)].map((m) => m[1])
);
for (const m of main.matchAll(
  /\{ key: "([^"]+)"[^}]*usesWorker:\s*(true|false)/g
)) {
  if (m[2] === "true" && !workerSwitch.has(m[1])) {
    problems.push(`"${m[1]}" is usesWorker:true but has no case in worker.js`);
  }
}

// The two files carry hand-mirrored copies of these; drift between them makes
// the worker path and the fallback path disagree.
const twins = [
  "simpleHash",
  "noise",
  "perlinFade",
  "perlinLatticeValue",
  "perlinNoise",
  "perlinFractal",
  "sampleNoise",
  "getAxisList",
];
const extract = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return null;
  const end = src.indexOf("\n}", start);
  return end < 0 ? null : src.slice(start, end + 2);
};
for (const name of twins) {
  const a = extract(main, name);
  const b = extract(worker, name);
  if (a === null) problems.push(`twin function ${name} missing from main.js`);
  else if (b === null) problems.push(`twin function ${name} missing from worker.js`);
  else if (a !== b) problems.push(`twin function ${name} has drifted between main.js and worker.js`);
}

// Shared tuning constants live outside any function, so the twin-function check
// above cannot see them — compare their values directly.
const sharedConstants = [
  "PERLIN_OCTAVES",
  "PERLIN_LACUNARITY",
  "PERLIN_GAIN",
  "PERLIN_FREQUENCY",
  "PERLIN_CONTRAST",
];
const constValue = (src, name) => {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*([^;]+);`));
  return m ? m[1].trim() : null;
};
for (const name of sharedConstants) {
  const a = constValue(main, name);
  const b = constValue(worker, name);
  if (a === null) problems.push(`shared constant ${name} missing from main.js`);
  else if (b === null) problems.push(`shared constant ${name} missing from worker.js`);
  else if (a !== b) {
    problems.push(`shared constant ${name} differs: main.js=${a}, worker.js=${b}`);
  }
}

if (problems.length > 0) {
  console.error(`Control wiring check failed (${problems.length} problem(s)):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log("Control wiring check passed.");

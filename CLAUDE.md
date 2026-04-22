# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

No build step — open `index.html` directly in a browser. For local development with Web Workers (which require a server due to CORS), use any static file server:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

Web Workers **will not load** via `file://` protocol in Chrome; use a local server.

## Architecture

This is a single-page browser app with no framework, no bundler, no npm. Three files do all the work:

- **`index.html`** — UI layout (radio buttons, sliders, panels per deformation), scene canvas, and `<script type="module" src="main.js">`. All control panels have IDs matching `deformationRegistry[n].controlsId`.
- **`main.js`** (~2761 lines) — Everything: STL loading/export, Three.js scene setup, deformation logic (main-thread versions), `WorkerPool`, parameter controls binding, preprocessing (decimate/merge), topology ops (tessellate, Menger sponge). Loaded as an ES module — any runtime error kills the entire app silently.
- **`worker.js`** (~488 lines) — Mirror of deformation algorithms operating on raw `Float32Array` (no Three.js). Receives chunks via `postMessage`, returns displaced vertices.

Libraries are vendored in `libraries/` (Three.js r121, FileSaver, STLLoader).

## How Deformations Work

Two parallel execution paths exist for each deformation — one in `main.js` (fallback, reads globals), one in `worker.js` (normal path, receives params as plain object).

### Adding a New Deformation — Required Steps (in order)

1. **`deformationRegistry`** (main.js ~line 286): add `{ key, label, controlsId, usesWorker: true|false }`
2. **`deformParams`** global object: add default param fields
3. **Main-thread function** in main.js: reads `deformParams` global directly (no params argument)
4. **Worker function** in worker.js: takes `(vertices, params, bbox)` — operates on flat `Float32Array`, indices `i`, `i+1`, `i+2` for x/y/z
5. **`worker.js` onmessage switch**: add `case 'key':` calling the worker function
6. **`fallbackDeformation`** (main.js ~line 742): add `case 'key':` for main-thread fallback
7. **`index.html`**: add radio button + controls `<div id="<controlsId>">` with sliders
8. **`setupParameterControls`** in main.js: bind slider elements to `deformParams` fields

### Key Invariants

- Main-thread deformation functions read from `deformParams` **global** directly — do NOT pass params as arguments (this is correct, not a bug).
- `WorkerPool` chunks vertices at 10K/chunk across up to 8 workers. `this.results = {}` reset at start of each call is intentional.
- `tessellate` and `menger` are `usesWorker: false` — they change triangle count, which the worker chunking can't handle.
- `bbox` received in worker is a plain structured-clone object (no Box3 methods) — always compute center from `bbox.min`/`bbox.max` manually.
- The app is loaded as `type="module"` — a syntax or runtime error in main.js will silently break everything (STL load, all deformations, colors). Test incrementally.

## Coordinate System

XY is the flat surface plane; Z+ is up. Follow this in all geometry calculations.

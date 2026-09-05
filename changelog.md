# Changelog

All notable changes to this project will be documented in this file.

## [0.9.0] - 2026-09-05
### Added
- Test suite: 520 tests via Vitest and jsdom, covering 98% of `main.js` and
  100% of `worker.js`, with coverage reported to Codecov and floors enforced in
  `vitest.config.js` so a regression fails the build.
- Regression tests for every defect fixed in this release, each verified to fail
  against the unfixed code.
- Noise type selector: white noise (the original hash) or Perlin, a coherent
  value-noise field that displaces in lumps rather than static.
- Seed control for the Noise deformation.
- CI workflow: JavaScript syntax checks, control-wiring validation, HTML validation.
- Pages deploy workflow rendering the docs and the app together via Quarto.
- `scripts/check-control-ids.mjs`, which verifies that every deformation has its
  panel, every slider binds an element that exists, and the functions mirrored
  between `main.js` and `worker.js` have not drifted apart.
- IDW settings exports now record the control points actually used, so a recipe
  reproduces on re-import instead of regenerating different points.

### Fixed
- Perspective Distortion in exponential mode produced discontinuities at 10,000-vertex
  chunk boundaries; the normalization basis is now computed over the whole mesh.
- A failing worker left the app waiting forever with the status stuck on
  "Processing". Failed chunks now fall back to their undeformed vertices and the
  operation always completes.
- Importing spherize or perspective settings updated the values but left every
  slider and the vanishing-point widget showing the previous state.
- Loading an STL threw if a value label was absent from the page.
- Vertex merge with epsilon 0 collapsed the entire mesh to a single point.
- The progress bar stayed stranded mid-fill after a failed deformation.
- Deformed geometries were never released, leaking GPU memory on each run.
- Binary STL loading produced two normals per vertex, leaving the normal
  attribute double-length and the mesh mis-shaded.
- Loading an STL smaller than 84 bytes threw a RangeError before the parser
  could read it.
- An indexed mesh lost its index through a worker deformation: the index was
  stored as a bare typed array with no `count`, so nothing drew.
- Stale vertex normals of the wrong length survived recomputation.
- IDW's interior-point sampling used a front-facing material, so rays cast from
  inside a mesh hit nothing and every candidate point was rejected.
- Importing IDW settings before the scene existed threw while adding markers.

### Changed
- `_quarto.yaml` is tracked, and the site build now includes the application
  itself; previously `_site` held a page whose scripts were missing.
- Sample STLs (54 MB) are excluded from the deployed site.
- Removed the unused Three.js shim and dead branches in `worker.js`.
- `CLAUDE.md` is no longer tracked in git.
- `main.js` and `worker.js` now carry ES module exports so the test suite can
  import them; both are loaded as modules by the page and the worker, and both
  guard their start-up side effects so importing them is inert.

## [0.8.0] - 2026-05-01
### Added
- Global scene, camera, and renderer exposure for browser console access.

### Changed
- Improved UI/GUI with enhanced styling and layout refinements.
- Canvas widget layout and interaction improvements.
- Documentation rendering and organization.

## [0.7.0] - 2026-04-21
### Added
- Perspective Distortion deformation with interactive vanishing-point picker widget.
- Circle canvas widget with draggable dot(s) to set distortion direction — dot position = stretch direction, center = no effect.
- 1-point and 2-point mode: second orange dot adds a second independent vanishing point.
- Plane selector (XY / XZ / YZ) maps widget axes to model space.
- Linear and exponential falloff modes for distortion strength.
- Touch support for the canvas widget.

## [0.6.0] - 2026-02-10
### Added
- Importable deformation settings to reuse presets across STLs.
- On-screen axis gizmo with X/Y/Z labels.
- Multi-axis selection for axis-based deformations (twist, bend, ripple, hyper).

### Changed
- Axis gizmo placement and sizing for better visibility.
- Menger sponge now tessellates first, avoids edge carving, and refines removal logic.
- Tessellation range increased for more visible subdivision steps.
- Settings export now includes preprocess parameters.
- UI/camera interaction and performance improvements.

### Fixed
- Black/incorrect shading on some STLs by ensuring valid vertex normals.
- Assorted P0–P4 tracked issues and robustness fixes.

## Issue Set Definitions
### P0 (Critical)
- GPU memory leak from rebuilding meshes/materials without disposal. Leads to runaway memory use and degraded performance until the page becomes unusable.

### P1 (High)
- Bounds/centering invalidation: after `center()` the bounds are stale, breaking adaptive ranges and control-point placement.
- Camera UX scaling: fixed camera limits make small/large models hard to navigate; should scale to model size and offer reset.
- Rendering performance: recreating meshes on each update causes GC churn and frame drops; should update geometry/materials in place.

### P3 (Low)
- Help text/tooltips for controls.
- STL drag-and-drop.
- UI state persistence (local storage).
- Presets for quick exploration.
- Keyboard shortcuts for common actions.
- Accessibility improvements (labels/focus states).
- UI update throttling to reduce layout thrash.
- Optional help modal with examples.

### P4 (Unspecified)
- No P4 definition exists in the repo history. Add criteria and items here if/when P4 is introduced.

## [0.5.0] - 2026-02-08
### Changed
- Updated GUI and camera behavior.

### Fixed
- Addressed P0, P1, P3, and P4 issue sets.

## [0.4.0] - 2025-10-28
### Added
- Settings workflow groundwork.
- Web worker processing for performance.

### Changed
- General refinements and cleanup.

## [0.3.0] - 2025-10-27
### Added
- Initial autoloader workflow.

## [0.2.0] - 2025-10-06
### Changed
- Bug fixes and iterative improvements.

## [0.1.0] - 2025-10-04
### Added
- Initial project scaffold and documentation.

### Changed
- Early scaling and info adjustments.

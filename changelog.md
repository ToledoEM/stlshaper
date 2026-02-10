# Changelog

All notable changes to this project will be documented in this file.

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

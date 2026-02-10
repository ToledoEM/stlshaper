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

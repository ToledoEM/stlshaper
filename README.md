# STLShaper ~ Subversion of Form


*This is under constant development*

This project demonstrates a real-time STL deformation tool using Three.js and p5.js. It allows you to load an STL file, apply various deformation effects (Noise, Sine Wave, Pixelate, IDW Shepard), and visualize the deformed model. It's a tool for pushing the boundaries of what you expect from a 3D model. The goal is to create subtly unsettling, oddly beautiful, and deliberately weird transformations of STL objects. Think of it as a digital sculpting playground.

Transform your 3D models into something unexpected, unsettling, and strangely beautiful. This experimental tool lets you push the boundaries of what's possible with STL files, creating deliberate distortions and abstract variations of your models. Think of it as a digital sculpture lab where mathematical chaos meets artistic expression.

## Motivation & Creative Exploration

- Subversion of Form: This project isn’t about perfect realism. It's about deliberately distorting the familiar, creating unsettling or intriguing shapes.
- Algorithmic Abstraction: Explore how mathematical functions (noise, sine waves, inverse distance weighting) can be used to transform 3D geometry and change the practicality of 3d shapes.
- Visual Metaphors: Consider how different deformations might represent abstract concepts – chaos, tension, growth, decay, organic transformation.


<p align="center">
  <img src="img/STL_Deformer_Demo.png" alt="STLShaper Demo" width="800"/>
</p>

## Features

- **STL Loading**: Loads STL files using the Three.js STLLoader. (Start with simple objects – boxes, spheres, basic shapes – to get the basics working).
- **Deformation Effects**:
  - **Noise**: Applies a noise-based deformation, introducing chaotic movement and distortion.
  - **Sine Wave**: Generates a sinusoidal wave deformation, producing rhythmic, flowing changes – potentially creating mesmerizing, pulsating effects.
  - **Pixelate**: Pixelates the model by snapping vertices to a grid, offering a stark, fragmented aesthetic.
  - **IDW Shepard**: Advanced organic deformation using multiple control points distributed throughout the model's volume via Poisson disk sampling. Creates natural, flowing transformations with localized influence areas.
- **Real-time Deformation**: Updates the deformation in real-time, allowing for interactive experimentation.
- **Parameter Controls**: Interactive sliders and checkboxes for adjusting deformation parameters.
- **Adaptive Parameter Ranges**: Parameters automatically scale based on model size to ensure consistent effects across different STL scales.
- **Visual Feedback**: Displays the deformed model in 3D space with control point visualization for IDW deformation.
- **Parallel Processing**: Uses Web Workers for efficient processing of large STL files with thousands of vertices.
- **Export**: Exports the deformed model as an STL file – save your weird creations!

## Deformation Examples

<p align="center">
  <img src="img/noise_STL_Deformer_Demo.png" alt="Noise Deformation" width="800"/>
  <br><em>Noise Deformation in STLShaper</em>
</p>

<p align="center">
  <img src="img/sine_STL_Deformer_Demo.png" alt="Sine Wave Deformation" width="800"/>
  <br><em>Sine Wave Deformation in STLShaper</em>
</p>

<p align="center">
  <img src="img/pixelated_STL_Deformer_Demo.png" alt="Pixelated Deformation" width="800"/>
  <br><em>Pixelated Deformation in STLShaper</em>
</p>

## IDW Shepard Deformation

The IDW (Inverse Distance Weighting) Shepard deformation represents a significant advancement in organic 3D manipulation. Unlike traditional single-point deformations, this method uses multiple control points strategically placed throughout the model's interior volume.

### Key Features:
- **Poisson Disk Sampling**: Control points are distributed using Poisson disk sampling to ensure even coverage and prevent clustering
- **Volume-Constrained Placement**: All control points are guaranteed to be inside the mesh volume, not just within the bounding box
- **Seed-Based Generation**: Deterministic point placement using a numeric seed for reproducible results
- **Adaptive Influence**: Each control point exerts influence based on inverse distance weighting with customizable power falloff
- **Visual Feedback**: Red wireframe spheres show the location and influence areas of all control points
- **Scalable Effects**: Parameter ranges automatically adjust based on model size to prevent over/under-deformation

### Technical Implementation:
- **Multi-Point IDW**: Each vertex is influenced by all control points simultaneously
- **Parallel Processing**: Web Workers handle the computational load for large models
- **Real-time Visualization**: Control points scale with model size (5% of largest dimension)
- **Robust Volume Detection**: Advanced ray casting ensures points are truly inside the mesh
## Requirements

*   **Web Browser:**  A modern web browser with Web Worker support (Chrome 4+, Firefox 3.5+, Safari 4+, Edge)
*   **JavaScript:**  ES6+ features supported by your browser
*   **Three.js:** Version 128 or later.  This project uses Three.js for 3D rendering and ray casting.
*   **p5.js:** Version 1.7.0 or later.  Used for the control panel and UI elements.
*   **FileSaver.js:** (Included) For exporting the STL file.
*   **Web Workers:** Required for parallel processing of large deformations, especially IDW with multiple control points.

## Setup

1.  **Files:**  The project consists of `index.html`, `sketch.js`, and the required JavaScript libraries.
2.  **Import:**  Place all files in a directory.
3.  **Run:**  Open `index.html` in your web browser.

## Usage

1.  **Load STL:**  Click the "File Input" button to select an STL file.
2.  **Deformation Type:** Choose the deformation type from the radio buttons (Noise, Sine Wave, Pixelate, IDW Shepard).
3.  **Adjust Parameters:** Use the sliders and inputs to control the deformation parameters. IDW parameters adapt automatically to model size.
4.  **Generate Deformation:** Click the "Generate Deformation" button.
5.  **Visualize:** The deformed model will be displayed in the 3D view. For IDW, red spheres show control point locations.
6.  **Export (Optional):**  Click the "Export Current STL" button to save the deformed model as an STL file.

## Controls

*   **File Input:** Select an STL file.
*   **Radio Buttons:** Choose the deformation effect (Noise, Sine Wave, Pixelate, IDW Shepard).
*   **Sliders:** Adjust the parameters of the chosen effect.

### Noise Controls:
*   **Intensity:** Controls the strength of the noise deformation (0.1 - 5.0)
*   **Scale:** Controls the frequency/size of noise features (0.005 - 0.5)
*   **Axis:** Choose which axes to apply noise to (All, X, Y, Z, or combinations)

### Sine Wave Controls:
*   **Amplitude:** Controls the height of the sine waves (1 - 100)
*   **Frequency:** Controls how many waves fit in the model (0.01 - 0.2)
*   **Driver Axis:** Which axis provides the input to the sine function (X, Y, Z)
*   **Displacement Axis:** Which axes the sine wave displaces (X, Y, Z, or combinations)

### Pixelate Controls:
*   **Voxel Size:** Size of the pixelation grid (0.5 - 50)
*   **Axis Lock:** Which axes to pixelate (All, X, Y, Z, or combinations)

### IDW Shepard Controls:
*   **Number of Points:** How many control points to generate (3 - 50). More points = more complex deformation.
*   **Seed:** Numeric seed for reproducible control point placement (0 - 10000). Change for different distributions.
*   **Weight:** Strength of attraction/repulsion at control points (± adaptive range based on model size)
*   **Power:** How quickly influence falls off with distance (0.5 - 6.0). Higher = more localized effects.
*   **Global Scale:** Overall scaling factor for the deformation (adaptive range based on model size)

*   **Generate Deformation:** Apply the deformation.
*   **Export Current STL:** Export the deformed model.

## Code Structure

*   **`index.html`:**  The main HTML file that sets up the Three.js scene, UI elements, and event listeners.
*   **`main.js`:**  Contains the core logic for loading the STL, applying the deformation, rendering the model, and handling user interactions. Includes Poisson disk sampling, volume detection, and adaptive parameter scaling.
*   **`worker.js`:** Web Worker for parallel processing of vertex deformations, especially important for IDW with multiple control points.
*   **`libraries/`:** Contains Three.js, p5.js, and other required libraries.

## Performance & Technical Notes

*   **Parallel Processing:** Uses Web Workers to distribute deformation calculations across CPU cores, enabling real-time processing of large STL files.
*   **Adaptive Parameters:** IDW parameters automatically scale based on model dimensions to ensure consistent deformation strength across different model sizes.
*   **Volume Sampling:** Advanced ray casting ensures IDW control points are placed inside the mesh volume for maximum effect.
*   **Memory Management:** Efficient cleanup of 3D objects and Web Worker communication for stable performance.
*   **Model Size Handling:** The system gracefully handles models from small prototypes to large architectural scans.

## Notes

*   This is a basic demonstration and can be extended with more advanced features.
*   The performance of the deformation can depend on the complexity of the STL model and the chosen deformation algorithm.
*   The rendering is slow
*   Post-procesing is needed in meshlab: Filters -> Cleaning and Repairing ->> Remove Zero Area Faces, Remove Zero Area Faces, Repair Non-manifold Edges(split)
*   IDW Shepard deformation works best with solid, manifold meshes. Complex or thin-walled models may produce unexpected results.



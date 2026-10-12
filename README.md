# Melon Jelly

*Material Studies No. 009* — an interactive soft-body watermelon jelly slice, simulated with XPBD on a tetrahedral mesh and rendered with native WebGPU + WGSL.

Open `melon-jelly.html` in a WebGPU-capable browser (current Chrome, Edge, Safari 26, or Firefox with WebGPU). It is a single self-contained file.

- Grab the tip, a corner, the flesh or the rind; release to watch it wobble. Scroll, Q/E or a second finger twists what you hold. Drag empty space to orbit.
- Editable source lives in `src/` (`sim.js`, `shaders.js`, `app.js`, `template.html`). Rebuild the single file with `python3 src/build.py`.
- `src/test.js`, `stress.js`, `sliders.js` are Node harnesses for the physics.

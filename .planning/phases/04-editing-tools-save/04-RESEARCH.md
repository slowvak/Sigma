# Phase 04: Technical Research

## Objective
Research how to implement Phase 04: Editing Tools & Save.
Answer: "What do I need to know to PLAN this phase well?"

## 1. Domain Architecture: Editor Capabilities
Phase 4 layers editing tools on top of the Phase 2/3 viewer. This requires capturing mouse events on the canvas, mapping CSS coordinates to physical voxel indices, and modifying the in-memory segmentation `Uint8Array`.

### 1.1 Tool Interaction Flow (`ViewerPanel.js`)
Currently, `ViewerPanel.js` implements crosshair drag (click+drag) and window/level manipulation (ctrl+drag). We need to extend this state machine:
- Introduce `activeTool` in `ViewerState` (e.g., `'crosshair' | 'paint' | 'erase'`).
- Mousedown on `ViewerPanel`: If `activeTool === 'paint'`, start a stroke instead of dragging the crosshair.
- Mousemove: interpolate between `last_pos` and `current_pos` if movement is fast (Bresenham's line algorithm in 2D or 3D) to ensure continuous strokes.

### 1.2 Brush Mechanics
- **Shape:** D-01 specifies a circle brush with an adjustable radius.
- **Application:** For a given central voxel `(cx, cy, cz)`, update all voxels `(x, y, z)` where `(x-cx)^2 + (y-cy)^2 <= R^2` within the current multi-slice window (EDIT-02).
- **Multi-slice (EDIT-02):** The radius governs X/Y (or whatever the active plane axes are), and the multi-slice setting governs the depth (orthogonal axis). E.g., if painting on an axial slice and multi-slice is 3, paint on `[z-1, z, z+1]`.
- **Value Constraints (EDIT-04):** A user-configurable min/max range limits painting. Before modifying a voxel `volume[idx]`, check if its original float32 intensity is between `min` and `max`.
- **Performance:** Modifying the `Uint8Array` directly is fast, but we must trigger a re-render. Instead of blindly re-rendering the whole volume, we can call `this.render()` on the active panel and rely on `ViewerState.notify()` to sync the others (coronal/sagittal).

## 2. Undo History Memory (EDIT-09)
Storing 3 full volumes of 512x512x400 (100MB each) is wasteful. As decided in D-02, we must use sparse diffs.
- **Data Structure:** A "diff" object storing the sequence of mutations for a single stroke (mousedown to mouseup).
  `{ indices: Int32Array, oldValues: Uint8Array }`
- **Capture:** During the stroke, before changing a pixel that hasn't been changed yet in *this* stroke, append its index and original value.
- **Undo Operation:** Pop the last diff. Iterate its stored indices and write `oldValues` back into the segmentation `Uint8Array`. Trigger a full re-render map update.

## 3. UI Layout and State (Tool Panel)
- **Tool Panel Location:** EDIT-10 strictly specifies a "left side with light gray background". Currently, `main.js` creates a sidebar on the right (`.sidebar`). We must introduce a new container (e.g., `.left-sidebar` or `.tool-panel`) in `appShell.js` and `styles.css`.
- **State Properties needed in ViewerState:**
  - `activeTool` (string)
  - `brushRadius` (number)
  - `multiSlice` (number)
  - `paintConstraintMin` (number)
  - `paintConstraintMax` (number)
  - `undoStack` (array of diffs)

## 4. Save Workflow Architecture (SAVE-01, SAVE-02, SAVE-03)
- **Client Side:** Clicking "Save" in the left panel opens a modal to collect a filename (e.g., `volume_seg.nii.gz`). The client sends the raw segmentation `Uint8Array` binary buffer via a POST request to the server.
- **Server Side API:** We need a new endpoint `POST /api/volumes/{volume_id}/segmentations`.
- **NIfTI Writing:** The server only receives flat binary data. To save a valid NIfTI file, the server must:
  1. Load the reference volume's `nibabel` NIfTI object.
  2. Extract its canonical affine and header.
  3. Reshape the received binary data to `(Z, Y, X)` and transpose to canonical `(X, Y, Z)` orientation (matching how `nifti_loader.py` handles input).
  4. Create a new `nib.Nifti1Image` with `data.astype(np.uint8)` and write it to disk.

## 5. Per-Label Visibility Constraints
- **D-05:** Visibility toggles (eye icons) on the label list. Because Phase 03 uses a single HTML canvas per panel (and blends pixels via math inside `overlayBlender.js`), we must add an `isVisible` property to the label map in `ViewerState.js`. `blendSegmentationOverlay()` will simply skip blending for labels where `isVisible === false`.

## Validation Architecture

### Verification Dimensions (Nyquist Check)
- **Dimension 1 (Happy Path):** User can paint with circle brush, undo it, and save the result as a new NIfTI file.
- **Dimension 2 (Edge/Boundary):** Brush strokes at the very edge of the volume don't crash and slice bounds aren't exceeded.
- **Dimension 3 (Error States):** Server rejects saving without a valid filename or reference volume.
- **Dimension 4 (Performance):** Stroke rendering maintains 60fps and undo stack does not leak 100MB per action.
- **Dimension 8 (Validation Strategy):** See `04-VALIDATION.md`.

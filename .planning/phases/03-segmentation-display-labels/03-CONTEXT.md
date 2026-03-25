# Phase 3: Segmentation Display & Labels - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 delivers segmentation mask loading, overlay compositing on the existing viewer, and label management UI. Users can load a segmentation file (NIfTI label map), see it overlaid on the volume with per-label colors and adjustable transparency, and manage labels (add, rename, recolor, reassign integer values). This phase builds on Phase 2's multi-plane viewer and rendering pipeline.

</domain>

<decisions>
## Implementation Decisions

### Segmentation File Loading
- **D-01:** After opening a volume, a modal dialog prompts for an associated segmentation file. The server discovers companion segmentation files (matching `<basename>_segmentation.nii.gz` or `<basename>_seg.nii.gz` patterns) at catalog time and serves them via API.
- **D-02:** If a matching segmentation is auto-detected (SEGD-02), it is pre-selected in the dialog. User clicks "Load" to confirm or "Skip" to dismiss. Skip means no segmentation is loaded — user can load one later from the sidebar.
- **D-03:** Segmentation data is served as binary Uint8Array from the server (same RAS+ normalization and transpose as volume data). Uint8 supports labels 0–255, sufficient for clinical segmentation workflows.
- **D-04:** The segmentation must have identical dimensions to its reference volume. If dimensions mismatch, show an error and refuse to load (no resampling in Phase 3).

### Overlay Compositing
- **D-05:** Segmentation overlay is composited pixel-by-pixel in the existing render loop. After `applyWindowLevel()` produces grayscale RGBA, a new `blendSegmentationOverlay()` function blends label colors into the same RGBA buffer before `putImageData()`. This keeps a single canvas per panel — no extra DOM layers.
- **D-06:** For each pixel where the segmentation label is non-zero, blend the label's color with the volume's grayscale using alpha: `pixel = (1 - alpha) * grayscale + alpha * labelColor`. Label 0 (background) is never rendered.
- **D-07:** Slice extraction for segmentation uses the same axis-flip logic as volume sliceExtractor (Y-flip axial, Z-flip coronal/sagittal), operating on Uint8Array instead of Float32Array.

### Transparency Control
- **D-08:** Global transparency slider (0–100) controls overlay opacity for all labels simultaneously (SEGD-05). Slider lives in the sidebar below the label list. Value maps to alpha: 0 = fully transparent (overlay invisible), 100 = fully opaque (volume hidden under labels).
- **D-09:** Default transparency is 50% — balanced view of both anatomy and segmentation.

### Label Management UI
- **D-10:** Label list appears in the sidebar below W/L presets when a segmentation is loaded. Each label row shows: color swatch, label name, integer value. Background (label 0) is always listed first (LABL-06).
- **D-11:** Double-clicking a label row opens an inline editor for name, integer value, and color (LABL-01). Color editing uses a native HTML `<input type="color">` picker — no custom color picker needed.
- **D-12:** Labels auto-discovered from the loaded mask: scan all unique non-zero values in the Uint8Array and create label entries. Initial names are "Label 1", "Label 2", etc. (LABL-02).
- **D-13:** "Add Object" button below the label list creates a new label with the lowest unused integer value (1–255). User can override the value in the inline editor (LABL-05).
- **D-14:** Changing a label's integer value performs a bulk voxel update: all mask voxels with the old value are reassigned to the new value (LABL-03). This happens client-side on the in-memory Uint8Array.
- **D-15:** The label dropdown (LABL-04) is the active label selector for Phase 4's painting tools. In Phase 3, clicking a label row selects it as the "active label" (highlighted in the list) to prepare for editing tools. No painting functionality in this phase.

### Default Color Palette
- **D-16:** Use a fixed 20-color palette inspired by medical imaging tools (ITK-SNAP style). Colors are assigned in order of label integer value. Colors are distinct, reasonably colorblind-friendly, and work on dark backgrounds:
  - Label 1: Red (#FF0000), Label 2: Green (#00FF00), Label 3: Blue (#0000FF), Label 4: Yellow (#FFFF00), Label 5: Cyan (#00FFFF), Label 6: Magenta (#FF00FF), Label 7: Orange (#FF8000), Label 8: Lime (#80FF00), etc.
  - Labels beyond the palette cycle back through it.

### Server API for Segmentations
- **D-17:** Server discovers segmentation files alongside volumes during catalog scan. A segmentation is any NIfTI file matching `*_segmentation.nii.gz`, `*_seg.nii.gz`, or `*_seg.nii` adjacent to a volume file.
- **D-18:** New API endpoints follow the volume pattern:
  - `GET /api/volumes/{id}/segmentations` — list available segmentations for a volume
  - `GET /api/segmentations/{seg_id}/data` — binary Uint8Array of the label map
- **D-19:** Segmentation loading uses the existing NIfTI loader pipeline (RAS+ normalization, transpose) but casts to uint8 instead of float32.

### Claude's Discretion
- Exact modal dialog styling and animation
- Label list scroll behavior when many labels exist
- Whether to show voxel count per label in the list (nice-to-have)
- Error message wording for dimension mismatches
- Exact colors beyond the first 8 in the palette

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — Phase 3 covers SEGD-01 through SEGD-05 and LABL-01 through LABL-06
- `.planning/ROADMAP.md` — Phase dependencies, success criteria, and scope

### Prior Phase Context
- `.planning/phases/02-core-viewer/02-CONTEXT.md` — Phase 2 decisions on sidebar layout, viewer grid, interaction model

### Project Stack
- `CLAUDE.md` — Technology stack (vanilla JS + Canvas 2D, FastAPI, no frameworks), conventions

### Existing Code (integration targets)
- `client/src/viewer/ViewerPanel.js` — Render loop where overlay compositing hooks in
- `client/src/viewer/ViewerState.js` — State management to extend with segmentation state
- `client/src/viewer/sliceExtractor.js` — Slice extraction pattern to replicate for segmentation
- `client/src/viewer/windowLevel.js` — applyWindowLevel() called before overlay blending
- `client/src/main.js` — Volume loading flow to extend with segmentation prompt
- `client/src/api.js` — API client to extend with segmentation endpoints
- `server/api/volumes.py` — Endpoint patterns to follow
- `server/loaders/nifti_loader.py` — Loader pipeline to adapt for uint8 segmentation data
- `server/catalog/models.py` — Pydantic models to extend

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `sliceExtractor.js` extractAxial/Coronal/SagittalSlice: Same axis-flip pattern needed for segmentation slices, just operating on Uint8Array
- `applyWindowLevel()` in windowLevel.js: RGBA buffer it produces is the input for overlay blending
- `ViewerState` subscribe/notify pattern: Extend with segmentation state properties, all panels auto-update
- `presetBar.js` sidebar component pattern: Same DOM creation + state subscription pattern for label list
- `api.js` fetch helpers: Same pattern for segmentation endpoints

### Established Patterns
- Vanilla JS DOM creation with className assignment (no JSX, no templates)
- State management via ViewerState pub-sub (subscribe returns unsubscribe function)
- Canvas rendering: single canvas per panel, ImageData pixel manipulation, CSS scaling for aspect ratio
- Server: FastAPI router pattern, Pydantic models, binary Response with custom headers
- NIfTI loading: nibabel → RAS+ canonical → transpose(2,1,0) → C-contiguous → binary serve

### Integration Points
- ViewerPanel.render(): Insert overlay blending after `applyWindowLevel()` call, before `putImageData()`
- ViewerState constructor: Add segmentation volume, labels, opacity, activeLabel properties
- main.js openVolume(): After volume load, show segmentation dialog, then load segmentation if selected
- FourPanelLayout.setVolume(): Extend to accept optional segmentation data
- server/main.py volume discovery: Extend to discover companion segmentation files
- styles.css: Add label list, transparency slider, segmentation dialog CSS

</code_context>

<specifics>
## Specific Ideas

- Overlay blending should match ITK-SNAP's semi-transparent colored overlay style — distinct label regions clearly visible over anatomy
- The segmentation dialog should feel lightweight — not a full file browser, just a confirmation of the auto-detected file with a skip option
- Label management should be inline in the sidebar, not a separate modal — quick edits while viewing

</specifics>

<deferred>
## Deferred Ideas

- Per-label visibility toggles (show/hide individual labels) — could be added in Phase 4 alongside editing tools
- Segmentation file saving — Phase 4 (SAVE-01 through SAVE-03)
- DICOM-SEG format support — Phase 5 (SAVE-04)
- Loading segmentation from a different file path (full file browser) — v2

</deferred>

---

*Phase: 03-segmentation-display-labels*
*Context gathered: 2026-03-25*

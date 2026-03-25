# Phase 3: Segmentation Display & Labels - Research

**Researched:** 2026-03-25
**Domain:** Segmentation overlay compositing, label management UI, server-side segmentation discovery
**Confidence:** HIGH

## Summary

Phase 3 adds segmentation mask loading, color overlay compositing, and label management to the existing multi-plane viewer. The core technical challenges are: (1) extending the server to discover and serve segmentation NIfTI files as Uint8Array binary data, (2) pixel-level alpha blending of colored label overlays into the existing grayscale render pipeline, and (3) building an inline label management UI in the sidebar with double-click editing. All work builds directly on Phase 2's established patterns -- same slice extraction logic (adapted for Uint8), same ViewerState pub-sub, same sidebar component pattern, same FastAPI router/endpoint structure.

The codebase is clean and well-structured. The render pipeline in `ViewerPanel.render()` has a clear injection point between `applyWindowLevel()` and `putImageData()` for overlay blending. ViewerState is a simple pub-sub that can be extended with segmentation properties. The server's NIfTI loader needs a uint8 variant (cast instead of float32), and the volume discovery logic needs extension for companion segmentation file detection.

**Primary recommendation:** Follow existing patterns exactly. The overlay blending function is ~20 lines of RGBA pixel math. The segmentation slice extractor mirrors the volume extractor but operates on Uint8Array. The label management UI follows the presetBar.js sidebar component pattern. No new libraries needed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** After opening a volume, a modal dialog prompts for an associated segmentation file. The server discovers companion segmentation files (matching `<basename>_segmentation.nii.gz` or `<basename>_seg.nii.gz` patterns) at catalog time and serves them via API.
- **D-02:** If a matching segmentation is auto-detected (SEGD-02), it is pre-selected in the dialog. User clicks "Load" to confirm or "Skip" to dismiss. Skip means no segmentation is loaded -- user can load one later from the sidebar.
- **D-03:** Segmentation data is served as binary Uint8Array from the server (same RAS+ normalization and transpose as volume data). Uint8 supports labels 0-255, sufficient for clinical segmentation workflows.
- **D-04:** The segmentation must have identical dimensions to its reference volume. If dimensions mismatch, show an error and refuse to load (no resampling in Phase 3).
- **D-05:** Segmentation overlay is composited pixel-by-pixel in the existing render loop. After `applyWindowLevel()` produces grayscale RGBA, a new `blendSegmentationOverlay()` function blends label colors into the same RGBA buffer before `putImageData()`. This keeps a single canvas per panel -- no extra DOM layers.
- **D-06:** For each pixel where the segmentation label is non-zero, blend the label's color with the volume's grayscale using alpha: `pixel = (1 - alpha) * grayscale + alpha * labelColor`. Label 0 (background) is never rendered.
- **D-07:** Slice extraction for segmentation uses the same axis-flip logic as volume sliceExtractor (Y-flip axial, Z-flip coronal/sagittal), operating on Uint8Array instead of Float32Array.
- **D-08:** Global transparency slider (0-100) controls overlay opacity for all labels simultaneously (SEGD-05). Slider lives in the sidebar below the label list. Value maps to alpha: 0 = fully transparent (overlay invisible), 100 = fully opaque (volume hidden under labels).
- **D-09:** Default transparency is 50% -- balanced view of both anatomy and segmentation.
- **D-10:** Label list appears in the sidebar below W/L presets when a segmentation is loaded. Each label row shows: color swatch, label name, integer value. Background (label 0) is always listed first (LABL-06).
- **D-11:** Double-clicking a label row opens an inline editor for name, integer value, and color (LABL-01). Color editing uses a native HTML `<input type="color">` picker -- no custom color picker needed.
- **D-12:** Labels auto-discovered from the loaded mask: scan all unique non-zero values in the Uint8Array and create label entries. Initial names are "Label 1", "Label 2", etc. (LABL-02).
- **D-13:** "Add Object" button below the label list creates a new label with the lowest unused integer value (1-255). User can override the value in the inline editor (LABL-05).
- **D-14:** Changing a label's integer value performs a bulk voxel update: all mask voxels with the old value are reassigned to the new value (LABL-03). This happens client-side on the in-memory Uint8Array.
- **D-15:** The label dropdown (LABL-04) is the active label selector for Phase 4's painting tools. In Phase 3, clicking a label row selects it as the "active label" (highlighted in the list) to prepare for editing tools. No painting functionality in this phase.
- **D-16:** Use a fixed 20-color palette inspired by medical imaging tools (ITK-SNAP style). Colors are assigned in order of label integer value. Colors cycle for labels beyond 20.
- **D-17:** Server discovers segmentation files alongside volumes during catalog scan. A segmentation is any NIfTI file matching `*_segmentation.nii.gz`, `*_seg.nii.gz`, or `*_seg.nii` adjacent to a volume file.
- **D-18:** New API endpoints: `GET /api/volumes/{id}/segmentations` (list), `GET /api/segmentations/{seg_id}/data` (binary Uint8Array).
- **D-19:** Segmentation loading uses existing NIfTI loader pipeline (RAS+ normalization, transpose) but casts to uint8 instead of float32.

### Claude's Discretion
- Exact modal dialog styling and animation
- Label list scroll behavior when many labels exist
- Whether to show voxel count per label in the list (nice-to-have)
- Error message wording for dimension mismatches
- Exact colors beyond the first 8 in the palette

### Deferred Ideas (OUT OF SCOPE)
- Per-label visibility toggles (show/hide individual labels) -- could be added in Phase 4 alongside editing tools
- Segmentation file saving -- Phase 4 (SAVE-01 through SAVE-03)
- DICOM-SEG format support -- Phase 5 (SAVE-04)
- Loading segmentation from a different file path (full file browser) -- v2
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEGD-01 | After opening main image, prompt dialog for associated segmentation file | Server segmentation discovery at catalog time; modal dialog component on client |
| SEGD-02 | Auto-detect segmentation file matching `<basename>_segmentation.nii.gz` pattern | Server-side glob pattern matching during volume discovery (`*_segmentation.nii.gz`, `*_seg.nii.gz`, `*_seg.nii`) |
| SEGD-03 | If matching segmentation exists, pre-select it in the dialog so user just clicks OK | API returns segmentation list; client pre-selects first match |
| SEGD-04 | Segmentation overlay rendered on top of main image with color per label | `blendSegmentationOverlay()` function operating on RGBA buffer after `applyWindowLevel()` |
| SEGD-05 | User-selectable overlay transparency via 0-100 slider | Global alpha in ViewerState, sidebar slider component |
| LABL-01 | Each label has integer value, text name, and color -- all user-editable via double-click | Inline editing in label list rows; native `<input type="color">` for color |
| LABL-02 | Labels start as Label1, Label2, etc. | Auto-discovery: scan unique non-zero values in Uint8Array, generate default names |
| LABL-03 | Changing a label's integer value updates all mask voxels with old value to new value | Client-side bulk Uint8Array scan-and-replace |
| LABL-04 | Label dropdown in tool panel shows labels present in loaded segmentation | Label list in sidebar with active selection state |
| LABL-05 | "Add object" button creates new label with lowest unused integer value | Scan existing label values 1-255, find first gap |
| LABL-06 | Background (0) is always present in label list | Hardcoded Background entry at index 0, non-removable |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Tech stack (server):** Python with FastAPI -- no framework alternatives
- **Tech stack (client):** Vanilla JS + HTML5 Canvas -- no React/Vue/Svelte
- **Package management:** uv (not pip)
- **Build tool:** Vite for client
- **No Cornerstone.js, no Three.js, no frameworks** -- canvas pixel manipulation is direct
- **Data locality:** Server runs locally alongside data

## Standard Stack

No new libraries are required for Phase 3. Everything is built with the existing stack.

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FastAPI | >=0.115 | HTTP API | Already in use; new segmentation router follows volumes.py pattern |
| nibabel | >=5.2 | NIfTI loading | Already used for volumes; segmentation loading is same pipeline with uint8 cast |
| numpy | >=1.26 | Array operations | `astype(np.uint8)` for segmentation data, `np.unique()` for label discovery |
| Vite | >=6.0 | Client build | Already configured with proxy |
| vitest | >=3.0 | Client tests | Already configured for unit tests |

### No New Dependencies
Phase 3 requires zero new npm packages or Python packages. The overlay blending is pure RGBA pixel math. The label UI is vanilla DOM. The server endpoints follow established patterns.

## Architecture Patterns

### Server: Segmentation Discovery and Serving

The existing `_discover_volumes()` in `server/main.py` scans for NIfTI files. It needs extension to also discover companion segmentation files and associate them with their parent volume.

**Discovery pattern:** For each cataloged volume at path `/data/brain.nii.gz`, check for:
- `/data/brain_segmentation.nii.gz`
- `/data/brain_segmentation.nii`
- `/data/brain_seg.nii.gz`
- `/data/brain_seg.nii`

**Data model extension:**
```python
class SegmentationMetadata(BaseModel):
    id: str
    name: str
    path: str
    volume_id: str  # parent volume reference
    dimensions: list[int] | None = None

class VolumeMetadata(BaseModel):
    # ... existing fields ...
    segmentations: list[SegmentationMetadata] | None = None
```

**Loader adaptation:** The existing `load_nifti_volume()` does RAS+ normalization and transpose(2,1,0). For segmentations, the same pipeline applies but with `astype(np.uint8)` instead of `dtype=np.float32`. Key difference: no auto-windowing needed (segmentation values are label indices, not intensity values).

```python
def load_nifti_segmentation(filepath: str | Path) -> tuple[np.ndarray, dict]:
    img = nib.load(str(filepath))
    canonical = nib.as_closest_canonical(img)
    raw = canonical.get_fdata()
    # Cast to uint8 -- values 0-255 for label indices
    data = np.ascontiguousarray(raw.astype(np.uint8).transpose(2, 1, 0))
    metadata = {
        "dimensions": [int(d) for d in canonical.shape[:3]],
    }
    return data, metadata
```

**API pattern:** New router `server/api/segmentations.py` following `volumes.py` structure:
- `GET /api/volumes/{id}/segmentations` -- returns list of `SegmentationMetadata`
- `GET /api/segmentations/{seg_id}/data` -- returns binary Uint8Array with dimension headers

### Client: Overlay Compositing Pipeline

The render pipeline in `ViewerPanel.render()` currently does:
1. Extract slice (Float32Array)
2. `applyWindowLevel()` -> writes grayscale to RGBA buffer
3. `putImageData()` to canvas
4. `_drawCrosshairs()` via canvas context

The segmentation overlay inserts between steps 2 and 3:
1. Extract volume slice (Float32Array)
2. `applyWindowLevel()` -> grayscale RGBA
3. **Extract segmentation slice (Uint8Array)**
4. **`blendSegmentationOverlay()` -> modify RGBA in-place**
5. `putImageData()` to canvas
6. `_drawCrosshairs()`

**Blending function:**
```javascript
/**
 * Blend segmentation overlay colors into an RGBA buffer.
 *
 * @param {Uint8Array} segSlice - Segmentation label values for this slice
 * @param {Uint8ClampedArray} rgba - RGBA buffer (modified in-place)
 * @param {Map<number, {r: number, g: number, b: number}>} colorMap - Label -> RGB
 * @param {number} alpha - Overlay opacity 0.0-1.0
 */
export function blendSegmentationOverlay(segSlice, rgba, colorMap, alpha) {
  const len = segSlice.length;
  const oneMinusAlpha = 1 - alpha;
  for (let i = 0; i < len; i++) {
    const label = segSlice[i];
    if (label === 0) continue; // skip background
    const color = colorMap.get(label);
    if (!color) continue;
    const j = i << 2;
    rgba[j]     = oneMinusAlpha * rgba[j]     + alpha * color.r;
    rgba[j + 1] = oneMinusAlpha * rgba[j + 1] + alpha * color.g;
    rgba[j + 2] = oneMinusAlpha * rgba[j + 2] + alpha * color.b;
    // rgba[j + 3] stays 255
  }
}
```

### Client: Segmentation Slice Extraction

The existing `sliceExtractor.js` has `extractAxialSlice`, `extractCoronalSlice`, `extractSagittalSlice` operating on Float32Array. Segmentation needs identical functions but for Uint8Array. Two approaches:

**Option A: Duplicate functions for Uint8Array** -- separate `extractAxialSegSlice()` etc. Pros: no type confusion, clear. Cons: code duplication.

**Option B: Generalize existing functions** -- they already allocate `new Float32Array(...)` internally. Could parameterize the output type. But this changes the existing API.

**Recommendation: Option A.** Create a parallel `segSliceExtractor.js` with identical logic but operating on Uint8Array input and output. The functions are small (~15 lines each) and duplication is safer than modifying a working pipeline. The existing Float32Array slice extractors remain untouched.

### Client: ViewerState Extension

ViewerState needs new properties for segmentation:
```javascript
// New properties in constructor
this.segVolume = null;          // Uint8Array - full segmentation volume
this.segDims = null;            // [dimX, dimY, dimZ] - must match volume dims
this.labels = new Map();        // Map<number, {name: string, color: {r,g,b}, value: number}>
this.activeLabel = 0;           // Currently selected label value
this.overlayOpacity = 0.5;      // 0.0-1.0 (default 50%)

// New methods
setSegmentation(segVolume, segDims) { ... }
setOverlayOpacity(opacity) { ... }
setActiveLabel(value) { ... }
addLabel(value, name, color) { ... }
updateLabel(oldValue, newLabel) { ... }
removeLabel(value) { ... }
```

### Client: Label Management UI

Follows the `presetBar.js` pattern exactly:
- Export a `createLabelPanel(state)` function returning an HTMLElement
- Subscribe to state changes for reactive updates
- Vanilla DOM creation with className assignment

**Label row structure:**
```
[color-swatch] [name] [value]     <- click to select, double-click to edit
```

**Inline editing:** Double-click transforms the row into edit mode with `<input>` fields. Press Enter or blur to commit. Press Escape to cancel.

**Color swatch:** Small `<div>` with `background-color` set from label color. Double-click opens native `<input type="color">`.

### Client: Segmentation Dialog

A simple modal overlay shown after volume loads successfully. Contains:
- Title: "Load Segmentation"
- If auto-detected: show filename, pre-selected radio/checkbox
- Two buttons: "Load" and "Skip"
- If no segmentations found: brief message and "OK" to dismiss

This is a one-time prompt, not a persistent UI element.

### Recommended File Structure

```
client/src/
  viewer/
    segSliceExtractor.js       # Uint8Array slice extraction (mirrors sliceExtractor.js)
    overlayBlender.js          # blendSegmentationOverlay() function
  ui/
    labelPanel.js              # Label list + transparency slider sidebar component
    segmentationDialog.js      # Modal dialog for segmentation loading prompt
  api.js                       # Extended with fetchSegmentations(), fetchSegmentationData()

server/
  api/
    segmentations.py           # New router: list + serve segmentation data
  loaders/
    nifti_loader.py            # Add load_nifti_segmentation() function
  catalog/
    models.py                  # Add SegmentationMetadata model
  main.py                      # Extend discovery to find companion segmentations
```

### Anti-Patterns to Avoid
- **Separate overlay canvas:** Do NOT add a second canvas for the segmentation overlay. D-05 explicitly requires compositing into the same RGBA buffer. Two canvases would require CSS positioning synchronization and add complexity.
- **WebGL for blending:** The alpha blending is ~20 lines of per-pixel math on a 512x512 buffer. WebGL shader setup would be 10x more code for negligible performance gain.
- **Framework for the dialog:** The segmentation dialog is a one-shot modal. Use plain DOM (`createElement`, `className`, event listeners), not a dialog library.
- **Modifying sliceExtractor.js:** Don't refactor the existing Float32Array extractors to be generic. Duplicate for Uint8Array to avoid risk to the working volume pipeline.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Color picker | Custom color wheel/palette UI | `<input type="color">` | Native browser color picker works well, zero code, consistent UX |
| Modal dialog backdrop | Custom overlay + z-index management | `<dialog>` element + `::backdrop` | Native `<dialog>` handles focus trapping, Escape to close, backdrop styling |
| Uint8 NIfTI parsing | Custom NIfTI header parser in JS | Server-side nibabel | Server already handles NIfTI complexity; client receives raw Uint8Array |

**Key insight:** The segmentation overlay is simple pixel math, not a rendering framework problem. The label UI is simple DOM, not a component library problem. Resist the urge to over-engineer.

## Common Pitfalls

### Pitfall 1: Segmentation/Volume Dimension Mismatch
**What goes wrong:** Segmentation file has different dimensions than the volume, causing array index out-of-bounds or garbled overlay.
**Why it happens:** User loads a segmentation from a different scan, or the NIfTI was resampled.
**How to avoid:** Server validates dimensions match before serving. Client validates on load. Error message is clear: "Segmentation dimensions [X,Y,Z] do not match volume dimensions [X,Y,Z]."
**Warning signs:** Overlay looks "shifted" or has stripes -- usually an off-by-one or transposition error.

### Pitfall 2: Segmentation Orientation Mismatch After RAS+ Normalization
**What goes wrong:** Segmentation labels appear on wrong anatomy because the volume and segmentation had different original orientations, and RAS+ normalization didn't produce matching voxel layouts.
**Why it happens:** nibabel's `as_closest_canonical()` normalizes based on affine, but if volume and segmentation were created with slightly different affines (common with some tools), the transpose(2,1,0) result may not align pixel-for-pixel.
**How to avoid:** After RAS+ normalization, verify both have identical dimensions. If dimensions match post-normalization, the voxels should align (same grid). If they don't match, refuse to load.
**Warning signs:** Labels appear mirrored or rotated relative to expected anatomy.

### Pitfall 3: Overlay Blending Performance on Large Slices
**What goes wrong:** Blending loop is slow on 512x512 slices, causing visible lag during slice scrolling.
**Why it happens:** Per-pixel loop in JavaScript with Map.get() lookup per pixel.
**How to avoid:** Pre-compute a flat array lookup (indexed by label value, not Map) for the color table. Since labels are 0-255, a `Uint8Array[256*3]` or array of `[r,g,b]` tuples indexed by label value eliminates hash map overhead. This reduces the inner loop to array indexing only.
**Warning signs:** Slice scrolling feels sluggish compared to Phase 2 (no overlay).

### Pitfall 4: Label Integer Value Conflicts During Reassignment
**What goes wrong:** User changes label 3's value to 5, but label 5 already exists. Two labels now share the same integer value, corrupting the mask.
**Why it happens:** No validation on value uniqueness during inline edit.
**How to avoid:** Validate new value is not already in use by another label. Show error or reject the change if conflict detected.
**Warning signs:** Multiple labels with the same integer value in the list.

### Pitfall 5: Forgetting to Re-extract Segmentation Slice After Bulk Voxel Update
**What goes wrong:** User changes label 3's integer to 7 (bulk update), but the currently displayed slices still show old label 3 colors because the segmentation slice cache wasn't invalidated.
**Why it happens:** The bulk update modifies the 3D Uint8Array in memory, but the 2D slice used for rendering was extracted before the update.
**How to avoid:** After any bulk voxel update (label value reassignment), call `state.notify()` to trigger re-render of all panels. The render loop re-extracts slices on each call, so notification is sufficient.
**Warning signs:** Overlay doesn't update after label value change until user scrolls.

### Pitfall 6: `<input type="color">` Returns Hex, Not RGB
**What goes wrong:** The native color picker returns `#RRGGBB` string. Blending function needs `{r, g, b}` integers.
**Why it happens:** Browser API difference from internal data model.
**How to avoid:** Conversion utility: `hexToRgb(hex)` parsing the `#RRGGBB` string to `{r, g, b}`. Also need `rgbToHex(r, g, b)` for setting the input's value.
**Warning signs:** Colors don't render or appear black (NaN from failed parse).

## Code Examples

### Overlay Blending with Flat Array Lookup (Performance-Optimized)
```javascript
// Build flat color lookup: colorLUT[label * 3] = r, [label * 3 + 1] = g, [label * 3 + 2] = b
function buildColorLUT(labels) {
  const lut = new Uint8Array(256 * 3); // 768 bytes, zero-initialized
  for (const [value, label] of labels) {
    const offset = value * 3;
    lut[offset] = label.color.r;
    lut[offset + 1] = label.color.g;
    lut[offset + 2] = label.color.b;
  }
  return lut;
}

function blendSegmentationOverlay(segSlice, rgba, colorLUT, alpha) {
  const len = segSlice.length;
  const oneMinusAlpha = 1 - alpha;
  for (let i = 0; i < len; i++) {
    const label = segSlice[i];
    if (label === 0) continue;
    const ci = label * 3;
    const j = i << 2;
    rgba[j]     = oneMinusAlpha * rgba[j]     + alpha * colorLUT[ci];
    rgba[j + 1] = oneMinusAlpha * rgba[j + 1] + alpha * colorLUT[ci + 1];
    rgba[j + 2] = oneMinusAlpha * rgba[j + 2] + alpha * colorLUT[ci + 2];
  }
}
```

### Segmentation Slice Extraction (Axial, Uint8Array)
```javascript
// Mirrors extractAxialSlice from sliceExtractor.js but for Uint8Array
export function extractAxialSegSlice(segVolume, z, dimX, dimY) {
  const offset = z * dimX * dimY;
  const slice = new Uint8Array(dimX * dimY);
  for (let y = 0; y < dimY; y++) {
    const srcRow = offset + y * dimX;
    const dstRow = (dimY - 1 - y) * dimX;
    for (let x = 0; x < dimX; x++) {
      slice[dstRow + x] = segVolume[srcRow + x];
    }
  }
  return slice;
}
```

### Server: Segmentation Companion Discovery
```python
def _find_companion_segmentations(volume_path: Path) -> list[Path]:
    """Find segmentation files that match a volume by naming convention."""
    stem = volume_path.name
    # Strip extensions (.nii.gz or .nii)
    if stem.endswith('.nii.gz'):
        base = stem[:-7]
    elif stem.endswith('.nii'):
        base = stem[:-4]
    else:
        return []

    parent = volume_path.parent
    patterns = [
        f"{base}_segmentation.nii.gz",
        f"{base}_segmentation.nii",
        f"{base}_seg.nii.gz",
        f"{base}_seg.nii",
    ]
    found = []
    for pattern in patterns:
        candidate = parent / pattern
        if candidate.exists():
            found.append(candidate)
    return found
```

### Native Dialog Element for Segmentation Prompt
```javascript
function showSegmentationDialog(segmentations, onLoad, onSkip) {
  const dialog = document.createElement('dialog');
  dialog.className = 'seg-dialog';

  const title = document.createElement('h3');
  title.textContent = 'Load Segmentation';
  dialog.appendChild(title);

  if (segmentations.length === 0) {
    const msg = document.createElement('p');
    msg.textContent = 'No segmentation files found for this volume.';
    dialog.appendChild(msg);

    const okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.addEventListener('click', () => { dialog.close(); onSkip(); });
    dialog.appendChild(okBtn);
  } else {
    // Pre-select first segmentation
    let selectedId = segmentations[0].id;
    // ... radio buttons for each segmentation ...

    const loadBtn = document.createElement('button');
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', () => { dialog.close(); onLoad(selectedId); });

    const skipBtn = document.createElement('button');
    skipBtn.textContent = 'Skip';
    skipBtn.addEventListener('click', () => { dialog.close(); onSkip(); });

    dialog.appendChild(loadBtn);
    dialog.appendChild(skipBtn);
  }

  document.body.appendChild(dialog);
  dialog.showModal();
  dialog.addEventListener('close', () => dialog.remove());
}
```

### Default Color Palette
```javascript
// ITK-SNAP inspired 20-color palette for label overlay
export const DEFAULT_LABEL_COLORS = [
  { r: 255, g: 0,   b: 0   },  // 1: Red
  { r: 0,   g: 255, b: 0   },  // 2: Green
  { r: 0,   g: 0,   b: 255 },  // 3: Blue
  { r: 255, g: 255, b: 0   },  // 4: Yellow
  { r: 0,   g: 255, b: 255 },  // 5: Cyan
  { r: 255, g: 0,   b: 255 },  // 6: Magenta
  { r: 255, g: 128, b: 0   },  // 7: Orange
  { r: 128, g: 255, b: 0   },  // 8: Lime
  { r: 0,   g: 128, b: 255 },  // 9: Azure
  { r: 255, g: 0,   b: 128 },  // 10: Rose
  { r: 128, g: 0,   b: 255 },  // 11: Violet
  { r: 0,   g: 255, b: 128 },  // 12: Spring
  { r: 255, g: 128, b: 128 },  // 13: Salmon
  { r: 128, g: 255, b: 128 },  // 14: Light Green
  { r: 128, g: 128, b: 255 },  // 15: Periwinkle
  { r: 255, g: 255, b: 128 },  // 16: Light Yellow
  { r: 128, g: 255, b: 255 },  // 17: Light Cyan
  { r: 255, g: 128, b: 255 },  // 18: Light Magenta
  { r: 192, g: 192, b: 192 },  // 19: Silver
  { r: 255, g: 200, b: 0   },  // 20: Gold
];

export function getColorForLabel(labelValue) {
  if (labelValue === 0) return null; // background -- never rendered
  const idx = (labelValue - 1) % DEFAULT_LABEL_COLORS.length;
  return DEFAULT_LABEL_COLORS[idx];
}
```

### Hex-RGB Conversion Utilities
```javascript
export function hexToRgb(hex) {
  const val = parseInt(hex.slice(1), 16);
  return { r: (val >> 16) & 255, g: (val >> 8) & 255, b: val & 255 };
}

export function rgbToHex(r, g, b) {
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Overlay via second canvas with CSS `mix-blend-mode` | Single-canvas pixel-level compositing | Always preferred for medical imaging | Precise alpha control, no CSS compositing artifacts, single draw call |
| `<dialog>` polyfill needed | Native `<dialog>` element | Supported in all modern browsers since 2022 | No polyfill, built-in focus trapping and backdrop |
| Color picker libraries (Spectrum, Pickr) | `<input type="color">` | Reliable in all modern browsers since 2020 | Zero dependencies, consistent UX |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (client) | vitest 3.x |
| Config file (client) | `client/vitest.config.js` |
| Quick run command | `cd client && npx vitest run` |
| Full suite command | `cd client && npx vitest run` |
| Framework (server) | pytest 8.x |
| Config file (server) | none (uses pyproject.toml) |
| Quick run command | `cd server && uv run pytest tests/ -x` |
| Full suite command | `cd server && uv run pytest tests/` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEGD-01 | Segmentation dialog shown after volume open | manual | Manual browser test | -- |
| SEGD-02 | Auto-detect segmentation companion files | unit (server) | `cd server && uv run pytest tests/test_seg_discovery.py -x` | Wave 0 |
| SEGD-03 | Pre-select matching segmentation in dialog | manual | Manual browser test | -- |
| SEGD-04 | Overlay renders with per-label colors | unit | `cd client && npx vitest run src/__tests__/overlayBlender.test.js` | Wave 0 |
| SEGD-05 | Transparency slider controls overlay opacity | unit | `cd client && npx vitest run src/__tests__/overlayBlender.test.js` | Wave 0 |
| LABL-01 | Label properties editable via double-click | manual | Manual browser test | -- |
| LABL-02 | Labels auto-discovered and named Label1, Label2 | unit | `cd client && npx vitest run src/__tests__/labelManager.test.js` | Wave 0 |
| LABL-03 | Changing label value updates all mask voxels | unit | `cd client && npx vitest run src/__tests__/labelManager.test.js` | Wave 0 |
| LABL-04 | Label list shows all labels from segmentation | unit | `cd client && npx vitest run src/__tests__/labelManager.test.js` | Wave 0 |
| LABL-05 | Add object with lowest unused integer value | unit | `cd client && npx vitest run src/__tests__/labelManager.test.js` | Wave 0 |
| LABL-06 | Background (0) always in label list | unit | `cd client && npx vitest run src/__tests__/labelManager.test.js` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd client && npx vitest run && cd ../server && uv run pytest tests/ -x`
- **Per wave merge:** Full suite for both client and server
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `client/src/__tests__/overlayBlender.test.js` -- covers SEGD-04, SEGD-05 (blending correctness, alpha=0 and alpha=1 edge cases)
- [ ] `client/src/__tests__/segSliceExtractor.test.js` -- covers seg slice extraction matching volume extractor behavior
- [ ] `client/src/__tests__/labelManager.test.js` -- covers LABL-02 through LABL-06 (label discovery, add, rename, value change, bulk voxel update)
- [ ] `server/tests/test_seg_discovery.py` -- covers SEGD-02 (companion file pattern matching)
- [ ] `server/tests/test_seg_loader.py` -- covers segmentation NIfTI loading with uint8 cast

## Open Questions

1. **Segmentation files that are also valid volumes**
   - What we know: Files named `*_seg.nii.gz` could be discovered both as volumes (by the existing scanner) and as segmentations (by the new companion scanner).
   - What's unclear: Should `_seg.nii.gz` and `_segmentation.nii.gz` files be excluded from the main volume list?
   - Recommendation: Exclude files matching segmentation patterns from the volume catalog. They are label maps, not viewable volumes. Add a filter to `_discover_volumes()`.

2. **DICOM volumes and segmentation discovery**
   - What we know: D-17 specifies NIfTI segmentation patterns only. DICOM volumes won't have NIfTI segmentation companions.
   - What's unclear: Should DICOM volumes show the segmentation dialog at all (with empty list)?
   - Recommendation: Show the dialog with "No segmentation files found" message and OK button for DICOM volumes. Keep the flow consistent.

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `ViewerPanel.js`, `ViewerState.js`, `sliceExtractor.js`, `windowLevel.js`, `main.js`, `api.js`, `presetBar.js` -- established patterns for all client-side work
- Codebase inspection: `server/main.py`, `server/api/volumes.py`, `server/loaders/nifti_loader.py`, `server/catalog/models.py` -- established patterns for all server-side work
- CONTEXT.md decisions D-01 through D-19 -- locked implementation choices

### Secondary (MEDIUM confidence)
- HTML `<dialog>` element: well-supported in all modern browsers (Chrome 37+, Firefox 98+, Safari 15.4+)
- `<input type="color">`: well-supported in all modern browsers
- Canvas 2D `putImageData` performance: confirmed fast for 512x512 in Phase 2 implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all patterns established in codebase
- Architecture: HIGH -- direct extension of Phase 2 patterns, all integration points identified in code
- Pitfalls: HIGH -- based on direct code inspection of render pipeline and state management

**Research date:** 2026-03-25
**Valid until:** 2026-04-25 (stable -- no external dependency changes)

# Phase 3: Segmentation Display & Labels — Discussion Log

**Date:** 2026-03-25
**Mode:** --auto (all gray areas auto-resolved with recommended defaults)

## Gray Areas Identified

1. **Segmentation file loading flow** — Server discovery vs client file picker, dialog UX
2. **Overlay compositing approach** — Extra canvas layer vs pixel-level RGBA blending
3. **Label UI placement** — Sidebar vs blank panel vs separate modal
4. **Default color palette** — Which colors, how many, colorblind considerations
5. **Segmentation data format** — Uint8 vs Uint16, server handling
6. **Transparency control** — Global vs per-label opacity
7. **Skip segmentation option** — Can user dismiss the prompt
8. **Server API shape** — Endpoint design for segmentation data

## Auto-Resolved Decisions

### 1. Segmentation File Loading Flow
**Resolved:** Server discovers companion segmentation files at catalog time using filename pattern matching (`*_segmentation.nii.gz`, `*_seg.nii.gz`). Client shows a lightweight modal dialog after volume load with auto-detected file pre-selected. User confirms or skips.
**Rationale:** Follows existing server-discovery pattern (volumes are discovered at startup too). Modal dialog is the standard approach for file association in medical imaging tools.

### 2. Overlay Compositing Approach
**Resolved:** Single-canvas pixel-level RGBA blending in the render loop. After `applyWindowLevel()`, blend label colors into the same RGBA buffer before `putImageData()`. No extra canvas layers.
**Rationale:** Avoids DOM complexity of multiple canvases. Pixel-level blending gives exact control over transparency. Performance is fine — segmentation overlay adds ~1ms per slice (same loop as W/L mapping).

### 3. Label UI Placement
**Resolved:** Sidebar below W/L presets. Inline editing via double-click on label rows.
**Rationale:** Consistent with Phase 2's sidebar pattern. ITK-SNAP puts labels in a side panel. The blank lower-right panel is reserved for Phase 4's tool panel (EDIT-10).

### 4. Default Color Palette
**Resolved:** Fixed 20-color palette, ITK-SNAP inspired. Primary colors first (red, green, blue), then secondary, then tertiary. Cycles for labels beyond 20.
**Rationale:** Standard medical imaging convention. Users can customize via double-click color editor.

### 5. Segmentation Data Format
**Resolved:** Uint8Array (0–255). Server casts to uint8 during loading.
**Rationale:** 255 labels covers virtually all clinical segmentation use cases. Uint8 is 4x smaller than float32, faster to transfer and process.

### 6. Transparency Control
**Resolved:** Global transparency slider (0–100), default 50%. Per SEGD-05 requirement.
**Rationale:** Per-label transparency adds UI complexity for marginal benefit. Global slider is the standard approach (ITK-SNAP, 3D Slicer).

### 7. Skip Segmentation Option
**Resolved:** Dialog has "Skip" button. No segmentation loaded, viewer works normally. User can load segmentation later from sidebar.
**Rationale:** Not all volumes have segmentations. Forcing segmentation load would break the viewing workflow.

### 8. Server API Shape
**Resolved:** `GET /api/volumes/{id}/segmentations` for discovery, `GET /api/segmentations/{seg_id}/data` for binary data. Follows volume endpoint pattern.
**Rationale:** Consistent with existing API design. Separate segmentation ID allows future support for multiple segmentations per volume.

## Outcome

All 8 gray areas resolved. Context written to `03-CONTEXT.md`.
Auto-advancing to plan-phase.

---
*Phase: 03-segmentation-display-labels*
*Discussion completed: 2026-03-25*

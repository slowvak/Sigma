# NextEd — Web-Based Medical Image Editor

## What This Is

A web-based medical image viewer and segmentation editor for researchers and radiologists. It consists of a Python/FastAPI image server that catalogs NIfTI and DICOM volumes from a filesystem, and a JavaScript web client that loads volumes into browser memory for fast multi-plane viewing and segmentation editing. Think ITK-SNAP, but accessible through a browser.

## Core Value

Researchers and radiologists can view and segment medical image volumes entirely in the browser — no desktop install, no file transfer friction — with tools comparable to ITK-SNAP's core workflow.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Server catalogs NIfTI (.nii, .nii.gz) and DICOM files from a folder tree on startup
- [ ] DICOM files grouped into volumes by series_instance_uid
- [ ] Server exposes volume metadata: path, filename, X/Y/Z dimensions, voxel spacing, file date
- [ ] DICOM volumes also expose Study Description and Series Description
- [ ] Server loads and serves full volume data on demand (not at catalog time)
- [ ] Web client shows list of available volumes from server
- [ ] Clicking a volume shows additional metadata (DICOM: Study/Series Description; NIfTI: file date)
- [ ] User can open a volume as the "Main" image
- [ ] After opening, prompt for associated segmentation file with auto-detection of `_segmentation` naming
- [ ] 4-panel viewer: axial (upper-left), coronal (upper-right), sagittal (lower-left), blank (lower-right)
- [ ] Each view starts at the center slice of its dimension
- [ ] Slice navigation via slider on each view
- [ ] Single-view mode toggle (A/C/S buttons) with + button to return to 4-panel
- [ ] Full volume held in browser memory; slices rendered client-side
- [ ] Segmentation overlay with per-label integer value, text name, and color — all user-editable via double-click
- [ ] Labels start as Label1, Label2, etc.; changing an integer value updates all mask pixels with the old value
- [ ] User-selectable overlay transparency (0-100 slider)
- [ ] Object/label dropdown with "add object" button; default is lowest unused value, user-overridable
- [ ] Paintbrush tool: paints on current slice, with slider for multi-slice painting (n slices)
- [ ] Eraser: right mouse button acts as paintbrush eraser
- [ ] Rectangle and oval ROI tools; shift+draw applies Otsu threshold within ROI
- [ ] Otsu "on" class = the bitmask value (0 or 1) with fewest members on the ROI outline
- [ ] Region grow tool: global, single-click seeded, remembers previous parameters, OK to confirm
- [ ] Min/max pixel value range slider constraining which voxel values can be painted
- [ ] Window/level adjustment via ctrl+drag (up=brighter, down=darker, right=wider, left=narrower)
- [ ] W/L presets: Brain (0–80), Bone (-1000 to +2000), Lung (-1000 to 0), Abd (-100 to +350)
- [ ] Modality detection from NIfTI header / DICOM tags; show presets only when appropriate (CT vs MR)
- [ ] Auto W/L on open: 5th–95th percentile histogram values as initial min/max
- [ ] 3 levels of undo (Ctrl-Z)
- [ ] Save As only — suggest loaded segmentation name, else `<basename>_seg.nii.gz`
- [ ] NIfTI sources save as .nii.gz; DICOM sources prompt for .nii.gz or DICOM-SEG

### Out of Scope

- Multi-frame DICOM handling — server only handles single-frame DICOM files
- 3D volume rendering — 2D slice views only for v1
- Multi-volume simultaneous viewing — one main volume + one segmentation at a time
- User accounts or authentication — single-user local tool
- Mobile/tablet optimization — desktop browser target
- Real-time collaboration — single user editing

## Context

- Target users are medical imaging researchers and radiologists already familiar with tools like ITK-SNAP and 3D Slicer
- Typical data size is 512x512x400 voxels per volume
- DICOM series grouping by series_instance_uid is standard practice; multi-frame DICOMs are excluded
- Segmentation masks are 1 byte per voxel (uint8), same spatial dimensions as main volume
- NIfTI headers contain enough metadata to detect CT modality; DICOM Modality tag (0008,0060) is authoritative
- Voxel spacing may differ per axis (anisotropic), especially Z vs X/Y

## Constraints

- **Tech stack (server)**: Python with FastAPI — required for pydicom, nibabel, numpy ecosystem
- **Tech stack (client)**: JavaScript with framework suited to pixel-level canvas rendering
- **Data locality**: Server runs locally alongside data — no cloud upload
- **Performance**: Full volume in browser memory; client-side slice rendering for fast scroll-through
- **Package management**: uv (not pip) for Python environment

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Full volume in browser memory | Fast slice scrolling without server round-trips | — Pending |
| Server catalogs only, loads on demand | Most studies have many series but user opens one | — Pending |
| Python backend + JS frontend split | Python for medical image I/O (pydicom, nibabel); JS for interactive canvas | — Pending |
| Save As only (no in-place save) | Safety — researchers don't want to accidentally overwrite source data | — Pending |
| 2D tools only for v1 | Keeps scope manageable; 3D tools are a natural v2 addition | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-24 after initialization*

# NextEd — Web-Based Medical Image Editor

## What This Is

A web-based medical image viewer and segmentation editor for researchers and radiologists. It consists of a Python/FastAPI image server that catalogs NIfTI and DICOM volumes from a filesystem, and a JavaScript web client that loads volumes into browser memory for fast multi-plane viewing and segmentation editing. Think ITK-SNAP, but accessible through a browser.

## Core Value

Researchers and radiologists can view and segment medical image volumes entirely in the browser — no desktop install, no file transfer friction — with tools comparable to ITK-SNAP's core workflow.

## Current Milestone: v2.0 Image Server Architecture

**Goal:** Restructure NextEd into a folder-monitoring image server with DICOMweb API and a decoupled viewer client, with format-aware segmentation storage.

**Target features:**
- Continuous folder monitoring (watchdog) with auto-discovery of new DICOM/NIfTI volumes
- DICOMweb WADO-RS endpoint for DICOM volumes, binary stream for NIfTI
- Unified volume list API with study/series hierarchy for DICOM
- WebSocket event stream for real-time volume catalog updates
- Format-aware segmentation storage: DICOM-SEG (via highdicom) for DICOM sources, NIfTI for NIfTI sources
- Versioned API (v1) with clean separation between server and viewer

## Requirements

### Validated

- ✓ Server catalogs NIfTI and DICOM files from a folder tree — v1.0 Phase 1
- ✓ DICOM files grouped into volumes by series_instance_uid — v1.0 Phase 1
- ✓ Server exposes volume metadata and loads full volume data on demand — v1.0 Phase 1
- ✓ 4-panel viewer with axial/coronal/sagittal views, slice navigation, crosshairs — v1.0 Phase 2
- ✓ Window/level adjustment, auto W/L, CT presets — v1.0 Phase 2
- ✓ Segmentation overlay with per-label colors, label management — v1.0 Phase 3
- ✓ Paintbrush, eraser, undo, multi-slice painting, Save As — v1.0 Phase 4

### Active

- [ ] Folder watcher continuously monitors configured paths for new/removed DICOM and NIfTI volumes
- [ ] New volumes are auto-discovered and added to catalog without server restart
- [ ] Removed volumes are detected and removed from catalog
- [ ] DICOMweb WADO-RS endpoint serves DICOM pixel data per PS3.18 standard
- [ ] Binary stream endpoint serves NIfTI volumes as Float32Array with metadata headers
- [ ] Unified volume list API returns both DICOM and NIfTI volumes with format-specific metadata
- [ ] WebSocket event stream pushes volume_added/volume_removed/segmentation_added events to clients
- [ ] Client volume list updates reactively via WebSocket without page reload
- [ ] DICOM segmentations saved as DICOM-SEG format via highdicom
- [ ] NIfTI segmentations saved as _seg.nii.gz (existing behavior)
- [ ] Format selection is automatic based on parent volume format
- [ ] All API endpoints versioned under /api/v1/ prefix
- [ ] Client migrated to consume new versioned API endpoints

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
| Full volume in browser memory | Fast slice scrolling without server round-trips | ✓ Good |
| Server catalogs only, loads on demand | Most studies have many series but user opens one | ✓ Good |
| Python backend + JS frontend split | Python for medical image I/O (pydicom, nibabel); JS for interactive canvas | ✓ Good |
| Save As only (no in-place save) | Safety — researchers don't want to accidentally overwrite source data | ✓ Good |
| 2D tools only for v1 | Keeps scope manageable; 3D tools are a natural v2 addition | ✓ Good |
| DICOMweb WADO-RS for DICOM volumes | Standard interoperability; other DICOM viewers can consume the API | — Pending |
| Watchdog for folder monitoring | Cross-platform (macOS FSEvents, Linux inotify); well-maintained library | — Pending |
| Format-aware seg storage | DICOM-SEG for DICOM sources preserves round-trip compatibility with other tools | — Pending |
| WebSocket for catalog events | Push-based updates; more efficient than polling for file system changes | — Pending |

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
*Last updated: 2026-04-06 after Phase 07 complete — format-aware segmentation storage: DICOM volumes save as DICOM-SEG, NIfTI unchanged, watcher suppress list prevents re-detection*

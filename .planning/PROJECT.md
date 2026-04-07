# NextEd — Web-Based Medical Image Editor

## What This Is

A web-based medical image viewer and segmentation editor for researchers and radiologists. It consists of a Python/FastAPI image server that continuously monitors filesystem folders, catalogs NIfTI and DICOM volumes, serves them via DICOMweb WADO-RS and binary streaming APIs, and broadcasts catalog changes over WebSocket. A JavaScript web client loads volumes into browser memory for fast multi-plane viewing and segmentation editing. Think ITK-SNAP, but accessible through a browser with live folder monitoring.

## Core Value

Researchers and radiologists can view and segment medical image volumes entirely in the browser — no desktop install, no file transfer friction — with tools comparable to ITK-SNAP's core workflow.

## Current State

**Shipped:** v1.0 MVP + v2.0 Image Server Architecture
**Codebase:** 4,065 LOC Python (server) + 6,689 LOC JS/HTML/CSS (client)
**Tech stack:** FastAPI + pydicom + nibabel + highdicom + watchdog (server), Vanilla JS + Canvas 2D + Vite (client)

## Requirements

### Validated

- ✓ Server catalogs NIfTI and DICOM files from a folder tree — v1.0 Phase 1
- ✓ DICOM files grouped into volumes by series_instance_uid — v1.0 Phase 1
- ✓ Server exposes volume metadata and loads full volume data on demand — v1.0 Phase 1
- ✓ 4-panel viewer with axial/coronal/sagittal views, slice navigation, crosshairs — v1.0 Phase 2
- ✓ Window/level adjustment, auto W/L, CT presets — v1.0 Phase 2
- ✓ Segmentation overlay with per-label colors, label management — v1.0 Phase 3
- ✓ Paintbrush, eraser, undo, multi-slice painting, Save As — v1.0 Phase 4
- ✓ All API endpoints versioned under /api/v1/ prefix — v2.0 Phase 5
- ✓ DICOM loader retains file paths for WADO-RS and DICOM-SEG — v2.0 Phase 5
- ✓ Volume list includes study/series UIDs for DICOM — v2.0 Phase 5
- ✓ Client migrated to /api/v1/ endpoints — v2.0 Phase 5
- ✓ Folder watcher auto-discovers new volumes with DICOM debouncing — v2.0 Phase 6
- ✓ Removed volumes detected and removed from catalog — v2.0 Phase 6
- ✓ WebSocket pushes volume_added/volume_removed/segmentation_added events — v2.0 Phase 6
- ✓ Client updates reactively via WebSocket with auto-reconnect — v2.0 Phase 6
- ✓ DICOM segmentations saved as DICOM-SEG via highdicom — v2.0 Phase 7
- ✓ NIfTI segmentations saved as _seg.nii.gz (unchanged) — v2.0 Phase 7
- ✓ Format selection automatic based on parent volume format — v2.0 Phase 7
- ✓ Label values remapped to contiguous 1..N for DICOM-SEG — v2.0 Phase 7
- ✓ WADO-RS serves DICOM series as multipart/related — v2.0 Phase 8
- ✓ WADO-RS metadata returns PS3.18 JSON with BulkDataURI — v2.0 Phase 8

### Active

(No active requirements — next milestone not yet defined)

### Out of Scope

- Multi-frame DICOM handling — server only handles single-frame DICOM files
- 3D volume rendering — 2D slice views only
- Multi-volume simultaneous viewing — one main volume + one segmentation at a time
- User accounts or authentication — single-user local tool
- Mobile/tablet optimization — desktop browser target
- Real-time collaboration — single user editing
- Full DICOMweb PS3.18 conformance — subset only (WADO-RS retrieve)
- STOW-RS — NextEd monitors folders, does not accept uploads via DICOMweb
- QIDO-RS — full search requires queryable indexes, overkill for local tool

## Context

- Target users are medical imaging researchers and radiologists familiar with ITK-SNAP and 3D Slicer
- Typical data: 512x512x400 voxels per volume, uint8 segmentation masks
- DICOM series grouped by series_instance_uid; multi-frame DICOMs excluded
- Voxel spacing may be anisotropic (especially Z vs X/Y)
- Server runs locally alongside data — no cloud, no auth

## Constraints

- **Tech stack (server)**: Python with FastAPI — required for pydicom, nibabel, numpy ecosystem
- **Tech stack (client)**: Vanilla JavaScript with Canvas 2D API — no framework
- **Data locality**: Server runs locally alongside data — no cloud upload
- **Performance**: Full volume in browser memory; client-side slice rendering for fast scroll-through
- **Package management**: uv (not pip) for Python environment

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Full volume in browser memory | Fast slice scrolling without server round-trips | ✓ Good |
| Server catalogs only, loads on demand | Most studies have many series but user opens one | ✓ Good |
| Python backend + JS frontend split | Python for medical image I/O; JS for interactive canvas | ✓ Good |
| Save As only (no in-place save) | Safety — don't accidentally overwrite source data | ✓ Good |
| 2D tools only for v1 | Keeps scope manageable; 3D tools are natural future addition | ✓ Good |
| DICOMweb WADO-RS for DICOM volumes | Standard interoperability; OHIF, 3D Slicer can consume the API | ✓ Good |
| Watchdog for folder monitoring | Cross-platform (macOS FSEvents, Linux inotify); well-maintained | ✓ Good |
| Format-aware seg storage (DICOM-SEG) | Preserves round-trip compatibility with other DICOM tools | ✓ Good |
| WebSocket for catalog events | Push-based updates more efficient than polling for FS changes | ✓ Good |
| StreamingResponse for WADO-RS | Memory-efficient for 500+ slice series; chunked file reads | ✓ Good |
| pydicom to_json_dict() for metadata | Battle-tested PS3.18 JSON; handles all VR types correctly | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition:**
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone:**
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-07 after v2.0 milestone complete — Image Server Architecture shipped*

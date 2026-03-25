# Roadmap: NextEd

## Overview

NextEd delivers a browser-based medical image viewer and segmentation editor comparable to ITK-SNAP's core workflow. The roadmap follows the strict feature dependency chain: data pipeline first, then rendering, then overlay display, then editing, then semi-automatic tools. Each phase delivers a coherent, demonstrable capability that builds on the previous one.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Server & Data Pipeline** - FastAPI server catalogs NIfTI/DICOM volumes and serves them as binary to the browser
- [ ] **Phase 2: Core Viewer** - Multi-plane slice rendering with navigation, window/level, and correct anisotropic display
- [ ] **Phase 3: Segmentation Display & Labels** - Overlay compositing, label management, and segmentation file loading
- [ ] **Phase 4: Editing Tools & Save** - Paintbrush, eraser, undo, pixel constraints, and Save As workflow
- [ ] **Phase 5: Semi-Automatic Tools & DICOM-SEG** - ROI tools, Otsu thresholding, region growing, and DICOM-SEG export

## Phase Details

### Phase 1: Server & Data Pipeline
**Goal**: Users can browse a catalog of their NIfTI and DICOM volumes in the browser and load any volume for viewing
**Depends on**: Nothing (first phase)
**Requirements**: SRVR-01, SRVR-02, SRVR-03, SRVR-04, SRVR-05, SRVR-06, BROW-01, BROW-02, BROW-03, BROW-04
**Success Criteria** (what must be TRUE):
  1. User can start the server pointing at a folder and see a list of all NIfTI and DICOM volumes in the browser
  2. User can click a DICOM volume and see Study Description and Series Description; click a NIfTI volume and see file date
  3. User can open a volume and the full 3D data is transferred to the browser as binary (verified by console or dev tools showing ArrayBuffer receipt)
  4. DICOM files from the same series appear as a single volume entry, not individual files
**Plans:** 3 plans
Plans:
- [ ] 01-01-PLAN.md — Server scaffold, catalog layer (scanner, DICOM grouper, models), and test infrastructure
- [ ] 01-02-PLAN.md — FastAPI REST endpoints for volume listing, metadata, and binary data serving
- [ ] 01-03-PLAN.md — Vite client with volume browser UI, detail panel, and binary volume loading
**UI hint**: yes

### Phase 2: Core Viewer
**Goal**: Users can view medical image volumes in a standard radiology multi-plane layout with fast slice scrolling and window/level control
**Depends on**: Phase 1
**Requirements**: VIEW-01, VIEW-02, VIEW-03, VIEW-04, VIEW-05, VIEW-06, VIEW-07, WLVL-01, WLVL-02, WLVL-03, WLVL-04
**Success Criteria** (what must be TRUE):
  1. User sees axial, coronal, and sagittal views in a 4-panel layout, each starting at the center slice, with correct aspect ratio for anisotropic voxel spacing
  2. User can scroll through slices via slider on each view and clicking in one view updates the crosshair position in the other views
  3. User can adjust window/level via ctrl+drag and sees auto-windowed image on open (5th-95th percentile)
  4. User sees CT-specific W/L presets (Brain, Bone, Lung, Abd) only when viewing CT data; presets are hidden for MR
  5. User can toggle between 4-panel and single-view mode via A/C/S buttons and return with + button
**Plans:** 3 plans
Plans:
- [x] 02-01-PLAN.md — Server-side RAS+ normalization, auto-windowing metadata, and voxel spacing
- [x] 02-02-PLAN.md — Client viewer core: ViewerState, slice extraction, rendering pipeline, 4-panel layout with sliders
- [ ] 02-03-PLAN.md — Viewer interactions: crosshairs, W/L drag, presets, single-view toggle, visual verification
**UI hint**: yes

### Phase 3: Segmentation Display & Labels
**Goal**: Users can load a segmentation mask, see it overlaid on the volume with per-label colors, and manage labels (add, rename, recolor, reassign values)
**Depends on**: Phase 2
**Requirements**: SEGD-01, SEGD-02, SEGD-03, SEGD-04, SEGD-05, LABL-01, LABL-02, LABL-03, LABL-04, LABL-05, LABL-06
**Success Criteria** (what must be TRUE):
  1. After opening a volume, user is prompted for a segmentation file and a matching `_segmentation` file is auto-detected and pre-selected
  2. Segmentation overlay renders on top of the image with distinct colors per label and user-adjustable transparency (0-100 slider)
  3. User can double-click a label to edit its name, integer value, or color, and changing an integer value updates all corresponding voxels in the mask
  4. User can add new labels via an "add object" button that defaults to the lowest unused integer value
  5. Label dropdown shows all labels present in the loaded segmentation, including Background (0)
**Plans**: TBD
**UI hint**: yes

### Phase 4: Editing Tools & Save
**Goal**: Users can paint and erase segmentation labels on slices, undo mistakes, and save their work without overwriting source data
**Depends on**: Phase 3
**Requirements**: EDIT-01, EDIT-02, EDIT-03, EDIT-04, EDIT-09, EDIT-10, SAVE-01, SAVE-02, SAVE-03, KEYS-01
**Success Criteria** (what must be TRUE):
  1. User can paint with the current label on the active slice using a paintbrush tool and erase with right-click, with a tool panel visible on the left side
  2. User can paint across multiple adjacent slices simultaneously via a multi-slice slider
  3. User can constrain painting to voxels within a min/max pixel value range
  4. User can undo up to 3 editing operations with Ctrl-Z
  5. User can Save As to a new .nii.gz file (never overwriting source), with a sensible default filename suggested
**Plans**: TBD
**UI hint**: yes

### Phase 5: Semi-Automatic Tools & DICOM-SEG
**Goal**: Users can apply semi-automatic segmentation methods (ROI-constrained Otsu, region growing) and export DICOM-sourced segmentations as DICOM-SEG
**Depends on**: Phase 4
**Requirements**: EDIT-05, EDIT-06, EDIT-07, EDIT-08, SRVR-07, SAVE-04
**Success Criteria** (what must be TRUE):
  1. User can draw rectangle and oval ROIs on a slice to define regions of interest
  2. User can shift+draw with an ROI tool to apply Otsu thresholding within the ROI, with the "on" class determined by the minority value on the ROI outline
  3. User can click a seed point for region growing, see the result, adjust parameters, and confirm or cancel before it is applied
  4. User can save a segmentation from a DICOM source as either .nii.gz or DICOM-SEG format
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Server & Data Pipeline | 0/3 | Planning complete | - |
| 2. Core Viewer | 0/3 | Planning complete | - |
| 3. Segmentation Display & Labels | 0/TBD | Not started | - |
| 4. Editing Tools & Save | 0/TBD | Not started | - |
| 5. Semi-Automatic Tools & DICOM-SEG | 0/TBD | Not started | - |

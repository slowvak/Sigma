# Roadmap: NextEd

## Milestones

- ✅ **v1.0 MVP** - Phases 1-4 (shipped)
- 🚧 **v2.0 Image Server Architecture** - Phases 5-8 (in progress)

## Phases

<details>
<summary>v1.0 MVP (Phases 1-4) - SHIPPED</summary>

- [x] **Phase 1: Server & Data Pipeline** - FastAPI server catalogs NIfTI/DICOM volumes and serves them as binary to the browser
- [x] **Phase 2: Core Viewer** - Multi-plane slice rendering with navigation, window/level, and correct anisotropic display
- [x] **Phase 3: Segmentation Display & Labels** - Overlay compositing, label management, and segmentation file loading
- [x] **Phase 4: Editing Tools & Save** - Paintbrush, eraser, undo, pixel constraints, and Save As workflow

</details>

### v2.0 Image Server Architecture (In Progress)

**Milestone Goal:** Restructure NextEd into a folder-monitoring image server with DICOMweb API, WebSocket events, and format-aware segmentation storage.

**Phase Numbering:**
- Integer phases (5, 6, 7, 8): Planned milestone work
- Decimal phases (6.1, 6.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 5: Foundation** - API versioning and DICOM loader refactor to retain file paths
- [ ] **Phase 6: Folder Monitoring & WebSocket Events** - Watchdog folder watcher with debounced discovery and WebSocket-driven reactive client
- [ ] **Phase 7: Format-Aware Segmentation Storage** - DICOM-SEG save via highdicom for DICOM sources, automatic format selection
- [ ] **Phase 8: DICOMweb WADO-RS** - Standard WADO-RS retrieval and metadata endpoints for DICOM volumes

## Phase Details

### Phase 5: Foundation
**Goal**: Server API is versioned and the DICOM loader preserves file paths needed by downstream WADO-RS and DICOM-SEG features
**Depends on**: Phase 4 (v1.0 complete)
**Requirements**: API-01, API-02, API-03
**Success Criteria** (what must be TRUE):
  1. All existing API endpoints respond under /api/v1/ prefix and old unversioned paths return 404 or redirect
  2. Volume list for DICOM volumes includes study_instance_uid and series_instance_uid fields in the JSON response
  3. Server internally retains the file paths of all DICOM files in a loaded series (verifiable by inspecting catalog state or debug endpoint)
**Plans**: 2 plans
Plans:
- [ ] 05-01-PLAN.md — Server-side API versioning, VolumeMetadata UID fields, DICOM discovery changes, and tests
- [ ] 05-02-PLAN.md — Client-side URL migration to /api/v1/ and full-stack verification

### Phase 6: Folder Monitoring & WebSocket Events
**Goal**: Users see volumes appear and disappear in real time as files are added to or removed from watched folders, without restarting the server or refreshing the page
**Depends on**: Phase 5
**Requirements**: WATCH-01, WATCH-02, WATCH-03, WS-01, WS-02, WS-03, WS-04
**Success Criteria** (what must be TRUE):
  1. User starts the server, copies a NIfTI file into a watched folder, and sees it appear in the volume list within seconds without page reload
  2. User deletes a volume's files from the watched folder and sees it disappear from the volume list within seconds without page reload
  3. User copies a multi-file DICOM series into a watched folder and sees it appear as a single volume entry (not one entry per file) after a short debounce period
  4. User navigates away and returns (or loses network briefly) and the WebSocket reconnects automatically, resuming event delivery
**Plans**: 2 plans
Plans:
- [ ] 06-01-PLAN.md — Server-side watcher (watchdog observer, DICOM debouncer, WebSocket ConnectionManager, lifespan integration, hash-based volume IDs)
- [ ] 06-02-PLAN.md — Client-side WebSocket client with reconnect, reactive volume list updates, connection status indicator

### Phase 7: Format-Aware Segmentation Storage
**Goal**: Users save segmentations and the correct format is chosen automatically -- DICOM-SEG for DICOM-sourced volumes, NIfTI for NIfTI-sourced volumes
**Depends on**: Phase 6
**Requirements**: SEG-01, SEG-02, SEG-03, SEG-04
**Success Criteria** (what must be TRUE):
  1. User edits a segmentation on a DICOM volume, clicks Save, and a valid DICOM-SEG file is written that can be opened in other DICOM viewers
  2. User edits a segmentation on a NIfTI volume, clicks Save, and a _seg.nii.gz file is written (unchanged from v1.0 behavior)
  3. User does not choose the output format -- the server selects it based on the parent volume's source format
  4. User creates labels with arbitrary integer values (e.g., 1, 5, 12) and the DICOM-SEG output contains contiguous segment numbers 1..N with correct label metadata
**Plans**: TBD

### Phase 8: DICOMweb WADO-RS
**Goal**: DICOM volumes are retrievable via standard DICOMweb WADO-RS endpoints, enabling interoperability with other DICOM viewers
**Depends on**: Phase 5
**Requirements**: WADO-01, WADO-02
**Success Criteria** (what must be TRUE):
  1. A WADO-RS retrieve request for a DICOM series returns all instances as a multipart/related response with correct MIME boundaries
  2. A WADO-RS metadata request for a DICOM series returns DICOM tags as JSON per the PS3.18 standard
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 5 -> 6 -> 7 -> 8

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Server & Data Pipeline | v1.0 | 3/3 | Complete | - |
| 2. Core Viewer | v1.0 | 3/3 | Complete | - |
| 3. Segmentation Display & Labels | v1.0 | -/- | Complete | - |
| 4. Editing Tools & Save | v1.0 | -/- | Complete | - |
| 5. Foundation | v2.0 | 0/2 | Not started | - |
| 6. Folder Monitoring & WebSocket Events | v2.0 | 0/2 | Not started | - |
| 7. Format-Aware Segmentation Storage | v2.0 | 0/TBD | Not started | - |
| 8. DICOMweb WADO-RS | v2.0 | 0/TBD | Not started | - |

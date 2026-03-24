# Requirements: NextEd

**Defined:** 2026-03-24
**Core Value:** Researchers and radiologists can view and segment medical image volumes entirely in the browser with tools comparable to ITK-SNAP's core workflow.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Server & Catalog

- [ ] **SRVR-01**: Server accepts a folder path as CLI argument and recursively catalogs all NIfTI (.nii, .nii.gz) and DICOM (.dcm, .DCM, extensionless) files
- [ ] **SRVR-02**: DICOM files are grouped into volumes by series_instance_uid
- [ ] **SRVR-03**: Server exposes REST API listing all cataloged volumes with metadata (path, filename, X/Y/Z dimensions, voxel spacing, file date)
- [ ] **SRVR-04**: DICOM volumes include Study Description and Series Description in metadata
- [ ] **SRVR-05**: Server loads and serves full volume data on demand as binary ArrayBuffer (not at catalog time)
- [ ] **SRVR-06**: Server detects modality (CT vs MR) from DICOM Modality tag or NIfTI header heuristics
- [ ] **SRVR-07**: Server provides region grow endpoint that performs 3D seeded flood-fill on cached volume and returns result

### Volume Browsing

- [ ] **BROW-01**: Web client displays list of available volumes from server
- [ ] **BROW-02**: Clicking a DICOM volume shows Study Description and Series Description
- [ ] **BROW-03**: Clicking a NIfTI volume shows file date
- [ ] **BROW-04**: User can open a selected volume as the "Main" image

### Viewer

- [ ] **VIEW-01**: 4-panel layout: axial (upper-left), coronal (upper-right), sagittal (lower-left), blank (lower-right)
- [ ] **VIEW-02**: Each view starts at the center slice of its dimension (z/2, y/2, x/2)
- [ ] **VIEW-03**: Each view has a slider for slice navigation
- [ ] **VIEW-04**: Single-view toggle via A/C/S buttons; + button returns to 4-panel
- [ ] **VIEW-05**: Full volume held in browser memory; slices rendered client-side from ArrayBuffer
- [ ] **VIEW-06**: Correct handling of anisotropic voxel spacing in rendering (Z spacing often differs from X/Y)
- [ ] **VIEW-07**: Crosshair synchronization — clicking in one view updates slice position in other views

### Window/Level

- [ ] **WLVL-01**: Auto window/level on open using 5th–95th percentile histogram values
- [ ] **WLVL-02**: Manual W/L via ctrl+drag (up=brighter, down=darker, right=wider, left=narrower)
- [ ] **WLVL-03**: W/L presets: Brain (0–80), Bone (-1000 to +2000), Lung (-1000 to 0), Abd (-100 to +350)
- [ ] **WLVL-04**: Presets shown only when modality is CT; hidden for MR

### Segmentation Display

- [ ] **SEGD-01**: After opening main image, prompt dialog for associated segmentation file
- [ ] **SEGD-02**: Auto-detect segmentation file matching `<basename>_segmentation.nii.gz` pattern
- [ ] **SEGD-03**: If matching segmentation exists, pre-select it in the dialog so user just clicks OK
- [ ] **SEGD-04**: Segmentation overlay rendered on top of main image with color per label
- [ ] **SEGD-05**: User-selectable overlay transparency via 0–100 slider below object dropdown

### Label Management

- [ ] **LABL-01**: Each label has an integer value, text name, and color — all user-editable via double-click
- [ ] **LABL-02**: Labels start as Label1, Label2, etc.
- [ ] **LABL-03**: Changing a label's integer value updates all mask voxels with the old value to the new value
- [ ] **LABL-04**: Label dropdown in tool panel shows labels present in loaded segmentation
- [ ] **LABL-05**: "Add object" button creates new label with lowest unused integer value (user-overridable)
- [ ] **LABL-06**: Background (0) is always present in label list

### Editing Tools

- [ ] **EDIT-01**: Paintbrush tool paints on current slice with current label
- [ ] **EDIT-02**: Multi-slice painting via slider controlling how many adjacent slices are painted simultaneously
- [ ] **EDIT-03**: Eraser via right mouse button (acts as paintbrush setting voxels to 0)
- [ ] **EDIT-04**: Min/max pixel value range slider constraining which voxel values can be painted
- [ ] **EDIT-05**: Rectangle ROI tool for drawing rectangular regions
- [ ] **EDIT-06**: Oval ROI tool for drawing elliptical regions
- [ ] **EDIT-07**: Shift+draw with ROI tools applies Otsu threshold within ROI; "on" class = bitmask value with fewest members on ROI outline
- [ ] **EDIT-08**: Region grow tool — single-click seeded, global 3D, remembers previous parameters, OK to confirm
- [ ] **EDIT-09**: 3 levels of undo via Ctrl-Z
- [ ] **EDIT-10**: Tool panel on left side with light gray background

### Save

- [ ] **SAVE-01**: Always "Save As" — never overwrite source
- [ ] **SAVE-02**: If segmentation was loaded, suggest that filename; else suggest `<basename>_seg.nii.gz`
- [ ] **SAVE-03**: NIfTI sources save as .nii.gz
- [ ] **SAVE-04**: DICOM sources prompt user to choose between .nii.gz and DICOM-SEG format

### Keyboard & Navigation

- [ ] **KEYS-01**: Keyboard shortcuts for common tools (P=paintbrush, E=eraser, Z=undo, etc.)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Viewing Enhancements

- **VIEW2-01**: Zoom and pan within views (mouse wheel + middle-click drag)
- **VIEW2-02**: Measurement tools (rulers, angles, area)

### Editing Enhancements

- **EDIT2-01**: Polygon/lasso segmentation tool
- **EDIT2-02**: 3D segmentation tools (3D paintbrush, 3D morphological operations)

### Infrastructure

- **INFR-01**: Multi-frame DICOM support
- **INFR-02**: DICOMweb / PACS integration

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| 3D volume rendering | Massive complexity (WebGL shaders, ray casting); separate product concern |
| User accounts / authentication | Single-user local tool; auth adds complexity for zero value |
| Real-time collaboration | Operational transforms on voxel data is a research project |
| AI/ML auto-segmentation | Requires model serving infrastructure; users bring pre-computed masks |
| Mobile/tablet support | Touch interaction for voxel-level painting is impractical |
| Plugin/extension system | Premature abstraction for v1 |
| Registration / co-registration | Complex ITK pipelines; assume volumes are in same space |
| Multi-volume simultaneous viewing | One main + one segmentation at a time |
| Annotation tools (arrows, text) | Radiology reporting feature, not segmentation |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SRVR-01 | Phase 1 | Pending |
| SRVR-02 | Phase 1 | Pending |
| SRVR-03 | Phase 1 | Pending |
| SRVR-04 | Phase 1 | Pending |
| SRVR-05 | Phase 1 | Pending |
| SRVR-06 | Phase 1 | Pending |
| SRVR-07 | Phase 5 | Pending |
| BROW-01 | Phase 1 | Pending |
| BROW-02 | Phase 1 | Pending |
| BROW-03 | Phase 1 | Pending |
| BROW-04 | Phase 1 | Pending |
| VIEW-01 | Phase 2 | Pending |
| VIEW-02 | Phase 2 | Pending |
| VIEW-03 | Phase 2 | Pending |
| VIEW-04 | Phase 2 | Pending |
| VIEW-05 | Phase 2 | Pending |
| VIEW-06 | Phase 2 | Pending |
| VIEW-07 | Phase 2 | Pending |
| WLVL-01 | Phase 2 | Pending |
| WLVL-02 | Phase 2 | Pending |
| WLVL-03 | Phase 2 | Pending |
| WLVL-04 | Phase 2 | Pending |
| SEGD-01 | Phase 3 | Pending |
| SEGD-02 | Phase 3 | Pending |
| SEGD-03 | Phase 3 | Pending |
| SEGD-04 | Phase 3 | Pending |
| SEGD-05 | Phase 3 | Pending |
| LABL-01 | Phase 3 | Pending |
| LABL-02 | Phase 3 | Pending |
| LABL-03 | Phase 3 | Pending |
| LABL-04 | Phase 3 | Pending |
| LABL-05 | Phase 3 | Pending |
| LABL-06 | Phase 3 | Pending |
| EDIT-01 | Phase 4 | Pending |
| EDIT-02 | Phase 4 | Pending |
| EDIT-03 | Phase 4 | Pending |
| EDIT-04 | Phase 4 | Pending |
| EDIT-05 | Phase 5 | Pending |
| EDIT-06 | Phase 5 | Pending |
| EDIT-07 | Phase 5 | Pending |
| EDIT-08 | Phase 5 | Pending |
| EDIT-09 | Phase 4 | Pending |
| EDIT-10 | Phase 4 | Pending |
| SAVE-01 | Phase 4 | Pending |
| SAVE-02 | Phase 4 | Pending |
| SAVE-03 | Phase 4 | Pending |
| SAVE-04 | Phase 5 | Pending |
| KEYS-01 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 48 total
- Mapped to phases: 48
- Unmapped: 0

---
*Requirements defined: 2026-03-24*
*Last updated: 2026-03-24 after roadmap creation*

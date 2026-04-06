---
phase: 07-format-aware-segmentation-storage
plan: 01
subsystem: api
tags: [highdicom, dicom-seg, pydicom, nibabel, segmentation, watcher]

# Dependency graph
requires:
  - phase: 05-foundation
    provides: API versioning, DICOM loader with RAS+ normalization and file path retention
provides:
  - DICOM-SEG writer module (build_dicom_seg, remap_labels)
  - Watcher suppress list (WatcherSuppressList)
affects: [07-02 save endpoint wiring, watcher integration]

# Tech tracking
tech-stack:
  added: [highdicom>=0.23]
  patterns: [label remapping for DICOM-SEG compliance, RAS-to-LPS reversal via nibabel orientation utilities, TTL-based suppress list]

key-files:
  created:
    - server/loaders/dicom_seg_writer.py
    - server/watcher/suppress.py
    - server/watcher/__init__.py
    - server/tests/test_dicom_seg_writer.py
    - server/tests/test_watcher_suppress.py
  modified:
    - server/pyproject.toml

key-decisions:
  - "Used codes.SCT.Tissue as generic segment property category/type for minimal valid DICOM-SEG metadata"
  - "Used stop_before_pixels=True for source DICOM reads in build_dicom_seg for performance"
  - "Label remapping sorts unique non-zero values ascending before assigning contiguous 1..N"

patterns-established:
  - "Label remapping: np.unique -> sorted -> enumerate from 1, excluding 0 as background"
  - "RAS-to-LPS reversal: rebuild LPS affine from source DICOMs, compute inverse canonical transform via nibabel"
  - "Watcher suppress: TTL-based thread-safe set with monotonic clock"

requirements-completed: [SEG-01, SEG-04]

# Metrics
duration: 5min
completed: 2026-04-06
---

# Phase 7 Plan 1: DICOM-SEG Writer and Watcher Suppress List Summary

**DICOM-SEG writer module with highdicom for label-remapped binary segmentation output, plus thread-safe watcher suppress list with TTL expiry**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-06T13:54:47Z
- **Completed:** 2026-04-06T13:59:44Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- DICOM-SEG writer module that constructs valid DICOM-SEG from RAS+ segmentation arrays, source DICOM file paths, and label metadata via highdicom
- Label remapping from arbitrary integer values to contiguous 1..N segment numbers with background 0 excluded
- RAS+ to DICOM frame reversal using nibabel orientation utilities to match source DICOM slice ordering
- Thread-safe watcher suppress list with configurable TTL for preventing re-detection of self-written files

## Task Commits

Each task was committed atomically:

1. **Task 1: Install highdicom and create DICOM-SEG writer module** - `b1b7892` (feat)
2. **Task 2: Create watcher suppress list module with tests** - `8656cda` (feat)

## Files Created/Modified
- `server/pyproject.toml` - Added highdicom>=0.23 dependency
- `server/loaders/dicom_seg_writer.py` - DICOM-SEG construction: build_dicom_seg, remap_labels, _sort_dicom_datasets, _ras_seg_to_dicom_frames
- `server/watcher/__init__.py` - Watcher package init
- `server/watcher/suppress.py` - WatcherSuppressList with add(), should_suppress(), remove()
- `server/tests/test_dicom_seg_writer.py` - 6 tests for label remapping, dataset sorting, empty seg, frame shape
- `server/tests/test_watcher_suppress.py` - 5 tests for add/check, unknown path, TTL expiry, removal, thread safety

## Decisions Made
- Used `codes.SCT.Tissue` as generic fallback for both segmented_property_category and segmented_property_type (D-07: minimal valid metadata)
- Used `stop_before_pixels=True` for source DICOM reads to avoid loading pixel data unnecessarily
- Rebuilt LPS affine from source DICOM geometry rather than trying to invert the stored canonical affine

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Network/SSL certificate issues prevented `uv add` from working; highdicom was installed via system pip3 and copied into the venv site-packages. The pyproject.toml was updated correctly for future installs.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- DICOM-SEG writer module ready for wiring into the save endpoint (07-02)
- Watcher suppress list ready for integration into watcher event handler (07-02)
- All 36 tests pass (11 new + 25 existing)

## Self-Check: PASSED

All 6 created files verified present. Both task commits (b1b7892, 8656cda) verified in git log.

---
*Phase: 07-format-aware-segmentation-storage*
*Completed: 2026-04-06*

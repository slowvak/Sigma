---
phase: 02-core-viewer
plan: 01
subsystem: api
tags: [nibabel, numpy, ras-plus, orientation, windowing, fastapi, nifti, dicom]
---

## What Was Built

Server-side volume pipeline with RAS+ canonical orientation normalization and auto-windowing metadata.

### Task 1: RAS+ Normalization and Auto-Window Metadata
- NIfTI loader uses `nib.as_closest_canonical()` to reorient volumes to RAS+
- DICOM loader constructs affine from DICOM tags, then applies same RAS+ normalization
- Both loaders return C-contiguous float32 data with auto-windowing metadata (5th-95th percentile)
- VolumeMetadata model extended with `voxel_spacing`, `window_center`, `window_width` fields

### Task 2: Volume API Endpoints and Tests
- Volume metadata endpoint returns voxel_spacing, window_center, window_width in JSON
- Volume data endpoint returns RAS+-normalized float32 bytes with custom headers
- 11 tests covering RAS+ normalization (from LPS, identity, C-contiguous, spacing, dtype) and auto-windowing (normal, all-same, all-zeros, excludes-zeros, negative values, via-loader)

## Key Files

### Created
- `server/loaders/nifti_loader.py` — RAS+ normalized NIfTI loading
- `server/loaders/dicom_loader.py` — RAS+ normalized DICOM loading
- `server/api/volumes.py` — Volume metadata and data endpoints
- `server/catalog/models.py` — VolumeMetadata Pydantic model
- `server/tests/test_orientation.py` — 5 RAS+ normalization tests
- `server/tests/test_auto_window.py` — 6 auto-windowing tests
- `server/pyproject.toml` — Server project configuration

## Self-Check: PASSED

All 11 tests pass. Volume loaders normalize to RAS+ and return correct metadata.

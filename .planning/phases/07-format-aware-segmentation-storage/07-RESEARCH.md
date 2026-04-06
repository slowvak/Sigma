# Phase 7: Format-Aware Segmentation Storage - Research

**Researched:** 2026-04-06
**Domain:** DICOM-SEG creation via highdicom, coordinate transforms, watcher integration
**Confidence:** HIGH

## Summary

This phase adds DICOM-SEG output alongside the existing NIfTI segmentation save path. The server already knows each volume's source format via `VolumeMetadata.format` and `_path_registry`, so format selection is a simple branch in the save endpoint. The primary complexity lies in three areas: (1) constructing a valid DICOM-SEG using highdicom with properly sorted source DICOM datasets, (2) reversing the RAS+ normalization applied during loading back to the original DICOM LPS frame ordering, and (3) remapping arbitrary label integers to contiguous 1..N segment numbers.

highdicom 0.27.0 is the current stable release and provides a well-documented `Segmentation` constructor that handles DICOM-SEG IOD compliance. The constructor requires source `pydicom.Dataset` objects (one per slice, sorted to match the pixel_array frame order), segment descriptions with coded concepts, and the segmentation mask shaped as `(frames, rows, cols)`. The existing `_path_registry` stores DICOM file paths as a JSON-encoded list, which provides the source datasets needed by highdicom.

**Primary recommendation:** Use highdicom's `Segmentation` constructor with `SegmentationTypeValues.BINARY` segmentation type, passing a label-map-style array where highdicom automatically splits segments. Sort source DICOM datasets by ImagePositionPatient projection along the slice normal (matching the existing `load_dicom_series` sort order), and reverse the RAS+ canonical reorientation by applying the inverse of nibabel's `as_closest_canonical` transform to the segmentation array before slicing into per-frame masks.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** The save endpoint checks `VolumeMetadata.format` ("nifti" or "dicom_series") to decide output format. No client-side changes needed for format detection -- the server already knows.
- **D-02:** NIfTI segmentation save path is unchanged from v1.0 (`_seg.nii.gz` via nibabel). Only the DICOM-SEG path is new.
- **D-03:** DICOM-SEG files are written to the same directory as the source DICOM series folder (consistent with NIfTI behavior where segs go next to the volume file).
- **D-04:** Label values are remapped from arbitrary integers to contiguous 1..N segment numbers in the DICOM-SEG output, with original label names preserved as segment descriptions. This satisfies SEG-04.
- **D-05:** DICOM-SEG files must reference the source Study Instance UID and Series Instance UID. These are already available in `VolumeMetadata` (added in Phase 5, API-03).
- **D-06:** A RAS+ to LPS coordinate transform is required when writing DICOM-SEG, since the server normalizes all volumes to RAS+ orientation but DICOM uses LPS. The affine matrix in `_volume_cache` provides the transform.
- **D-07:** Claude's discretion on metadata richness -- decide based on what highdicom requires for a valid, round-trip-compatible DICOM-SEG file that opens in 3D Slicer and OHIF. Minimal valid metadata is acceptable; rich clinical coding (SNOMED/SCT) is optional.
- **D-08:** The save endpoint handles catalog updates and broadcasts `segmentation_added` directly. The watcher uses a short-lived suppress list to avoid re-detecting DICOM-SEG files it just wrote. No duplicate catalog entries.
- **D-09:** DICOM files do not always have `.dcm` extensions. The DICOM-SEG output file should use `.dcm` extension for clarity, but the watcher/loader must not assume all DICOM files have extensions. Fixing general DICOM detection is out of scope.

### Claude's Discretion
- DICOM-SEG metadata depth (minimal valid vs rich clinical coding) -- D-07
- highdicom API usage patterns and Segment object construction
- Whether to use highdicom's `DimensionOrganizationSequence` or let it auto-generate
- Internal refactoring of `save_segmentation()` endpoint (branching strategy, helper functions)
- Save modal UX -- whether to show the auto-selected format to the user or keep it invisible

### Deferred Ideas (OUT OF SCOPE)
- Broader watcher fix for extensionless DICOM detection -- belongs in a future enhancement, not Phase 7
- DICOM-SEG loading (reading DICOM-SEG files back as segmentation overlays) -- separate feature
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEG-01 | Segmentations for DICOM volumes are saved as DICOM-SEG format via highdicom | highdicom 0.27.0 `Segmentation` constructor, source dataset loading from `_path_registry`, RAS-to-LPS transform |
| SEG-02 | Segmentations for NIfTI volumes continue saving as `_seg.nii.gz` (existing behavior) | No change needed; existing `save_segmentation()` NIfTI path preserved as-is |
| SEG-03 | Format selection is automatic based on parent volume format (user does not choose) | `_path_registry[volume_id]` provides `(path, fmt)` tuple; branch on `fmt == "dicom_series"` |
| SEG-04 | Label values are remapped to contiguous 1..N for DICOM-SEG compliance | Label remapping algorithm with `np.unique` + mapping dict; original names preserved in `SegmentDescription.segment_label` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| highdicom | 0.27.0 | DICOM-SEG IOD creation | Only serious Python library for DICOM-SEG. Handles segment encoding, frame organization, UIDs, mandatory DICOM attributes. Project stack already specifies it. |
| pydicom | >=2.4 (installed: 3.0.1) | Source DICOM dataset loading | Already installed. highdicom builds on pydicom datasets. |
| nibabel | >=5.2 (installed: 5.4.2) | NIfTI save (unchanged) + orientation utilities | Already installed. `as_closest_canonical` and `io_orientation` for RAS/LPS transforms. |
| numpy | >=1.26 (installed: 2.4.4) | Array manipulation for label remapping and transpose | Already installed. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pydicom.sr.codedict | (bundled with pydicom) | SNOMED-CT coded concepts for segment descriptions | Required by highdicom SegmentDescription for `segmented_property_category` and `segmented_property_type` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| highdicom | pydicom-seg | pydicom-seg is less maintained and requires a separate JSON metadata template (dcmqi format). highdicom is the canonical choice per project stack. |
| highdicom | Raw pydicom Dataset construction | Enormously error-prone. DICOM-SEG IOD has dozens of mandatory attributes, dimension organization sequences, and per-frame functional groups. highdicom abstracts all of this. |

**Installation:**
```bash
cd server && uv add "highdicom>=0.23"
```

**Version verification:** highdicom 0.27.0 is the latest on PyPI (released 2025-10-24). Requires Python >=3.10. Compatible with pydicom 3.0.x already installed in this project.

## Architecture Patterns

### Recommended Project Structure
```
server/
├── api/
│   └── segmentations.py    # Modified: format-aware save_segmentation()
├── loaders/
│   └── dicom_seg_writer.py  # NEW: DICOM-SEG construction helper
├── watcher/
│   └── observer.py          # Modified: suppress list for self-written files
└── ...
```

### Pattern 1: Format-Aware Save Branching
**What:** The `save_segmentation()` endpoint branches based on `_path_registry[volume_id]` format.
**When to use:** At the top of the save handler, after validating volume exists and is loaded.
**Example:**
```python
# In save_segmentation()
from server.api.volumes import _path_registry

path, fmt = _path_registry[volume_id]

if fmt == "dicom_series":
    result = await _save_dicom_seg(volume_id, vol_meta, data_z_y_x, filename)
else:
    result = _save_nifti_seg(volume_id, vol_meta, data_z_y_x, affine, filename)
```

### Pattern 2: RAS+ to DICOM LPS Frame Reversal
**What:** The segmentation array in memory is RAS+-oriented (from `nib.as_closest_canonical`). DICOM-SEG needs frames matching the original DICOM slice order and orientation.
**When to use:** Before constructing the highdicom Segmentation object.

The key insight: during loading, the DICOM loader does:
1. Assembles volume as `(rows, cols, slices)` in DICOM LPS frame
2. Builds an LPS affine, converts to RAS via `lps_to_ras = diag([-1, -1, 1, 1])`
3. Wraps in `nib.Nifti1Image(volume_3d, affine_ras)`
4. Calls `nib.as_closest_canonical()` which may flip/permute axes
5. Transposes to `(Z, Y, X)` for client transfer

For DICOM-SEG, we must reverse steps 5, 4, and 3:
1. Start with client segmentation array `(Z, Y, X)` uint8
2. Transpose back to `(X, Y, Z)` -- canonical RAS shape
3. Determine the inverse of `as_closest_canonical` using `nibabel.io_orientation` on the stored affine
4. Apply inverse permutation/flip to get back to the original DICOM `(rows, cols, slices)` layout
5. Each slice `[:, :, i]` then corresponds to sorted source DICOM dataset `[i]`

**Example:**
```python
import nibabel as nib
import numpy as np

def ras_seg_to_dicom_frames(seg_zyx: np.ndarray, ras_affine: np.ndarray) -> np.ndarray:
    """Convert RAS+ segmentation back to DICOM frame order.
    
    Returns array shaped (n_slices, rows, cols) matching source DICOM sort order.
    """
    # Step 1: undo client transpose (Z,Y,X) -> (X,Y,Z) = canonical RAS shape
    seg_xyz = seg_zyx.transpose(2, 1, 0)
    
    # Step 2: determine what as_closest_canonical did
    # The stored affine IS the canonical (RAS+) affine.
    # We need the original (pre-canonical) orientation.
    # nibabel.io_orientation tells us which axes to flip/permute
    # to go FROM the affine's orientation TO RAS+.
    ornt = nib.io_orientation(ras_affine)
    # ornt maps: original_axis[i] -> (ras_axis, flip)
    # To reverse: apply nib.apply_orientation with the INVERSE
    
    # Wrap seg in a NIfTI image with the RAS affine
    seg_img = nib.Nifti1Image(seg_xyz.astype(np.uint8), ras_affine)
    # The image is already in canonical form.
    # To get original DICOM orientation, we need the original (LPS) affine.
    # But we only stored the canonical affine...
    
    # Alternative approach: since we sorted DICOM slices by position along
    # the slice normal, and as_closest_canonical only permutes/flips axes,
    # the frame order in the canonical volume corresponds to a known axis.
    # For standard axial CT/MR, canonical just flips L->R and P->A,
    # leaving the slice axis (S) unchanged.
    # The frames are already in the correct spatial order.
    
    # Practical approach: use the canonical affine to determine which
    # axis is the "slice" axis (axis with largest component in S direction),
    # then iterate along that axis.
    
    # For the general case, reconstruct original orientation:
    # The DICOM loader built affine_lps, then did lps_to_ras @ affine_lps,
    # then as_closest_canonical. The stored affine = canonical affine.
    # We need to undo canonical to get back to rows x cols x slices.
    
    # Since io_orientation(ras_affine) tells us the current orientation
    # relative to RAS+, and canonical IS RAS+, ornt should be identity-like.
    # The transform from original -> canonical was captured at load time
    # but NOT stored. We need to reconstruct it from the LPS affine.
    
    # BEST APPROACH: store the original LPS affine at load time,
    # OR store the canonical transform. For now, recompute from source DICOMs.
    
    # Since we re-read source DICOMs anyway for highdicom, we can:
    # 1. Sort source DICOMs same way as load_dicom_series
    # 2. Extract rows, cols per slice
    # 3. Map each frame from the RAS volume
    
    # Simplest correct approach: rebuild the LPS affine from source DICOMs,
    # compute the canonical transform, invert it on the seg array.
    pass
```

### Pattern 3: Label Remapping
**What:** Map arbitrary label values (e.g., 0, 1, 5, 12) to contiguous segment numbers (1, 2, 3) for DICOM-SEG, preserving label 0 as background.
**When to use:** Before creating SegmentDescription objects and the pixel_array for highdicom.
**Example:**
```python
def remap_labels(seg_array: np.ndarray, label_names: dict[int, str]) -> tuple[np.ndarray, list[tuple[int, str]]]:
    """Remap arbitrary label values to contiguous 1..N.
    
    Args:
        seg_array: uint8 array with arbitrary label values
        label_names: mapping of original_value -> label_name
        
    Returns:
        (remapped_array, segments) where segments is [(seg_number, label_name), ...]
    """
    unique_labels = sorted(set(np.unique(seg_array)) - {0})  # exclude background
    remapped = np.zeros_like(seg_array)
    segments = []
    
    for new_num, old_val in enumerate(unique_labels, start=1):
        remapped[seg_array == old_val] = new_num
        name = label_names.get(old_val, f"Segment {old_val}")
        segments.append((new_num, name))
    
    return remapped, segments
```

### Pattern 4: Watcher Suppress List
**What:** A thread-safe set of file paths that the watcher should ignore because the save endpoint just wrote them.
**When to use:** Before writing a DICOM-SEG file and in the watcher event handler.
**Example:**
```python
import threading
import time

class WatcherSuppressList:
    """Thread-safe set of paths the watcher should ignore temporarily."""
    
    def __init__(self, ttl: float = 5.0):
        self._paths: dict[str, float] = {}  # path -> expiry timestamp
        self._lock = threading.Lock()
        self._ttl = ttl
    
    def add(self, path: str) -> None:
        with self._lock:
            self._paths[path] = time.monotonic() + self._ttl
    
    def should_suppress(self, path: str) -> bool:
        with self._lock:
            expiry = self._paths.get(path)
            if expiry is None:
                return False
            if time.monotonic() > expiry:
                del self._paths[path]
                return False
            return True
    
    def remove(self, path: str) -> None:
        with self._lock:
            self._paths.pop(path, None)
```

### Anti-Patterns to Avoid
- **Reading all DICOM slices with pixel data for highdicom source_images:** highdicom needs source datasets but only uses metadata (geometry, UIDs). Use `pydicom.dcmread(path, stop_before_pixels=True)` for the source_images list -- this is dramatically faster and uses far less memory. **UPDATE: This may not work.** highdicom documentation says source_images are used for metadata extraction. Test with `stop_before_pixels=True` first; if highdicom complains, fall back to full reads.
- **Sorting source DICOMs by InstanceNumber:** InstanceNumber is not reliable for spatial ordering. Sort by projection of ImagePositionPatient along the slice normal vector, matching the existing `load_dicom_series` sort logic.
- **Passing the RAS+ array directly to highdicom:** The pixel_array frames must correspond 1:1 with the sorted source DICOM datasets. The RAS+ array has been reoriented and may have flipped axes. Must reverse the transform.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DICOM-SEG IOD compliance | Manual Dataset construction | highdicom `Segmentation` | DICOM-SEG has 50+ mandatory attributes, dimension organization, per-frame functional groups. Getting it wrong means the file opens nowhere. |
| Segment descriptions with coded concepts | Manual Sequence/Dataset building | highdicom `SegmentDescription` + `pydicom.sr.codedict.codes` | SNOMED-CT coding is required by the IOD; highdicom validates it. |
| UID generation | Custom UID strings | `highdicom.UID()` | Generates valid DICOM UIDs with proper root. |
| Orientation reversal math | Manual affine inversion | `nibabel.io_orientation` + `nibabel.apply_orientation` | nibabel already handles the axis permutation/flip bookkeeping correctly. |

**Key insight:** DICOM-SEG is one of the most complex DICOM IODs. Even experienced DICOM developers use highdicom or dcmqi rather than hand-rolling. The entire point of choosing highdicom in the project stack was to avoid this complexity.

## Common Pitfalls

### Pitfall 1: Frame-Dataset Misalignment
**What goes wrong:** The segmentation appears shifted or on the wrong slices in external viewers (3D Slicer, OHIF).
**Why it happens:** Source DICOM datasets passed to highdicom are not sorted the same way the volume was assembled during loading. The pixel_array frames don't correspond to the right slices.
**How to avoid:** Reuse the exact same sorting logic from `load_dicom_series()` -- sort by `dot(ImagePositionPatient, slice_normal)`. Extract this as a shared utility function.
**Warning signs:** Segmentation overlay is spatially offset when loaded in 3D Slicer.

### Pitfall 2: RAS+ to LPS Orientation Not Reversed
**What goes wrong:** Segmentation labels appear mirrored or on wrong anatomical sides.
**Why it happens:** The server normalizes all volumes to RAS+ via `nib.as_closest_canonical()`. This can permute and/or flip axes. If the segmentation array is not un-canonicalized before building DICOM-SEG frames, the left-right and anterior-posterior axes may be swapped.
**How to avoid:** Track or recompute the canonical transform. The cleanest approach: when re-reading source DICOM datasets for highdicom, rebuild the LPS affine from DICOM geometry tags, compute what `as_closest_canonical` would do, then apply the inverse to the segmentation array.
**Warning signs:** Labels on the wrong side of the patient, or rotated 90/180 degrees.

### Pitfall 3: highdicom Requires Matching Frame Count
**What goes wrong:** `ValueError` from highdicom about mismatched dimensions.
**Why it happens:** `pixel_array.shape[0]` (number of frames) must equal `len(source_images)`. If any source DICOM files were skipped during loading (missing pixel data, missing geometry), the frame count differs.
**How to avoid:** Use the same file filtering as `load_dicom_series()` -- skip files without `ImagePositionPatient`, `Rows`, `Columns`, `PixelSpacing`. Pass only the filtered+sorted datasets as source_images, and ensure the segmentation frames match.
**Warning signs:** Explicit error from highdicom constructor.

### Pitfall 4: Label 0 Treated as a Segment
**What goes wrong:** DICOM-SEG contains an extra "background" segment with number 0.
**Why it happens:** `np.unique(seg_array)` includes 0. DICOM-SEG segment numbers must start at 1; value 0 means "no segment."
**How to avoid:** Always exclude 0 from the unique label set before creating SegmentDescription objects.
**Warning signs:** Extra unlabeled segment in external viewer.

### Pitfall 5: Watcher Detects Self-Written DICOM-SEG
**What goes wrong:** The watcher picks up the DICOM-SEG file just written by the save endpoint and tries to register it as a new volume, causing duplicate catalog entries or errors.
**Why it happens:** The watcher monitors the same directory where DICOM-SEG files are written. The `.dcm` extension matches `_is_dicom()`.
**How to avoid:** Add the output path to a suppress list before writing, check the suppress list in the watcher event handler, and remove after a short TTL.
**Warning signs:** Duplicate entries in volume list after save, or error logs about failed DICOM series registration.

### Pitfall 6: Empty Segmentation (All Zeros)
**What goes wrong:** highdicom raises error when pixel_array has no non-zero values and `omit_empty_frames=True` (default).
**Why it happens:** User saves an empty segmentation.
**How to avoid:** Check if any non-zero labels exist before attempting DICOM-SEG creation. Return a clear error or skip DICOM-SEG creation for empty segmentations.
**Warning signs:** 500 error on save with empty canvas.

## Code Examples

### Creating a DICOM-SEG with highdicom
```python
# Source: https://highdicom.readthedocs.io/en/latest/seg.html
import highdicom as hd
import numpy as np
import pydicom
from pydicom.sr.codedict import codes

# Load and sort source DICOM datasets
source_datasets = []
for f in dicom_file_paths:
    ds = pydicom.dcmread(f)
    if hasattr(ds, 'ImagePositionPatient') and hasattr(ds, 'Rows'):
        source_datasets.append(ds)

# Sort by slice position (same as load_dicom_series)
orientation = [float(v) for v in source_datasets[0].ImageOrientationPatient]
row_cos = np.array(orientation[:3])
col_cos = np.array(orientation[3:6])
slice_normal = np.cross(row_cos, col_cos)

source_datasets.sort(key=lambda ds: float(
    np.dot([float(v) for v in ds.ImagePositionPatient], slice_normal)
))

# Build segment descriptions (one per unique non-zero label)
descriptions = []
for seg_num, label_name in [(1, "Liver"), (2, "Kidney")]:
    desc = hd.seg.SegmentDescription(
        segment_number=seg_num,
        segment_label=label_name,
        segmented_property_category=codes.SCT.Tissue,
        segmented_property_type=codes.SCT.Tissue,  # generic fallback
        algorithm_type=hd.seg.SegmentAlgorithmTypeValues.MANUAL,
    )
    descriptions.append(desc)

# pixel_array shape: (n_frames, rows, cols) with values 0, 1, 2, ...
# highdicom accepts label-map-style array with BINARY segmentation_type
seg = hd.seg.Segmentation(
    source_images=source_datasets,
    pixel_array=mask_frames,  # (n_slices, rows, cols), uint8
    segmentation_type=hd.seg.SegmentationTypeValues.BINARY,
    segment_descriptions=descriptions,
    series_instance_uid=hd.UID(),
    series_number=100,
    sop_instance_uid=hd.UID(),
    instance_number=1,
    manufacturer='NextEd',
    manufacturer_model_name='NextEd Segmentation Editor',
    software_versions='2.0',
    device_serial_number='NextEd-001',
    series_description=f'Segmentation - {filename}',
)

seg.save_as(output_path)
```

### Reversing RAS+ Canonical Orientation
```python
import nibabel as nib
import numpy as np

def reverse_canonical(seg_xyz: np.ndarray, canonical_affine: np.ndarray,
                      original_lps_affine: np.ndarray) -> np.ndarray:
    """Reverse nibabel's as_closest_canonical transform on a segmentation array.
    
    Args:
        seg_xyz: segmentation in canonical RAS+ shape (X, Y, Z)
        canonical_affine: the RAS+ affine stored at load time
        original_lps_affine: LPS affine rebuilt from source DICOM geometry
    
    Returns:
        Array in original DICOM orientation (rows, cols, slices)
    """
    # Determine what as_closest_canonical would do to the original
    ras_affine = np.diag([-1, -1, 1, 1]) @ original_lps_affine
    ornt_orig = nib.io_orientation(ras_affine)
    ornt_canonical = nib.orientations.axcodes2ornt(('R', 'A', 'S'))
    transform = nib.orientations.ornt_transform(ornt_orig, ornt_canonical)
    
    # Invert: go from canonical back to original
    inv_transform = nib.orientations.ornt_transform(ornt_canonical, ornt_orig)
    
    # Apply inverse to the segmentation
    seg_original = nib.orientations.apply_orientation(seg_xyz, inv_transform)
    return seg_original
```

### Reading Source DICOM Datasets from _path_registry
```python
import json
import pydicom

def load_source_dicom_datasets(volume_id: str) -> list[pydicom.Dataset]:
    """Load source DICOM datasets for a volume from the path registry.
    
    Reads with stop_before_pixels=True for speed -- highdicom only needs
    metadata from source images for DICOM-SEG construction.
    """
    from server.api.volumes import _path_registry
    
    path, fmt = _path_registry[volume_id]
    assert fmt == "dicom_series"
    
    file_list = json.loads(path)
    datasets = []
    for f in file_list:
        try:
            ds = pydicom.dcmread(f, stop_before_pixels=True)
            if hasattr(ds, 'ImagePositionPatient') and hasattr(ds, 'Rows'):
                datasets.append(ds)
        except Exception:
            continue
    
    return datasets
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| pydicom-seg with JSON templates | highdicom `Segmentation` constructor | ~2022 | highdicom is now the standard. pydicom-seg requires dcmqi JSON metadata templates which are cumbersome. highdicom takes Python objects directly. |
| BINARY-only segmentation type | BINARY + LABELMAP types | highdicom 0.24+ | LABELMAP is a newer DICOM supplement (Sup 243). BINARY is more widely supported by viewers (3D Slicer, OHIF). Use BINARY for maximum compatibility. |
| Manual UID/sequence construction | highdicom handles all IOD compliance | Stable since ~2021 | No need to manually build DimensionOrganizationSequence, PerFrameFunctionalGroupsSequence, etc. |

**Deprecated/outdated:**
- pydicom-seg: Still maintained but less widely adopted than highdicom. The JSON template approach is less Pythonic.
- Manual DICOM-SEG construction with pydicom: Never recommended for production.

## Open Questions

1. **stop_before_pixels for source_images**
   - What we know: highdicom docs say source_images are used for metadata. The constructor extracts geometry, UIDs, and other tags from them.
   - What's unclear: Whether highdicom 0.27.0 explicitly requires pixel data attributes on source datasets, or if `stop_before_pixels=True` is sufficient.
   - Recommendation: Try `stop_before_pixels=True` first (much faster for large series). If highdicom raises an error, fall back to full reads. This is a LOW risk -- the fallback is straightforward.

2. **Canonical transform reconstruction**
   - What we know: The stored affine in `_volume_cache` is the canonical (RAS+) affine. The original LPS affine is not stored.
   - What's unclear: Whether we need to rebuild the original LPS affine from source DICOMs, or whether we can use the canonical affine directly with proper axis mapping.
   - Recommendation: Rebuild the LPS affine from source DICOM geometry (using `_build_affine()` from `dicom_loader.py`) since we already re-read the source DICOMs for highdicom. This is the most correct approach.

3. **DICOM-SEG metadata richness (D-07 discretion)**
   - What we know: highdicom requires `segmented_property_category` and `segmented_property_type` as CodedConcept values. `pydicom.sr.codedict.codes.SCT` provides SNOMED-CT codes.
   - What's unclear: Whether generic fallback codes (e.g., `codes.SCT.Tissue` for everything) produce valid files that open in viewers.
   - Recommendation: Use `codes.SCT.Tissue` as the default category and `codes.SCT.Tissue` as the default type for all segments. This is the minimal valid approach. The label name goes in `segment_label` which is a free-text string -- this is where the user's label names appear. Viewers display `segment_label`, not the coded concepts.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| highdicom | DICOM-SEG creation | Not installed | -- | Must install via `uv add` |
| pydicom | Source dataset loading | Installed | 3.0.1 | -- |
| nibabel | NIfTI save + orientation utilities | Installed | 5.4.2 | -- |
| numpy | Array operations | Installed | 2.4.4 | -- |
| Python | Runtime | Installed | 3.12 | -- |

**Missing dependencies with no fallback:**
- highdicom must be installed before implementation. Add to `server/pyproject.toml` and install.

**Missing dependencies with fallback:**
- None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest >=8.0 |
| Config file | server/pyproject.toml (dev dependency) |
| Quick run command | `cd server && python -m pytest tests/ -x -q` |
| Full suite command | `cd server && python -m pytest tests/ -v` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEG-01 | DICOM-SEG file created for DICOM volumes | unit | `cd server && python -m pytest tests/test_dicom_seg_writer.py -x` | Wave 0 |
| SEG-02 | NIfTI save unchanged for NIfTI volumes | unit | `cd server && python -m pytest tests/test_save_segmentation.py::test_nifti_save -x` | Wave 0 |
| SEG-03 | Format auto-selected by parent volume format | unit | `cd server && python -m pytest tests/test_save_segmentation.py::test_format_selection -x` | Wave 0 |
| SEG-04 | Labels remapped to contiguous 1..N | unit | `cd server && python -m pytest tests/test_dicom_seg_writer.py::test_label_remapping -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd server && python -m pytest tests/ -x -q`
- **Per wave merge:** `cd server && python -m pytest tests/ -v`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/tests/test_dicom_seg_writer.py` -- covers SEG-01, SEG-04 (DICOM-SEG creation, label remapping)
- [ ] `server/tests/test_save_segmentation.py` -- covers SEG-02, SEG-03 (format branching, NIfTI path preserved)
- [ ] `server/tests/test_watcher_suppress.py` -- covers D-08 (suppress list prevents duplicate detection)

## Sources

### Primary (HIGH confidence)
- [highdicom 0.27.0 SEG documentation](https://highdicom.readthedocs.io/en/latest/seg.html) - Segmentation constructor API, SegmentDescription, segmentation types, pixel_array shapes
- [highdicom quickstart](https://highdicom.readthedocs.io/en/latest/quickstart.html) - Complete creation example
- [highdicom PyPI](https://pypi.org/project/highdicom/) - Version 0.27.0, Python >=3.10

### Secondary (MEDIUM confidence)
- [Medium step-by-step guide](https://medium.com/@zain.18j2000/step-by-step-guide-convert-your-segmentation-mask-to-dicom-seg-standard-in-medical-imaging-1378e9b951aa) - Practical creation workflow, sorting requirement, verified against official docs
- [3D Slicer DICOM-SEG interop discussion](https://discourse.slicer.org/t/saving-dicomsegmentations-interoperability-with-ohif/29037) - Compatibility concerns between viewers
- Existing codebase: `server/loaders/dicom_loader.py`, `server/api/segmentations.py`, `server/api/volumes.py` -- current implementation patterns

### Tertiary (LOW confidence)
- `stop_before_pixels=True` for source_images: Not verified in official docs whether highdicom requires pixel data on source datasets. Needs runtime validation.

## Project Constraints (from CLAUDE.md)

- **Package management:** Use `uv` (not pip) for all Python dependency management
- **Tech stack:** Python with FastAPI for server, Vanilla JS for client
- **No frameworks on client side:** No React/Vue/Svelte
- **GSD Workflow:** All changes through GSD commands

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - highdicom is the project's chosen library, well-documented, verified on PyPI
- Architecture: HIGH - save endpoint branching is straightforward; watcher suppress is a simple pattern
- RAS-to-LPS transform: MEDIUM - the approach is sound but implementation details need runtime validation
- Pitfalls: HIGH - frame alignment and orientation issues are well-documented in the DICOM-SEG community

**Research date:** 2026-04-06
**Valid until:** 2026-05-06 (30 days - stable domain, highdicom releases are infrequent)

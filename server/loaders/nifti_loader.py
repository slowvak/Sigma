"""NIfTI volume loader with RAS+ normalization and auto-windowing."""

from __future__ import annotations

from pathlib import Path

import nibabel as nib
import numpy as np


def compute_auto_window(data: np.ndarray) -> tuple[float, float]:
    """Compute window center and width robustly for medical images.

    If data range matches CT Hounsfield Units (d_min < -50, d_max > 0),
    defaults to standard soft-tissue window (center=40, width=400).
    Otherwise, uses the 1st–99th percentile of foreground voxels so that
    98% of signal values are visible with full contrast. This handles MRI
    and other modalities where the data range can vary widely.
    """
    d_min = float(np.min(data))
    d_max = float(np.max(data))

    # Heuristic for CT scans in Hounsfield Units.
    # Brain-only CT has d_min around -80 to -150 HU (scalp/orbital fat).
    if d_min < -50 and d_max > 0:
        return 40.0, 400.0  # Standard soft-tissue window

    # Non-CT path: use percentile-based windowing of foreground voxels.
    # Foreground = voxels above the background level.
    if d_min < 0:
        foreground = data[data > d_min]
    else:
        foreground = data[data > 0]

    if foreground.size == 0:
        return float(d_max / 2), float(max(d_max, 1.0))

    p01 = float(np.percentile(foreground, 1))
    p99 = float(np.percentile(foreground, 99))
    window_center = (p01 + p99) / 2
    window_width = max(p99 - p01, 1.0)
    return window_center, window_width


def load_nifti_volume(filepath: str | Path) -> tuple[np.ndarray, dict]:
    """Load a NIfTI volume, normalize to RAS+ canonical orientation.

    Returns:
        tuple of (data, metadata) where:
        - data: C-contiguous float32 numpy array in RAS+ orientation
        - metadata: dict with dimensions, voxel_spacing, dtype,
          window_center, window_width
    """
    img = nib.load(str(filepath))

    # Reorient to RAS+ canonical orientation
    canonical = nib.as_closest_canonical(img)

    # Extract data as float32, then transpose to (Z, Y, X) so that when
    # serialized in C order, X varies fastest: index = x + y*dimX + z*dimX*dimY
    # This matches the client's slice extractor indexing convention.
    raw = canonical.get_fdata(dtype=np.float32)
    data = np.ascontiguousarray(raw.transpose(2, 1, 0))

    # Voxel spacing in RAS+ axis order (from canonical header)
    spacing = [float(s) for s in canonical.header.get_zooms()[:3]]

    # Infer modality heuristically from value range.
    # NIfTI headers rarely contain modality. CT data stored in Hounsfield Units
    # always contains negative values (air ~-1000, fat ~-100 for scalp fat in
    # brain-only scans). Brain CT without neck/lung fields has d_min around
    # -80 to -150 HU (scalp fat, orbital fat).  Use d_min < -50 as a
    # permissive CT sentinel — standard MRI data is virtually always
    # non-negative (signal intensity starts at 0).
    d_min = float(np.min(data))
    d_max = float(np.max(data))
    modality = "CT" if d_min < -50 and d_max > 0 else "unknown"
    print(f"[nifti_loader] {filepath}: d_min={d_min:.1f}, d_max={d_max:.1f}, modality={modality}")

    # Always use auto-windowing based on actual voxel data.
    # The NIfTI cal_min/cal_max header fields are unreliable — they often
    # contain normalized display ranges (e.g. [0,1], [1,3]) that bear no
    # useful relationship to the actual HU or signal intensity values in data.
    # Trusting them produces nonsensical initial windows (e.g. width=1, level=2).
    window_center, window_width = compute_auto_window(data)

    metadata = {
        "dimensions": [int(d) for d in canonical.shape[:3]],
        "voxel_spacing": spacing,
        "dtype": "float32",
        "modality": modality,
        "window_center": window_center,
        "window_width": window_width,
        "data_min": d_min,
        "data_max": d_max,
        "affine": canonical.affine,
    }

    return data, metadata


def load_nifti_segmentation(filepath: str | Path) -> tuple[np.ndarray, dict]:
    """Load a NIfTI segmentation, canonicalize, and extract uint8 data.
    
    Returns:
        tuple of (data, metadata) where:
        - data: C-contiguous uint8 numpy array in RAS+ orientation
        - metadata: dict with dimensions
    """
    img = nib.load(str(filepath))
    canonical = nib.as_closest_canonical(img)
    raw = canonical.get_fdata()
    data = np.ascontiguousarray(raw.astype(np.uint8).transpose(2, 1, 0))
    metadata = {
        "dimensions": [int(d) for d in canonical.shape[:3]],
    }
    return data, metadata

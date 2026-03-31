"""DICOM volume loader with series grouping, RAS+ normalization, and auto-windowing."""

from __future__ import annotations

from pathlib import Path

import nibabel as nib
import numpy as np
import pydicom

from server.loaders.nifti_loader import compute_auto_window


def _build_affine(
    orientation: list[float],
    position: list[float],
    pixel_spacing: list[float],
    slice_positions: list[float],
    n_slices: int,
) -> np.ndarray:
    """Build a 4x4 affine matrix from DICOM geometry tags."""
    row_cosine = np.array(orientation[:3])
    col_cosine = np.array(orientation[3:6])
    slice_cosine = np.cross(row_cosine, col_cosine)

    if n_slices > 1 and len(slice_positions) > 1:
        slice_spacing = abs(slice_positions[1] - slice_positions[0])
    else:
        slice_spacing = 1.0

    # Build affine in DICOM LPS coordinates.
    # pixel_array is (rows, cols). Axis 0 = row index (vertical), axis 1 = col index (horizontal).
    # Moving along axis 0 (down rows) follows the column cosine direction, spaced by PixelSpacing[0].
    # Moving along axis 1 (across cols) follows the row cosine direction, spaced by PixelSpacing[1].
    affine_lps = np.eye(4)
    affine_lps[:3, 0] = col_cosine * pixel_spacing[0]   # axis 0: row index → column direction
    affine_lps[:3, 1] = row_cosine * pixel_spacing[1]   # axis 1: col index → row direction
    affine_lps[:3, 2] = slice_cosine * slice_spacing
    affine_lps[:3, 3] = position

    # Convert DICOM LPS to NIfTI RAS by negating X and Y rows
    # (Right = -Left, Anterior = -Posterior, Superior = Superior)
    lps_to_ras = np.diag([-1.0, -1.0, 1.0, 1.0])
    return lps_to_ras @ affine_lps


def discover_dicom_series(root: Path) -> list[dict]:
    """Scan a directory tree for DICOM files and group by SeriesInstanceUID.

    Reads only headers (no pixel data) for speed. Returns a list of series
    info dicts, each containing:
      - series_uid: SeriesInstanceUID
      - name: "StudyDescription - SeriesDescription"
      - files: list of file paths belonging to this series
      - modality: DICOM Modality tag
      - dimensions: [cols, rows, n_slices] (approximate)
      - voxel_spacing: [col_sp, row_sp, slice_sp_est]

    Series with any dimension < 5 are excluded.
    """
    # Collect all candidate DICOM files
    candidates = []
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.name.startswith("."):
            continue
        if p.suffix.lower() in [".nii", ".gz", ".json", ".csv", ".txt", ".md", ".py"]:
            continue
        candidates.append(p)

    # Group files by SeriesInstanceUID using header-only reads
    series_map: dict[str, dict] = {}  # uid -> series info

    for f in candidates:
        try:
            ds = pydicom.dcmread(str(f), stop_before_pixels=True)
        except Exception:
            continue

        uid = str(getattr(ds, "SeriesInstanceUID", "")).strip()
        if not uid:
            continue

        # Must have spatial attributes to be a positionable image
        if not hasattr(ds, "ImagePositionPatient"):
            continue
        if not hasattr(ds, "Rows") or not hasattr(ds, "Columns"):
            continue

        if uid not in series_map:
            study_uid = str(getattr(ds, "StudyInstanceUID", "")).strip()
            study_desc = str(getattr(ds, "StudyDescription", "")).strip()
            series_desc = str(getattr(ds, "SeriesDescription", "")).strip()
            if study_desc and series_desc:
                name = f"{study_desc} - {series_desc}"
            elif series_desc:
                name = series_desc
            elif study_desc:
                name = study_desc
            else:
                name = uid[:16]

            modality = str(getattr(ds, "Modality", "unknown")).strip() or "unknown"
            rows = int(getattr(ds, "Rows", 0))
            cols = int(getattr(ds, "Columns", 0))
            spacing = ([float(v) for v in ds.PixelSpacing]
                       if hasattr(ds, "PixelSpacing") else [1.0, 1.0])

            series_map[uid] = {
                "series_uid": uid,
                "study_uid": study_uid,
                "name": name,
                "files": [],
                "modality": modality,
                "rows": rows,
                "cols": cols,
                "voxel_spacing": spacing,
            }

        series_map[uid]["files"].append(str(f))

    # Convert to list, compute dimensions, filter small series
    result = []
    for info in series_map.values():
        n_slices = len(info["files"])
        rows = info["rows"]
        cols = info["cols"]

        # Skip series with any dimension < 5 (scouts, localizers, dose reports)
        if cols < 5 or rows < 5 or n_slices < 5:
            continue

        info["dimensions"] = [cols, rows, n_slices]
        info["voxel_spacing"] = info["voxel_spacing"] + [1.0]  # estimate z spacing
        result.append(info)

    return result


def load_dicom_series(file_paths: list[str]) -> tuple[np.ndarray, dict]:
    """Load a DICOM series from an explicit list of file paths.

    Reads pixel data, sorts by ImagePositionPatient, assembles into a 3D
    volume, then normalizes to RAS+ using nibabel.

    Returns:
        tuple of (data, metadata)
    """
    # Read all slices with pixel data and spatial position
    slices = []
    skipped = 0
    for f in file_paths:
        try:
            ds = pydicom.dcmread(str(f))
            if not hasattr(ds, "pixel_array"):
                skipped += 1
                continue
            if not hasattr(ds, "ImagePositionPatient"):
                skipped += 1
                continue
            if not hasattr(ds, "ImageOrientationPatient"):
                skipped += 1
                continue
            if not hasattr(ds, "PixelSpacing"):
                skipped += 1
                continue
            slices.append(ds)
        except Exception:
            skipped += 1
            continue

    if skipped:
        print(f"[dicom_loader] skipped {skipped} file(s) without required attributes")

    if not slices:
        raise ValueError("No valid DICOM slices with pixel data and spatial attributes")

    # Extract orientation from any slice (they should be identical in a series)
    first_unsorted = slices[0]
    orientation = [float(v) for v in first_unsorted.ImageOrientationPatient]
    
    # Compute the normal vector (slice direction) using the cross product
    row_cosine = np.array(orientation[:3])
    col_cosine = np.array(orientation[3:6])
    slice_cosine = np.cross(row_cosine, col_cosine)

    def get_slice_pos(s) -> float:
        pos = np.array([float(v) for v in s.ImagePositionPatient])
        return float(np.dot(pos, slice_cosine))

    # Sort slices by their physical projection along the slice normal
    slices.sort(key=get_slice_pos)

    # Re-extract geometry from the true first slice
    first = slices[0]
    position = [float(v) for v in first.ImagePositionPatient]
    pixel_spacing = [float(v) for v in first.PixelSpacing]

    # Collect slice positions for affine computation
    slice_positions = [get_slice_pos(s) for s in slices]

    # Assemble 3D volume (rows x cols x slices)
    rows, cols = first.Rows, first.Columns
    volume_3d = np.zeros((rows, cols, len(slices)), dtype=np.float32)
    for i, s in enumerate(slices):
        arr = s.pixel_array.astype(np.float32)
        slope = float(getattr(s, "RescaleSlope", 1.0))
        intercept = float(getattr(s, "RescaleIntercept", 0.0))
        arr = arr * slope + intercept
        volume_3d[:, :, i] = arr

    # Build affine from DICOM geometry
    affine = _build_affine(
        orientation, position, pixel_spacing, slice_positions, len(slices)
    )

    # Wrap in nibabel NIfTI image for RAS+ normalization
    nii_img = nib.Nifti1Image(volume_3d, affine)
    canonical = nib.as_closest_canonical(nii_img)

    raw = canonical.get_fdata(dtype=np.float32)
    data = np.ascontiguousarray(raw.transpose(2, 1, 0))

    spacing = [float(s) for s in canonical.header.get_zooms()[:3]]

    # Try using DICOM Window/Level
    window_center, window_width = None, None
    if hasattr(first, "WindowCenter") and hasattr(first, "WindowWidth"):
        wc_val = first.WindowCenter
        ww_val = first.WindowWidth

        if isinstance(wc_val, pydicom.multival.MultiValue):
            wc_val = wc_val[0]
        if isinstance(ww_val, pydicom.multival.MultiValue):
            ww_val = ww_val[0]

        try:
            window_center = float(wc_val)
            window_width = float(ww_val)
        except Exception:
            pass

    if window_center is None or window_width is None:
        window_center, window_width = compute_auto_window(data)

    modality = str(getattr(first, "Modality", "unknown")).strip() or "unknown"

    # Build descriptive name from DICOM tags
    study_desc = str(getattr(first, "StudyDescription", "")).strip()
    series_desc = str(getattr(first, "SeriesDescription", "")).strip()
    if study_desc and series_desc:
        name = f"{study_desc} - {series_desc}"
    elif series_desc:
        name = series_desc
    elif study_desc:
        name = study_desc
    else:
        name = "DICOM Series"

    d_min = float(np.min(data))
    d_max = float(np.max(data))

    metadata = {
        "name": name,
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


# Backward compat — old code called load_dicom_volume(folder)
def load_dicom_volume(folder: str | Path) -> tuple[np.ndarray, dict]:
    """Load a DICOM series from a folder (legacy interface).

    Discovers all valid files in the folder and delegates to load_dicom_series.
    """
    folder = Path(folder)
    dcm_files = sorted(folder.glob("*.dcm"))
    if not dcm_files:
        dcm_files = [
            f for f in sorted(folder.iterdir())
            if f.is_file() and not f.name.startswith(".")
        ]
    if not dcm_files:
        raise FileNotFoundError(f"No DICOM files found in {folder}")

    return load_dicom_series([str(f) for f in dcm_files])

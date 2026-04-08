"""Volume API endpoints for metadata and binary data serving."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from server.catalog.models import VolumeMetadata
from server.loaders.nifti_loader import load_nifti_volume

router = APIRouter(prefix="/api/v1/volumes", tags=["volumes"])

# In-memory volume cache: volume_id -> (data_array, loader_metadata)
# Populated lazily when a volume is first opened.
_volume_cache: dict[str, tuple] = {}

# Metadata-only registry: volume_id -> VolumeMetadata
# Populated at startup from cache or full scan. No pixel data needed.
_metadata_registry: dict[str, VolumeMetadata] = {}

# Path+format registry for lazy loading: volume_id -> (path, format)
_path_registry: dict[str, tuple[str, str]] = {}


def register_volume(vol_id: str, meta: VolumeMetadata, path: str, fmt: str):
    """Register volume metadata without loading pixel data."""
    _metadata_registry[vol_id] = meta
    _path_registry[vol_id] = (path, fmt)


def unregister_volume(vol_id: str):
    """Remove a volume from all registries."""
    _metadata_registry.pop(vol_id, None)
    _path_registry.pop(vol_id, None)
    _volume_cache.pop(vol_id, None)


def _ensure_loaded(volume_id: str):
    """Load volume pixel data into cache if not already present."""
    if volume_id in _volume_cache:
        return
    if volume_id not in _path_registry:
        raise HTTPException(status_code=404, detail=f"Volume {volume_id} not found")

    path, fmt = _path_registry[volume_id]
    filepath = Path(path)
    if fmt != "dicom_series" and not filepath.exists():
        raise HTTPException(status_code=404, detail=f"Volume file not found: {path}")

    if fmt == "nifti":
        data, metadata = load_nifti_volume(filepath)
    elif fmt == "dicom_series":
        from server.loaders.dicom_loader import load_dicom_series
        file_list = json.loads(path)
        data, metadata = load_dicom_series(file_list)
    else:
        from server.loaders.dicom_loader import load_dicom_volume
        data, metadata = load_dicom_volume(filepath)

    # Update metadata registry with full loader metadata (may have more accurate values)
    old_meta = _metadata_registry[volume_id]
    updated = old_meta.model_copy(update={
        "dimensions": metadata["dimensions"],
        "voxel_spacing": metadata["voxel_spacing"],
        "dtype": metadata["dtype"],
        "modality": metadata.get("modality", old_meta.modality),
        "window_center": metadata["window_center"],
        "window_width": metadata["window_width"],
        "data_min": metadata.get("data_min"),
        "data_max": metadata.get("data_max"),
    })
    _metadata_registry[volume_id] = updated
    _volume_cache[volume_id] = (data, metadata)


@router.get("/{volume_id}/metadata", response_model=VolumeMetadata)
async def get_volume_metadata(volume_id: str) -> VolumeMetadata:
    """Return volume metadata including spacing and auto-window values.

    If the volume hasn't been fully loaded yet, loads it now to get
    accurate metadata (dimensions, window values, data range).
    """
    if volume_id not in _metadata_registry:
        raise HTTPException(status_code=404, detail=f"Volume {volume_id} not found")

    # Ensure full load so metadata has accurate window/data_min/max values
    _ensure_loaded(volume_id)
    return _metadata_registry[volume_id]


@router.get("/{volume_id}/nifti")
async def get_volume_as_nifti(volume_id: str) -> Response:
    """Return volume as NIfTI file bytes for download.

    For NIfTI source volumes, returns the raw file bytes directly.
    For DICOM source volumes, converts to NIfTI using nibabel and returns the bytes.
    """
    if volume_id not in _metadata_registry:
        raise HTTPException(status_code=404, detail=f"Volume {volume_id} not found")

    _ensure_loaded(volume_id)

    data, _loader_metadata = _volume_cache[volume_id]
    path, fmt = _path_registry[volume_id]

    import gzip
    import os
    import tempfile

    import nibabel as nib
    import numpy as np

    if fmt == "nifti":
        src = Path(path)
        if src.suffix == ".gz":
            file_bytes = src.read_bytes()
            filename = src.name
        else:
            # Compress .nii → .nii.gz on the fly
            file_bytes = gzip.compress(src.read_bytes())
            filename = src.name + ".gz"
    else:
        meta = _metadata_registry[volume_id]
        affine = np.diag([*meta.voxel_spacing, 1.0])
        img = nib.Nifti1Image(data.astype(np.float32), affine)

        with tempfile.NamedTemporaryFile(suffix=".nii.gz", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            nib.save(img, tmp_path)
            with open(tmp_path, "rb") as f:
                file_bytes = f.read()
        finally:
            os.unlink(tmp_path)

        filename = f"{meta.name}.nii.gz"

    return Response(
        content=file_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{volume_id}/data")
async def get_volume_data(volume_id: str) -> Response:
    """Return volume binary data as C-contiguous float32 bytes.

    Custom headers provide volume geometry for client-side parsing:
    - X-Volume-Dimensions: comma-separated dimension sizes
    - X-Voxel-Spacing: comma-separated spacing in RAS+ order
    - X-Window-Center: auto-windowing center value
    - X-Window-Width: auto-windowing width value
    """
    _ensure_loaded(volume_id)

    data, metadata = _volume_cache[volume_id]
    dims = metadata["dimensions"]
    spacing = metadata["voxel_spacing"]

    headers = {
        "X-Volume-Dimensions": ",".join(str(d) for d in dims),
        "X-Voxel-Spacing": ",".join(f"{s:.6f}" for s in spacing),
        "X-Window-Center": f"{metadata['window_center']:.2f}",
        "X-Window-Width": f"{metadata['window_width']:.2f}",
    }

    return Response(
        content=data.tobytes(),
        media_type="application/octet-stream",
        headers=headers,
    )


# Keep backward compat for code that uses this function directly
def load_and_cache_volume(
    volume_id: str, path: str, format: str = "nifti"
) -> VolumeMetadata:
    """Load a volume from disk, cache it, and return metadata.

    This eagerly loads the volume. Prefer register_volume() + lazy loading
    for faster startup.
    """
    filepath = Path(path)
    if not filepath.exists():
        raise FileNotFoundError(f"Volume file not found: {path}")

    if format == "nifti":
        data, metadata = load_nifti_volume(filepath)
    else:
        from server.loaders.dicom_loader import load_dicom_volume
        data, metadata = load_dicom_volume(filepath)

    vol_meta = VolumeMetadata(
        id=volume_id,
        name=filepath.stem,
        path=str(filepath),
        format=format,
        dimensions=metadata["dimensions"],
        voxel_spacing=metadata["voxel_spacing"],
        dtype=metadata["dtype"],
        modality=metadata.get("modality", "unknown"),
        window_center=metadata["window_center"],
        window_width=metadata["window_width"],
        data_min=metadata.get("data_min"),
        data_max=metadata.get("data_max"),
    )

    _volume_cache[volume_id] = (data, metadata)
    _metadata_registry[volume_id] = vol_meta
    _path_registry[volume_id] = (path, format)
    return vol_meta

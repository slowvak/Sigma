"""Volume API endpoints for metadata and binary data serving."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from server.catalog.models import VolumeMetadata
from server.loaders.nifti_loader import load_nifti_volume

router = APIRouter(prefix="/api/volumes", tags=["volumes"])

# In-memory volume cache (simple dict for now)
_volume_cache: dict[str, tuple] = {}


@router.get("/{volume_id}/metadata", response_model=VolumeMetadata)
async def get_volume_metadata(volume_id: str) -> VolumeMetadata:
    """Return volume metadata including spacing and auto-window values.

    Loads the volume if not already cached, extracts metadata with
    RAS+ normalized voxel_spacing, window_center, and window_width.
    """
    # For now, volume_id is treated as a path-safe identifier
    # A catalog layer would resolve id -> path in a full implementation
    if volume_id not in _volume_cache:
        raise HTTPException(status_code=404, detail=f"Volume {volume_id} not found")

    _, metadata, vol_meta = _volume_cache[volume_id]
    return vol_meta


@router.get("/{volume_id}/data")
async def get_volume_data(volume_id: str) -> Response:
    """Return volume binary data as C-contiguous float32 bytes.

    Custom headers provide volume geometry for client-side parsing:
    - X-Volume-Dimensions: comma-separated dimension sizes
    - X-Voxel-Spacing: comma-separated spacing in RAS+ order
    - X-Window-Center: auto-windowing center value
    - X-Window-Width: auto-windowing width value
    """
    if volume_id not in _volume_cache:
        raise HTTPException(status_code=404, detail=f"Volume {volume_id} not found")

    data, metadata, _ = _volume_cache[volume_id]

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


def load_and_cache_volume(
    volume_id: str, path: str, format: str = "nifti"
) -> VolumeMetadata:
    """Load a volume from disk, cache it, and return metadata.

    This function is called by the catalog/browser layer when a user
    opens a volume. It handles loading, RAS+ normalization, and caching.
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
    )

    _volume_cache[volume_id] = (data, metadata, vol_meta)
    return vol_meta

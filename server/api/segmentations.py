"""Segmentation API endpoints for metadata and binary data serving."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from server.catalog.models import SegmentationMetadata
from server.loaders.nifti_loader import load_nifti_segmentation

router = APIRouter(prefix="/api", tags=["segmentations"])

# In-memory segmentation cache (seg_id -> (data, metadata))
_seg_data_cache: dict[str, tuple] = {}


@router.get("/volumes/{volume_id}/segmentations", response_model=list[SegmentationMetadata])
async def list_segmentations(volume_id: str) -> list[SegmentationMetadata]:
    """Return a list of companion segmentations for the given volume."""
    from server.main import _segmentation_catalog
    
    if volume_id not in _segmentation_catalog:
        raise HTTPException(status_code=404, detail=f"Volume {volume_id} not found")
        
    return _segmentation_catalog[volume_id]


@router.get("/segmentations/{seg_id}/data")
async def get_segmentation_data(seg_id: str) -> Response:
    """Return segmentation binary data as C-contiguous uint8 bytes.

    Custom headers provide volume geometry for client-side parsing:
    - X-Volume-Dimensions: comma-separated dimension sizes
    """
    from server.main import _segmentation_catalog

    if seg_id not in _seg_data_cache:
        # Resolve seg_id to path
        seg_meta: SegmentationMetadata | None = None
        for vol_segs in _segmentation_catalog.values():
            for seg in vol_segs:
                if seg.id == seg_id:
                    seg_meta = seg
                    break
            if seg_meta:
                break
                
        if not seg_meta:
            raise HTTPException(status_code=404, detail=f"Segmentation {seg_id} not found")
            
        try:
            data, metadata = load_nifti_segmentation(seg_meta.path)
            _seg_data_cache[seg_id] = (data, metadata)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to load segmentation: {e}")

    data, metadata = _seg_data_cache[seg_id]
    dims = metadata["dimensions"]

    headers = {
        "X-Volume-Dimensions": ",".join(str(d) for d in dims),
    }

    return Response(
        content=data.tobytes(),
        media_type="application/octet-stream",
        headers=headers,
    )

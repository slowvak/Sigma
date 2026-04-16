"""Segmentation API endpoints for metadata and binary data serving."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

import numpy as np
import nibabel as nib

from server.catalog.models import SegmentationMetadata
from server.loaders.nifti_loader import load_nifti_segmentation
from server.loaders.dicom_seg_writer import build_dicom_seg
from server.api.ws import manager

router = APIRouter(prefix="/api/v1", tags=["segmentations"])

# In-memory segmentation cache (seg_id -> (data, metadata))
_seg_data_cache: dict[str, tuple] = {}


def _save_nifti_seg(vol_meta, data_z_y_x: np.ndarray, affine: np.ndarray, filename: str) -> Path:
    """Save segmentation as NIfTI file (unchanged from v1.0, per D-02)."""
    transposed_array = data_z_y_x.transpose(2, 1, 0)
    new_img = nib.Nifti1Image(transposed_array, affine)
    new_img.set_data_dtype(np.uint8)
    out_path = Path(vol_meta.path).parent / filename
    nib.save(new_img, out_path)
    return out_path


def _save_dicom_seg(volume_id, vol_meta, data_z_y_x: np.ndarray, affine: np.ndarray,
                    path_entry: str, filename: str, suppress_list) -> Path:
    """Save segmentation as DICOM-SEG file (per D-03, D-05, D-06, D-09)."""
    from server.main import _segmentation_catalog

    file_list = json.loads(path_entry)

    # Gather label names from segmentation catalog if available
    label_names: dict[int, str] = {}
    existing_segs = _segmentation_catalog.get(volume_id, [])
    for seg in existing_segs:
        for lb in seg.labels:
            if isinstance(lb, dict) and "value" in lb:
                label_names[lb["value"]] = lb.get("name", f"Segment {lb['value']}")

    seg_dcm, segments = build_dicom_seg(
        seg_zyx=data_z_y_x,
        canonical_affine=affine,
        dicom_file_paths=file_list,
        label_names=label_names,
        filename=filename,
    )

    # Output to same directory as source DICOM series (per D-03)
    series_dir = Path(file_list[0]).parent
    # Ensure .dcm extension (per D-09)
    seg_filename = filename if filename.endswith('.dcm') else f"{filename}.dcm"
    out_path = series_dir / seg_filename

    # Add to suppress list BEFORE writing (per D-08)
    suppress_list.add(str(out_path))

    seg_dcm.save_as(str(out_path))
    return out_path


@router.get("/volumes/{volume_id}/segmentations", response_model=list[SegmentationMetadata])
async def list_segmentations(volume_id: str) -> list[SegmentationMetadata]:
    """Return a list of companion segmentations for the given volume."""
    from server.main import _segmentation_catalog

    if volume_id not in _segmentation_catalog:
        raise HTTPException(status_code=404, detail=f"Volume {volume_id} not found")

    return _segmentation_catalog[volume_id]


@router.post("/volumes/{volume_id}/segmentations")
async def save_segmentation(volume_id: str, request: Request, filename: str) -> dict:
    """Save binary segmentation data, auto-selecting format based on volume type.

    DICOM volumes produce DICOM-SEG (.dcm); NIfTI volumes produce NIfTI (.nii.gz).
    Format is selected automatically -- the client does not choose (per D-01).
    """
    from server.main import _segmentation_catalog, suppress_list
    from server.api.volumes import _volume_cache, _path_registry, _metadata_registry

    vol_meta = _metadata_registry.get(volume_id)
    if not vol_meta:
        raise HTTPException(status_code=404, detail=f"Volume {volume_id} not found")

    if volume_id not in _volume_cache:
        raise HTTPException(status_code=400, detail=f"Volume {volume_id} must be loaded before saving segmentation")

    _, metadata, *_ = _volume_cache[volume_id]
    affine = metadata.get("affine", np.eye(4))

    body = await request.body()

    try:
        dimX, dimY, dimZ = vol_meta.dimensions
        data_z_y_x = np.frombuffer(body, dtype=np.uint8).reshape((dimZ, dimY, dimX))

        # Determine format from path registry (per D-01, D-03)
        path_entry, fmt = _path_registry.get(volume_id, (vol_meta.path, vol_meta.format))

        if fmt == "dicom_series":
            out_path = _save_dicom_seg(
                volume_id, vol_meta, data_z_y_x, affine,
                path_entry, filename, suppress_list
            )
        else:
            out_path = _save_nifti_seg(vol_meta, data_z_y_x, affine, filename)

        # Update segmentation catalog
        seg_id = f"seg_{volume_id}_{filename}"
        if volume_id not in _segmentation_catalog:
            _segmentation_catalog[volume_id] = []
        existing = next((s for s in _segmentation_catalog[volume_id] if s.name == filename), None)
        if not existing:
            _segmentation_catalog[volume_id].append(SegmentationMetadata(
                id=seg_id,
                name=filename,
                path=str(out_path),
                volume_id=volume_id,
                dimensions=list(vol_meta.dimensions),
                labels=[]
            ))

        # Broadcast segmentation_added event (per D-08)
        await manager.broadcast({
            "type": "segmentation_added",
            "data": {"volume_id": volume_id, "filename": filename, "path": str(out_path)}
        })

        return {"status": "success", "filename": filename, "path": str(out_path)}

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to save segmentation: {e}")


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

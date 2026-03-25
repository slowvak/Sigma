"""Data models for volume catalog entries."""

from __future__ import annotations

from pydantic import BaseModel


class VolumeMetadata(BaseModel):
    """Metadata for a cataloged volume."""

    id: str
    name: str
    path: str
    format: str  # "nifti" or "dicom"
    dimensions: list[int] | None = None
    voxel_spacing: list[float] | None = None
    dtype: str | None = None
    modality: str | None = None
    window_center: float | None = None
    window_width: float | None = None

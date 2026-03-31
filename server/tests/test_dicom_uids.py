"""Tests for DICOM UID fields (API-02, API-03)."""
import pytest
from server.catalog.models import VolumeMetadata


def test_volume_metadata_uid_fields_optional():
    """VolumeMetadata accepts study/series UID fields defaulting to None."""
    meta = VolumeMetadata(id="1", name="test", path="/tmp/test", format="nifti")
    assert meta.study_instance_uid is None
    assert meta.series_instance_uid is None


def test_volume_metadata_uid_fields_populated():
    """VolumeMetadata accepts explicit study/series UID values."""
    meta = VolumeMetadata(
        id="1", name="test", path="/tmp/test", format="dicom_series",
        study_instance_uid="1.2.3.4",
        series_instance_uid="1.2.3.4.5",
    )
    assert meta.study_instance_uid == "1.2.3.4"
    assert meta.series_instance_uid == "1.2.3.4.5"


def test_volume_metadata_serialization_includes_uids():
    """model_dump() includes UID fields."""
    meta = VolumeMetadata(
        id="1", name="test", path="/tmp/test", format="dicom_series",
        study_instance_uid="1.2.3.4",
        series_instance_uid="1.2.3.4.5",
    )
    d = meta.model_dump()
    assert "study_instance_uid" in d
    assert d["study_instance_uid"] == "1.2.3.4"
    assert "series_instance_uid" in d
    assert d["series_instance_uid"] == "1.2.3.4.5"


def test_volume_metadata_from_cache_missing_uids():
    """Loading from dict without UID fields (old cache) defaults to None."""
    data = {"id": "0", "name": "test", "path": "/tmp/t", "format": "nifti"}
    meta = VolumeMetadata(**data)
    assert meta.study_instance_uid is None
    assert meta.series_instance_uid is None

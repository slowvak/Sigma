"""Tests for WADO-RS endpoints (WADO-01, WADO-02).

WADO-01: Series retrieve returns multipart/related with DICOM file bytes.
WADO-02: Series metadata returns PS3.18 JSON with BulkDataURI.
"""

import json
import tempfile
from pathlib import Path

import numpy as np
import pydicom
import pytest
from pydicom.uid import ExplicitVRLittleEndian

from fastapi.testclient import TestClient
from server.main import app
from server.api.volumes import _metadata_registry, _path_registry, register_volume
from server.catalog.models import VolumeMetadata

client = TestClient(app)

STUDY_UID = "1.2.3.4.5.6.7.8.9.0"
SERIES_UID = "1.2.3.4.5.6.7.8.9.1"
SOP_UID_1 = "1.2.3.4.5.6.7.8.9.10"
SOP_UID_2 = "1.2.3.4.5.6.7.8.9.11"
VOLUME_ID = "test_wado_vol"


def _make_test_dicom(tmp_path: Path, sop_uid: str, series_uid: str, study_uid: str) -> str:
    """Create a minimal valid DICOM file for testing."""
    ds = pydicom.Dataset()
    ds.SOPInstanceUID = sop_uid
    ds.SeriesInstanceUID = series_uid
    ds.StudyInstanceUID = study_uid
    ds.Rows = 4
    ds.Columns = 4
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 0
    ds.SamplesPerPixel = 1
    ds.PixelData = np.zeros((4, 4), dtype=np.uint16).tobytes()
    ds.file_meta = pydicom.Dataset()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.2"
    ds.file_meta.MediaStorageSOPInstanceUID = sop_uid
    fpath = str(tmp_path / f"{sop_uid}.dcm")
    ds.save_as(fpath, write_like_original=False)
    return fpath


@pytest.fixture
def dicom_series_registered(tmp_path):
    """Register a 2-file DICOM series in the volume registries."""
    file1 = _make_test_dicom(tmp_path, SOP_UID_1, SERIES_UID, STUDY_UID)
    file2 = _make_test_dicom(tmp_path, SOP_UID_2, SERIES_UID, STUDY_UID)
    file_list = [file1, file2]

    meta = VolumeMetadata(
        id=VOLUME_ID,
        name="test_wado_series",
        path=json.dumps(file_list),
        format="dicom_series",
        study_instance_uid=STUDY_UID,
        series_instance_uid=SERIES_UID,
    )
    register_volume(VOLUME_ID, meta, json.dumps(file_list), "dicom_series")

    yield {"files": file_list, "meta": meta}

    # Teardown: remove from registries
    _metadata_registry.pop(VOLUME_ID, None)
    _path_registry.pop(VOLUME_ID, None)


@pytest.fixture
def nifti_volume_registered():
    """Register a NIfTI volume (no UIDs) in the volume registries."""
    nifti_id = "test_wado_nifti"
    meta = VolumeMetadata(
        id=nifti_id,
        name="test_nifti",
        path="/fake/path/test.nii.gz",
        format="nifti",
    )
    register_volume(nifti_id, meta, "/fake/path/test.nii.gz", "nifti")

    yield {"meta": meta}

    _metadata_registry.pop(nifti_id, None)
    _path_registry.pop(nifti_id, None)


# --- WADO-01: Retrieve ---


def test_retrieve_series_multipart(dicom_series_registered):
    """GET retrieve returns multipart/related with correct boundary and DICOM bytes."""
    url = f"/api/v1/wado-rs/studies/{STUDY_UID}/series/{SERIES_UID}"
    r = client.get(url)
    assert r.status_code == 200

    ct = r.headers["content-type"]
    assert "multipart/related" in ct
    assert 'type="application/dicom"' in ct
    assert "boundary=" in ct

    # Extract boundary
    for part in ct.split(";"):
        part = part.strip()
        if part.startswith("boundary="):
            boundary = part.split("=", 1)[1].strip()
            break
    else:
        pytest.fail("No boundary found in Content-Type header")

    # Split response on boundary
    body = r.content
    boundary_bytes = b"--" + boundary.encode()
    parts = body.split(boundary_bytes)
    # First element is empty (before first boundary), last is closing "--\r\n"
    # Content parts are in between
    content_parts = [p for p in parts if p and p != b"--\r\n"]

    # Should have 2 parts (one per DICOM file)
    assert len(content_parts) == 2

    # Each part should contain "Content-Type: application/dicom" header
    for part_data in content_parts:
        assert b"Content-Type: application/dicom" in part_data

    # Verify part bodies match original file bytes
    files = dicom_series_registered["files"]
    for i, fpath in enumerate(files):
        original_bytes = Path(fpath).read_bytes()
        # Part body is after the double CRLF (header separator)
        part_body = content_parts[i].split(b"\r\n\r\n", 1)[1]
        # Strip trailing CRLF
        if part_body.endswith(b"\r\n"):
            part_body = part_body[:-2]
        assert part_body == original_bytes


def test_retrieve_series_404():
    """GET retrieve with unknown UIDs returns 404."""
    url = "/api/v1/wado-rs/studies/9.9.9.9/series/9.9.9.9"
    r = client.get(url)
    assert r.status_code == 404
    assert "detail" in r.json()


def test_retrieve_missing_file(dicom_series_registered):
    """GET retrieve where a registered file is deleted returns 404."""
    # Delete one of the registered DICOM files
    files = dicom_series_registered["files"]
    Path(files[0]).unlink()

    url = f"/api/v1/wado-rs/studies/{STUDY_UID}/series/{SERIES_UID}"
    r = client.get(url)
    assert r.status_code == 404
    assert "missing" in r.json()["detail"].lower() or "missing" in r.json()["detail"]


def test_nifti_invisible(nifti_volume_registered):
    """NIfTI volumes have no UIDs and are not discoverable via WADO-RS."""
    # Use made-up UIDs that won't match any DICOM volume
    url = "/api/v1/wado-rs/studies/1.2.3.999/series/1.2.3.999"
    r = client.get(url)
    assert r.status_code == 404


# --- WADO-02: Metadata ---


def test_metadata_json_format(dicom_series_registered):
    """GET metadata returns JSON array with PS3.18 DICOM tag format."""
    url = f"/api/v1/wado-rs/studies/{STUDY_UID}/series/{SERIES_UID}/metadata"
    r = client.get(url)
    assert r.status_code == 200

    data = r.json()
    assert isinstance(data, list)
    assert len(data) == 2

    for element in data:
        assert isinstance(element, dict)
        # Check for StudyInstanceUID tag (0020,000D)
        assert "0020000D" in element
        uid_entry = element["0020000D"]
        assert uid_entry["vr"] == "UI"


def test_metadata_bulk_data_uri(dicom_series_registered):
    """Metadata includes BulkDataURI for PixelData (7FE00010)."""
    url = f"/api/v1/wado-rs/studies/{STUDY_UID}/series/{SERIES_UID}/metadata"
    r = client.get(url)
    assert r.status_code == 200

    data = r.json()
    for element in data:
        assert "7FE00010" in element
        pixel_entry = element["7FE00010"]
        assert "BulkDataURI" in pixel_entry
        assert "/api/v1/wado-rs/" in pixel_entry["BulkDataURI"]


def test_metadata_404():
    """GET metadata with unknown UIDs returns 404."""
    url = "/api/v1/wado-rs/studies/9.9.9.9/series/9.9.9.9/metadata"
    r = client.get(url)
    assert r.status_code == 404
    assert "detail" in r.json()

"""Tests for DICOM-SEG writer: label remapping, dataset sorting, frame conversion."""

from __future__ import annotations

import numpy as np
import pydicom
import pydicom.uid

from server.loaders.dicom_seg_writer import (
    _ras_seg_to_dicom_frames,
    _sort_dicom_datasets,
    build_dicom_seg,
    remap_labels,
)


def _make_mock_dataset(
    rows: int = 4,
    cols: int = 4,
    position: list[float] | None = None,
    orientation: list[float] | None = None,
    pixel_spacing: list[float] | None = None,
    instance_number: int = 1,
) -> pydicom.Dataset:
    """Create a minimal mock DICOM dataset for testing."""
    if position is None:
        position = [0.0, 0.0, 0.0]
    if orientation is None:
        orientation = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    if pixel_spacing is None:
        pixel_spacing = [1.0, 1.0]

    ds = pydicom.Dataset()
    ds.file_meta = pydicom.dataset.FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = pydicom.uid.ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.2"
    ds.file_meta.MediaStorageSOPInstanceUID = pydicom.uid.generate_uid()

    ds.Rows = rows
    ds.Columns = cols
    ds.ImagePositionPatient = [str(v) for v in position]
    ds.ImageOrientationPatient = [str(v) for v in orientation]
    ds.PixelSpacing = [str(v) for v in pixel_spacing]
    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.2"  # CT Image Storage
    ds.SOPInstanceUID = pydicom.uid.generate_uid()
    ds.StudyInstanceUID = pydicom.uid.generate_uid()
    ds.SeriesInstanceUID = pydicom.uid.generate_uid()
    ds.Modality = "CT"
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.PixelRepresentation = 1
    ds.PatientID = "TEST001"
    ds.PatientName = "Test^Patient"
    ds.StudyDate = "20260101"
    ds.StudyTime = "120000"
    ds.AccessionNumber = ""
    ds.ReferringPhysicianName = ""
    ds.Manufacturer = "TestMfg"
    ds.InstanceNumber = instance_number

    # Create pixel data
    pixel_array = np.zeros((rows, cols), dtype=np.int16)
    ds.PixelData = pixel_array.tobytes()

    return ds


# -------------------------------------------------------
# remap_labels tests
# -------------------------------------------------------


def test_remap_labels_basic():
    """Labels [0,1,5,12] -> remapped [0,1,2,3] with correct names."""
    arr = np.array([0, 1, 5, 12, 0, 1], dtype=np.uint8).reshape(2, 3)
    label_names = {1: "Liver", 5: "Kidney", 12: "Tumor"}

    remapped, segments = remap_labels(arr, label_names)

    assert set(np.unique(remapped).tolist()) == {0, 1, 2, 3}
    assert remapped[0, 0] == 0  # background stays 0
    assert remapped[0, 1] == 1  # old 1 -> new 1
    assert remapped[0, 2] == 2  # old 5 -> new 2
    assert remapped[1, 0] == 3  # old 12 -> new 3
    assert segments == [(1, "Liver"), (2, "Kidney"), (3, "Tumor")]


def test_remap_labels_background_only():
    """All-zero array -> unchanged, empty segments list."""
    arr = np.zeros((3, 3), dtype=np.uint8)
    remapped, segments = remap_labels(arr, {})

    assert np.array_equal(remapped, arr)
    assert segments == []


def test_remap_labels_missing_names():
    """Values not in label_names get default 'Segment {val}' names."""
    arr = np.array([0, 2, 7], dtype=np.uint8).reshape(1, 3)
    label_names = {2: "Liver"}

    remapped, segments = remap_labels(arr, label_names)

    assert segments == [(1, "Liver"), (2, "Segment 7")]


# -------------------------------------------------------
# _sort_dicom_datasets tests
# -------------------------------------------------------


def test_sort_dicom_datasets():
    """Datasets are sorted by slice position along slice normal."""
    # Standard axial orientation: row=[1,0,0], col=[0,1,0], normal=[0,0,1]
    ds1 = _make_mock_dataset(position=[0.0, 0.0, 30.0])
    ds2 = _make_mock_dataset(position=[0.0, 0.0, 10.0])
    ds3 = _make_mock_dataset(position=[0.0, 0.0, 20.0])

    # Share same orientation
    for ds in [ds1, ds2, ds3]:
        ds.ImageOrientationPatient = ["1", "0", "0", "0", "1", "0"]

    sorted_ds = _sort_dicom_datasets([ds1, ds2, ds3])

    positions = [
        float(np.dot([float(v) for v in ds.ImagePositionPatient], [0, 0, 1]))
        for ds in sorted_ds
    ]
    assert positions == [10.0, 20.0, 30.0]


# -------------------------------------------------------
# build_dicom_seg tests
# -------------------------------------------------------


def test_build_dicom_seg_empty_raises():
    """All-zero segmentation raises ValueError."""
    seg = np.zeros((3, 4, 4), dtype=np.uint8)
    affine = np.eye(4)

    try:
        build_dicom_seg(seg, affine, [], {}, "test.dcm")
        assert False, "Should have raised ValueError"
    except ValueError as e:
        assert "Empty segmentation" in str(e)


# -------------------------------------------------------
# _ras_seg_to_dicom_frames tests
# -------------------------------------------------------


def test_ras_seg_to_dicom_frames_shape():
    """Output shape is (n_slices, rows, cols) for standard axial orientation."""
    # Create 3 mock datasets for a 4x4x3 volume (standard axial)
    datasets = []
    study_uid = pydicom.uid.generate_uid()
    series_uid = pydicom.uid.generate_uid()
    for i in range(3):
        ds = _make_mock_dataset(
            rows=4,
            cols=4,
            position=[0.0, 0.0, float(i)],
            orientation=[1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
        )
        ds.StudyInstanceUID = study_uid
        ds.SeriesInstanceUID = series_uid
        datasets.append(ds)

    # For standard axial, as_closest_canonical is identity
    # The canonical affine matches _build_affine output
    from server.loaders.dicom_loader import _build_affine

    canonical_affine = _build_affine(
        orientation=[1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
        position=[0.0, 0.0, 0.0],
        pixel_spacing=[1.0, 1.0],
        slice_positions=[0.0, 1.0, 2.0],
        n_slices=3,
    )

    # Create a seg array in (Z, Y, X) shape = (3, 4, 4) matching canonical
    seg_zyx = np.zeros((3, 4, 4), dtype=np.uint8)
    seg_zyx[1, 2, 3] = 1  # mark a voxel

    frames = _ras_seg_to_dicom_frames(seg_zyx, canonical_affine, datasets)

    assert frames.shape == (3, 4, 4)
    assert frames.dtype == np.uint8

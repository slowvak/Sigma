"""DICOM-SEG writer: constructs DICOM-SEG from RAS+ segmentation arrays.

Handles label remapping, RAS-to-LPS orientation reversal, and highdicom
Segmentation construction with source DICOM dataset alignment.
"""

from __future__ import annotations

import nibabel as nib
import nibabel.orientations
import numpy as np
import pydicom
import highdicom as hd
from pydicom.sr.codedict import codes

from server.loaders.dicom_loader import _build_affine


def remap_labels(
    seg_array: np.ndarray,
    label_names: dict[int, str],
) -> tuple[np.ndarray, list[tuple[int, str]]]:
    """Remap arbitrary label values to contiguous 1..N.

    Label 0 is always background and excluded from segments.

    Args:
        seg_array: uint8 array with arbitrary label values
        label_names: mapping of original_value -> label_name

    Returns:
        (remapped_array, segments) where segments is [(seg_number, label_name), ...]
    """
    unique_labels = sorted(set(np.unique(seg_array).tolist()) - {0})
    remapped = np.zeros_like(seg_array)
    segments: list[tuple[int, str]] = []

    for new_num, old_val in enumerate(unique_labels, start=1):
        remapped[seg_array == old_val] = new_num
        name = label_names.get(old_val, f"Segment {old_val}")
        segments.append((new_num, name))

    return remapped, segments


def _sort_dicom_datasets(
    datasets: list[pydicom.Dataset],
) -> list[pydicom.Dataset]:
    """Sort DICOM datasets by slice position along the slice normal.

    Replicates the sorting logic from load_dicom_series() in dicom_loader.py.
    """
    if not datasets:
        return datasets

    orientation = [float(v) for v in datasets[0].ImageOrientationPatient]
    row_cosine = np.array(orientation[:3])
    col_cosine = np.array(orientation[3:6])
    slice_normal = np.cross(row_cosine, col_cosine)

    def get_slice_pos(ds: pydicom.Dataset) -> float:
        pos = np.array([float(v) for v in ds.ImagePositionPatient])
        return float(np.dot(pos, slice_normal))

    return sorted(datasets, key=get_slice_pos)


def _ras_seg_to_dicom_frames(
    seg_zyx: np.ndarray,
    canonical_affine: np.ndarray,
    source_datasets: list[pydicom.Dataset],
) -> np.ndarray:
    """Convert RAS+ segmentation back to DICOM frame order.

    Input: seg in client shape (Z, Y, X), the canonical RAS+ affine,
    sorted source DICOM datasets.

    Returns array shaped (n_slices, rows, cols) matching source DICOM sort order.
    """
    # Step 1: undo client transpose (Z,Y,X) -> (X,Y,Z) = canonical RAS shape
    seg_xyz = seg_zyx.transpose(2, 1, 0)

    # Step 2: Rebuild original LPS affine from source DICOM geometry
    first = source_datasets[0]
    orientation = [float(v) for v in first.ImageOrientationPatient]
    position = [float(v) for v in first.ImagePositionPatient]
    pixel_spacing = [float(v) for v in first.PixelSpacing]

    row_cosine = np.array(orientation[:3])
    col_cosine = np.array(orientation[3:6])
    slice_normal = np.cross(row_cosine, col_cosine)

    slice_positions = [
        float(np.dot([float(v) for v in ds.ImagePositionPatient], slice_normal))
        for ds in source_datasets
    ]

    # _build_affine returns RAS affine (lps_to_ras @ affine_lps)
    # This is the pre-canonical RAS affine
    ras_pre_canonical = _build_affine(
        orientation, position, pixel_spacing, slice_positions, len(source_datasets)
    )

    # Step 3: Determine what as_closest_canonical did
    ornt_orig = nib.io_orientation(ras_pre_canonical)
    ornt_canonical = nibabel.orientations.axcodes2ornt(("R", "A", "S"))

    # Step 4: Compute inverse transform (from canonical back to original)
    inv_transform = nibabel.orientations.ornt_transform(ornt_canonical, ornt_orig)

    # Step 5: Apply inverse to get back to original (rows, cols, slices) layout
    seg_original = nibabel.orientations.apply_orientation(seg_xyz, inv_transform)

    # Step 6: Reshape to (n_slices, rows, cols)
    # After reversing canonical, the array is in original DICOM layout:
    # axis 0 = rows, axis 1 = cols, axis 2 = slices
    # Transpose to (slices, rows, cols) for highdicom frames
    frames = seg_original.transpose(2, 0, 1).astype(np.uint8)

    return frames


def build_dicom_seg(
    seg_zyx: np.ndarray,
    canonical_affine: np.ndarray,
    dicom_file_paths: list[str],
    label_names: dict[int, str],
    filename: str,
) -> tuple[pydicom.Dataset, list[tuple[int, str]]]:
    """Build a DICOM-SEG dataset from segmentation array and source DICOMs.

    This is the main entry point called by the save endpoint.

    Args:
        seg_zyx: segmentation in client shape (Z, Y, X), uint8
        canonical_affine: the canonical RAS+ affine from volume loading
        dicom_file_paths: paths to source DICOM files
        label_names: mapping of original label value -> name
        filename: user-provided filename for the segmentation

    Returns:
        (seg_dcm, segments_list) where seg_dcm is the highdicom Segmentation
        dataset and segments_list is [(seg_number, label_name), ...]

    Raises:
        ValueError: if segmentation is empty (all zeros) or frame count mismatch
    """
    # Step 1: Check for non-zero labels
    if not np.any(seg_zyx != 0):
        raise ValueError("Empty segmentation -- no non-zero labels to save")

    # Step 2: Load source DICOM datasets (header only for speed)
    source_datasets: list[pydicom.Dataset] = []
    for f in dicom_file_paths:
        try:
            ds = pydicom.dcmread(f, stop_before_pixels=True)
            if (
                hasattr(ds, "ImagePositionPatient")
                and hasattr(ds, "Rows")
                and hasattr(ds, "Columns")
                and hasattr(ds, "PixelSpacing")
            ):
                source_datasets.append(ds)
        except Exception:
            continue

    if not source_datasets:
        raise ValueError("No valid source DICOM datasets found")

    # Step 3: Sort datasets by slice position
    source_datasets = _sort_dicom_datasets(source_datasets)

    # Step 4: Remap labels
    remapped, segments = remap_labels(seg_zyx, label_names)

    # Step 5: Convert RAS+ seg to DICOM frame order
    frames = _ras_seg_to_dicom_frames(remapped, canonical_affine, source_datasets)

    # Step 6: Verify frame count matches source datasets
    if frames.shape[0] != len(source_datasets):
        raise ValueError(
            f"Frame count mismatch: segmentation has {frames.shape[0]} frames "
            f"but {len(source_datasets)} source DICOM datasets"
        )

    # Step 7: Build SegmentDescription list
    descriptions = []
    for seg_num, label_name in segments:
        desc = hd.seg.SegmentDescription(
            segment_number=seg_num,
            segment_label=label_name,
            segmented_property_category=codes.SCT.Tissue,
            segmented_property_type=codes.SCT.Tissue,
            algorithm_type=hd.seg.SegmentAlgorithmTypeValues.MANUAL,
        )
        descriptions.append(desc)

    # Step 8: Create highdicom Segmentation
    seg_dcm = hd.seg.Segmentation(
        source_images=source_datasets,
        pixel_array=frames,
        segmentation_type=hd.seg.SegmentationTypeValues.BINARY,
        segment_descriptions=descriptions,
        series_instance_uid=hd.UID(),
        series_number=100,
        sop_instance_uid=hd.UID(),
        instance_number=1,
        manufacturer="SIGMA",
        manufacturer_model_name="SIGMA Segmentation Editor",
        software_versions="2.0",
        device_serial_number="SIGMA-001",
        series_description=f"Segmentation - {filename}",
    )

    return seg_dcm, segments

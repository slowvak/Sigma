"""Tests for segmentation loader."""

import numpy as np
import nibabel as nib
import pytest
from pathlib import Path
from server.loaders.nifti_loader import load_nifti_segmentation

def test_load_nifti_segmentation(tmp_path: Path):
    # Create minimal NIfTI segmentation file
    data = np.zeros((3, 4, 5), dtype=np.uint8)
    data[1, 1, 1] = 1 # add some data
    
    # Simple affine
    affine = np.eye(4)
    img = nib.Nifti1Image(data, affine)
    
    filepath = tmp_path / "test_seg.nii.gz"
    nib.save(img, filepath)
    
    # Load it
    loaded_data, meta = load_nifti_segmentation(filepath)
    
    assert loaded_data.dtype == np.uint8
    assert loaded_data.flags["C_CONTIGUOUS"] is True
    assert loaded_data.shape == (5, 4, 3) # Transposed to (Z, Y, X)
    
    assert "dimensions" in meta
    assert meta["dimensions"] == [3, 4, 5] # Original RAS dims
    assert "window_center" not in meta # No auto-windowing for segmentations
    assert "window_width" not in meta

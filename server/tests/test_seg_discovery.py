"""Tests for segmentation discovery logic."""

import pytest
from pathlib import Path
from server.main import _find_companion_segmentations, _discover_volumes

def test_find_companion_segmentations(tmp_path: Path):
    d = tmp_path / "data"
    d.mkdir()
    
    # Create main volume
    vol_nii_gz = d / "brain.nii.gz"
    vol_nii_gz.touch()
    
    vol_nii = d / "liver.nii"
    vol_nii.touch()
    
    # Create companions for brain
    (d / "brain_segmentation.nii.gz").touch()
    (d / "brain_seg.nii").touch()
    
    # Create non-matches for brain
    (d / "brain_mask.nii.gz").touch()
    (d / "brain2_seg.nii.gz").touch()
    
    # Find for brain.nii.gz
    found_brain = _find_companion_segmentations(vol_nii_gz)
    assert len(found_brain) == 2
    names = [p.name for p in found_brain]
    assert "brain_segmentation.nii.gz" in names
    assert "brain_seg.nii" in names
    
    # Find for liver.nii
    found_liver = _find_companion_segmentations(vol_nii)
    assert len(found_liver) == 0

def test_discover_volumes_excludes_segmentations(tmp_path: Path):
    d = tmp_path / "data"
    d.mkdir()
    
    (d / "chest.nii.gz").touch()
    (d / "chest_segmentation.nii.gz").touch()
    (d / "chest_seg.nii").touch()
    (d / "head.nii").touch()
    (d / "head_seg.nii.gz").touch()
    
    found = _discover_volumes([str(tmp_path)])
    
    # Should only find chest.nii.gz and head.nii
    assert len(found) == 2
    paths = [p for p, fmt in found]
    assert any(p.endswith("chest.nii.gz") for p in paths)
    assert any(p.endswith("head.nii") for p in paths)
    assert not any("seg" in p.lower() for p in paths)

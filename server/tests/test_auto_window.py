"""Tests for auto-windowing percentile computation."""

from __future__ import annotations

import tempfile
from pathlib import Path

import nibabel as nib
import numpy as np
import pytest

from server.loaders.nifti_loader import compute_auto_window, load_nifti_volume


class TestAutoWindow:
    """Verify auto-windowing percentile computation."""

    def test_auto_window_normal_distribution(self) -> None:
        """Normal case: mixed zero background + signal values.

        compute_auto_window uses the 1st-99th percentile of foreground voxels
        so that 98% of signal values are visible with full contrast.
        """
        # Create array: 50% zeros (background) + 50% values in 100-200 range
        background = np.zeros(500, dtype=np.float32)
        signal = np.linspace(100, 200, 500, dtype=np.float32)
        data = np.concatenate([background, signal])

        wc, ww = compute_auto_window(data)

        # Non-zero values are 100-200; p1≈101, p99≈199, center≈150, width≈98
        p01 = float(np.percentile(signal, 1))
        p99 = float(np.percentile(signal, 99))
        expected_center = (p01 + p99) / 2
        expected_width = p99 - p01

        assert wc == pytest.approx(expected_center, rel=0.01)
        assert ww == pytest.approx(expected_width, rel=0.01)

    def test_auto_window_all_same_values(self) -> None:
        """Edge case: all non-zero voxels have the same value.

        Window width should be >= 1 (never zero) to avoid division by zero
        in client-side rendering.
        """
        data = np.full(100, 42.0, dtype=np.float32)

        wc, ww = compute_auto_window(data)

        assert wc == pytest.approx(42.0)
        assert ww >= 1.0, "Window width must be >= 1 to avoid zero-width"

    def test_auto_window_all_zeros(self) -> None:
        """Edge case: volume with all zero voxels (e.g., empty mask).

        Should not crash and should return reasonable defaults.
        """
        data = np.zeros((10, 10, 10), dtype=np.float32)

        wc, ww = compute_auto_window(data)

        assert wc == 0.0
        assert ww >= 1.0

    def test_auto_window_excludes_zeros(self) -> None:
        """Verify that zero voxels (background) are excluded from percentile calc."""
        # 90% zeros, 10% values at exactly 500
        data = np.zeros(1000, dtype=np.float32)
        data[900:] = 500.0

        wc, ww = compute_auto_window(data)

        # All non-zero values are 500, so center should be 500
        assert wc == pytest.approx(500.0)
        # Width should be >= 1 (all same non-zero value)
        assert ww >= 1.0

    def test_auto_window_negative_values(self) -> None:
        """CT data has negative Hounsfield units (e.g., -1000 for air)."""
        # Simulate CT: air at -1000, soft tissue around 40, bone around 1000
        air = np.full(300, -1000.0, dtype=np.float32)
        tissue = np.linspace(-100, 200, 500, dtype=np.float32)
        bone = np.full(200, 1000.0, dtype=np.float32)
        data = np.concatenate([air, tissue, bone])

        wc, ww = compute_auto_window(data)

        # Should produce a reasonable window spanning the data range
        assert ww > 0
        # Center should be somewhere in the data range
        assert -1000 <= wc <= 1000

    def test_auto_window_via_loader(self, tmp_path: Path) -> None:
        """Integration test: verify auto-window values flow through NIfTI loader."""
        shape = (20, 20, 20)
        data = np.zeros(shape, dtype=np.float32)
        # Add a known signal region
        data[5:15, 5:15, 5:15] = 150.0

        affine = np.eye(4)
        img = nib.Nifti1Image(data, affine)
        filepath = tmp_path / "test_windowing.nii.gz"
        nib.save(img, str(filepath))

        _, metadata = load_nifti_volume(filepath)

        assert "window_center" in metadata
        assert "window_width" in metadata
        assert metadata["window_center"] == pytest.approx(150.0)
        assert metadata["window_width"] >= 1.0

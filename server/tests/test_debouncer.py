"""Tests for DICOMDebouncer."""

from __future__ import annotations

import asyncio

import pytest

from server.watcher.debouncer import DICOMDebouncer


@pytest.mark.asyncio
async def test_dicom_debounce():
    """Multiple file_added calls for same dir result in single callback."""
    results = []

    async def callback(dir_path: str):
        results.append(dir_path)

    debouncer = DICOMDebouncer(delay=0.1)

    await debouncer.file_added("/data/series1/file1.dcm", callback)
    await debouncer.file_added("/data/series1/file2.dcm", callback)
    await debouncer.file_added("/data/series1/file3.dcm", callback)

    # Wait for debounce to fire
    await asyncio.sleep(0.2)

    assert len(results) == 1
    assert results[0] == "/data/series1"


@pytest.mark.asyncio
async def test_dicom_debounce_resets():
    """Adding a file resets the timer -- callback fires 2.5s after LAST file."""
    results = []

    async def callback(dir_path: str):
        results.append(dir_path)

    debouncer = DICOMDebouncer(delay=0.1)

    await debouncer.file_added("/data/series2/file1.dcm", callback)
    await asyncio.sleep(0.05)  # Half the delay
    # Timer should reset
    await debouncer.file_added("/data/series2/file2.dcm", callback)
    await asyncio.sleep(0.05)  # 0.05s after second call — not yet fired

    assert len(results) == 0  # Should NOT have fired yet

    await asyncio.sleep(0.1)  # Now enough time has passed after last file

    assert len(results) == 1
    assert results[0] == "/data/series2"

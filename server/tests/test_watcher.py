"""Tests for VolumeEventHandler and watcher observer."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest


def test_nifti_created():
    """Simulated 'created' event for .nii.gz triggers queue entry."""
    from server.watcher.observer import VolumeEventHandler

    loop = asyncio.new_event_loop()
    queue = asyncio.Queue()
    handler = VolumeEventHandler(queue, loop)

    event = SimpleNamespace(is_directory=False, src_path="/tmp/brain.nii.gz")

    # call_soon_threadsafe schedules on the loop; run briefly to execute it
    handler.on_created(event)
    loop.run_until_complete(asyncio.sleep(0))

    assert not queue.empty()
    item = queue.get_nowait()
    assert item == ("created", "/tmp/brain.nii.gz")
    loop.close()


def test_seg_file_ignored():
    """Segmentation NIfTI files are NOT treated as volumes."""
    from server.watcher.observer import _is_nifti

    assert _is_nifti("/data/scan.nii.gz") is True
    assert _is_nifti("/data/scan_seg.nii.gz") is False
    assert _is_nifti("/data/scan_segmentation.nii.gz") is False
    assert _is_nifti("/data/scan_seg.nii") is False


def test_volume_deleted():
    """Simulated 'deleted' event pushes deletion to queue."""
    from server.watcher.observer import VolumeEventHandler

    loop = asyncio.new_event_loop()
    queue = asyncio.Queue()
    handler = VolumeEventHandler(queue, loop)

    event = SimpleNamespace(is_directory=False, src_path="/tmp/brain.nii.gz")

    handler.on_deleted(event)
    loop.run_until_complete(asyncio.sleep(0))

    assert not queue.empty()
    item = queue.get_nowait()
    assert item == ("deleted", "/tmp/brain.nii.gz")
    loop.close()

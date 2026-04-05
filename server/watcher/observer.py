"""Filesystem observer — watches directories for volume file changes.

Uses watchdog to monitor directories and bridges events into asyncio
via call_soon_threadsafe into an asyncio.Queue.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
from pathlib import Path
from typing import TYPE_CHECKING

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from server.watcher.debouncer import DICOMDebouncer

if TYPE_CHECKING:
    from watchdog.events import FileSystemEvent

_SEG_PATTERN = re.compile(r'_seg(mentation)?\.(nii\.gz|nii)$')
_NIFTI_SUFFIXES = {'.nii', '.nii.gz'}
_DICOM_SUFFIXES = {'.dcm', '.ima'}


def _is_nifti(path: str) -> bool:
    """Check if path is a NIfTI volume file (not a segmentation)."""
    p = path.lower()
    if not (p.endswith('.nii') or p.endswith('.nii.gz')):
        return False
    if _SEG_PATTERN.search(Path(path).name):
        return False
    return True


def _is_dicom(path: str) -> bool:
    """Check if path is a DICOM file."""
    p = path.lower()
    return p.endswith('.dcm') or p.endswith('.ima')


def _volume_id_from_path(path: str) -> str:
    """Generate a deterministic volume ID from a file path."""
    return hashlib.md5(path.encode()).hexdigest()[:12]


class VolumeEventHandler(FileSystemEventHandler):
    """Watchdog handler that pushes filesystem events to an asyncio queue."""

    def __init__(self, queue: asyncio.Queue, loop: asyncio.AbstractEventLoop):
        super().__init__()
        self._queue = queue
        self._loop = loop

    def on_created(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        if _is_nifti(event.src_path) or _is_dicom(event.src_path):
            self._loop.call_soon_threadsafe(
                self._queue.put_nowait, ("created", event.src_path)
            )

    def on_deleted(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        if _is_nifti(event.src_path) or _is_dicom(event.src_path):
            self._loop.call_soon_threadsafe(
                self._queue.put_nowait, ("deleted", event.src_path)
            )


async def _register_new_nifti(path: str) -> None:
    """Register a newly detected NIfTI file as a volume."""
    # Delay imports to avoid circular references
    from server.main import _catalog, _discover_nifti_volumes
    from server.api.volumes import register_volume, _metadata_registry
    from server.api.ws import manager
    from server.catalog.models import VolumeMetadata

    vol_id = _volume_id_from_path(path)

    # Skip if already registered (dedup)
    if vol_id in _metadata_registry:
        return

    # Discover metadata for files in the parent directory, filter to this file
    entries = _discover_nifti_volumes(Path(path).parent)
    matching = [e for e in entries if e["path"] == path]
    if not matching:
        return

    entry = matching[0]
    meta = VolumeMetadata(
        id=vol_id,
        name=entry["name"],
        path=entry["path"],
        format=entry["format"],
        dimensions=entry.get("dimensions"),
        voxel_spacing=entry.get("voxel_spacing"),
        dtype=entry.get("dtype"),
        modality=entry.get("modality", "unknown"),
    )
    register_volume(vol_id, meta, entry["path"], entry["format"])
    _catalog.append(meta)
    await manager.broadcast({"type": "volume_added", "data": meta.model_dump()})
    print(f"Watcher: registered NIfTI volume [{vol_id}] {entry['name']}")


async def _register_dicom_directory(dir_path: str) -> None:
    """Register DICOM series found in a directory after debounce."""
    from server.main import _catalog, _discover_dicom_series
    from server.api.volumes import register_volume, _metadata_registry
    from server.api.ws import manager
    from server.catalog.models import VolumeMetadata

    entries = _discover_dicom_series(Path(dir_path))
    for entry in entries:
        vol_id = _volume_id_from_path(entry["path"])
        if vol_id in _metadata_registry:
            continue

        meta = VolumeMetadata(
            id=vol_id,
            name=entry["name"],
            path=entry["path"],
            format=entry["format"],
            dimensions=entry.get("dimensions"),
            voxel_spacing=entry.get("voxel_spacing"),
            dtype=entry.get("dtype"),
            modality=entry.get("modality", "unknown"),
            study_instance_uid=entry.get("study_instance_uid"),
            series_instance_uid=entry.get("series_instance_uid"),
        )
        register_volume(vol_id, meta, entry["path"], entry["format"])
        _catalog.append(meta)
        await manager.broadcast({"type": "volume_added", "data": meta.model_dump()})
        print(f"Watcher: registered DICOM series [{vol_id}] {entry['name']}")


async def _handle_deletion(path: str) -> None:
    """Handle deletion of a volume file."""
    from server.main import _catalog
    from server.api.volumes import unregister_volume, _path_registry
    from server.api.ws import manager

    # Find volume whose registered path matches the deleted file
    vol_id_to_remove = None
    for vid, (reg_path, fmt) in list(_path_registry.items()):
        if fmt == "dicom_series":
            # For DICOM series, path is a JSON list of file paths
            import json
            try:
                file_list = json.loads(reg_path)
                if path in file_list:
                    vol_id_to_remove = vid
                    break
            except (json.JSONDecodeError, TypeError):
                continue
        else:
            if reg_path == path:
                vol_id_to_remove = vid
                break

    if vol_id_to_remove is None:
        return

    unregister_volume(vol_id_to_remove)

    # Remove from catalog list
    _catalog[:] = [v for v in _catalog if v.id != vol_id_to_remove]

    await manager.broadcast({
        "type": "volume_removed",
        "data": {"id": vol_id_to_remove},
    })
    print(f"Watcher: removed volume [{vol_id_to_remove}]")


async def process_events(queue: asyncio.Queue, debouncer: DICOMDebouncer) -> None:
    """Consume filesystem events from the queue and process them."""
    while True:
        event_type, path = await queue.get()

        if event_type == "created":
            if _is_nifti(path):
                # Brief delay for partial write guard
                await asyncio.sleep(0.5)
                await _register_new_nifti(path)
            elif _is_dicom(path):
                await debouncer.file_added(path, _register_dicom_directory)

        elif event_type == "deleted":
            await _handle_deletion(path)


async def start_watcher(
    paths: list[str],
) -> tuple[Observer, asyncio.Task, DICOMDebouncer]:
    """Start the filesystem watcher on the given paths.

    Returns (observer, consumer_task, debouncer) for lifecycle management.
    """
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()
    debouncer = DICOMDebouncer()
    handler = VolumeEventHandler(queue, loop)

    observer = Observer()
    observer.daemon = True

    for p in paths:
        observer.schedule(handler, p, recursive=True)

    observer.start()

    consumer_task = asyncio.create_task(process_events(queue, debouncer))

    return observer, consumer_task, debouncer

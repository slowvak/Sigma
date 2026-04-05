"""DICOM series debouncer — coalesces rapid file events per directory."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Callable


class DICOMDebouncer:
    """Debounce DICOM file creation events per directory.

    When multiple DICOM files arrive in the same directory, waits for a quiet
    window (default 2.5s) after the last file before triggering the callback.
    Each new file resets the timer for that directory.
    """

    def __init__(self, delay: float = 2.5):
        self._delay = delay
        self._pending: dict[str, asyncio.Task] = {}

    async def file_added(self, file_path: str, callback: Callable) -> None:
        """Register a new DICOM file. Resets the debounce timer for its directory."""
        dir_path = str(Path(file_path).parent)

        # Cancel existing timer for this directory
        existing = self._pending.get(dir_path)
        if existing is not None:
            existing.cancel()

        # Start new delayed scan
        self._pending[dir_path] = asyncio.create_task(
            self._delayed_scan(dir_path, callback)
        )

    async def _delayed_scan(self, dir_path: str, callback: Callable) -> None:
        """Wait for the quiet window, then invoke the callback."""
        await asyncio.sleep(self._delay)
        self._pending.pop(dir_path, None)
        await callback(dir_path)

    def cancel_all(self) -> None:
        """Cancel all pending debounce tasks (for shutdown)."""
        for task in self._pending.values():
            task.cancel()
        self._pending.clear()

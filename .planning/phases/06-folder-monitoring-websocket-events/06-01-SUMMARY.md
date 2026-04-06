---
phase: 06-folder-monitoring-websocket-events
plan: 01
subsystem: api
tags: [websocket, watchdog, fastapi, asyncio, dicom]

requires:
  - phase: 05-segmentation-pipeline
    provides: volume catalog and registration system
provides:
  - WebSocket ConnectionManager with broadcast to all clients
  - VolumeEventHandler for filesystem event monitoring via watchdog
  - DICOMDebouncer with per-directory asyncio task cancellation
  - unregister_volume for catalog cleanup
  - Lifespan-based watcher start/stop in main.py
  - Vite WebSocket proxy configuration
  - Hash-based volume IDs (MD5 of path)
affects: [06-02-client-websocket]

tech-stack:
  added: [watchdog, httpx, pytest-asyncio]
  patterns: [asyncio queue bridge from threads, lifespan context manager]

key-files:
  created:
    - server/watcher/__init__.py
    - server/watcher/observer.py
    - server/watcher/debouncer.py
    - server/api/ws.py
    - server/tests/test_watcher.py
    - server/tests/test_debouncer.py
    - server/tests/test_ws.py
  modified:
    - server/api/volumes.py
    - server/main.py
    - vite.config.js

key-decisions:
  - "Hash-based volume IDs (MD5[:12] of file path) for both startup and runtime registration"
  - "asyncio.Queue bridge from watchdog thread to async event loop via call_soon_threadsafe"
  - "Lifespan context manager replaces deprecated on_event for watcher lifecycle"
  - "Vite proxy with ws:true for WebSocket pass-through in dev mode"

patterns-established:
  - "Thread-to-async bridge: watchdog thread pushes to asyncio.Queue via call_soon_threadsafe"
  - "ConnectionManager singleton for WebSocket broadcast"
  - "DICOMDebouncer with per-directory cancellable asyncio tasks"

requirements-completed: [WATCH-01, WATCH-02, WATCH-03, WS-01, WS-02]

duration: ~45min
completed: 2026-04-05
---

# Plan 06-01: Server-Side Watcher Summary

**WebSocket endpoint, watchdog filesystem observer, DICOM debouncer, and lifespan integration for real-time volume discovery**

## Performance

- **Duration:** ~45 min
- **Tasks:** 3 (2 committed as atomic units)
- **Files created:** 7
- **Files modified:** 3

## Accomplishments
- ConnectionManager broadcasts JSON events to all connected WebSocket clients at /api/v1/ws
- VolumeEventHandler bridges watchdog filesystem events to asyncio via Queue + call_soon_threadsafe
- DICOMDebouncer coalesces per-directory file events with 2.5s quiet window
- unregister_volume cleans up all three registries (_metadata, _path, _volume_cache)
- Lifespan context manager starts watcher before server accepts requests, stops on shutdown
- Volume IDs migrated from sequential integers to deterministic MD5 hashes of file paths
- Vite dev proxy now passes WebSocket connections through to backend

## Task Commits

1. **Task 1: WebSocket ConnectionManager, watcher observer, debouncer** - `0d66796`
2. **Task 2: Lifespan integration and Vite WS proxy** - `272c226`
3. **Task 3: Hash-based volume ID migration** - included in Task 2 commit

## Files Created/Modified
- `server/api/ws.py` - ConnectionManager singleton + /api/v1/ws WebSocket endpoint
- `server/watcher/observer.py` - VolumeEventHandler (watchdog) + async event processing
- `server/watcher/debouncer.py` - DICOMDebouncer with per-directory asyncio timer
- `server/api/volumes.py` - Added unregister_volume()
- `server/main.py` - Lifespan context manager, hash-based volume IDs, ws_router mount
- `vite.config.js` - Added ws:true to proxy config
- `server/tests/test_watcher.py` - 3 tests for event handler
- `server/tests/test_debouncer.py` - 2 tests for debounce behavior
- `server/tests/test_ws.py` - 4 tests for WebSocket endpoint and broadcast

## Decisions Made
- Used asyncio.Queue bridge pattern instead of running watchdog in async mode (more reliable cross-platform)
- Hash-based IDs ensure no collision between startup and runtime-registered volumes
- 0.5s delay before NIfTI registration as partial-write guard

## Deviations from Plan
None - plan executed as specified.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- WebSocket endpoint ready for client connection (Plan 06-02)
- ConnectionManager.broadcast() available for volume_added/volume_removed events
- All 34 server tests passing

---
*Phase: 06-folder-monitoring-websocket-events*
*Completed: 2026-04-05*

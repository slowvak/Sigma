# Stack Research: v2.0 New Dependencies

**Domain:** Medical image server -- folder monitoring, DICOMweb, WebSocket events, DICOM-SEG
**Researched:** 2026-03-30
**Confidence:** HIGH (versions verified via PyPI/web search; integration patterns confirmed)

This document covers ONLY the new dependencies required for the v2.0 milestone. The existing stack (FastAPI, pydicom, nibabel, numpy, scipy, scikit-image, Vite, vanilla JS) is validated and unchanged.

## New Server Dependencies

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| watchdog | >=6.0 | Filesystem monitoring | Cross-platform (macOS FSEvents, Linux inotify, Windows ReadDirectoryChangesW). Mature, well-maintained (latest 6.0.0, Nov 2024). Python 3.9+. The standard Python library for filesystem events -- no serious alternative exists. |
| highdicom | >=0.24 | DICOM-SEG creation | Already in v1.0 STACK.md at >=0.23 but LABELMAP segmentation type (ideal for our uint8 label maps) requires >=0.24. Current release is 0.27.0 (Oct 2025). Use `>=0.24` to get LABELMAP support. |

### What Does NOT Need Adding

| Capability | Why No New Dependency |
|------------|----------------------|
| **WebSocket server** | FastAPI includes WebSocket support via Starlette. `@app.websocket("/ws")` just works. No additional library needed. |
| **DICOMweb WADO-RS** | Implement as custom FastAPI endpoints using pydicom (already installed). WADO-RS is a REST convention for URL structure and multipart response format -- not a library you install. The standard defines URL patterns and `multipart/related` responses which FastAPI can produce directly. |
| **JSON serialization** | stdlib `json` module handles all catalog/event serialization. |
| **Async file watching** | watchdog's Observer runs in its own thread. Bridge to async FastAPI via `asyncio.get_event_loop().call_soon_threadsafe()` -- no wrapper library needed. |

## Detailed Technology Analysis

### watchdog >=6.0 -- Filesystem Monitoring

**What it does:** Monitors directory trees for file creation, deletion, modification, and move events using OS-native APIs.

**Key classes:**
- `watchdog.observers.Observer` -- thread that schedules directory watches
- `watchdog.events.FileSystemEventHandler` -- subclass to handle on_created, on_deleted, on_modified, on_moved

**Integration with FastAPI:**
The Observer runs in a daemon thread started during FastAPI `lifespan` startup. When filesystem events fire (synchronous callback on Observer's thread), use `asyncio.get_event_loop().call_soon_threadsafe()` to dispatch to the async event loop, which then pushes events through WebSocket connections.

```python
# Conceptual integration pattern
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import asyncio

class VolumeEventHandler(FileSystemEventHandler):
    def __init__(self, loop, callback):
        self.loop = loop
        self.callback = callback

    def on_created(self, event):
        if not event.is_directory:
            self.loop.call_soon_threadsafe(
                asyncio.ensure_future,
                self.callback(event.src_path, "created")
            )
```

**Why NOT polling:** watchdog uses OS-native APIs (FSEvents on macOS, inotify on Linux) which are instant and use zero CPU. Polling (e.g., comparing directory listings on a timer) wastes CPU and has latency.

**Why NOT watchfiles (formerly watchgod):** watchfiles is a Rust-based alternative used by uvicorn internally for `--reload`. It is simpler but lower-level -- no event handler abstraction, no recursive scheduling API, and its primary audience is dev-tool authors, not application code. watchdog's `Observer` + `FileSystemEventHandler` pattern maps cleanly to the catalog update workflow.

**Debouncing consideration:** DICOM series arrive as many files (one per slice). A single CT scan may trigger 200+ `on_created` events in rapid succession. The handler must debounce -- collect events for a configurable window (e.g., 2 seconds of quiet) before triggering catalog re-scan of the affected directory. This is application logic, not a library concern.

**Version rationale:** 6.0.0 fixed inotify `select.poll()` deprecation and inotify file descriptor handling. No reason to use older versions.

### highdicom >=0.24 -- DICOM-SEG Writing

**What it does:** Creates standards-compliant DICOM Segmentation objects from numpy arrays and source DICOM datasets.

**Why >=0.24 specifically:** Version 0.24.0 introduced the LABELMAP segmentation type (from DICOM 2024c standard). This stores non-overlapping segments where pixel value = segment membership -- exactly matching NextEd's uint8 label mask format. Prior versions only supported BINARY and FRACTIONAL types, which require per-segment binary planes (wasteful for multi-label masks).

**Key API:**

```python
import highdicom as hd
import numpy as np

seg = hd.seg.Segmentation(
    source_images=source_dcm_datasets,     # list[pydicom.Dataset]
    pixel_array=label_mask,                 # np.ndarray, shape (Z, Y, X), dtype uint8
    segmentation_type=hd.seg.SegmentationTypeValues.LABELMAP,
    segment_descriptions=[
        hd.seg.SegmentDescription(
            segment_number=i,
            segment_label=name,
            segmented_property_category=...,  # CodedConcept
            segmented_property_type=...,      # CodedConcept
            algorithm_type=hd.seg.SegmentAlgorithmTypeValues.MANUAL,
        )
        for i, name in enumerate(label_names, 1)
    ],
    series_instance_uid=hd.UID(),
    series_number=100,
    sop_instance_uid=hd.UID(),
    instance_number=1,
    manufacturer="NextEd",
    device_serial_number="0",
    software_versions="NextEd v2.0",
)
seg.save_as("segmentation.dcm")
```

**Critical detail:** highdicom infers input format from array dimensions. 3D array (Z, Y, X) is treated as label map form. 4D array (segments, Z, Y, X) is treated as stacked binary segments. For NextEd's uint8 label masks, pass the 3D array directly.

**Required metadata:** DICOM-SEG requires `SegmentedPropertyCategory` and `SegmentedPropertyType` coded concepts for each segment. For generic research use, use the standard coding: category = `(T-D0050, SRT, "Tissue")`, type = `(T-D0050, SRT, "Tissue")`. These are required by the DICOM standard but can be generic.

**Why NOT manual pydicom construction:** DICOM-SEG has complex requirements: Shared/Per-Frame Functional Group Sequences, Segment Sequence with algorithm identification, Derivation Image Sequences linking to source images. Getting this right manually is hundreds of lines of brittle code. highdicom handles all of it correctly and is maintained by the Imaging Data Commons team (who also maintain the DICOM standard tools).

### FastAPI WebSocket -- Event Streaming (No New Dependency)

**What it does:** FastAPI's built-in WebSocket support (via Starlette) provides `@app.websocket()` endpoints with `await websocket.accept()`, `await websocket.send_json()`, and `await websocket.receive_text()`.

**Connection manager pattern:**

```python
class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active.remove(ws)

    async def broadcast(self, message: dict):
        for ws in self.active:
            try:
                await ws.send_json(message)
            except Exception:
                self.active.remove(ws)
```

**Event types to push:**
- `volume_added` -- new volume discovered by watcher
- `volume_removed` -- volume files deleted
- `segmentation_saved` -- segmentation written to disk

**Client reconnection:** The browser `WebSocket` API does not auto-reconnect. The client needs a simple reconnect loop with exponential backoff. This is ~15 lines of JS.

**Why NOT socket.io / python-socketio:** Socket.IO adds rooms, namespaces, automatic reconnection, and fallback transports (long-polling). NextEd is single-user, local-only, with one event channel. Socket.IO's abstractions are unnecessary overhead and add two dependencies (python-socketio, python-engineio). Native WebSocket is simpler and sufficient.

**Why NOT Server-Sent Events (SSE):** SSE is unidirectional (server to client only). While sufficient for push notifications, WebSocket allows future bidirectional communication (e.g., client requesting catalog refresh, sending commands). The implementation complexity is nearly identical.

### DICOMweb WADO-RS -- Custom Endpoints (No New Dependency)

**What it does:** WADO-RS defines REST URL patterns for retrieving DICOM objects. The key endpoints for NextEd:

```
GET /api/v1/wado-rs/studies/{study}/series/{series}/instances/{instance}
  Accept: multipart/related; type=application/dicom
  Response: multipart/related containing DICOM Part 10 file bytes

GET /api/v1/wado-rs/studies/{study}/series/{series}
  Accept: multipart/related; type=application/dicom
  Response: multipart/related containing all instances in series
```

**Implementation approach:** FastAPI `StreamingResponse` with `multipart/related` content type. Each DICOM instance is a MIME part with `Content-Type: application/dicom`. pydicom reads the files, and we stream the raw bytes.

**Scope decision:** Implement ONLY retrieve (WADO-RS), not store (STOW-RS) or query (QIDO-RS). NextEd discovers volumes from the filesystem, not from network DICOM operations. WADO-RS is implemented so that external DICOM viewers could consume NextEd's served volumes -- interoperability, not ingestion.

**Why NOT dicomweb-client:** That library is a client for consuming DICOMweb servers. NextEd IS the server. There is no Python library for serving DICOMweb -- you implement the REST convention in your framework.

**Multipart response format:**

```
Content-Type: multipart/related; type="application/dicom"; boundary=boundary123

--boundary123
Content-Type: application/dicom

[DICOM Part 10 bytes for instance 1]
--boundary123
Content-Type: application/dicom

[DICOM Part 10 bytes for instance 2]
--boundary123--
```

This is straightforward to construct with FastAPI's `StreamingResponse` and a generator function.

## Installation

```bash
# New dependencies only (run from server/)
uv add "watchdog>=6.0" "highdicom>=0.24"
```

**Updated pyproject.toml dependencies block will be:**

```toml
dependencies = [
    "fastapi>=0.115",
    "uvicorn>=0.30",
    "pydicom>=2.4",
    "nibabel>=5.2",
    "numpy>=1.26",
    "scipy>=1.12",
    "scikit-image>=0.22",
    "python-multipart>=0.0.9",
    "watchdog>=6.0",
    "highdicom>=0.24",
]
```

No new client-side (npm) dependencies are needed. WebSocket is a browser-native API.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| watchdog | watchfiles (Rust-based) | If you only need simple "files changed" notifications without event type classification. watchfiles is faster for large directory trees but lacks the event handler abstraction. |
| watchdog | Manual polling (os.scandir loop) | Never. Polling wastes CPU and has latency. OS-native watchers are strictly superior. |
| highdicom LABELMAP | highdicom BINARY | If segments can overlap (e.g., "lung" and "tumor" can share voxels). BINARY stores per-segment planes. NextEd uses non-overlapping labels, so LABELMAP is correct. |
| highdicom | dcmqi (C++ tool) | If you need CLI batch conversion outside Python. Not suitable as a library dependency. |
| Native WebSocket | python-socketio | If scaling to multiple server instances with many concurrent users. NextEd is single-user local. |
| Native WebSocket | SSE (Server-Sent Events) | If you are certain no client-to-server messages will ever be needed. WebSocket keeps the door open. |
| Custom WADO-RS | Orthanc (C++ DICOM server) | If you need a full-featured PACS. Orthanc is a separate server process, not a library. Overkill for NextEd's use case. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| python-socketio / socket.io | Adds 2 dependencies, rooms/namespaces complexity for a single-user app | FastAPI native WebSocket |
| watchgod (old name) | Renamed to watchfiles, watchgod is unmaintained | watchdog (different project entirely) |
| highdicom < 0.24 | No LABELMAP support; forced to use BINARY with per-segment planes | highdicom >= 0.24 |
| aiofiles for watching | aiofiles is for async file I/O, not filesystem monitoring | watchdog |
| hachiko (async watchdog wrapper) | Unmaintained (last commit 2019), unnecessary since Observer thread + call_soon_threadsafe works fine | watchdog directly |
| dicomweb-server packages | No mature Python DICOMweb server library exists; the few that do are unmaintained or tightly coupled to their own storage backends | Custom FastAPI endpoints |

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| watchdog >=6.0 | Python >=3.9 | NextEd requires Python >=3.11, so no conflict |
| highdicom >=0.24 | pydicom >=2.0, numpy >=1.21 | NextEd already has pydicom >=2.4 and numpy >=1.26, fully compatible |
| highdicom >=0.24 | Python >=3.10 | NextEd requires >=3.11, no conflict |
| FastAPI WebSocket | starlette (bundled) | WebSocket support is part of Starlette, which FastAPI bundles. No version concern. |

## Integration Architecture Summary

```
Filesystem Events                  Client Browser
       |                                 |
  [watchdog Observer]              [WebSocket]
  (daemon thread)                  (native API)
       |                                |
  call_soon_threadsafe          reconnect loop
       |                                |
  [async event handler]    <----->  [FastAPI WS endpoint]
       |                                |
  [catalog re-scan]             [volume list refresh]
       |
  [broadcast via ConnectionManager]
       |
  [WADO-RS endpoints]  <-- external DICOM viewers
  [binary stream]       <-- NextEd client (NIfTI volumes)
       |
  [highdicom DICOM-SEG] --> save segmentation for DICOM sources
  [nibabel NIfTI]       --> save segmentation for NIfTI sources
```

## Sources

- [watchdog on PyPI](https://pypi.org/project/watchdog/) -- version 6.0.0 confirmed, Python 3.9+ requirement
- [watchdog GitHub releases](https://github.com/gorakhargosh/watchdog/releases) -- changelog for 6.0.0 changes
- [highdicom documentation](https://highdicom.readthedocs.io/en/latest/seg.html) -- LABELMAP API, version 0.27.0
- [highdicom GitHub releases](https://github.com/ImagingDataCommons/highdicom/releases) -- LABELMAP introduced in 0.24.0
- [FastAPI WebSocket docs](https://fastapi.tiangolo.com/advanced/websockets/) -- built-in WebSocket support
- [DICOM Standard WADO-RS](https://www.dicomstandard.org/using/dicomweb/retrieve-wado-rs-and-wado-uri/) -- multipart/related response format
- [watchdog asyncio integration gist](https://gist.github.com/mivade/f4cb26c282d421a62e8b9a341c7c65f6) -- call_soon_threadsafe pattern

---
*Stack research for: NextEd v2.0 new capabilities*
*Researched: 2026-03-30*

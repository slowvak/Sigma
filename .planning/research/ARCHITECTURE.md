# Architecture Patterns: v2.0

**Domain:** Medical image server — folder monitoring, DICOMweb, WebSocket, format-aware segmentation
**Researched:** 2026-03-31
**Confidence:** HIGH

## Existing Architecture (v1.0)

```
server/
├── main.py              # Startup scan, volume discovery, registration
├── api/
│   ├── volumes.py       # Volume list, metadata, binary data endpoints
│   └── segmentations.py # Segmentation CRUD, NIfTI save
├── loaders/
│   ├── nifti_loader.py  # NIfTI loading with RAS+ normalization
│   └── dicom_loader.py  # DICOM series loading, affine computation
└── catalog/
    └── models.py        # VolumeMetadata, SegmentationMetadata

client/src/
├── main.js              # App init, volume open workflow
├── api.js               # REST client (fetchVolumes, fetchVolumeData, etc.)
├── ui/                  # Volume list, detail panel, presets
└── viewer/              # ViewerState, ViewerPanel, slice extraction, etc.
```

**Current data flow:**
1. `main.py` scans folders at startup → builds in-memory registries
2. Client fetches volume list → selects volume → fetches binary data
3. Volume loaded as Float32Array in browser → client-side slice rendering
4. Segmentation edits stored client-side → POST binary to server → save as NIfTI

## New Components for v2.0

### Server-Side Additions

```
server/
├── watcher/
│   ├── folder_monitor.py    # watchdog Observer, debounced event handling
│   └── catalog.py           # Thread-safe catalog with add/remove/notify
├── dicomweb/
│   └── wado.py              # WADO-RS retrieve endpoints (series, instance, metadata)
├── ws/
│   └── events.py            # WebSocket endpoint, ConnectionManager, event types
├── loaders/
│   └── seg_writer.py        # DICOM-SEG writer (highdicom) + existing NIfTI save
└── api/
    └── volumes.py           # Extended with study/series UIDs, versioned routes
```

### Modified Existing Components

| File | Change | Why |
|------|--------|-----|
| `main.py` | Start watchdog Observer in lifespan; pass catalog to watcher | Watcher needs catalog reference and async loop |
| `api/volumes.py` | Add `/api/v1/` prefix; add study/series UIDs to responses | API versioning + DICOM hierarchy |
| `api/segmentations.py` | Format branching: DICOM-SEG vs NIfTI based on parent volume | Format-aware storage |
| `loaders/dicom_loader.py` | Retain file paths (or Dataset references) after loading | WADO-RS needs raw DICOM files; highdicom needs source Datasets |
| `catalog/models.py` | Add `study_instance_uid`, `series_instance_uid`, `source_datasets_path` to VolumeMetadata | WADO-RS URL construction + DICOM-SEG creation |
| `client/src/api.js` | Change base URL to `/api/v1/`; add WebSocket connection | API migration + real-time events |

### Unchanged Components

| Component | Why Unchanged |
|-----------|---------------|
| `viewer/ViewerState.js` | Receives same Float32Array; no API awareness |
| `viewer/ViewerPanel.js` | Canvas rendering unchanged |
| `viewer/sliceExtractor.js` | Pure math, no API coupling |
| `viewer/overlayBlender.js` | Segmentation overlay rendering unchanged |
| `loaders/nifti_loader.py` | NIfTI loading logic unchanged |

## Integration Points

### 1. Watcher → Catalog → WebSocket

```
watchdog Observer (daemon thread)
    │ on_created / on_deleted / on_modified
    ▼
VolumeEventHandler (debounce 2s)
    │ call_soon_threadsafe
    ▼
async _handle_fs_event(path, event_type)
    │
    ├─ classify file (NIfTI or DICOM)
    ├─ add/remove from catalog registries
    │   (_metadata_registry, _path_registry, _segmentation_catalog)
    └─ broadcast via ConnectionManager
        │
        ▼
    WebSocket clients receive JSON event
```

**Thread safety:** The catalog registries are Python dicts accessed from both the watchdog thread (via `call_soon_threadsafe`) and the async request handlers. Since `call_soon_threadsafe` dispatches to the event loop, all catalog mutations happen on the main async thread — no locks needed.

### 2. DICOM Loader → WADO-RS + DICOM-SEG

The current DICOM loader discards pydicom Datasets after extracting pixel data. Both WADO-RS (serving raw DICOM files) and DICOM-SEG writing (highdicom needs source Datasets) require access to the original files.

**Solution:** Store the list of DICOM file paths in the catalog alongside metadata. Don't keep Datasets in memory (too large). Re-read from disk when needed:
- WADO-RS: stream raw file bytes directly (no pydicom parsing needed)
- DICOM-SEG: re-read source Datasets with pydicom (one-time cost at save time)

### 3. Segmentation Save — Format Branching

```
POST /api/v1/volumes/{id}/segmentations
    │
    ├─ vol_meta.format == "nifti"
    │   └─ existing NIfTI save path (nibabel)
    │
    └─ vol_meta.format == "dicom_series"
        ├─ re-read source DICOM Datasets from file paths
        ├─ map labels → SegmentDescription objects
        └─ highdicom.seg.Segmentation → save as .dcm
```

### 4. Client API Migration

```javascript
// Before (v1.0)
const API_BASE = '/api';

// After (v2.0)
const API_BASE = '/api/v1';

// New: WebSocket connection
const ws = new WebSocket(`ws://${location.host}/api/v1/ws/events`);
ws.onmessage = (e) => {
    const event = JSON.parse(e.data);
    if (event.type === 'volume_added') addVolumeToList(event.data);
    if (event.type === 'volume_removed') removeVolumeFromList(event.id);
};
```

## Suggested Build Order

```
Phase 5: Foundation (API versioning + DICOM loader refactor)
   └─ Low risk, unblocks everything else

Phase 6: Folder Monitoring + WebSocket Events
   └─ Core user-facing feature; watcher + events are tightly coupled

Phase 7: Format-Aware Segmentation Storage
   └─ DICOM-SEG via highdicom; depends on loader refactor from Phase 5

Phase 8: DICOMweb WADO-RS + Client Migration
   └─ Highest complexity; interoperability feature
   └─ Client API migration happens here (all endpoints stable)
```

**Rationale:** API versioning first because it's zero-risk and every new endpoint uses the versioned prefix. Folder monitoring second because it's the primary user-facing promise. DICOM-SEG third because it completes the editing workflow. WADO-RS last because it's the highest complexity and primarily benefits external tool interoperability.

## Sources

- Existing codebase analysis
- FastAPI lifespan events documentation
- watchdog Observer threading model
- highdicom Segmentation API

---
*Architecture research for: NextEd v2.0*
*Researched: 2026-03-31*

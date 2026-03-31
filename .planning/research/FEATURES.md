# Feature Landscape

**Domain:** Medical image server infrastructure -- folder monitoring, DICOMweb WADO-RS, WebSocket events, format-aware segmentation storage
**Researched:** 2026-03-30
**Scope:** v2.0 milestone features ONLY (viewer/editor features already built in v1.0)
**Confidence:** MEDIUM-HIGH

## Table Stakes

Features the v2.0 milestone must deliver. Missing any makes the "image server" restructure feel incomplete.

| Feature | Why Expected | Complexity | Dependencies on Existing | Notes |
|---------|--------------|------------|--------------------------|-------|
| **Auto-discover new volumes on folder change** | Core promise of "folder monitoring." Without it, users restart the server when new scans arrive. | Medium | Extends `_discover_all()` in `main.py`. Reuses `_discover_nifti_volumes()` and `_discover_dicom_series()`. | Watchdog library handles cross-platform FS events (macOS FSEvents, Linux inotify). Main complexity is debouncing -- a DICOM series arrives as dozens of files over seconds -- and thread-safe catalog mutation. |
| **Detect removed volumes** | Symmetric with add detection. Stale catalog entries confuse users when files are deleted or moved. | Low | Needs removal from `_catalog`, `_metadata_registry`, `_path_registry`, `_volume_cache`, and `_segmentation_catalog`. | Watchdog `FileDeletedEvent` or periodic existence check on registered paths. Must also evict loaded pixel data from `_volume_cache`. |
| **WebSocket volume_added / volume_removed events** | Client must know about catalog changes without polling. Polling is wasteful and introduces visible latency. | Medium | New server module. Client `api.js` needs WebSocket connection and reconnect logic. | FastAPI has native WebSocket support. Use ConnectionManager pattern: a class that tracks active connections and provides `broadcast(event)`. Each event is a JSON message with `type` and `data` fields. |
| **Client reactive volume list** | When server pushes volume_added, the volume list panel must update without page reload. | Low | Modifies client volume list rendering. Currently fetched once via `fetchVolumes()` in `api.js`. | Append to or remove from existing list on WebSocket message. No full re-fetch needed. |
| **WADO-RS series-level pixel retrieval** | Minimum useful DICOMweb endpoint. Enables other DICOM viewers (OHIF, Horos, 3D Slicer DICOMweb browser) to pull pixel data from NextEd. Standard interoperability. | High | Leverages existing `load_dicom_series()` but must return multipart/related response containing raw DICOM PS3.10 files, not extracted numpy arrays. Requires retaining original pydicom Dataset objects. | URL pattern: `/api/v1/wado-rs/studies/{study}/series/{series}`. Response content-type: `multipart/related; type="application/dicom"`. Each part is a raw .dcm file with proper boundary separators. This is the hardest feature in the milestone. |
| **WADO-RS metadata retrieval** | Companion to pixel retrieval. Clients query metadata (JSON) before deciding to fetch full pixel data. | Medium | Existing `VolumeMetadata` model has some fields; DICOM JSON metadata format requires full tag-level output from pydicom datasets. | URL pattern: `/api/v1/wado-rs/studies/{study}/series/{series}/metadata`. Return DICOM tags as JSON per PS3.18 using pydicom's `Dataset.to_json_dict()`. |
| **Binary stream for NIfTI volumes (versioned)** | NIfTI has no web standard equivalent to DICOMweb. Current binary stream approach is correct; just needs `/api/v1/` prefix. | Low | Existing `get_volume_data()` endpoint moves under versioned prefix. Zero behavior change. | Route migration only. |
| **Unified volume list with study/series hierarchy** | Single endpoint returning both DICOM and NIfTI volumes. DICOM entries need study/series UIDs for proper hierarchical display. | Medium | Extends current `list_volumes()` which returns a flat list. Needs `study_instance_uid` and `series_instance_uid` on `VolumeMetadata`. | Client groups DICOM volumes by study when displaying. NIfTI volumes appear ungrouped (no study concept). |
| **DICOM-SEG save for DICOM sources** | When parent volume is DICOM, segmentation must save as DICOM-SEG, not NIfTI. This is the format-aware promise. Without it, segmentations of DICOM volumes are orphaned NIfTI files that other DICOM tools cannot read. | High | Current `save_segmentation()` always writes NIfTI. Needs format branching based on `vol_meta.format`. Requires highdicom library + source DICOM datasets in memory. | highdicom `Segmentation` constructor needs: source DICOM datasets (list[pydicom.Dataset]), segment descriptions (SegmentDescription with coding), pixel array (uint8 numpy), segmentation type (BINARY or FRACTIONAL). Must keep source datasets accessible after DICOM loading -- current loader discards them. |
| **NIfTI segmentation save (unchanged)** | Already works. Must continue working under format-aware routing. | None | Existing `save_segmentation()` code path in `segmentations.py`. | No change needed; format branch routes DICOM sources to DICOM-SEG and NIfTI sources to existing NIfTI code. |
| **Automatic format selection** | User should not choose between DICOM-SEG and NIfTI. The server decides based on parent volume format. | Low | Read `vol_meta.format` in save endpoint. | Simple conditional. The client sends the same binary mask regardless; the server picks the output format. |
| **API versioning under /api/v1/** | Standard practice for evolving APIs. Enables future breaking changes without disrupting existing clients. | Low | All existing routes (`/api/volumes`, `/api/segmentations`) gain `/v1/` prefix. Client `API_BASE` changes from `/api` to `/api/v1`. | FastAPI APIRouter prefix change. Can keep old routes as redirects during transition or remove outright (single-user tool, no backward compat concern). |

## Differentiators

Features that add value beyond the basic requirements. Not strictly needed for milestone completion but significantly improve the user/developer experience.

| Feature | Value Proposition | Complexity | Dependencies on Existing | Notes |
|---------|-------------------|------------|--------------------------|-------|
| **Debounced batch discovery for DICOM series** | A DICOM series arrives as dozens to hundreds of individual .dcm files written sequentially by a scanner or PACS export. Without debouncing, the catalog thrashes with incomplete series -- a volume appears, disappears, reappears as files trickle in. | Medium | Extends watchdog event handler. Batch events by parent directory; wait for quiescence (2-3 seconds of no new files in that directory) before triggering `_discover_dicom_series()`. | Critical for real-world DICOM workflows. NIfTI files arrive as single .nii.gz files so debouncing is less important for them, but still useful if the file is being copied (modified events during write). |
| **segmentation_added WebSocket event** | When a segmentation is saved (by this user or detected via folder monitoring), push event so other browser tabs see it immediately. | Low | Extends WebSocket event system; trivial addition once infrastructure exists. | Small effort, nice consistency. |
| **WADO-RS instance-level retrieval** | Retrieve a single DICOM instance by SOP Instance UID. More granular than series-level. Some clients request instance-by-instance. | Low-Medium | Same infrastructure as series retrieval but returns single part. | URL: `/api/v1/wado-rs/studies/{study}/series/{series}/instances/{instance}`. Lower priority than series-level. |
| **Volume eviction from memory cache** | When monitoring folders with many studies, `_volume_cache` grows unbounded. LRU eviction prevents memory exhaustion. | Low-Medium | Replace `_volume_cache` dict with bounded LRU structure (e.g., `collections.OrderedDict` with size limit or `cachetools.LRUCache`). | Not needed for typical single-user use with <10 volumes, but matters if monitoring a large research folder tree. |
| **Startup reconciliation** | On server restart, compare cached catalog against filesystem to detect changes that occurred while server was down. | Low | Extends existing cache validation in `_load_cache()` / `_compute_cache_key()`. | Current cache key uses path list hash, which already handles this partially. Needs to also detect modified files (mtime check). |
| **WebSocket reconnection with state sync** | When a client reconnects after network interruption, it receives the current catalog state (not just future events). | Low | Client sends "sync" message on connect; server responds with full volume list before streaming events. | Prevents stale UI after brief disconnections. Pattern: connect -> receive full state -> receive incremental events. |

## Anti-Features

Features to explicitly NOT build in this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **STOW-RS (store via web)** | NextEd monitors folders; it does not accept uploads via DICOMweb API. Adding STOW-RS creates a second ingestion path that conflicts with the folder-monitoring model and introduces complexity around storage location decisions. | Users place files in monitored folders. Watchdog discovers them. |
| **QIDO-RS (search via web)** | Full DICOMweb search requires queryable indexes on dozens of DICOM tags (PatientID, StudyDate, AccessionNumber, etc.). Significant effort, and NextEd's own client uses its own volume list API. | Implement only WADO-RS (retrieve). NextEd's own `/api/v1/volumes` endpoint serves as the search/browse mechanism. Consider QIDO-RS in a future milestone if interoperability demand emerges. |
| **Full DICOMweb PS3.18 conformance** | The spec is enormous with many optional parameters, query attributes, and response variations. Full conformance is a multi-month effort. | Implement the subset needed: WADO-RS RetrieveSeries, RetrieveInstance, RetrieveMetadata. Document which optional features are unsupported. |
| **Polling-based catalog refresh** | WebSocket push is the correct pattern for this use case. Adding a polling endpoint alongside WebSocket creates two mechanisms for the same thing, doubles testing surface, and tempts clients to poll. | WebSocket only for real-time updates. Client reconnects on disconnect with exponential backoff. Full catalog available via GET on reconnect. |
| **DICOM-RT Structure Set export** | DICOM-RT (Radiation Therapy) structures use contour-based representation, not voxel masks. Different IOD, different tools, different clinical workflow. | DICOM-SEG only for voxel segmentations. If RT structure export is needed, that is a separate feature with its own research. |
| **Multi-frame DICOM handling** | Explicitly out of scope per PROJECT.md. Multi-frame DICOMs (enhanced MR, ultrasound cine) require fundamentally different loading, navigation, and WADO-RS response construction. | Skip multi-frame files during discovery with a clear log message. Document the limitation. |
| **Authentication on WebSocket/API** | Single-user local tool per project constraints. Auth adds complexity for zero value in this deployment model. | No auth. If multi-user is ever needed, it is a separate milestone. |
| **Server-Sent Events (SSE) alternative** | SSE is unidirectional (server-to-client only). WebSocket is bidirectional, which is useful for future features (client requesting specific catalog operations). WebSocket is the right choice here. | WebSocket only. |

## Feature Dependencies

```
API Versioning (/api/v1/)
  --> All routes migrate (prerequisite for everything else)

Folder Monitoring (watchdog)
  --> Volume Discovery (reuses _discover_nifti_volumes, _discover_dicom_series)
    --> Catalog Registration (reuses _register_entries)
      --> WebSocket Events (volume_added / volume_removed)
        --> Client Reactive List (updates UI on WS message)

DICOM Loader Refactor (retain pydicom Datasets)
  --> WADO-RS Endpoints (need raw DICOM files for multipart response)
  --> DICOM-SEG Save (highdicom needs source Datasets)

DICOM-SEG Save
  --> Requires source DICOM datasets (from loader refactor)
  --> Requires highdicom library
  --> Requires label-to-segment-description mapping
  --> Requires format detection (vol_meta.format == "dicom_series")

Unified Volume List
  --> Requires study_instance_uid / series_instance_uid on VolumeMetadata
  --> Client hierarchy display (group DICOM by study)
```

**Critical architectural dependency:** Both WADO-RS and DICOM-SEG require access to original pydicom.Dataset objects. The current DICOM loader (`load_dicom_series` in `dicom_loader.py`) extracts pixel data into numpy arrays and discards the Dataset objects. This must change: the loader needs to retain source datasets (or at minimum their file paths for re-reading). This refactor is the hidden prerequisite that unblocks the two hardest features.

## MVP Recommendation

Prioritize in this order (each group can be a phase):

**Phase 1 -- Foundation:**
1. API versioning (`/api/v1/` prefix migration)
2. DICOM loader refactor to retain source datasets / file paths

**Phase 2 -- Folder Monitoring + Events:**
1. Watchdog integration with debounced discovery
2. Catalog add/remove on filesystem changes
3. WebSocket event infrastructure (ConnectionManager)
4. Client WebSocket connection + reactive volume list

**Phase 3 -- Format-Aware Storage:**
1. DICOM-SEG save via highdicom (format auto-detection)
2. Segment description mapping from labels

**Phase 4 -- DICOMweb:**
1. WADO-RS series retrieval (multipart/related response)
2. WADO-RS metadata retrieval (DICOM JSON)
3. Unified volume list with study/series hierarchy

**Rationale for ordering:**
- API versioning is zero-risk and unblocks clean URL structure for everything else.
- Folder monitoring is the core user-facing promise; ship it early for feedback.
- DICOM-SEG completes the editing workflow for DICOM sources -- high user value.
- WADO-RS is the highest complexity and primarily benefits interoperability (external tools), not NextEd's own UI. Build it last so the rest of the milestone is not blocked by it.

Defer to later milestone:
- **QIDO-RS**: Search adds interoperability but NextEd's client does not need it.
- **WADO-RS rendered frames**: Nice for thumbnails but NextEd renders client-side.
- **Volume cache eviction**: Only matters at scale; restart suffices for now.

## Complexity Budget

| Feature | Estimated Effort | Risk Level | Risk Notes |
|---------|-----------------|------------|------------|
| API versioning | 1-2 hours | None | Pure routing change |
| DICOM loader refactor | 0.5-1 day | Medium | Must not break existing volume loading; need to cache file paths or Datasets without doubling memory |
| Watchdog + debounced discovery | 1-2 days | Medium | Debouncing DICOM series arrivals is subtle; thread safety with FastAPI's async loop |
| WebSocket events (server) | 0.5-1 day | Low | FastAPI WebSocket is well-documented; ConnectionManager is ~30 lines |
| Client WebSocket + reactive list | 0.5 day | Low | Append/remove from existing list; reconnect with backoff |
| DICOM-SEG save (highdicom) | 1-2 days | High | DICOM-SEG spec is complex; segment metadata mapping (label name/value to coded concepts); need to test round-trip with other viewers |
| WADO-RS series + metadata | 1-2 days | High | Multipart/related response construction; DICOM JSON format; boundary handling |
| Unified volume list + hierarchy | 0.5 day | Low | Extend VolumeMetadata model; client grouping logic |

**Total estimated effort:** 5-9 days of focused development.

## Sources

- [Watchdog PyPI](https://pypi.org/project/watchdog/) -- Python filesystem monitoring library, cross-platform (macOS FSEvents, Linux inotify)
- [Watchdog GitHub](https://github.com/gorakhargosh/watchdog) -- Source and documentation
- [DICOMweb WADO-RS specification](https://www.dicomstandard.org/using/dicomweb/retrieve-wado-rs-and-wado-uri/) -- Official DICOM standard for web-based retrieval
- [WADO-RS PS3.18 section 6.5](https://dicom.nema.org/dicom/2013/output/chtml/part18/sect_6.5.html) -- Request/response specification
- [highdicom SEG documentation](https://highdicom.readthedocs.io/en/latest/seg.html) -- DICOM-SEG creation with highdicom v0.27.0
- [highdicom Quick Start](https://highdicom.readthedocs.io/en/latest/quickstart.html) -- Getting started with highdicom
- [FastAPI WebSockets](https://fastapi.tiangolo.com/advanced/websockets/) -- Native WebSocket support
- [FastAPI WebSocket broadcast patterns](https://gist.github.com/francbartoli/2532f8bd8249a4cefa32f9c17c886a4b) -- ConnectionManager broadcast example
- [dicomweb-client docs](https://dicomweb-client.readthedocs.io/en/latest/usage.html) -- Reference for expected WADO-RS client behavior
- Existing codebase: `server/main.py`, `server/api/volumes.py`, `server/api/segmentations.py`, `server/loaders/dicom_loader.py`, `client/src/api.js`

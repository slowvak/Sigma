# Phase 08: DICOMweb WADO-RS - Context

**Gathered:** 2026-04-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Standard DICOMweb WADO-RS endpoints for retrieving DICOM series pixel data and metadata. Enables interoperability with external DICOM viewers (OHIF, 3D Slicer). Series-level retrieval only — instance-level retrieval is deferred (WADO-03). NIfTI volumes are not exposed through WADO-RS.

</domain>

<decisions>
## Implementation Decisions

### URL Scheme & Scope
- **D-01:** Series-level retrieval only: `GET /api/v1/wado-rs/studies/{study_uid}/series/{series_uid}` for pixel data, `/metadata` suffix for metadata. Instance-level endpoints deferred to future WADO-03.
- **D-02:** WADO-RS endpoints use Study/Series UIDs as path parameters (not volume IDs). NIfTI volumes have no UIDs and are invisible to WADO-RS — no 404, simply not discoverable.
- **D-03:** Mount under `/api/v1/wado-rs/` prefix, consistent with existing API versioning. No `/dicomweb/` alias.

### Multipart Response Format
- **D-04:** Each part uses `Content-Type: application/dicom` per PS3.18 default. Maximum viewer compatibility.
- **D-05:** No Transfer Syntax negotiation. Serve DICOM files in their original transfer syntax as-is from disk. PS3.18 allows this.
- **D-06:** Use FastAPI `StreamingResponse` to stream DICOM files one at a time from disk. Read file, write multipart boundary + file bytes, yield. Memory-efficient for large series (500+ slices).

### Metadata JSON
- **D-07:** Full tag dump — read each DICOM file header (`stop_before_pixels=True`), convert all non-pixel tags to PS3.18 JSON format. External viewers expect rich metadata.
- **D-08:** Include BulkDataURI references for PixelData and large binary tags per PS3.18. URI points to the series retrieve endpoint (since instance-level is deferred, BulkDataURI can reference the series-level retrieve with instance context).
- **D-09:** Use pydicom's built-in `Dataset.to_json_dict()` for PS3.18 JSON model. Handles VR types, sequences, PersonName correctly. Less custom code, battle-tested.

### Error Handling
- **D-10:** If any DICOM file in a series is missing from disk, fail the entire request with appropriate HTTP error. No partial responses.
- **D-11:** Error responses use JSON format (`{"detail": "..."}`) matching existing FastAPI API endpoints. No PS3.18 XML error format.

### Claude's Discretion
- Multipart boundary string generation strategy
- Whether to read DICOM files sequentially or use async file I/O for streaming
- Internal code organization (single module vs separate retrieve/metadata handlers)
- How to look up Study/Series UIDs → file paths (scan `_path_registry` or build a UID index)
- BulkDataURI format and whether to include a Bulk Data retrieve endpoint or just reference the series retrieve

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — Phase 8 covers WADO-01, WADO-02. WADO-03 (instance-level) explicitly deferred.

### Prior Phase Context
- `.planning/phases/07-format-aware-segmentation-storage/07-CONTEXT.md` — DICOM file paths in `_path_registry`, Study/Series UIDs in `VolumeMetadata`
- `.planning/phases/06-folder-monitoring-websocket-events/06-CONTEXT.md` — Watcher event protocol, catalog structure

### Code (Key Integration Points)
- `server/api/volumes.py` — `_path_registry` (volume_id → (path, format)), `_metadata_registry` (volume_id → VolumeMetadata)
- `server/catalog/models.py` — `VolumeMetadata` fields: `study_instance_uid`, `series_instance_uid`, `format`
- `server/main.py` — `_catalog` list, router mounting, app lifecycle
- `server/loaders/dicom_loader.py` — DICOM file reading patterns, `pydicom.dcmread` usage

### No External Specs
Requirements fully captured in decisions above. PS3.18 DICOMweb standard is reference material but not a project doc.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `_path_registry` in `volumes.py`: Maps volume_id → (path, format). For DICOM series, path is JSON-encoded list of file paths — direct source for WADO-RS file streaming.
- `_metadata_registry` in `volumes.py`: Maps volume_id → VolumeMetadata with `study_instance_uid` and `series_instance_uid` — needed for UID → volume_id lookup.
- `pydicom.dcmread(path, stop_before_pixels=True)` pattern used in `dicom_seg_writer.py` — reusable for metadata endpoint.
- `Dataset.to_json_dict()` available in pydicom — direct fit for D-09.

### Established Patterns
- All API routers mount under `/api/v1/` via `APIRouter(prefix="/api/v1/...")` in individual modules, then `app.include_router()` in `main.py`.
- Error responses use `HTTPException(status_code=..., detail=...)` throughout.
- Streaming not yet used in existing endpoints — WADO-RS will be the first `StreamingResponse` usage.

### Integration Points
- New `server/api/wado.py` router included in `main.py`
- Needs to access `_path_registry` and `_metadata_registry` from `volumes.py` for UID → file path resolution
- No client changes needed — WADO-RS is for external viewer interop, not NextEd's own client

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches following PS3.18 patterns.

</specifics>

<deferred>
## Deferred Ideas

- WADO-03 (instance-level retrieval by SOP Instance UID) — future requirement, not in Phase 8 scope
- `/dicomweb/` alias endpoint for PACS convention compatibility
- Transfer Syntax negotiation and transcoding
- Partial series streaming (return available files when some are missing)

</deferred>

---

*Phase: 08-dicomweb-wado-rs*
*Context gathered: 2026-04-06*

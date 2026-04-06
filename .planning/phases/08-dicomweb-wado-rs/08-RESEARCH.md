# Phase 08: DICOMweb WADO-RS - Research

**Researched:** 2026-04-06
**Domain:** DICOMweb WADO-RS / multipart MIME / pydicom JSON
**Confidence:** HIGH

## Summary

Phase 8 adds two DICOMweb WADO-RS endpoints: series-level instance retrieval (multipart/related binary) and series-level metadata retrieval (PS3.18 JSON). The core technical challenges are (1) constructing a correct multipart/related MIME response that streams DICOM files efficiently, and (2) converting DICOM datasets to PS3.18-compliant JSON using pydicom's built-in `to_json_dict()`.

The existing codebase already has all the pieces needed: `_metadata_registry` maps volume IDs to `VolumeMetadata` (which includes `study_instance_uid` and `series_instance_uid`), `_path_registry` maps volume IDs to `(path, format)` where DICOM series paths are JSON-encoded file lists, and `pydicom.dcmread` patterns are well-established in `dicom_loader.py`. The new router follows the same `APIRouter` + `app.include_router()` pattern used by all existing endpoints.

**Primary recommendation:** Build a single `server/api/wado.py` module with two endpoints, a UID-to-paths helper that scans `_metadata_registry`/`_path_registry`, and a generator function that yields multipart/related chunks via `StreamingResponse`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Series-level retrieval only: `GET /api/v1/wado-rs/studies/{study_uid}/series/{series_uid}` for pixel data, `/metadata` suffix for metadata. Instance-level endpoints deferred to future WADO-03.
- D-02: WADO-RS endpoints use Study/Series UIDs as path parameters (not volume IDs). NIfTI volumes have no UIDs and are invisible to WADO-RS.
- D-03: Mount under `/api/v1/wado-rs/` prefix, consistent with existing API versioning. No `/dicomweb/` alias.
- D-04: Each part uses `Content-Type: application/dicom` per PS3.18 default. Maximum viewer compatibility.
- D-05: No Transfer Syntax negotiation. Serve DICOM files in their original transfer syntax as-is from disk.
- D-06: Use FastAPI `StreamingResponse` to stream DICOM files one at a time from disk. Memory-efficient for large series (500+ slices).
- D-07: Full tag dump -- read each DICOM file header (`stop_before_pixels=True`), convert all non-pixel tags to PS3.18 JSON format.
- D-08: Include BulkDataURI references for PixelData and large binary tags per PS3.18.
- D-09: Use pydicom's built-in `Dataset.to_json_dict()` for PS3.18 JSON model.
- D-10: If any DICOM file in a series is missing from disk, fail the entire request with appropriate HTTP error. No partial responses.
- D-11: Error responses use JSON format (`{"detail": "..."}`) matching existing FastAPI API endpoints.

### Claude's Discretion
- Multipart boundary string generation strategy
- Whether to read DICOM files sequentially or use async file I/O for streaming
- Internal code organization (single module vs separate retrieve/metadata handlers)
- How to look up Study/Series UIDs to file paths (scan `_metadata_registry` or build a UID index)
- BulkDataURI format and whether to include a Bulk Data retrieve endpoint or just reference the series retrieve

### Deferred Ideas (OUT OF SCOPE)
- WADO-03 (instance-level retrieval by SOP Instance UID)
- `/dicomweb/` alias endpoint for PACS convention compatibility
- Transfer Syntax negotiation and transcoding
- Partial series streaming (return available files when some are missing)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WADO-01 | WADO-RS endpoint serves all DICOM instances in a series as multipart/related response | Multipart/related MIME construction pattern, StreamingResponse generator, UID-to-paths lookup |
| WADO-02 | WADO-RS metadata endpoint returns DICOM tags as JSON per PS3.18 | pydicom `to_json_dict()` with `bulk_data_element_handler`, `stop_before_pixels=True` pattern |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FastAPI | >=0.115 | HTTP framework | Already in project; StreamingResponse for multipart |
| pydicom | 3.0.1 | DICOM read + JSON | Already installed; `dcmread()` and `to_json_dict()` |
| starlette | (bundled) | StreamingResponse | Comes with FastAPI; generator-based streaming |

### Supporting
No new dependencies needed. All required functionality exists in FastAPI + pydicom.

## Architecture Patterns

### Recommended Module Structure
```
server/
  api/
    wado.py          # New WADO-RS router (both endpoints + helpers)
  main.py            # Add include_router(wado_router)
```

Single module is sufficient given only two endpoints and shared helper logic.

### Pattern 1: UID-to-File-Paths Lookup
**What:** Scan `_metadata_registry` to find the volume_id whose `study_instance_uid` and `series_instance_uid` match the path parameters, then retrieve the JSON-encoded file list from `_path_registry`.
**When to use:** Every WADO-RS request.
**Example:**
```python
from server.api.volumes import _metadata_registry, _path_registry
import json

def _resolve_series_files(study_uid: str, series_uid: str) -> list[str]:
    """Find DICOM file paths for a given Study/Series UID pair."""
    for vol_id, meta in _metadata_registry.items():
        if (meta.study_instance_uid == study_uid
                and meta.series_instance_uid == series_uid
                and meta.format == "dicom"):
            path_str, fmt = _path_registry[vol_id]
            if fmt == "dicom_series":
                return json.loads(path_str)
    return []
```

**Important:** The `VolumeMetadata.format` field stores `"dicom"` but `_path_registry` format is `"dicom_series"`. Code must check the registry format correctly. Looking at `_discover_dicom_series()` in `main.py`, the entry format is `"dicom_series"`, and `VolumeMetadata` receives that same value. So filter on `meta.format == "dicom_series"` or just check `fmt == "dicom_series"` from the path registry.

### Pattern 2: Multipart/Related Streaming Generator
**What:** A Python generator that yields bytes for a multipart/related response -- boundary markers, per-part headers, and file content.
**When to use:** The retrieve endpoint.
**Example:**
```python
from fastapi.responses import StreamingResponse
import uuid

CRLF = b"\r\n"

def _multipart_generator(file_paths: list[str], boundary: str):
    """Yield multipart/related parts for DICOM files."""
    for fpath in file_paths:
        yield b"--" + boundary.encode() + CRLF
        yield b"Content-Type: application/dicom" + CRLF
        yield CRLF  # end of part headers
        with open(fpath, "rb") as f:
            while chunk := f.read(65536):  # 64KB chunks
                yield chunk
        yield CRLF  # CRLF after body before next boundary
    yield b"--" + boundary.encode() + b"--" + CRLF  # closing boundary

@router.get("/studies/{study_uid}/series/{series_uid}")
async def retrieve_series(study_uid: str, series_uid: str):
    files = _resolve_series_files(study_uid, series_uid)
    if not files:
        raise HTTPException(status_code=404, detail="Series not found")
    # Verify all files exist before streaming (D-10)
    for f in files:
        if not Path(f).exists():
            raise HTTPException(status_code=404, detail=f"DICOM file missing: {f}")
    boundary = uuid.uuid4().hex
    media_type = f"multipart/related; type=\"application/dicom\"; boundary={boundary}"
    return StreamingResponse(
        _multipart_generator(files, boundary),
        media_type=media_type,
    )
```

### Pattern 3: Metadata Endpoint with to_json_dict()
**What:** Read each DICOM file header-only, convert to PS3.18 JSON, collect into array.
**When to use:** The metadata endpoint.
**Example:**
```python
import pydicom

def _build_bulk_data_uri(study_uid, series_uid, sop_uid, tag):
    """Build a BulkDataURI per PS3.18."""
    # Reference the series retrieve endpoint since instance-level is deferred
    base = f"/api/v1/wado-rs/studies/{study_uid}/series/{series_uid}"
    return f"{base}/instances/{sop_uid}/bulk/{tag}"

@router.get("/studies/{study_uid}/series/{series_uid}/metadata")
async def retrieve_series_metadata(study_uid: str, series_uid: str):
    files = _resolve_series_files(study_uid, series_uid)
    if not files:
        raise HTTPException(status_code=404, detail="Series not found")
    
    metadata_list = []
    for fpath in files:
        if not Path(fpath).exists():
            raise HTTPException(status_code=404, detail=f"DICOM file missing: {fpath}")
        ds = pydicom.dcmread(fpath, stop_before_pixels=True)
        sop_uid = str(getattr(ds, "SOPInstanceUID", ""))
        
        def bulk_handler(elem):
            return _build_bulk_data_uri(study_uid, series_uid, sop_uid, f"{elem.tag:08X}")
        
        json_dict = ds.to_json_dict(bulk_data_element_handler=bulk_handler)
        metadata_list.append(json_dict)
    
    return metadata_list
```

### Anti-Patterns to Avoid
- **Loading pixel data for metadata:** Always use `stop_before_pixels=True` for the metadata endpoint. Loading pixel data wastes memory and time.
- **Building multipart response in memory:** Never concatenate all parts into a single bytes object. Use a generator with StreamingResponse.
- **Forgetting CRLF in multipart:** RFC 2046 requires CRLF (not just LF) between boundaries and headers. Use `b"\r\n"` explicitly.
- **Yielding per-file without chunking:** For large DICOM files (e.g., 50MB each), read in 64KB chunks rather than `Path.read_bytes()` to avoid memory spikes.
- **Partial UID matching:** Study and Series UIDs must both match. Do not match on Series UID alone -- the same Series UID could theoretically appear in different studies.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DICOM-to-JSON conversion | Custom tag-by-tag serialization | `pydicom.Dataset.to_json_dict()` | Handles all VR types, PersonName, Sequences, date formatting correctly per PS3.18 |
| BulkDataURI in JSON | Manual PixelData detection | `bulk_data_element_handler` parameter | pydicom identifies bulk-eligible elements by size threshold automatically |
| UUID generation | Custom boundary strings | `uuid.uuid4().hex` | Guarantees uniqueness, safe for MIME boundaries |

**Key insight:** pydicom's `to_json_dict()` does all the heavy lifting for PS3.18 JSON compliance. The only custom code needed is the bulk data handler (3 lines) and the multipart MIME framing (which is straightforward byte concatenation).

## Common Pitfalls

### Pitfall 1: Multipart Boundary in Content-Type Header
**What goes wrong:** The `media_type` parameter on `StreamingResponse` may not correctly propagate the boundary parameter to the HTTP Content-Type header.
**Why it happens:** Starlette may normalize or strip parameters from the media_type string.
**How to avoid:** Set the Content-Type directly via the `headers` dict parameter, or verify the response Content-Type includes the boundary in tests.
**Warning signs:** External viewer gets a parsing error about missing boundary.

### Pitfall 2: File Existence Check Timing
**What goes wrong:** Files could be deleted between the existence check and the streaming generator.
**Why it happens:** The generator runs lazily after the response starts streaming.
**How to avoid:** Check all files exist before starting the response (D-10 requires fail-entire-request). If a file vanishes mid-stream, the generator will raise an exception that terminates the response -- this is acceptable since the alternative (partial response) is worse.
**Warning signs:** Intermittent 500 errors when files are being moved.

### Pitfall 3: BulkDataURI Closure Bug
**What goes wrong:** The `bulk_handler` closure captures the loop variable `sop_uid` by reference, so all instances get the last SOP UID.
**Why it happens:** Python closure late-binding over loop variable.
**How to avoid:** Use default argument binding: `def bulk_handler(elem, _sop=sop_uid):` or create the handler in a factory function.
**Warning signs:** All BulkDataURIs in the metadata array reference the same SOP Instance UID.

### Pitfall 4: Missing Content-Type "type" Parameter
**What goes wrong:** The overall Content-Type header for multipart/related requires a `type` parameter indicating the media type of the root part.
**Why it happens:** Easy to forget since regular multipart/form-data doesn't need it.
**How to avoid:** Always include `type="application/dicom"` in the Content-Type header.
**Warning signs:** Strict DICOMweb clients reject the response.

### Pitfall 5: Format Field Inconsistency
**What goes wrong:** Filtering `_metadata_registry` on wrong format string.
**Why it happens:** `VolumeMetadata.format` could be `"dicom"` or `"dicom_series"` depending on how it was registered.
**How to avoid:** Check `_path_registry` format field (`fmt`) which is consistently `"dicom_series"` for multi-file DICOM volumes. Or check both.
**Warning signs:** UID lookup returns empty despite DICOM volumes being cataloged.

## Code Examples

### Complete Multipart/Related MIME Structure
```
HTTP/1.1 200 OK
Content-Type: multipart/related; type="application/dicom"; boundary=boundary123

--boundary123\r\n
Content-Type: application/dicom\r\n
\r\n
<raw DICOM file 1 bytes>
\r\n
--boundary123\r\n
Content-Type: application/dicom\r\n
\r\n
<raw DICOM file 2 bytes>
\r\n
--boundary123--\r\n
```

### pydicom to_json_dict() Output Format (PS3.18 JSON Model)
```json
{
  "00100010": {
    "vr": "PN",
    "Value": [{ "Alphabetic": "DOE^JOHN" }]
  },
  "0020000D": {
    "vr": "UI",
    "Value": ["1.2.840.113619..."]
  },
  "7FE00010": {
    "vr": "OW",
    "BulkDataURI": "/api/v1/wado-rs/studies/.../instances/.../bulk/7FE00010"
  }
}
```
Source: Verified locally with pydicom 3.0.1 `Dataset.to_json_dict()`.

### bulk_data_element_handler Signature
```python
# Handler receives a pydicom.dataelem.DataElement
# Must return a str (the BulkDataURI)
# Only called for elements exceeding bulk_data_threshold (default 1024 bytes)
def handler(data_element: pydicom.dataelem.DataElement) -> str:
    return f"https://example.com/bulk/{data_element.tag:08X}"
```
Source: Verified locally -- pydicom 3.0.1 `inspect.signature(ds.to_json_dict)`.

### PS3.18 Metadata Response Format
The metadata endpoint returns a JSON **array** of objects, one per instance:
```json
[
  { "00100010": { "vr": "PN", "Value": [{"Alphabetic": "DOE^JOHN"}] }, ... },
  { "00100010": { "vr": "PN", "Value": [{"Alphabetic": "DOE^JOHN"}] }, ... }
]
```
Content-Type: `application/dicom+json`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom DICOM-to-JSON serialization | `pydicom.Dataset.to_json_dict()` | pydicom 2.0+ | Eliminates VR-specific serialization bugs |
| Building full response in memory | StreamingResponse with generator | Standard pattern | Handles 500+ slice series without memory issues |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (via uv) |
| Config file | None (default discovery) |
| Quick run command | `python -m pytest server/tests/test_wado.py -x -q` |
| Full suite command | `python -m pytest server/tests/ -x -q` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WADO-01 | Series retrieve returns multipart/related with correct boundary and Content-Type | integration | `python -m pytest server/tests/test_wado.py::test_retrieve_series_multipart -x` | Wave 0 |
| WADO-01 | Retrieve returns 404 for unknown Study/Series UID | unit | `python -m pytest server/tests/test_wado.py::test_retrieve_series_404 -x` | Wave 0 |
| WADO-01 | Retrieve returns 404 if any file is missing from disk | unit | `python -m pytest server/tests/test_wado.py::test_retrieve_missing_file -x` | Wave 0 |
| WADO-01 | NIfTI volumes invisible to WADO-RS (not discoverable) | unit | `python -m pytest server/tests/test_wado.py::test_nifti_invisible -x` | Wave 0 |
| WADO-02 | Metadata returns JSON array with PS3.18 format | integration | `python -m pytest server/tests/test_wado.py::test_metadata_json_format -x` | Wave 0 |
| WADO-02 | Metadata includes BulkDataURI for large binary tags | unit | `python -m pytest server/tests/test_wado.py::test_metadata_bulk_data_uri -x` | Wave 0 |
| WADO-02 | Metadata returns 404 for unknown UIDs | unit | `python -m pytest server/tests/test_wado.py::test_metadata_404 -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `python -m pytest server/tests/test_wado.py -x -q`
- **Per wave merge:** `python -m pytest server/tests/ -x -q`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/tests/test_wado.py` -- covers WADO-01, WADO-02
- [ ] Test fixtures: mock DICOM files (small, minimal valid DICOM with pixel data) registered in `_metadata_registry` and `_path_registry`

### Test Strategy Notes
Tests should use FastAPI's `TestClient` (same pattern as `test_api_versioning.py`). Create minimal DICOM files using pydicom in fixtures:
```python
import pydicom
from pydicom.uid import ExplicitVRLittleEndian
import numpy as np
import tempfile

def make_test_dicom(tmp_path, sop_uid, series_uid, study_uid):
    ds = pydicom.Dataset()
    ds.SOPInstanceUID = sop_uid
    ds.SeriesInstanceUID = series_uid
    ds.StudyInstanceUID = study_uid
    ds.Rows = 4
    ds.Columns = 4
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 0
    ds.SamplesPerPixel = 1
    ds.PixelData = np.zeros((4, 4), dtype=np.uint16).tobytes()
    ds.file_meta = pydicom.Dataset()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.2"
    ds.file_meta.MediaStorageSOPInstanceUID = sop_uid
    fpath = str(tmp_path / f"{sop_uid}.dcm")
    ds.save_as(fpath, write_like_original=False)
    return fpath
```

## Open Questions

1. **BulkDataURI for stop_before_pixels reads**
   - What we know: When using `stop_before_pixels=True`, the PixelData tag is absent from the dataset, so `to_json_dict()` won't include it at all (no BulkDataURI generated).
   - What's unclear: Whether to manually inject a PixelData BulkDataURI entry into the JSON dict, since PS3.18 metadata responses should reference where to get pixel data.
   - Recommendation: Manually add a `"7FE00010": {"vr": "OW", "BulkDataURI": "..."}` entry to each instance's JSON dict after `to_json_dict()`. This is 2 lines of code and ensures viewers know pixel data is available.

2. **BulkDataURI endpoint availability**
   - What we know: BulkDataURIs are required per D-08. But there's no instance-level retrieve endpoint (deferred to WADO-03).
   - What's unclear: Whether to point BulkDataURIs at the series retrieve endpoint (which returns ALL instances) or leave them as non-functional references.
   - Recommendation: Point BulkDataURIs at a logical path like `/api/v1/wado-rs/studies/{study_uid}/series/{series_uid}/instances/{sop_uid}` even though this endpoint won't exist yet. This is forward-compatible with WADO-03 and doesn't break metadata consumers that only inspect URIs without fetching.

## Sources

### Primary (HIGH confidence)
- pydicom 3.0.1 local verification -- `to_json_dict()` signature, output format, `bulk_data_element_handler` behavior
- FastAPI `StreamingResponse` signature -- verified locally
- Existing codebase: `volumes.py`, `main.py`, `dicom_loader.py`, `catalog/models.py`

### Secondary (MEDIUM confidence)
- [PS3.18 WADO-RS Sect 6.5](https://dicom.nema.org/medical/dicom/2019a/output/chtml/part18/sect_6.5.html) -- multipart/related format, Content-Type requirements, per-part headers
- [DICOMweb WADO-RS Overview](https://www.dicomstandard.org/using/dicomweb/retrieve-wado-rs-and-wado-uri) -- URL patterns, metadata endpoints
- [pydicom JSON tutorial](https://pydicom.github.io/pydicom/stable/tutorials/dicom_json.html) -- `to_json_dict()`, `bulk_data_element_handler`
- [RFC 2387](https://datatracker.ietf.org/doc/html/rfc2387) -- multipart/related MIME structure, boundary requirements, CRLF rules

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all verified locally
- Architecture: HIGH -- follows established codebase patterns exactly, multipart/related is well-specified
- Pitfalls: HIGH -- verified MIME format requirements against RFC and PS3.18, pydicom behavior tested locally

**Research date:** 2026-04-06
**Valid until:** 2026-05-06 (stable domain, no fast-moving dependencies)

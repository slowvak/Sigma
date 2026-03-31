# Domain Pitfalls: v2.0

**Domain:** Adding folder monitoring, DICOMweb, WebSocket, DICOM-SEG to existing medical image editor
**Researched:** 2026-03-31
**Confidence:** HIGH

## Critical Pitfalls

### P1: DICOM Series Arrival Thrashing

**What goes wrong:** A DICOM series arrives as dozens to hundreds of individual .dcm files written sequentially. Without debouncing, each file triggers a catalog update — the volume appears, its slice count changes, WebSocket events fire for each file. The client sees a volume flickering in and out.

**Prevention:**
- Debounce filesystem events by parent directory. Accumulate events for 2-3 seconds of quiet before triggering discovery.
- Only run `_discover_dicom_series()` on the affected directory, not the entire tree.
- Send a single `volume_added` event after the debounce window closes.

**Which phase:** Phase 6 (Folder Monitoring)

### P2: Watchdog Thread vs Async Event Loop

**What goes wrong:** watchdog's Observer fires callbacks on its own thread. Directly modifying shared state or calling async functions from the watchdog thread causes race conditions or `RuntimeError: no running event loop`.

**Prevention:**
- Use `asyncio.get_event_loop().call_soon_threadsafe()` to dispatch from watchdog thread to the async event loop.
- All catalog mutations and WebSocket broadcasts happen on the main async thread.
- Never access FastAPI request state from the watchdog thread.

**Which phase:** Phase 6 (Folder Monitoring)

### P3: highdicom Source Dataset Requirements

**What goes wrong:** `highdicom.seg.Segmentation()` requires a list of source `pydicom.Dataset` objects — not just pixel data. The current DICOM loader extracts pixel arrays and discards Datasets. If you try to create DICOM-SEG without source Datasets, highdicom raises errors about missing required DICOM attributes.

**Prevention:**
- In Phase 5, refactor the DICOM loader to store file paths in the catalog.
- At DICOM-SEG save time, re-read source Datasets from stored paths.
- Don't keep Datasets in memory permanently — they're large and rarely needed.

**Which phase:** Phase 5 (loader refactor), Phase 7 (DICOM-SEG save)

### P4: DICOM-SEG Segment Numbering

**What goes wrong:** DICOM-SEG segment numbers must be 1-based and contiguous. NextEd's labels can have arbitrary integer values (1, 3, 7 with gaps). Passing the label mask directly to highdicom with non-contiguous values produces an invalid DICOM-SEG or an error.

**Prevention:**
- Before saving, remap label values to contiguous 1..N range.
- Store the mapping (original value → DICOM segment number) in the SegmentDescription.
- When loading a DICOM-SEG back, reverse the mapping.

**Which phase:** Phase 7 (DICOM-SEG save)

### P5: Multipart/Related Response Construction

**What goes wrong:** WADO-RS requires `multipart/related` responses with proper MIME boundaries. Getting the boundary format wrong causes DICOM clients to fail silently.

**Prevention:**
- Use a generator function with StreamingResponse.
- Set `Content-Type: multipart/related; type="application/dicom"; boundary=<boundary>`.
- Each part: `--<boundary>\r\nContent-Type: application/dicom\r\n\r\n<bytes>`.
- Final boundary: `--<boundary>--\r\n`.
- Test with a DICOMweb client library to verify compliance.

**Which phase:** Phase 8 (WADO-RS)

### P6: WebSocket Connection Lifecycle

**What goes wrong:** WebSocket connections can drop silently. If the server doesn't handle disconnection cleanup, the ConnectionManager accumulates dead connections. Broadcasting to dead connections raises exceptions.

**Prevention:**
- Wrap `ws.send_json()` in try/except; remove dead connections on exception.
- Client implements reconnection with exponential backoff (1s, 2s, 4s, max 30s).
- On reconnect, client fetches full volume list to sync state.

**Which phase:** Phase 6 (WebSocket events)

## Moderate Pitfalls

### P7: API Migration Breaking Client

**What goes wrong:** Changing all endpoints from `/api/` to `/api/v1/` breaks the client if not updated simultaneously.

**Prevention:**
- Change `API_BASE` constant in `api.js` — single point of change.
- Server can mount routes at both prefixes during transition.
- Test all client API calls after migration.

**Which phase:** Phase 5 (API versioning) + Phase 8 (client migration)

### P8: Watcher on macOS vs Linux Differences

**What goes wrong:** macOS FSEvents reports events at the directory level (coalesced), while Linux inotify reports per-file. Event ordering and granularity differ.

**Prevention:**
- Don't rely on specific event ordering.
- Use debouncing (which absorbs platform differences).
- Use `on_created` for new files, not `on_modified`.

**Which phase:** Phase 6 (Folder Monitoring)

### P9: Large DICOM Series Memory During WADO-RS

**What goes wrong:** Streaming all DICOM files in a large series can spike memory if all files are read into memory before streaming.

**Prevention:**
- Use a generator with StreamingResponse to read and yield one file at a time.
- Each DICOM file is read, yielded, then garbage collected.

**Which phase:** Phase 8 (WADO-RS)

### P10: Segmentation Coordinate Transform for DICOM-SEG

**What goes wrong:** NextEd stores segmentation in RAS+ orientation (nibabel canonical). DICOM-SEG expects data aligned with the source DICOM images (LPS). Passing RAS+ segmentation directly to highdicom causes spatial misalignment.

**Prevention:**
- Before passing to highdicom, transform the segmentation back from RAS+ to the original DICOM image orientation.
- Use the stored affine transform to compute the inverse mapping.
- Verify by loading the DICOM-SEG in a third-party viewer.

**Which phase:** Phase 7 (DICOM-SEG save)

## Pitfall Interaction Matrix

| Pitfall | Interacts With | Combined Risk |
|---------|---------------|---------------|
| P1 (thrashing) | P2 (thread safety) | High — debounce logic runs on watchdog thread, must dispatch safely |
| P3 (source datasets) | P10 (coordinate transform) | High — both affect DICOM-SEG correctness |
| P4 (segment numbering) | P10 (coordinates) | Medium — both are DICOM-SEG data concerns |
| P5 (multipart) | P9 (memory) | Medium — streaming multipart must be memory-efficient |
| P6 (WS lifecycle) | P1 (thrashing) | Medium — dead WS connections + many events = error cascade |

## Sources

- watchdog GitHub issues on platform-specific behavior
- highdicom documentation on Segmentation creation
- DICOMweb standard (PS3.18) multipart/related format
- FastAPI WebSocket documentation
- Prior v1.0 experience with DICOM/NIfTI coordinate transforms

---
*Pitfalls research for: NextEd v2.0*
*Researched: 2026-03-31*

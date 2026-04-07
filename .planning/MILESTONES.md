# Milestones

## v2.0 Image Server Architecture (Shipped: 2026-04-07)

**Phases completed:** 4 phases, 7 plans, 14 tasks

**Key accomplishments:**

- All 9 server endpoints versioned under /api/v1/, VolumeMetadata extended with study/series UIDs, debug path endpoint added, client API calls updated
- WebSocket endpoint, watchdog filesystem observer, DICOM debouncer, and lifespan integration for real-time volume discovery
- WebSocket client with exponential backoff reconnect, reactive volume list updates, and connection status indicator
- DICOM-SEG writer module with highdicom for label-remapped binary segmentation output, plus thread-safe watcher suppress list with TTL expiry
- Format-aware save endpoint wiring with automatic DICOM-SEG/NIfTI branching, watcher suppress list integration, and 4 format-selection tests
- DICOMweb WADO-RS series-level retrieve (multipart/related streaming) and metadata (PS3.18 JSON with BulkDataURI) endpoints with 7 integration tests

---

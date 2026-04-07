# Roadmap: NextEd

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped)
- ✅ **v2.0 Image Server Architecture** — Phases 5-8 (shipped 2026-04-07)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-4) — SHIPPED</summary>

- [x] **Phase 1: Server & Data Pipeline** — FastAPI server catalogs NIfTI/DICOM volumes and serves them as binary to the browser
- [x] **Phase 2: Core Viewer** — Multi-plane slice rendering with navigation, window/level, and correct anisotropic display
- [x] **Phase 3: Segmentation Display & Labels** — Overlay compositing, label management, and segmentation file loading
- [x] **Phase 4: Editing Tools & Save** — Paintbrush, eraser, undo, pixel constraints, and Save As workflow

</details>

<details>
<summary>✅ v2.0 Image Server Architecture (Phases 5-8) — SHIPPED 2026-04-07</summary>

- [x] **Phase 5: Foundation** (2/2 plans) — API versioning under /api/v1/, DICOM UID metadata, file path retention
- [x] **Phase 6: Folder Monitoring & WebSocket Events** (2/2 plans) — Watchdog watcher, DICOM debouncing, WebSocket live updates, reactive client
- [x] **Phase 7: Format-Aware Segmentation Storage** (2/2 plans) — DICOM-SEG via highdicom, auto format selection, watcher suppress list
- [x] **Phase 8: DICOMweb WADO-RS** (1/1 plan) — Series retrieve (multipart/related), PS3.18 JSON metadata with BulkDataURI

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Server & Data Pipeline | v1.0 | 3/3 | Complete | - |
| 2. Core Viewer | v1.0 | 3/3 | Complete | - |
| 3. Segmentation Display & Labels | v1.0 | -/- | Complete | - |
| 4. Editing Tools & Save | v1.0 | -/- | Complete | - |
| 5. Foundation | v2.0 | 2/2 | Complete | 2026-03-31 |
| 6. Folder Monitoring & WebSocket Events | v2.0 | 2/2 | Complete | 2026-04-06 |
| 7. Format-Aware Segmentation Storage | v2.0 | 2/2 | Complete | 2026-04-06 |
| 8. DICOMweb WADO-RS | v2.0 | 1/1 | Complete | 2026-04-06 |

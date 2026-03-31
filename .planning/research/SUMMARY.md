# Research Summary: v2.0 Image Server Architecture

**Project:** NextEd — Web-Based Medical Image Editor
**Milestone:** v2.0 — Folder monitoring, DICOMweb, WebSocket events, format-aware segmentation
**Researched:** 2026-03-31

## Stack Additions

Only 2 new Python packages needed:

| Package | Version | Purpose |
|---------|---------|---------|
| watchdog | >=6.0 | Cross-platform filesystem monitoring (macOS FSEvents, Linux inotify) |
| highdicom | >=0.24 | DICOM-SEG creation with LABELMAP support (bump from v1.0's >=0.23) |

**No new dependencies for:** WebSocket (built into FastAPI/Starlette), DICOMweb WADO-RS (custom REST endpoints with existing pydicom), client-side WebSocket (browser-native API).

## Feature Table Stakes

| Feature | Complexity | Risk |
|---------|------------|------|
| Folder monitoring with debounced DICOM discovery | Medium | Medium (thread safety, debouncing) |
| WebSocket event stream (volume_added/removed) | Medium | Low (well-documented FastAPI pattern) |
| Client reactive volume list | Low | Low |
| WADO-RS series retrieval (multipart/related) | High | High (MIME boundary construction) |
| WADO-RS metadata retrieval (DICOM JSON) | Medium | Low |
| DICOM-SEG save via highdicom | High | High (coordinate transforms, segment numbering) |
| NIfTI segmentation save (unchanged) | None | None |
| API versioning (/api/v1/) | Low | None |
| Unified volume list with study/series hierarchy | Medium | Low |

## Anti-Features (Do NOT Build)

- **STOW-RS** — NextEd monitors folders, doesn't accept uploads via DICOMweb
- **QIDO-RS** — Full search requires queryable indexes; overkill for local tool
- **Full DICOMweb PS3.18 conformance** — Implement subset only (WADO-RS retrieve)
- **SSE alternative** — WebSocket is bidirectional and the right choice
- **Authentication** — Single-user local tool

## Critical Architecture Decisions

1. **DICOM loader must retain file paths** — Both WADO-RS and DICOM-SEG need access to original DICOM files. Current loader discards Datasets after extracting pixel data. Store paths, re-read on demand.

2. **Debounce filesystem events by directory** — DICOM series arrive as many files. Wait 2-3 seconds of quiet before triggering discovery. Prevents catalog thrashing.

3. **Thread-to-async bridge** — watchdog runs on its own thread. Use `call_soon_threadsafe()` to dispatch to FastAPI's async event loop. All catalog mutations on the main thread.

4. **Segment renumbering before DICOM-SEG save** — DICOM-SEG requires 1-based contiguous segment numbers. Remap NextEd's arbitrary label values before saving.

5. **RAS+ to LPS transform for DICOM-SEG** — NextEd stores data in RAS+; DICOM expects LPS-aligned. Must inverse-transform before highdicom.

## Watch Out For

| Pitfall | Phase | Severity |
|---------|-------|----------|
| DICOM series arrival thrashing (many files = many events) | Phase 6 | Critical |
| Watchdog thread vs async event loop race conditions | Phase 6 | Critical |
| highdicom needs source Datasets (currently discarded) | Phase 5+7 | Critical |
| DICOM-SEG segment numbering must be contiguous 1..N | Phase 7 | Critical |
| Multipart/related boundary format for WADO-RS | Phase 8 | Critical |
| Coordinate transform RAS+ → LPS for DICOM-SEG | Phase 7 | High |
| WebSocket dead connection cleanup | Phase 6 | Medium |

## Recommended Phase Order

| Phase | Name | Goal | Risk |
|-------|------|------|------|
| 5 | Foundation | API versioning + DICOM loader refactor (retain file paths) | Low |
| 6 | Folder Monitoring + Events | Watchdog + debounced discovery + WebSocket + reactive client | Medium |
| 7 | Format-Aware Storage | DICOM-SEG save via highdicom + format auto-detection | High |
| 8 | DICOMweb WADO-RS | Multipart WADO-RS retrieval + metadata + client migration | High |

**Rationale:** Foundation first (zero risk, unblocks everything). Folder monitoring second (core user promise). DICOM-SEG third (completes editing workflow). WADO-RS last (highest complexity, interoperability benefit).

## Sources

- STACK.md: watchdog 6.0.0 (PyPI), highdicom 0.27.0 (docs), FastAPI WebSocket
- FEATURES.md: DICOMweb standard, feature dependency analysis
- ARCHITECTURE.md: Existing codebase analysis, integration patterns
- PITFALLS.md: Platform-specific behavior, DICOM-SEG spec requirements

---
*Research summary for: NextEd v2.0*
*Synthesized: 2026-03-31*

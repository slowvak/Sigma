---
phase: 1
slug: server-data-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-24
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 8.x (backend), vitest (frontend) |
| **Config file** | none — Wave 0 installs |
| **Quick run command** | `uv run pytest tests/ -x -q` |
| **Full suite command** | `uv run pytest tests/ -v && cd frontend && npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `uv run pytest tests/ -x -q`
- **After every plan wave:** Run `uv run pytest tests/ -v && cd frontend && npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | SRVR-01 | unit | `uv run pytest tests/test_catalog.py -k test_scan_nifti` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | SRVR-02 | unit | `uv run pytest tests/test_catalog.py -k test_dicom_grouping` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 1 | SRVR-06 | unit | `uv run pytest tests/test_catalog.py -k test_modality_detection` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 1 | SRVR-03 | integration | `uv run pytest tests/test_api.py -k test_list_volumes` | ❌ W0 | ⬜ pending |
| 1-02-02 | 02 | 1 | SRVR-04 | integration | `uv run pytest tests/test_api.py -k test_dicom_metadata` | ❌ W0 | ⬜ pending |
| 1-02-03 | 02 | 1 | SRVR-05 | integration | `uv run pytest tests/test_api.py -k test_load_volume_binary` | ❌ W0 | ⬜ pending |
| 1-03-01 | 03 | 2 | BROW-01 | e2e | `cd frontend && npx vitest run --grep "volume list"` | ❌ W0 | ⬜ pending |
| 1-03-02 | 03 | 2 | BROW-02 | e2e | `cd frontend && npx vitest run --grep "dicom metadata"` | ❌ W0 | ⬜ pending |
| 1-03-03 | 03 | 2 | BROW-03 | e2e | `cd frontend && npx vitest run --grep "nifti date"` | ❌ W0 | ⬜ pending |
| 1-03-04 | 03 | 2 | BROW-04 | e2e | `cd frontend && npx vitest run --grep "open volume"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/conftest.py` — shared fixtures (test data paths, FastAPI test client)
- [ ] `tests/test_catalog.py` — stubs for SRVR-01, SRVR-02, SRVR-06
- [ ] `tests/test_api.py` — stubs for SRVR-03, SRVR-04, SRVR-05
- [ ] `frontend/src/__tests__/` — test directory with vitest setup
- [ ] pytest + httpx install via uv
- [ ] vitest install via npm

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Binary ArrayBuffer received in browser | SRVR-05/BROW-04 | Requires real browser DevTools | Open volume, check Network tab for binary response and console for ArrayBuffer |
| Volume list renders in browser | BROW-01 | Visual UI rendering | Start server, open browser, verify list appears |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

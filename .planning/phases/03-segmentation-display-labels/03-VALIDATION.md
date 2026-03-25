---
phase: 3
slug: segmentation-display-labels
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-25
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (client)** | vitest 3.x |
| **Config file (client)** | `client/vitest.config.js` |
| **Quick run command (client)** | `cd client && npx vitest run` |
| **Full suite command (client)** | `cd client && npx vitest run` |
| **Framework (server)** | pytest 8.x |
| **Config file (server)** | none (uses pyproject.toml) |
| **Quick run command (server)** | `cd server && uv run pytest tests/ -x` |
| **Full suite command** | `cd client && npx vitest run && cd ../server && uv run pytest tests/` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd client && npx vitest run && cd ../server && uv run pytest tests/ -x`
- **After every plan wave:** Run full suite for both client and server
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | SEGD-02 | unit | `cd server && uv run pytest tests/test_seg_discovery.py -x` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | SEGD-04 | unit | `cd client && npx vitest run src/__tests__/overlayBlender.test.js` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | SEGD-05 | unit | `cd client && npx vitest run src/__tests__/overlayBlender.test.js` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 2 | LABL-02 | unit | `cd client && npx vitest run src/__tests__/labelManager.test.js` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 2 | LABL-03 | unit | `cd client && npx vitest run src/__tests__/labelManager.test.js` | ❌ W0 | ⬜ pending |
| 03-02-03 | 02 | 2 | LABL-05 | unit | `cd client && npx vitest run src/__tests__/labelManager.test.js` | ❌ W0 | ⬜ pending |
| 03-02-04 | 02 | 2 | LABL-06 | unit | `cd client && npx vitest run src/__tests__/labelManager.test.js` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 2 | SEGD-01 | manual | Manual browser test | -- | ⬜ pending |
| 03-03-02 | 03 | 2 | SEGD-03 | manual | Manual browser test | -- | ⬜ pending |
| 03-03-03 | 03 | 2 | LABL-01 | manual | Manual browser test | -- | ⬜ pending |
| 03-03-04 | 03 | 2 | LABL-04 | manual | Manual browser test | -- | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `client/src/__tests__/overlayBlender.test.js` — blending correctness, alpha=0/1 edge cases (SEGD-04, SEGD-05)
- [ ] `client/src/__tests__/segSliceExtractor.test.js` — Uint8Array slice extraction with axis flips
- [ ] `client/src/__tests__/labelManager.test.js` — label discovery, add, rename, value change, bulk voxel update (LABL-02 through LABL-06)
- [ ] `server/tests/test_seg_discovery.py` — companion file pattern matching (SEGD-02)
- [ ] `server/tests/test_seg_loader.py` — segmentation NIfTI loading with uint8 cast

*Existing infrastructure covers test framework — only test files need creation.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Segmentation dialog shown after volume open | SEGD-01 | DOM modal requires browser | Open volume, verify dialog appears |
| Pre-select matching segmentation | SEGD-03 | DOM state in modal | Open volume with companion seg, verify pre-selected |
| Double-click label editing | LABL-01 | Mouse interaction + DOM | Double-click label row, verify inline editor appears |
| Label list shows all labels | LABL-04 | Requires loaded segmentation + DOM | Load seg, verify all unique labels listed |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

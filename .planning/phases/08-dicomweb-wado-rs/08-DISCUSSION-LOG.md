# Phase 08: DICOMweb WADO-RS - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-06
**Phase:** 08-dicomweb-wado-rs
**Areas discussed:** URL scheme & scope, Multipart response format, Metadata JSON depth, Error & edge cases

---

## URL Scheme & Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Series-level only | GET /api/v1/wado-rs/studies/{study}/series/{series}. Instance-level deferred. | ✓ |
| Full PS3.18 hierarchy | Study, series, AND instance-level endpoints | |
| You decide | Claude picks based on requirements scope | |

**User's choice:** Series-level only
**Notes:** Matches how NextEd groups DICOM (by series). Instance-level explicitly deferred as WADO-03.

| Option | Description | Selected |
|--------|-------------|----------|
| 404 with clear message | NIfTI volumes hitting WADO-RS get 404 | |
| Hide from WADO-RS entirely | Use Study/Series UIDs as keys, NIfTI has no UIDs | ✓ |
| You decide | Claude picks cleanest approach | |

**User's choice:** Hide from WADO-RS entirely
**Notes:** WADO-RS endpoints use UIDs, not volume IDs. NIfTI volumes invisible by design.

| Option | Description | Selected |
|--------|-------------|----------|
| /api/v1/wado-rs/ | Consistent with existing API versioning | ✓ |
| /dicomweb/ | Matches clinical PACS convention | |
| Both | Dual mount | |

**User's choice:** /api/v1/wado-rs/
**Notes:** Consistent with existing /api/v1/ prefix.

---

## Multipart Response Format

| Option | Description | Selected |
|--------|-------------|----------|
| application/dicom | PS3.18 default, maximum viewer compatibility | ✓ |
| application/octet-stream | Raw bytes, non-standard | |
| You decide | Claude picks | |

**User's choice:** application/dicom

| Option | Description | Selected |
|--------|-------------|----------|
| Original syntax only | Serve as-is from disk, no transcoding | ✓ |
| Negotiate + transcode | Parse Accept header, transcode | |
| You decide | Claude picks | |

**User's choice:** Original syntax only

| Option | Description | Selected |
|--------|-------------|----------|
| Stream from disk | StreamingResponse, memory-efficient | ✓ |
| Buffer all in memory | Build full body first | |
| You decide | Claude picks | |

**User's choice:** Stream from disk

---

## Metadata JSON Depth

| Option | Description | Selected |
|--------|-------------|----------|
| Full tag dump | All non-pixel tags in PS3.18 JSON format | ✓ |
| Curated subset | Only geometry, UIDs, patient basics | |
| You decide | Claude picks | |

**User's choice:** Full tag dump

| Option | Description | Selected |
|--------|-------------|----------|
| Include BulkDataURI | URI references for pixel data per PS3.18 | ✓ |
| Omit pixel data entirely | Exclude from metadata response | |
| You decide | Claude picks | |

**User's choice:** Include BulkDataURI

| Option | Description | Selected |
|--------|-------------|----------|
| pydicom to_json_dict | Built-in PS3.18 JSON model | ✓ |
| Custom serialization | Walk tags manually | |
| You decide | Claude picks | |

**User's choice:** pydicom to_json_dict

---

## Error & Edge Cases

| Option | Description | Selected |
|--------|-------------|----------|
| Return available, warn | Stream existing files, add Warning header | |
| Fail entire request | If any file missing, return error | ✓ |
| You decide | Claude picks | |

**User's choice:** Fail entire request

| Option | Description | Selected |
|--------|-------------|----------|
| JSON (match existing API) | FastAPI standard {"detail": "..."} | ✓ |
| PS3.18 XML | DICOM-standard error format | |
| You decide | Claude picks | |

**User's choice:** JSON (match existing API)

---

## Claude's Discretion

- Multipart boundary string generation strategy
- Sequential vs async file I/O for streaming
- Code organization (single module vs split)
- UID → file path lookup strategy
- BulkDataURI format

## Deferred Ideas

- WADO-03: Instance-level retrieval — future requirement
- /dicomweb/ alias for PACS convention
- Transfer Syntax negotiation
- Partial series streaming

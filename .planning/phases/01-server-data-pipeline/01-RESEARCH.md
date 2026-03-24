# Phase 1: Server & Data Pipeline - Research

**Researched:** 2026-03-24
**Domain:** Python FastAPI server, NIfTI/DICOM cataloging, binary volume transfer, vanilla JS browser client
**Confidence:** HIGH

## Summary

Phase 1 establishes the full server-to-browser data pipeline: a FastAPI server that recursively catalogs NIfTI and DICOM files from a user-specified folder, groups DICOM files into series-level volumes, exposes REST endpoints for metadata listing and on-demand binary volume loading, and a minimal browser client that displays the volume catalog and can load a volume's full 3D data as an ArrayBuffer.

The server side is the bulk of this phase. It involves filesystem walking with DICOM/NIfTI detection (including extensionless DICOM files), DICOM series grouping by SeriesInstanceUID with correct slice ordering, metadata extraction (dimensions, spacing, Study/Series Description, modality, file date), and binary volume serialization. The client side is deliberately thin for Phase 1: a volume list UI and fetch-based binary data loading -- no rendering yet.

Key risks are DICOM parsing edge cases (slice ordering, extensionless files, compressed transfer syntaxes) and getting the binary transfer protocol right from the start since later phases depend on it. pydicom 3.0 has breaking changes from 2.x that affect tag formatting and pixel data handling.

**Primary recommendation:** Build server-first with comprehensive DICOM grouping tests, serve volumes as raw binary with JSON metadata in a separate endpoint (not headers), and scaffold the Vite client with just catalog display and ArrayBuffer receipt verification.

## Project Constraints (from CLAUDE.md)

- **Package management:** Always use `uv`, never `pip`
- **GSD Workflow:** Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SRVR-01 | Server accepts folder path as CLI arg, recursively catalogs NIfTI (.nii, .nii.gz) and DICOM (.dcm, .DCM, extensionless) | Filesystem walker with extension matching + DICOM magic byte detection for extensionless files |
| SRVR-02 | DICOM files grouped into volumes by series_instance_uid | pydicom SeriesInstanceUID tag extraction, sub-grouping by ImageOrientationPatient to exclude localizers |
| SRVR-03 | REST API listing all volumes with metadata (path, filename, X/Y/Z dims, voxel spacing, file date) | FastAPI endpoints returning Pydantic models; nibabel header for NIfTI, pydicom tags for DICOM |
| SRVR-04 | DICOM volumes include Study Description and Series Description | pydicom tags (0008,1030) and (0008,103E); handle missing tags gracefully |
| SRVR-05 | Server loads and serves full volume data on demand as binary ArrayBuffer | Raw binary Response with application/octet-stream; separate metadata endpoint |
| SRVR-06 | Server detects modality (CT vs MR) from DICOM Modality tag or NIfTI header heuristics | DICOM tag (0008,0060); NIfTI heuristic based on data range / intent code |
| BROW-01 | Web client displays list of available volumes | Vite vanilla JS app, fetch /api/volumes, render DOM list |
| BROW-02 | Clicking DICOM volume shows Study Description and Series Description | Detail panel populated from volume metadata JSON |
| BROW-03 | Clicking NIfTI volume shows file date | file_date field from server metadata |
| BROW-04 | User can open a volume as "Main" image (full 3D data transferred as binary) | fetch().arrayBuffer() with TypedArray wrapping; verify receipt in console |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard | Confidence |
|---------|---------|---------|--------------|------------|
| Python | 3.12 | Runtime | Already installed on this machine (3.12.2). Performance improvements over 3.11. | HIGH (verified) |
| FastAPI | 0.135.x | HTTP API framework | Async, auto OpenAPI docs, binary streaming. Latest stable is 0.135.2. | HIGH (verified) |
| uvicorn | 0.42.x | ASGI server | Standard FastAPI server. `--reload` for dev. Latest is 0.42.0. | HIGH (verified) |
| pydicom | 3.0.x | DICOM file I/O | Only serious Python DICOM library. Latest stable 3.0.2. Note: breaking changes from 2.x. | HIGH (verified) |
| nibabel | 5.4.x | NIfTI file I/O | Standard NIfTI reader. Latest 5.4.2. | HIGH (verified) |
| numpy | 2.4.x | Array operations | Required by pydicom and nibabel. Latest 2.4.3. | HIGH (verified) |

### Supporting (Phase 1 only)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vite | 8.x | Frontend dev server + build | Client scaffold. Latest 8.0.2. |
| pako | 2.1.x | Gzip decompression (client) | Only if serving .nii.gz compressed to client. May not be needed in Phase 1. |

### Not Needed in Phase 1

| Library | Why Deferred |
|---------|-------------|
| scikit-image | Otsu/region grow are Phase 4-5 |
| scipy | Same -- image processing is later |
| python-multipart | File upload for Save As is Phase 4 |
| highdicom | DICOM-SEG export is Phase 5 |

**Installation:**
```bash
# Server
cd server
uv init
uv add fastapi "uvicorn[standard]" pydicom nibabel numpy

# Client
npm create vite@latest client -- --template vanilla
cd client
npm install
```

## Architecture Patterns

### Phase 1 Project Structure

```
server/
  main.py                 # FastAPI app, CLI arg parsing, startup catalog trigger
  catalog/
    scanner.py            # Walk folder tree, identify NIfTI/DICOM files
    dicom_grouper.py      # Group DICOM files by SeriesInstanceUID
    models.py             # Pydantic models for volume metadata
  loaders/
    nifti_loader.py       # Load NIfTI volume + header with nibabel
    dicom_loader.py       # Assemble DICOM series into 3D numpy array
  api/
    volumes.py            # GET /api/volumes, GET /api/volumes/{id}/metadata, GET /api/volumes/{id}/data
  pyproject.toml

client/
  index.html
  src/
    main.js               # App init, fetch volume list, display catalog
    api.js                # API client functions (list volumes, load volume data)
    ui/
      volumeList.js       # Render volume list, click handlers for detail/open
  vite.config.js          # Proxy /api/* to FastAPI on port 8000
```

### Pattern 1: DICOM File Detection for Extensionless Files
**What:** DICOM files often have no extension (especially from PACS exports). Check for the DICOM magic bytes "DICM" at offset 128.
**When:** During filesystem scanning (SRVR-01).
**Example:**
```python
def is_dicom_file(filepath: Path) -> bool:
    """Check if file is DICOM by extension or magic bytes."""
    ext = filepath.suffix.lower()
    if ext in ('.dcm', '.DCM'):
        return True
    # Extensionless or unknown extension: check DICOM preamble
    try:
        with open(filepath, 'rb') as f:
            f.seek(128)
            return f.read(4) == b'DICM'
    except (IOError, OSError):
        return False
```

### Pattern 2: DICOM Series Grouping with Slice Ordering
**What:** Group DICOM files by SeriesInstanceUID, then sort slices by ImagePositionPatient projected onto the slice normal vector.
**When:** Building volume entries from DICOM files (SRVR-02).
**Why:** InstanceNumber is unreliable. ImagePositionPatient gives correct physical ordering.
**Example:**
```python
import numpy as np
from pydicom import dcmread

def sort_dicom_slices(dicom_files: list[Path]) -> list[Path]:
    """Sort DICOM slices by physical position along the normal vector."""
    datasets = [(f, dcmread(f, stop_before_pixels=True)) for f in dicom_files]

    # Get orientation from first slice
    ds0 = datasets[0][1]
    iop = [float(x) for x in ds0.ImageOrientationPatient]
    row_cosine = np.array(iop[:3])
    col_cosine = np.array(iop[3:])
    normal = np.cross(row_cosine, col_cosine)

    # Sort by projection of ImagePositionPatient onto normal
    def slice_position(item):
        ds = item[1]
        ipp = np.array([float(x) for x in ds.ImagePositionPatient])
        return np.dot(ipp, normal)

    datasets.sort(key=slice_position)
    return [f for f, _ in datasets]
```

### Pattern 3: Binary Volume Transfer with Separate Metadata Endpoint
**What:** Serve volume binary data and metadata via separate endpoints rather than packing metadata into HTTP headers.
**When:** Volume data loading (SRVR-05).
**Why:** Custom HTTP headers can be stripped by proxies, have size limits, and are awkward to parse. Two endpoints are cleaner: one for JSON metadata, one for raw binary.
**Example:**
```python
from fastapi import FastAPI, Response
from fastapi.responses import JSONResponse
import json

@app.get("/api/volumes/{volume_id}/metadata")
async def get_volume_metadata(volume_id: str):
    """Return volume metadata as JSON."""
    vol_info = catalog.get(volume_id)
    return vol_info.metadata_dict()  # dims, spacing, dtype, affine, modality, etc.

@app.get("/api/volumes/{volume_id}/data")
async def get_volume_data(volume_id: str):
    """Return raw volume binary data."""
    vol_array = load_volume(volume_id)  # returns numpy array
    # Ensure C-contiguous, convert to a standard dtype
    vol_array = np.ascontiguousarray(vol_array)
    return Response(
        content=vol_array.tobytes(),
        media_type="application/octet-stream",
    )
```

### Pattern 4: NIfTI Modality Heuristic
**What:** NIfTI files lack a modality tag. Use data range heuristics to guess CT vs MR.
**When:** SRVR-06 for NIfTI files.
**Example:**
```python
def guess_nifti_modality(data: np.ndarray) -> str:
    """Heuristic: CT data typically has large negative values (HU for air ~ -1000)."""
    min_val = float(np.min(data))
    if min_val < -500:
        return "CT"
    return "MR"  # Default assumption for NIfTI
```

### Pattern 5: Vite Proxy Configuration
**What:** Proxy API requests from the Vite dev server to the FastAPI backend.
**Example:**
```javascript
// vite.config.js
export default {
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
};
```

### Anti-Patterns to Avoid

- **JSON-encoded volume data:** Never serialize voxel arrays as JSON. Use raw binary ArrayBuffer only.
- **Metadata in HTTP headers:** Custom headers get stripped by proxies and have size limits. Use a separate metadata endpoint.
- **Loading all volumes at startup:** Catalog metadata (reading headers) at startup is fine. Loading full voxel data into memory at startup is not -- load on demand only (SRVR-05 says "not at catalog time").
- **Blocking the event loop during catalog scan:** Use async file I/O or run the scan in a thread pool. Large DICOM folders can contain thousands of files.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DICOM file reading | Custom DICOM parser | pydicom.dcmread() | DICOM has 100+ transfer syntaxes, VR types, encoding rules |
| NIfTI file reading | Custom NIfTI parser | nibabel.load() | Handles .nii, .nii.gz, qform/sform, all data types |
| DICOM pixel data extraction | Manual byte unpacking | pydicom Dataset.pixel_array | Handles BitsAllocated/BitsStored/HighBit, RescaleSlope/Intercept, compressed syntaxes |
| UUID generation for volume IDs | Custom hash schemes | Python uuid.uuid4() or deterministic hash of file paths | Standard, collision-free |

## Common Pitfalls

### Pitfall 1: DICOM Slice Ordering by InstanceNumber
**What goes wrong:** Slices appear in wrong order, anatomy is scrambled.
**Why it happens:** InstanceNumber (0020,0013) is unreliable -- can be duplicated, non-sequential, or absent.
**How to avoid:** Sort by ImagePositionPatient projected onto the normal vector derived from ImageOrientationPatient (see Pattern 2 above).
**Warning signs:** Visible discontinuities when scrolling through slices in later phases.

### Pitfall 2: pydicom 3.0 Breaking Changes
**What goes wrong:** Code written for pydicom 2.x fails silently or produces wrong results with 3.0.
**Why it happens:** pydicom 3.0 changed: (1) pixel_array now auto-converts YCbCr to RGB, (2) tag string format changed to uppercase no-space e.g. "(7FE0,0010)", (3) encoding defaults changed for saving datasets.
**How to avoid:** Use pydicom 3.0.x (the version on the registry). Do not copy code from older pydicom tutorials without checking for 3.x compatibility. Use the `keyword` attribute for tag access (e.g., `ds.Modality`) rather than string-formatted tag addresses.
**Warning signs:** Unexpected pixel value ranges, tag lookup failures.

### Pitfall 3: Extensionless DICOM Detection Performance
**What goes wrong:** Scanning a large directory takes minutes because every file is opened and read for DICOM magic bytes.
**Why it happens:** Checking 128 bytes + 4 bytes for every file in a directory tree with thousands of non-DICOM files.
**How to avoid:** First filter by known extensions (.dcm, .DCM). Only check magic bytes on extensionless files (files without any extension, or with unknown extensions). Skip files with known non-DICOM extensions (.txt, .xml, .json, .py, etc.). Set a maximum file count or timeout for the scan.
**Warning signs:** Server startup takes >10 seconds for moderate-sized directories.

### Pitfall 4: Missing DICOM Tags
**What goes wrong:** Server crashes with AttributeError when accessing Study Description or Series Description on DICOM files that lack these tags.
**Why it happens:** Not all DICOM files have all standard tags. Study Description (0008,1030) and Series Description (0008,103E) are Type 3 (optional).
**How to avoid:** Always use `getattr(ds, 'StudyDescription', '')` or `ds.get('StudyDescription', '')` rather than direct attribute access.
**Warning signs:** Server returns 500 errors for some DICOM datasets but not others.

### Pitfall 5: DICOM RescaleSlope/RescaleIntercept Not Applied
**What goes wrong:** CT Hounsfield unit values are wrong. Window/level presets (Brain, Bone, Lung) produce blank images in later phases.
**Why it happens:** Raw stored pixel values must be transformed: `HU = raw * RescaleSlope + RescaleIntercept`. Forgetting this means values are off by thousands.
**How to avoid:** In pydicom 3.0, `pixel_array` returns raw stored values. Apply rescale manually: check for RescaleSlope and RescaleIntercept attributes and transform. Note: pydicom 3.0 `pixel_array` auto-applies some transforms depending on `apply_voi_lut` usage -- verify behavior.
**Warning signs:** CT data range looks wrong (e.g., all positive values when HU should range from -1024 to +3071).

### Pitfall 6: GZipMiddleware Pitfalls with Binary Responses
**What goes wrong:** GZipMiddleware double-compresses data or interferes with Content-Length for binary responses, causing client-side ArrayBuffer parsing to fail.
**Why it happens:** Known issue -- GZipMiddleware has limitations with StreamingResponse and can conflict with explicit Content-Length headers on binary data.
**How to avoid:** For Phase 1, do NOT use GZipMiddleware on binary volume endpoints. Volume transfer is localhost -- compression overhead exceeds the network savings. If compression is needed later, handle it explicitly per-endpoint rather than via global middleware.
**Warning signs:** Client receives ArrayBuffer of unexpected size, or fetch response fails to parse.

## Code Examples

### CLI Entry Point with Folder Argument

```python
# server/main.py
import sys
import uvicorn
from fastapi import FastAPI
from pathlib import Path

app = FastAPI(title="NextEd Server")

@app.on_event("startup")
async def startup_catalog():
    """Catalog volumes from the folder specified via CLI."""
    from catalog.scanner import scan_folder
    folder = Path(app.state.data_folder)
    app.state.volumes = await scan_folder(folder)

def main():
    if len(sys.argv) < 2:
        print("Usage: python -m main <folder_path>")
        sys.exit(1)
    data_folder = sys.argv[1]
    if not Path(data_folder).is_dir():
        print(f"Error: {data_folder} is not a directory")
        sys.exit(1)
    app.state.data_folder = data_folder
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)

if __name__ == "__main__":
    main()
```

### Volume Metadata Pydantic Model

```python
# server/catalog/models.py
from pydantic import BaseModel
from typing import Optional

class VolumeMetadata(BaseModel):
    id: str
    filename: str
    path: str
    format: str  # "nifti" or "dicom"
    dimensions: list[int]  # [X, Y, Z]
    voxel_spacing: list[float]  # [sx, sy, sz]
    dtype: str  # "int16", "float32", etc.
    modality: str  # "CT", "MR", "unknown"
    file_date: Optional[str] = None  # ISO format, for NIfTI
    study_description: Optional[str] = None  # DICOM only
    series_description: Optional[str] = None  # DICOM only
    num_files: int = 1  # Number of DICOM files in series, 1 for NIfTI
```

### Client Volume List Fetch

```javascript
// client/src/api.js
const API_BASE = '/api';

export async function fetchVolumes() {
    const response = await fetch(`${API_BASE}/volumes`);
    if (!response.ok) throw new Error(`Failed to fetch volumes: ${response.status}`);
    return response.json();
}

export async function fetchVolumeMetadata(volumeId) {
    const response = await fetch(`${API_BASE}/volumes/${volumeId}/metadata`);
    if (!response.ok) throw new Error(`Failed to fetch metadata: ${response.status}`);
    return response.json();
}

export async function fetchVolumeData(volumeId) {
    const response = await fetch(`${API_BASE}/volumes/${volumeId}/data`);
    if (!response.ok) throw new Error(`Failed to fetch volume data: ${response.status}`);
    const buffer = await response.arrayBuffer();
    return buffer;  // Raw binary ArrayBuffer
}
```

### Client Volume List UI

```javascript
// client/src/ui/volumeList.js
export function renderVolumeList(volumes, container) {
    container.innerHTML = '';
    const list = document.createElement('ul');
    list.className = 'volume-list';

    for (const vol of volumes) {
        const li = document.createElement('li');
        li.className = 'volume-item';
        li.dataset.volumeId = vol.id;

        const name = document.createElement('span');
        name.className = 'volume-name';
        name.textContent = vol.filename;

        const badge = document.createElement('span');
        badge.className = 'volume-badge';
        badge.textContent = vol.format.toUpperCase();

        li.appendChild(name);
        li.appendChild(badge);
        list.appendChild(li);
    }
    container.appendChild(list);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| pydicom 2.x | pydicom 3.0 (3.0.2 current) | 2024 | YCbCr auto-conversion, tag format changes, encoding defaults changed |
| FastAPI 0.100-0.115 | FastAPI 0.135.x | 2025 | Stable API, minor improvements. Pydantic v2 integration mature. |
| Vite 5.x | Vite 8.x | 2025-2026 | ESM-native, faster HMR. No breaking changes for vanilla JS projects. |
| numpy 1.x | numpy 2.4.x | 2024-2025 | Some C-API changes, but Python API mostly compatible |

**Deprecated/outdated:**
- pydicom `pixel_array` behavior changed in 3.0 -- YCbCr is auto-converted to RGB now
- FastAPI `@app.on_event("startup")` is deprecated in favor of lifespan context manager (but still works)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (standard for Python FastAPI projects) |
| Config file | none -- Wave 0 creates pytest.ini or pyproject.toml [tool.pytest] |
| Quick run command | `cd server && uv run pytest tests/ -x -q` |
| Full suite command | `cd server && uv run pytest tests/ -v` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SRVR-01 | Recursive scan finds NIfTI + DICOM including extensionless | unit | `uv run pytest tests/test_scanner.py -x` | Wave 0 |
| SRVR-02 | DICOM files grouped by SeriesInstanceUID | unit | `uv run pytest tests/test_dicom_grouper.py -x` | Wave 0 |
| SRVR-03 | GET /api/volumes returns metadata list | integration | `uv run pytest tests/test_api_volumes.py::test_list_volumes -x` | Wave 0 |
| SRVR-04 | DICOM metadata includes Study/Series Description | unit | `uv run pytest tests/test_dicom_grouper.py::test_descriptions -x` | Wave 0 |
| SRVR-05 | GET /api/volumes/{id}/data returns binary ArrayBuffer | integration | `uv run pytest tests/test_api_volumes.py::test_volume_data_binary -x` | Wave 0 |
| SRVR-06 | Modality detected from DICOM tag or NIfTI heuristic | unit | `uv run pytest tests/test_scanner.py::test_modality_detection -x` | Wave 0 |
| BROW-01 | Volume list renders in browser | manual | Open browser, verify list displays | manual-only (DOM rendering) |
| BROW-02 | DICOM detail shows Study/Series Description | manual | Click DICOM entry, verify detail panel | manual-only (DOM rendering) |
| BROW-03 | NIfTI detail shows file date | manual | Click NIfTI entry, verify date shown | manual-only (DOM rendering) |
| BROW-04 | Volume data received as ArrayBuffer | integration | `uv run pytest tests/test_api_volumes.py::test_volume_data_binary -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd server && uv run pytest tests/ -x -q`
- **Per wave merge:** `cd server && uv run pytest tests/ -v`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/tests/conftest.py` -- shared fixtures (test data paths, FastAPI TestClient, synthetic NIfTI/DICOM fixtures)
- [ ] `server/tests/test_scanner.py` -- covers SRVR-01, SRVR-06
- [ ] `server/tests/test_dicom_grouper.py` -- covers SRVR-02, SRVR-04
- [ ] `server/tests/test_api_volumes.py` -- covers SRVR-03, SRVR-05, BROW-04
- [ ] pytest dependency: `uv add --dev pytest pytest-asyncio httpx` (httpx for FastAPI TestClient async testing)
- [ ] Test data: create synthetic NIfTI (nibabel) and minimal DICOM (pydicom) fixtures in conftest.py -- do NOT rely on real medical data in the repo

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.12 | Server runtime | Yes | 3.12.2 | -- |
| uv | Package management | Yes | 0.10.2 | -- |
| Node.js | Client build/dev | Yes | 25.6.1 | -- |
| npm | Client packages | Yes | 11.9.0 | -- |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Open Questions

1. **DICOM compressed transfer syntaxes**
   - What we know: pydicom can read uncompressed DICOM. Compressed formats (JPEG, JPEG2000, RLE) require additional packages (pylibjpeg, gdcm, or pillow).
   - What's unclear: Whether the user's data includes compressed DICOM files.
   - Recommendation: Start without compressed DICOM support. If `pixel_array` raises an error about missing handlers, add pylibjpeg as a dependency. Log a clear error message for unsupported transfer syntaxes.

2. **NIfTI modality heuristic reliability**
   - What we know: NIfTI has no modality field. Data range heuristic (min < -500 => CT) works for typical data.
   - What's unclear: Edge cases (e.g., MR data with negative values from certain sequences).
   - Recommendation: Use the heuristic as a best-effort guess. Default to "MR" when uncertain. The modality is only used for showing/hiding CT presets in Phase 2 -- an incorrect guess is not catastrophic.

3. **FastAPI lifespan vs on_event**
   - What we know: `@app.on_event("startup")` is deprecated in favor of the `lifespan` context manager pattern.
   - What's unclear: Whether FastAPI 0.135 will show deprecation warnings.
   - Recommendation: Use the modern `lifespan` context manager pattern from the start.

## Sources

### Primary (HIGH confidence)
- pip3 index versions -- verified current versions of all Python packages (2026-03-24)
- npm view -- verified Vite 8.0.2, pako 2.1.0 (2026-03-24)
- Local environment probe -- Python 3.12.2, uv 0.10.2, Node 25.6.1 confirmed

### Secondary (MEDIUM confidence)
- [pydicom 3.0 release notes](https://pydicom.github.io/pydicom/stable/release_notes/index.html) -- breaking changes from 2.x
- [FastAPI GZipMiddleware docs](https://fastapi.tiangolo.com/advanced/middleware/) -- middleware configuration and known limitations
- [FastAPI GZipMiddleware StreamingResponse issue](https://github.com/fastapi/fastapi/issues/4739) -- known issue with binary streaming
- [pydicom dcmread documentation](https://pydicom.github.io/pydicom/dev/reference/generated/pydicom.filereader.dcmread.html) -- force parameter for extensionless files

### Tertiary (LOW confidence)
- NIfTI modality heuristic -- based on domain knowledge, no formal validation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all versions verified against package registries
- Architecture: HIGH -- patterns from mature medical imaging domain, confirmed by prior research docs
- Pitfalls: HIGH -- well-documented domain issues from STACK.md, ARCHITECTURE.md, PITFALLS.md research
- DICOM edge cases: MEDIUM -- extensive but cannot cover all real-world DICOM variations without test data

**Research date:** 2026-03-24
**Valid until:** 2026-04-24 (stable domain, packages unlikely to have breaking changes in 30 days)

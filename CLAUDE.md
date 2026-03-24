<!-- GSD:project-start source:PROJECT.md -->
## Project

**NextEd — Web-Based Medical Image Editor**

A web-based medical image viewer and segmentation editor for researchers and radiologists. It consists of a Python/FastAPI image server that catalogs NIfTI and DICOM volumes from a filesystem, and a JavaScript web client that loads volumes into browser memory for fast multi-plane viewing and segmentation editing. Think ITK-SNAP, but accessible through a browser.

**Core Value:** Researchers and radiologists can view and segment medical image volumes entirely in the browser — no desktop install, no file transfer friction — with tools comparable to ITK-SNAP's core workflow.

### Constraints

- **Tech stack (server)**: Python with FastAPI — required for pydicom, nibabel, numpy ecosystem
- **Tech stack (client)**: JavaScript with framework suited to pixel-level canvas rendering
- **Data locality**: Server runs locally alongside data — no cloud upload
- **Performance**: Full volume in browser memory; client-side slice rendering for fast scroll-through
- **Package management**: uv (not pip) for Python environment
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Backend: Python Server
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Python | >=3.11 | Runtime | 3.11+ for performance gains (faster startup, cheaper exceptions). 3.12 fine too. | HIGH |
| FastAPI | >=0.115 | HTTP API framework | Project requirement. Async by default, auto OpenAPI docs, excellent for streaming binary data. | HIGH |
| uvicorn | >=0.30 | ASGI server | Standard production server for FastAPI. Use `--reload` in dev. | HIGH |
| pydicom | >=2.4 | DICOM file I/O | The only serious Python DICOM library. Reads pixel data, tags, series grouping. | HIGH |
| nibabel | >=5.2 | NIfTI file I/O | Standard Python NIfTI reader. Loads .nii and .nii.gz, exposes header metadata (affine, voxel spacing). | HIGH |
| numpy | >=1.26 | Array operations | Backbone for all voxel data manipulation. Required by pydicom and nibabel anyway. | HIGH |
| scikit-image | >=0.22 | Image processing algorithms | Otsu thresholding (`skimage.filters.threshold_otsu`), region growing, morphological ops. Mature, well-tested. | HIGH |
| scipy | >=1.12 | Scientific computing | `scipy.ndimage` for connected-component labeling in region grow. Flood fill via `scipy.ndimage.label`. | HIGH |
| python-multipart | >=0.0.9 | Form data parsing | Required by FastAPI for file upload endpoints (Save As). | HIGH |
| highdicom | >=0.23 | DICOM-SEG writing | For saving segmentation as DICOM-SEG format. Only needed if DICOM-SEG export is implemented. | MEDIUM |
| uv | latest | Package management | Project requirement (not pip). | HIGH |
### Frontend: JavaScript Client
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Vanilla JS + HTML5 Canvas | ES2022+ | Core rendering | **No framework.** This is a pixel-pushing application, not a CRUD app. React/Vue add overhead and fight you on canvas. Direct DOM + Canvas 2D API gives full control over pixel rendering, compositing, and mouse events. | HIGH |
| Vite | >=5.0 | Build tool / dev server | Fast HMR, ES module native, zero-config for vanilla JS. Proxy API requests to FastAPI in dev. | HIGH |
| pako | >=2.1 | Gzip decompression | Decompress .nii.gz data client-side if serving raw compressed volumes. Small, fast, no dependencies. | MEDIUM |
### Why NOT These Alternatives
| Technology | Why Not |
|------------|---------|
| **React / Vue / Svelte** | This app is 90% canvas pixel manipulation. Frameworks add complexity for DOM management you barely need. The viewer panels, sliders, and tool panel are simple enough for vanilla JS. Frameworks fight canvas -- they want to own the DOM, but your rendering loop owns the canvas. |
| **Cornerstone.js / OHIF** | Cornerstone is a full DICOM viewer framework with its own loader pipeline, metadata system, and rendering engine. It is designed for DICOM-web servers, not custom FastAPI backends serving raw volumes. Adopting it means conforming to its architecture, which conflicts with the "full volume in browser memory, render slices client-side" design. You would spend more time fighting Cornerstone's abstractions than building your own slice renderer (which is ~50 lines of Canvas 2D code). |
| **Three.js / WebGL** | Overkill for 2D slice rendering. WebGL adds GPU shader complexity for no benefit when you are drawing 2D slices with Canvas 2D `putImageData`. WebGL matters for 3D volume rendering, which is explicitly out of scope. |
| **nifti-reader-js** | Small library for parsing NIfTI headers in JS. Unnecessary here because the server parses NIfTI with nibabel and serves raw volume data as binary ArrayBuffer. The client does not need to parse NIfTI format -- it receives pre-processed voxel arrays. |
| **ITK-wasm** | WebAssembly build of ITK for browser-side image processing. Heavy (~10MB+ WASM), complex build pipeline. Your processing (Otsu, region grow) happens server-side in Python where scipy/scikit-image already excel. |
| **Papaya / BrainBrowser** | Legacy academic viewers, unmaintained. Not suitable as dependencies. |
| **Django** | Heavier than FastAPI, synchronous by default, ORM unnecessary for this file-based app. |
| **Flask** | No async, no auto-docs, no streaming response helpers. FastAPI is strictly better here. |
| **pip** | Project constraint: use uv. |
## Architecture: Why Vanilla JS for the Client
## Data Transfer Architecture
### Volume Transfer: Server to Client
### Slice Rendering: Client-Side
## Client-Side File Organization
## Server-Side File Organization
## Installation
# Server (using uv)
# Client
## Development Workflow
# Terminal 1: Backend
# Terminal 2: Frontend
# vite.config.js proxies /api/* to localhost:8000
## Key Version Notes
## Sources
- Training data knowledge of Python medical imaging ecosystem (pydicom, nibabel, scipy, scikit-image are the canonical libraries -- this has been stable for 5+ years)
- Training data knowledge of FastAPI architecture patterns
- Training data knowledge of Canvas 2D API for medical image rendering
- No live sources were available (WebSearch/WebFetch denied); all version numbers need verification
## Alternatives Considered
| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Backend framework | FastAPI | Django, Flask | FastAPI: async, streaming responses, auto-docs. Project requirement. |
| DICOM I/O | pydicom | SimpleITK | pydicom is lower-level, gives direct tag access needed for series grouping |
| NIfTI I/O | nibabel | SimpleITK, ITK | nibabel is purpose-built for NIfTI, lighter weight, Pythonic API |
| Image processing | scikit-image + scipy | OpenCV (cv2) | scikit-image has cleaner Python API, scipy.ndimage for connected components. OpenCV's Python bindings are clunky and it drags in a huge C++ library. |
| Frontend framework | Vanilla JS | React, Vue, Svelte | Canvas-heavy app; framework overhead not justified (see rationale above) |
| Build tool | Vite | Webpack, Parcel | Vite is fastest DX, ESM-native, minimal config |
| Viewer library | Custom canvas | Cornerstone.js, OHIF | Cornerstone assumes DICOM-web, fights custom backend architecture |
| DICOM-SEG output | highdicom | pydicom raw | highdicom handles DICOM-SEG standard compliance correctly; doing it manually with pydicom is error-prone |
| Package manager | uv | pip, poetry, pdm | Project requirement |
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->

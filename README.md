# ΣIGMA — Segmentation & Image Guided Medical Annotation

**ΣIGMA** is a web-based medical image viewer and segmentation editor for researchers and radiologists. It supports DICOM and NIfTI volumes — no desktop install required.

---

## Features

- **Folder-based catalog** — point ΣIGMA at a folder and it discovers all volumes automatically (each volume typically maps to a CT or MRI series)
- **4-panel viewer** — Axial, Coronal, Sagittal, and Oblique views rendered side-by-side
- **Single-panel mode** — click `A`, `C`, or `S` in the corner of any panel to expand it; press `4` to return to the 4-panel layout
- **Synchronized crosshairs** — scroll the mouse wheel to move through slices; crosshairs update across all panels
- **Segmentation editing** — paint, erase, and label segmentation masks directly in the browser
- **Built-in help** — click `?` in the toolbar for a full tool reference

---

## Getting Started

### Prerequisites

- [uv](https://github.com/astral-sh/uv) — Python package manager
- [Node.js + npm](https://nodejs.org) — for the frontend build tool

### Installation

```bash
# 1. Clone the repo
git clone https://github.com/slowvak/SIGMA.git
cd SIGMA

# 2. Set up the Python environment
uv venv
cd server
uv sync
cd ..

# 3. Install frontend dependencies
cd client
npm install
cd ..
```

### Running

```bash
./start.sh
```

This starts both the FastAPI backend and the Vite dev server. Open your browser to the URL shown in the terminal output.

---

## Usage

1. Click **Open Folder** to select a directory — ΣIGMA will scan it for DICOM and NIfTI volumes
2. Select a volume from the list on the left panel to open it
3. Use the toolbar tools to adjust window/level, paint segmentations, and manage labels
4. Click **Back to Volumes** to return to the volume list

> Click `?` in the upper-right corner for a full description of all tools and keyboard shortcuts.

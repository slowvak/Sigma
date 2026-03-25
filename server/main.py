"""NextEd server — FastAPI application entry point.

Usage:
    python main.py <path> [<path> ...]

Where <path> is a NIfTI file (.nii, .nii.gz), a DICOM directory, or a
directory to scan recursively for volumes.
"""

import sys
from pathlib import Path
import re

# Ensure project root is on sys.path so 'server' package resolves
_project_root = str(Path(__file__).resolve().parent.parent)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from server.api.volumes import router as volumes_router, load_and_cache_volume
from server.catalog.models import VolumeMetadata, SegmentationMetadata

app = FastAPI(title="NextEd Image Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "X-Volume-Dimensions",
        "X-Voxel-Spacing",
        "X-Window-Center",
        "X-Window-Width",
    ],
)

app.include_router(volumes_router)

# Catalog of discovered volumes (populated at startup)
_catalog: list[VolumeMetadata] = []
# Catalog of segmentations grouped by volume ID (volume_id -> list[SegmentationMetadata])
_segmentation_catalog: dict[str, list[SegmentationMetadata]] = {}

_SEG_PATTERN = re.compile(r'_seg(mentation)?\.(nii\.gz|nii)$')


def _find_companion_segmentations(volume_path: Path) -> list[Path]:
    """Find companion segmentation files for a given volume path."""
    stem = volume_path.name
    if stem.endswith('.nii.gz'):
        base = stem[:-7]
    elif stem.endswith('.nii'):
        base = stem[:-4]
    else:
        return []
    
    parent = volume_path.parent
    patterns = [
        f"{base}_segmentation.nii.gz",
        f"{base}_segmentation.nii",
        f"{base}_seg.nii.gz",
        f"{base}_seg.nii",
    ]
    
    found = []
    for pattern in patterns:
        candidate = parent / pattern
        if candidate.exists():
            found.append(candidate)
    return found


@app.get("/api/volumes", response_model=list[VolumeMetadata])
async def list_volumes():
    return _catalog


def _discover_volumes(paths: list[str]) -> list[tuple[str, str]]:
    """Discover NIfTI and DICOM volumes from provided paths.

    Returns list of (filepath, format) tuples.
    """
    found = []
    for p in paths:
        path = Path(p).expanduser().resolve()
        if not path.exists():
            print(f"Warning: {path} does not exist, skipping")
            continue

        if path.is_file():
            if path.suffix == ".gz" or path.suffix == ".nii":
                found.append((str(path), "nifti"))
            elif path.suffix == ".dcm":
                found.append((str(path.parent), "dicom"))
        elif path.is_dir():
            # Scan for NIfTI files
            for nii in sorted(path.rglob("*.nii")):
                if not _SEG_PATTERN.search(nii.name):
                    found.append((str(nii), "nifti"))
            for nii in sorted(path.rglob("*.nii.gz")):
                if not _SEG_PATTERN.search(nii.name):
                    found.append((str(nii), "nifti"))
            # Check for DICOM directories (dirs containing .dcm files)
            dcm_dirs = set()
            for dcm in path.rglob("*.dcm"):
                dcm_dirs.add(str(dcm.parent))
            for d in sorted(dcm_dirs):
                found.append((d, "dicom"))

    return found


def main():
    if len(sys.argv) < 2:
        print("Usage: python main.py <path> [<path> ...]")
        print("  <path> can be a NIfTI file, DICOM directory, or directory to scan")
        sys.exit(1)

    paths = sys.argv[1:]
    volumes = _discover_volumes(paths)

    if not volumes:
        print("No volumes found in provided paths")
        sys.exit(1)

    print(f"Discovered {len(volumes)} volume(s), loading...")

    for i, (filepath, fmt) in enumerate(volumes):
        vol_id = str(i)
        try:
            meta = load_and_cache_volume(vol_id, filepath, fmt)
            _catalog.append(meta)
            _segmentation_catalog[vol_id] = []
            dims = meta.dimensions or []
            print(f"  [{vol_id}] {meta.name} ({fmt}) {dims}")
            
            # Discover segmentations
            if fmt == "nifti":
                comps = _find_companion_segmentations(Path(filepath))
                for j, comp in enumerate(comps):
                    seg_id = f"seg_{vol_id}_{j}"
                    seg_meta = SegmentationMetadata(
                        id=seg_id,
                        name=comp.name,
                        path=str(comp),
                        volume_id=vol_id,
                        dimensions=None  # Can be populated upon load
                    )
                    _segmentation_catalog[vol_id].append(seg_meta)
                    print(f"    ↳ seg: [{seg_id}] {comp.name}")
        except Exception as e:
            print(f"  [{vol_id}] FAILED to load {filepath}: {e}")

    print(f"\nLoaded {len(_catalog)} volume(s). Starting server on http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()

"""NextEd server — FastAPI application entry point.

Usage:
    python main.py <path> [<path> ...]

Where <path> is a NIfTI file (.nii, .nii.gz), a DICOM directory, or a
directory to scan recursively for volumes.
"""

import hashlib
import json
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
import re

# Ensure project root is on sys.path so 'server' package resolves
_project_root = str(Path(__file__).resolve().parent.parent)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from server.api.volumes import router as volumes_router, register_volume
from server.api.segmentations import router as segmentations_router
from server.api.ai import router as ai_router, set_models_dir
from server.api.task import router as task_router
from server.api.ws import ws_router
from server.catalog.models import VolumeMetadata, SegmentationMetadata


@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    """Start/stop the filesystem watcher alongside the server."""
    from server.watcher.observer import start_watcher

    paths_to_watch = getattr(app_instance.state, '_watch_paths', [])
    observer = None
    consumer_task = None
    debouncer = None
    if paths_to_watch:
        observer, consumer_task, debouncer = await start_watcher(paths_to_watch)
        print(f"Watcher started on {len(paths_to_watch)} path(s)")
    yield
    # Shutdown: stop observer, cancel consumer
    if observer:
        observer.stop()
        observer.join(timeout=5)
    if consumer_task:
        consumer_task.cancel()
    if debouncer:
        debouncer.cancel_all()
    print("Watcher stopped")


app = FastAPI(title="NextEd Image Server", lifespan=lifespan)

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
        "X-AI-Labels",
        "X-AI-Report",
    ],
)

app.include_router(volumes_router)
app.include_router(segmentations_router)
app.include_router(ai_router)
app.include_router(task_router)
app.include_router(ws_router)

from server.api.config import router as config_router
app.include_router(config_router)

# Catalog of discovered volumes (populated at startup)
_catalog: list[VolumeMetadata] = []
# Catalog of segmentations grouped by volume ID
_segmentation_catalog: dict[str, list[SegmentationMetadata]] = {}

_SEG_PATTERN = re.compile(r'_seg(mentation)?\.(nii\.gz|nii)$')
_CACHE_FILENAME = ".nexted_cache.json"
_MIN_DIM = 5  # Minimum dimension size to include a volume


def _find_companion_segmentations(volume_path: Path) -> list[tuple[Path, list[dict]]]:
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
            labels = []
            json_candidate = candidate.with_name(
                candidate.name.replace('.nii.gz', '.json').replace('.nii', '.json'))
            if json_candidate.exists():
                try:
                    with open(json_candidate) as f:
                        data = json.load(f)
                        labels = data.get("labels", [])
                except Exception as e:
                    print(f"Warning: Failed to load labels from {json_candidate}: {e}")
            found.append((candidate, labels))
    return found


_cache_path: Path | None = None  # Set in main(), used by label endpoints


@app.get("/api/v1/volumes", response_model=list[VolumeMetadata])
async def list_volumes():
    return _catalog


def _read_cache() -> dict:
    """Read the full cache file."""
    if _cache_path and _cache_path.exists():
        try:
            with open(_cache_path) as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _write_cache(cache: dict):
    """Write the full cache file."""
    if not _cache_path:
        return
    try:
        with open(_cache_path, "w") as f:
            json.dump(cache, f, indent=2, default=str)
    except Exception as e:
        print(f"Warning: Could not write cache: {e}")


@app.get("/api/v1/volumes/{volume_id}/labels")
async def get_labels(volume_id: str):
    """Return saved label definitions (name, color) for a volume."""
    cache = _read_cache()
    labels = cache.get("labels", {}).get(volume_id, [])
    return labels


@app.put("/api/v1/volumes/{volume_id}/labels")
async def put_labels(volume_id: str, labels: list[dict]):
    """Save label definitions (name, value, color) for a volume."""
    cache = _read_cache()
    if "labels" not in cache:
        cache["labels"] = {}
    cache["labels"][volume_id] = labels
    _write_cache(cache)
    return {"ok": True}


@app.get("/api/v1/debug/volumes/{volume_id}/paths")
async def debug_volume_paths(volume_id: str):
    """Debug endpoint to verify DICOM file paths are retained."""
    from server.api.volumes import _path_registry
    if volume_id not in _path_registry:
        raise HTTPException(status_code=404, detail=f"Volume {volume_id} not found")
    path, fmt = _path_registry[volume_id]
    if fmt == "dicom_series":
        import json as _json
        files = _json.loads(path)
        return {"format": fmt, "file_count": len(files), "files": files}
    return {"format": fmt, "path": path}


# --- Volume entry: unified representation for discovered volumes ---
# Each entry is a dict with keys:
#   name, path, format, dimensions, voxel_spacing, dtype, modality
#   For DICOM series: path = JSON-encoded list of file paths,
#                     format = "dicom_series"

def _discover_nifti_volumes(root: Path) -> list[dict]:
    """Find NIfTI volumes under root, read headers for metadata."""
    import nibabel as nib
    entries = []
    nifti_files = sorted(root.rglob("*.nii")) + sorted(root.rglob("*.nii.gz"))

    for nii in nifti_files:
        if _SEG_PATTERN.search(nii.name):
            continue
        try:
            img = nib.load(str(nii))
            canonical = nib.as_closest_canonical(img)
            dims = [int(d) for d in canonical.shape[:3]]
            if any(d < _MIN_DIM for d in dims):
                continue
            spacing = [float(s) for s in canonical.header.get_zooms()[:3]]
            entries.append({
                "name": nii.stem.replace(".nii", ""),
                "path": str(nii),
                "format": "nifti",
                "dimensions": dims,
                "voxel_spacing": spacing,
                "dtype": "float32",
                "modality": "unknown",
            })
        except Exception as e:
            print(f"  skipped {nii}: {e}")
    return entries


def _discover_dicom_series(root: Path) -> list[dict]:
    """Find DICOM series under root, grouped by SeriesInstanceUID."""
    from server.loaders.dicom_loader import discover_dicom_series
    series_list = discover_dicom_series(root)
    entries = []
    for s in series_list:
        entries.append({
            "name": s["name"],
            "path": json.dumps(s["files"]),  # Store file list as JSON string
            "format": "dicom_series",
            "dimensions": s["dimensions"],
            "voxel_spacing": s["voxel_spacing"],
            "dtype": "float32",
            "modality": s.get("modality", "unknown"),
            "study_instance_uid": s.get("study_uid"),
            "series_instance_uid": s.get("series_uid"),
        })
    return entries


def _discover_all(paths: list[str]) -> list[dict]:
    """Discover NIfTI and DICOM volumes from provided paths.

    Returns list of volume entry dicts ready for catalog registration.
    """
    entries = []
    seen_paths = set()

    for p in paths:
        path = Path(p).expanduser().resolve()
        if not path.exists():
            print(f"Warning: {path} does not exist, skipping")
            continue

        if path.is_file():
            if path.suffix in (".gz", ".nii"):
                entries.extend(_discover_nifti_volumes(path.parent))
            elif path.suffix.lower() in (".dcm", ".ima"):
                entries.extend(_discover_dicom_series(path.parent))
        elif path.is_dir():
            entries.extend(_discover_nifti_volumes(path))
            entries.extend(_discover_dicom_series(path))

    # Deduplicate by path
    unique = []
    for e in entries:
        if e["path"] not in seen_paths:
            seen_paths.add(e["path"])
            unique.append(e)
    return unique


def _compute_cache_key(entries: list[dict]) -> str:
    """Compute a hash of discovered entries for cache invalidation."""
    # Use paths only — lightweight and changes when files are added/removed
    paths = sorted(e["path"] for e in entries)
    content = json.dumps(paths)
    return hashlib.md5(content.encode()).hexdigest()


def _load_cache(cache_path: Path, expected_key: str) -> list[dict] | None:
    """Load cached catalog if valid. Returns None on miss."""
    if not cache_path.exists():
        return None
    try:
        with open(cache_path) as f:
            cache = json.load(f)
        if cache.get("key") != expected_key:
            print("Cache invalidated (volume list changed)")
            return None
        return cache.get("volumes", [])
    except Exception as e:
        print(f"Cache unreadable ({e}), rescanning")
        return None


def _save_cache(cache_path: Path, key: str, catalog: list[VolumeMetadata],
                seg_catalog: dict[str, list[SegmentationMetadata]],
                path_registry: list[tuple[str, str, str]]):
    """Save catalog metadata to JSON cache."""
    volumes = []
    for meta in catalog:
        entry = meta.model_dump()
        for vol_id, path, fmt in path_registry:
            if vol_id == meta.id:
                entry["_path"] = path
                entry["_format"] = fmt
                break
        segs = seg_catalog.get(meta.id, [])
        entry["_segmentations"] = [s.model_dump() for s in segs]
        volumes.append(entry)

    cache = {"key": key, "volumes": volumes}
    try:
        with open(cache_path, "w") as f:
            json.dump(cache, f, indent=2, default=str)
        print(f"Saved catalog cache to {cache_path}")
    except Exception as e:
        print(f"Warning: Could not save cache: {e}")


def _register_entries(entries: list[dict]) -> tuple[
    list[VolumeMetadata],
    dict[str, list[SegmentationMetadata]],
    list[tuple[str, str, str]],
]:
    """Register discovered volume entries into the API layer."""
    catalog = []
    seg_catalog = {}
    path_registry = []

    for i, entry in enumerate(entries):
        vol_id = str(i)
        try:
            meta = VolumeMetadata(
                id=vol_id,
                name=entry["name"],
                path=entry["path"],
                format=entry["format"],
                dimensions=entry.get("dimensions"),
                voxel_spacing=entry.get("voxel_spacing"),
                dtype=entry.get("dtype"),
                modality=entry.get("modality", "unknown"),
                study_instance_uid=entry.get("study_instance_uid"),
                series_instance_uid=entry.get("series_instance_uid"),
            )

            register_volume(vol_id, meta, entry["path"], entry["format"])
            catalog.append(meta)
            path_registry.append((vol_id, entry["path"], entry["format"]))
            seg_catalog[vol_id] = []

            dims = meta.dimensions or []
            print(f"  [{vol_id}] {meta.name} ({entry['format']}) {dims}")

            # Discover segmentations for NIfTI volumes
            if entry["format"] == "nifti":
                fpath = Path(entry["path"])
                comps = _find_companion_segmentations(fpath)
                for j, (comp_path, comp_labels) in enumerate(comps):
                    seg_id = f"seg_{vol_id}_{j}"
                    seg_meta = SegmentationMetadata(
                        id=seg_id,
                        name=comp_path.name,
                        path=str(comp_path),
                        volume_id=vol_id,
                        dimensions=None,
                        labels=comp_labels,
                    )
                    seg_catalog[vol_id].append(seg_meta)
                    print(f"    ↳ seg: [{seg_id}] {comp_path.name}")

        except Exception as e:
            print(f"  [{vol_id}] FAILED: {e}")

    return catalog, seg_catalog, path_registry


def _load_from_cache(cached_volumes: list[dict]):
    """Restore catalog from cached JSON entries."""
    catalog = []
    seg_catalog = {}
    path_registry = []

    for entry in cached_volumes:
        vol_id = entry["id"]
        filepath = entry.get("_path", entry.get("path", ""))
        fmt = entry.get("_format", entry.get("format", "nifti"))
        segs_data = entry.pop("_segmentations", [])
        entry.pop("_path", None)
        entry.pop("_format", None)

        meta = VolumeMetadata(**entry)
        register_volume(vol_id, meta, filepath, fmt)
        catalog.append(meta)
        path_registry.append((vol_id, filepath, fmt))

        seg_catalog[vol_id] = []
        for sd in segs_data:
            seg_meta = SegmentationMetadata(**sd)
            seg_catalog[vol_id].append(seg_meta)

    return catalog, seg_catalog, path_registry


def main():
    from server.api.config import get_config_data
    config = get_config_data()

    paths = sys.argv[1:]
    if not paths and config.get("source_directory"):
        paths = [config["source_directory"]]
        
    if not paths:
        print("Warning: No paths provided via CLI and no source_directory configured.")
        print("Server will start empty. You can set the source directory in Preferences.")


    # Determine cache location
    global _cache_path
    if paths:
        cache_dir = Path(paths[0]).expanduser().resolve()
        if cache_dir.is_file():
            cache_dir = cache_dir.parent
        cache_path = cache_dir / _CACHE_FILENAME
    else:
        cache_path = Path(_CACHE_FILENAME) # local dir fallback
    _cache_path = cache_path

    # Set up AI models directory
    models_dir = Path(__file__).resolve().parent.parent / "models"
    models_dir.mkdir(exist_ok=True)
    set_models_dir(models_dir)
    # The ai models are now managed via the unified config API.
    # We leave set_models_dir purely for any directory artifacts if needed,
    # but the config will drive the inference server logic.
    print("AI config expects unified config.json")

    t0 = time.time()
    print("Scanning for volumes...")
    entries = _discover_all(paths)

    if not entries:
        print("No volumes found in provided paths")
    else:
        print(f"Discovered {len(entries)} volume(s) in {time.time() - t0:.1f}s")

        cache_key = _compute_cache_key(entries)
        cached = _load_cache(cache_path, cache_key)

        if cached is not None:
            print(f"Loading {len(cached)} volume(s) from cache...")
            t1 = time.time()
            cat, seg_cat, _ = _load_from_cache(cached)
            _catalog.clear()
            _catalog.extend(cat)
            _segmentation_catalog.update(seg_cat)
            print(f"Loaded {len(_catalog)} volume(s) from cache in {time.time() - t1:.2f}s")
        else:
            print("Registering volumes...")
            t1 = time.time()
            cat, seg_cat, path_reg = _register_entries(entries)
            _catalog.clear()
            _catalog.extend(cat)
            _segmentation_catalog.update(seg_cat)
            print(f"Registered {len(_catalog)} volume(s) in {time.time() - t1:.1f}s")

            _save_cache(cache_path, cache_key, _catalog, _segmentation_catalog, path_reg)

    # Resolve watched paths for the watcher (lifespan reads from app.state)
    watch_paths = []
    for p in paths:
        resolved = Path(p).expanduser().resolve()
        if resolved.is_file():
            watch_paths.append(str(resolved.parent))
        elif resolved.is_dir():
            watch_paths.append(str(resolved))
    app.state._watch_paths = watch_paths

    print(f"\n{len(_catalog)} volume(s) ready. Starting server on http://localhost:8050")
    print("Volume data will be loaded on demand when opened in the viewer.")
    uvicorn.run(app, host="0.0.0.0", port=8050)


if __name__ == "__main__":
    main()

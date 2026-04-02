"""AI model execution API — proxy inference to a single AI server."""

from __future__ import annotations

import asyncio
import json
import tempfile
import uuid
from pathlib import Path

import numpy as np
import nibabel as nib
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

router = APIRouter(prefix="/api/v1/ai", tags=["ai"])

# In-memory job store: job_id -> job dict
_jobs: dict[str, dict] = {}

# Path to the models config directory (set by main.py at startup)
_models_dir: Path | None = None


def set_models_dir(path: Path):
    global _models_dir
    _models_dir = path


def _load_config() -> dict:
    """Read ai-models.json from the models directory."""
    if not _models_dir:
        raise HTTPException(status_code=500, detail="Models directory not configured")
    config_path = _models_dir / "ai-models.json"
    if not config_path.exists():
        return {"server": "", "models": []}
    with open(config_path) as f:
        return json.load(f)


@router.get("/models")
async def list_models():
    """Return available AI models from config."""
    config = _load_config()
    return config.get("models", [])


@router.post("/run")
async def run_model(request: Request):
    """Submit an AI inference job.

    Request body: { "volume_id": "0", "model_id": "totalsegmentator" }
    Optionally includes "seg_data" as base64 when model.accepts_labels is true,
    but the preferred path is for the client to upload seg data first via
    POST /api/v1/ai/upload-seg/{volume_id}.

    Returns: { "job_id": "uuid" }
    """
    from server.api.volumes import _volume_cache, _ensure_loaded, _path_registry
    from server.main import _catalog

    body = await request.json()
    volume_id = body.get("volume_id")
    model_id = body.get("model_id")

    if not volume_id or not model_id:
        raise HTTPException(status_code=400, detail="volume_id and model_id required")

    # Validate volume exists and is loaded
    vol_meta = next((v for v in _catalog if v.id == volume_id), None)
    if not vol_meta:
        raise HTTPException(status_code=404, detail=f"Volume {volume_id} not found")

    _ensure_loaded(volume_id)
    if volume_id not in _volume_cache:
        raise HTTPException(status_code=400, detail="Volume not loaded")

    # Find model config
    config = _load_config()
    model_cfg = next((m for m in config.get("models", []) if m["id"] == model_id), None)
    if not model_cfg:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    # Create job
    job_id = str(uuid.uuid4())[:8]
    _jobs[job_id] = {
        "id": job_id,
        "status": "queued",
        "progress": 0,
        "volume_id": volume_id,
        "model_id": model_id,
        "model_config": model_cfg,
        "result": None,
        "error": None,
    }

    # Run inference in background
    asyncio.create_task(_run_inference(job_id))
    return {"job_id": job_id}


async def _run_inference(job_id: str):
    """Execute inference: write temp NIfTI, POST to AI server, parse result."""
    import httpx

    job = _jobs[job_id]
    job["status"] = "running"
    job["progress"] = 10

    volume_id = job["volume_id"]
    model_cfg = job["model_config"]
    config = _load_config()
    server_url = config.get("server", "").rstrip("/")

    if not server_url:
        job["status"] = "failed"
        job["error"] = "No AI server configured"
        return

    try:
        from server.api.volumes import _volume_cache

        data, metadata = _volume_cache[volume_id]
        affine = metadata.get("affine", np.eye(4))
        dims = metadata["dimensions"]

        # Write volume to temp NIfTI file
        # data is (Z,Y,X) float32 C-contiguous; transpose to (X,Y,Z) for NIfTI
        vol_xyz = data.transpose(2, 1, 0).astype(np.float32)
        vol_img = nib.Nifti1Image(vol_xyz, affine)

        job["progress"] = 20

        with tempfile.TemporaryDirectory() as tmpdir:
            input_path = Path(tmpdir) / "input.nii.gz"
            nib.save(vol_img, input_path)

            job["progress"] = 30

            # Build multipart request
            files = {"image": ("input.nii.gz", open(input_path, "rb"), "application/gzip")}
            form_data = {"weights": model_cfg.get("weights", "")}

            # If model accepts labels and we have seg data cached, send it
            if model_cfg.get("accepts_labels") and volume_id in _seg_upload_cache:
                seg_bytes = _seg_upload_cache[volume_id]
                seg_arr = np.frombuffer(seg_bytes, dtype=np.uint8).reshape(
                    dims[2], dims[1], dims[0]
                )
                seg_xyz = seg_arr.transpose(2, 1, 0)
                seg_img = nib.Nifti1Image(seg_xyz.astype(np.uint8), affine)
                seg_path = Path(tmpdir) / "labels.nii.gz"
                nib.save(seg_img, seg_path)
                files["labels"] = ("labels.nii.gz", open(seg_path, "rb"), "application/gzip")

            job["progress"] = 40

            endpoint = model_cfg.get("endpoint", "/predict")
            url = f"{server_url}{endpoint}"

            async with httpx.AsyncClient(timeout=600.0) as client:
                job["progress"] = 50
                resp = await client.post(url, files=files, data=form_data)

            if resp.status_code != 200:
                job["status"] = "failed"
                job["error"] = f"AI server returned {resp.status_code}: {resp.text[:500]}"
                return

            job["progress"] = 70

            # Parse response — expect multipart with segmentation + optional report
            # For now, handle two response formats:
            # 1. Content-Type: application/gzip or application/octet-stream → raw NIfTI mask
            # 2. Content-Type: multipart/... → segmentation file + report JSON
            content_type = resp.headers.get("content-type", "")

            result_mask = None
            result_report = {}

            # Check for label map in response headers
            ai_labels_header = resp.headers.get("x-ai-labels", "")
            if ai_labels_header:
                try:
                    result_report["labels"] = json.loads(ai_labels_header)
                except Exception:
                    pass

            if "multipart" in content_type:
                # Parse multipart response
                result_mask, result_report = _parse_multipart_response(resp, tmpdir)
            else:
                # Treat entire body as NIfTI mask
                mask_path = Path(tmpdir) / "output.nii.gz"
                mask_path.write_bytes(resp.content)
                result_mask = mask_path

            job["progress"] = 80

            if result_mask and result_mask.exists():
                # Load the mask NIfTI and convert to uint8 C-contiguous (Z,Y,X)
                mask_img = nib.load(str(result_mask))
                mask_canonical = nib.as_closest_canonical(mask_img)
                mask_data = np.asarray(mask_canonical.dataobj).astype(np.uint8)
                # mask_data is (X,Y,Z) after canonical; transpose to (Z,Y,X)
                mask_zyx = mask_data.transpose(2, 1, 0)
                mask_bytes = np.ascontiguousarray(mask_zyx).tobytes()

                # Determine labels from model config or report
                labels = model_cfg.get("labels", [])
                if result_report.get("labels"):
                    labels = result_report["labels"]

                job["result"] = {
                    "mask": mask_bytes,
                    "dims": list(mask_zyx.shape),  # [Z, Y, X]
                    "labels": labels,
                    "report": result_report,
                }
                job["status"] = "completed"
                job["progress"] = 100
            else:
                job["status"] = "failed"
                job["error"] = "AI server did not return a segmentation mask"

    except Exception as e:
        import traceback
        traceback.print_exc()
        job["status"] = "failed"
        job["error"] = str(e)


def _parse_multipart_response(resp, tmpdir):
    """Parse a multipart response from AI server. Returns (mask_path, report_dict)."""
    # Simple boundary-based parser for multipart responses
    content_type = resp.headers.get("content-type", "")
    mask_path = None
    report = {}

    # If it's not actually multipart, treat as NIfTI
    if "boundary" not in content_type:
        p = Path(tmpdir) / "output.nii.gz"
        p.write_bytes(resp.content)
        return p, {}

    boundary = content_type.split("boundary=")[-1].strip()
    parts = resp.content.split(f"--{boundary}".encode())

    for part in parts:
        if b"Content-Disposition" not in part:
            continue
        header_end = part.find(b"\r\n\r\n")
        if header_end < 0:
            continue
        header_str = part[:header_end].decode("utf-8", errors="replace")
        body = part[header_end + 4:]
        # Strip trailing \r\n
        if body.endswith(b"\r\n"):
            body = body[:-2]

        if "segmentation" in header_str.lower() or ".nii" in header_str.lower():
            mask_path = Path(tmpdir) / "output.nii.gz"
            mask_path.write_bytes(body)
        elif "report" in header_str.lower() or "json" in header_str.lower():
            try:
                report = json.loads(body)
            except Exception:
                pass

    return mask_path, report


# Cache for client-uploaded segmentation data (for accepts_labels models)
_seg_upload_cache: dict[str, bytes] = {}


@router.post("/upload-seg/{volume_id}")
async def upload_seg_for_ai(volume_id: str, request: Request):
    """Upload current segmentation so AI model can use it as input.

    Client sends raw uint8 segVolume bytes (same layout as save segmentation).
    Cached in memory until the AI job reads it.
    """
    body = await request.body()
    _seg_upload_cache[volume_id] = body
    return {"ok": True, "size": len(body)}


@router.get("/jobs/{job_id}/status")
async def job_status_sse(job_id: str):
    """SSE stream of job progress updates."""
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_stream():
        last_progress = -1
        while True:
            job = _jobs.get(job_id)
            if not job:
                yield f"data: {json.dumps({'status': 'not_found'})}\n\n"
                break

            if job["progress"] != last_progress or job["status"] in ("completed", "failed"):
                msg = {
                    "status": job["status"],
                    "progress": job["progress"],
                }
                if job["error"]:
                    msg["error"] = job["error"]
                yield f"data: {json.dumps(msg)}\n\n"
                last_progress = job["progress"]

            if job["status"] in ("completed", "failed"):
                break

            await asyncio.sleep(0.5)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/jobs/{job_id}/result")
async def get_job_result(job_id: str):
    """Return the inference result — mask as binary uint8, labels + report as JSON.

    Response headers:
    - X-Volume-Dimensions: Z,Y,X dimensions of the mask
    - X-AI-Labels: JSON-encoded label array
    - X-AI-Report: JSON-encoded report object
    """
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = _jobs[job_id]
    if job["status"] != "completed":
        raise HTTPException(status_code=400, detail=f"Job not completed (status: {job['status']})")

    result = job["result"]
    if not result:
        raise HTTPException(status_code=500, detail="No result data")

    headers = {
        "X-Volume-Dimensions": ",".join(str(d) for d in result["dims"]),
        "X-AI-Labels": json.dumps(result["labels"]),
        "X-AI-Report": json.dumps(result.get("report", {})),
    }

    return Response(
        content=result["mask"],
        media_type="application/octet-stream",
        headers=headers,
    )

"""SIGMA AI Inference Server — runs on a GPU machine (DGX Spark, etc.).

Wraps TotalSegmentator and other models behind a simple HTTP API.

Usage:
    python server.py [--host 0.0.0.0] [--port 8080]

The SIGMA image server proxies requests here via the config in
models/ai-models.json: { "server": "http://<this-machine>:8080" }
"""

import argparse
import json
import shutil
import tempfile
from pathlib import Path

import nibabel as nib
import numpy as np
import uvicorn
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import Response

app = FastAPI(title="SIGMA AI Inference Server")

# Registry of model runners — keyed by weights string from config
_runners: dict[str, callable] = {}


def register_runner(weights_name: str):
    """Decorator to register a model runner function."""
    def decorator(fn):
        _runners[weights_name] = fn
        return fn
    return decorator


# ---------------------------------------------------------------------------
# TotalSegmentator runner
# ---------------------------------------------------------------------------

@register_runner("totalsegmentator_v2")
def run_totalsegmentator(input_path: Path, output_dir: Path, labels_path: Path | None):
    """Run TotalSegmentator on input NIfTI, return output mask path + label map.

    TotalSegmentator produces one NIfTI per structure in output_dir/.
    We merge them into a single multi-label mask volume.
    """
    from totalsegmentator.python_api import totalsegmentator

    # Run inference — produces one .nii.gz per structure in output_dir
    totalsegmentator(input_path, output_dir, fast=True)

    # Merge individual structure masks into a single label volume.
    # TotalSegmentator names files like "spleen.nii.gz", "liver.nii.gz", etc.
    # We assign sequential label values and build a label map.
    mask_files = sorted(output_dir.glob("*.nii.gz"))
    if not mask_files:
        raise RuntimeError("TotalSegmentator produced no output files")

    # Load first mask to get shape and affine
    ref_img = nib.load(str(mask_files[0]))
    shape = ref_img.shape[:3]
    affine = ref_img.affine
    combined = np.zeros(shape, dtype=np.uint8)
    labels = []

    # Standard colors for common structures (expand as needed)
    STRUCTURE_COLORS = {
        "spleen": "#8b0000",
        "kidney_right": "#2e8b57",
        "kidney_left": "#228b22",
        "liver": "#daa520",
        "stomach": "#ff69b4",
        "aorta": "#ff0000",
        "pancreas": "#ffa500",
        "lung_upper_lobe_left": "#4682b4",
        "lung_lower_lobe_left": "#5f9ea0",
        "lung_upper_lobe_right": "#6495ed",
        "lung_middle_lobe_right": "#7b68ee",
        "lung_lower_lobe_right": "#87ceeb",
        "heart": "#dc143c",
        "gallbladder": "#32cd32",
        "esophagus": "#ff8c00",
        "trachea": "#00ced1",
        "small_bowel": "#f0e68c",
        "colon": "#bdb76b",
        "urinary_bladder": "#9370db",
    }

    for i, mask_file in enumerate(mask_files):
        label_val = i + 1
        if label_val > 255:
            break  # uint8 max

        structure_name = mask_file.stem.replace(".nii", "")
        img = nib.load(str(mask_file))
        data = np.asarray(img.dataobj)

        # Write into combined mask (later structures overwrite overlaps)
        combined[data > 0] = label_val

        color = STRUCTURE_COLORS.get(structure_name, _default_color(label_val))
        labels.append({
            "value": label_val,
            "name": structure_name,
            "color": color,
        })

    # Save combined mask
    combined_path = output_dir / "combined_mask.nii.gz"
    combined_img = nib.Nifti1Image(combined, affine)
    combined_img.set_data_dtype(np.uint8)
    nib.save(combined_img, str(combined_path))

    return combined_path, labels


# ---------------------------------------------------------------------------
# Generic mhub Docker runner (template for other models)
# ---------------------------------------------------------------------------

@register_runner("mhub_docker")
def run_mhub_docker(input_path: Path, output_dir: Path, labels_path: Path | None,
                    docker_image: str = "mhubai/totalsegmentator"):
    """Run an mhub.ai Docker container for inference.

    Mounts input/output dirs and runs the container with --gpus all.
    """
    import subprocess

    input_mount = input_path.parent
    cmd = [
        "docker", "run", "--rm", "--gpus", "all",
        "-v", f"{input_mount}:/input:ro",
        "-v", f"{output_dir}:/output",
        docker_image,
        "--input", f"/input/{input_path.name}",
        "--output", "/output/output.nii.gz",
    ]

    if labels_path:
        labels_mount = labels_path.parent
        cmd.extend(["-v", f"{labels_mount}:/labels:ro"])
        cmd.extend(["--labels", f"/labels/{labels_path.name}"])

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        raise RuntimeError(f"Docker failed: {result.stderr[:500]}")

    output_mask = output_dir / "output.nii.gz"
    if not output_mask.exists():
        # Try to find any NIfTI output
        niftis = list(output_dir.glob("*.nii.gz"))
        if niftis:
            output_mask = niftis[0]
        else:
            raise RuntimeError("Docker container produced no output")

    return output_mask, []


# ---------------------------------------------------------------------------
# Refine segmentation runner (placeholder — uses existing labels)
# ---------------------------------------------------------------------------

@register_runner("refine_v1")
def run_refine(input_path: Path, output_dir: Path, labels_path: Path | None):
    """Placeholder: refine existing segmentation using image features.

    For now, just passes through the input labels unchanged.
    Replace with actual refinement model (e.g. SAM, interactive seg).
    """
    if not labels_path or not labels_path.exists():
        raise RuntimeError("Refine model requires existing labels as input")

    # Placeholder: copy labels through (actual model would refine boundaries)
    output_path = output_dir / "refined.nii.gz"
    shutil.copy2(labels_path, output_path)
    return output_path, []


# ---------------------------------------------------------------------------
# HTTP endpoint
# ---------------------------------------------------------------------------

@app.post("/predict")
async def predict(
    image: UploadFile = File(...),
    weights: str = Form(""),
    labels: UploadFile | None = File(None),
):
    """Run model inference on a NIfTI volume.

    Args:
        image: Input NIfTI volume (.nii.gz)
        weights: Model weights identifier (maps to a registered runner)
        labels: Optional existing segmentation NIfTI (for accepts_labels models)

    Returns:
        NIfTI mask as binary response, with X-AI-Labels header containing
        the JSON label map.
    """
    if weights not in _runners:
        available = list(_runners.keys())
        return Response(
            content=json.dumps({"error": f"Unknown weights '{weights}'. Available: {available}"}),
            status_code=400,
            media_type="application/json",
        )

    with tempfile.TemporaryDirectory(prefix="sigma_ai_") as tmpdir:
        tmpdir = Path(tmpdir)

        # Save uploaded files
        input_path = tmpdir / "input.nii.gz"
        input_path.write_bytes(await image.read())

        labels_path = None
        if labels:
            labels_path = tmpdir / "labels.nii.gz"
            labels_path.write_bytes(await labels.read())

        output_dir = tmpdir / "output"
        output_dir.mkdir()

        # Run the model
        try:
            mask_path, label_map = _runners[weights](input_path, output_dir, labels_path)
        except Exception as e:
            import traceback
            traceback.print_exc()
            return Response(
                content=json.dumps({"error": str(e)}),
                status_code=500,
                media_type="application/json",
            )

        # Read output mask and return as binary
        mask_bytes = mask_path.read_bytes()

        headers = {
            "X-AI-Labels": json.dumps(label_map),
        }

        return Response(
            content=mask_bytes,
            media_type="application/gzip",
            headers=headers,
        )


@app.get("/health")
async def health():
    """Health check — also reports available models and GPU status."""
    import torch
    gpu_available = torch.cuda.is_available()
    gpu_name = torch.cuda.get_device_name(0) if gpu_available else "none"
    gpu_mem = f"{torch.cuda.get_device_properties(0).total_mem / 1e9:.1f} GB" if gpu_available else "n/a"

    return {
        "status": "ok",
        "gpu": gpu_name,
        "gpu_memory": gpu_mem,
        "models": list(_runners.keys()),
    }


def _default_color(idx: int) -> str:
    """Generate a deterministic hex color for a label index."""
    colors = [
        "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff",
        "#ff8800", "#8800ff", "#00ff88", "#ff0088", "#0088ff", "#88ff00",
        "#cc4444", "#44cc44", "#4444cc", "#cccc44", "#44cccc", "#cc44cc",
    ]
    return colors[idx % len(colors)]


def main():
    parser = argparse.ArgumentParser(description="SIGMA AI Inference Server")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address")
    parser.add_argument("--port", type=int, default=8080, help="Port")
    args = parser.parse_args()

    print(f"Registered model runners: {list(_runners.keys())}")
    print(f"Starting inference server on http://{args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()

# SIGMA AI Inference Server

Runs on a GPU machine (DGX Spark, cloud GPU, etc.) and serves AI model inference
for the SIGMA medical image viewer.

## Setup on DGX Spark

```bash
# Clone or copy this directory to the DGX
cd inference-server

# Create environment and install
uv venv && uv sync

# Run
uv run python server.py --host 0.0.0.0 --port 8080
```

## Configure SIGMA to use it

Edit `models/ai-models.json` on the machine running the SIGMA image server:
```json
{
  "server": "http://<dgx-ip>:8080",
  "models": [...]
}
```

## Health check

```bash
curl http://<dgx-ip>:8080/health
# {"status":"ok","gpu":"NVIDIA ...","gpu_memory":"80.0 GB","models":["totalsegmentator_v2","refine_v1"]}
```

## Adding new models

Add a runner function in `server.py`:
```python
@register_runner("my_model_weights")
def run_my_model(input_path, output_dir, labels_path):
    # Run inference, write output NIfTI to output_dir
    mask_path = output_dir / "output.nii.gz"
    labels = [{"value": 1, "name": "tumor", "color": "#ff0000"}]
    return mask_path, labels
```

Then add the model to `models/ai-models.json` with `"weights": "my_model_weights"`.

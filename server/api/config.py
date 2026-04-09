from fastapi import APIRouter, HTTPException, Request
import json
import asyncio
from pathlib import Path
from pydantic import BaseModel
from typing import Dict, List, Any

router = APIRouter(prefix="/api/v1/config", tags=["config"])

# Path resolves to: server/api/config.py -> parent -> parent -> parent == root
_CONFIG_PATH = Path(__file__).resolve().parent.parent.parent / "config.json"

DEFAULT_CONFIG = {
    "source_directory": "",
    "window_level_presets": {
        "Brain": {"center": 40, "width": 80},
        "Bone": {"center": 500, "width": 3000},
        "Lung": {"center": -500, "width": 1000},
        "Abd": {"center": 125, "width": 450}
    },
    "default_labels": {
        "1": "Label 1",
        "2": "Label 2",
        "3": "Label 3",
        "4": "Label 4",
        "5": "Label 5"
    },
    "ai": {
        "server": "http://localhost:8080",
        "models": [
            {
                "id": "totalsegmentator",
                "name": "TotalSegmentator",
                "description": "104-structure CT segmentation (fast mode)",
                "modality": ["CT"],
                "endpoint": "/predict",
                "weights": "totalsegmentator_v2",
                "accepts_labels": False,
                "labels": []
            },
            {
                "id": "refine-seg",
                "name": "Refine Segmentation",
                "description": "Refines existing label boundaries using image features",
                "modality": [],
                "endpoint": "/predict",
                "weights": "refine_v1",
                "accepts_labels": True,
                "labels": []
            }
        ]
    }
}

def get_config_data() -> dict:
    if not _CONFIG_PATH.exists():
        # Initialize default config file
        with open(_CONFIG_PATH, "w") as f:
            json.dump(DEFAULT_CONFIG, f, indent=2)
        return DEFAULT_CONFIG
    
    try:
        with open(_CONFIG_PATH, "r") as f:
            data = json.load(f)
            # Merge with default config to ensure all keys exist
            merged = DEFAULT_CONFIG.copy()
            merged.update(data)
            return merged
    except Exception as e:
        print(f"Error reading config: {e}")
        return DEFAULT_CONFIG

def set_config_data(new_config: dict):
    with open(_CONFIG_PATH, "w") as f:
        json.dump(new_config, f, indent=2)

@router.get("")
async def get_config():
    return get_config_data()

@router.put("")
async def update_config(request: Request):
    new_config = await request.json()
    set_config_data(new_config)
    return {"status": "success"}


def _open_native_folder_dialog() -> str:
    """Open a native OS folder picker dialog (blocking). Returns POSIX path or ''.

    Strategy (macOS):
      osascript — single call that returns a POSIX path directly.
    Fallback:
      tkinter — for Linux / Windows or if osascript is unavailable.
    """
    import sys
    import subprocess
    import os

    # ── macOS: osascript (primary) ────────────────────────────────────────────
    if sys.platform == "darwin":
        try:
            # activate SystemUIServer to bring the dialog to front without
            # requiring Automation permission for System Events / Finder
            script = (
                'tell application "SystemUIServer" to activate\n'
                'POSIX path of (choose folder with prompt "Select Image Folder")'
            )
            env = os.environ.copy()
            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True, text=True, timeout=120, env=env
            )
            if result.returncode == 0:
                path = result.stdout.strip().rstrip("/")
                if path:
                    print(f"[browse-folder] osascript selected: {path}")
                    return path
            else:
                err = result.stderr.strip()
                if "User canceled" not in err and "(-128)" not in err:
                    print(f"[browse-folder] osascript error: {err}")
                    # Retry without the activate line (some sandboxed envs block it)
                    result2 = subprocess.run(
                        ["osascript", "-e",
                         'POSIX path of (choose folder with prompt "Select Image Folder")'],
                        capture_output=True, text=True, timeout=120, env=env
                    )
                    if result2.returncode == 0:
                        path = result2.stdout.strip().rstrip("/")
                        if path:
                            print(f"[browse-folder] osascript (bare) selected: {path}")
                            return path
        except Exception as exc:
            print(f"[browse-folder] osascript failed: {exc}")

    # ── tkinter (fallback / non-macOS) ───────────────────────────────────────
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.lift()
        root.attributes("-topmost", True)
        folder = filedialog.askdirectory(title="Select Image Folder")
        root.destroy()
        if folder:
            print(f"[browse-folder] tkinter selected: {folder}")
        return folder or ""
    except Exception as exc:
        print(f"[browse-folder] tkinter failed: {exc}")

    return ""


@router.post("/browse-folder")
async def browse_folder():
    """Open a native OS folder picker and return the selected path.

    Runs the blocking dialog in a thread-pool executor so the async event loop
    stays responsive while the user interacts with the dialog.
    """
    loop = asyncio.get_running_loop()
    folder = await loop.run_in_executor(None, _open_native_folder_dialog)
    return {"path": folder}


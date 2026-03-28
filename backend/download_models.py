"""
Download all faster-whisper models to the local cache on first run.
Subsequent starts verify the cache and skip downloading.
"""

import os
from faster_whisper import WhisperModel

MODELS_DIR = "/models"
os.makedirs(MODELS_DIR, exist_ok=True)

MODELS = {
    "tiny": "tiny",
    "base": "base",
    "small": "small",
    "medium": "medium",
    "large": "large-v3",
}

print("=== Faster-Whisper model cache check ===", flush=True)
for label, fw_name in MODELS.items():
    print(f"  [{label}] Loading '{fw_name}'...", flush=True)
    try:
        # Instantiating triggers the HuggingFace download if not cached.
        # Use CPU + int8 to minimise memory during the download-only phase.
        model = WhisperModel(fw_name, device="cpu", compute_type="int8", download_root=MODELS_DIR)
        del model
        print(f"  [✓] {label} — ready", flush=True)
    except Exception as e:
        print(f"  [!] {label}: {e}", flush=True)

print("=== Model cache check complete ===", flush=True)

"""
Download all Whisper models to the local cache on first run.
Uses Whisper's built-in SHA256 verification: existing files that pass the
checksum are skipped; missing or corrupted files are re-downloaded.
"""

import os
import whisper

CACHE_DIR = os.path.expanduser("~/.cache/whisper")
os.makedirs(CACHE_DIR, exist_ok=True)

MODELS = ["tiny", "base", "small", "medium", "large"]

print("=== Whisper model cache check ===", flush=True)
for model_name in MODELS:
    url = whisper._MODELS.get(model_name)
    if not url:
        print(f"  [?] Unknown model name: {model_name}", flush=True)
        continue

    filename = os.path.basename(url)
    model_path = os.path.join(CACHE_DIR, filename)

    if os.path.exists(model_path):
        print(f"  [✓] {model_name} ({filename}) — verifying checksum...", flush=True)
    else:
        print(f"  [↓] {model_name} ({filename}) — downloading...", flush=True)

    try:
        # _download checks SHA256 of existing files; re-downloads if missing or corrupt
        whisper._download(url, CACHE_DIR, in_memory=False)
        size_mb = os.path.getsize(model_path) // (1024 * 1024)
        print(f"       OK ({size_mb} MB)", flush=True)
    except Exception as e:
        print(f"  [!] {model_name}: {e}", flush=True)

print("=== Model cache check complete ===", flush=True)

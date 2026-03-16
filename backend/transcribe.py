import asyncio
import ctranslate2
from faster_whisper import WhisperModel
from typing import List, Dict, Any, Callable, Optional

MODELS_DIR = "/root/.cache/whisper_models"

# Map frontend model names to faster-whisper model identifiers
MODEL_MAP = {
    "tiny": "tiny",
    "base": "base",
    "small": "small",
    "medium": "medium",
    "large": "large-v3",
}

# Model cache: avoid reloading the same model on every request
_model_cache: dict = {}


def _get_device_and_compute():
    """Pick the best device + compute type for faster-whisper / CTranslate2."""
    if ctranslate2.get_cuda_device_count() > 0:
        return "cuda", "float16"
    return "cpu", "int8"


def _load_model(model_name: str):
    if model_name not in _model_cache:
        device, compute_type = _get_device_and_compute()
        fw_name = MODEL_MAP.get(model_name, model_name)
        print(f"[whisper] Loading faster-whisper model '{fw_name}' on {device} ({compute_type})", flush=True)
        _model_cache[model_name] = WhisperModel(
            fw_name,
            device=device,
            compute_type=compute_type,
            download_root=MODELS_DIR,
        )
    return _model_cache[model_name]


async def transcribe_audio(
    audio_path: str,
    model_name: str,
    language: Optional[str],
    progress_callback: Callable,
) -> List[Dict[str, Any]]:
    """
    Load faster-whisper model, transcribe audio file with VAD filtering.
    Calls progress_callback(segments_so_far, is_done) as segments are streamed.
    Returns list of subtitle dicts: {id, start, end, text}
    """
    device, compute_type = _get_device_and_compute()
    print(f"[whisper] Device: {device}, compute: {compute_type}", flush=True)

    loop = asyncio.get_event_loop()
    model = await loop.run_in_executor(None, lambda: _load_model(model_name))
    print(f"[whisper] Model '{model_name}' ready", flush=True)

    # VAD filter: scans audio for speech regions first, strips silence so
    # Whisper never sees quiet sections and cannot hallucinate into them.
    transcribe_kwargs = {
        "vad_filter": True,
        "vad_parameters": {"min_silence_duration_ms": 500},
        "condition_on_previous_text": False,
    }

    if language and language.strip() and language.lower() != "auto":
        transcribe_kwargs["language"] = language
        print(f"[whisper] Transcribing with language='{language}'...", flush=True)
    else:
        print(f"[whisper] Transcribing with auto language detection...", flush=True)

    def run_transcribe():
        segments_iter, info = model.transcribe(audio_path, **transcribe_kwargs)
        # segments_iter is a generator — collect into a list
        seg_list = list(segments_iter)
        return seg_list, info

    seg_list, info = await loop.run_in_executor(None, run_transcribe)

    detected_lang = info.language
    print(f"[whisper] Transcription done — language='{detected_lang}', "
          f"{len(seg_list)} segments, duration={info.duration:.1f}s", flush=True)

    # Convert faster-whisper Segment objects to subtitle dicts
    subtitles = []
    for i, seg in enumerate(seg_list):
        text = seg.text.strip()
        if not text:
            continue
        subtitles.append({
            "id": i + 1,
            "start": float(seg.start),
            "end": float(seg.end),
            "text": text,
        })

    # Re-number after skipping empty segments
    for i, sub in enumerate(subtitles):
        sub["id"] = i + 1

    print(f"[whisper] {len(subtitles)} non-empty subtitle segments", flush=True)

    # Stream segments one by one with small delays for progressive UI updates
    streamed_so_far = []
    for sub in subtitles:
        streamed_so_far.append(sub)
        await progress_callback(list(streamed_so_far), False)
        await asyncio.sleep(0.05)

    # Final callback signaling done
    await progress_callback(subtitles, True)

    return subtitles

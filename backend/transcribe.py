import whisper
import asyncio
from typing import List, Dict, Any, Callable, Optional
from utils import get_device

# Model cache: avoid reloading the same model on every request
_model_cache: dict = {}


def _load_model(model_name: str, device: str):
    cache_key = (model_name, device)
    if cache_key not in _model_cache:
        _model_cache[cache_key] = whisper.load_model(model_name, device=device)
    return _model_cache[cache_key]


async def transcribe_audio(
    audio_path: str,
    model_name: str,
    language: Optional[str],
    progress_callback: Callable,
) -> List[Dict[str, Any]]:
    """
    Load whisper model on detected device, transcribe audio file.
    Calls progress_callback(segments_so_far, is_done) as segments are streamed.
    Returns list of subtitle dicts: {id, start, end, text}
    """
    device = get_device()
    print(f"[whisper] Loading model '{model_name}' on device '{device}'...", flush=True)

    # Load model in a thread to avoid blocking the event loop
    loop = asyncio.get_event_loop()
    model = await loop.run_in_executor(
        None, lambda: _load_model(model_name, device)
    )
    print(f"[whisper] Model '{model_name}' ready", flush=True)

    # Transcribe in executor (blocking call)
    use_fp16 = (device == "cuda")
    transcribe_kwargs = {
        "verbose": False,
        "fp16": use_fp16,
        "no_speech_threshold": 0.65,
        "compression_ratio_threshold": 2.4,
        "condition_on_previous_text": False,
        "temperature": (0.0, 0.2, 0.4, 0.6, 0.8, 1.0),
    }
    if language and language.strip() and language.lower() != "auto":
        transcribe_kwargs["language"] = language
        print(f"[whisper] Transcribing with language='{language}', fp16={use_fp16}...", flush=True)
    else:
        print(f"[whisper] Transcribing with auto language detection, fp16={use_fp16}...", flush=True)

    result = await loop.run_in_executor(
        None, lambda: model.transcribe(audio_path, **transcribe_kwargs)
    )

    detected_lang = result.get("language", "unknown")
    segments = result.get("segments", [])
    print(f"[whisper] Transcription done — language='{detected_lang}', {len(segments)} segments", flush=True)

    # Convert segments to subtitle dicts
    subtitles = []
    for i, seg in enumerate(segments):
        subtitles.append({
            "id": i + 1,
            "start": float(seg["start"]),
            "end": float(seg["end"]),
            "text": seg["text"].strip(),
        })

    # Stream segments one by one with small delays to simulate progressive loading
    streamed_so_far = []
    for sub in subtitles:
        streamed_so_far.append(sub)
        await progress_callback(list(streamed_so_far), False)
        await asyncio.sleep(0.05)  # 50ms delay between each segment

    # Final callback signaling done
    await progress_callback(subtitles, True)

    return subtitles

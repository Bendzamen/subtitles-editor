import whisper
import asyncio
from typing import List, Dict, Any, Callable, Optional
from utils import get_device


async def transcribe_audio(
    audio_path: str,
    model_name: str,
    language: Optional[str],
    progress_callback: Callable,
) -> List[Dict[str, Any]]:
    """
    Load whisper model on detected device, transcribe audio file with word timestamps.
    Calls progress_callback(segments_so_far, is_done) as segments are streamed.
    Returns list of subtitle dicts: {id, start, end, text}
    """
    device = get_device()

    # Load model in a thread to avoid blocking the event loop
    loop = asyncio.get_event_loop()
    model = await loop.run_in_executor(
        None, lambda: whisper.load_model(model_name, device=device)
    )

    # Transcribe in executor (blocking call)
    transcribe_kwargs = {
        "verbose": False,
        "word_timestamps": True,
    }
    if language and language.strip() and language.lower() != "auto":
        transcribe_kwargs["language"] = language

    result = await loop.run_in_executor(
        None, lambda: model.transcribe(audio_path, **transcribe_kwargs)
    )

    segments = result.get("segments", [])

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

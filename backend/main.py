import os
import re
import uuid
import json
import asyncio
import shutil
import time
from pathlib import Path
from typing import Optional
from uuid import UUID

import aiofiles
import ffmpeg
import magic
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from openai import AsyncOpenAI
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from sse_starlette.sse import EventSourceResponse

from logger import get_logger
from utils import parse_srt, format_srt
from transcribe import transcribe_audio
from translate import translate_subtitles

logger = get_logger(__name__)

# --- OpenAI / translation config ---
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "http://localhost:3000/v1")
OPENAI_API_KEY  = os.getenv("OPENAI_API_KEY",  "sk-placeholder")
OPENAI_MODEL    = os.getenv("OPENAI_MODEL",     "gpt-4o-mini")

# --- Configuration ---
UPLOAD_DIR = Path("/tmp/subtitle_uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_FILE_AGE_SECONDS = 600  # 10 minutes
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "http://localhost:5173")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(2 * 1024 * 1024 * 1024)))
ALLOWED_VIDEO_MIME = {
    "video/mp4", "video/x-matroska", "video/webm", "video/quicktime",
    "video/x-msvideo", "video/mpeg",
}
ALLOWED_AUDIO_MIME = {
    "audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg", "audio/mp4",
    "audio/mp3", "audio/ogg", "audio/flac", "audio/x-flac", "audio/aac",
    "audio/webm",
}
MAX_SRT_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_VIDEO_DURATION = int(os.getenv("MAX_VIDEO_DURATION", str(4 * 3600)))  # 4 hours
MAX_TRANSCRIPTION_SECONDS = int(os.getenv("MAX_TRANSCRIPTION_SECONDS", str(3600)))  # 1 hour

# Allowed target languages for translation (must match frontend TRANSLATE_LANGUAGES values)
VALID_TRANSLATE_LANGUAGES = {
    "English", "Spanish", "French", "German", "Italian", "Portuguese",
    "Russian", "Japanese", "Korean", "Chinese (Simplified)", "Arabic",
    "Hindi", "Dutch", "Polish", "Czech", "Slovak", "Swedish", "Turkish", "Ukrainian",
}

# Whisper language codes: 2–3 lowercase letters, optional subtag
_WHISPER_LANG_RE = re.compile(r'^[a-z]{2,4}$')

# --- FastAPI App ---
limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Subtitle Generator API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOWED_ORIGIN],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)


# --- Startup cleanup ---
def cleanup_old_files():
    """Remove files older than MAX_FILE_AGE_SECONDS from the upload directory."""
    now = time.time()
    if not UPLOAD_DIR.exists():
        return
    for item in UPLOAD_DIR.iterdir():
        try:
            # Only remove direct children of UPLOAD_DIR
            if item.parent != UPLOAD_DIR:
                continue
            item_age = now - item.stat().st_mtime
            if item_age > MAX_FILE_AGE_SECONDS:
                if item.is_dir():
                    shutil.rmtree(item)
                else:
                    item.unlink()
        except Exception as e:
            logger.warning("Cleanup error for %s: %s", item, e)


async def _check_openai_endpoint():
    """
    Verify the configured OpenAI-compatible endpoint is reachable and that
    the requested model is listed.  Runs once in the background at startup.
    Results are informational only — the server starts regardless.
    """
    logger.info("Checking OpenAI endpoint: %s", OPENAI_BASE_URL)
    logger.info("Expected model: %s", OPENAI_MODEL)
    try:
        client = AsyncOpenAI(
            base_url=OPENAI_BASE_URL,
            api_key=OPENAI_API_KEY,
            timeout=15.0,
        )
        models_page = await client.models.list()
        available = [m.id for m in models_page.data]

        if OPENAI_MODEL in available:
            logger.info("OpenAI endpoint OK — model '%s' is available", OPENAI_MODEL)
        else:
            logger.warning("OpenAI endpoint reachable but model '%s' was NOT found", OPENAI_MODEL)
            if available:
                shown = available[:10]
                logger.info("Available models: %s%s", ", ".join(shown), " …" if len(available) > 10 else "")
            else:
                logger.info("No models returned by the endpoint")
            logger.info("Set OPENAI_MODEL in docker-compose.yml to one of the listed IDs")

    except Exception as e:
        logger.error("OpenAI endpoint check FAILED: %s — URL: %s", e, OPENAI_BASE_URL)
        logger.error("Translation will not work until the endpoint is reachable")


@app.on_event("startup")
async def startup_event():
    logger.info("Subtitle Generator API starting up")
    asyncio.get_event_loop().run_in_executor(None, cleanup_old_files)
    asyncio.create_task(_check_openai_endpoint())


# --- Helper: get video directory ---
def get_video_dir(video_id: str) -> Path:
    try:
        UUID(video_id, version=4)
    except ValueError:
        raise HTTPException(400, "Invalid video ID")
    video_dir = UPLOAD_DIR / video_id
    # Ensure the resolved path stays within UPLOAD_DIR (path traversal guard)
    try:
        video_dir.resolve().relative_to(UPLOAD_DIR.resolve())
    except ValueError:
        raise HTTPException(400, "Invalid video ID")
    return video_dir


# --- Endpoints ---

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/api/upload-audio")
@limiter.limit("10/minute")
async def upload_audio(request: Request, file: UploadFile = File(...)):
    """
    Accept browser-extracted audio for Whisper transcription.
    The browser extracts audio from the video locally (ffmpeg.wasm) and
    uploads only the audio track — the video never leaves the client.
    Saves as 16kHz mono WAV for Whisper (converts if not already WAV).
    Returns {audio_id}.
    """
    # MIME type validation
    header = await file.read(2048)
    mime = magic.from_buffer(header, mime=True)
    if mime not in ALLOWED_AUDIO_MIME:
        raise HTTPException(400, f"Unsupported audio type: {mime}")
    await file.seek(0)

    audio_id = str(uuid.uuid4())
    audio_dir = get_video_dir(audio_id)
    audio_dir.mkdir(parents=True, exist_ok=True)

    original_ext = Path(file.filename).suffix.lower() if file.filename else ".wav"
    original_path = audio_dir / f"original{original_ext}"
    audio_path = audio_dir / "audio.wav"

    logger.info("Audio upload received: filename=%s audio_id=%s", file.filename, audio_id)

    # Save uploaded file with size limit enforcement
    try:
        total = 0
        t_upload_start = time.time()
        async with aiofiles.open(original_path, "wb") as out_file:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    original_path.unlink(missing_ok=True)
                    shutil.rmtree(audio_dir, ignore_errors=True)
                    raise HTTPException(413, "File too large")
                await out_file.write(chunk)
        logger.info("Audio upload done: audio_id=%s size=%.1fMB elapsed=%.1fs",
                    audio_id, total / (1024 * 1024), time.time() - t_upload_start)
    except HTTPException:
        raise
    except Exception as e:
        shutil.rmtree(audio_dir, ignore_errors=True)
        logger.error("Failed to save uploaded audio: audio_id=%s error=%s", audio_id, e)
        raise HTTPException(status_code=500, detail="Upload failed — please try again")

    loop = asyncio.get_event_loop()

    # Convert to 16kHz mono WAV for Whisper (fast for audio-only files)
    logger.info("Audio conversion start: audio_id=%s", audio_id)
    t0 = time.time()
    try:
        def convert_audio():
            (
                ffmpeg
                .input(str(original_path))
                .output(
                    str(audio_path),
                    ar=16000,
                    ac=1,
                    acodec="pcm_s16le",
                )
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )

        await loop.run_in_executor(None, convert_audio)
        logger.info("Audio conversion done: audio_id=%s elapsed=%.1fs", audio_id, time.time() - t0)
    except ffmpeg.Error as e:
        shutil.rmtree(audio_dir, ignore_errors=True)
        logger.error("Audio conversion failed: audio_id=%s elapsed=%.1fs error=%s", audio_id, time.time() - t0, e.stderr.decode() if e.stderr else str(e))
        raise HTTPException(status_code=500, detail="Audio processing failed — please try again")
    except Exception as e:
        shutil.rmtree(audio_dir, ignore_errors=True)
        logger.error("Audio conversion failed: audio_id=%s elapsed=%.1fs error=%s", audio_id, time.time() - t0, e)
        raise HTTPException(status_code=500, detail="Audio processing failed — please try again")

    # Clean up original to save space
    original_path.unlink(missing_ok=True)

    logger.info("Audio ready: audio_id=%s", audio_id)
    return {"audio_id": audio_id}


@app.post("/api/upload-srt")
@limiter.limit("10/minute")
async def upload_srt(request: Request, file: UploadFile = File(...)):
    """
    Accept an SRT file upload, parse and return the subtitles list.
    """
    try:
        content_bytes = await file.read(MAX_SRT_BYTES + 1)
        if len(content_bytes) > MAX_SRT_BYTES:
            raise HTTPException(413, "SRT file too large (max 10 MB)")
        # Try UTF-8 first, then latin-1 as fallback
        try:
            content = content_bytes.decode("utf-8")
        except UnicodeDecodeError:
            content = content_bytes.decode("latin-1")

        subtitles = parse_srt(content)
        return {"subtitles": subtitles}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to parse SRT file: %s", e)
        raise HTTPException(status_code=400, detail="Failed to parse SRT file")


@app.get("/api/audio/{video_id}")
@limiter.limit("30/minute")
async def stream_audio(request: Request, video_id: str):
    """
    Serve the extracted 16kHz mono WAV audio for the waveform visualizer.
    """
    audio_path = get_video_dir(video_id) / "audio.wav"
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio not found")
    return FileResponse(str(audio_path), media_type="audio/wav")


@app.get("/api/transcribe/{video_id}")
@limiter.limit("5/minute")
async def transcribe_video(
    request: Request,
    video_id: str,
    model: str = "base",
    language: Optional[str] = None,
):
    """
    SSE endpoint to stream transcription progress.
    Events:
      {"type": "progress", "segments": [...], "count": N}
      {"type": "done", "subtitles": [...]}
      {"type": "error", "message": "..."}
    """
    video_dir = get_video_dir(video_id)
    audio_path = video_dir / "audio.wav"

    if not audio_path.exists():
        async def error_gen():
            yield {"data": json.dumps({"type": "error", "message": "Audio file not found. Please upload a video first."})}
        return EventSourceResponse(error_gen())

    valid_models = {"tiny", "base", "small", "medium", "large"}
    if model not in valid_models:
        async def bad_model_gen():
            yield {"data": json.dumps({"type": "error", "message": f"Invalid model. Must be one of: {', '.join(sorted(valid_models))}"})}
        return EventSourceResponse(bad_model_gen())

    # Validate and sanitize the language code
    whisper_language: Optional[str] = None
    if language and language not in ("", "auto"):
        if not _WHISPER_LANG_RE.match(language):
            async def bad_lang_gen():
                yield {"data": json.dumps({"type": "error", "message": "Invalid language code"})}
            return EventSourceResponse(bad_lang_gen())
        whisper_language = language

    lang_info = f", language={whisper_language}" if whisper_language else ", auto-detect"
    logger.info("Transcription start: video_id=%s model=%s%s", video_id, model, lang_info)

    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue()
        done_event = asyncio.Event()

        async def progress_callback(segments_so_far, is_done):
            await queue.put((segments_so_far, is_done))

        async def run_transcription():
            try:
                await transcribe_audio(
                    str(audio_path),
                    model,
                    whisper_language,
                    progress_callback,
                )
            except Exception as e:
                await queue.put(e)
            finally:
                done_event.set()

        task = asyncio.create_task(run_transcription())
        deadline = time.time() + MAX_TRANSCRIPTION_SECONDS

        try:
            while True:
                if time.time() > deadline:
                    task.cancel()
                    logger.error("Transcription timeout: video_id=%s", video_id)
                    yield {"data": json.dumps({"type": "error", "message": "Transcription timed out — please try a smaller model or shorter video"})}
                    break
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=30.0)
                except asyncio.TimeoutError:
                    if done_event.is_set():
                        break
                    yield {"data": json.dumps({"type": "ping"})}
                    continue

                if isinstance(item, Exception):
                    logger.error("Transcription error: video_id=%s error=%s", video_id, item)
                    yield {"data": json.dumps({"type": "error", "message": "Transcription failed — please try again"})}
                    break

                segments_so_far, is_done = item

                if is_done:
                    logger.info("Transcription complete: video_id=%s segments=%d", video_id, len(segments_so_far))
                    yield {"data": json.dumps({"type": "done", "subtitles": segments_so_far})}
                    break
                else:
                    yield {
                        "data": json.dumps({
                            "type": "progress",
                            "segments": segments_so_far,
                            "count": len(segments_so_far),
                        })
                    }
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    return EventSourceResponse(event_generator())


class TranslateRequest(BaseModel):
    subtitles: list
    target_language: str
    source_language: Optional[str] = None


@app.post("/api/translate")
@limiter.limit("5/minute")
async def translate_video_subtitles(http_request: Request, request: TranslateRequest):
    """
    SSE endpoint to stream translation progress.
    Events:
      {"type": "progress", "done": N, "total": N}
      {"type": "warning", "message": "..."}   (optional, before done)
      {"type": "done", "subtitles": [...]}
      {"type": "error", "message": "..."}
    """
    subtitles = request.subtitles
    target_language = request.target_language
    source_language = request.source_language

    # Validate target language against allowlist to prevent prompt injection
    if target_language not in VALID_TRANSLATE_LANGUAGES:
        raise HTTPException(400, "Invalid target language")

    # Validate source language: must be empty/auto, or a valid whisper code
    if source_language and source_language not in ("", "auto", "auto-detect"):
        if not _WHISPER_LANG_RE.match(source_language):
            raise HTTPException(400, "Invalid source language code")

    logger.info("Translation start: count=%d target=%s source=%s",
                len(subtitles), target_language, source_language or "auto")

    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue()
        done_event = asyncio.Event()

        async def progress_callback(done_count, total):
            await queue.put({"done": done_count, "total": total, "is_done": False})

        async def run_translation():
            try:
                translated, failed_batches = await translate_subtitles(
                    subtitles, target_language, progress_callback, source_language
                )
                await queue.put({"result": translated, "failed_batches": failed_batches, "is_done": True})
            except Exception as e:
                await queue.put({"error": str(e), "is_done": True})
            finally:
                done_event.set()

        task = asyncio.create_task(run_translation())

        try:
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=60.0)
                except asyncio.TimeoutError:
                    if done_event.is_set():
                        break
                    yield {"data": json.dumps({"type": "ping"})}
                    continue

                if item.get("is_done"):
                    if "error" in item:
                        logger.error("Translation error: %s", item["error"])
                        yield {"data": json.dumps({"type": "error", "message": "Translation failed — please try again"})}
                    else:
                        failed = item.get("failed_batches", [])
                        if failed:
                            logger.warning("Translation partial failure: batches=%s", failed)
                            yield {"data": json.dumps({
                                "type": "warning",
                                "message": f"Batches {failed} failed and were skipped",
                            })}
                        yield {"data": json.dumps({"type": "done", "subtitles": item["result"]})}
                    break
                else:
                    yield {
                        "data": json.dumps({
                            "type": "progress",
                            "done": item["done"],
                            "total": item["total"],
                        })
                    }
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    return EventSourceResponse(event_generator())


@app.delete("/api/delete/{video_id}")
@limiter.limit("10/minute")
async def delete_video(request: Request, video_id: str):
    """
    Delete all files associated with a video_id.
    Called automatically by the frontend after the user exports their SRT.
    """
    video_dir = get_video_dir(video_id)
    if video_dir.exists():
        shutil.rmtree(video_dir, ignore_errors=True)
        logger.info("Deleted: video_id=%s", video_id)
    return {"status": "deleted"}

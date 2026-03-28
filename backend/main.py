import os
import uuid
import json
import asyncio
import shutil
import time
import logging
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

from utils import parse_srt, format_srt
from transcribe import transcribe_audio
from translate import translate_subtitles

logger = logging.getLogger(__name__)

# --- OpenAI / translation config ---
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "http://localhost:3000/v1")
OPENAI_API_KEY  = os.getenv("OPENAI_API_KEY",  "sk-placeholder")
OPENAI_MODEL    = os.getenv("OPENAI_MODEL",     "gpt-4o-mini")

# --- Configuration ---
UPLOAD_DIR = Path("/tmp/subtitle_uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_FILE_AGE_SECONDS = 3600  # 1 hour
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "http://localhost:5173")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(2 * 1024 * 1024 * 1024)))
ALLOWED_MIME = {
    "video/mp4", "video/x-matroska", "video/webm", "video/quicktime",
    "video/x-msvideo", "video/mpeg",
}

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
            item_age = now - item.stat().st_mtime
            if item_age > MAX_FILE_AGE_SECONDS:
                if item.is_dir():
                    shutil.rmtree(item, ignore_errors=True)
                else:
                    item.unlink(missing_ok=True)
        except Exception as e:
            print(f"Cleanup error for {item}: {e}")


async def _check_openai_endpoint():
    """
    Verify the configured OpenAI-compatible endpoint is reachable and that
    the requested model is listed.  Runs once in the background at startup.
    Results are informational only — the server starts regardless.
    """
    print(f"[startup] Checking OpenAI endpoint: {OPENAI_BASE_URL}", flush=True)
    print(f"[startup] Expected model: {OPENAI_MODEL}", flush=True)
    try:
        client = AsyncOpenAI(
            base_url=OPENAI_BASE_URL,
            api_key=OPENAI_API_KEY,
            timeout=15.0,          # don't hang forever at startup
        )
        models_page = await client.models.list()
        available = [m.id for m in models_page.data]

        if OPENAI_MODEL in available:
            print(f"[startup] ✓ OpenAI endpoint OK — model '{OPENAI_MODEL}' is available", flush=True)
        else:
            print(f"[startup] ⚠ OpenAI endpoint reachable but model '{OPENAI_MODEL}' was NOT found!", flush=True)
            if available:
                shown = available[:10]
                print(f"[startup]   Available models: {', '.join(shown)}"
                      + (" …" if len(available) > 10 else ""), flush=True)
            else:
                print(f"[startup]   No models returned by the endpoint.", flush=True)
            print(f"[startup]   Set OPENAI_MODEL in docker-compose.yml to one of the listed IDs.", flush=True)

    except Exception as e:
        print(f"[startup] ✗ OpenAI endpoint check FAILED: {e}", flush=True)
        print(f"[startup]   URL: {OPENAI_BASE_URL}", flush=True)
        print(f"[startup]   Translation will not work until the endpoint is reachable.", flush=True)


@app.on_event("startup")
async def startup_event():
    print("[startup] Subtitle Generator API starting up", flush=True)
    asyncio.get_event_loop().run_in_executor(None, cleanup_old_files)
    asyncio.create_task(_check_openai_endpoint())


# --- Helper: get video directory ---
def get_video_dir(video_id: str) -> Path:
    try:
        UUID(video_id, version=4)
    except ValueError:
        raise HTTPException(400, "Invalid video ID")
    return UPLOAD_DIR / video_id


# --- Endpoints ---

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/api/upload")
@limiter.limit("10/minute")
async def upload_video(request: Request, file: UploadFile = File(...)):
    """
    Accept a video file upload.
    - Transcode to 480p H264 mp4 (max 1500k bitrate, aac 128k audio)
    - Extract 16kHz mono wav for whisper
    - Return {video_id, duration}
    """
    # MIME type validation
    header = await file.read(2048)
    mime = magic.from_buffer(header, mime=True)
    if mime not in ALLOWED_MIME:
        raise HTTPException(400, "Unsupported file type")
    await file.seek(0)

    video_id = str(uuid.uuid4())
    video_dir = get_video_dir(video_id)
    video_dir.mkdir(parents=True, exist_ok=True)

    original_ext = Path(file.filename).suffix.lower() if file.filename else ".mp4"
    original_path = video_dir / f"original{original_ext}"
    transcoded_path = video_dir / "video.mp4"
    audio_path = video_dir / "audio.wav"

    print(f"[upload] Received file: {file.filename} (video_id={video_id})", flush=True)

    # Save uploaded file with size limit enforcement
    try:
        total = 0
        async with aiofiles.open(original_path, "wb") as out_file:
            while True:
                chunk = await file.read(1024 * 1024)  # 1MB chunks
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    original_path.unlink(missing_ok=True)
                    shutil.rmtree(video_dir, ignore_errors=True)
                    raise HTTPException(413, "File too large")
                await out_file.write(chunk)
        print(f"[upload] File saved (video_id={video_id})", flush=True)
    except HTTPException:
        raise
    except Exception as e:
        shutil.rmtree(video_dir, ignore_errors=True)
        logger.error("Failed to save uploaded file: %s", e)
        raise HTTPException(status_code=500, detail="Upload failed — please try again")

    # Transcode video to 480p H264 mp4
    print(f"[upload] Transcoding to 480p H264...", flush=True)
    try:
        loop = asyncio.get_event_loop()

        def transcode_video():
            (
                ffmpeg
                .input(str(original_path))
                .output(
                    str(transcoded_path),
                    vf="scale=-2:480",
                    vcodec="libx264",
                    video_bitrate="1500k",
                    acodec="aac",
                    audio_bitrate="128k",
                    movflags="+faststart",
                    preset="fast",
                )
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )

        await loop.run_in_executor(None, transcode_video)
        print(f"[upload] Transcoding complete", flush=True)
    except ffmpeg.Error as e:
        shutil.rmtree(video_dir, ignore_errors=True)
        logger.error("Video transcoding failed (video_id=%s): %s", video_id, e.stderr.decode() if e.stderr else str(e))
        raise HTTPException(status_code=500, detail="Video processing failed — please re-upload")
    except Exception as e:
        shutil.rmtree(video_dir, ignore_errors=True)
        logger.error("Video transcoding failed (video_id=%s): %s", video_id, e)
        raise HTTPException(status_code=500, detail="Video processing failed — please re-upload")

    # Extract audio as 16kHz mono wav for whisper
    print(f"[upload] Extracting 16kHz mono WAV for Whisper...", flush=True)
    try:
        def extract_audio():
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

        await loop.run_in_executor(None, extract_audio)
        print(f"[upload] Audio extraction complete", flush=True)
    except ffmpeg.Error as e:
        shutil.rmtree(video_dir, ignore_errors=True)
        logger.error("Audio extraction failed (video_id=%s): %s", video_id, e.stderr.decode() if e.stderr else str(e))
        raise HTTPException(status_code=500, detail="Video processing failed — please re-upload")
    except Exception as e:
        shutil.rmtree(video_dir, ignore_errors=True)
        logger.error("Audio extraction failed (video_id=%s): %s", video_id, e)
        raise HTTPException(status_code=500, detail="Video processing failed — please re-upload")

    # Get video duration using ffprobe
    try:
        def get_duration():
            probe = ffmpeg.probe(str(transcoded_path))
            duration = float(probe["format"].get("duration", 0))
            return duration

        duration = await loop.run_in_executor(None, get_duration)
    except Exception:
        duration = 0.0

    # Clean up original to save space
    original_path.unlink(missing_ok=True)

    print(f"[upload] Done — video_id={video_id}, duration={duration:.1f}s", flush=True)
    return {"video_id": video_id, "duration": duration}


@app.post("/api/upload-srt")
@limiter.limit("10/minute")
async def upload_srt(request: Request, file: UploadFile = File(...)):
    """
    Accept an SRT file upload, parse and return the subtitles list.
    """
    try:
        content_bytes = await file.read()
        # Try UTF-8 first, then latin-1 as fallback
        try:
            content = content_bytes.decode("utf-8")
        except UnicodeDecodeError:
            content = content_bytes.decode("latin-1")

        subtitles = parse_srt(content)
        return {"subtitles": subtitles}
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


@app.get("/api/video/{video_id}")
@limiter.limit("30/minute")
async def stream_video(request: Request, video_id: str):
    """
    Stream the transcoded video file for the given video_id.
    """
    video_dir = get_video_dir(video_id)
    video_path = video_dir / "video.mp4"

    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    return FileResponse(
        str(video_path),
        media_type="video/mp4",
        headers={"Accept-Ranges": "bytes"},
    )


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
        model = "base"

    lang_info = f", language={language}" if language and language != "auto" else ", auto-detect"
    print(f"[transcribe] Starting — video_id={video_id}, model={model}{lang_info}", flush=True)

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
                    language if language and language != "auto" else None,
                    progress_callback,
                )
            except Exception as e:
                await queue.put(e)
            finally:
                done_event.set()

        task = asyncio.create_task(run_transcription())

        try:
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=30.0)
                except asyncio.TimeoutError:
                    if done_event.is_set():
                        break
                    yield {"data": json.dumps({"type": "ping"})}
                    continue

                if isinstance(item, Exception):
                    logger.error("[transcribe] ERROR (video_id=%s): %s", video_id, item)
                    yield {"data": json.dumps({"type": "error", "message": "Transcription failed — please try again"})}
                    break

                segments_so_far, is_done = item

                if is_done:
                    print(f"[transcribe] Complete — {len(segments_so_far)} segments", flush=True)
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
      {"type": "done", "subtitles": [...]}
      {"type": "error", "message": "..."}
    """
    subtitles = request.subtitles
    target_language = request.target_language
    source_language = request.source_language

    print(f"[translate] Request — {len(subtitles)} subtitles, target={target_language}, source={source_language or 'auto'}", flush=True)

    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue()
        done_event = asyncio.Event()

        async def progress_callback(done_count, total):
            await queue.put({"done": done_count, "total": total, "is_done": False})

        async def run_translation():
            try:
                result = await translate_subtitles(subtitles, target_language, progress_callback, source_language)
                await queue.put({"result": result, "is_done": True})
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
                        logger.error("[translate] ERROR: %s", item["error"])
                        yield {"data": json.dumps({"type": "error", "message": "Translation failed — please try again"})}
                    else:
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

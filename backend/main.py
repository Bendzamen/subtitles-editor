import os
import uuid
import json
import asyncio
import shutil
import time
from pathlib import Path
from typing import Optional

import aiofiles
import ffmpeg
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from utils import parse_srt, format_srt
from transcribe import transcribe_audio
from translate import translate_subtitles

# --- Configuration ---
UPLOAD_DIR = Path("/tmp/subtitle_uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_FILE_AGE_SECONDS = 3600  # 1 hour

# --- FastAPI App ---
app = FastAPI(title="Subtitle Generator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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


@app.on_event("startup")
async def startup_event():
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, cleanup_old_files)


# --- Helper: get video directory ---
def get_video_dir(video_id: str) -> Path:
    return UPLOAD_DIR / video_id


# --- Endpoints ---

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/api/upload")
async def upload_video(file: UploadFile = File(...)):
    """
    Accept a video file upload.
    - Transcode to 480p H264 mp4 (max 1500k bitrate, aac 128k audio)
    - Extract 16kHz mono wav for whisper
    - Return {video_id, duration}
    """
    video_id = str(uuid.uuid4())
    video_dir = get_video_dir(video_id)
    video_dir.mkdir(parents=True, exist_ok=True)

    original_ext = Path(file.filename).suffix.lower() if file.filename else ".mp4"
    original_path = video_dir / f"original{original_ext}"
    transcoded_path = video_dir / "video.mp4"
    audio_path = video_dir / "audio.wav"

    # Save uploaded file
    try:
        async with aiofiles.open(original_path, "wb") as out_file:
            while True:
                chunk = await file.read(1024 * 1024)  # 1MB chunks
                if not chunk:
                    break
                await out_file.write(chunk)
    except Exception as e:
        shutil.rmtree(video_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Failed to save uploaded file: {e}")

    # Transcode video to 480p H264 mp4
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
    except ffmpeg.Error as e:
        shutil.rmtree(video_dir, ignore_errors=True)
        raise HTTPException(
            status_code=500,
            detail=f"Video transcoding failed: {e.stderr.decode() if e.stderr else str(e)}"
        )
    except Exception as e:
        shutil.rmtree(video_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Video transcoding failed: {e}")

    # Extract audio as 16kHz mono wav for whisper
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
    except ffmpeg.Error as e:
        shutil.rmtree(video_dir, ignore_errors=True)
        raise HTTPException(
            status_code=500,
            detail=f"Audio extraction failed: {e.stderr.decode() if e.stderr else str(e)}"
        )
    except Exception as e:
        shutil.rmtree(video_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Audio extraction failed: {e}")

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

    return {"video_id": video_id, "duration": duration}


@app.post("/api/upload-srt")
async def upload_srt(file: UploadFile = File(...)):
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
        raise HTTPException(status_code=400, detail=f"Failed to parse SRT file: {e}")


@app.get("/api/video/{video_id}")
async def stream_video(video_id: str):
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
async def transcribe_video(
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
                    yield {"data": json.dumps({"type": "error", "message": str(item)})}
                    break

                segments_so_far, is_done = item

                if is_done:
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


@app.post("/api/translate")
async def translate_video_subtitles(request: TranslateRequest):
    """
    SSE endpoint to stream translation progress.
    Events:
      {"type": "progress", "done": N, "total": N}
      {"type": "done", "subtitles": [...]}
      {"type": "error", "message": "..."}
    """
    subtitles = request.subtitles
    target_language = request.target_language

    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue()
        done_event = asyncio.Event()

        async def progress_callback(done_count, total):
            await queue.put({"done": done_count, "total": total, "is_done": False})

        async def run_translation():
            try:
                result = await translate_subtitles(subtitles, target_language, progress_callback)
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
                        yield {"data": json.dumps({"type": "error", "message": item["error"]})}
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

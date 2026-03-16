import re
import torch
from typing import List, Dict, Any


def get_device() -> str:
    """Detect the best available compute device: cuda > mps > cpu"""
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _seconds_to_srt_time(seconds: float) -> str:
    """Convert seconds (float) to SRT time format HH:MM:SS,mmm"""
    total_ms = int(round(seconds * 1000))
    ms = total_ms % 1000
    total_s = total_ms // 1000
    s = total_s % 60
    total_m = total_s // 60
    m = total_m % 60
    h = total_m // 60
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _srt_time_to_seconds(time_str: str) -> float:
    """Convert SRT time format HH:MM:SS,mmm to seconds (float)"""
    time_str = time_str.strip()
    # Handle both comma and period as millisecond separator
    time_str = time_str.replace(",", ".")
    parts = time_str.split(":")
    h = int(parts[0])
    m = int(parts[1])
    s_parts = parts[2].split(".")
    s = int(s_parts[0])
    ms = int(s_parts[1]) if len(s_parts) > 1 else 0
    # Normalize ms to 3 digits
    ms_str = s_parts[1] if len(s_parts) > 1 else "0"
    ms_str = ms_str[:3].ljust(3, "0")
    ms = int(ms_str)
    return h * 3600 + m * 60 + s + ms / 1000.0


def parse_srt(content: str) -> List[Dict[str, Any]]:
    """
    Parse SRT text into a list of subtitle dicts.
    Each dict: {id: int, start: float, end: float, text: str}
    Times are in seconds (float).
    """
    subtitles = []
    content = content.strip()

    # Split by blank lines (one or more)
    blocks = re.split(r"\n\s*\n", content)

    for block in blocks:
        block = block.strip()
        if not block:
            continue

        lines = block.split("\n")
        if len(lines) < 3:
            continue

        # First line: subtitle index
        try:
            sub_id = int(lines[0].strip())
        except ValueError:
            continue

        # Second line: timecode
        timecode_line = lines[1].strip()
        timecode_match = re.match(
            r"(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[,\.]\d{3})",
            timecode_line,
        )
        if not timecode_match:
            continue

        start = _srt_time_to_seconds(timecode_match.group(1))
        end = _srt_time_to_seconds(timecode_match.group(2))

        # Remaining lines: text
        text = "\n".join(lines[2:]).strip()

        subtitles.append({
            "id": sub_id,
            "start": start,
            "end": end,
            "text": text,
        })

    return subtitles


def format_srt(subtitles: List[Dict[str, Any]]) -> str:
    """
    Convert a list of subtitle dicts to SRT string.
    Each dict must have: id, start (seconds), end (seconds), text.
    """
    blocks = []
    for i, sub in enumerate(subtitles):
        sub_id = sub.get("id", i + 1)
        start = _seconds_to_srt_time(sub["start"])
        end = _seconds_to_srt_time(sub["end"])
        text = sub.get("text", "").strip()
        blocks.append(f"{sub_id}\n{start} --> {end}\n{text}")

    return "\n\n".join(blocks) + "\n"

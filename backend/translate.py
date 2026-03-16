import os
import json
import asyncio
from typing import List, Dict, Any, Callable, Optional
from openai import AsyncOpenAI


async def translate_subtitles(
    subtitles: List[Dict[str, Any]],
    target_language: str,
    progress_callback: Callable,
    source_language: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Use OpenAI-compatible API to translate subtitle texts in batches of 20.
    Calls progress_callback(done_count, total) after each batch.
    Returns translated subtitles list (same structure, only text changed).
    """
    client = AsyncOpenAI(
        base_url=os.getenv("OPENAI_BASE_URL", "http://localhost:3000/v1"),
        api_key=os.getenv("OPENAI_API_KEY", "sk-placeholder"),
        timeout=120.0,   # 2-minute hard cap per batch request
    )
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    batch_size = 20
    total = len(subtitles)
    translated = list(subtitles)  # copy

    # Build source language context for the prompt
    if source_language and source_language.strip() and source_language.lower() not in ("auto", "auto-detect", ""):
        source_info = f" from {source_language}"
    else:
        source_info = ""

    print(f"[translate] Starting translation of {total} subtitles{source_info} → {target_language}", flush=True)

    for batch_start in range(0, total, batch_size):
        batch_end = min(batch_start + batch_size, total)
        batch = subtitles[batch_start:batch_end]
        batch_num = batch_start // batch_size + 1
        total_batches = (total + batch_size - 1) // batch_size

        print(f"[translate] Batch {batch_num}/{total_batches} (subtitles {batch_start + 1}–{batch_end})", flush=True)

        # Build the batch text for translation
        lines = []
        for sub in batch:
            lines.append(f"{sub['id']}|{sub['text']}")
        batch_text = "\n".join(lines)

        system_prompt = (
            f"You are a professional subtitle translator. "
            f"Translate the following subtitle lines{source_info} to {target_language}. "
            f"Each line is in the format: ID|TEXT. "
            f"Return ONLY the translated lines in the exact same format: ID|TRANSLATED_TEXT. "
            f"Do not add any explanation, commentary, or extra lines. "
            f"Preserve the ID numbers exactly as given. "
            f"Preserve line breaks within subtitle text using \\n. "
            f"Maintain the natural flow and style appropriate for subtitles."
        )

        user_prompt = (
            f"Translate these subtitles{source_info} to {target_language}:\n\n{batch_text}"
        )

        try:
            response = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.1,
            )

            response_text = response.choices[0].message.content.strip()
            translated_lines = response_text.split("\n")

            # Parse translated lines back into subtitle texts
            id_to_text = {}
            for line in translated_lines:
                line = line.strip()
                if not line:
                    continue
                if "|" in line:
                    parts = line.split("|", 1)
                    try:
                        sub_id = int(parts[0].strip())
                        sub_text = parts[1].strip().replace("\\n", "\n")
                        id_to_text[sub_id] = sub_text
                    except (ValueError, IndexError):
                        continue

            # Apply translations to the batch
            applied = 0
            for i in range(batch_start, batch_end):
                sub_id = subtitles[i]["id"]
                if sub_id in id_to_text:
                    translated[i] = dict(subtitles[i])
                    translated[i]["text"] = id_to_text[sub_id]
                    applied += 1

            print(f"[translate] Batch {batch_num}/{total_batches} done — {applied}/{len(batch)} translated", flush=True)

        except Exception as e:
            print(f"[translate] Batch {batch_num}/{total_batches} ERROR: {e}", flush=True)

        done_count = batch_end
        await progress_callback(done_count, total)
        await asyncio.sleep(0.05)

    print(f"[translate] Translation complete — {total} subtitles processed", flush=True)
    return translated

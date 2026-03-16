import os
import json
import asyncio
from typing import List, Dict, Any, Callable
from openai import AsyncOpenAI


async def translate_subtitles(
    subtitles: List[Dict[str, Any]],
    target_language: str,
    progress_callback: Callable,
) -> List[Dict[str, Any]]:
    """
    Use OpenAI-compatible API to translate subtitle texts in batches of 20.
    Calls progress_callback(done_count, total) after each batch.
    Returns translated subtitles list (same structure, only text changed).
    """
    client = AsyncOpenAI(
        base_url=os.getenv("OPENAI_BASE_URL", "http://localhost:3000/v1"),
        api_key=os.getenv("OPENAI_API_KEY", "sk-placeholder"),
    )
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    batch_size = 20
    total = len(subtitles)
    translated = list(subtitles)  # copy

    for batch_start in range(0, total, batch_size):
        batch_end = min(batch_start + batch_size, total)
        batch = subtitles[batch_start:batch_end]

        # Build the batch text for translation
        lines = []
        for sub in batch:
            lines.append(f"{sub['id']}|{sub['text']}")
        batch_text = "\n".join(lines)

        system_prompt = (
            f"You are a professional subtitle translator. "
            f"Translate the following subtitle lines to {target_language}. "
            f"Each line is in the format: ID|TEXT. "
            f"Return ONLY the translated lines in the exact same format: ID|TRANSLATED_TEXT. "
            f"Do not add any explanation, commentary, or extra lines. "
            f"Preserve the ID numbers exactly as given. "
            f"Preserve line breaks within subtitle text using \\n."
        )

        user_prompt = (
            f"Translate these subtitles to {target_language}:\n\n{batch_text}"
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
            for i in range(batch_start, batch_end):
                sub_id = subtitles[i]["id"]
                if sub_id in id_to_text:
                    translated[i] = dict(subtitles[i])
                    translated[i]["text"] = id_to_text[sub_id]

        except Exception as e:
            # On error, keep original text for this batch and continue
            print(f"Translation error for batch {batch_start}-{batch_end}: {e}")

        done_count = batch_end
        await progress_callback(done_count, total)
        await asyncio.sleep(0.05)

    return translated

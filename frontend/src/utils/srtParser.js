/**
 * Parse an SRT string into an array of subtitle objects.
 * Each object: { id: number, start: number, end: number, text: string }
 * Times are in seconds (float).
 */
export function parseSRT(content) {
  const subtitles = []
  const blocks = content.trim().split(/\r?\n\s*\r?\n/)

  for (const block of blocks) {
    const lines = block.trim().split(/\r?\n/)
    if (lines.length < 3) continue

    // First line: index
    const id = parseInt(lines[0].trim(), 10)
    if (isNaN(id)) continue

    // Second line: timecodes
    const timecodeMatch = lines[1].trim().match(
      /(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[,\.]\d{3})/
    )
    if (!timecodeMatch) continue

    const start = srtTimeToSeconds(timecodeMatch[1])
    const end = srtTimeToSeconds(timecodeMatch[2])

    // Remaining lines: text
    const text = lines.slice(2).join('\n').trim()

    subtitles.push({ id, start, end, text })
  }

  return subtitles
}

/**
 * Convert SRT time string (HH:MM:SS,mmm or HH:MM:SS.mmm) to seconds.
 */
export function srtTimeToSeconds(timeStr) {
  const normalized = timeStr.trim().replace(',', '.')
  const [hms, msStr = '000'] = normalized.split('.')
  const parts = hms.split(':')
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  const s = parseInt(parts[2], 10)
  const ms = parseInt(msStr.padEnd(3, '0').slice(0, 3), 10)
  return h * 3600 + m * 60 + s + ms / 1000
}

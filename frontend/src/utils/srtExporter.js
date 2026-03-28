/**
 * Convert seconds (float) to SRT time format: HH:MM:SS,mmm
 */
export function secondsToSrtTime(seconds) {
  const totalMs = Math.round(seconds * 1000)
  const ms = totalMs % 1000
  const totalSec = Math.floor(totalMs / 1000)
  const s = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const m = totalMin % 60
  const h = Math.floor(totalMin / 60)

  return (
    String(h).padStart(2, '0') + ':' +
    String(m).padStart(2, '0') + ':' +
    String(s).padStart(2, '0') + ',' +
    String(ms).padStart(3, '0')
  )
}

/**
 * Convert an array of subtitle objects to an SRT string.
 * Each object must have: { id, start, end, text }
 * Throws if any subtitle has start >= end.
 */
export function exportSRT(subtitles) {
  const invalid = subtitles.filter(s => s.start >= s.end)
  if (invalid.length > 0) {
    throw new Error(`${invalid.length} subtitle(s) have start \u2265 end time`)
  }

  return subtitles
    .map((sub, index) => {
      const id = sub.id ?? index + 1
      const start = secondsToSrtTime(sub.start)
      const end = secondsToSrtTime(sub.end)
      const text = (sub.text ?? '').trim()
      return `${id}\n${start} --> ${end}\n${text}`
    })
    .join('\n\n') + '\n'
}

/**
 * Create a blob from the SRT content and trigger a browser download.
 * Optionally deletes the server-side files for videoId after download.
 */
export async function downloadSRT(subtitles, filename = 'subtitles.srt', videoId = null) {
  const content = exportSRT(subtitles)
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  if (videoId) {
    try {
      await fetch(`/api/delete/${videoId}`, { method: 'DELETE' })
    } catch {
      // ignore — cleanup is best-effort; server TTL will handle it
    }
  }
}

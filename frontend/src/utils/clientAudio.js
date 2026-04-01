import { FFmpeg } from '@ffmpeg/ffmpeg'

let ffmpeg = null
let blobUrls = null

/**
 * Fetch a file and return a blob URL.
 * For the WASM file, reports download progress via onProgress.
 */
async function fetchToBlobURL(url, mimeType, onProgress) {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`)

  if (!onProgress) {
    const buf = await resp.arrayBuffer()
    return URL.createObjectURL(new Blob([buf], { type: mimeType }))
  }

  // Stream with progress
  const total = parseInt(resp.headers.get('Content-Length'), 10) || 0
  const reader = resp.body.getReader()
  const chunks = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onProgress(received, total)
  }

  return URL.createObjectURL(new Blob(chunks, { type: mimeType }))
}

/**
 * @param {(received: number, total: number) => void} onWasmProgress
 * @param {(phase: string) => void} onStatus
 */
async function loadFFmpeg(onWasmProgress, onStatus) {
  if (ffmpeg) return ffmpeg

  if (!blobUrls) {
    // Fetch all three files as blob URLs (official pattern from @ffmpeg/util).
    // Only track progress on the WASM file (31 MB); the others are tiny.
    const [coreURL, wasmURL, workerURL] = await Promise.all([
      fetchToBlobURL('/ffmpeg/ffmpeg-core.js', 'text/javascript'),
      fetchToBlobURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm', onWasmProgress),
      fetchToBlobURL('/ffmpeg/ffmpeg-core.worker.js', 'text/javascript'),
    ])
    blobUrls = { coreURL, wasmURL, workerURL }
  }

  if (onStatus) onStatus('compiling')

  ffmpeg = new FFmpeg()
  await ffmpeg.load(blobUrls)
  return ffmpeg
}

/**
 * Extract audio from a video file as 16kHz mono WAV using ffmpeg.wasm.
 * Uses WORKERFS so the video is read directly from the File handle (not copied to RAM).
 *
 * @param {File} file - Video file
 * @param {(pct: number) => void} onProgress - Extraction progress 0–100
 * @param {(received: number, total: number) => void} onWasmProgress - WASM download progress (bytes)
 * @param {(phase: string) => void} onStatus - phase changes: 'compiling', 'extracting'
 * @returns {Promise<{file: File, blobUrl: string}>}
 */
export async function extractAudio(file, onProgress, onWasmProgress, onStatus) {
  const ff = await loadFFmpeg(onWasmProgress, onStatus)

  if (onStatus) onStatus('extracting')

  const progressHandler = ({ progress }) => {
    onProgress(Math.min(99, Math.round(progress * 100)))
  }
  ff.on('progress', progressHandler)

  try {
    // Write file to MEMFS (WORKERFS is unreliable in @ffmpeg/ffmpeg v0.12 worker arch)
    const inputData = new Uint8Array(await file.arrayBuffer())
    await ff.writeFile('/input.video', inputData)

    await ff.exec([
      '-i', '/input.video',
      '-vn',
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      '/output.wav',
    ])

    const data = await ff.readFile('/output.wav')
    onProgress(100)
    const audioFile = new File([data.buffer], 'audio.wav', { type: 'audio/wav' })
    const blobUrl = URL.createObjectURL(audioFile)
    return { file: audioFile, blobUrl }
  } finally {
    ff.off('progress', progressHandler)
    ff.deleteFile('/input.video').catch(() => {})
    ff.deleteFile('/output.wav').catch(() => {})
  }
}

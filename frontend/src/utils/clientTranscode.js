import { FFmpeg } from '@ffmpeg/ffmpeg'

let ffmpeg = null

async function loadFFmpeg(onLog) {
  if (ffmpeg) return ffmpeg
  ffmpeg = new FFmpeg()
  if (onLog) ffmpeg.on('log', onLog)
  await ffmpeg.load({
    coreURL: '/ffmpeg/ffmpeg-core.js',
    wasmURL: '/ffmpeg/ffmpeg-core.wasm',
    workerURL: '/ffmpeg/ffmpeg-core.worker.js',
  })
  return ffmpeg
}

/**
 * Transcode a video file to 480p H264 in the browser using ffmpeg.wasm.
 * Uses WORKERFS mount to avoid loading the entire file into memory.
 *
 * @param {File} file - Original video file
 * @param {(pct: number) => void} onProgress - Called with 0–100
 * @returns {Promise<File>} - Transcoded mp4 file
 */
export async function transcodeForUpload(file, onProgress) {
  const ff = await loadFFmpeg()

  const progressHandler = ({ progress }) => onProgress(Math.min(99, Math.round(progress * 100)))
  ff.on('progress', progressHandler)

  try {
    // Mount the input file via WORKERFS — ffmpeg reads directly from the
    // browser File handle instead of copying the whole thing into RAM.
    await ff.mount('WORKERFS', { files: [file] }, '/input')

    await ff.exec([
      '-i', `/input/${file.name}`,
      '-vf', 'scale=-2:480',
      '-c:v', 'libx264',
      '-b:v', '800k',
      '-c:a', 'aac',
      '-b:a', '64k',
      '-preset', 'ultrafast',
      '-movflags', '+faststart',
      '/output.mp4',
    ])

    const data = await ff.readFile('/output.mp4')
    onProgress(100)
    return new File([data.buffer], 'video.mp4', { type: 'video/mp4' })
  } finally {
    ff.off('progress', progressHandler)
    ff.unmount('/input').catch(() => {})
    ff.deleteFile('/output.mp4').catch(() => {})
  }
}

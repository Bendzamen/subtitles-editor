import React, { useState, useRef, useCallback } from 'react'
import axios from 'axios'
import LoadingOverlay from './LoadingOverlay.jsx'
import { parseSRT } from '../utils/srtParser.js'

const WHISPER_MODELS = [
  { value: 'tiny', label: 'Tiny (fastest, least accurate)' },
  { value: 'base', label: 'Base (fast, good accuracy)' },
  { value: 'small', label: 'Small (balanced)' },
  { value: 'medium', label: 'Medium (slower, more accurate)' },
  { value: 'large', label: 'Large (slowest, most accurate)' },
]

const LANGUAGES = [
  { value: '', label: 'Auto-detect' },
  { value: 'af', label: 'Afrikaans' },
  { value: 'sq', label: 'Albanian' },
  { value: 'am', label: 'Amharic' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hy', label: 'Armenian' },
  { value: 'as', label: 'Assamese' },
  { value: 'az', label: 'Azerbaijani' },
  { value: 'ba', label: 'Bashkir' },
  { value: 'eu', label: 'Basque' },
  { value: 'be', label: 'Belarusian' },
  { value: 'bn', label: 'Bengali' },
  { value: 'bs', label: 'Bosnian' },
  { value: 'br', label: 'Breton' },
  { value: 'bg', label: 'Bulgarian' },
  { value: 'yue', label: 'Cantonese' },
  { value: 'ca', label: 'Catalan' },
  { value: 'zh', label: 'Chinese' },
  { value: 'hr', label: 'Croatian' },
  { value: 'cs', label: 'Czech' },
  { value: 'da', label: 'Danish' },
  { value: 'nl', label: 'Dutch' },
  { value: 'en', label: 'English' },
  { value: 'et', label: 'Estonian' },
  { value: 'fo', label: 'Faroese' },
  { value: 'fi', label: 'Finnish' },
  { value: 'fr', label: 'French' },
  { value: 'gl', label: 'Galician' },
  { value: 'ka', label: 'Georgian' },
  { value: 'de', label: 'German' },
  { value: 'el', label: 'Greek' },
  { value: 'gu', label: 'Gujarati' },
  { value: 'ht', label: 'Haitian Creole' },
  { value: 'ha', label: 'Hausa' },
  { value: 'haw', label: 'Hawaiian' },
  { value: 'he', label: 'Hebrew' },
  { value: 'hi', label: 'Hindi' },
  { value: 'hu', label: 'Hungarian' },
  { value: 'is', label: 'Icelandic' },
  { value: 'id', label: 'Indonesian' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'jw', label: 'Javanese' },
  { value: 'kn', label: 'Kannada' },
  { value: 'kk', label: 'Kazakh' },
  { value: 'km', label: 'Khmer' },
  { value: 'ko', label: 'Korean' },
  { value: 'lo', label: 'Lao' },
  { value: 'la', label: 'Latin' },
  { value: 'lv', label: 'Latvian' },
  { value: 'ln', label: 'Lingala' },
  { value: 'lt', label: 'Lithuanian' },
  { value: 'lb', label: 'Luxembourgish' },
  { value: 'mk', label: 'Macedonian' },
  { value: 'mg', label: 'Malagasy' },
  { value: 'ms', label: 'Malay' },
  { value: 'ml', label: 'Malayalam' },
  { value: 'mt', label: 'Maltese' },
  { value: 'mi', label: 'Maori' },
  { value: 'mr', label: 'Marathi' },
  { value: 'mn', label: 'Mongolian' },
  { value: 'my', label: 'Myanmar' },
  { value: 'ne', label: 'Nepali' },
  { value: 'no', label: 'Norwegian' },
  { value: 'nn', label: 'Nynorsk' },
  { value: 'oc', label: 'Occitan' },
  { value: 'ps', label: 'Pashto' },
  { value: 'fa', label: 'Persian' },
  { value: 'pl', label: 'Polish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'pa', label: 'Punjabi' },
  { value: 'ro', label: 'Romanian' },
  { value: 'ru', label: 'Russian' },
  { value: 'sa', label: 'Sanskrit' },
  { value: 'sr', label: 'Serbian' },
  { value: 'sn', label: 'Shona' },
  { value: 'sd', label: 'Sindhi' },
  { value: 'si', label: 'Sinhala' },
  { value: 'sk', label: 'Slovak' },
  { value: 'sl', label: 'Slovenian' },
  { value: 'so', label: 'Somali' },
  { value: 'es', label: 'Spanish' },
  { value: 'su', label: 'Sundanese' },
  { value: 'sw', label: 'Swahili' },
  { value: 'sv', label: 'Swedish' },
  { value: 'tg', label: 'Tajik' },
  { value: 'ta', label: 'Tamil' },
  { value: 'tt', label: 'Tatar' },
  { value: 'te', label: 'Telugu' },
  { value: 'th', label: 'Thai' },
  { value: 'bo', label: 'Tibetan' },
  { value: 'tl', label: 'Tagalog' },
  { value: 'tr', label: 'Turkish' },
  { value: 'tk', label: 'Turkmen' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'ur', label: 'Urdu' },
  { value: 'uz', label: 'Uzbek' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'cy', label: 'Welsh' },
  { value: 'yi', label: 'Yiddish' },
  { value: 'yo', label: 'Yoruba' },
]

const TRANSLATE_LANGUAGES = [
  { value: '', label: 'No translation' },
  { value: 'English', label: 'English' },
  { value: 'Spanish', label: 'Spanish' },
  { value: 'French', label: 'French' },
  { value: 'German', label: 'German' },
  { value: 'Italian', label: 'Italian' },
  { value: 'Portuguese', label: 'Portuguese' },
  { value: 'Russian', label: 'Russian' },
  { value: 'Japanese', label: 'Japanese' },
  { value: 'Korean', label: 'Korean' },
  { value: 'Chinese (Simplified)', label: 'Chinese (Simplified)' },
  { value: 'Arabic', label: 'Arabic' },
  { value: 'Hindi', label: 'Hindi' },
  { value: 'Dutch', label: 'Dutch' },
  { value: 'Polish', label: 'Polish' },
  { value: 'Czech', label: 'Czech' },
  { value: 'Slovak', label: 'Slovak' },
  { value: 'Swedish', label: 'Swedish' },
  { value: 'Turkish', label: 'Turkish' },
  { value: 'Ukrainian', label: 'Ukrainian' },
]

export default function UploadPage({ onComplete }) {
  const [videoFile, setVideoFile] = useState(null)
  const [srtFile, setSrtFile] = useState(null)
  const [model, setModel] = useState('base')
  const [sourceLanguage, setSourceLanguage] = useState('')
  const [targetLanguage, setTargetLanguage] = useState('')
  const [isDragging, setIsDragging] = useState(false)

  // Loading state
  const [isLoading, setIsLoading] = useState(false)
  const [loadingTitle, setLoadingTitle] = useState('')
  const [loadingStatus, setLoadingStatus] = useState('')
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [loadingSegments, setLoadingSegments] = useState([])

  const videoInputRef = useRef(null)
  const srtInputRef = useRef(null)

  const handleVideoDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && /\.(mp4|mkv|avi|mov|webm)$/i.test(file.name)) {
      setVideoFile(file)
    }
  }, [])

  const handleVideoDragOver = useCallback((e) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleVideoDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleVideoSelect = useCallback((e) => {
    const file = e.target.files[0]
    if (file) setVideoFile(file)
  }, [])

  const handleSrtSelect = useCallback((e) => {
    const file = e.target.files[0]
    if (file) setSrtFile(file)
  }, [])

  // ── Export filename ─────────────────────────────────────────────────────────

  function buildExportFileName() {
    const source = videoFile || srtFile
    if (!source) return 'subtitles.VibeSubs.srt'
    const base = source.name.replace(/\.[^/.]+$/, '') // strip extension
    return `${base}.VibeSubs.srt`
  }

  // ── Shared helpers ──────────────────────────────────────────────────────────

  async function uploadVideo(onProgress) {
    const formData = new FormData()
    formData.append('file', videoFile)
    const res = await axios.post('/api/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress,
    })
    return res.data // { video_id, duration }
  }

  async function parseSrtFile() {
    const formData = new FormData()
    formData.append('file', srtFile)
    const res = await axios.post('/api/upload-srt', formData)
    return res.data.subtitles
  }

  async function runTranslation(subtitles, targetLang, sourceLang) {
    setLoadingTitle('Translating subtitles...')
    setLoadingStatus(`Translating to ${targetLang}...`)
    setLoadingProgress(90)

    return new Promise((resolve, reject) => {
      const STREAM_TIMEOUT_MS = 10 * 60 * 1000
      let warning = null

      const timer = setTimeout(() => {
        reject(new Error('Translation timed out. Please try again.'))
      }, STREAM_TIMEOUT_MS)

      fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subtitles,
          target_language: targetLang,
          source_language: sourceLang || null,
        }),
      }).then(async (response) => {
        if (!response.ok) {
          clearTimeout(timer)
          throw new Error(`Translation request failed: ${response.statusText}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let receivedDone = false

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop()

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const jsonStr = trimmed.slice(5).trim()
            if (!jsonStr) continue
            try {
              const data = JSON.parse(jsonStr)
              if (data.type === 'ping') continue
              if (data.type === 'progress') {
                const pct = 90 + ((data.done / data.total) * 9)
                setLoadingProgress(Math.round(pct))
                setLoadingStatus(`Translating ${data.done}/${data.total} subtitles...`)
              } else if (data.type === 'warning') {
                warning = data.message
              } else if (data.type === 'done') {
                receivedDone = true
                clearTimeout(timer)
                resolve({ subtitles: data.subtitles, warning })
                return
              } else if (data.type === 'error') {
                clearTimeout(timer)
                reject(new Error(data.message))
                return
              }
            } catch { /* skip malformed */ }
          }
        }

        clearTimeout(timer)
        if (!receivedDone) {
          reject(new Error('Connection lost before translation completed.'))
        }
      }).catch((err) => { clearTimeout(timer); reject(err) })
    })
  }

  // ── Action: Generate Subtitles (Whisper + optional translate) ───────────────

  const handleGenerateSubtitles = useCallback(async () => {
    if (!videoFile) return
    setIsLoading(true)
    setLoadingSegments([])

    try {
      // Step 1: Upload & transcode video
      setLoadingTitle('Uploading video...')
      setLoadingStatus('Transcoding to 480p...')
      setLoadingProgress(5)

      const { video_id: videoId, duration } = await uploadVideo((e) => {
        if (e.total) setLoadingProgress(Math.round(5 + (e.loaded / e.total) * 30))
      })
      const videoUrl = `/api/video/${videoId}`

      // Step 2: If SRT uploaded, skip Whisper
      if (srtFile) {
        setLoadingTitle('Reading SRT file...')
        setLoadingStatus('Parsing subtitles...')
        setLoadingProgress(80)
        const subtitles = await parseSrtFile()
        let finalSubtitles = subtitles
        let translationWarning = null
        if (targetLanguage) {
          const result = await runTranslation(subtitles, targetLanguage, sourceLanguage)
          finalSubtitles = result.subtitles
          translationWarning = result.warning
        }
        setIsLoading(false)
        onComplete({ videoId, videoUrl, subtitles: finalSubtitles, duration, exportFileName: buildExportFileName(), translationWarning })
        return
      }

      // Step 3: Transcribe via SSE
      setLoadingTitle('Transcribing audio...')
      setLoadingStatus(`Loading Whisper ${model} model...`)
      setLoadingProgress(35)

      const transcribedSubtitles = await new Promise((resolve, reject) => {
        const params = new URLSearchParams({ model })
        if (sourceLanguage) params.append('language', sourceLanguage)
        const es = new EventSource(`/api/transcribe/${videoId}?${params.toString()}`)

        const STREAM_TIMEOUT_MS = 10 * 60 * 1000
        let receivedDone = false
        const timer = setTimeout(() => {
          es.close()
          reject(new Error('Transcription timed out. Please try again.'))
        }, STREAM_TIMEOUT_MS)

        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data)
            if (data.type === 'ping') return
            if (data.type === 'progress') {
              setLoadingSegments(data.segments || [])
              setLoadingProgress(Math.round(Math.min(85, 35 + (data.count * 0.5))))
              setLoadingStatus(`Transcribed ${data.count} segments...`)
            } else if (data.type === 'done') {
              receivedDone = true
              clearTimeout(timer)
              es.close()
              setLoadingProgress(90)
              resolve(data.subtitles)
            } else if (data.type === 'error') {
              clearTimeout(timer)
              es.close()
              reject(new Error(data.message))
            }
          } catch (err) {
            clearTimeout(timer)
            es.close()
            reject(err)
          }
        }
        es.onerror = () => {
          clearTimeout(timer)
          es.close()
          if (!receivedDone) reject(new Error('Transcription connection failed'))
        }
      })

      // Step 4: Optionally translate
      let finalSubtitles = transcribedSubtitles
      let translationWarning = null
      if (targetLanguage) {
        const result = await runTranslation(transcribedSubtitles, targetLanguage, sourceLanguage)
        finalSubtitles = result.subtitles
        translationWarning = result.warning
      }

      setLoadingProgress(100)
      setIsLoading(false)
      onComplete({ videoId, videoUrl, subtitles: finalSubtitles, duration, exportFileName: buildExportFileName(), translationWarning })

    } catch (err) {
      console.error(err)
      setIsLoading(false)
      alert(`Error: ${err.message || 'Something went wrong.'}`)
    }
  }, [videoFile, srtFile, model, sourceLanguage, targetLanguage, onComplete])

  // ── Action: Translate Only (SRT required, video optional) ───────────────────

  const handleTranslateOnly = useCallback(async () => {
    if (!srtFile || !targetLanguage) return
    setIsLoading(true)
    setLoadingSegments([])

    try {
      let videoId = null, videoUrl = null, duration = 0

      // Optionally upload video
      if (videoFile) {
        setLoadingTitle('Uploading video...')
        setLoadingStatus('Transcoding to 480p...')
        setLoadingProgress(5)
        const result = await uploadVideo((e) => {
          if (e.total) setLoadingProgress(Math.round(5 + (e.loaded / e.total) * 30))
        })
        videoId = result.video_id
        videoUrl = `/api/video/${videoId}`
        duration = result.duration
      }

      // Parse the SRT file
      setLoadingTitle('Reading SRT file...')
      setLoadingStatus('Parsing subtitles...')
      setLoadingProgress(40)
      const subtitles = await parseSrtFile()

      // Translate
      const { subtitles: finalSubtitles, warning: translationWarning } = await runTranslation(subtitles, targetLanguage, sourceLanguage)

      setLoadingProgress(100)
      setIsLoading(false)
      onComplete({ videoId, videoUrl, subtitles: finalSubtitles, duration, exportFileName: buildExportFileName(), translationWarning })

    } catch (err) {
      console.error(err)
      setIsLoading(false)
      alert(`Error: ${err.message || 'Something went wrong.'}`)
    }
  }, [videoFile, srtFile, sourceLanguage, targetLanguage, onComplete])

  // ── Action: Start Empty (video optional) ───────────────────────────────────

  const handleStartEmpty = useCallback(async () => {
    if (!videoFile) {
      // No video — open editor with empty subtitles immediately
      onComplete({ videoId: null, videoUrl: null, subtitles: [], duration: 0, exportFileName: buildExportFileName() })
      return
    }

    setIsLoading(true)
    setLoadingSegments([])

    try {
      setLoadingTitle('Uploading video...')
      setLoadingStatus('Transcoding to 480p...')
      setLoadingProgress(5)

      const { video_id: videoId, duration } = await uploadVideo((e) => {
        if (e.total) setLoadingProgress(Math.round(5 + (e.loaded / e.total) * 90))
      })
      const videoUrl = `/api/video/${videoId}`

      setLoadingProgress(100)
      setIsLoading(false)
      onComplete({ videoId, videoUrl, subtitles: [], duration, exportFileName: buildExportFileName() })

    } catch (err) {
      console.error(err)
      setIsLoading(false)
      alert(`Error: ${err.message || 'Something went wrong.'}`)
    }
  }, [videoFile, onComplete])

  // ── Button enabled states ───────────────────────────────────────────────────
  const canGenerate = !!videoFile
  const canTranslateOnly = !!srtFile && !!targetLanguage
  // Start empty is always available

  const sourceLanguageLabel = LANGUAGES.find(l => l.value === sourceLanguage)?.label || 'Auto-detect'

  return (
    <div className="upload-page">
      <h1 className="upload-title">Subtitle Generator</h1>
      <p className="upload-subtitle">
        Upload a video to generate, translate, or manually create subtitles
      </p>

      <div className="upload-card">
        {/* Video drop zone */}
        <div
          className={`drop-zone${isDragging ? ' dragover' : ''}`}
          onClick={() => videoInputRef.current?.click()}
          onDrop={handleVideoDrop}
          onDragOver={handleVideoDragOver}
          onDragLeave={handleVideoDragLeave}
        >
          <div className="drop-zone-icon">{videoFile ? '🎬' : '📁'}</div>
          {videoFile ? (
            <div className="drop-zone-filename">{videoFile.name}</div>
          ) : (
            <>
              <div className="drop-zone-text">Drop video here or click to browse</div>
              <div className="drop-zone-hint">Supports MP4, MKV, AVI, MOV, WebM — optional for Translate Only / Start Empty</div>
            </>
          )}
          <input
            ref={videoInputRef}
            type="file"
            accept=".mp4,.mkv,.avi,.mov,.webm,video/*"
            onChange={handleVideoSelect}
            style={{ display: 'none' }}
          />
        </div>

        {/* SRT upload */}
        <div>
          <div className="form-label" style={{ marginBottom: 6 }}>
            SRT file — required for "Translate Only", optional otherwise
          </div>
          <div className="srt-upload-row" onClick={() => srtInputRef.current?.click()}>
            <span style={{ fontSize: 16 }}>📄</span>
            <span className={`srt-upload-label${srtFile ? ' has-file' : ''}`}>
              {srtFile ? srtFile.name : 'Click to upload .srt file...'}
            </span>
            {srtFile && (
              <button
                className="btn-icon"
                onClick={(e) => { e.stopPropagation(); setSrtFile(null) }}
                tabIndex={-1}
                title="Remove SRT file"
              >
                ✕
              </button>
            )}
            <input
              ref={srtInputRef}
              type="file"
              accept=".srt"
              onChange={handleSrtSelect}
              style={{ display: 'none' }}
            />
          </div>
        </div>

        {/* Whisper model — only relevant for Generate Subtitles */}
        {!srtFile && (
          <div className="form-group">
            <label className="form-label">Whisper Model</label>
            <select value={model} onChange={e => setModel(e.target.value)}>
              {WHISPER_MODELS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Source + Target language */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Source Language</label>
            <select value={sourceLanguage} onChange={e => setSourceLanguage(e.target.value)}>
              {LANGUAGES.map(l => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Translate To</label>
            <select value={targetLanguage} onChange={e => setTargetLanguage(e.target.value)}>
              {TRANSLATE_LANGUAGES.map(l => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Action buttons */}
        <div className="upload-btn-row">
          <button
            className="btn-secondary"
            onClick={handleStartEmpty}
            title="Open editor with empty subtitle list"
          >
            Start Empty
          </button>

          <button
            className="btn-secondary"
            onClick={handleTranslateOnly}
            disabled={!canTranslateOnly}
            title={
              !srtFile ? 'Upload an SRT file first'
              : !targetLanguage ? 'Select a target language'
              : `Translate SRT to ${targetLanguage}`
            }
          >
            Translate Only
          </button>

          <button
            className="btn-primary"
            onClick={handleGenerateSubtitles}
            disabled={!canGenerate}
            title={!videoFile ? 'Upload a video first' : 'Run Whisper transcription'}
          >
            {srtFile ? 'Open in Editor' : 'Generate Subtitles'}
          </button>
        </div>
      </div>

      <a
        href="https://github.com/Bendzamen/subtitles-editor"
        target="_blank"
        rel="noopener noreferrer"
        className="upload-github-link"
      >
        <svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
        </svg>
        View on GitHub
      </a>

      {isLoading && (
        <LoadingOverlay
          title={loadingTitle}
          status={loadingStatus}
          progress={loadingProgress}
          segments={loadingSegments}
        />
      )}
    </div>
  )
}

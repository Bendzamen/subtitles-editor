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
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
  { value: 'nl', label: 'Dutch' },
  { value: 'pl', label: 'Polish' },
  { value: 'sv', label: 'Swedish' },
  { value: 'tr', label: 'Turkish' },
  { value: 'uk', label: 'Ukrainian' },
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

  const handleSubmit = useCallback(async () => {
    if (!videoFile) return

    setIsLoading(true)
    setLoadingSegments([])

    try {
      // Step 1: Upload video
      setLoadingTitle('Uploading video...')
      setLoadingStatus('Transcoding to 480p...')
      setLoadingProgress(5)

      const formData = new FormData()
      formData.append('file', videoFile)

      const uploadRes = await axios.post('/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const pct = (progressEvent.loaded / progressEvent.total) * 30
            setLoadingProgress(Math.round(5 + pct))
          }
        },
      })

      const { video_id: videoId, duration } = uploadRes.data
      const videoUrl = `/api/video/${videoId}`

      // Step 2: Handle SRT file if provided (skip transcription)
      if (srtFile) {
        setLoadingTitle('Reading SRT file...')
        setLoadingStatus('Parsing subtitles...')
        setLoadingProgress(80)

        const srtFormData = new FormData()
        srtFormData.append('file', srtFile)
        const srtRes = await axios.post('/api/upload-srt', srtFormData)
        const subtitles = srtRes.data.subtitles

        // Translate if requested
        let finalSubtitles = subtitles
        if (targetLanguage) {
          finalSubtitles = await runTranslation(subtitles, targetLanguage)
        }

        setIsLoading(false)
        onComplete({ videoId, videoUrl, subtitles: finalSubtitles, duration })
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

        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data)

            if (data.type === 'ping') return

            if (data.type === 'progress') {
              setLoadingSegments(data.segments || [])
              // Estimate progress: 35-85%
              const estimated = Math.min(85, 35 + (data.count * 0.5))
              setLoadingProgress(Math.round(estimated))
              setLoadingStatus(`Transcribed ${data.count} segments...`)
            } else if (data.type === 'done') {
              es.close()
              setLoadingProgress(90)
              resolve(data.subtitles)
            } else if (data.type === 'error') {
              es.close()
              reject(new Error(data.message))
            }
          } catch (err) {
            es.close()
            reject(err)
          }
        }

        es.onerror = (err) => {
          es.close()
          reject(new Error('Transcription connection failed'))
        }
      })

      // Step 4: Translate if requested
      let finalSubtitles = transcribedSubtitles
      if (targetLanguage) {
        finalSubtitles = await runTranslation(transcribedSubtitles, targetLanguage)
      }

      setLoadingProgress(100)
      setIsLoading(false)
      onComplete({ videoId, videoUrl, subtitles: finalSubtitles, duration })

    } catch (err) {
      console.error('Error:', err)
      setIsLoading(false)
      alert(`Error: ${err.message || 'Something went wrong. Check the console for details.'}`)
    }
  }, [videoFile, srtFile, model, sourceLanguage, targetLanguage, onComplete])

  async function runTranslation(subtitles, targetLang) {
    setLoadingTitle('Translating subtitles...')
    setLoadingStatus(`Translating to ${targetLang}...`)
    setLoadingProgress(90)

    return new Promise((resolve, reject) => {
      // POST with SSE requires a different approach - use fetch with ReadableStream
      // since EventSource only supports GET. Use fetch instead.
      fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtitles, target_language: targetLang }),
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error(`Translation request failed: ${response.statusText}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() // keep incomplete line

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
              } else if (data.type === 'done') {
                resolve(data.subtitles)
                return
              } else if (data.type === 'error') {
                reject(new Error(data.message))
                return
              }
            } catch {
              // skip malformed lines
            }
          }
        }
        reject(new Error('Translation stream ended unexpectedly'))
      }).catch(reject)
    })
  }

  const isReady = !!videoFile

  return (
    <div className="upload-page">
      <h1 className="upload-title">Subtitle Generator</h1>
      <p className="upload-subtitle">
        Upload a video to automatically transcribe and generate subtitles
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
              <div className="drop-zone-hint">Supports MP4, MKV, AVI, MOV, WebM</div>
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

        {/* Optional SRT upload */}
        <div>
          <div className="form-label" style={{ marginBottom: 6 }}>
            Optional: Upload existing SRT (skips transcription)
          </div>
          <div
            className="srt-upload-row"
            onClick={() => srtInputRef.current?.click()}
          >
            <span style={{ fontSize: 16 }}>📄</span>
            <span className={`srt-upload-label${srtFile ? ' has-file' : ''}`}>
              {srtFile ? srtFile.name : 'Click to upload .srt file...'}
            </span>
            {srtFile && (
              <button
                className="btn-icon"
                onClick={(e) => { e.stopPropagation(); setSrtFile(null) }}
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

        {/* Model and language settings (shown only if not using SRT) */}
        {!srtFile && (
          <>
            <div className="form-group">
              <label className="form-label">Whisper Model</label>
              <select value={model} onChange={e => setModel(e.target.value)}>
                {WHISPER_MODELS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

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
          </>
        )}

        {srtFile && (
          <div className="form-group">
            <label className="form-label">Translate To</label>
            <select value={targetLanguage} onChange={e => setTargetLanguage(e.target.value)}>
              {TRANSLATE_LANGUAGES.map(l => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Submit button */}
        <div className="upload-btn-row">
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={!isReady}
          >
            {srtFile ? 'Open in Editor' : 'Generate Subtitles'}
          </button>
        </div>
      </div>

      {/* Loading overlay */}
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

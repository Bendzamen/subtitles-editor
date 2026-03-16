import React, { useRef, useState, useCallback, useEffect } from 'react'
import Waveform from './Waveform.jsx'
import SubtitleBlock from './SubtitleBlock.jsx'
import { downloadSRT } from '../utils/srtExporter.js'

export default function EditorPage({
  videoId,
  videoUrl,
  subtitles,
  setSubtitles,
  duration,
  exportFileName,
  onBack,
}) {
  const videoRef = useRef(null)
  const subtitleListRef = useRef(null)
  const [selectedId, setSelectedId] = useState(null)
  const [activeId, setActiveId] = useState(null)
  const [zoomLevel, setZoomLevel] = useState(50)
  const pendingSelectTimeRef = useRef(null)

  const hasVideo = !!videoUrl
  const audioUrl = videoId ? `/api/audio/${videoId}` : null

  // Track video time -> update active subtitle, auto-scroll list when playing
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let prevActiveId = null

    const onTimeUpdate = () => {
      const t = video.currentTime
      const active = subtitles.find(s => t >= s.start && t < s.end)
      const newActiveId = active?.id ?? null

      if (newActiveId !== prevActiveId) {
        prevActiveId = newActiveId
        setActiveId(newActiveId)

        if (newActiveId !== null && !video.paused) {
          const el = subtitleListRef.current?.querySelector(`[data-id="${newActiveId}"]`)
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }
      }
    }

    video.addEventListener('timeupdate', onTimeUpdate)
    return () => video.removeEventListener('timeupdate', onTimeUpdate)
  }, [subtitles])

  // After adding a subtitle: select it and scroll to it
  useEffect(() => {
    if (pendingSelectTimeRef.current === null) return
    const t = pendingSelectTimeRef.current
    const found = subtitles.find(s => s.start === t)
    if (found) {
      pendingSelectTimeRef.current = null
      setSelectedId(found.id)
      setTimeout(() => {
        const el = subtitleListRef.current?.querySelector(`[data-id="${found.id}"]`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 50)
    }
  }, [subtitles])

  const activeSub = subtitles.find(s => s.id === activeId)

  const handleSelectSubtitle = useCallback((id) => {
    setSelectedId(id)
    setTimeout(() => {
      const el = subtitleListRef.current?.querySelector(`[data-id="${id}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 50)
  }, [])

  const handleSubtitleChange = useCallback((updated) => {
    setSubtitles(prev => prev.map(s => s.id === updated.id ? updated : s))
  }, [setSubtitles])

  const handleSubtitleDelete = useCallback((id) => {
    setSubtitles(prev => {
      const filtered = prev.filter(s => s.id !== id)
      return filtered.map((s, i) => ({ ...s, id: i + 1 }))
    })
    setSelectedId(prev => prev === id ? null : prev)
  }, [setSubtitles])

  const handleAddSubtitle = useCallback(() => {
    const t = videoRef.current?.currentTime ?? 0
    pendingSelectTimeRef.current = t
    setSubtitles(prev => {
      const newSub = { id: 0, start: t, end: t + 2, text: 'New subtitle' }
      const sorted = [...prev, newSub].sort((a, b) => a.start - b.start)
      return sorted.map((s, i) => ({ ...s, id: i + 1 }))
    })
  }, [setSubtitles])

  const handleExport = useCallback(() => {
    downloadSRT(subtitles, exportFileName || 'subtitles.SubForge.srt')
  }, [subtitles, exportFileName])

  return (
    <div className="editor-page">
      {/* Toolbar */}
      <div className="editor-toolbar">
        <button className="btn-secondary" onClick={onBack}>← Back</button>
        <span className="editor-toolbar-title">Subtitle Editor</span>
        <button className="btn-secondary" onClick={handleAddSubtitle}>+ Add Subtitle</button>
        <button className="btn-primary" onClick={handleExport}>Export SRT</button>
      </div>

      <div className="editor-main">
        {/* Top row: video (left, if present) + subtitle list (right) */}
        <div className="editor-top">
          {hasVideo && (
            <div className="video-wrapper">
              <video ref={videoRef} src={videoUrl} controls playsInline />
              {activeSub && (
                <div className="subtitle-overlay">
                  {activeSub.text}
                </div>
              )}
            </div>
          )}

          <div className={`editor-right${!hasVideo ? ' editor-right-full' : ''}`}>
            <div className="subtitle-list-header">
              <span>Subtitles ({subtitles.length})</span>
            </div>
            <div className="subtitle-list" ref={subtitleListRef}>
              {subtitles.map(sub => (
                <SubtitleBlock
                  key={sub.id}
                  subtitle={sub}
                  isSelected={sub.id === selectedId}
                  isActive={sub.id === activeId}
                  onChange={handleSubtitleChange}
                  onDelete={() => handleSubtitleDelete(sub.id)}
                  onSelect={() => {
                    handleSelectSubtitle(sub.id)
                    if (videoRef.current) videoRef.current.currentTime = sub.start
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Bottom: waveform (full width, only when video is available) */}
        {hasVideo && <div className="waveform-section">
          <div className="waveform-controls">
            <span className="waveform-zoom-label">Zoom</span>
            <input
              type="range"
              min="20"
              max="600"
              value={zoomLevel}
              onChange={e => setZoomLevel(Number(e.target.value))}
              className="waveform-zoom-slider"
              title={`${zoomLevel}px/s`}
            />
            <span className="waveform-zoom-value">{zoomLevel}px/s</span>
          </div>
          <div className="waveform-inner">
            <Waveform
              audioUrl={audioUrl}
              videoRef={videoRef}
              subtitles={subtitles}
              selectedId={selectedId}
              onSelectSubtitle={handleSelectSubtitle}
              onSubtitleChange={handleSubtitleChange}
              duration={duration}
              zoomLevel={zoomLevel}
            />
          </div>
        </div>}
      </div>
    </div>
  )
}
